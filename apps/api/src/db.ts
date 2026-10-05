import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

export type AppDatabase = Database.Database;

const schema = `
CREATE TABLE IF NOT EXISTS whatsapp_received (message_id TEXT PRIMARY KEY, received_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS whatsapp_group_events (event_key TEXT PRIMARY KEY, received_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS whatsapp_conversations (phone TEXT PRIMARY KEY, stage TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS whatsapp_outbox (
 id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE, recipient TEXT NOT NULL, payload TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0, available_at TEXT NOT NULL,
 expires_at TEXT, lease_until TEXT, provider_message_id TEXT, last_error TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  code TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  whatsapp_group_id TEXT,
  membership_mode TEXT NOT NULL DEFAULT 'OWNER_VERIFIED',
  last_synced_at TEXT
);
CREATE TABLE IF NOT EXISTS group_memberships (
  phone TEXT PRIMARY KEY,
  group_code TEXT NOT NULL REFERENCES groups(code),
  approved_at TEXT NOT NULL,
  revoked_at TEXT,
  source TEXT NOT NULL DEFAULT 'OWNER'
);
CREATE TABLE IF NOT EXISTS participation_requests (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  preferred_group TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','DECLINED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE TABLE IF NOT EXISTS export_locks (
  round_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(round_id, user_id)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  group_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_codes (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  name TEXT NOT NULL,
  group_code TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_codes_phone ON login_codes(phone, created_at DESC);

CREATE TABLE IF NOT EXISTS wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  promo_millis INTEGER NOT NULL DEFAULT 10000 CHECK (promo_millis >= 0),
  purchased_millis INTEGER NOT NULL DEFAULT 0 CHECK (purchased_millis >= 0),
  reward_millis INTEGER NOT NULL DEFAULT 0 CHECK (reward_millis >= 0),
  extra_slot_passes INTEGER NOT NULL DEFAULT 0 CHECK (extra_slot_passes >= 0),
  payment_hold INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  amount_millis INTEGER NOT NULL,
  reference_id TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_ledger_unique_reference
  ON wallet_ledger(user_id, kind, reference_id) WHERE reference_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'READY')),
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES rounds(id),
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 10),
  user_id TEXT NOT NULL REFERENCES users(id),
  youtube_url TEXT NOT NULL,
  video_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(round_id, slot),
  UNIQUE(round_id, video_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  provider_payment_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  amount_cents INTEGER NOT NULL,
  credits_millis INTEGER NOT NULL,
  extra_passes INTEGER NOT NULL,
  qr_code TEXT,
  qr_code_base64 TEXT,
  ticket_url TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS youtube_connections (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_cipher TEXT NOT NULL,
  scope TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_exports (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES rounds(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  youtube_playlist_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
  added_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(round_id, user_id)
);

CREATE TABLE IF NOT EXISTS playlist_watch_progress (
  round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  watched_seconds_json TEXT NOT NULL,
  durations_json TEXT NOT NULL,
  percent INTEGER NOT NULL CHECK (percent BETWEEN 0 AND 100),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(round_id, user_id)
);
`;

export function createDatabase(filename: string): AppDatabase {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  if (filename !== ":memory:") db.pragma("journal_mode = WAL");
  db.exec(schema);
  // Additive migration: preserve existing MVP data.
  const addColumn = (table: string, name: string, definition: string) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  addColumn("login_codes", "attempts", "INTEGER NOT NULL DEFAULT 0");
  addColumn("wallets", "payment_hold", "INTEGER NOT NULL DEFAULT 0");
  addColumn("groups", "whatsapp_group_id", "TEXT");
  addColumn("groups", "membership_mode", "TEXT NOT NULL DEFAULT 'OWNER_VERIFIED'");
  addColumn("groups", "last_synced_at", "TEXT");
  addColumn("group_memberships", "source", "TEXT NOT NULL DEFAULT 'OWNER'");
  addColumn("users", "last_seen_at", "TEXT");
  addColumn("participation_requests", "source", "TEXT NOT NULL DEFAULT 'WEB'");
  addColumn("participation_requests", "whatsapp_verified_at", "TEXT");
  addColumn("submissions", "author_name", "TEXT");
  addColumn("submissions", "author_group", "TEXT");
  addColumn("oauth_states", "round_id", "TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_whatsapp_group_id ON groups(whatsapp_group_id) WHERE whatsapp_group_id IS NOT NULL;");
  db.exec(`UPDATE submissions SET author_name = (SELECT name FROM users WHERE id = submissions.user_id) WHERE author_name IS NULL;
    UPDATE submissions SET author_group = (SELECT group_code FROM users WHERE id = submissions.user_id) WHERE author_group IS NULL;`);
  ensureOpenRound(db);
  return db;
}

export function ensureOpenRound(db: AppDatabase): void {
  const open = db.prepare("SELECT id FROM rounds WHERE status = 'OPEN' LIMIT 1").get();
  if (open) return;
  const latest = db.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM rounds").get() as { sequence: number };
  db.prepare("INSERT INTO rounds (id, sequence, status, created_at) VALUES (?, ?, 'OPEN', ?)").run(
    crypto.randomUUID(),
    latest.sequence + 1,
    new Date().toISOString()
  );
}

