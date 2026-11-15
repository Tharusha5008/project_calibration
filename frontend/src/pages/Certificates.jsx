import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadPdf } from '../api';
import { useAuth } from '../auth';
import { Card, PageHeader, ResultBadge, ApprovalBadge, Empty, Spinner, ErrorNote, Field, Modal, useLoad, useToast, fmtDate } from '../components/ui';

export default function Certificates() {
  const { user } = useAuth();
  const toast = useToast();
  const [filter, setFilter] = useState(''), [err, setErr] = useState(null), [rej, setRej] = useState(null), [reason, setReason] = useState('');
  const d = useLoad(() => api.get(`/certificates${filter ? `?approval=${filter}` : ''}`), [filter]);
  const rows = d.data?.certificates || [];
  const doAct = async (fn, msg) => { setErr(null); try { await fn(); toast(msg); d.reload(); } catch (e) { setErr(e.message); } };
  return (
    <>
      <PageHeader title="Certificates" sub={user.role === 'admin' ? 'Review certificates issued by technicians. Customers only see approved ones.' : user.role === 'user' ? 'Download certificates for your calibrated instruments.' : 'Certificates you have issued.'} />
      <Card>
        {user.role !== 'user' && <div className="row" style={{ marginBottom: 12 }}><select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter"><option value="">All</option><option value="pending">Pending approval</option><option value="approved">Approved</option><option value="rejected">Sent back</option></select></div>}
        <ErrorNote error={err || d.error} />
        {d.loading && !d.data ? <Spinner /> : rows.length === 0 ? <Empty title="No certificates yet">They appear here once a calibration is finished and approved.</Empty> : (
          <div className="tbl-wrap"><table>
            <thead><tr><th>Number</th><th>Instrument</th><th>Serial</th>{user.role !== 'user' && <th>Customer</th>}<th>Result</th><th>Status</th><th>Issued</th><th>Valid until</th><th /></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id}><td className="mono"><Link to={`/requests/${c.rid}`}>{c.number}</Link></td><td>{c.equipment_name}</td><td>{c.serial_no}</td>{user.role !== 'user' && <td>{c.customer_name}</td>}
                <td><ResultBadge result={c.result} /></td><td><ApprovalBadge s={c.approval_status} /></td><td>{fmtDate(c.issued_at)}</td><td>{fmtDate(c.valid_until)}</td>
                <td><div className="row" style={{ flexWrap: 'nowrap' }}>
                  {(c.approval_status === 'approved' || user.role === 'admin') && <button className="btn small ghost" onClick={() => downloadPdf(`/certificates/${c.id}/pdf`, `${c.number}.pdf`).catch((e) => setErr(e.message))}>PDF</button>}
                  {user.role === 'admin' && c.approval_status === 'pending' && <><button className="btn small" onClick={() => doAct(() => api.post(`/certificates/${c.id}/approve`), 'Certificate approved')}>Approve</button><button className="btn small danger" onClick={() => { setRej(c); setReason(''); }}>Send back</button></>}
                </div></td></tr>))}</tbody>
          </table></div>)}
      </Card>
      {rej && <Modal title={`Send ${rej.number} back`} onClose={() => setRej(null)}>
        <Field label="What does the technician need to fix?"><textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <button className="btn danger" onClick={() => doAct(() => api.post(`/certificates/${rej.id}/reject`, { reason }), 'Sent back to the technician').then(() => setRej(null))}>Send back</button>
      </Modal>}
    </>
  );
}
