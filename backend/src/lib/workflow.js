// Calibration token life-cycle. Each transition lists who may perform it.
const STATUS = {
  booked:               { label: 'Token booked',              next: ['handed_over', 'cancelled'] },
  handed_over:          { label: 'Handed over / in transit',  next: ['accepted', 'cancelled'] },
  accepted:             { label: 'Accepted by admin',         next: ['in_calibration'] },
  in_calibration:       { label: 'Calibration in progress',   next: ['certificate_pending'] },
  certificate_pending:  { label: 'Certificate awaiting approval', next: ['certificate_approved', 'in_calibration'] },
  certificate_approved: { label: 'Certificate approved',      next: ['returning', 'closed'] },
  returning:            { label: 'Returning to customer',     next: ['closed'] },
  closed:               { label: 'Closed',                    next: [] },
  cancelled:            { label: 'Cancelled',                 next: [] },
};
const canMove = (from, to) => (STATUS[from]?.next || []).includes(to);
const label = (s) => STATUS[s]?.label || s;
module.exports = { STATUS, canMove, label };
