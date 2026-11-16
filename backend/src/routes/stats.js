const router = require('express').Router();
const db = require('../db');
const ai = require('../lib/ai');
const { authenticate, requireRole } = require('../lib/auth');
const { wrap, bad } = require('../lib/util');
router.use(authenticate);
router.get('/stats', wrap(async (req, res) => {
    const { role, id } = req.user;
    const scope = role === 'user' ? 'WHERE user_id=@id' : role === 'technician' ? 'WHERE technician_id=@id' : '';
    const byStatus = scope ? (await db.all(`SELECT status, COUNT(*) n FROM requests ${scope} GROUP BY status`, { id })) : (await db.all('SELECT status, COUNT(*) n FROM requests GROUP BY status'));
    const out = { byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])) };
    if (role === 'admin') {
        out.pendingCertificates = (await db.get("SELECT COUNT(*) c FROM certificates WHERE approval_status='pending'")).c;
        out.openIssues = (await db.get("SELECT COUNT(*) c FROM messages WHERE kind='issue' AND status='open'")).c;
        out.users = (await db.all('SELECT role, COUNT(*) n FROM users WHERE is_active=1 GROUP BY role'));
        out.checksLast30 = (await db.get("SELECT COUNT(*) c FROM checks WHERE created_at >= (now() - interval '30 days')")).c;
        out.outLast30 = (await db.get("SELECT COUNT(*) c FROM checks WHERE verdict='out' AND created_at >= (now() - interval '30 days')")).c;
    }
    res.json(out);
}));
router.get('/ai/status', requireRole('admin', 'technician'), wrap(async (req, res) => res.json(await ai.status())));
// Retrain from the bundled dataset (default), or from rows posted in the request body.
router.post('/ai/train', requireRole('admin'), wrap(async (req, res) => {
    const rows = req.body?.rows;
    if (rows !== undefined && (!Array.isArray(rows) || rows.length < 200))
        throw bad('Provide at least 200 historical rows, or omit "rows" to retrain on the bundled dataset');
    const r = await ai.train(rows ? { rows } : {});
    res.status(r.ok ? 200 : 502).json(r.body);
}));
module.exports = router;
