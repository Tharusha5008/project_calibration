const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate, requireRole } = require('../lib/auth');
const { wrap, bad, notFound } = require('../lib/util');

router.use(authenticate);
const COLS = 'id,full_name,email,role,organisation,phone,is_active,created_at';
const ROLES = ['admin', 'technician', 'user'];

// Technicians list is needed by admin when assigning a token
router.get('/technicians', requireRole('admin'), (req, res) =>
  res.json({ technicians: db.prepare("SELECT id,full_name,email FROM users WHERE role='technician' AND is_active=1 ORDER BY full_name").all() }));

router.use(requireRole('admin'));

router.get('/', (req, res) => {
  const { role, q } = req.query;
  const where = [], p = [];
  if (role) { where.push('role=?'); p.push(role); }
  if (q) { where.push('(full_name LIKE ? OR email LIKE ?)'); p.push(`%${q}%`, `%${q}%`); }
  res.json({ users: db.prepare(`SELECT ${COLS} FROM users ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`).all(...p) });
});

router.post('/', wrap((req, res) => {
  const { fullName, email, password, role, organisation, phone } = req.body || {};
  if (!fullName) throw bad('Name is required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) throw bad('Enter a valid email address');
  if (!ROLES.includes(role)) throw bad('Role must be admin, technician or user');
  if (!password || password.length < 8) throw bad('Password must be at least 8 characters');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw bad('Email already in use');
  const info = db.prepare('INSERT INTO users (full_name,email,password_hash,role,organisation,phone) VALUES (?,?,?,?,?,?)')
    .run(fullName, email, bcrypt.hashSync(password, 10), role, organisation || null, phone || null);
  res.status(201).json({ user: db.prepare(`SELECT ${COLS} FROM users WHERE id=?`).get(info.lastInsertRowid) });
}));

router.patch('/:id', wrap((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) throw notFound('User not found');
  const { fullName, role, isActive, password, organisation, phone } = req.body || {};
  if (u.id === req.user.id && (isActive === false || (role && role !== 'admin'))) throw bad('You cannot disable or demote your own account');
  if (role && !ROLES.includes(role)) throw bad('Invalid role');
  if (password && password.length < 8) throw bad('Password must be at least 8 characters');
  db.prepare(`UPDATE users SET full_name=?, role=?, is_active=?, organisation=?, phone=?, password_hash=? WHERE id=?`).run(
    fullName ?? u.full_name, role ?? u.role, isActive === undefined ? u.is_active : (isActive ? 1 : 0),
    organisation ?? u.organisation, phone ?? u.phone, password ? bcrypt.hashSync(password, 10) : u.password_hash, u.id);
  res.json({ user: db.prepare(`SELECT ${COLS} FROM users WHERE id=?`).get(u.id) });
}));

router.delete('/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw bad('You cannot delete your own account');
  const used = db.prepare(`SELECT (SELECT COUNT(*) FROM requests WHERE user_id=@i OR technician_id=@i) +
    (SELECT COUNT(*) FROM checks WHERE user_id=@i) + (SELECT COUNT(*) FROM certificates WHERE technician_id=@i) c`).get({ i: id }).c;
  if (used > 0) return res.status(409).json({ message: 'This user has calibration history, so it cannot be deleted. Disable the account instead.' });
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  res.json({ message: 'User deleted' });
}));

module.exports = router;
