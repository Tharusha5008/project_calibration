const router = require('express').Router();
const db = require('../db');
const { authenticate, requireRole } = require('../lib/auth');
const { canMove, label } = require('../lib/workflow');
const { wrap, bad, notFound, forbidden, J, round, newToken, newCertNumber, equipmentRow, logEvent } = require('../lib/util');

router.use(authenticate);

const LIST_SQL = `SELECT r.*, e.name AS equipment_name, e.unit, e.key AS equipment_key, u.full_name AS customer_name, u.organisation,
    t.full_name AS technician_name, c.verdict AS check_verdict, c.error_ratio AS check_ratio,
    cert.id AS certificate_id, cert.number AS certificate_number, cert.approval_status AS certificate_status, cert.result AS certificate_result
  FROM requests r
  JOIN equipment_types e ON e.id=r.equipment_type_id
  JOIN users u ON u.id=r.user_id
  LEFT JOIN users t ON t.id=r.technician_id
  LEFT JOIN checks c ON c.id=r.check_id
  LEFT JOIN certificates cert ON cert.request_id=r.id`;

const decorate = (r) => ({ ...r, status_label: label(r.status), calibration_data: J(r.calibration_data) });

// Load a request and make sure the caller is allowed to see it.
async function load(req, id) {
  const r = await db.get(`${LIST_SQL} WHERE r.id=?`, id);
  if (!r) throw notFound('Request not found');
  const { role, id: uid } = req.user;
  if (role === 'user' && r.user_id !== uid) throw forbidden();
  if (role === 'technician' && r.technician_id !== uid) throw forbidden('This token is not assigned to you');
  return r;
}

// Status change + timeline entry. Pass a transaction runner `t` to make it part of a larger atomic change.
async function move(r, to, actor, note, t = db) {
  if (!canMove(r.status, to)) throw bad(`Cannot move a token from "${label(r.status)}" to "${label(to)}"`);
  await t.run('UPDATE requests SET status=?, updated_at=now() WHERE id=?', to, r.id);
  await logEvent(r.id, 'status', label(to), note, actor.id, null, t);
}

router.get('/', wrap(async (req, res) => {
  const where = [], p = [];
  if (req.user.role === 'user') { where.push('r.user_id=?'); p.push(req.user.id); }
  if (req.user.role === 'technician') { where.push('r.technician_id=?'); p.push(req.user.id); }
  if (req.query.status) { where.push('r.status=?'); p.push(req.query.status); }
  if (req.query.active === 'true') where.push("r.status NOT IN ('closed','cancelled')");
  if (req.query.q) { where.push('(r.token ILIKE ? OR r.serial_no ILIKE ? OR e.name ILIKE ?)'); p.push(...Array(3).fill(`%${req.query.q}%`)); }
  const rows = await db.all(`${LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.updated_at DESC LIMIT 300`, ...p);
  res.json({ requests: rows.map(decorate) });
}));

router.get('/:id', wrap(async (req, res) => {
  const r = await load(req, req.params.id);
  const equipment = equipmentRow(await db.get('SELECT * FROM equipment_types WHERE id=?', r.equipment_type_id));
  const check = r.check_id ? await db.get('SELECT * FROM checks WHERE id=?', r.check_id) : null;
  const events = await db.all(`SELECT ev.*, u.full_name AS actor_name, u.role AS actor_role FROM request_events ev
    LEFT JOIN users u ON u.id=ev.actor_id WHERE request_id=? ORDER BY ev.id`, r.id);
  const messages = await db.all(`SELECT m.*, u.full_name AS author_name, u.role AS author_role FROM messages m
    JOIN users u ON u.id=m.author_id WHERE m.request_id=? ORDER BY m.id`, r.id);
  const certificate = (await db.get('SELECT id,number,result,approval_status,issued_at,valid_until,rejection_reason FROM certificates WHERE request_id=?', r.id)) || null;
  res.json({ request: decorate(r), equipment, check: check ? { ...check, context: J(check.context, {}), ai: J(check.ai), suspicious: !!check.suspicious } : null,
    events, messages, certificate });
}));

