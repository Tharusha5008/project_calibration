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
function load(req, id) {
  const r = db.prepare(`${LIST_SQL} WHERE r.id=?`).get(id);
  if (!r) throw notFound('Request not found');
  const { role, id: uid } = req.user;
  if (role === 'user' && r.user_id !== uid) throw forbidden();
  if (role === 'technician' && r.technician_id !== uid) throw forbidden('This token is not assigned to you');
  return r;
}

function move(r, to, actor, note) {
  if (!canMove(r.status, to)) throw bad(`Cannot move a token from "${label(r.status)}" to "${label(to)}"`);
  db.prepare("UPDATE requests SET status=?, updated_at=datetime('now') WHERE id=?").run(to, r.id);
  logEvent(r.id, 'status', label(to), note, actor.id);
}

router.get('/', (req, res) => {
  const where = [], p = [];
  if (req.user.role === 'user') { where.push('r.user_id=?'); p.push(req.user.id); }
  if (req.user.role === 'technician') { where.push('r.technician_id=?'); p.push(req.user.id); }
  if (req.query.status) { where.push('r.status=?'); p.push(req.query.status); }
  if (req.query.active === 'true') where.push("r.status NOT IN ('closed','cancelled')");
  if (req.query.q) { where.push('(r.token LIKE ? OR r.serial_no LIKE ? OR e.name LIKE ?)'); p.push(...Array(3).fill(`%${req.query.q}%`)); }
  const rows = db.prepare(`${LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.updated_at DESC LIMIT 300`).all(...p);
  res.json({ requests: rows.map(decorate) });
});

router.get('/:id', wrap((req, res) => {
  const r = load(req, req.params.id);
  const equipment = equipmentRow(db.prepare('SELECT * FROM equipment_types WHERE id=?').get(r.equipment_type_id));
  const check = r.check_id ? db.prepare('SELECT * FROM checks WHERE id=?').get(r.check_id) : null;
  const events = db.prepare(`SELECT ev.*, u.full_name AS actor_name, u.role AS actor_role FROM request_events ev
    LEFT JOIN users u ON u.id=ev.actor_id WHERE request_id=? ORDER BY ev.id`).all(r.id);
  const messages = db.prepare(`SELECT m.*, u.full_name AS author_name, u.role AS author_role FROM messages m
    JOIN users u ON u.id=m.author_id WHERE m.request_id=? ORDER BY m.id`).all(r.id);
  const certificate = db.prepare('SELECT id,number,result,approval_status,issued_at,valid_until,rejection_reason FROM certificates WHERE request_id=?').get(r.id) || null;
  res.json({ request: decorate(r), equipment, check: check ? { ...check, context: J(check.context, {}), ai: J(check.ai), suspicious: !!check.suspicious } : null,
    events, messages, certificate });
}));

// ---- 1. Customer books a token after a check shows the instrument is out of (or near) tolerance ----
router.post('/', requireRole('user'), wrap((req, res) => {
  const check = db.prepare('SELECT * FROM checks WHERE id=?').get(req.body?.checkId);
  if (!check || check.user_id !== req.user.id) throw notFound('Check not found');
  if (check.verdict === 'within') throw bad('This reading is comfortably within tolerance - no calibration is needed.');
  const dup = db.prepare("SELECT token FROM requests WHERE check_id=? AND status NOT IN ('cancelled')").get(check.id);
  if (dup) throw bad(`A token (${dup.token}) was already booked for this check.`);
  const open = db.prepare(`SELECT token FROM requests WHERE serial_no=? AND equipment_type_id=? AND status NOT IN ('closed','cancelled')`).get(check.serial_no, check.equipment_type_id);
  if (open) throw bad(`This instrument already has an open token (${open.token}).`);

  const token = newToken();
  const info = db.prepare('INSERT INTO requests (token,user_id,equipment_type_id,check_id,serial_no) VALUES (?,?,?,?,?)')
    .run(token, req.user.id, check.equipment_type_id, check.id, check.serial_no);
  logEvent(info.lastInsertRowid, 'status', label('booked'), `Booked after a check showed ${round(check.error_ratio * 100, 0)}% of tolerance used.`, req.user.id);
  res.status(201).json({ request: decorate(db.prepare(`${LIST_SQL} WHERE r.id=?`).get(info.lastInsertRowid)) });
}));

