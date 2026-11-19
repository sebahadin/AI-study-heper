import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, errorMessage } from '../services/api';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string;
  refresh: () => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api<{ user: User }>('/auth/me')
      .then((data) => { if (active) { setUser(data.user); } })
      .catch((reason) => {
        if (active) {
          setUser(null);
          if (!(reason instanceof ApiError && reason.status === 401)) { setError(errorMessage(reason)); }
        }
      })
      .finally(() => { if (active) { setLoading(false); } });
    return () => { active = false; };
  }, [revision]);
  useEffect(() => {
    const expire = () => setUser(null);
    window.addEventListener('classmate:unauthenticated', expire);
    return () => window.removeEventListener('classmate:unauthenticated', expire);
  }, []);
  async function login(username: string, password: string) {
    const data = await api<{ user: User }>('/auth/login', { method: 'POST', body: { username, password } });
    setUser(data.user);
  }
  async function logout() {
    try { await api<void>('/auth/logout', { method: 'POST' }); }
    catch (reason) { if (!(reason instanceof ApiError && reason.status === 401)) { throw reason; } }
    setUser(null);
  }
  return <AuthContext.Provider value={{ user, loading, error, refresh, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) { throw new Error('Authentication provider is missing.'); }
  return context;
}