// ---- 1. Customer books a token after a check shows the instrument is out of (or near) tolerance ----
router.post('/', requireRole('user'), wrap(async (req, res) => {
  const check = await db.get('SELECT * FROM checks WHERE id=?', req.body?.checkId);
  if (!check || check.user_id !== req.user.id) throw notFound('Check not found');
  if (check.verdict === 'within') throw bad('This reading is comfortably within tolerance - no calibration is needed.');
  const dup = await db.get("SELECT token FROM requests WHERE check_id=? AND status NOT IN ('cancelled')", check.id);
  if (dup) throw bad(`A token (${dup.token}) was already booked for this check.`);
  const open = await db.get("SELECT token FROM requests WHERE serial_no=? AND equipment_type_id=? AND status NOT IN ('closed','cancelled')", check.serial_no, check.equipment_type_id);
  if (open) throw bad(`This instrument already has an open token (${open.token}).`);

  const token = await newToken();
  const id = await db.tx(async (t) => {
    const newId = await t.insert('INSERT INTO requests (token,user_id,equipment_type_id,check_id,serial_no) VALUES (?,?,?,?,?)',
      token, req.user.id, check.equipment_type_id, check.id, check.serial_no);
    await logEvent(newId, 'status', label('booked'), `Booked after a check showed ${round(check.error_ratio * 100, 0)}% of tolerance used.`, req.user.id, null, t);
    return newId;
  });
  res.status(201).json({ request: decorate(await db.get(`${LIST_SQL} WHERE r.id=?`, id)) });
}));

// ---- 2. Customer hands the instrument over: in person or via courier ----
router.post('/:id/handover', requireRole('user'), wrap(async (req, res) => {
  const r = await load(req, req.params.id);
  const { method, courierName, trackingNo } = req.body || {};
  if (!['physical', 'courier'].includes(method)) throw bad('Choose physical drop-off or courier');
  if (method === 'courier' && (!courierName || !trackingNo)) throw bad('Enter the courier name and tracking number');
  await db.tx(async (t) => {
    await move(r, 'handed_over', req.user, method === 'physical' ? 'Customer is delivering the instrument to the lab in person.' : `Sent via ${courierName} (${trackingNo}).`, t);
    await t.run('UPDATE requests SET handover_method=?, courier_name=?, tracking_no=? WHERE id=?',
      method, method === 'courier' ? String(courierName).trim() : null, method === 'courier' ? String(trackingNo).trim() : null, r.id);
    if (method === 'courier') await logEvent(r.id, 'shipment', 'Dispatched by customer', `${courierName} - ${trackingNo}`, req.user.id, 'inbound', t);
  });
  res.json({ request: decorate(await load(req, r.id)) });
}));

// ---- 3. Admin confirms receipt, accepts the token and assigns a technician ----
router.post('/:id/accept', requireRole('admin'), wrap(async (req, res) => {
  const r = await load(req, req.params.id);
  const tech = await db.get("SELECT id,full_name FROM users WHERE id=? AND role='technician' AND is_active=1", req.body?.technicianId);
  if (!tech) throw bad('Choose an active technician');
  await db.tx(async (t) => {
    await move(r, 'accepted', req.user, `Received and accepted. Assigned to ${tech.full_name}.`, t);
    await t.run('UPDATE requests SET technician_id=? WHERE id=?', tech.id, r.id);
    await logEvent(r.id, 'shipment', 'Received at the lab', req.body?.note || null, req.user.id, 'inbound', t);
  });
  res.json({ request: decorate(await load(req, r.id)) });
}));

router.post('/:id/reassign', requireRole('admin'), wrap(async (req, res) => {
  const r = await load(req, req.params.id);
  if (!['accepted', 'in_calibration'].includes(r.status)) throw bad('A technician can only be changed while the token is accepted or in calibration');
  const tech = await db.get("SELECT id,full_name FROM users WHERE id=? AND role='technician' AND is_active=1", req.body?.technicianId);
  if (!tech) throw bad('Choose an active technician');
  await db.tx(async (t) => {
    await t.run('UPDATE requests SET technician_id=?, updated_at=now() WHERE id=?', tech.id, r.id);
    await logEvent(r.id, 'note', 'Technician reassigned', `Now assigned to ${tech.full_name}.`, req.user.id, null, t);
  });
  res.json({ request: decorate(await load(req, r.id)) });
}));

