import Database from "better-sqlite3";
import { dirname, join } from "node:path";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

export type AppDatabase = Database.Database;

/** Consistent SQLite backup before the additive purchase-benefits migration. */
export async function backupBeforePaymentBenefitsMigration(filename: string): Promise<string | undefined> {
  if (filename === ":memory:" || !existsSync(filename)) return;
  const source = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    const table = source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='payments'").get();
    const columns = source.prepare("PRAGMA table_info(payments)").all() as Array<{ name:string }>;
    if (!table || columns.some(column => column.name === "product_benefits_json")) return;
    const folder = join(dirname(filename), "backups");
    mkdirSync(folder, { recursive:true, mode:0o700 });
    const destination = join(folder, "pre-payment-benefits-"+Date.now()+"-"+randomUUID()+".sqlite");
    await source.backup(destination);
    chmodSync(destination, 0o600);
    return destination;
  } finally {
    source.close();
  }
}

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
  last_synced_at TEXT,
  join_url TEXT
);
CREATE TABLE IF NOT EXISTS group_memberships (
  phone TEXT PRIMARY KEY,
  group_code TEXT NOT NULL REFERENCES groups(code),
  approved_at TEXT NOT NULL,
  revoked_at TEXT,
  source TEXT NOT NULL DEFAULT 'OWNER'
);
CREATE TABLE IF NOT EXISTS integration_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS whatsapp_group_verifications (
  provider TEXT NOT NULL,
  group_code TEXT NOT NULL REFERENCES groups(code),
  external_group_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  owner_admin_count INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT NOT NULL,
  PRIMARY KEY(provider, group_code)
);
CREATE TABLE IF NOT EXISTS whatsapp_member_verifications (
  provider TEXT NOT NULL,
  group_code TEXT NOT NULL REFERENCES groups(code),
  phone TEXT NOT NULL,
  external_group_id TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY(provider, group_code, phone)
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
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_source TEXT
);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  avatar_kind TEXT NOT NULL CHECK (avatar_kind IN ('PRESET','CUSTOM')),
  avatar_preset TEXT,
  avatar_image BLOB,
  avatar_mime TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS owner_profiles (
  owner_id TEXT PRIMARY KEY,
  avatar_kind TEXT NOT NULL CHECK (avatar_kind IN ('PRESET','CUSTOM')),
  avatar_preset TEXT,
  avatar_image BLOB,
  avatar_mime TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS owner_access (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL UNIQUE,
  normalized_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ROOT_OWNER','ADMIN_OWNER')),
  active INTEGER NOT NULL DEFAULT 1,
  created_by_owner_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_owner_access_active ON owner_access(active,role);

CREATE TABLE IF NOT EXISTS account_deletions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  group_code TEXT,
  deleted_at TEXT NOT NULL,
  source TEXT NOT NULL,
  submissions_count INTEGER NOT NULL DEFAULT 0,
  rounds_count INTEGER NOT NULL DEFAULT 0,
  approved_payment_cents INTEGER NOT NULL DEFAULT 0,
  coins_purchased_millis INTEGER NOT NULL DEFAULT 0,
  passes_purchased INTEGER NOT NULL DEFAULT 0
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
  video_title TEXT,
  video_channel_title TEXT,
  video_thumbnail_url TEXT,
  author_channel_title TEXT,
  author_channel_thumbnail_url TEXT,
  author_admin_role TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(round_id, slot),
  UNIQUE(round_id, video_id)
);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY(provider,event_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  product_code TEXT NOT NULL DEFAULT 'LEGACY',
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
  channel_id TEXT,
  channel_title TEXT,
  channel_thumbnail_url TEXT,
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

CREATE TABLE IF NOT EXISTS watch_time_totals (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  verified_millis INTEGER NOT NULL DEFAULT 0 CHECK (verified_millis >= 0),
  rewarded_coins INTEGER NOT NULL DEFAULT 0 CHECK (rewarded_coins >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watch_observation_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  video_index INTEGER NOT NULL CHECK (video_index BETWEEN 0 AND 9),
  player_seconds REAL NOT NULL CHECK (player_seconds >= 0),
  duration_seconds REAL NOT NULL CHECK (duration_seconds > 0),
  playback_rate REAL NOT NULL CHECK (playback_rate >= 0.25 AND playback_rate <= 2.0),
  observed_at TEXT NOT NULL
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
  addColumn("watch_observation_state", "active", "INTEGER NOT NULL DEFAULT 0");
  addColumn("login_codes", "attempts", "INTEGER NOT NULL DEFAULT 0");
  addColumn("wallets", "payment_hold", "INTEGER NOT NULL DEFAULT 0");
  addColumn("groups", "whatsapp_group_id", "TEXT");
  addColumn("groups", "membership_mode", "TEXT NOT NULL DEFAULT 'OWNER_VERIFIED'");
  addColumn("groups", "last_synced_at", "TEXT");
  addColumn("groups", "join_url", "TEXT");
  addColumn("group_memberships", "source", "TEXT NOT NULL DEFAULT 'OWNER'");
  addColumn("group_memberships", "approved_by_owner_id", "TEXT");
  addColumn("group_memberships", "approved_by_owner_name", "TEXT");
  addColumn("users", "last_seen_at", "TEXT");
  addColumn("users", "deleted_at", "TEXT");
  addColumn("users", "deleted_source", "TEXT");
  addColumn("users", "cooldown_until", "TEXT");
  addColumn("users", "cooldown_reason", "TEXT");
  addColumn("participation_requests", "source", "TEXT NOT NULL DEFAULT 'WEB'");
  addColumn("participation_requests", "whatsapp_verified_at", "TEXT");
  addColumn("participation_requests", "retry_block_until", "TEXT");
  addColumn("participation_requests", "duplicate_attempts", "INTEGER NOT NULL DEFAULT 0");
  addColumn("participation_requests", "approved_at", "TEXT");
  addColumn("participation_requests", "approved_by_owner_id", "TEXT");
  addColumn("participation_requests", "approved_by_owner_name", "TEXT");
  addColumn("submissions", "author_name", "TEXT");
  addColumn("submissions", "author_group", "TEXT");
  addColumn("submissions", "video_title", "TEXT");
  addColumn("submissions", "video_channel_title", "TEXT");
  addColumn("submissions", "video_thumbnail_url", "TEXT");
  addColumn("submissions", "author_channel_title", "TEXT");
  addColumn("submissions", "author_channel_thumbnail_url", "TEXT");
  addColumn("submissions", "author_admin_role", "TEXT");
  // Duração confirmada pela YouTube Data API no momento da contribuição.
  // NULL = contribuição anterior a esta migração ou sem YOUTUBE_API_KEY.
  addColumn("submissions", "video_duration_seconds", "REAL");
  // AUDITORIA / multi-fila: soft-close e numero de exibicao (aditivos, sem tocar no CHECK).
  addColumn("rounds", "closed_at", "TEXT");
  addColumn("rounds", "display_number", "INTEGER");

  // AUDITORIA C-01: credencial de senha persistente, opcional, provada via OTP.
  db.exec(`CREATE TABLE IF NOT EXISTS user_passwords (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    must_change INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    updated_at TEXT NOT NULL
  );`);
  // AUDITORIA C-01 / portão híbrido: código de setup emitido pelo Owner, resgatável
  // uma vez para definir a primeira senha SEM depender de entrega automática por WhatsApp.
  // AUDITORIA / correio interno: DMs entre usuários + avisos globais do Owner.
  // AUDITORIA / multi-fila: participacao por fila + numero de exibicao + soft-close.
  db.exec(`CREATE TABLE IF NOT EXISTS round_participants (
    round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL,
    left_at TEXT,
    source TEXT NOT NULL DEFAULT 'FREE',
    PRIMARY KEY (round_id, user_id)
  );`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_round_participants_user ON round_participants(user_id, left_at);");
  // AUDITORIA / inventario: itens do usuario (base do "Pular" e dos presentes).
  db.exec(`CREATE TABLE IF NOT EXISTS user_items (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_code TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, item_code)
  );`);
  // Trilha de origem dos itens (idempotente por reference_id, como o wallet_ledger).
  db.exec(`CREATE TABLE IF NOT EXISTS item_grants (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    item_code TEXT NOT NULL,
    delta INTEGER NOT NULL,
    kind TEXT NOT NULL,
    reference_id TEXT,
    note TEXT,
    created_at TEXT NOT NULL
  );`);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_item_grants_unique ON item_grants(user_id,kind,reference_id) WHERE reference_id IS NOT NULL;");

  // AUDITORIA / assinatura SUPER: a verdade e a data de expiracao; os privilegios
  // sao derivados dela na leitura, entao vencer revoga tudo sem rotina nenhuma.
  db.exec(`CREATE TABLE IF NOT EXISTS super_subscriptions (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    auto_renew INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'PURCHASE',
    revoked_at TEXT,
    updated_at TEXT NOT NULL
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS super_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    days INTEGER NOT NULL DEFAULT 0,
    reference_id TEXT,
    note TEXT,
    created_at TEXT NOT NULL
  );`);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_super_events_ref ON super_events(reference_id) WHERE reference_id IS NOT NULL;");
  // Vitrine de divulgacao: 3 vagas no sistema, 1 hora cada.
  db.exec(`CREATE TABLE IF NOT EXISTS super_pins (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    body TEXT NOT NULL,
    channel_url TEXT,
    created_at TEXT NOT NULL,
    removed_at TEXT
  );`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_super_pins_live ON super_pins(removed_at, created_at);");

  // AUDITORIA / credencial administrativa gerenciada no painel (hash scrypt).
  db.exec(`CREATE TABLE IF NOT EXISTS admin_credentials (
    owner_id TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    must_change INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    updated_at TEXT NOT NULL
  );`);

  // AUDITORIA / chat global: mensagens (texto puro) + estado de moderacao por usuario.
  db.exec(`CREATE TABLE IF NOT EXISTS global_chat_messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    sender_role TEXT NOT NULL DEFAULT 'USER',
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    deleted_at TEXT,
    pinned INTEGER NOT NULL DEFAULT 0
  );`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_global_chat_created ON global_chat_messages(created_at);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_global_chat_pinned ON global_chat_messages(pinned, created_at);");
  db.exec(`CREATE TABLE IF NOT EXISTS global_chat_members (
    user_id TEXT PRIMARY KEY,
    removed INTEGER NOT NULL DEFAULT 0,
    muted_until TEXT,
    cooldown_seconds INTEGER,
    updated_at TEXT NOT NULL
  );`);

  db.exec(`CREATE TABLE IF NOT EXISTS mail_messages (
    id TEXT PRIMARY KEY,
    thread_key TEXT NOT NULL,
    sender_id TEXT,
    sender_role TEXT NOT NULL DEFAULT 'USER',
    recipient_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read_at TEXT,
    deleted_at TEXT
  );`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_mail_recipient ON mail_messages(recipient_id, read_at);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_mail_thread ON mail_messages(thread_key, created_at);");

  // AUDITORIA / loja configurável: catálogo de produtos editável pelo painel.
  db.exec(`CREATE TABLE IF NOT EXISTS store_products (
    code TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    credits_millis INTEGER NOT NULL DEFAULT 0 CHECK (credits_millis >= 0),
    extra_passes INTEGER NOT NULL DEFAULT 0 CHECK (extra_passes >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 100,
    item_reference TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`);
  // Colunas aditivas da loja (depois do CREATE TABLE acima).
  addColumn("store_products", "grants_item", "TEXT");
  addColumn("store_products", "grants_item_qty", "INTEGER NOT NULL DEFAULT 0");
  // Ilustracao enviada pelo painel (data URL) — o Owner troca sem depender de deploy.
  addColumn("store_products", "image_data_url", "TEXT");
  // Produto de assinatura: concede SUPER por N dias em vez de item avulso.
  addColumn("store_products", "subscription_days", "INTEGER NOT NULL DEFAULT 0");
  // Catálogo inicial configurável. Os valores definidos pelo Owner persistem no banco.
  { // Add missing products without changing existing Owner configuration.
    const now = new Date().toISOString();
    const seed = db.prepare(`INSERT OR IGNORE INTO store_products (code,title,description,amount_cents,credits_millis,extra_passes,active,sort_order,item_reference,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    seed.run("COINS_10","10 moedas","10 moedas para salvar URLs na fila. Cada moeda salva uma URL.",2000,10000,0,1,1,"coins-10",now);
    // Pacote antigo com bônus inativo; passe avulso mantém identidade própria.
    seed.run("COINS_LAUNCH","Pacote de lançamento","10 moedas + 1 passe bônus (legado).",2000,10000,1,0,90,"coins-launch-10",now);
    seed.run("PASS_SINGLE","1 passe","Uma contribuição extra na mesma fila. Salvar a URL também usa 1 moeda.",2000,0,1,1,4,"pass-single",now);
    // Item "Pular": permite entrar em outra fila sem ter concluido 100% da atual.
    db.prepare(`INSERT OR IGNORE INTO store_products (code,title,description,amount_cents,credits_millis,extra_passes,active,sort_order,item_reference,grants_item,grants_item_qty,updated_at)
      VALUES ('SKIP_1','1 Pular','Entre em outra fila sem precisar concluir 100% da atual. Você continua participando das duas e pode alternar entre elas.',2000,0,0,1,2,'skip-1','SKIP',1,?)`).run(now);
    // Assinatura SUPER: 30 dias de privilégios, renovável.
    db.prepare(`INSERT OR IGNORE INTO store_products (code,title,description,amount_cents,credits_millis,extra_passes,active,sort_order,item_reference,grants_item,grants_item_qty,subscription_days,updated_at)
      VALUES ('SUPER_30','SUPER · 30 dias','Chat sem espera, 5 vídeos por fila, selo animado no seu avatar e divulgação fixa do seu canal.',4500,0,0,1,3,'super-30','SUPER',1,30,?)`).run(now);
  }

  db.exec(`CREATE TABLE IF NOT EXISTS queue_skip_requests (
    user_id TEXT NOT NULL REFERENCES users(id),reference_id TEXT NOT NULL,
    result_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(user_id,reference_id)
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS setup_codes (
    phone TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    group_code TEXT,
    name TEXT,
    issued_by_owner_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );`);
  addColumn("payments", "product_code", "TEXT NOT NULL DEFAULT 'LEGACY'");
  addColumn("payments", "product_benefits_json", "TEXT");
  // Compras anteriores ainda pendentes recebem um retrato do catálogo no
  // momento da migração. O marcador distingue este retrato de uma oferta nova.
  db.exec(`UPDATE payments SET product_benefits_json=COALESCE(
    (SELECT json_object('grantsItem',s.grants_item,'qty',COALESCE(s.grants_item_qty,0),
      'days',COALESCE(s.subscription_days,0),'source','LEGACY_AT_MIGRATION')
      FROM store_products s WHERE s.code=payments.product_code),
    json_object('grantsItem',NULL,'qty',0,'days',0,'source','LEGACY_AT_MIGRATION'))
    WHERE product_benefits_json IS NULL AND status IN ('PENDING','REJECTED');`);
  addColumn("youtube_connections", "channel_id", "TEXT");
  addColumn("youtube_connections", "channel_title", "TEXT");
  addColumn("youtube_connections", "channel_thumbnail_url", "TEXT");
  addColumn("oauth_states", "round_id", "TEXT");
  addColumn("playlist_watch_progress", "finalized_at", "TEXT");
  addColumn("playlist_watch_progress", "finalize_reason", "TEXT");
  addColumn("playlist_watch_progress", "observed_intervals_json", "TEXT");
  addColumn("wallet_ledger", "note", "TEXT");
  addColumn("wallet_ledger", "actor_owner_id", "TEXT");
  addColumn("wallet_ledger", "actor_owner_name", "TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_whatsapp_group_id ON groups(whatsapp_group_id) WHERE whatsapp_group_id IS NOT NULL;");
  db.exec("CREATE INDEX IF NOT EXISTS idx_submissions_video_id ON submissions(video_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_users_cooldown_until ON users(cooldown_until);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_watch_observation_round ON watch_observation_state(round_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_participation_retry_block ON participation_requests(retry_block_until);");
  // Backfill: numero de exibicao pela ordem de criacao; participacao a partir das contribuicoes.
  db.exec("UPDATE rounds SET display_number = sequence WHERE display_number IS NULL;");
  db.exec(`INSERT OR IGNORE INTO round_participants (round_id,user_id,joined_at,left_at,source)
    SELECT s.round_id, s.user_id, MIN(s.created_at), NULL, 'FREE' FROM submissions s GROUP BY s.round_id, s.user_id;`);
  db.exec(`UPDATE submissions SET author_name = (SELECT name FROM users WHERE id = submissions.user_id) WHERE author_name IS NULL;
    UPDATE submissions SET author_group = (SELECT group_code FROM users WHERE id = submissions.user_id) WHERE author_group IS NULL;`);
  ensureOpenRound(db);
  return db;
}

export function ensureOpenRound(db: AppDatabase): void {
  const open = db.prepare("SELECT id FROM rounds WHERE status = 'OPEN' LIMIT 1").get();
  if (open) return;
  const latest = db.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM rounds").get() as { sequence: number };
  // AUDITORIA / multi-fila: toda fila nasce com display_number no MENOR numero livre.
  const used = new Set((db.prepare("SELECT display_number AS n FROM rounds WHERE closed_at IS NULL AND display_number IS NOT NULL").all() as Array<{ n: number }>).map((r) => r.n));
  let display = 1;
  while (used.has(display)) display += 1;
  db.prepare("INSERT INTO rounds (id, sequence, status, created_at, display_number) VALUES (?, ?, 'OPEN', ?, ?)").run(
    crypto.randomUUID(),
    latest.sequence + 1,
    new Date().toISOString(),
    display
  );
}

