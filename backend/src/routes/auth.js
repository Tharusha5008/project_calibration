const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { sign, authenticate } = require('../lib/auth');
const { wrap, bad } = require('../lib/util');

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many attempts - try again in a few minutes' } });
const emailOk = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const pub = (u) => ({ id: u.id, full_name: u.full_name, email: u.email, role: u.role, organisation: u.organisation });

router.post('/login', limiter, wrap((req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').trim());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) return res.status(401).json({ message: 'Email or password is incorrect' });
  if (!u.is_active) return res.status(403).json({ message: 'This account has been disabled. Contact the lab administrator.' });
  res.json({ token: sign(u), user: pub(u) });
}));

// Public self-registration always creates a customer ('user'). Technicians/admins are created by an admin.
router.post('/register', limiter, wrap((req, res) => {
  const { fullName, email, password, organisation, phone } = req.body || {};
  if (!fullName || String(fullName).trim().length < 2) throw bad('Enter your full name');
  if (!emailOk(email)) throw bad('Enter a valid email address');
  if (!password || String(password).length < 8) throw bad('Password must be at least 8 characters');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw bad('An account with this email already exists');
  const info = db.prepare('INSERT INTO users (full_name,email,password_hash,role,organisation,phone) VALUES (?,?,?,?,?,?)')
    .run(String(fullName).trim(), String(email).trim(), bcrypt.hashSync(password, 10), 'user', organisation || null, phone || null);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  res.status(201).json({ token: sign(u), user: pub(u) });
}));

router.get('/me', authenticate, (req, res) => res.json({ user: pub(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) }));

router.post('/change-password', authenticate, wrap((req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(String(currentPassword || ''), u.password_hash)) throw bad('Current password is incorrect');
  if (!newPassword || String(newPassword).length < 8) throw bad('New password must be at least 8 characters');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(newPassword, 10), u.id);
  res.json({ message: 'Password updated' });
}));

module.exports = router;
