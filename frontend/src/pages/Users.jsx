import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, Field, Modal, PageHeader, Badge, ErrorNote, Spinner, useLoad, useToast, fmtDate } from '../components/ui';

export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [role, setRole] = useState(''), [q, setQ] = useState('');
  const d = useLoad(() => api.get(`/users?${new URLSearchParams({ ...(role && { role }), ...(q && { q }) })}`), [role, q]);
  const [form, setForm] = useState(null), [err, setErr] = useState(null);

  const save = async () => {
    setErr(null);
    try { form.id ? await api.patch(`/users/${form.id}`, { fullName: form.fullName, role: form.role, organisation: form.organisation, ...(form.password ? { password: form.password } : {}) }) : await api.post('/users', form); toast('Saved'); setForm(null); d.reload(); } catch (e) { setErr(e.message); }
  };
  const toggle = async (u) => { try { await api.patch(`/users/${u.id}`, { isActive: !u.is_active }); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const del = async (u) => { if (!window.confirm(`Delete ${u.full_name}?`)) return; try { await api.del(`/users/${u.id}`); toast('Deleted'); d.reload(); } catch (e) { toast(e.message, 'err'); } };

  return (
    <>
      <PageHeader title="Accounts" sub="Create technicians and administrators, reset passwords, disable access."><button className="btn" onClick={() => { setErr(null); setForm({ fullName: '', email: '', password: '', role: 'technician', organisation: '' }); }}>Add account</button></PageHeader>
      <Card>
        <div className="row" style={{ marginBottom: 12 }}>
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role"><option value="">All roles</option><option value="user">Customers</option><option value="technician">Technicians</option><option value="admin">Admins</option></select>
          <input placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ErrorNote error={d.error} />
        {d.loading && !d.data ? <Spinner /> : <div className="tbl-wrap"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Organisation</th><th>Joined</th><th>Status</th><th /></tr></thead>
          <tbody>{d.data.users.map((u) => (
            <tr key={u.id}><td><b>{u.full_name}</b></td><td>{u.email}</td><td style={{ textTransform: 'capitalize' }}>{u.role}</td><td>{u.organisation || '-'}</td><td>{fmtDate(u.created_at)}</td>
              <td>{u.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="grey">Disabled</Badge>}</td>
              <td><div className="row" style={{ flexWrap: 'nowrap' }}>
                <button className="btn small ghost" onClick={() => { setErr(null); setForm({ id: u.id, fullName: u.full_name, email: u.email, role: u.role, organisation: u.organisation || '', password: '' }); }}>Edit</button>
                {u.id !== me.id && <><button className="btn small ghost" onClick={() => toggle(u)}>{u.is_active ? 'Disable' : 'Enable'}</button><button className="btn small ghost" onClick={() => del(u)}>Delete</button></>}
              </div></td></tr>))}</tbody>
        </table></div>}
      </Card>
      {form && <Modal title={form.id ? 'Edit account' : 'Add account'} onClose={() => setForm(null)}>
        <ErrorNote error={err} />
        <Field label="Full name"><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
        <Field label="Email"><input type="email" value={form.email} disabled={!!form.id} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Role"><select value={form.role} disabled={form.id === me.id} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="user">Customer</option><option value="technician">Technician</option><option value="admin">Admin</option></select></Field>
        <Field label="Organisation"><input value={form.organisation} onChange={(e) => setForm({ ...form, organisation: e.target.value })} /></Field>
        <Field label={form.id ? 'New password (leave blank to keep)' : 'Password'} hint="At least 8 characters"><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" /></Field>
        <button className="btn" onClick={save}>Save account</button>
      </Modal>}
    </>
  );
}
