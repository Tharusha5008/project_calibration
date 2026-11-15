import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Field, ErrorNote, Spinner, Empty, useLoad, fmtDateTime, useToast } from './ui';

// Feedback / issues thread. With requestId it is scoped to one token; without, it lists everything the user may see.
export default function MessagesPanel({ requestId, full }) {
  const { user } = useAuth();
  const toast = useToast();
  const q = useLoad(() => api.get('/messages'), []);
  const [body, setBody] = useState(''), [subject, setSubject] = useState(''), [rating, setRating] = useState('');
  const [kind, setKind] = useState(user.role === 'user' ? 'issue' : 'feedback'), [err, setErr] = useState(null);
  const [reply, setReply] = useState({});

  const send = async (e) => {
    e.preventDefault(); setErr(null);
    try { await api.post('/messages', { requestId, kind, subject, body, rating: rating || undefined }); setBody(''); setSubject(''); setRating(''); toast('Sent'); q.reload(); } catch (x) { setErr(x.message); }
  };
  const doReply = async (id) => { try { await api.post(`/messages/${id}/reply`, { body: reply[id] }); setReply({ ...reply, [id]: '' }); q.reload(); } catch (x) { setErr(x.message); } };
  const resolve = async (m) => { await api.post(`/messages/${m.id}/resolve`, { resolved: m.status !== 'resolved' }); q.reload(); };

  const list = (q.data?.messages || []).filter((m) => (requestId ? m.request_id === requestId : true));
  return (
    <div>
      <form onSubmit={send}>
        <ErrorNote error={err} />
        <div className="row">
          {user.role !== 'technician' && <Field label="Type"><select value={kind} onChange={(e) => setKind(e.target.value)}>{user.role === 'user' && <option value="issue">Report an issue</option>}<option value="feedback">Give feedback</option></select></Field>}
          {full && <Field label="Subject"><input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} /></Field>}
          {kind === 'feedback' && <Field label="Rating"><select value={rating} onChange={(e) => setRating(e.target.value)}><option value="">No rating</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} / 5</option>)}</select></Field>}
        </div>
        <Field label="Message"><textarea value={body} onChange={(e) => setBody(e.target.value)} required minLength={3} /></Field>
        <button className="btn small" disabled={!body.trim()}>Send</button>
      </form>
      <div style={{ marginTop: 14 }}>
        {q.loading && !q.data ? <Spinner /> : list.length === 0 ? <Empty title="Nothing here yet">Issues and feedback will appear in this list.</Empty> : list.map((m) => (
          <div key={m.id} className="thread">
            <div className="row" style={{ justifyContent: 'space-between' }}><span><b>{m.subject || (m.kind === 'issue' ? 'Issue' : 'Feedback')}</b> <Badge tone={m.kind === 'issue' ? 'red' : 'blue'}>{m.kind}</Badge> {m.rating ? <Badge tone="grey">{m.rating}/5</Badge> : null} {m.token && !requestId ? <Badge tone="grey">{m.token}</Badge> : null}</span><Badge tone={m.status === 'resolved' ? 'green' : 'amber'}>{m.status}</Badge></div>
            <p style={{ margin: '6px 0' }}>{m.body}</p><small className="muted">{m.author_name} ({m.author_role}) - {fmtDateTime(m.created_at)}</small>
            {m.replies.map((x) => <div key={x.id} className="thread reply"><p style={{ margin: 0 }}>{x.body}</p><small className="muted">{x.author_name} ({x.author_role}) - {fmtDateTime(x.created_at)}</small></div>)}
            <div className="row" style={{ marginTop: 8 }}>
              <input placeholder="Write a reply" value={reply[m.id] || ''} onChange={(e) => setReply({ ...reply, [m.id]: e.target.value })} />
              <button className="btn small ghost" disabled={!(reply[m.id] || '').trim()} onClick={() => doReply(m.id)}>Reply</button>
              {user.role === 'admin' && <button className="btn small ghost" onClick={() => resolve(m)}>{m.status === 'resolved' ? 'Reopen' : 'Mark resolved'}</button>}
            </div>
          </div>))}
      </div>
    </div>
  );
}
