import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import express, { Router } from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import argon2 from "argon2";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  authMiddleware,
  clearSession,
  clearSessionCookie,
  newSession,
  requireAdmin,
  requireAuth,
  requireCsrf,
  setSessionCookie
} from "./auth";
import { getDb, getEnv } from "./db";

const env = getEnv();

// Ensure DB initialized early (includes bootstrap admin).
getDb();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    redact: ["req.headers.authorization", "req.headers.cookie"]
  })
);

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "50kb" }));
app.use(cookieParser());

// Security headers
app.use(
  helmet({
    contentSecurityPolicy:
      env.NODE_ENV === "production"
        ? {
            useDefaults: true,
            directives: {
              "default-src": ["'self'"],
              "base-uri": ["'self'"],
              "frame-ancestors": ["'none'"],
              "img-src": ["'self'", "data:"],
              // Tailwind + FullCalendar include inline styles; keep tight otherwise.
              "style-src": ["'self'", "'unsafe-inline'"],
              // Some CSP implementations split these out. FullCalendar injects a <style> tag at runtime.
              "style-src-elem": ["'self'", "'unsafe-inline'"],
              "style-src-attr": ["'self'", "'unsafe-inline'"],
              // FullCalendar embeds its icon font via a data: URL in injected CSS.
              "font-src": ["'self'", "data:"],
              "script-src": ["'self'"],
              "connect-src": ["'self'"],
              "object-src": ["'none'"],
              "upgrade-insecure-requests": []
            }
          }
        : false
  })
);

// CORS for local dev only (frontend runs on a different port).
if (env.NODE_ENV !== "production") {
  app.use(
    cors({
      origin: env.APP_ORIGIN,
      credentials: true
    })
  );
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api", apiLimiter);
app.use(authMiddleware);

// CSRF protection for all state-changing API calls except login.
app.use("/api", (req, res, next) => {
  if (
    req.path === "/auth/login" ||
    req.path === "/auth/logout" ||
    req.path === "/auth/set-password"
  ) {
    return next();
  }
  return requireCsrf(req, res, next);
});

// -----------------------------
// Routes (flattened into one file)
// -----------------------------

const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, "invalid_date");

const BirthdaySchema = IsoDate;
const VenmoSchema = z
  .string()
  .trim()
  .regex(/^@[A-Za-z0-9_-]{1,30}$/);

// /api/auth
const authRouter = Router();

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

