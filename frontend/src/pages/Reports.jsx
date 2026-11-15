import { useState } from 'react';
import { api, downloadPdf } from '../api';
import { useAuth } from '../auth';
import { Card, Field, PageHeader, Spinner, ErrorNote, useLoad, fmtDate } from '../components/ui';

export default function Reports() {
  const { user } = useAuth();
  const [period, setPeriod] = useState('weekly'), [date, setDate] = useState(new Date().toISOString().slice(0, 10)), [err, setErr] = useState(null);
  const d = useLoad(() => api.get(`/reports/summary?period=${period}&date=${date}`), [period, date]);
  const k = d.data?.kpis;
  return (
    <>
      <PageHeader title="Reports" sub={user.role === 'admin' ? 'Laboratory-wide activity.' : user.role === 'technician' ? 'Calibrations assigned to you.' : 'Your checks, tokens and certificates.'}>
        <button className="btn" onClick={() => downloadPdf(`/reports/pdf?period=${period}&date=${date}`, `calibration-${period}.pdf`).catch((e) => setErr(e.message))}>Download {period} PDF</button>
      </PageHeader>
      <Card>
        <div className="row">
          <Field label="Period"><select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="weekly">Weekly (Mon-Sun)</option><option value="monthly">Monthly</option></select></Field>
          <Field label="Any date in the period"><input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
        </div>
        <ErrorNote error={err || d.error} />
        {d.loading && !d.data ? <Spinner /> : k && <>
          <p className="muted">{fmtDate(d.data.from)} to {fmtDate(d.data.to)} - {d.data.scope}</p>
          <div className="grid g4" style={{ marginBottom: 14 }}>
            {[['Checks done', k.checks], ['Out of tolerance', k.outOfTolerance, k.outOfTolerance > 0], ['Tokens booked', k.tokensBooked], ['Tokens closed', k.tokensClosed], ['Certificates issued', k.certificates], ['Pass rate', k.passRate === null ? '-' : `${k.passRate}%`]].map(([l, v, a]) => <div key={l} className={`stat ${a ? 'alert' : ''}`}><b>{v}</b><span>{l}</span></div>)}
          </div>
          <p className="muted">The PDF also lists every token, certificate and check in the period.</p>
        </>}
      </Card>
    </>
  );
}
