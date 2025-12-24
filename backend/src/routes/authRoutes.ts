import { Router } from "express";
import rateLimit from "express-rate-limit";
import argon2 from "argon2";
import { z } from "zod";
import crypto from "node:crypto";
import { getDb } from "../db";
import { clearSession, clearSessionCookie, newSession, setSessionCookie } from "../auth";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: true,
  legacyHeaders: false
});

const LoginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().max(256).optional().default("")
});

router.post("/login", loginLimiter, async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

  const { username, password } = parsed.data;
  const db = getDb();
  const user = db
    .prepare(
      `SELECT id, username, display_name, password_hash, must_set_password, role, birthday, venmo, last_login_at
       FROM users
       WHERE lower(username) = lower(?)`
    )
    .get(username) as
    | {
        id: string;
        username: string;
        display_name: string | null;
        password_hash: string | null;
        must_set_password: 0 | 1;
        role: "user" | "admin";
        birthday: string | null;
        venmo: string | null;
        last_login_at: number | null;
      }
    | undefined;

  // Avoid username probing; keep response uniform.
  if (!user) return res.status(401).json({ error: "invalid_credentials" });

  // No password set yet: first login must set a password.
  if (user.must_set_password === 1 || !user.password_hash) {
    // Keep only one active token at a time.
    db.prepare("DELETE FROM password_set_tokens WHERE user_id = ?").run(user.id);
    const id = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    const expiresAt = now + 15 * 60 * 1000;
    db.prepare(
      `INSERT INTO password_set_tokens (id, user_id, created_at, expires_at)
       VALUES (?, ?, ?, ?)`
    ).run(id, user.id, now, expiresAt);
    return res.json({
      needsPasswordSet: true,
      setupToken: id,
      username: user.username,
      displayName: user.display_name
    });
  }

  const ok = await argon2.verify(user.password_hash, password);
  if (!ok) return res.status(401).json({ error: "invalid_credentials" });

  // Limit session sprawl for this user.
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);

  const session = newSession(user.id);
  setSessionCookie(res, session.id);

  // "First login" onboarding:
  // - Only normal users get prompted
  // - Only on first login (tracked via last_login_at)
  // - Keep last_login_at NULL until profile setup is completed so the prompt stays enforced
  const needsSetup =
    user.role === "user" && user.last_login_at == null && (!user.birthday || !user.venmo);
  const loginAt = Date.now();
  if (!needsSetup) {
    db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(loginAt, user.id);
  }

  return res.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      birthday: user.birthday,
      venmo: user.venmo,
      lastLoginAt: needsSetup ? null : loginAt,
      needsSetup
    },
    csrfToken: session.csrfToken
  });
});

const SetPasswordSchema = z.object({
  setupToken: z.string().min(1).max(256),
  password: z.string().min(12).max(256)
});

router.post("/set-password", async (req, res) => {
  const parsed = SetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

  const db = getDb();
  const token = db
    .prepare(`SELECT id, user_id, expires_at FROM password_set_tokens WHERE id = ?`)
    .get(parsed.data.setupToken) as { id: string; user_id: string; expires_at: number } | undefined;

  if (!token) return res.status(401).json({ error: "invalid_setup_token" });
  if (token.expires_at <= Date.now()) {
    db.prepare("DELETE FROM password_set_tokens WHERE id = ?").run(token.id);
    return res.status(401).json({ error: "invalid_setup_token" });
  }

  const u = db
    .prepare(
      `SELECT id, username, display_name, role, birthday, venmo, last_login_at
       FROM users WHERE id = ?`
    )
    .get(token.user_id) as
    | {
        id: string;
        username: string;
        display_name: string | null;
        role: "user" | "admin";
        birthday: string | null;
        venmo: string | null;
        last_login_at: number | null;
      }
    | undefined;
  if (!u) {
    db.prepare("DELETE FROM password_set_tokens WHERE id = ?").run(token.id);
    return res.status(401).json({ error: "invalid_setup_token" });
  }

  const passwordHash = await argon2.hash(parsed.data.password, { type: argon2.argon2id });
  db.prepare("UPDATE users SET password_hash = ?, must_set_password = 0 WHERE id = ?").run(
    passwordHash,
    u.id
  );
  db.prepare("DELETE FROM password_set_tokens WHERE id = ?").run(token.id);

  // New password => revoke old sessions and create a fresh one.
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
  const session = newSession(u.id);
  setSessionCookie(res, session.id);

  const needsSetup = u.role === "user" && u.last_login_at == null && (!u.birthday || !u.venmo);
  const loginAt = Date.now();
  if (!needsSetup) {
    db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(loginAt, u.id);
  }

  return res.json({
    user: {
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      role: u.role,
      birthday: u.birthday,
      venmo: u.venmo,
      lastLoginAt: needsSetup ? null : loginAt,
      needsSetup
    },
    csrfToken: session.csrfToken
  });
});

router.post("/logout", (req, res) => {
  const sessionId = req.cookies?.fbc_session;
  if (sessionId && typeof sessionId === "string") {
    clearSession(sessionId);
  }
  clearSessionCookie(res);
  return res.json({ ok: true });
});

router.get("/csrf", (req, res) => {
  if (!req.session) return res.status(401).json({ error: "unauthorized" });
  return res.json({ csrfToken: req.session.csrfToken });
});

export default router;

