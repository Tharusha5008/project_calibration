const router = require('express').Router();
const db = require('../db');
const { authenticate, requireRole } = require('../lib/auth');
const { wrap, bad, notFound, forbidden } = require('../lib/util');
router.use(authenticate);
const SQL = `SELECT m.*, u.full_name AS author_name, u.role AS author_role, r.token
  FROM messages m JOIN users u ON u.id=m.author_id LEFT JOIN requests r ON r.id=m.request_id`;
async function canSee(req, m) {
    if (req.user.role === 'admin')
        return true;
    if (m.author_id === req.user.id)
        return true;
    if (!m.request_id)
        return false;
    const r = (await db.get('SELECT user_id, technician_id FROM requests WHERE id=?', m.request_id));
    return !!r && (r.user_id === req.user.id || r.technician_id === req.user.id);
}
router.get('/', wrap(async (req, res) => {
    const where = ["m.kind!='reply'"], p = [];
    if (req.user.role !== 'admin') {
        where.push(`(m.author_id=? OR m.request_id IN (SELECT id FROM requests WHERE user_id=? OR technician_id=?))`);
        p.push(req.user.id, req.user.id, req.user.id);
    }
    if (req.query.status) {
        where.push('m.status=?');
        p.push(req.query.status);
    }
    const rows = (await db.all(`${SQL} WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT 200`, ...p));
    const replies = rows.length ? (await db.all(`${SQL} WHERE m.parent_id IN (${rows.map(() => '?').join(',')}) ORDER BY m.id`, ...rows.map((r) => r.id))) : [];
    res.json({ messages: rows.map((m) => ({ ...m, replies: replies.filter((x) => x.parent_id === m.id) })) });
}));
// Feedback (technician/user/admin) or an issue (customer) - optionally attached to a token.
router.post('/', wrap(async (req, res) => {
    const { requestId, kind, subject, body, rating } = req.body || {};
    if (!['feedback', 'issue'].includes(kind))
        throw bad('Kind must be feedback or issue');
    if (kind === 'issue' && req.user.role === 'technician')
        throw bad('Technicians send feedback; customers report issues');
    if (!body || String(body).trim().length < 3)
        throw bad('Write a short message');
    if (rating !== undefined && rating !== null && !(Number.isInteger(+rating) && +rating >= 1 && +rating <= 5))
        throw bad('Rating must be 1-5');
    if (requestId) {
        const r = (await db.get('SELECT user_id, technician_id FROM requests WHERE id=?', requestId));
        if (!r)
            throw notFound('Token not found');
        const ok = req.user.role === 'admin' || r.user_id === req.user.id || r.technician_id === req.user.id;
        if (!ok)
            throw forbidden();
    }
    const info = (await db.run('INSERT INTO messages (request_id,author_id,kind,subject,body,rating) VALUES (?,?,?,?,?,?)', requestId || null, req.user.id, kind, subject ? String(subject).slice(0, 120) : null, String(body).trim(), rating || null));
    res.status(201).json({ message: (await db.get(`${SQL} WHERE m.id=?`, info.lastInsertRowid)) });
}));
router.post('/:id/reply', wrap(async (req, res) => {
    const m = (await db.get('SELECT * FROM messages WHERE id=?', req.params.id));
    if (!m || !(await canSee(req, m)))
        throw notFound('Message not found');
    if (!req.body?.body || String(req.body.body).trim().length < 2)
        throw bad('Write a reply');
    const info = (await db.run("INSERT INTO messages (request_id,author_id,kind,parent_id,body) VALUES (?,?,'reply',?,?)", m.request_id, req.user.id, m.parent_id || m.id, String(req.body.body).trim()));
    res.status(201).json({ message: (await db.get(`${SQL} WHERE m.id=?`, info.lastInsertRowid)) });
}));
router.post('/:id/resolve', requireRole('admin'), wrap(async (req, res) => {
    const resolved = req.body?.resolved !== false;
    (await db.run('UPDATE messages SET status=? WHERE id=?', resolved ? 'resolved' : 'open', req.params.id));
    res.json({ message: resolved ? 'Marked resolved' : 'Reopened' });
}));
module.exports = router;
