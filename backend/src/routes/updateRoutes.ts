import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireAuth } from "../auth";
import { getDb } from "../db";

const router = Router();

const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, "invalid_date");

const UpdateSchema = z.object({
  date: IsoDate,
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(2000).optional()
});

router.post("/", requireAuth, (req, res) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

  const db = getDb();
  const id = nanoid();
  const now = Date.now();

  db.prepare(
    `INSERT INTO updates (id, user_id, date, title, body, created_at, updated_at)
     VALUES (@id, @user_id, @date, @title, @body, @created_at, @updated_at)`
  ).run({
    id,
    user_id: req.user!.id,
    date: parsed.data.date,
    title: parsed.data.title,
    body: parsed.data.body ?? null,
    created_at: now,
    updated_at: now
  });

  return res.json({ id });
});

router.put("/:id", requireAuth, (req, res) => {
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
     SET date = @date, title = @title, body = @body, updated_at = @updated_at
     WHERE id = @id`
  ).run({
    id,
    date: parsed.data.date,
    title: parsed.data.title,
    body: parsed.data.body ?? null,
    updated_at: Date.now()
  });

  return res.json({ ok: true });
});

router.delete("/:id", requireAuth, (req, res) => {
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

export default router;

