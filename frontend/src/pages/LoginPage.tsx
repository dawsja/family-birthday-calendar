import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ThemeToggle } from "../components/ThemeToggle";

export default function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await login(username, password);
      nav("/", { replace: true });
    } catch (e: any) {
      setErr(e?.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[rgb(var(--bg))]">
      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-8">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">Family Birthday Calendar</div>
          <ThemeToggle />
        </div>

        <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-4 shadow-sm">
          <div className="mb-3 text-sm text-[rgb(var(--muted))]">
            Sign in to the shared family calendar.
          </div>
          <form className="flex flex-col gap-3" onSubmit={onSubmit}>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[rgb(var(--muted))]">Username</span>
              <input
                className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                inputMode="text"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[rgb(var(--muted))]">Password</span>
              <input
                className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            {err ? <div className="text-sm text-red-600">{err}</div> : null}
            <button
              className="mt-1 rounded-lg bg-[rgb(var(--primary))] px-3 py-2 text-sm font-semibold text-[rgb(var(--primary-foreground))] disabled:opacity-60"
              type="submit"
              disabled={busy}
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <div className="text-xs text-[rgb(var(--muted))]">
          Admin creates accounts. Normal users will set birthday + Venmo on first login.
        </div>
      </div>
    </div>
  );
}

