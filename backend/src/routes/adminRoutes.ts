import { Router } from "express";
import { z } from "zod";
import argon2 from "argon2";
import { nanoid } from "nanoid";
import { requireAuth, requireAdmin } from "../auth";
import { getDb } from "../db";

const router = Router();

const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/);

const BirthdaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, "invalid_date");

const VenmoSchema = z
  .string()
  .trim()
  .regex(/^@[A-Za-z0-9_-]{1,30}$/);

const CreateUserSchema = z.object({
  username: UsernameSchema,
  displayName: z.string().trim().min(1).max(80).optional(),
  password: z.string().min(12).max(256),
  role: z.enum(["user", "admin"]).optional()
});

router.get("/users", requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const users = db
    .prepare(
      `SELECT id, username, display_name, role, created_at, last_login_at, birthday, venmo
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
      venmo: u.venmo
    }));
  return res.json({ users });
});

router.post("/users", requireAuth, requireAdmin, async (req, res) => {
  const parsed = CreateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

  const db = getDb();
  const id = nanoid();
  const passwordHash = await argon2.hash(parsed.data.password, {
    type: argon2.argon2id
  });

  try {
    db.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, role, created_at)
       VALUES (@id, @username, @display_name, @password_hash, @role, @created_at)`
    ).run({
      id,
      username: parsed.data.username,
      display_name: parsed.data.displayName ?? null,
      password_hash: passwordHash,
      role: parsed.data.role ?? "user",
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

router.patch("/users/:id", requireAuth, requireAdmin, (req, res) => {
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

router.delete("/users/:id", requireAuth, requireAdmin, (req, res) => {
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

router.post("/users/:id/reset-password", requireAuth, requireAdmin, async (req, res) => {
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

  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId); // revoke sessions

  return res.json({ ok: true });
});

export default router;

