const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');

let secret = process.env.JWT_SECRET;
if (!secret || secret.startsWith('replace-with')) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: set a strong JWT_SECRET in the environment before running in production.');
    process.exit(1);
  }
  secret = crypto.randomBytes(32).toString('hex');
  console.warn('[auth] JWT_SECRET not set - using an ephemeral secret (logins reset on restart).');
}

const sign = (u) => jwt.sign({ id: u.id, role: u.role }, secret, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });

function authenticate(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Sign in required' });
  try {
    const p = jwt.verify(token, secret);
    const user = db.prepare('SELECT id,full_name,email,role,is_active FROM users WHERE id=?').get(p.id);
    if (!user || !user.is_active) return res.status(401).json({ message: 'Account disabled or not found' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: 'Session expired - sign in again' });
  }
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ message: 'You do not have permission for this action' });

module.exports = { sign, authenticate, requireRole };
