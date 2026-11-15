import { Navigate, Route, Routes, NavLink, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from './auth';
import { api } from './api';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import CheckEquipment from './pages/CheckEquipment';
import Requests from './pages/Requests';
import RequestDetail from './pages/RequestDetail';
import Certificates from './pages/Certificates';
import Messages from './pages/Messages';
import Reports from './pages/Reports';
import EquipmentAdmin from './pages/EquipmentAdmin';
import Users from './pages/Users';

const NAV = {
  user: [['/', 'Overview'], ['/check', 'Check equipment'], ['/requests', 'My tokens'], ['/certificates', 'Certificates'], ['/messages', 'Issues & feedback'], ['/reports', 'Reports']],
  technician: [['/', 'Overview'], ['/requests', 'My work queue'], ['/certificates', 'Certificates issued'], ['/messages', 'Feedback'], ['/reports', 'Reports']],
  admin: [['/', 'Overview'], ['/requests', 'Tokens'], ['/certificates', 'Certificates'], ['/equipment', 'Equipment catalogue'], ['/users', 'Accounts'], ['/messages', 'Issues & feedback'], ['/reports', 'Reports'], ['/check', 'Try a check']],
};

function Shell() {
  const { user, signOut } = useAuth();
  const [counts, setCounts] = useState({});
  const loc = useLocation();
  useEffect(() => { api.get('/stats').then(setCounts).catch(() => {}); }, [loc.pathname]);
  const badge = (to) => (user.role === 'admin' && to === '/certificates' && counts.pendingCertificates) ? counts.pendingCertificates
    : (user.role === 'admin' && to === '/messages' && counts.openIssues) ? counts.openIssues : null;
  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <div className="brand">
          <svg width="30" height="30" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0E7C7B" /><path d="M7 21a9 9 0 0 1 18 0" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" /><path d="M16 21l5-7" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" /></svg>
          CalibrateIQ
        </div>
        {NAV[user.role].map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav ${isActive ? 'active' : ''}`}>{label}{badge(to) ? <span className="count">{badge(to)}</span> : null}</NavLink>
        ))}
        <div className="who"><b>{user.full_name}</b><span>{user.role}</span><br /><button className="btn small ghost" onClick={signOut}>Sign out</button></div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/check" element={user.role === 'technician' ? <Navigate to="/" /> : <CheckEquipment />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/requests/:id" element={<RequestDetail />} />
          <Route path="/certificates" element={<Certificates />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/equipment" element={user.role === 'admin' ? <EquipmentAdmin /> : <Navigate to="/" />} />
          <Route path="/users" element={user.role === 'admin' ? <Users /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return <Routes><Route path="/login" element={user ? <Navigate to="/" /> : <Login />} /><Route path="/*" element={user ? <Shell /> : <Navigate to="/login" />} /></Routes>;
}
