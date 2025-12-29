import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { getDb } from "./db";
import { getEnv } from "./db";

export type UserRole = "user" | "admin";

export type AuthedUser = {
  id: string;
  username: string;
  displayName: string | null;
  role: UserRole;
  birthday: string | null;
  venmo: string | null;
  lastLoginAt: number | null;
};

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthedUser;
    session?: { id: string; csrfToken: string };
  }
}

const SESSION_COOKIE_NAME = "fbc_session";

export function sessionCookieName() {
  return SESSION_COOKIE_NAME;
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token || typeof token !== "string") return next();

  const db = getDb();
  const now = Date.now();
  const row = db
    .prepare(
      `SELECT
         s.id as session_id,
         s.csrf_token as csrf_token,
         u.id as user_id,
         u.username as username,
         u.display_name as display_name,
         u.role as role,
         u.birthday as birthday,
         u.venmo as venmo,
         u.last_login_at as last_login_at,
         s.expires_at as expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`
    )
    .get(token) as
    | {
        session_id: string;
        csrf_token: string;
        user_id: string;
        username: string;
        display_name: string | null;
        role: UserRole;
        birthday: string | null;
        venmo: string | null;
        last_login_at: number | null;
        expires_at: number;
      }
    | undefined;

  if (!row) return next();
  if (row.expires_at <= now) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(token);
    return next();
  }

  req.session = { id: row.session_id, csrfToken: row.csrf_token };
  req.user = {
    id: row.user_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    birthday: row.birthday,
    venmo: row.venmo,
    lastLoginAt: row.last_login_at
  };

  return next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !req.session) {
    return res.status(401).json({ error: "unauthorized" });
  }
  return next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "forbidden" });
  }
  return next();
}

export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  // Only protect state-changing requests; keep GET/HEAD/OPTIONS unblocked.
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();

  if (!req.session) return res.status(401).json({ error: "unauthorized" });

  const token = req.header("x-csrf-token");
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).json({ error: "csrf" });
  }
  return next();
}

export function newSession(userId: string) {
  const env = getEnv();
  const id = crypto.randomBytes(32).toString("base64url");
  const csrfToken = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

  const db = getDb();
  db.prepare(
    `INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, userId, csrfToken, now, expiresAt);

  return { id, csrfToken, expiresAt };
}

export function clearSession(sessionId: string) {
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function setSessionCookie(res: Response, sessionId: string, expiresAt: number) {
  const env = getEnv();
  const maxAgeMs = Math.max(0, expiresAt - Date.now());
  res.cookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "strict",
    secure: env.NODE_ENV === "production",
    path: "/",
    // Make it persistent across browser restarts (otherwise it's a session cookie).
    maxAge: maxAgeMs,
    expires: new Date(expiresAt)
  });
}

export function clearSessionCookie(res: Response) {
  const env = getEnv();
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "strict",
    secure: env.NODE_ENV === "production",
    path: "/"
  });
}