// ---- 4. Technician starts work ----
router.post('/:id/start', requireRole('technician'), wrap(async (req, res) => {
  const r = await load(req, req.params.id);
  await move(r, 'in_calibration', req.user, 'Technician started calibration.');
  res.json({ request: decorate(await load(req, r.id)) });
}));

// Technician updates the token: progress note and/or saves readings so far (draft)
router.post('/:id/update', requireRole('technician', 'admin'), wrap(async (req, res) => {
  const r = await load(req, req.params.id);
  if (r.status !== 'in_calibration') throw bad('Updates can be added while the token is in calibration');
  const { note, readings } = req.body || {};
  await db.tx(async (t) => {
    if (readings !== undefined) {
      const eq = equipmentRow(await t.get('SELECT * FROM equipment_types WHERE id=?', r.equipment_type_id));
      const clean = cleanReadings(readings, eq, false);
      await t.run('UPDATE requests SET calibration_data=?, updated_at=now() WHERE id=?', JSON.stringify(clean), r.id);
    }
    if (note && String(note).trim()) await logEvent(r.id, 'note', 'Technician update', String(note).trim(), req.user.id, null, t);
    else if (readings !== undefined) await logEvent(r.id, 'note', 'Readings saved', 'Draft calibration readings were saved.', req.user.id, null, t);
  });
  res.json({ request: decorate(await load(req, r.id)) });
}));

// Validate technician readings against the standard points of the instrument type.
function cleanReadings(readings, eq, requireAll) {
  if (!Array.isArray(readings)) throw bad('Readings must be a list');
  const out = eq.points.map((pt, i) => {
    const row = readings.find((x) => Number(x.index) === i) || readings[i] || {};
    const f = (v, name) => {
      if (v === undefined || v === null || v === '') return null;
      const n = Number(v);
      if (!Number.isFinite(n)) throw bad(`Point ${i + 1} ${name} must be a number`);
      const span = eq.range_max - eq.range_min;
      if (n < eq.range_min - 0.5 * span || n > eq.range_max + 0.5 * span) throw bad(`Point ${i + 1} ${name} (${n} ${eq.unit}) is outside the plausible range`);
      return n;
    };
    return { index: i, value: pt.value, mpe: pt.mpe, as_found: f(row.as_found, 'as-found'), as_left: f(row.as_left, 'as-left') };
  });
  if (requireAll) {
    const missing = out.filter((o) => o.as_found === null).map((o) => o.value);
    if (missing.length) throw bad(`Enter an as-found reading for every standard point (missing: ${missing.join(', ')} ${eq.unit})`);
  }
  return out;
}

const within = (reading, row) => reading !== null && Math.abs(reading - row.value) <= row.mpe + 1e-9;

// ---- 5. Technician finishes and issues the certificate (goes to admin for approval) ----
router.post('/:id/issue-certificate', requireRole('technician'), wrap(async (req, res) => {
  const r = await load(req, req.params.id);
  if (r.status !== 'in_calibration') throw bad('The token must be in calibration to issue a certificate');
  const eq = equipmentRow(await db.get('SELECT * FROM equipment_types WHERE id=?', r.equipment_type_id));
  const rows = cleanReadings(req.body?.readings ?? J(r.calibration_data, []), eq, true);

  // The RESULT is computed here from the readings - technicians cannot type a different outcome.
  const foundOk = rows.every((x) => within(x.as_found, x));
  const leftAll = rows.every((x) => x.as_left !== null);
  const leftOk = leftAll && rows.every((x) => within(x.as_left, x));
  let result;
  if (foundOk) result = 'PASS';
  else if (leftOk) result = 'ADJUSTED';
  else result = 'FAIL';
  // As-found out of tolerance and no (complete) as-left readings => the instrument could not be brought back in tolerance => FAIL.

  const env = { temperature: Number(req.body?.temperature) || null, humidity: Number(req.body?.humidity) || null };
  const months = Number(process.env.CERT_VALID_MONTHS) || 12;
  const valid = new Date(); valid.setMonth(valid.getMonth() + months);
  await db.tx(async (t) => {
    const number = await newCertNumber(t);
    await t.run('UPDATE requests SET calibration_data=?, updated_at=now() WHERE id=?', JSON.stringify(rows), r.id);
    await t.run(`INSERT INTO certificates (number,request_id,technician_id,result,data,remarks,environment,valid_until) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT (request_id) DO UPDATE SET result=excluded.result,data=excluded.data,remarks=excluded.remarks,environment=excluded.environment,
        approval_status='pending',rejection_reason=NULL,issued_at=now(),valid_until=excluded.valid_until`,
      number, r.id, req.user.id, result, JSON.stringify(rows), req.body?.remarks || null, JSON.stringify(env), valid.toISOString().slice(0, 10));
    await move(r, 'certificate_pending', req.user, `Calibration complete - result ${result}. Certificate sent for approval.`, t);
  });
  res.json({ request: decorate(await load(req, r.id)) });
}));

