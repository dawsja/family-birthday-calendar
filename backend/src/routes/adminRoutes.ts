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
      `SELECT id, username, display_name, role, created_at, last_login_at
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
      lastLoginAt: u.last_login_at
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

