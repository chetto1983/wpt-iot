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
  avatar?: string | null;
  language: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, language: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Check existing session on mount.
  // Uses raw fetch instead of apiFetch to avoid the 401 → redirect loop:
  // apiFetch redirects to /?expired on 401, which reloads the page,
  // which calls checkSession again → 401 → redirect → infinite loop.
  useEffect(() => {
    let cancelled = false;
    async function checkSession() {
      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('No session');
        const data = (await res.json()) as User;
        if (!cancelled) {
          setUser(data);
        }
      } catch {
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

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = (await res.json()) as User;
      setUser(data);
    } catch {
      // Ignore — user state stays as-is
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout, refreshUser }),
    [user, loading, login, logout, refreshUser],
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
