import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadPdf } from '../api';
import { useAuth } from '../auth';
import Viewer3D from '../components/Viewer3D';
import Messages from '../components/MessagesPanel';
import { Card, Field, PageHeader, StatusBadge, ResultBadge, ApprovalBadge, VerdictBadge, ErrorNote, Spinner, useLoad, useToast, fmtDateTime, fmtDate, num, STEPS, STEP_LABEL, Modal } from '../components/ui';

const STAGES = ['Dispatched', 'In transit', 'Out for delivery', 'Delivered', 'Delivery attempted', 'Delayed'];

export default function RequestDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const d = useLoad(() => api.get(`/requests/${id}`), [id]);
  const [err, setErr] = useState(null);
  const run = async (fn, ok) => { setErr(null); try { await fn(); if (ok) toast(ok); await d.reload(); } catch (e) { setErr(e.message); } };

  if (d.loading && !d.data) return <Spinner />;
  if (d.error) return <div className="note error">{d.error}</div>;
  const { request: r, equipment: eq, check, events, certificate } = d.data;
  const at = STEPS.indexOf(r.status);
  const act = (path, body, ok) => run(() => api.post(`/requests/${r.id}/${path}`, body), ok);
  const shipments = events.filter((e) => e.kind === 'shipment');
  const canTrackInbound = r.handover_method === 'courier' && (user.role === 'user' || user.role === 'admin') && !['closed', 'cancelled'].includes(r.status);
  const canTrackReturn = r.return_method === 'courier' && !['closed', 'cancelled'].includes(r.status);

  return (
    <>
      <PageHeader title={r.token} sub={`${r.equipment_name} - serial ${r.serial_no}${user.role !== 'user' ? ` - ${r.customer_name}` : ''}`}>
        <StatusBadge status={r.status} /><Link to="/requests" className="btn ghost">Back to list</Link>
      </PageHeader>
      <Card>
        {r.status === 'cancelled' ? <div className="note">This token was cancelled.</div> : (
          <div className="steps" aria-label="Progress">{STEPS.map((s, i) => <div key={s} className={`s ${i < at ? 'done' : ''} ${i === at ? 'now' : ''}`}>{STEP_LABEL[s]}</div>)}</div>
        )}
        <ErrorNote error={err} />
      </Card>

      {certificate?.approval_status === 'rejected' && r.status === 'in_calibration' && user.role !== 'user' && <div className="note warn"><b>Certificate sent back:</b> {certificate.rejection_reason}</div>}

      <div className="split">
        <div>
          <Actions {...{ r, eq, user, act, run, d }} />
          {user.role === 'technician' && r.status === 'in_calibration' && <Workbench r={r} eq={eq} act={act} setErr={setErr} certificate={certificate} />}
          {user.role === 'admin' && r.status === 'certificate_pending' && certificate && <ApprovalPanel cert={certificate} run={run} />}
          <Card title="Timeline"><ul className="timeline">{[...events].reverse().map((e) => (
            <li key={e.id} className={e.kind}><b>{e.title}</b>{e.detail && <span>{e.detail}</span>}<small>{fmtDateTime(e.created_at)}{e.actor_name ? ` - ${e.actor_name}` : ''}{e.direction ? ` - ${e.direction === 'inbound' ? 'to lab' : 'to customer'}` : ''}</small></li>))}</ul></Card>
        </div>
        <div>
          <Card title="Job details"><dl className="kv">
            <dt>Instrument</dt><dd>{r.equipment_name}</dd><dt>Serial / tag</dt><dd>{r.serial_no}</dd>
            <dt>Customer</dt><dd>{r.customer_name}{r.organisation ? ` (${r.organisation})` : ''}</dd>
            <dt>Technician</dt><dd>{r.technician_name || 'Not assigned yet'}</dd>
            <dt>Hand-over</dt><dd>{r.handover_method === 'courier' ? `Courier - ${r.courier_name} (${r.tracking_no})` : r.handover_method === 'physical' ? 'In person at the lab' : '-'}</dd>
            <dt>Return</dt><dd>{r.return_method === 'courier' ? `Courier - ${r.return_courier} (${r.return_tracking_no})` : r.return_method === 'pickup' ? 'Customer collects' : '-'}</dd>
            <dt>Booked</dt><dd>{fmtDateTime(r.created_at)}</dd></dl></Card>

          {check && <Card title="The check that triggered this token"><dl className="kv">
            <dt>Standard reference</dt><dd>{num(check.nominal_value, eq.decimals)} {eq.unit} <span className="muted">({eq.standard})</span></dd>
            <dt>Reading</dt><dd>{num(check.measured_value, eq.decimals + 1)} {eq.unit}</dd>
            <dt>Error</dt><dd>{check.error > 0 ? '+' : ''}{num(check.error, eq.decimals + 2)} {eq.unit} vs +/-{check.mpe} allowed</dd>
            <dt>Tolerance used</dt><dd><b>{Math.round(check.error_ratio * 100)}%</b> <VerdictBadge verdict={check.verdict} /></dd></dl></Card>}

          {(r.tracking_no || r.return_tracking_no) && <Card title="Delivery tracking">
            {shipments.length === 0 ? <p className="muted">No tracking updates yet.</p> : <ul className="timeline">{[...shipments].reverse().map((e) => <li key={e.id} className="shipment"><b>{e.title}</b>{e.detail && <span>{e.detail}</span>}<small>{fmtDateTime(e.created_at)} - {e.direction === 'inbound' ? 'to the lab' : 'back to customer'}</small></li>)}</ul>}
            {(canTrackInbound || canTrackReturn) && <ShipmentForm r={r} inbound={canTrackInbound && r.status !== 'returning'} run={run} />}
          </Card>}

          {certificate && (user.role !== 'user' || certificate.approval_status === 'approved') && <Card title="Certificate">
            <dl className="kv"><dt>Number</dt><dd>{certificate.number}</dd><dt>Result</dt><dd><ResultBadge result={certificate.result} /></dd><dt>Status</dt><dd><ApprovalBadge s={certificate.approval_status} /></dd><dt>Issued</dt><dd>{fmtDate(certificate.issued_at)}</dd><dt>Recalibrate by</dt><dd>{fmtDate(certificate.valid_until)}</dd></dl>
            {(certificate.approval_status === 'approved' || user.role === 'admin') && <button className="btn" style={{ marginTop: 10 }} onClick={() => downloadPdf(`/certificates/${certificate.id}/pdf`, `${certificate.number}.pdf`).catch((e) => setErr(e.message))}>Download PDF certificate</button>}
          </Card>}
          <Card title="Feedback & issues"><Messages requestId={r.id} /></Card>
        </div>
      </div>
    </>
  );
}

