import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import argon2 from "argon2";
import { nanoid } from "nanoid";
import { getEnv } from "./env";

let db: Database.Database | null = null;

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
      password_hash TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS updates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_updates_date ON updates(date);
    CREATE INDEX IF NOT EXISTS idx_updates_user_id ON updates(user_id);
  `);

  // Opportunistic cleanup (keeps the sessions table from growing forever).
  instance.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());

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
      `INSERT INTO users (id, username, display_name, password_hash, role, created_at)
       VALUES (@id, @username, @display_name, @password_hash, 'admin', @created_at)`
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

