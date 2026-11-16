const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate, requireRole } = require('../lib/auth');
const { wrap, bad, notFound } = require('../lib/util');
router.use(authenticate);
const COLS = 'id,full_name,email,role,organisation,phone,is_active,created_at';
const ROLES = ['admin', 'technician', 'user'];
// Technicians list is needed by admin when assigning a token
router.get('/technicians', requireRole('admin'), wrap(async (req, res) => res.json({ technicians: (await db.all("SELECT id,full_name,email FROM users WHERE role='technician' AND is_active=1 ORDER BY full_name")) })));
router.use(requireRole('admin'));
router.get('/', wrap(async (req, res) => {
    const { role, q } = req.query;
    const where = [], p = [];
    if (role) {
        where.push('role=?');
        p.push(role);
    }
    if (q) {
        where.push('(full_name ILIKE ? OR email ILIKE ?)');
        p.push(`%${q}%`, `%${q}%`);
    }
    res.json({ users: (await db.all(`SELECT ${COLS} FROM users ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`, ...p)) });
}));
router.post('/', wrap(async (req, res) => {
    const { fullName, email, password, role, organisation, phone } = req.body || {};
    if (!fullName)
        throw bad('Name is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || ''))
        throw bad('Enter a valid email address');
    if (!ROLES.includes(role))
        throw bad('Role must be admin, technician or user');
    if (!password || password.length < 8)
        throw bad('Password must be at least 8 characters');
    if ((await db.get('SELECT 1 FROM users WHERE lower(email)=lower(?)', email)))
        throw bad('Email already in use');
    const info = (await db.run('INSERT INTO users (full_name,email,password_hash,role,organisation,phone) VALUES (?,?,?,?,?,?)', fullName, email, bcrypt.hashSync(password, 10), role, organisation || null, phone || null));
    res.status(201).json({ user: (await db.get(`SELECT ${COLS} FROM users WHERE id=?`, info.lastInsertRowid)) });
}));
router.patch('/:id', wrap(async (req, res) => {
    const u = (await db.get('SELECT * FROM users WHERE id=?', req.params.id));
    if (!u)
        throw notFound('User not found');
    const { fullName, role, isActive, password, organisation, phone } = req.body || {};
    if (u.id === req.user.id && (isActive === false || (role && role !== 'admin')))
        throw bad('You cannot disable or demote your own account');
    if (role && !ROLES.includes(role))
        throw bad('Invalid role');
    if (password && password.length < 8)
        throw bad('Password must be at least 8 characters');
    (await db.run(`UPDATE users SET full_name=?, role=?, is_active=?, organisation=?, phone=?, password_hash=? WHERE id=?`, fullName ?? u.full_name, role ?? u.role, isActive === undefined ? u.is_active : (isActive ? 1 : 0), organisation ?? u.organisation, phone ?? u.phone, password ? bcrypt.hashSync(password, 10) : u.password_hash, u.id));
    res.json({ user: (await db.get(`SELECT ${COLS} FROM users WHERE id=?`, u.id)) });
}));
router.delete('/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id)
        throw bad('You cannot delete your own account');
    const used = (await db.get(`SELECT (SELECT COUNT(*) FROM requests WHERE user_id=@i OR technician_id=@i) +
    (SELECT COUNT(*) FROM checks WHERE user_id=@i) + (SELECT COUNT(*) FROM certificates WHERE technician_id=@i) c`, { i: id })).c;
    if (used > 0)
        return res.status(409).json({ message: 'This user has calibration history, so it cannot be deleted. Disable the account instead.' });
    (await db.run('DELETE FROM users WHERE id=?', id));
    res.json({ message: 'User deleted' });
}));
module.exports = router;