// ---- 2. Customer hands the instrument over: in person or via courier ----
router.post('/:id/handover', requireRole('user'), wrap((req, res) => {
  const r = load(req, req.params.id);
  const { method, courierName, trackingNo } = req.body || {};
  if (!['physical', 'courier'].includes(method)) throw bad('Choose physical drop-off or courier');
  if (method === 'courier' && (!courierName || !trackingNo)) throw bad('Enter the courier name and tracking number');
  move(r, 'handed_over', req.user, method === 'physical' ? 'Customer is delivering the instrument to the lab in person.' : `Sent via ${courierName} (${trackingNo}).`);
  db.prepare('UPDATE requests SET handover_method=?, courier_name=?, tracking_no=? WHERE id=?')
    .run(method, method === 'courier' ? String(courierName).trim() : null, method === 'courier' ? String(trackingNo).trim() : null, r.id);
  if (method === 'courier') logEvent(r.id, 'shipment', 'Dispatched by customer', `${courierName} - ${trackingNo}`, req.user.id, 'inbound');
  res.json({ request: decorate(load(req, r.id)) });
}));

// ---- 3. Admin confirms receipt, accepts the token and assigns a technician ----
router.post('/:id/accept', requireRole('admin'), wrap((req, res) => {
  const r = load(req, req.params.id);
  const tech = db.prepare("SELECT id,full_name FROM users WHERE id=? AND role='technician' AND is_active=1").get(req.body?.technicianId);
  if (!tech) throw bad('Choose an active technician');
  move(r, 'accepted', req.user, `Received and accepted. Assigned to ${tech.full_name}.`);
  db.prepare('UPDATE requests SET technician_id=? WHERE id=?').run(tech.id, r.id);
  logEvent(r.id, 'shipment', 'Received at the lab', req.body?.note || null, req.user.id, 'inbound');
  res.json({ request: decorate(load(req, r.id)) });
}));

router.post('/:id/reassign', requireRole('admin'), wrap((req, res) => {
  const r = load(req, req.params.id);
  if (!['accepted', 'in_calibration'].includes(r.status)) throw bad('A technician can only be changed while the token is accepted or in calibration');
  const tech = db.prepare("SELECT id,full_name FROM users WHERE id=? AND role='technician' AND is_active=1").get(req.body?.technicianId);
  if (!tech) throw bad('Choose an active technician');
  db.prepare("UPDATE requests SET technician_id=?, updated_at=datetime('now') WHERE id=?").run(tech.id, r.id);
  logEvent(r.id, 'note', 'Technician reassigned', `Now assigned to ${tech.full_name}.`, req.user.id);
  res.json({ request: decorate(load(req, r.id)) });
}));

// ---- 4. Technician starts work ----
router.post('/:id/start', requireRole('technician'), wrap((req, res) => {
  const r = load(req, req.params.id);
  move(r, 'in_calibration', req.user, 'Technician started calibration.');
  res.json({ request: decorate(load(req, r.id)) });
}));

