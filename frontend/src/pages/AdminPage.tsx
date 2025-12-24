import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "../components/ThemeToggle";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";

type AdminUser = {
  id: string;
  username: string;
  displayName: string | null;
  role: "user" | "admin";
  birthday: string | null;
  venmo: string | null;
  createdAt: number;
  lastLoginAt: number | null;
};

export default function AdminPage() {
  const { user, logout } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setErr(null);
    setLoading(true);
    try {
      const r = await apiFetch<{ users: AdminUser[] }>("/api/admin/users");
      setUsers(r.users);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!user) {
    return (
      <div className="min-h-dvh grid place-items-center text-sm text-[rgb(var(--muted))]">
        Not signed in.
      </div>
    );
  }

  if (user.role !== "admin") {
    return (
      <div className="min-h-dvh grid place-items-center text-sm text-[rgb(var(--muted))]">
        Forbidden.
      </div>
    );
  }

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiFetch<{ id: string }>("/api/admin/users", {
        method: "POST",
        body: {
          username,
          displayName: displayName || undefined,
          password,
          role
        }
      });
      setUsername("");
      setDisplayName("");
      setPassword("");
      setRole("user");
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to create user");
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (id: string) => {
    const next = window.prompt("Enter a new password (min 12 chars):");
    if (!next) return;
    setErr(null);
    try {
      await apiFetch<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, {
        method: "POST",
        body: { password: next }
      });
      alert("Password reset. User sessions revoked.");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to reset password");
    }
  };

  return (
    <div className="min-h-dvh bg-[rgb(var(--bg))]">
      <div className="sticky top-0 z-10 border-b border-[rgb(var(--border))] bg-[rgb(var(--bg))]/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-3 py-2">
          <div className="flex items-center gap-2">
            <Link
              className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5"
              to="/"
            >
              ← Calendar
            </Link>
            <div className="text-sm font-semibold">Admin</div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5"
              onClick={() => logout()}
              type="button"
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-3 py-4">
        <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-4">
          <div className="mb-2 text-sm font-semibold">Create user</div>
          <div className="mb-3 text-xs text-[rgb(var(--muted))]">
            Accounts are provisioned by admin. Users will set birthday + Venmo on first login.
          </div>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={onCreate}>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[rgb(var(--muted))]">Username</span>
              <input
                className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="jane.doe"
                required
              />
              <span className="text-[rgb(var(--muted))] text-xs">3–32 chars: a-z 0-9 . _ -</span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[rgb(var(--muted))]">Display name (optional)</span>
              <input
                className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Jane"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[rgb(var(--muted))]">Temporary password</span>
              <input
                className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                minLength={12}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[rgb(var(--muted))]">Role</span>
              <select
                className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <div className="sm:col-span-2">
              <button
                className="rounded-lg bg-[rgb(var(--primary))] px-3 py-2 text-sm font-semibold text-[rgb(var(--primary-foreground))] disabled:opacity-60"
                disabled={busy}
                type="submit"
              >
                {busy ? "Creating…" : "Create user"}
              </button>
            </div>
          </form>
          {err ? <div className="mt-3 text-sm text-red-600">{err}</div> : null}
        </div>

        <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold">Users</div>
            <button
              className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5"
              type="button"
              onClick={refresh}
              disabled={loading}
            >
              Refresh
            </button>
          </div>
          {loading ? (
            <div className="text-sm text-[rgb(var(--muted))]">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-[rgb(var(--muted))]">
                  <tr>
                    <th className="py-2 pr-3">Username</th>
                    <th className="py-2 pr-3">Role</th>
                    <th className="py-2 pr-3">Birthday</th>
                    <th className="py-2 pr-3">Venmo</th>
                    <th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-[rgb(var(--border))]">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{u.username}</div>
                        {u.displayName ? (
                          <div className="text-xs text-[rgb(var(--muted))]">{u.displayName}</div>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">{u.role}</td>
                      <td className="py-2 pr-3">{u.birthday ?? "—"}</td>
                      <td className="py-2 pr-3">{u.venmo ?? "—"}</td>
                      <td className="py-2 pr-3 text-right">
                        <button
                          className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/5"
                          type="button"
                          onClick={() => resetPassword(u.id)}
                        >
                          Reset password
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

