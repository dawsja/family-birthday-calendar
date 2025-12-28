import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Modal } from "../components/Modal";

type AdminUser = {
  id: string;
  username: string;
  displayName: string | null;
  role: "user" | "admin";
  createdAt: number;
  lastLoginAt: number | null;
  birthday: string | null;
  venmo: string | null;
  mustSetPassword: boolean;
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

  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editBirthday, setEditBirthday] = useState("");
  const [editVenmo, setEditVenmo] = useState("");
  const [editRole, setEditRole] = useState<"user" | "admin">("user");
  const [editBusy, setEditBusy] = useState(false);

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

  const openEdit = (u: AdminUser) => {
    setEditUser(u);
    setEditUsername(u.username);
    setEditDisplayName(u.displayName ?? "");
    setEditBirthday(u.birthday ?? "");
    setEditVenmo(u.venmo ?? "");
    setEditRole(u.role);
    setEditOpen(true);
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
          ...(role === "admin" ? { password } : {}),
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

  const resetSetup = async (u: AdminUser) => {
    const ok = window.confirm(
      `Reset setup for '${u.username}'?\n\nThis clears birthday + Venmo and requires setup again on next login.`
    );
    if (!ok) return;
    setErr(null);
    try {
      await apiFetch<{ ok: true }>(`/api/admin/users/${encodeURIComponent(u.id)}`, {
        method: "PATCH",
        body: { birthday: null, venmo: null, lastLoginAt: null }
      });
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to reset setup");
    }
  };

  const saveEdit = async () => {
    if (!editUser) return;
    setErr(null);
    setEditBusy(true);
    try {
      await apiFetch<{ ok: true }>(`/api/admin/users/${encodeURIComponent(editUser.id)}`, {
        method: "PATCH",
        body: {
          username: editUsername.trim().toLowerCase() || undefined,
          displayName: editDisplayName.trim() ? editDisplayName.trim() : null,
          birthday: editBirthday ? editBirthday : null,
          venmo: editVenmo.trim() ? editVenmo.trim() : null,
          role: editRole
        }
      });
      setEditOpen(false);
      setEditUser(null);
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update user");
    } finally {
      setEditBusy(false);
    }
  };

  const deleteUser = async (u: AdminUser) => {
    const ok = window.confirm(
      `Delete user '${u.username}'?\n\nThis removes their sessions and life updates too.`
    );
    if (!ok) return;
    setErr(null);
    try {
      await apiFetch<{ ok: true }>(`/api/admin/users/${encodeURIComponent(u.id)}`, {
        method: "DELETE"
      });
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to delete user");
    }
  };

  return (
    <div className="min-h-dvh bg-[rgb(var(--bg))]">
      <div className="sticky top-0 z-10 border-b border-[rgb(var(--border))] bg-[rgb(var(--bg))]/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-3 py-2">
          <div className="flex items-center gap-2">
            <Link
              className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-1.5 text-sm hover:bg-white/5"
              to="/"
            >
              ← Calendar
            </Link>
            <div className="text-sm font-semibold">Admin</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-1.5 text-sm hover:bg-white/5"
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
            Accounts are provisioned by admin. Users will set their password on first login (no temporary
            passwords to deliver).
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
              <span className="text-[rgb(var(--muted))]">Role</span>
              <select
                className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
                value={role}
                onChange={(e) => {
                  const next = e.target.value as any;
                  setRole(next);
                  if (next !== "admin") setPassword("");
                }}
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </label>
            {role === "admin" ? (
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[rgb(var(--muted))]">Admin password</span>
                <input
                  className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  minLength={12}
                  required
                />
              </label>
            ) : null}
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
              className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-1.5 text-sm hover:bg-white/5"
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
                        {u.mustSetPassword ? (
                          <div className="text-xs text-[rgb(var(--muted))]">Password not set</div>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">{u.role}</td>
                      <td className="py-2 pr-3">
                        {u.birthday ? <span className="font-mono text-xs">{u.birthday}</span> : "—"}
                      </td>
                      <td className="py-2 pr-3">{u.venmo ?? "—"}</td>
                      <td className="py-2 pr-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-1.5 text-xs hover:bg-white/5"
                            type="button"
                            onClick={() => openEdit(u)}
                          >
                            Edit
                          </button>
                          <button
                            className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-1.5 text-xs hover:bg-white/5"
                            type="button"
                            onClick={() => resetSetup(u)}
                          >
                            Reset setup
                          </button>
                          <button
                            className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-1.5 text-xs hover:bg-white/5"
                            type="button"
                            onClick={() => resetPassword(u.id)}
                          >
                            Reset password
                          </button>
                          <button
                            className="rounded-full border border-red-900/50 bg-[rgb(var(--card))] px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/30"
                            type="button"
                            onClick={() => deleteUser(u)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={editOpen}
        title={editUser ? `Edit user: ${editUser.username}` : "Edit user"}
        onClose={() => setEditOpen(false)}
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[rgb(var(--muted))]">Username</span>
            <input
              className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
              value={editUsername}
              onChange={(e) => setEditUsername(e.target.value)}
              placeholder="jane.doe"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[rgb(var(--muted))]">Display name</span>
            <input
              className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
              value={editDisplayName}
              onChange={(e) => setEditDisplayName(e.target.value)}
              placeholder="Jane"
            />
            <span className="text-xs text-[rgb(var(--muted))]">Leave blank to clear.</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[rgb(var(--muted))]">Birthday</span>
            <input
              className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
              type="date"
              value={editBirthday}
              onChange={(e) => setEditBirthday(e.target.value)}
            />
            <span className="text-xs text-[rgb(var(--muted))]">Leave blank to clear.</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[rgb(var(--muted))]">Venmo</span>
            <input
              className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
              value={editVenmo}
              onChange={(e) => setEditVenmo(e.target.value)}
              placeholder="@yourname"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <span className="text-xs text-[rgb(var(--muted))]">Leave blank to clear.</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[rgb(var(--muted))]">Role</span>
            <select
              className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
              value={editRole}
              onChange={(e) => setEditRole(e.target.value as any)}
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button
            className="rounded-lg bg-[rgb(var(--primary))] px-3 py-2 text-sm font-semibold text-[rgb(var(--primary-foreground))] disabled:opacity-60"
            disabled={editBusy || !editUser}
            type="button"
            onClick={saveEdit}
          >
            {editBusy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

