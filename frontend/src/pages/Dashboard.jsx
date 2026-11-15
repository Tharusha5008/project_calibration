import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, PageHeader, Spinner, StatusBadge, Empty, useLoad, useToast, fmtDateTime, STATUS_META } from '../components/ui';
import { useState } from 'react';

export default function Dashboard() {
  const { user } = useAuth();
  const stats = useLoad(() => api.get('/stats'));
  const reqs = useLoad(() => api.get('/requests?active=true'));
  const s = stats.data, by = s?.byStatus || {}, n = (k) => by[k] || 0;
  const tiles = user.role === 'admin' ? [['Handed over - to accept', n('handed_over'), n('handed_over') > 0], ['Certificates to approve', s?.pendingCertificates ?? 0, (s?.pendingCertificates ?? 0) > 0], ['In calibration', n('in_calibration') + n('accepted')], ['Open issues', s?.openIssues ?? 0, (s?.openIssues ?? 0) > 0]]
    : user.role === 'technician' ? [['To start', n('accepted')], ['In calibration', n('in_calibration')], ['Awaiting approval', n('certificate_pending')], ['Completed', n('certificate_approved') + n('returning') + n('closed')]]
      : [['Tokens to hand over', n('booked'), n('booked') > 0], ['With the lab', n('handed_over') + n('accepted') + n('in_calibration') + n('certificate_pending')], ['Ready / returning', n('certificate_approved') + n('returning')], ['Closed', n('closed')]];
  return (
    <>
      <PageHeader title={`Welcome, ${user.full_name.split(' ')[0]}`} sub={user.role === 'admin' ? 'What needs your attention today.' : user.role === 'technician' ? 'Your calibration work.' : 'Your instruments and calibration jobs.'}>
        {user.role === 'user' && <Link className="btn" to="/check">Check an instrument</Link>}
      </PageHeader>
      {stats.loading && !s ? <Spinner /> : <div className="grid g4" style={{ marginBottom: 16 }}>{tiles.map(([l, v, a]) => <div key={l} className={`stat ${a ? 'alert' : ''}`}><b>{v}</b><span>{l}</span></div>)}</div>}
      {user.role === 'admin' && s && <div className="note">In the last 30 days customers ran <b>{s.checksLast30}</b> checks and <b>{s.outLast30}</b> were out of tolerance.</div>}
      <Card title="Active tokens" aside={<Link to="/requests">View all</Link>}>
        {reqs.loading && !reqs.data ? <Spinner /> : reqs.data?.requests.length ? (
          <div className="tbl-wrap"><table><thead><tr><th>Token</th><th>Instrument</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>{reqs.data.requests.slice(0, 8).map((r) => <tr key={r.id}><td className="mono"><Link to={`/requests/${r.id}`}>{r.token}</Link></td><td>{r.equipment_name} <span className="muted">({r.serial_no})</span></td><td><StatusBadge status={r.status} /></td><td className="muted">{fmtDateTime(r.updated_at)}</td></tr>)}</tbody></table></div>
        ) : <Empty title="No active tokens">{user.role === 'user' ? 'Check an instrument to see whether it needs calibration.' : 'Nothing is waiting right now.'}</Empty>}
      </Card>
      {user.role === 'admin' && <AiPanel />}
    </>
  );
}

function AiPanel() {
  const toast = useToast();
  const st = useLoad(() => api.get('/ai/status'));
  const [busy, setBusy] = useState(false);
  const m = st.data;
  const retrain = async () => { setBusy(true); try { await api.post('/ai/train', {}); toast('Model retrained'); st.reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  return (
    <Card title="AI drift model" aside={<button className="btn small ghost" disabled={busy || m?.unavailable} onClick={retrain}>{busy ? 'Training...' : 'Retrain on dataset'}</button>}>
      {st.loading && !m ? <Spinner /> : m?.unavailable ? <div className="note warn">The AI service is not running. Calibration verdicts still work; the drift outlook is hidden until it starts (<code>python3 app.py</code> in /ai-service).</div> : !m?.trained ? <div className="note warn">Model not trained yet.</div> : (
        <>
          <div className="grid g4">
            <div className="stat"><b>{Math.round(m.mae_error_ratio * 100)}%</b><span>Typical miss, as a share of tolerance (baseline {Math.round(m.baseline_mae * 100)}%)</span></div>
            <div className="stat"><b>{m.auc_out_of_tolerance}</b><span>Out-of-tolerance ranking score (AUC)</span></div>
            <div className="stat"><b>{Math.round(m.interval_80_coverage * 100)}%</b><span>Readings inside the 80% range</span></div>
            <div className="stat"><b>{m.rows.toLocaleString()}</b><span>Training rows, {m.types.length} instrument types</span></div>
          </div>
          <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>Measured on a held-out 20%. {m.note}</p>
        </>)}
    </Card>
  );
}
