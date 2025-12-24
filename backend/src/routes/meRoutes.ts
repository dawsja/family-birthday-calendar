import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { getDb } from "../db";

const router = Router();

router.get("/", requireAuth, (req, res) => {
  const u = req.user!;
  const needsSetup = u.role === "user" && u.lastLoginAt == null && (!u.birthday || !u.venmo);
  return res.json({ user: { ...u, needsSetup } });
});

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

const ProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    birthday: BirthdaySchema.optional(),
    venmo: VenmoSchema.optional()
  })
  .refine((v) => v.displayName || v.birthday || v.venmo, "empty_update");

router.put("/profile", requireAuth, (req, res) => {
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

export default router;

