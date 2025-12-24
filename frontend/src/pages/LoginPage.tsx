import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ThemeToggle } from "../components/ThemeToggle";
import { Modal } from "../components/Modal";

export default function LoginPage() {
  const { login, setPassword: setPasswordApi } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [pwOpen, setPwOpen] = useState(false);
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await login(username, password);
      if ("needsPasswordSet" in r && r.needsPasswordSet) {
        setSetupToken(r.setupToken);
        setPwOpen(true);
        setNewPw("");
        setNewPw2("");
        setPwErr(null);
        return;
      }
      nav("/", { replace: true });
    } catch (e: any) {
      setErr(e?.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  };

  const onSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwErr(null);
    if (!setupToken) return;
    if (newPw.length < 12) return setPwErr("Password must be at least 12 characters.");
    if (newPw !== newPw2) return setPwErr("Passwords do not match.");
    setPwBusy(true);
    try {
      await setPasswordApi(setupToken, newPw);
      setPwOpen(false);
      setSetupToken(null);
      setPassword("");
      nav("/", { replace: true });
    } catch (e: any) {
      setPwErr(e?.message ?? "Failed to set password");
    } finally {
      setPwBusy(false);
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
              />
              <span className="text-xs text-[rgb(var(--muted))]">
                First login? Leave this blank and you’ll be prompted to set a password.
              </span>
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

      <Modal
        open={pwOpen}
        title={`Set your password${username ? `: ${username.trim()}` : ""}`}
        onClose={() => {
          if (pwBusy) return;
          setPwOpen(false);
        }}
      >
        <form className="flex flex-col gap-3" onSubmit={onSetPassword}>
          <div className="text-sm text-[rgb(var(--muted))]">
            This account doesn’t have a password yet. Choose a new password to continue.
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[rgb(var(--muted))]">New password</span>
            <input
              className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              type="password"
              minLength={12}
              autoComplete="new-password"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[rgb(var(--muted))]">Confirm password</span>
            <input
              className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
              value={newPw2}
              onChange={(e) => setNewPw2(e.target.value)}
              type="password"
              minLength={12}
              autoComplete="new-password"
              required
            />
          </label>
          {pwErr ? <div className="text-sm text-red-600">{pwErr}</div> : null}
          <button
            className="rounded-lg bg-[rgb(var(--primary))] px-3 py-2 text-sm font-semibold text-[rgb(var(--primary-foreground))] disabled:opacity-60"
            type="submit"
            disabled={pwBusy || !setupToken}
          >
            {pwBusy ? "Saving…" : "Save password & continue"}
          </button>
        </form>
      </Modal>
    </div>
  );
}

