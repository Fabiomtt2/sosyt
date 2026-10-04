import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

export type AppDatabase = Database.Database;

const schema = `
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
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_codes_phone ON login_codes(phone, created_at DESC);

CREATE TABLE IF NOT EXISTS wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  promo_millis INTEGER NOT NULL DEFAULT 10000 CHECK (promo_millis >= 0),
  purchased_millis INTEGER NOT NULL DEFAULT 0 CHECK (purchased_millis >= 0),
  reward_millis INTEGER NOT NULL DEFAULT 0 CHECK (reward_millis >= 0),
  extra_slot_passes INTEGER NOT NULL DEFAULT 0 CHECK (extra_slot_passes >= 0),
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
`;

export function createDatabase(filename: string): AppDatabase {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  if (filename !== ":memory:") db.pragma("journal_mode = WAL");
  db.exec(schema);
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

