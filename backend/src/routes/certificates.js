const router = require('express').Router();
const db = require('../db');
const { authenticate, requireRole } = require('../lib/auth');
const { buildCertificatePdf } = require('../lib/pdf');
const { wrap, bad, notFound, forbidden, J, logEvent } = require('../lib/util');
const { label } = require('../lib/workflow');
router.use(authenticate);
const SQL = `SELECT c.*, r.token, r.serial_no, r.user_id, r.status AS request_status, r.id AS rid, e.name AS equipment_name, e.unit, e.decimals, e.standard, e.reference_tool,
    cu.full_name AS customer_name, cu.organisation, t.full_name AS technician_name, a.full_name AS approver_name
  FROM certificates c JOIN requests r ON r.id=c.request_id JOIN equipment_types e ON e.id=r.equipment_type_id
  JOIN users cu ON cu.id=r.user_id JOIN users t ON t.id=c.technician_id LEFT JOIN users a ON a.id=c.approved_by`;
function visible(req, c) {
    const { role, id } = req.user;
    if (role === 'admin')
        return true;
    if (role === 'technician')
        return c.technician_id === id;
    return c.user_id === id && c.approval_status === 'approved'; // customers only ever see approved certificates
}
const shape = (c) => ({ ...c, data: J(c.data, []), environment: J(c.environment, {}) });
router.get('/', wrap(async (req, res) => {
    const where = [], p = [];
    if (req.user.role === 'technician') {
        where.push('c.technician_id=?');
        p.push(req.user.id);
    }
    if (req.user.role === 'user') {
        where.push('r.user_id=?', "c.approval_status='approved'");
        p.push(req.user.id);
    }
    if (req.query.approval) {
        where.push('c.approval_status=?');
        p.push(req.query.approval);
    }
    const rows = (await db.all(`${SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.issued_at DESC LIMIT 300`, ...p));
    res.json({ certificates: rows.map(shape) });
}));
router.get('/:id', wrap(async (req, res) => {
    const c = (await db.get(`${SQL} WHERE c.id=?`, req.params.id));
    if (!c || !visible(req, c))
        throw notFound('Certificate not found');
    res.json({ certificate: shape(c) });
}));
router.post('/:id/approve', requireRole('admin'), wrap(async (req, res) => {
    const c = (await db.get(`${SQL} WHERE c.id=?`, req.params.id));
    if (!c)
        throw notFound('Certificate not found');
    if (c.approval_status !== 'pending')
        throw bad('This certificate has already been reviewed');
    await db.transaction(async () => {
        (await db.run("UPDATE certificates SET approval_status='approved', approved_by=?, approved_at=now() WHERE id=?", req.user.id, c.id));
        (await db.run("UPDATE requests SET status='certificate_approved', updated_at=now() WHERE id=?", c.rid));
        (await logEvent(c.rid, 'status', label('certificate_approved'), `Certificate ${c.number} approved. Result: ${c.result}.`, req.user.id));
    });
    res.json({ message: 'Certificate approved' });
}));
router.post('/:id/reject', requireRole('admin'), wrap(async (req, res) => {
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 5)
        throw bad('Give the technician a reason (at least a few words)');
    const c = (await db.get(`${SQL} WHERE c.id=?`, req.params.id));
    if (!c)
        throw notFound('Certificate not found');
    if (c.approval_status !== 'pending')
        throw bad('This certificate has already been reviewed');
    await db.transaction(async () => {
        (await db.run("UPDATE certificates SET approval_status='rejected', approved_by=?, approved_at=now(), rejection_reason=? WHERE id=?", req.user.id, reason, c.id));
        (await db.run("UPDATE requests SET status='in_calibration', updated_at=now() WHERE id=?", c.rid));
        (await logEvent(c.rid, 'status', 'Certificate rejected - rework needed', reason, req.user.id));
    });
    res.json({ message: 'Certificate sent back to the technician' });
}));
router.get('/:id/pdf', wrap(async (req, res) => {
    const c = (await db.get(`${SQL} WHERE c.id=?`, req.params.id));
    if (!c || !visible(req, c))
        throw notFound('Certificate not found');
    if (c.approval_status !== 'approved' && req.user.role !== 'admin')
        throw forbidden('Only approved certificates can be downloaded');
    const watermark = c.approval_status !== 'approved' ? 'DRAFT - NOT APPROVED' : null;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${c.number}.pdf"`);
    buildCertificatePdf(shape(c), watermark).pipe(res);
}));
module.exports = router;
