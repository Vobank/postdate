import type { ChannelType } from '../shared/channels';
import type { Repeat } from '../shared/time';
import type { MessageStatus } from '../shared/types';

// The worker creates and upgrades its own tables, so deploying never involves a
// separate migration step. To change the schema, append statements to a new
// entry in MIGRATIONS; entries that have shipped must never be edited.
const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS sessions (
       token_hash TEXT PRIMARY KEY,
       created_at INTEGER NOT NULL,
       expires_at INTEGER NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT NOT NULL, at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts (ip, at)`,
    `CREATE TABLE IF NOT EXISTS channels (
       id TEXT PRIMARY KEY,
       type TEXT NOT NULL,
       name TEXT NOT NULL,
       config TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS messages (
       id TEXT PRIMARY KEY,
       channel_id TEXT NOT NULL,
       recipient TEXT NOT NULL DEFAULT '',
       subject TEXT NOT NULL DEFAULT '',
       body TEXT NOT NULL DEFAULT '',
       local_time TEXT NOT NULL,
       timezone TEXT NOT NULL,
       repeat TEXT NOT NULL DEFAULT 'none',
       occurrence INTEGER NOT NULL DEFAULT 0,
       send_at INTEGER NOT NULL,
       due_at INTEGER NOT NULL,
       status TEXT NOT NULL DEFAULT 'scheduled',
       attempts INTEGER NOT NULL DEFAULT 0,
       last_error TEXT,
       last_sent_at INTEGER,
       sent_count INTEGER NOT NULL DEFAULT 0,
       locked_at INTEGER,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_messages_due ON messages (status, due_at)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages (channel_id)`,
    `CREATE TABLE IF NOT EXISTS deliveries (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       message_id TEXT NOT NULL,
       at INTEGER NOT NULL,
       ok INTEGER NOT NULL,
       detail TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_deliveries_message ON deliveries (message_id, at)`,
  ],
];

// Per-isolate flag. Only a boolean is kept across requests, never a promise.
let schemaChecked = false;

export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaChecked) return;
  await db
    .prepare('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    .run();
  const current = Number((await getSetting(db, 'schema_version')) ?? 0);
  for (let version = current; version < MIGRATIONS.length; version++) {
    const statements = MIGRATIONS[version] ?? [];
    await db.batch([
      ...statements.map((sql) => db.prepare(sql)),
      db
        .prepare(
          `INSERT INTO settings (key, value) VALUES ('schema_version', ?1)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        )
        .bind(String(version + 1)),
    ]);
  }
  schemaChecked = true;
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?1').bind(key).first<{
    value: string;
  }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?1, ?2)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    )
    .bind(key, value)
    .run();
}

export interface ChannelRow {
  id: string;
  type: ChannelType;
  name: string;
  config: string;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  channel_id: string;
  recipient: string;
  subject: string;
  body: string;
  local_time: string;
  timezone: string;
  repeat: Repeat;
  occurrence: number;
  send_at: number;
  due_at: number;
  status: MessageStatus;
  attempts: number;
  last_error: string | null;
  last_sent_at: number | null;
  sent_count: number;
  locked_at: number | null;
  created_at: number;
  updated_at: number;
}
