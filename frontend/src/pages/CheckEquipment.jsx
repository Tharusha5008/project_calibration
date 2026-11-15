import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import Viewer3D from '../components/Viewer3D';
import { Card, Field, PageHeader, VerdictBadge, ErrorNote, Spinner, Empty, useLoad, useToast, fmtDateTime, num, Badge } from '../components/ui';

const RISK = { low: ['Low drift risk', 'green'], medium: ['Medium drift risk', 'amber'], high: ['High drift risk', 'red'] };

export default function CheckEquipment() {
  const { user } = useAuth();
  const nav = useNavigate(), toast = useToast();
  const eqs = useLoad(() => api.get('/equipment'));
  const [eqId, setEqId] = useState(null), [idx, setIdx] = useState(0);
  const [form, setForm] = useState({ serialNo: '', measuredValue: '', ageMonths: '', daysSinceCal: '', usageHours: '', ambientTempC: '', humidityPct: '', previousResult: '' });
  const [more, setMore] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState(null), [res, setRes] = useState(null);
  const history = useLoad(() => (eqId ? api.get(`/checks?equipmentTypeId=${eqId}`) : Promise.resolve({ checks: [] })), [eqId]);

  const list = eqs.data?.equipment || [];
  useEffect(() => { if (list.length && !eqId) setEqId(list[0].id); }, [list, eqId]);
  const eq = useMemo(() => list.find((e) => e.id === eqId), [list, eqId]);
  const point = eq?.points[idx];
  useEffect(() => { setIdx(0); setRes(null); setErr(null); setForm((f) => ({ ...f, measuredValue: '' })); }, [eqId]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null); setRes(null);
    try {
      const body = { equipmentTypeId: eq.id, pointIndex: idx, ...form };
      Object.keys(body).forEach((k) => body[k] === '' && delete body[k]);
      const r = await api.post('/checks', body); setRes(r); history.reload();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const book = async () => {
    try { const r = await api.post('/requests', { checkId: res.check.id }); toast(`Token ${r.request.token} booked`); nav(`/requests/${r.request.id}`); } catch (x) { setErr(x.message); }
  };

  if (eqs.loading) return <Spinner />;
  if (!eq) return <Empty title="No equipment types yet">An administrator needs to add equipment to the catalogue first.</Empty>;
  const c = res?.check, ai = res?.ai;
  const pctUsed = c ? Math.min(c.error_ratio, 1.5) / 1.5 * 100 : 0;
  const tone = c ? { within: 'var(--green)', warning: 'var(--amber)', out: 'var(--red)' }[c.verdict] : 'var(--teal)';

  return (
    <>
      <PageHeader title="Check equipment" sub="Pick the instrument, apply the standard reference shown in 3D, then enter what your instrument reads." />
      <Card>
        <div className="row">
          <Field label="Instrument type"><select value={eqId || ''} onChange={(e) => setEqId(Number(e.target.value))}>{list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <Field label="Serial number / asset tag" hint="Used on your token and certificate"><input value={form.serialNo} onChange={set('serialNo')} placeholder="e.g. VC-0042" maxLength={60} /></Field>
        </div>
      </Card>

      <div className="split">
        <Card title={`${eq.name} - 3D guide`}>
          <Viewer3D equipment={eq} point={point}
            readText={`${eq.read_label} - expect about ${num(point.value, eq.decimals)} ${eq.unit}`}
            refText={`${point.value} ${eq.unit} (${eq.reference_tool || 'reference standard'})`} />
          <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>Teal ring: where to read the instrument. Amber ring: the reference standard to apply. Digital displays are blank on purpose - read your real instrument.</p>
        </Card>

        <Card title="Measurement guide">
          <p style={{ marginBottom: 6 }}><b>1. Choose a standard test point</b></p>
          <div className="chips">{eq.points.map((p, i) => <button key={i} type="button" className={`chip ${i === idx ? 'on' : ''}`} onClick={() => { setIdx(i); setRes(null); }}>{p.value} {eq.unit}<small>+/- {p.mpe}</small></button>)}</div>
          <p style={{ marginBottom: 6 }}><b>2. Set up and measure</b></p>
          <ol className="guide">{eq.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <form onSubmit={submit} style={{ marginTop: 14 }}>
            <p style={{ marginBottom: 6 }}><b>3. Enter the reading</b></p>
            <Field label={`Reading at ${point.value} ${eq.unit}`} hint={`Allowed range: ${num(point.value - point.mpe, eq.decimals + 1)} to ${num(point.value + point.mpe, eq.decimals + 1)} ${eq.unit}`}>
              <input type="number" step="any" inputMode="decimal" value={form.measuredValue} onChange={set('measuredValue')} required />
            </Field>
            <button type="button" className="btn ghost small" onClick={() => setMore(!more)} style={{ marginBottom: 10 }}>{more ? 'Hide' : 'Add'} instrument history (improves the AI risk estimate)</button>
            {more && <div className="row">
              <Field label="Age (months)"><input type="number" min="0" value={form.ageMonths} onChange={set('ageMonths')} /></Field>
              <Field label="Days since last calibration"><input type="number" min="0" value={form.daysSinceCal} onChange={set('daysSinceCal')} /></Field>
              <Field label="Usage hours since then"><input type="number" min="0" value={form.usageHours} onChange={set('usageHours')} /></Field>
              <Field label="Room temp (C)"><input type="number" step="any" value={form.ambientTempC} onChange={set('ambientTempC')} /></Field>
              <Field label="Humidity (%)"><input type="number" min="0" max="100" value={form.humidityPct} onChange={set('humidityPct')} /></Field>
              <Field label="Last result"><select value={form.previousResult} onChange={set('previousResult')}><option value="">Unknown</option><option value="pass">Pass</option><option value="adjusted">Adjusted</option><option value="fail">Fail</option></select></Field>
            </div>}
            <ErrorNote error={err} />
            <button className="btn" disabled={busy || !form.serialNo.trim()}>{busy ? 'Checking...' : 'Check error'}</button>
            {!form.serialNo.trim() && <small className="muted" style={{ marginLeft: 10 }}>Enter the serial number above first</small>}
          </form>

          {c && (
            <div className={`result ${c.verdict}`} role="status">
              <div className="row" style={{ justifyContent: 'space-between' }}><span className="big">{c.verdict === 'out' ? 'Needs calibration' : c.verdict === 'warning' ? 'Close to the limit' : 'Within tolerance'}</span><VerdictBadge verdict={c.verdict} /></div>
              <dl className="kv" style={{ margin: '10px 0' }}>
                <dt>Reference</dt><dd>{num(c.nominal_value, eq.decimals)} {eq.unit}</dd>
                <dt>Your reading</dt><dd>{num(c.measured_value, eq.decimals + 1)} {eq.unit}</dd>
                <dt>Error</dt><dd>{c.error > 0 ? '+' : ''}{num(c.error, eq.decimals + 2)} {eq.unit}</dd>
                <dt>Allowed (MPE)</dt><dd>+/- {c.mpe} {eq.unit}</dd>
                <dt>Tolerance used</dt><dd><b>{c.error_pct_of_tolerance}%</b> {c.error_ratio >= 1 ? `(over the limit by ${num(c.error_pct_of_tolerance - 100, 0)}%)` : `(${num(c.margin_pct, 0)}% margin left)`}</dd>
              </dl>
              <div className="meter" aria-hidden="true"><i style={{ width: `${pctUsed}%`, background: tone }} /><span className="limit" /></div>
              <small className="muted">The line marks 100% of the allowed error.</small>
              {c.suspicious && <div className="note warn" style={{ marginTop: 10 }}>This reading is unusually far from the reference. Double-check the unit, decimal point and the selected point before booking.</div>}
              {ai?.supported ? (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(0,0,0,.12)' }}>
                  <b>AI drift outlook</b> <Badge tone={RISK[ai.risk_band][1]}>{RISK[ai.risk_band][0]}</Badge>
                  <p style={{ margin: '6px 0 0', fontSize: 13 }}>For an instrument with this history, the model expects about <b>{Math.round(ai.expected_error_ratio * 100)}%</b> of tolerance used (likely {Math.round(ai.interval_80[0] * 100)}-{Math.round(ai.interval_80[1] * 100)}%), with a {Math.round(ai.prob_out_of_tolerance * 100)}% chance of being out of tolerance. This is advice only - the verdict above comes from your actual reading.</p>
                  {ai.consistency && ai.consistency !== 'typical' && <div className="note warn" style={{ margin: '8px 0 0' }}>{ai.consistency === 'implausible' ? 'This reading is far worse than any instrument with this history would normally show. Re-check the unit, decimal point and set-up before sending it for calibration.' : 'This reading is worse than the model expects for an instrument with this history. That can mean damage or mishandling, or that the history above is not accurate.'}</div>}
                  {c.context?.assumed?.length > 0 && <small className="muted">Assumed defaults for: {c.context.assumed.join(', ')}. Add history above for a sharper estimate.</small>}
                </div>
              ) : <small className="muted" style={{ display: 'block', marginTop: 10 }}>AI outlook unavailable for this instrument ({ai?.reason?.replace(/_/g, ' ') || 'service offline'}). The verdict above is unaffected.</small>}
              {c.verdict !== 'within' && user.role === 'user' && <div style={{ marginTop: 12 }}><button className="btn" onClick={book}>Book calibration token</button></div>}
            </div>
          )}
        </Card>
      </div>

      <Card title={`Standard references for ${eq.name}`} aside={<span className="muted">{eq.standard}</span>}>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Test point</th><th className="num">Reference ({eq.unit})</th><th className="num">MPE (+/-)</th><th>Accepted reading</th><th>Reference tool</th></tr></thead>
          <tbody>{eq.points.map((p, i) => (
            <tr key={i} className="click" onClick={() => { setIdx(i); setRes(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }} style={i === idx ? { background: 'var(--teal-l)' } : null}>
              <td>Point {i + 1}</td><td className="num mono">{num(p.value, eq.decimals)}</td><td className="num">{p.mpe}</td>
              <td>{num(p.value - p.mpe, eq.decimals + 1)} to {num(p.value + p.mpe, eq.decimals + 1)}</td><td className="muted">{eq.reference_tool}</td></tr>))}</tbody>
        </table></div>
      </Card>

      <Card title="Your previous checks on this instrument type">
        {history.loading ? <Spinner /> : history.data?.checks.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>When</th><th>Serial</th><th className="num">Reference</th><th className="num">Reading</th><th className="num">% of MPE</th><th>Result</th><th>Token</th></tr></thead>
            <tbody>{history.data.checks.map((h) => <tr key={h.id}><td>{fmtDateTime(h.created_at)}</td><td>{h.serial_no}</td><td className="num">{num(h.nominal_value, eq.decimals)}</td><td className="num">{num(h.measured_value, eq.decimals + 1)}</td><td className="num mono">{h.error_pct_of_tolerance}%</td><td><VerdictBadge verdict={h.verdict} /></td><td>{h.token || '-'}</td></tr>)}</tbody>
          </table></div>
        ) : <Empty title="No checks yet">Your results will be listed here with the standard reference they were compared to.</Empty>}
      </Card>
    </>
  );
}
