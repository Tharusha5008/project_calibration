const router = require('express').Router();
const db = require('../db');
const { authenticate } = require('../lib/auth');
const { buildReportPdf } = require('../lib/pdf');
const { wrap, bad, round } = require('../lib/util');
const { label } = require('../lib/workflow');
router.use(authenticate);
const iso = (d) => d.toISOString().slice(0, 10);
// Weekly = Monday..Sunday containing the date; monthly = calendar month containing the date.
function periodRange(period, dateStr) {
    const d = dateStr ? new Date(dateStr + 'T00:00:00Z') : new Date();
    if (Number.isNaN(d.getTime()))
        throw bad('Date must be YYYY-MM-DD');
    if (period === 'weekly') {
        const day = (d.getUTCDay() + 6) % 7;
        const from = new Date(d);
        from.setUTCDate(d.getUTCDate() - day);
        const to = new Date(from);
        to.setUTCDate(from.getUTCDate() + 6);
        return { from: iso(from), to: iso(to) };
    }
    if (period === 'monthly') {
        return { from: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))), to: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))) };
    }
    throw bad('Period must be weekly or monthly');
}
async function collect(user, period, date) {
    const { from, to } = periodRange(period, date);
    const user_ = user.role === 'user', tech = user.role === 'technician';
    const checkSql = `SELECT c.*, e.name AS equipment_name, e.unit FROM checks c JOIN equipment_types e ON e.id=c.equipment_type_id
    WHERE date(c.created_at) BETWEEN ? AND ? ${user_ ? 'AND c.user_id=?' : ''} ORDER BY c.created_at`;
    // Technicians do not take self-checks; they see checks that led to their tokens.
    const checks = tech
        ? (await db.all(`SELECT c.*, e.name AS equipment_name, e.unit FROM checks c JOIN equipment_types e ON e.id=c.equipment_type_id
        WHERE date(c.created_at) BETWEEN ? AND ? AND c.id IN (SELECT check_id FROM requests WHERE technician_id=?) ORDER BY c.created_at`, from, to, user.id)) : (await db.all(checkSql, ...(user_ ? [from, to, user.id] : [from, to])));
    const tokWhere = ['date(r.created_at) BETWEEN ? AND ?'], tp = [from, to];
    if (user_) {
        tokWhere.push('r.user_id=?');
        tp.push(user.id);
    }
    if (tech) {
        tokWhere.push('r.technician_id=?');
        tp.push(user.id);
    }
    const tokens = (await db.all(`SELECT r.*, e.name AS equipment_name, cu.full_name AS customer_name, t.full_name AS technician_name
    FROM requests r JOIN equipment_types e ON e.id=r.equipment_type_id JOIN users cu ON cu.id=r.user_id LEFT JOIN users t ON t.id=r.technician_id
    WHERE ${tokWhere.join(' AND ')} ORDER BY r.created_at`, ...tp)).map((r) => ({ ...r, status_label: label(r.status) }));
    const cWhere = ['date(c.issued_at) BETWEEN ? AND ?'], cp = [from, to];
    if (user_) {
        cWhere.push('r.user_id=?', "c.approval_status='approved'");
        cp.push(user.id);
    }
    if (tech) {
        cWhere.push('c.technician_id=?');
        cp.push(user.id);
    }
    const certificates = (await db.all(`SELECT c.number,c.result,c.approval_status,c.issued_at,r.token,e.name AS equipment_name
    FROM certificates c JOIN requests r ON r.id=c.request_id JOIN equipment_types e ON e.id=r.equipment_type_id
    WHERE ${cWhere.join(' AND ')} ORDER BY c.issued_at`, ...cp));
    const closed = tokens.filter((t) => t.status === 'closed').length;
    const decided = certificates.filter((c) => c.approval_status === 'approved');
    const kpis = {
        checks: checks.length, outOfTolerance: checks.filter((c) => c.verdict === 'out').length, tokensBooked: tokens.length,
        tokensClosed: closed, certificates: certificates.length,
        passRate: decided.length ? round(decided.filter((c) => c.result !== 'FAIL').length / decided.length * 100, 0) : null,
    };
    const scope = user_ ? `My activity (${user.full_name})` : tech ? `Technician: ${user.full_name}` : 'All laboratory activity';
    const title = `${period === 'weekly' ? 'Weekly' : 'Monthly'} Calibration Report`;
    return { title, period, from, to, scope, kpis, checks, tokens, certificates, generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' };
}
router.get('/summary', wrap(async (req, res) => res.json((await collect(req.user, req.query.period || 'weekly', req.query.date)))));
router.get('/pdf', wrap(async (req, res) => {
    const rep = (await collect(req.user, req.query.period || 'weekly', req.query.date));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="calibration-${rep.period}-${rep.from}.pdf"`);
    buildReportPdf(rep).pipe(res);
}));
module.exports = router;
