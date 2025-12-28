import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import argon2 from "argon2";
import { nanoid } from "nanoid";
import { z } from "zod";

let db: Database.Database | null = null;

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  APP_ORIGIN: z.string().default("http://localhost:5173"),
  DATABASE_PATH: z.string().default("./data/app.sqlite"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  // One-time bootstrap: if no admin exists, the server will create one using these.
  BOOTSTRAP_ADMIN_USERNAME: z.string().default("admin"),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).default("change-me-please-1234")
});

export type Env = z.infer<typeof EnvSchema>;

export function getEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Avoid dumping env values; only show schema errors.
    // eslint-disable-next-line no-console
    console.error(parsed.error.flatten());
    throw new Error("Invalid environment configuration");
  }
  return parsed.data;
}

export function getDb(): Database.Database {
  if (db) return db;

  const env = getEnv();
  const dbPath = path.isAbsolute(env.DATABASE_PATH)
    ? env.DATABASE_PATH
    : path.join(process.cwd(), env.DATABASE_PATH);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const instance = new Database(dbPath);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");

  instance.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT,
      password_hash TEXT,
      must_set_password INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL CHECK (role IN ('user','admin')) DEFAULT 'user',
      birthday TEXT,
      venmo TEXT,
      created_at INTEGER NOT NULL,
      last_login_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      csrf_token TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS password_set_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_password_set_tokens_user_id ON password_set_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_password_set_tokens_expires_at ON password_set_tokens(expires_at);

    CREATE TABLE IF NOT EXISTS updates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      color_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_updates_date ON updates(date);
    CREATE INDEX IF NOT EXISTS idx_updates_user_id ON updates(user_id);
  `);

  // Lightweight migrations for existing DB files.
  // (SQLite doesn't support "ADD COLUMN IF NOT EXISTS".)
  const usersCols = instance
    .prepare(`PRAGMA table_info(users)`)
    .all() as Array<{ name: string; notnull: number }>;
  const hasMustSetPassword = usersCols.some((c) => c.name === "must_set_password");
  const passwordHashCol = usersCols.find((c) => c.name === "password_hash");
  const passwordHashWasNotNull = passwordHashCol ? passwordHashCol.notnull === 1 : false;
  if (!hasMustSetPassword || passwordHashWasNotNull) {
    // Migrate users table to allow NULL password hashes (for first-login password setup)
    // and to track must_set_password explicitly.
    //
    // This rebuild avoids SQLite's lack of "ALTER COLUMN".
    instance.exec(`
      PRAGMA foreign_keys=OFF;
      BEGIN;
      CREATE TABLE IF NOT EXISTS users_new (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT,
        password_hash TEXT,
        must_set_password INTEGER NOT NULL DEFAULT 0,
        role TEXT NOT NULL CHECK (role IN ('user','admin')) DEFAULT 'user',
        birthday TEXT,
        venmo TEXT,
        created_at INTEGER NOT NULL,
        last_login_at INTEGER
      );
      INSERT INTO users_new (id, username, display_name, password_hash, role, birthday, venmo, created_at, last_login_at, must_set_password)
      SELECT id, username, display_name, password_hash, role, birthday, venmo, created_at, last_login_at, 0
      FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      COMMIT;
      PRAGMA foreign_keys=ON;
    `);
  }

  const updatesCols = instance
    .prepare(`PRAGMA table_info(updates)`)
    .all() as Array<{ name: string }>;
  if (!updatesCols.some((c) => c.name === "color_id")) {
    instance.exec(`ALTER TABLE updates ADD COLUMN color_id TEXT;`);
  }

  // Opportunistic cleanup (keeps the sessions table from growing forever).
  const now = Date.now();
  instance.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  instance.prepare("DELETE FROM password_set_tokens WHERE expires_at <= ?").run(now);

  bootstrapAdminIfNeeded(instance).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to bootstrap admin:", err);
  });

  db = instance;
  return instance;
}

function nowMs() {
  return Date.now();
}

async function bootstrapAdminIfNeeded(instance: Database.Database) {
  const adminExists = instance
    .prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1")
    .get();
  if (adminExists) return;

  const env = getEnv();
  const id = nanoid();
  const passwordHash = await argon2.hash(env.BOOTSTRAP_ADMIN_PASSWORD, {
    type: argon2.argon2id
  });

  instance
    .prepare(
      `INSERT INTO users (id, username, display_name, password_hash, must_set_password, role, created_at)
       VALUES (@id, @username, @display_name, @password_hash, 0, 'admin', @created_at)`
    )
    .run({
      id,
      username: env.BOOTSTRAP_ADMIN_USERNAME,
      display_name: "Administrator",
      password_hash: passwordHash,
      created_at: nowMs()
    });

  // eslint-disable-next-line no-console
  console.log(
    `Bootstrapped admin user '${env.BOOTSTRAP_ADMIN_USERNAME}'. CHANGE THE PASSWORD via admin UI ASAP.`
  );
}

