/**
 * Session state. Storage is unchanged (localStorage); on load the stored token
 * is validated with GET /auth/me and the server's role/name replace the cached
 * values. Any 401 on an authenticated request ends the session (api.ts).
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from './api';
import { isRole, type Role } from './navigation';

export type { Role } from './navigation';

export interface Session {
  token: string;
  role: Role;
  displayName: string;
}

/** 'checking' while the stored token is being validated on load. */
export type SessionStatus = 'checking' | 'ready';

interface AuthContextValue {
  session: Session | null;
  status: SessionStatus;
  login: (s: Session) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const KEYS = { token: 'cq_token', role: 'cq_role', name: 'cq_name' } as const;

function readSession(): Session | null {
  const token = localStorage.getItem(KEYS.token);
  const role = localStorage.getItem(KEYS.role);
  const displayName = localStorage.getItem(KEYS.name);
  if (token && isRole(role) && displayName) return { token, role, displayName };
  // Incomplete or tampered values: discard rather than send a stray token later.
  if (token || role || displayName) clearSession();
  return null;
}

function writeSession(s: Session): void {
  localStorage.setItem(KEYS.token, s.token);
  localStorage.setItem(KEYS.role, s.role);
  localStorage.setItem(KEYS.name, s.displayName);
}

function clearSession(): void {
  localStorage.removeItem(KEYS.token);
  localStorage.removeItem(KEYS.role);
  localStorage.removeItem(KEYS.name);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(readSession);
  const [status, setStatus] = useState<SessionStatus>(() => (readSession() ? 'checking' : 'ready'));

  const login = useCallback((s: Session) => {
    writeSession(s);
    setSession(s);
    setStatus('ready');
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setSession(null);
    setStatus('ready');
  }, []);

  // Central 401 handling: an expired/invalid token anywhere ends the session;
  // route guards then redirect to /login.
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // Validate the stored session once on load.
  useEffect(() => {
    const stored = readSession();
    if (!stored) return;
    let cancelled = false;
    api
      .me()
      .then(({ user }) => {
        if (cancelled) return;
        if (!isRole(user.role)) {
          logout();
          return;
        }
        const fresh: Session = { token: stored.token, role: user.role, displayName: user.displayName };
        writeSession(fresh);
        setSession(fresh);
        setStatus('ready');
      })
      .catch((err: { code?: string }) => {
        if (cancelled) return;
        // 401 is already handled (logout). Any other failure (e.g. the API is
        // unreachable) keeps the cached session rather than signing out.
        if (err?.code !== 'UNAUTHENTICATED' && err?.code !== 'INVALID_TOKEN') setStatus('ready');
      });
    return () => {
      cancelled = true;
    };
  }, [logout]);

  return (
    <AuthContext.Provider value={{ session, status, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