function Actions({ r, eq, user, act, run, d }) {
  const [m, setM] = useState('physical'), [cn, setCn] = useState(''), [tn, setTn] = useState('');
  const [techId, setTechId] = useState(''), [techs, setTechs] = useState([]);
  const [rm, setRm] = useState('pickup');
  useEffect(() => { if (user.role === 'admin') api.get('/users/technicians').then((x) => { setTechs(x.technicians); setTechId(String(x.technicians[0]?.id || '')); }).catch(() => {}); }, [user.role]);
  const cancelBtn = ['booked', 'handed_over'].includes(r.status) && ['user', 'admin'].includes(user.role) && <button className="btn ghost" onClick={() => window.confirm('Cancel this token?') && act('cancel', { reason: 'Cancelled by ' + user.role }, 'Token cancelled')}>Cancel token</button>;
  const blocks = [];

  if (user.role === 'user' && r.status === 'booked') blocks.push(
    <Card key="h" title="Next: hand the instrument over">
      <p>Bring it to the lab yourself or send it with a courier. Pack it safely and write the token <b>{r.token}</b> on the parcel.</p>
      <div className="chips"><button className={`chip ${m === 'physical' ? 'on' : ''}`} onClick={() => setM('physical')}>Deliver in person</button><button className={`chip ${m === 'courier' ? 'on' : ''}`} onClick={() => setM('courier')}>Send by courier</button></div>
      {m === 'courier' && <div className="row"><Field label="Courier company"><input value={cn} onChange={(e) => setCn(e.target.value)} placeholder="DHL, FedEx, ..." /></Field><Field label="Tracking number"><input value={tn} onChange={(e) => setTn(e.target.value)} /></Field></div>}
      <div className="row"><button className="btn" onClick={() => act('handover', { method: m, courierName: cn, trackingNo: tn }, 'Marked as handed over')}>{m === 'physical' ? 'I am delivering it to the lab' : 'I have dispatched it'}</button>{cancelBtn}</div>
    </Card>);
  if (user.role === 'user' && r.status === 'handed_over') blocks.push(<Card key="w" title="Waiting for the lab"><p>{r.handover_method === 'courier' ? 'Your parcel is on its way. Add tracking updates on the right so the lab can follow it.' : 'Bring the instrument to the lab reception with this token.'} An administrator will accept the token when it arrives.</p>{cancelBtn}</Card>);
  if (user.role === 'user' && r.status === 'returning') blocks.push(<Card key="rc" title="Your instrument is on its way back"><p>{r.return_method === 'pickup' ? 'It is ready for you to collect at the lab.' : `Sent with ${r.return_courier} (${r.return_tracking_no}).`} Confirm when you have it.</p><button className="btn" onClick={() => act('confirm-received', {}, 'Thanks - token closed')}>I have received my instrument</button></Card>);

  if (user.role === 'admin' && r.status === 'handed_over') blocks.push(
    <Card key="a" title="Confirm receipt and assign a technician">
      <div className="row"><Field label="Technician"><select value={techId} onChange={(e) => setTechId(e.target.value)}>{techs.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select></Field></div>
      <div className="row"><button className="btn" disabled={!techId} onClick={() => act('accept', { technicianId: Number(techId) }, 'Token accepted')}>Accept token</button>{cancelBtn}</div>
    </Card>);
  if (user.role === 'admin' && ['accepted', 'in_calibration'].includes(r.status)) blocks.push(
    <Card key="ra" title="Technician"><div className="row"><Field label="Reassign to"><select value={techId} onChange={(e) => setTechId(e.target.value)}>{techs.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select></Field><button className="btn ghost" onClick={() => act('reassign', { technicianId: Number(techId) }, 'Technician changed')}>Reassign</button></div></Card>);

  if (user.role === 'technician' && r.status === 'accepted') blocks.push(<Card key="s" title="Ready to start"><p>The instrument has been received. Start the calibration to open the workbench.</p><button className="btn" onClick={() => act('start', {}, 'Calibration started')}>Start calibration</button></Card>);

  if (['admin', 'technician'].includes(user.role) && r.status === 'certificate_approved') blocks.push(
    <Card key="ret" title="Return the instrument">
      <div className="chips"><button className={`chip ${rm === 'pickup' ? 'on' : ''}`} onClick={() => setRm('pickup')}>Customer collects</button><button className={`chip ${rm === 'courier' ? 'on' : ''}`} onClick={() => setRm('courier')}>Send by courier</button></div>
      {rm === 'courier' && <div className="row"><Field label="Courier company"><input value={cn} onChange={(e) => setCn(e.target.value)} /></Field><Field label="Tracking number"><input value={tn} onChange={(e) => setTn(e.target.value)} /></Field></div>}
      <button className="btn" onClick={() => act('return', { method: rm, courierName: cn, trackingNo: tn }, 'Return recorded')}>Record return</button>
    </Card>);
  if (user.role === 'admin' && r.status === 'returning') blocks.push(<Card key="cl" title="Close token"><p>Close the token if the customer has the instrument back.</p><button className="btn ghost" onClick={() => act('confirm-received', {}, 'Token closed')}>Close token</button></Card>);
  if (user.role === 'user' && r.status === 'certificate_approved') blocks.push(<Card key="ca" title="Certificate approved"><p>Your certificate is ready to download on the right. The lab is arranging the return of your instrument.</p></Card>);
  return <>{blocks}</>;
}

function ShipmentForm({ r, inbound, run }) {
  const [stage, setStage] = useState('In transit'), [loc, setLoc] = useState('');
  return (
    <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
      <Field label="Add tracking update"><select value={stage} onChange={(e) => setStage(e.target.value)}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select></Field>
      <Field label="Location (optional)"><input value={loc} onChange={(e) => setLoc(e.target.value)} /></Field>
      <button className="btn small" style={{ marginBottom: 12 }} onClick={() => run(() => api.post(`/requests/${r.id}/shipment`, { direction: inbound ? 'inbound' : 'return', stage, location: loc }), 'Tracking updated')}>Add</button>
    </div>
  );
}

function ApprovalPanel({ cert, run }) {
  const [reject, setReject] = useState(false), [reason, setReason] = useState('');
  return (
    <Card title="Certificate waiting for your approval" aside={<ResultBadge result={cert.result} />}>
      <p>{cert.number} - review the readings, then approve or send it back.</p>
      <div className="row">
        <button className="btn" onClick={() => run(() => api.post(`/certificates/${cert.id}/approve`), 'Certificate approved')}>Approve certificate</button>
        <button className="btn ghost" onClick={() => downloadPdf(`/certificates/${cert.id}/pdf`, 'draft.pdf')}>Preview PDF</button>
        <button className="btn danger" onClick={() => setReject(true)}>Send back</button>
      </div>
      {reject && <Modal title="Send certificate back to the technician" onClose={() => setReject(false)}>
        <Field label="What needs to change?"><textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <button className="btn danger" onClick={() => run(() => api.post(`/certificates/${cert.id}/reject`, { reason }), 'Sent back').then(() => setReject(false))}>Send back</button>
      </Modal>}
    </Card>
  );
}

// Technician workbench: 3D guide + as-found / as-left entry with live pass/fail
function Workbench({ r, eq, act, setErr }) {
  const saved = r.calibration_data || [];
  const [rows, setRows] = useState(() => eq.points.map((p, i) => ({ as_found: saved[i]?.as_found ?? '', as_left: saved[i]?.as_left ?? '' })));
  const [sel, setSel] = useState(0), [note, setNote] = useState(''), [temp, setTemp] = useState(''), [hum, setHum] = useState(''), [remarks, setRemarks] = useState('');
  const upd = (i, k, v) => setRows(rows.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const ok = (v, p) => v !== '' && Math.abs(Number(v) - p.value) <= p.mpe + 1e-9;
  const payload = rows.map((x, i) => ({ index: i, as_found: x.as_found, as_left: x.as_left }));
  const foundOk = rows.every((x, i) => ok(x.as_found, eq.points[i])), allFound = rows.every((x) => x.as_found !== '');
  return (
    <Card title="Calibration workbench">
      <Viewer3D equipment={eq} point={eq.points[sel]} readText={`${eq.read_label}`} refText={`${eq.points[sel].value} ${eq.unit} - ${eq.reference_tool || 'reference standard'}`} />
      <div className="tbl-wrap" style={{ marginTop: 12 }}><table>
        <thead><tr><th>Reference ({eq.unit})</th><th>MPE</th><th>As-found</th><th>Error</th><th>As-left (after adjustment)</th><th>Error</th></tr></thead>
        <tbody>{eq.points.map((p, i) => (
          <tr key={i} className="click" onClick={() => setSel(i)} style={i === sel ? { background: 'var(--teal-l)' } : null}>
            <td className="mono">{num(p.value, eq.decimals)}</td><td>+/-{p.mpe}</td>
            <td><input type="number" step="any" value={rows[i].as_found} onChange={(e) => upd(i, 'as_found', e.target.value)} onFocus={() => setSel(i)} aria-label={`As-found at ${p.value}`} /></td>
            <td>{rows[i].as_found === '' ? '-' : <span className={ok(rows[i].as_found, p) ? 'badge green' : 'badge red'}>{num(Number(rows[i].as_found) - p.value, eq.decimals + 2)}</span>}</td>
            <td><input type="number" step="any" value={rows[i].as_left} onChange={(e) => upd(i, 'as_left', e.target.value)} onFocus={() => setSel(i)} aria-label={`As-left at ${p.value}`} /></td>
            <td>{rows[i].as_left === '' ? '-' : <span className={ok(rows[i].as_left, p) ? 'badge green' : 'badge red'}>{num(Number(rows[i].as_left) - p.value, eq.decimals + 2)}</span>}</td>
          </tr>))}</tbody>
      </table></div>
      {allFound && <div className={`note ${foundOk ? 'ok' : 'warn'}`} style={{ marginTop: 12 }}>{foundOk ? 'As-found is within tolerance at every point: the certificate result will be PASS.' : 'As-found is out of tolerance. Adjust, then enter as-left readings for every point: the result will be ADJUSTED if they are all within tolerance, otherwise FAIL.'}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <Field label="Temperature (C)"><input type="number" step="any" value={temp} onChange={(e) => setTemp(e.target.value)} /></Field>
        <Field label="Humidity (% RH)"><input type="number" step="any" value={hum} onChange={(e) => setHum(e.target.value)} /></Field>
      </div>
      <Field label="Remarks for the certificate (optional)"><textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
      <Field label="Progress note (visible on the token timeline)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Cleaned jaws, zero reset" /></Field>
      <div className="row">
        <button className="btn ghost" onClick={() => act('update', { note, readings: payload }, 'Token updated').then(() => setNote(''))}>Save progress</button>
        <button className="btn" disabled={!allFound} onClick={() => window.confirm('Issue the certificate? It will go to the administrator for approval.') && act('issue-certificate', { readings: payload, temperature: temp, humidity: hum, remarks }, 'Certificate sent for approval')}>Issue certificate</button>
      </div>
    </Card>
  );
}
