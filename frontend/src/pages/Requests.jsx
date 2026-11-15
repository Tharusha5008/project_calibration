import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, PageHeader, StatusBadge, Empty, Spinner, ErrorNote, useLoad, fmtDateTime, ResultBadge, STATUS_META } from '../components/ui';

export default function Requests() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [status, setStatus] = useState(''), [q, setQ] = useState('');
  const d = useLoad(() => api.get(`/requests?${new URLSearchParams({ ...(status && { status }), ...(q && { q }) })}`), [status, q]);
  const rows = d.data?.requests || [];
  const title = user.role === 'user' ? 'My calibration tokens' : user.role === 'technician' ? 'My work queue' : 'Calibration tokens';
  return (
    <>
      <PageHeader title={title} sub={user.role === 'admin' ? 'Accept handed-over instruments, assign technicians and follow every job.' : user.role === 'technician' ? 'Instruments assigned to you.' : 'Track each instrument from hand-over to certificate.'} />
      <Card>
        <div className="row" style={{ marginBottom: 12 }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status"><option value="">All statuses</option>{Object.entries(STATUS_META).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
          <input placeholder="Search token, serial or instrument" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ErrorNote error={d.error} />
        {d.loading && !d.data ? <Spinner /> : rows.length === 0 ? <Empty title="No tokens">{user.role === 'user' ? 'Run a check on an instrument; if it is out of tolerance you can book a token.' : 'Nothing matches this view.'}</Empty> : (
          <div className="tbl-wrap"><table>
            <thead><tr><th>Token</th><th>Instrument</th><th>Serial</th>{user.role !== 'user' && <th>Customer</th>}<th>Technician</th><th>Status</th><th>Certificate</th><th>Updated</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="click" onClick={() => nav(`/requests/${r.id}`)}>
                <td className="mono">{r.token}</td><td>{r.equipment_name}</td><td>{r.serial_no}</td>{user.role !== 'user' && <td>{r.customer_name}</td>}
                <td>{r.technician_name || <span className="muted">-</span>}</td><td><StatusBadge status={r.status} /></td>
                <td>{r.certificate_result ? <ResultBadge result={r.certificate_result} /> : <span className="muted">-</span>}</td><td className="muted">{fmtDateTime(r.updated_at)}</td></tr>))}</tbody>
          </table></div>)}
      </Card>
    </>
  );
}
