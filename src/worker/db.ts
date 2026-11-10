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
  // 0.2: richer repeats (every N, chosen weekdays, an end) and the activity chart.
  [
    `ALTER TABLE messages ADD COLUMN interval INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE messages ADD COLUMN weekdays INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE messages ADD COLUMN until TEXT`,
    `ALTER TABLE messages ADD COLUMN max_sends INTEGER`,
    `CREATE INDEX IF NOT EXISTS idx_deliveries_at ON deliveries (at)`,
  ],
  // 0.3: accounts. Everyone signs in with an email and sees only their own
  // channels and messages. Rows from before have no owner until the first
  // account is created and takes them over (see auth.register). Old sessions
  // belonged to nobody in particular, so they end here.
  [
    `CREATE TABLE IF NOT EXISTS users (
       id TEXT PRIMARY KEY,
       email TEXT NOT NULL UNIQUE,
       password TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    `DELETE FROM sessions`,
    `ALTER TABLE sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE channels ADD COLUMN user_id TEXT`,
    `ALTER TABLE messages ADD COLUMN user_id TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_channels_user ON channels (user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_user ON messages (user_id, send_at)`,
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
  /** The account it belongs to. */
  user_id: string | null;
  type: ChannelType;
  name: string;
  config: string;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  user_id: string | null;
  channel_id: string;
  recipient: string;
  subject: string;
  body: string;
  local_time: string;
  timezone: string;
  repeat: Repeat;
  interval: number;
  weekdays: number;
  until: string | null;
  max_sends: number | null;
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