// ---- 6. Return to customer ----
router.post('/:id/return', requireRole('admin', 'technician'), wrap(async (req, res) => {
  const r = await load(req, req.params.id);
  if (r.status !== 'certificate_approved') throw bad('The certificate must be approved before the instrument is returned');
  const { method, courierName, trackingNo } = req.body || {};
  if (!['pickup', 'courier'].includes(method)) throw bad('Choose customer pickup or courier return');
  if (method === 'courier' && (!courierName || !trackingNo)) throw bad('Enter the courier name and tracking number');
  await db.tx(async (t) => {
    if (method === 'pickup') {
      await t.run("UPDATE requests SET return_method='pickup', updated_at=now() WHERE id=?", r.id);
      await move(r, 'returning', req.user, 'Ready for collection at the lab.', t);
    } else {
      await t.run("UPDATE requests SET return_method='courier', return_courier=?, return_tracking_no=?, updated_at=now() WHERE id=?", courierName, trackingNo, r.id);
      await move(r, 'returning', req.user, `Returned via ${courierName} (${trackingNo}).`, t);
      await logEvent(r.id, 'shipment', 'Dispatched to customer', `${courierName} - ${trackingNo}`, req.user.id, 'return', t);
    }
  });
  res.json({ request: decorate(await load(req, r.id)) });
}));

// Customer (or admin) confirms the instrument is back
router.post('/:id/confirm-received', requireRole('user', 'admin'), wrap(async (req, res) => {
  const r = await load(req, req.params.id);
  if (!['returning', 'certificate_approved'].includes(r.status)) throw bad('Nothing to confirm yet');
  await move(r, 'closed', req.user, req.user.role === 'user' ? 'Customer confirmed the instrument was received.' : 'Closed by admin.');
  res.json({ request: decorate(await load(req, r.id)) });
}));

router.post('/:id/cancel', requireRole('user', 'admin'), wrap(async (req, res) => {
  const r = await load(req, req.params.id);
  await move(r, 'cancelled', req.user, req.body?.reason || 'Cancelled.');
  res.json({ request: decorate(await load(req, r.id)) });
}));

// Courier tracking update (the delivery timeline). Customer logs inbound progress, lab logs return progress.
const STAGES = ['Dispatched', 'In transit', 'Out for delivery', 'Delivered', 'Delivery attempted', 'Delayed'];
router.post('/:id/shipment', wrap(async (req, res) => {
  const r = await load(req, req.params.id);
  const { direction, stage, location, note } = req.body || {};
  if (!['inbound', 'return'].includes(direction)) throw bad('Direction must be inbound or return');
  if (!STAGES.includes(stage)) throw bad(`Stage must be one of: ${STAGES.join(', ')}`);
  if (direction === 'inbound' && !(req.user.role === 'user' || req.user.role === 'admin')) throw forbidden();
  if (direction === 'inbound' && !r.tracking_no) throw bad('This token was not handed over by courier');
  if (direction === 'return' && !r.return_tracking_no) throw bad('No return courier has been recorded for this token');
  await db.tx(async (t) => {
    await logEvent(r.id, 'shipment', stage, [location, note].filter(Boolean).join(' - ') || null, req.user.id, direction, t);
    await t.run('UPDATE requests SET updated_at=now() WHERE id=?', r.id);
  });
  res.json({ request: decorate(await load(req, r.id)) });
}));

module.exports = router;
