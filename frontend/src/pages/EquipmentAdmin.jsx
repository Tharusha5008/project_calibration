import { useState } from 'react';
import { api } from '../api';
import { Card, Field, Modal, PageHeader, Badge, ErrorNote, Spinner, useLoad, useToast } from '../components/ui';

const blank = { name: '', unit: '', standard: '', referenceTool: '', rangeMin: '', rangeMax: '', decimals: 2, steps: '', points: [{ value: '', mpe: '' }] };

export default function EquipmentAdmin() {
  const toast = useToast();
  const d = useLoad(() => api.get('/equipment?all=true'));
  const [edit, setEdit] = useState(null), [err, setErr] = useState(null);

  const open = (e) => { setErr(null); setEdit(e ? { id: e.id, name: e.name, unit: e.unit, standard: e.standard, referenceTool: e.reference_tool || '', rangeMin: e.range_min, rangeMax: e.range_max, decimals: e.decimals, steps: e.steps.join('\n'), points: e.points.map((p) => ({ value: p.value, mpe: p.mpe })), key: e.key, model3d: e.model3d, active: e.active } : { ...blank }); };
  const save = async () => {
    setErr(null);
    const body = { ...edit, steps: edit.steps.split('\n').map((s) => s.trim()).filter(Boolean), rangeMin: Number(edit.rangeMin), rangeMax: Number(edit.rangeMax), decimals: Number(edit.decimals), points: edit.points.map((p) => ({ value: Number(p.value), mpe: Number(p.mpe) })) };
    try { edit.id ? await api.put(`/equipment/${edit.id}`, body) : await api.post('/equipment', body); toast('Saved'); setEdit(null); d.reload(); } catch (e) { setErr(e.message); }
  };
  const remove = async (e) => { if (!window.confirm(`Remove ${e.name}?`)) return; try { const r = await api.del(`/equipment/${e.id}`); toast(r.message); d.reload(); } catch (x) { toast(x.message, 'err'); } };
  const setP = (i, k, v) => setEdit({ ...edit, points: edit.points.map((p, j) => (j === i ? { ...p, [k]: v } : p)) });

  return (
    <>
      <PageHeader title="Equipment catalogue" sub="Instrument types, their standard reference points and permitted error (MPE)."><button className="btn" onClick={() => open(null)}>Add equipment</button></PageHeader>
      <Card><ErrorNote error={d.error} />{d.loading && !d.data ? <Spinner /> : (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Name</th><th>Unit</th><th>Range</th><th>Standard points</th><th>Standard</th><th>Status</th><th /></tr></thead>
          <tbody>{d.data.equipment.map((e) => (
            <tr key={e.id}><td><b>{e.name}</b></td><td>{e.unit}</td><td>{e.range_min} - {e.range_max}</td><td>{e.points.map((p) => p.value).join(', ')}</td><td className="muted">{e.standard}</td>
              <td>{e.active ? <Badge tone="green">Active</Badge> : <Badge tone="grey">Retired</Badge>}</td>
              <td><div className="row" style={{ flexWrap: 'nowrap' }}><button className="btn small ghost" onClick={() => open(e)}>Edit</button><button className="btn small ghost" onClick={() => remove(e)}>Remove</button></div></td></tr>))}</tbody>
        </table></div>)}
      </Card>
      {edit && <Modal wide title={edit.id ? `Edit ${edit.name}` : 'Add equipment'} onClose={() => setEdit(null)}>
        <ErrorNote error={err} />
        <div className="row"><Field label="Name"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field><Field label="Unit"><input value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} placeholder="mm, bar, V ..." /></Field></div>
        <div className="row"><Field label="Range min"><input type="number" step="any" value={edit.rangeMin} onChange={(e) => setEdit({ ...edit, rangeMin: e.target.value })} /></Field><Field label="Range max"><input type="number" step="any" value={edit.rangeMax} onChange={(e) => setEdit({ ...edit, rangeMax: e.target.value })} /></Field><Field label="Decimals shown"><input type="number" min="0" max="6" value={edit.decimals} onChange={(e) => setEdit({ ...edit, decimals: e.target.value })} /></Field></div>
        <div className="row"><Field label="Calibration standard"><input value={edit.standard} onChange={(e) => setEdit({ ...edit, standard: e.target.value })} placeholder="e.g. ISO 463" /></Field><Field label="Reference tool"><input value={edit.referenceTool} onChange={(e) => setEdit({ ...edit, referenceTool: e.target.value })} /></Field></div>
        <b>Standard reference points</b>
        {edit.points.map((p, i) => <div className="row" key={i} style={{ marginTop: 6 }}><Field label={i === 0 ? 'Reference value' : ''}><input type="number" step="any" value={p.value} onChange={(e) => setP(i, 'value', e.target.value)} /></Field><Field label={i === 0 ? 'MPE (+/-)' : ''}><input type="number" step="any" value={p.mpe} onChange={(e) => setP(i, 'mpe', e.target.value)} /></Field><button className="btn small ghost" disabled={edit.points.length < 2} onClick={() => setEdit({ ...edit, points: edit.points.filter((_, j) => j !== i) })}>Remove</button></div>)}
        <button className="btn small ghost" style={{ margin: '8px 0 14px' }} disabled={edit.points.length >= 12} onClick={() => setEdit({ ...edit, points: [...edit.points, { value: '', mpe: '' }] })}>Add point</button>
        <Field label="Measurement steps (one per line)" hint="Shown to customers next to the 3D model"><textarea value={edit.steps} onChange={(e) => setEdit({ ...edit, steps: e.target.value })} /></Field>
        {!edit.id && <div className="note">New types use a generic 3D model and are not part of the AI training data, so they get the exact verdict but no AI drift outlook until the model is retrained with their history.</div>}
        {edit.id && <label className="row"><input type="checkbox" style={{ width: 'auto', flex: 'none' }} checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> <span>Available for new checks</span></label>}
        <div className="row" style={{ marginTop: 12 }}><button className="btn" onClick={save}>Save equipment</button></div>
      </Modal>}
    </>
  );
}