// Technician updates the token: progress note and/or saves readings so far (draft)
router.post('/:id/update', requireRole('technician', 'admin'), wrap((req, res) => {
  const r = load(req, req.params.id);
  if (r.status !== 'in_calibration') throw bad('Updates can be added while the token is in calibration');
  const { note, readings } = req.body || {};
  if (readings !== undefined) {
    const eq = equipmentRow(db.prepare('SELECT * FROM equipment_types WHERE id=?').get(r.equipment_type_id));
    const clean = cleanReadings(readings, eq, false);
    db.prepare("UPDATE requests SET calibration_data=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(clean), r.id);
  }
  if (note && String(note).trim()) logEvent(r.id, 'note', 'Technician update', String(note).trim(), req.user.id);
  else if (readings !== undefined) logEvent(r.id, 'note', 'Readings saved', 'Draft calibration readings were saved.', req.user.id);
  res.json({ request: decorate(load(req, r.id)) });
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
router.post('/:id/issue-certificate', requireRole('technician'), wrap((req, res) => {
  const r = load(req, req.params.id);
  if (r.status !== 'in_calibration') throw bad('The token must be in calibration to issue a certificate');
  const eq = equipmentRow(db.prepare('SELECT * FROM equipment_types WHERE id=?').get(r.equipment_type_id));
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
  const number = newCertNumber();
  db.transaction(() => {
    db.prepare("UPDATE requests SET calibration_data=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(rows), r.id);
    db.prepare(`INSERT INTO certificates (number,request_id,technician_id,result,data,remarks,environment,valid_until) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(request_id) DO UPDATE SET result=excluded.result,data=excluded.data,remarks=excluded.remarks,environment=excluded.environment,
        approval_status='pending',rejection_reason=NULL,issued_at=datetime('now'),valid_until=excluded.valid_until`)
      .run(number, r.id, req.user.id, result, JSON.stringify(rows), req.body?.remarks || null, JSON.stringify(env), valid.toISOString().slice(0, 10));
    move(r, 'certificate_pending', req.user, `Calibration complete - result ${result}. Certificate sent for approval.`);
  })();
  res.json({ request: decorate(load(req, r.id)) });
}));

// ---- 6. Return to customer ----
router.post('/:id/return', requireRole('admin', 'technician'), wrap((req, res) => {
  const r = load(req, req.params.id);
  if (r.status !== 'certificate_approved') throw bad('The certificate must be approved before the instrument is returned');
  const { method, courierName, trackingNo } = req.body || {};
  if (!['pickup', 'courier'].includes(method)) throw bad('Choose customer pickup or courier return');
  if (method === 'courier' && (!courierName || !trackingNo)) throw bad('Enter the courier name and tracking number');
  if (method === 'pickup') {
    db.prepare("UPDATE requests SET return_method='pickup', updated_at=datetime('now') WHERE id=?").run(r.id);
    move(r, 'returning', req.user, 'Ready for collection at the lab.');
  } else {
    db.prepare("UPDATE requests SET return_method='courier', return_courier=?, return_tracking_no=?, updated_at=datetime('now') WHERE id=?").run(courierName, trackingNo, r.id);
    move(r, 'returning', req.user, `Returned via ${courierName} (${trackingNo}).`);
    logEvent(r.id, 'shipment', 'Dispatched to customer', `${courierName} - ${trackingNo}`, req.user.id, 'return');
  }
  res.json({ request: decorate(load(req, r.id)) });
}));

// Customer (or admin) confirms the instrument is back
router.post('/:id/confirm-received', requireRole('user', 'admin'), wrap((req, res) => {
  const r = load(req, req.params.id);
  if (!['returning', 'certificate_approved'].includes(r.status)) throw bad('Nothing to confirm yet');
  move(r, 'closed', req.user, req.user.role === 'user' ? 'Customer confirmed the instrument was received.' : 'Closed by admin.');
  res.json({ request: decorate(load(req, r.id)) });
}));

router.post('/:id/cancel', requireRole('user', 'admin'), wrap((req, res) => {
  const r = load(req, req.params.id);
  move(r, 'cancelled', req.user, req.body?.reason || 'Cancelled.');
  res.json({ request: decorate(load(req, r.id)) });
}));

// Courier tracking update (the delivery timeline). Customer logs inbound progress, lab logs return progress.
const STAGES = ['Dispatched', 'In transit', 'Out for delivery', 'Delivered', 'Delivery attempted', 'Delayed'];
router.post('/:id/shipment', wrap((req, res) => {
  const r = load(req, req.params.id);
  const { direction, stage, location, note } = req.body || {};
  if (!['inbound', 'return'].includes(direction)) throw bad('Direction must be inbound or return');
  if (!STAGES.includes(stage)) throw bad(`Stage must be one of: ${STAGES.join(', ')}`);
  if (direction === 'inbound' && !(req.user.role === 'user' || req.user.role === 'admin')) throw forbidden();
  if (direction === 'inbound' && !r.tracking_no) throw bad('This token was not handed over by courier');
  if (direction === 'return' && !r.return_tracking_no) throw bad('No return courier has been recorded for this token');
  logEvent(r.id, 'shipment', stage, [location, note].filter(Boolean).join(' - ') || null, req.user.id, direction);
  db.prepare("UPDATE requests SET updated_at=datetime('now') WHERE id=?").run(r.id);
  res.json({ request: decorate(load(req, r.id)) });
}));

module.exports = router;