authRouter.post("/login", loginLimiter, async (req, res) => {
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
  setSessionCookie(res, session.id, session.expiresAt);

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

authRouter.post("/set-password", async (req, res) => {
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
  setSessionCookie(res, session.id, session.expiresAt);

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

authRouter.post("/logout", (req, res) => {
  const sessionId = req.cookies?.fbc_session;
  if (sessionId && typeof sessionId === "string") {
    clearSession(sessionId);
  }
  clearSessionCookie(res);
  return res.json({ ok: true });
});

authRouter.get("/csrf", (req, res) => {
  if (!req.session) return res.status(401).json({ error: "unauthorized" });
  return res.json({ csrfToken: req.session.csrfToken });
});

// /api/me
const meRouter = Router();

meRouter.get("/", requireAuth, (req, res) => {
  const u = req.user!;
  const needsSetup = u.role === "user" && u.lastLoginAt == null && (!u.birthday || !u.venmo);
  return res.json({ user: { ...u, needsSetup } });
});

const ProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    birthday: BirthdaySchema.optional(),
    venmo: VenmoSchema.optional()
  })
  .refine((v) => v.displayName || v.birthday || v.venmo, "empty_update");

meRouter.put("/profile", requireAuth, (req, res) => {
  const parsed = ProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

  const { birthday, venmo, displayName } = parsed.data;
  const db = getDb();

  db.prepare(
    `UPDATE users
     SET birthday = COALESCE(@birthday, birthday),
         venmo = COALESCE(@venmo, venmo),
         display_name = COALESCE(@display_name, display_name)
     WHERE id = @id`
  ).run({
    id: req.user!.id,
    birthday: birthday ?? null,
    venmo: venmo ?? null,
    display_name: displayName ?? null
  });

  let updated = db
    .prepare(
      `SELECT id, username, display_name, role, birthday, venmo, last_login_at
       FROM users WHERE id = ?`
    )
    .get(req.user!.id) as {
    id: string;
    username: string;
    display_name: string | null;
    role: "user" | "admin";
    birthday: string | null;
    venmo: string | null;
    last_login_at: number | null;
  };

  // If this was the first login and the user completed required fields, finalize first login.
  if (updated.role === "user" && updated.last_login_at == null && updated.birthday && updated.venmo) {
    const t = Date.now();
    db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(t, updated.id);
    updated = { ...updated, last_login_at: t };
  }

  req.user = {
    id: updated.id,
    username: updated.username,
    displayName: updated.display_name,
    role: updated.role,
    birthday: updated.birthday,
    venmo: updated.venmo,
    lastLoginAt: updated.last_login_at
  };

  const needsSetup =
    req.user.role === "user" && req.user.lastLoginAt == null && (!req.user.birthday || !req.user.venmo);
  return res.json({ user: { ...req.user, needsSetup } });
});

// /api/calendar
const calendarRouter = Router();

const QuerySchema = z.object({
  start: IsoDate,
  end: IsoDate
});

function isLeapYear(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function compareIso(a: string, b: string) {
  // ISO YYYY-MM-DD compares lexicographically.
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

calendarRouter.get("/", requireAuth, (req, res) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

  const { start, end } = parsed.data;
  if (compareIso(end, start) <= 0) return res.status(400).json({ error: "invalid_range" });

  const db = getDb();

  const updates = db
    .prepare(
      `SELECT
         u.id as id,
         u.user_id as user_id,
         u.date as date,
         u.title as title,
         u.body as body,
         u.color_id as color_id,
         usr.username as username,
         usr.display_name as display_name
       FROM updates u
       JOIN users usr ON usr.id = u.user_id
       WHERE u.date >= ? AND u.date < ?
       ORDER BY u.date ASC, u.created_at ASC`
    )
    .all(start, end) as Array<{
    id: string;
    user_id: string;
    date: string;
    title: string;
    body: string | null;
    color_id: string | null;
    username: string;
    display_name: string | null;
  }>;

  const users = db
    .prepare(
      `SELECT id, username, display_name, birthday, venmo
       FROM users
       WHERE birthday IS NOT NULL`
    )
    .all() as Array<{
    id: string;
    username: string;
    display_name: string | null;
    birthday: string;
    venmo: string | null;
  }>;

  const startYear = Number(start.slice(0, 4));
  const endYearExclusive = Number(end.slice(0, 4)) + 1;

  const birthdayEvents: Array<any> = [];
  for (const user of users) {
    const md = user.birthday.slice(5); // MM-DD
    for (let year = startYear; year < endYearExclusive; year++) {
      let date = `${year}-${md}`;
      if (md === "02-29" && !isLeapYear(year)) {
        date = `${year}-02-28`;
      }
      if (compareIso(date, start) >= 0 && compareIso(date, end) < 0) {
        const name = user.display_name || user.username;
        const venmoLabel = user.venmo ? ` • ${user.venmo}` : "";
        birthdayEvents.push({
          id: `bday:${user.id}:${date}`,
          type: "birthday",
          title: `${name} • Birthday${venmoLabel}`,
          start: date,
          allDay: true,
          extendedProps: {
            userId: user.id,
            name,
            venmo: user.venmo
          }
        });
      }
    }
  }

  const updateEvents = updates.map((u) => ({
    id: `upd:${u.id}`,
    type: "update",
    title: u.title,
    start: u.date,
    allDay: true,
    extendedProps: {
      updateId: u.id,
      userId: u.user_id,
      author: u.display_name || u.username,
      body: u.body,
      colorId: u.color_id ?? undefined
    }
  }));

  return res.json({ events: [...birthdayEvents, ...updateEvents] });
});

// /api/updates
const updatesRouter = Router();

const UpdateSchema = z.object({
  date: IsoDate,
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(2000).optional(),
  colorId: z.string().trim().min(1).max(32).optional()
});

updatesRouter.post("/", requireAuth, (req, res) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

  const db = getDb();
  const id = nanoid();
  const now = Date.now();

  db.prepare(
    `INSERT INTO updates (id, user_id, date, title, body, color_id, created_at, updated_at)
     VALUES (@id, @user_id, @date, @title, @body, @color_id, @created_at, @updated_at)`
  ).run({
    id,
    user_id: req.user!.id,
    date: parsed.data.date,
    title: parsed.data.title,
    body: parsed.data.body ?? null,
    color_id: parsed.data.colorId ?? null,
    created_at: now,
    updated_at: now
  });

  return res.json({ id });
});

updatesRouter.put("/:id", requireAuth, (req, res) => {
  const id = req.params.id ?? "";
  if (!id) return res.status(400).json({ error: "invalid_request" });

  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

  const db = getDb();
  const existing = db
    .prepare(`SELECT user_id FROM updates WHERE id = ?`)
    .get(id) as { user_id: string } | undefined;
  if (!existing) return res.status(404).json({ error: "not_found" });

  const canEdit = existing.user_id === req.user!.id || req.user!.role === "admin";
  if (!canEdit) return res.status(403).json({ error: "forbidden" });

  db.prepare(
    `UPDATE updates
     SET date = @date, title = @title, body = @body, color_id = @color_id, updated_at = @updated_at
     WHERE id = @id`
  ).run({
    id,
    date: parsed.data.date,
    title: parsed.data.title,
    body: parsed.data.body ?? null,
    color_id: parsed.data.colorId ?? null,
    updated_at: Date.now()
  });

  return res.json({ ok: true });
});

updatesRouter.delete("/:id", requireAuth, (req, res) => {
  const id = req.params.id ?? "";
  if (!id) return res.status(400).json({ error: "invalid_request" });

  const db = getDb();
  const existing = db
    .prepare(`SELECT user_id FROM updates WHERE id = ?`)
    .get(id) as { user_id: string } | undefined;
  if (!existing) return res.status(404).json({ error: "not_found" });

  const canDelete = existing.user_id === req.user!.id || req.user!.role === "admin";
  if (!canDelete) return res.status(403).json({ error: "forbidden" });

  db.prepare("DELETE FROM updates WHERE id = ?").run(id);
  return res.json({ ok: true });
});

// /api/admin
const adminRouter = Router();

const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/);

const CreateUserSchema = z.object({
  username: UsernameSchema,
  displayName: z.string().trim().min(1).max(80).optional(),
  password: z.string().min(12).max(256).optional(),
  role: z.enum(["user", "admin"]).optional()
});

const CreateUserSchemaRefined = CreateUserSchema.refine(
  (v) => (v.role ?? "user") !== "admin" || !!v.password,
  "admin_requires_password"
);

adminRouter.get("/users", requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const users = db
    .prepare(
      `SELECT id, username, display_name, role, created_at, last_login_at, birthday, venmo, must_set_password
       FROM users
       ORDER BY created_at ASC`
    )
    .all()
    .map((u: any) => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      role: u.role,
      createdAt: u.created_at,
      lastLoginAt: u.last_login_at,
      birthday: u.birthday,
      venmo: u.venmo,
      mustSetPassword: !!u.must_set_password
    }));
  return res.json({ users });
});

