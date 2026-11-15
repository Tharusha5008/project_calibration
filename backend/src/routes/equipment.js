const router = require('express').Router();
const db = require('../db');
const { authenticate, requireRole } = require('../lib/auth');
const { wrap, bad, notFound, equipmentRow, validatePoints } = require('../lib/util');

router.use(authenticate);

router.get('/', (req, res) => {
  const all = req.user.role === 'admin' && req.query.all === 'true';
  const rows = db.prepare(`SELECT * FROM equipment_types ${all ? '' : 'WHERE active=1'} ORDER BY name`).all();
  res.json({ equipment: rows.map(equipmentRow) });
});

router.get('/:id', wrap((req, res) => {
  const r = db.prepare('SELECT * FROM equipment_types WHERE id=?').get(req.params.id);
  if (!r) throw notFound('Equipment type not found');
  res.json({ equipment: equipmentRow(r) });
}));

function readBody(b, existing = {}) {
  const key = String(b.key ?? existing.key ?? b.name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const name = String(b.name ?? existing.name ?? '').trim();
  const unit = String(b.unit ?? existing.unit ?? '').trim();
  if (!key || !name || !unit) throw bad('Name and unit are required');
  const points = validatePoints(b.points ?? existing.points);
  const vals = points.map((p) => p.value);
  const rmin = Number(b.rangeMin ?? existing.range_min ?? Math.min(...vals));
  const rmax = Number(b.rangeMax ?? existing.range_max ?? Math.max(...vals));
  if (!Number.isFinite(rmin) || !Number.isFinite(rmax) || rmax <= rmin) throw bad('Range max must be greater than range min');
  if (vals.some((v) => v < rmin || v > rmax)) throw bad('Every standard point must lie inside the instrument range');
  const steps = Array.isArray(b.steps) ? b.steps.map(String).filter(Boolean) : (existing.steps || []);
  return { key, name, unit, points: points.map((p) => ({ ...p, label: `${p.value} ${unit}` })), rmin, rmax, steps,
    decimals: Number(b.decimals ?? existing.decimals ?? 2), standard: String(b.standard ?? existing.standard ?? 'Manufacturer specification'),
    reference_tool: b.referenceTool ?? existing.reference_tool ?? null, read_label: b.readLabel ?? existing.read_label ?? 'Displayed reading',
    model3d: b.model3d ?? existing.model3d ?? 'generic' };
}

router.post('/', requireRole('admin'), wrap((req, res) => {
  const e = readBody(req.body || {});
  if (db.prepare('SELECT 1 FROM equipment_types WHERE key=?').get(e.key)) throw bad('An equipment type with this name already exists');
  const info = db.prepare(`INSERT INTO equipment_types (key,name,unit,decimals,range_min,range_max,standard,reference_tool,read_label,steps,points,model3d)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(e.key, e.name, e.unit, e.decimals, e.rmin, e.rmax, e.standard, e.reference_tool, e.read_label,
    JSON.stringify(e.steps), JSON.stringify(e.points), e.model3d);
  res.status(201).json({ equipment: equipmentRow(db.prepare('SELECT * FROM equipment_types WHERE id=?').get(info.lastInsertRowid)) });
}));

router.put('/:id', requireRole('admin'), wrap((req, res) => {
  const cur = equipmentRow(db.prepare('SELECT * FROM equipment_types WHERE id=?').get(req.params.id));
  if (!cur) throw notFound('Equipment type not found');
  const e = readBody({ ...req.body, key: cur.key }, cur); // key is immutable (AI model + history reference it)
  const active = req.body.active === undefined ? cur.active : !!req.body.active;
  db.prepare(`UPDATE equipment_types SET name=?,unit=?,decimals=?,range_min=?,range_max=?,standard=?,reference_tool=?,read_label=?,steps=?,points=?,model3d=?,active=? WHERE id=?`)
    .run(e.name, e.unit, e.decimals, e.rmin, e.rmax, e.standard, e.reference_tool, e.read_label, JSON.stringify(e.steps), JSON.stringify(e.points), e.model3d, active ? 1 : 0, cur.id);
  res.json({ equipment: equipmentRow(db.prepare('SELECT * FROM equipment_types WHERE id=?').get(cur.id)) });
}));

// Hard delete when never used; otherwise retire (active=0) so history and certificates stay intact.
router.delete('/:id', requireRole('admin'), wrap((req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM equipment_types WHERE id=?').get(id)) throw notFound('Equipment type not found');
  const used = db.prepare('SELECT (SELECT COUNT(*) FROM checks WHERE equipment_type_id=@i)+(SELECT COUNT(*) FROM requests WHERE equipment_type_id=@i) c').get({ i: id }).c;
  if (used > 0) {
    db.prepare('UPDATE equipment_types SET active=0 WHERE id=?').run(id);
    return res.json({ message: 'Equipment has history, so it was retired (hidden from new checks) instead of deleted.', retired: true });
  }
  db.prepare('DELETE FROM equipment_types WHERE id=?').run(id);
  res.json({ message: 'Equipment deleted', retired: false });
}));

module.exports = router;
