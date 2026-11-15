import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setToken, getToken } from './api';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());
  useEffect(() => { if (getToken()) api.get('/auth/me').then((r) => setUser(r.user)).catch(() => setToken(null)).finally(() => setLoading(false)); }, []);
  const signIn = useCallback(async (email, password) => { const r = await api.post('/auth/login', { email, password }); setToken(r.token); setUser(r.user); return r.user; }, []);
  const register = useCallback(async (form) => { const r = await api.post('/auth/register', form); setToken(r.token); setUser(r.user); return r.user; }, []);
  const signOut = useCallback(() => { setToken(null); setUser(null); }, []);
  return <Ctx.Provider value={{ user, loading, signIn, register, signOut }}>{children}</Ctx.Provider>;
}
