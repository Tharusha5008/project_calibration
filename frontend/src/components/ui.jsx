import { createContext, useContext, useState, useCallback, useEffect } from 'react';

export const STATUS_META = {
  booked: ['Token booked', 'amber'], handed_over: ['Handed over', 'blue'], accepted: ['Accepted', 'blue'],
  in_calibration: ['In calibration', 'blue'], certificate_pending: ['Awaiting approval', 'amber'],
  certificate_approved: ['Certificate approved', 'green'], returning: ['Returning', 'blue'], closed: ['Closed', 'grey'], cancelled: ['Cancelled', 'grey'],
};
export const STEPS = ['booked', 'handed_over', 'accepted', 'in_calibration', 'certificate_pending', 'certificate_approved', 'returning', 'closed'];
export const STEP_LABEL = { booked: 'Booked', handed_over: 'Handed over', accepted: 'Accepted', in_calibration: 'Calibrating', certificate_pending: 'Approval', certificate_approved: 'Certified', returning: 'Returning', closed: 'Closed' };

export const Badge = ({ tone = 'grey', children }) => <span className={`badge ${tone}`}>{children}</span>;
export const StatusBadge = ({ status }) => { const [l, t] = STATUS_META[status] || [status, 'grey']; return <Badge tone={t}>{l}</Badge>; };
export const VerdictBadge = ({ verdict }) => {
  const m = { within: ['Within tolerance', 'green'], warning: ['Near the limit', 'amber'], out: ['Out of tolerance', 'red'] }[verdict] || [verdict, 'grey'];
  return <Badge tone={m[1]}>{m[0]}</Badge>;
};
export const ResultBadge = ({ result }) => <Badge tone={{ PASS: 'green', ADJUSTED: 'amber', FAIL: 'red' }[result] || 'grey'}>{result}</Badge>;
export const ApprovalBadge = ({ s }) => <Badge tone={{ approved: 'green', pending: 'amber', rejected: 'red' }[s] || 'grey'}>{s === 'pending' ? 'Pending approval' : s === 'approved' ? 'Approved' : 'Rejected'}</Badge>;

export const PageHeader = ({ title, sub, children }) => (
  <div className="page-head"><div><h1>{title}</h1>{sub && <p className="sub">{sub}</p>}</div><div className="actions">{children}</div></div>
);
export const Card = ({ title, aside, children, className = '' }) => (
  <section className={`card ${className}`}>{(title || aside) && <header><h2>{title}</h2>{aside}</header>}{children}</section>
);
export const Empty = ({ title, children }) => <div className="empty"><b>{title}</b><p>{children}</p></div>;
export const Spinner = () => <div className="spinner" role="status" aria-label="Loading" />;
export const Field = ({ label, hint, children }) => <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;

export const fmtDate = (s) => (s ? new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
export const fmtDateTime = (s) => (s ? new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z').toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');
export const num = (v, d = 2) => (v === null || v === undefined ? '-' : Number(v).toFixed(d));

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close">x</button></header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, tone = 'ok') => { const id = Math.random(); setItems((x) => [...x, { id, msg, tone }]); setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4200); }, []);
  return <ToastCtx.Provider value={push}>{children}<div className="toasts" aria-live="polite">{items.map((i) => <div key={i.id} className={`toast ${i.tone}`}>{i.msg}</div>)}</div></ToastCtx.Provider>;
}

// Loads data and exposes reload; shows errors instead of failing silently.
export function useLoad(fn, deps = []) {
  const [state, set] = useState({ data: null, error: null, loading: true });
  const load = useCallback(() => { set((s) => ({ ...s, loading: true })); return fn().then((data) => set({ data, error: null, loading: false })).catch((e) => set({ data: null, error: e.message, loading: false })); }, deps); // eslint-disable-line
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}
export const ErrorNote = ({ error }) => (error ? <div className="note error" role="alert">{error}</div> : null);
