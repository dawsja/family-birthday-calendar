import { Router } from "express";
import rateLimit from "express-rate-limit";
import argon2 from "argon2";
import { z } from "zod";
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
  password: z.string().min(1).max(256)
});

router.post("/login", loginLimiter, async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

  const { username, password } = parsed.data;
  const db = getDb();
  const user = db
    .prepare(
      `SELECT id, username, display_name, password_hash, role, birthday, venmo, last_login_at
       FROM users
       WHERE lower(username) = lower(?)`
    )
    .get(username) as
    | {
        id: string;
        username: string;
        display_name: string | null;
        password_hash: string;
        role: "user" | "admin";
        birthday: string | null;
        venmo: string | null;
        last_login_at: number | null;
      }
    | undefined;

  // Avoid username probing; keep response uniform.
  if (!user) return res.status(401).json({ error: "invalid_credentials" });

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