adminRouter.post("/users", requireAuth, requireAdmin, async (req, res) => {
  const parsed = CreateUserSchemaRefined.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

  const db = getDb();
  const id = nanoid();
  const role = parsed.data.role ?? "user";
  const passwordHash = parsed.data.password
    ? await argon2.hash(parsed.data.password, { type: argon2.argon2id })
    : null;
  const mustSetPassword = passwordHash ? 0 : 1;

  try {
    db.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, must_set_password, role, created_at)
       VALUES (@id, @username, @display_name, @password_hash, @must_set_password, @role, @created_at)`
    ).run({
      id,
      username: parsed.data.username,
      display_name: parsed.data.displayName ?? null,
      password_hash: passwordHash,
      must_set_password: mustSetPassword,
      role,
      created_at: Date.now()
    });
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      return res.status(409).json({ error: "username_taken" });
    }
    throw e;
  }

  return res.json({ id });
});

const UpdateUserSchema = z
  .object({
    username: UsernameSchema.optional(),
    displayName: z.union([z.string().trim().min(1).max(80), z.null()]).optional(),
    role: z.enum(["user", "admin"]).optional(),
    birthday: z.union([BirthdaySchema, z.null()]).optional(),
    venmo: z.union([VenmoSchema, z.null()]).optional(),
    lastLoginAt: z.union([z.number().int().nonnegative(), z.null()]).optional()
  })
  .refine(
    (v) =>
      v.username !== undefined ||
      v.displayName !== undefined ||
      v.role !== undefined ||
      v.birthday !== undefined ||
      v.venmo !== undefined ||
      v.lastLoginAt !== undefined,
    "empty_update"
  );

adminRouter.patch("/users/:id", requireAuth, requireAdmin, (req, res) => {
  const userId = req.params.id ?? "";
  if (!userId) return res.status(400).json({ error: "invalid_request" });

  const parsed = UpdateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

  const db = getDb();
  const existing = db
    .prepare(`SELECT id, role FROM users WHERE id = ?`)
    .get(userId) as { id: string; role: "user" | "admin" } | undefined;
  if (!existing) return res.status(404).json({ error: "not_found" });

  if (existing.role === "admin" && parsed.data.role === "user") {
    const adminCount = db
      .prepare(`SELECT COUNT(1) as c FROM users WHERE role = 'admin'`)
      .get() as { c: number };
    if (adminCount.c <= 1) return res.status(409).json({ error: "cannot_remove_last_admin" });
  }

  const sets: string[] = [];
  const params: Record<string, any> = { id: userId };

  if (parsed.data.username !== undefined) {
    sets.push("username = @username");
    params.username = parsed.data.username;
  }
  if (parsed.data.displayName !== undefined) {
    sets.push("display_name = @display_name");
    params.display_name = parsed.data.displayName;
  }
  if (parsed.data.role !== undefined) {
    sets.push("role = @role");
    params.role = parsed.data.role;
  }
  if (parsed.data.birthday !== undefined) {
    sets.push("birthday = @birthday");
    params.birthday = parsed.data.birthday;
  }
  if (parsed.data.venmo !== undefined) {
    sets.push("venmo = @venmo");
    params.venmo = parsed.data.venmo;
  }
  if (parsed.data.lastLoginAt !== undefined) {
    sets.push("last_login_at = @last_login_at");
    params.last_login_at = parsed.data.lastLoginAt;
  }

  try {
    db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = @id`).run(params);
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      return res.status(409).json({ error: "username_taken" });
    }
    throw e;
  }

  // If admin edited their own record, refresh req.user for this request (best-effort).
  if (req.user?.id === userId) {
    const row = db
      .prepare(
        `SELECT id, username, display_name, role, birthday, venmo, last_login_at
         FROM users WHERE id = ?`
      )
      .get(userId) as
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
    if (row) {
      req.user = {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        birthday: row.birthday,
        venmo: row.venmo,
        lastLoginAt: row.last_login_at
      };
    }
  }

  return res.json({ ok: true });
});

