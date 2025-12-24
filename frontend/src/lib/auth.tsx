import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch, setCsrfToken } from "./api";
import type { User } from "./types";

type LoginResult =
  | { ok: true }
  | { needsPasswordSet: true; setupToken: string; username: string; displayName: string | null };

type AuthCtx = {
  user: User | null;
  loading: boolean;
  csrfToken: string | null;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<LoginResult>;
  setPassword: (setupToken: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (input: { displayName?: string; birthday: string; venmo: string }) => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [csrf, setCsrf] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await apiFetch<{ user: User }>("/api/me");
      setUser(me.user);
      const t = await apiFetch<{ csrfToken: string }>("/api/auth/csrf");
      setCsrf(t.csrfToken);
      setCsrfToken(t.csrfToken);
    } catch (e: any) {
      if (e?.status === 401) {
        setUser(null);
        setCsrf(null);
        setCsrfToken(null);
      } else {
        throw e;
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    const r = await apiFetch<
      | { user: User; csrfToken: string }
      | { needsPasswordSet: true; setupToken: string; username: string; displayName: string | null }
    >("/api/auth/login", {
      method: "POST",
      body: { username, password }
    });
    if ("needsPasswordSet" in r) return r;

    setUser(r.user);
    setCsrf(r.csrfToken);
    setCsrfToken(r.csrfToken);
    return { ok: true };
  }, []);

  const setPassword = useCallback(async (setupToken: string, password: string) => {
    const r = await apiFetch<{ user: User; csrfToken: string }>("/api/auth/set-password", {
      method: "POST",
      body: { setupToken, password }
    });
    setUser(r.user);
    setCsrf(r.csrfToken);
    setCsrfToken(r.csrfToken);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch<{ ok: true }>("/api/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      setCsrf(null);
      setCsrfToken(null);
    }
  }, []);

  const updateProfile = useCallback(
    async (input: { displayName?: string; birthday: string; venmo: string }) => {
      const r = await apiFetch<{ user: User }>("/api/me/profile", { method: "PUT", body: input });
      setUser(r.user);
    },
    []
  );

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      loading,
      csrfToken: csrf,
      refresh,
      login,
      setPassword,
      logout,
      updateProfile
    }),
    [user, loading, csrf, refresh, login, setPassword, logout, updateProfile]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}

