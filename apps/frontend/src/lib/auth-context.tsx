'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { apiFetch } from '@/lib/api';

interface User {
  id: number;
  username: string;
  role: string;
  language: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, language: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Check existing session on mount
  useEffect(() => {
    let cancelled = false;
    async function checkSession() {
      try {
        const data = await apiFetch<User>('/auth/me');
        if (!cancelled) {
          setUser(data);
        }
      } catch {
        // 401 or network error — no session
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void checkSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (username: string, password: string, language: string) => {
      // Use raw fetch for login to avoid apiFetch's 401 redirect behavior.
      // A 401 on login means "invalid credentials", not "session expired".
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, language }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body as Record<string, string>).error ?? `Request failed: ${res.status}`;
        throw new Error(msg);
      }

      const data = (await res.json()) as User;
      setUser(data);

      // Set NEXT_LOCALE cookie for next-intl SSR
      document.cookie = `NEXT_LOCALE=${language};path=/;max-age=31536000`;

      // Full page navigation to pick up the new locale server-side
      window.location.href = '/dashboard';
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore errors — clear local state regardless
    }
    setUser(null);
    window.location.href = '/';
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