adminRouter.delete("/users/:id", requireAuth, requireAdmin, (req, res) => {
  const userId = req.params.id ?? "";
  if (!userId) return res.status(400).json({ error: "invalid_request" });

  const db = getDb();
  const existing = db
    .prepare(`SELECT id, role FROM users WHERE id = ?`)
    .get(userId) as { id: string; role: "user" | "admin" } | undefined;
  if (!existing) return res.status(404).json({ error: "not_found" });

  if (existing.role === "admin") {
    const adminCount = db
      .prepare(`SELECT COUNT(1) as c FROM users WHERE role = 'admin'`)
      .get() as { c: number };
    if (adminCount.c <= 1) return res.status(409).json({ error: "cannot_delete_last_admin" });
  }

  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  return res.json({ ok: true });
});

const ResetPasswordSchema = z.object({
  password: z.string().min(12).max(256)
});

adminRouter.post("/users/:id/reset-password", requireAuth, requireAdmin, async (req, res) => {
  const userId = req.params.id ?? "";
  if (!userId) return res.status(400).json({ error: "invalid_request" });

  const parsed = ResetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId);
  if (!exists) return res.status(404).json({ error: "not_found" });

  const passwordHash = await argon2.hash(parsed.data.password, {
    type: argon2.argon2id
  });

  db.prepare("UPDATE users SET password_hash = ?, must_set_password = 0 WHERE id = ?").run(
    passwordHash,
    userId
  );
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId); // revoke sessions
  db.prepare("DELETE FROM password_set_tokens WHERE user_id = ?").run(userId);

  return res.json({ ok: true });
});

app.use("/api/auth", authRouter);
app.use("/api/me", meRouter);
app.use("/api/calendar", calendarRouter);
app.use("/api/updates", updatesRouter);
app.use("/api/admin", adminRouter);

app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));

// Serve built frontend in production.
if (env.NODE_ENV === "production") {
  const distDir = path.join(__dirname, "../../frontend/dist");
  const indexHtml = path.join(distDir, "index.html");
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(distDir, { index: false, maxAge: "1h" }));
    // Express v5 uses a newer path-to-regexp which doesn't accept "*" as a path string.
    // Use a RegExp catch-all for SPA routing.
    app.get(/.*/, (_req, res) => res.sendFile(indexHtml));
  }
}

// Central error handler (avoid leaking internals).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(err);
  return res.status(500).json({ error: "internal_error" });
});

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on :${env.PORT} (${env.NODE_ENV})`);
});

