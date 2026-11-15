import { useState } from 'react';
import { useAuth } from '../auth';
import { Field, ErrorNote } from '../components/ui';

export default function Login() {
  const { signIn, register } = useAuth();
  const [mode, setMode] = useState('in');
  const [f, setF] = useState({ email: '', password: '', fullName: '', organisation: '' });
  const [err, setErr] = useState(null), [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { mode === 'in' ? await signIn(f.email, f.password) : await register(f); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <div className="hero">
        <h1>Know your instrument is right before it costs you.</h1>
        <p>Check an instrument against its standard reference points, see exactly where to read it on a 3D model, and send it for certified calibration only when it needs it.</p>
        <ul><li>Exact pass / fail from your real reading</li><li>Track every instrument from hand-over to certificate</li><li>Weekly and monthly PDF reports</li></ul>
      </div>
      <div className="form"><div>
        <h1 style={{ marginBottom: 16 }}>{mode === 'in' ? 'Sign in' : 'Create a customer account'}</h1>
        <form onSubmit={submit}>
          <ErrorNote error={err} />
          {mode === 'up' && <><Field label="Full name"><input value={f.fullName} onChange={set('fullName')} required autoComplete="name" /></Field><Field label="Organisation (optional)"><input value={f.organisation} onChange={set('organisation')} /></Field></>}
          <Field label="Email"><input type="email" value={f.email} onChange={set('email')} required autoComplete="email" /></Field>
          <Field label="Password" hint={mode === 'up' ? 'At least 8 characters' : undefined}><input type="password" value={f.password} onChange={set('password')} required autoComplete={mode === 'in' ? 'current-password' : 'new-password'} /></Field>
          <button className="btn" style={{ width: '100%' }} disabled={busy}>{busy ? 'Please wait...' : mode === 'in' ? 'Sign in' : 'Create account'}</button>
        </form>
        <p style={{ marginTop: 14 }}>{mode === 'in' ? 'New customer?' : 'Already registered?'} <a href="#" onClick={(e) => { e.preventDefault(); setErr(null); setMode(mode === 'in' ? 'up' : 'in'); }}>{mode === 'in' ? 'Create an account' : 'Sign in'}</a></p>
        {mode === 'in' && <div className="demo">Demo accounts:<br /><code>admin@lab.test</code> / <code>Admin@123</code><br /><code>tech@lab.test</code> / <code>Tech@123</code><br /><code>user@lab.test</code> / <code>User@123</code></div>}
      </div></div>
    </div>
  );
}
