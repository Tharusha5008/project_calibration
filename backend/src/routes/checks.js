const router = require('express').Router();
const db = require('../db');
const ai = require('../lib/ai');
const { authenticate } = require('../lib/auth');
const { wrap, bad, notFound, forbidden, J, round, equipmentRow, verdictFor } = require('../lib/util');

router.use(authenticate);

const DEFAULTS = { ageMonths: 24, daysSinceCal: 180, usageHours: 400, ambientTempC: 22, humidityPct: 50, previousResult: 'pass' };

function num(v, name, min, max) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${name} must be a number between ${min} and ${max}`);
  return n;
}

function shape(c) {
  return { ...c, suspicious: !!c.suspicious, context: J(c.context, {}), ai: J(c.ai) };
}

// POST /api/checks  - exact verdict from the real reading + AI drift-risk as a secondary signal.
router.post('/', wrap(async (req, res) => {
  const b = req.body || {};
  const eq = equipmentRow(await db.get('SELECT * FROM equipment_types WHERE id=? AND active=1', b.equipmentTypeId));
  if (!eq) throw notFound('Equipment type not found');
  const serial = String(b.serialNo || '').trim();
  if (!serial) throw bad('Enter the instrument serial number or asset tag (needed for traceability)');
  if (serial.length > 60) throw bad('Serial number is too long');

  const idx = Number(b.pointIndex);
  const point = eq.points[idx];
  if (!Number.isInteger(idx) || !point) throw bad('Select one of the standard reference points');

  const measured = Number(b.measuredValue);
  if (b.measuredValue === '' || b.measuredValue === null || !Number.isFinite(measured)) throw bad('Enter the value shown by the instrument as a number');

  // Guard against wrong units / misplaced decimals: reject physically impossible readings outright.
  const span = eq.range_max - eq.range_min;
  if (measured < eq.range_min - 0.5 * span || measured > eq.range_max + 0.5 * span) {
    throw bad(`${measured} ${eq.unit} is far outside this instrument's range (${eq.range_min}-${eq.range_max} ${eq.unit}). Check the unit and decimal point.`);
  }

  // Exact result (source of truth). error_ratio is a fraction: 1.00 == exactly at the tolerance limit.
  const error = measured - point.value;
  const ratio = Math.abs(error) / point.mpe;
  const verdict = verdictFor(ratio);

  // Context for the AI: use real history for this serial if we have it, otherwise the user's input, otherwise defaults.
  const last = await db.get(`SELECT c.result, c.issued_at FROM certificates c JOIN requests r ON r.id=c.request_id
    WHERE r.serial_no=? AND r.equipment_type_id=? AND c.approval_status='approved' ORDER BY c.issued_at DESC LIMIT 1`, serial, eq.id);
  const assumed = [];
  const pick = (key, given, fromHistory) => {
    if (given !== undefined) return given;
    if (fromHistory !== undefined) return fromHistory;
    assumed.push(key);
    return DEFAULTS[key];
  };
  const histDays = last ? Math.max(0, Math.floor((Date.now() - new Date(last.issued_at).getTime()) / 864e5)) : undefined;
  const prevResult = ['pass', 'adjusted', 'fail'].includes(b.previousResult) ? b.previousResult : undefined;
  const ctx = {
    ageMonths: pick('ageMonths', num(b.ageMonths, 'Instrument age', 0, 600)),
    daysSinceCal: pick('daysSinceCal', num(b.daysSinceCal, 'Days since last calibration', 0, 5000), histDays),
    usageHours: pick('usageHours', num(b.usageHours, 'Usage hours', 0, 100000)),
    ambientTempC: pick('ambientTempC', num(b.ambientTempC, 'Ambient temperature', -20, 60)),
    humidityPct: pick('humidityPct', num(b.humidityPct, 'Humidity', 0, 100)),
    previousResult: pick('previousResult', prevResult, last ? last.result.toLowerCase() : undefined),
  };

  const aiRes = await ai.predict({ equipmentKey: eq.key, pointValue: point.value, ...ctx, observedErrorRatio: ratio });
  const suspicious = ratio > 10 || aiRes.consistency === 'implausible';

  const newId = await db.insert(`INSERT INTO checks (user_id,equipment_type_id,serial_no,point_index,nominal_value,measured_value,mpe,error,error_ratio,verdict,suspicious,context,ai)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, req.user.id, eq.id, serial, idx, point.value, measured, point.mpe, round(error, 6), round(ratio, 4),
    verdict, suspicious ? 1 : 0, JSON.stringify({ ...ctx, assumed }), aiRes.supported ? JSON.stringify(aiRes) : null);

  const check = shape(await db.get('SELECT * FROM checks WHERE id=?', newId));
  res.status(201).json({ check: { ...check, error_pct_of_tolerance: round(ratio * 100, 1), margin_pct: round((1 - ratio) * 100, 1) },
    ai: aiRes, equipment: { id: eq.id, name: eq.name, unit: eq.unit } });
}));

router.get('/', wrap(async (req, res) => {
  const where = [], p = [];
  if (req.user.role === 'user') { where.push('c.user_id=?'); p.push(req.user.id); }
  if (req.query.equipmentTypeId) { where.push('c.equipment_type_id=?'); p.push(req.query.equipmentTypeId); }
  const rows = await db.all(`SELECT c.*, e.name AS equipment_name, e.unit, u.full_name AS user_name,
      (SELECT token FROM requests r WHERE r.check_id=c.id LIMIT 1) AS token
    FROM checks c JOIN equipment_types e ON e.id=c.equipment_type_id JOIN users u ON u.id=c.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.created_at DESC LIMIT 200`, ...p);
  res.json({ checks: rows.map((r) => ({ ...shape(r), error_pct_of_tolerance: round(r.error_ratio * 100, 1) })) });
}));

router.get('/:id', wrap(async (req, res) => {
  const c = await db.get('SELECT c.*, e.name AS equipment_name, e.unit FROM checks c JOIN equipment_types e ON e.id=c.equipment_type_id WHERE c.id=?', req.params.id);
  if (!c) throw notFound('Check not found');
  if (req.user.role === 'user' && c.user_id !== req.user.id) throw forbidden();
  res.json({ check: { ...shape(c), error_pct_of_tolerance: round(c.error_ratio * 100, 1) } });
}));

module.exports = router;
