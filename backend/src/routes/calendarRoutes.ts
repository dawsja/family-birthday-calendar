import { Router } from "express";
import { z } from "zod";
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

router.get("/", requireAuth, (req, res) => {
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

export default router;

