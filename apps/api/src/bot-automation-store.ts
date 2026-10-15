// AUDITORIA / HYBRID+ — persistência e governança das automações do bot.
//
// O catálogo (`bot-automations.ts`) é o núcleo puro: diz QUAIS atitudes existem e
// qual o texto padrão. Este arquivo é a camada do OWNER: guarda o que ele editou,
// valida antes de aceitar e registra QUEM mudou O QUÊ.
//
// Três regras que vêm direto da reauditoria e não são negociáveis:
//
//  1. IDENTIFICAÇÃO MÍNIMA EM GRUPO. Texto que vai para GROUP/ALL_GROUPS não pode
//     conter identificador pessoal ({numero}, {telefone}, {whatsapp}). A decisão do
//     dono é explícita: em grupo vão nome, sala e posição na fila — nada mais.
//     Publicar telefone de um participante num grupo de desconhecidos é vazamento
//     de dado pessoal, e o ônus de provar consentimento é do controlador (LGPD).
//
//  2. PLACEHOLDER INVÁLIDO É ERRO, NÃO AVISO. `{nível}` (com acento) não casa com a
//     regex do render e chegaria LITERAL ao membro. Rejeitamos no save, que é onde
//     ainda dá para consertar — e não no envio, onde já é tarde.
//
//  3. QUEM MUDOU FICA GRAVADO. Um ADMIN_OWNER pode trocar o {link} das boas-vindas
//     por um link próprio e isso iria para todo mundo que entrar. Sem trilha de
//     auditoria ninguém saberia quem, quando, nem qual era o texto anterior.
import type { AppDatabase } from "./db.js";
import {
  AUTOMATION_CATALOG, automationMeta, isAutomationEvent, unknownPlaceholders,
  WHATSAPP_TEXT_LIMIT,
  type AutomationChannel, type AutomationEvent, type AutomationTarget,
} from "./bot-automations.js";

/** Identificadores pessoais que nunca podem ir para um grupo. */
export const PERSONAL_IDENTIFIER_PLACEHOLDERS = ["numero", "telefone", "whatsapp", "phone"] as const;
const GROUP_TARGETS: AutomationTarget[] = ["GROUP", "ALL_GROUPS"];

export type AutomationSettings = {
  event: AutomationEvent;
  enabled: boolean;
  text: string;
  channel: AutomationChannel;
  target: AutomationTarget;
  intervalMinutes?: number;
  /** true = o Owner editou algo; false = ainda no padrão de fábrica. */
  customized: boolean;
  updatedAt?: string;
  updatedByName?: string;
};

export function ensureBotAutomations(db: AppDatabase) {
  db.exec(`CREATE TABLE IF NOT EXISTS bot_automations (
    event TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL,
    text TEXT NOT NULL,
    channel TEXT NOT NULL,
    target TEXT NOT NULL,
    interval_minutes INTEGER,
    updated_at TEXT NOT NULL,
    updated_by_owner_id TEXT,
    updated_by_owner_name TEXT
  );`);
  // Trilha de auditoria: append-only, nunca sobrescrita.
  db.exec(`CREATE TABLE IF NOT EXISTS bot_automation_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT NOT NULL,
    field TEXT NOT NULL,
    before_value TEXT,
    after_value TEXT,
    actor_owner_id TEXT,
    actor_owner_name TEXT,
    created_at TEXT NOT NULL
  );`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_bot_automation_audit_event ON bot_automation_audit(event,created_at);");
}

type Row = {
  event: string; enabled: number; text: string; channel: string; target: string;
  intervalMinutes: number | null; updatedAt: string; updatedByName: string | null;
};

const SELECT = `SELECT event,enabled,text,channel,target,interval_minutes AS intervalMinutes,
  updated_at AS updatedAt,updated_by_owner_name AS updatedByName FROM bot_automations`;

/** O que vale AGORA para um evento: o que o Owner salvou, ou o padrão do catálogo. */
export function automationSettings(db: AppDatabase, event: AutomationEvent): AutomationSettings {
  const meta = automationMeta(event);
  const row = db.prepare(`${SELECT} WHERE event=?`).get(event) as Row | undefined;
  if (!row) {
    return {
      event, enabled: meta.defaultEnabled, text: meta.defaultText,
      channel: meta.defaultChannel, target: meta.defaultTarget,
      intervalMinutes: meta.defaultIntervalMinutes, customized: false,
    };
  }
  return {
    event, enabled: Boolean(row.enabled), text: row.text,
    channel: row.channel as AutomationChannel, target: row.target as AutomationTarget,
    intervalMinutes: row.intervalMinutes ?? undefined, customized: true,
    updatedAt: row.updatedAt, updatedByName: row.updatedByName ?? undefined,
  };
}

/** Catálogo inteiro com o que vale agora — é o que o painel do Owner lista. */
export function listAutomationSettings(db: AppDatabase): AutomationSettings[] {
  return AUTOMATION_CATALOG.map((meta) => automationSettings(db, meta.event));
}

export type AutomationPatch = {
  enabled?: boolean;
  text?: string;
  channel?: AutomationChannel;
  target?: AutomationTarget;
  intervalMinutes?: number;
};

export class AutomationValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AutomationValidationError";
  }
}

/**
 * Valida um texto para um evento/alvo. Lança `AutomationValidationError` — o painel
 * mostra a mensagem ao Owner, em português, dizendo como consertar.
 */
export function validateAutomationText(event: AutomationEvent, text: string, target: AutomationTarget) {
  const clean = text.trim();
  if (!clean) throw new AutomationValidationError("EMPTY_TEXT", "A mensagem não pode ficar vazia.");
  if (clean.length > WHATSAPP_TEXT_LIMIT) {
    throw new AutomationValidationError("TEXT_TOO_LONG",
      `A mensagem passa do limite do WhatsApp (${WHATSAPP_TEXT_LIMIT} caracteres).`);
  }
  // Regra 1 — identificação mínima em grupo.
  if (GROUP_TARGETS.includes(target)) {
    const leaked = PERSONAL_IDENTIFIER_PLACEHOLDERS.filter((key) => clean.includes(`{${key}}`));
    if (leaked.length) {
      throw new AutomationValidationError("PERSONAL_DATA_IN_GROUP",
        `Mensagem de grupo não pode expor dado pessoal (${leaked.map((k) => `{${k}}`).join(", ")}). ` +
        "Em grupo use apenas nome, sala e posição na fila.");
    }
  }
  // Regra 2 — placeholder inválido é erro.
  //
  // Cuidado: NÃO basta usar `unknownPlaceholders`, porque ele usa a mesma regex do
  // render (`\w`), que ignora acento. `{nível}` seria invisível para a validação E
  // para o render — passaria aqui e chegaria LITERAL ao membro. Por isso varremos
  // qualquer token entre chaves e comparamos com a lista válida do evento.
  const known = new Set(automationMeta(event).placeholders);
  const invalid = [...new Set(
    Array.from(clean.matchAll(/\{([^{}\s]{1,40})\}/gu), (m) => m[1]).filter((key) => !known.has(key)),
  )];
  if (invalid.length) {
    const hasAccent = invalid.some((key) => !/^\w+$/.test(key));
    throw new AutomationValidationError("UNKNOWN_PLACEHOLDER",
      `Estes campos não existem para esta mensagem: ${invalid.map((k) => `{${k}}`).join(", ")}. ` +
      `Disponíveis: ${automationMeta(event).placeholders.map((k) => `{${k}}`).join(", ")}.` +
      (hasAccent ? " Atenção: os campos não usam acento nem espaço." : ""));
  }
  // Rede de segurança: se o núcleo do render discordar, algo saiu do lugar.
  const unknown = unknownPlaceholders(event, clean);
  if (unknown.length) {
    throw new AutomationValidationError("UNKNOWN_PLACEHOLDER",
      `Campos desconhecidos: ${unknown.map((k) => `{${k}}`).join(", ")}.`);
  }
}

/** Alvo de grupo exige o motor Evolution — a Cloud API oficial não gerencia grupo real. */
function validateChannelTarget(channel: AutomationChannel, target: AutomationTarget) {
  if (GROUP_TARGETS.includes(target) && channel !== "EVOLUTION") {
    throw new AutomationValidationError("CHANNEL_TARGET_MISMATCH",
      "Mensagem para grupo precisa do motor Evolution. A API oficial da Meta não publica em grupo.");
  }
  if (!GROUP_TARGETS.includes(target) && channel !== "OFFICIAL") {
    throw new AutomationValidationError("CHANNEL_TARGET_MISMATCH",
      "Mensagem no privado deve sair pelo canal oficial da Meta.");
  }
}

/**
 * Salva a configuração de um evento e registra a mudança. Valida ANTES de gravar:
 * nada entra no banco em estado inválido.
 */
export function saveAutomationSettings(
  db: AppDatabase,
  event: string,
  patch: AutomationPatch,
  actor?: { id?: string; name?: string },
): AutomationSettings {
  if (!isAutomationEvent(event)) {
    throw new AutomationValidationError("UNKNOWN_EVENT", "Esta automação não existe.");
  }
  const meta = automationMeta(event);
  const current = automationSettings(db, event);

  const next: Required<Omit<AutomationPatch, "intervalMinutes">> & { intervalMinutes?: number } = {
    enabled: patch.enabled ?? current.enabled,
    text: (patch.text ?? current.text).trim(),
    channel: patch.channel ?? current.channel,
    target: patch.target ?? current.target,
    intervalMinutes: patch.intervalMinutes ?? current.intervalMinutes,
  };

  validateChannelTarget(next.channel, next.target);
  validateAutomationText(event, next.text, next.target);
  if (meta.periodic) {
    const minutes = next.intervalMinutes ?? meta.defaultIntervalMinutes ?? 0;
    if (!Number.isInteger(minutes) || minutes < 15) {
      throw new AutomationValidationError("INTERVAL_TOO_SHORT",
        "O intervalo mínimo é de 15 minutos, para o bot não abafar a conversa do grupo.");
    }
    next.intervalMinutes = minutes;
  } else {
    next.intervalMinutes = undefined;
  }

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`INSERT INTO bot_automations
      (event,enabled,text,channel,target,interval_minutes,updated_at,updated_by_owner_id,updated_by_owner_name)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(event) DO UPDATE SET enabled=excluded.enabled,text=excluded.text,channel=excluded.channel,
        target=excluded.target,interval_minutes=excluded.interval_minutes,updated_at=excluded.updated_at,
        updated_by_owner_id=excluded.updated_by_owner_id,updated_by_owner_name=excluded.updated_by_owner_name`)
      .run(event, next.enabled ? 1 : 0, next.text, next.channel, next.target,
        next.intervalMinutes ?? null, now, actor?.id ?? null, actor?.name ?? null);

    const changes: Array<[string, string, string]> = [];
    if (next.enabled !== current.enabled) changes.push(["enabled", String(current.enabled), String(next.enabled)]);
    if (next.text !== current.text) changes.push(["text", current.text, next.text]);
    if (next.channel !== current.channel) changes.push(["channel", current.channel, next.channel]);
    if (next.target !== current.target) changes.push(["target", current.target, next.target]);
    if (next.intervalMinutes !== current.intervalMinutes) {
      changes.push(["intervalMinutes", String(current.intervalMinutes ?? ""), String(next.intervalMinutes ?? "")]);
    }
    const audit = db.prepare(`INSERT INTO bot_automation_audit
      (event,field,before_value,after_value,actor_owner_id,actor_owner_name,created_at) VALUES (?,?,?,?,?,?,?)`);
    for (const [field, before, after] of changes) {
      audit.run(event, field, before, after, actor?.id ?? null, actor?.name ?? null, now);
    }
  })();

  return automationSettings(db, event);
}

/** Volta um evento ao padrão de fábrica (e registra quem fez). */
export function resetAutomationSettings(db: AppDatabase, event: string, actor?: { id?: string; name?: string }) {
  if (!isAutomationEvent(event)) {
    throw new AutomationValidationError("UNKNOWN_EVENT", "Esta automação não existe.");
  }
  const current = automationSettings(db, event);
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("DELETE FROM bot_automations WHERE event=?").run(event);
    if (current.customized) {
      db.prepare(`INSERT INTO bot_automation_audit
        (event,field,before_value,after_value,actor_owner_id,actor_owner_name,created_at) VALUES (?,?,?,?,?,?,?)`)
        .run(event, "reset", current.text, automationMeta(event).defaultText,
          actor?.id ?? null, actor?.name ?? null, now);
    }
  })();
  return automationSettings(db, event);
}

/** Histórico de mudanças de um evento (ou de todos), mais recente primeiro. */
export function automationAudit(db: AppDatabase, event?: string, limit = 50) {
  const rows = event
    ? db.prepare(`SELECT event,field,before_value AS before,after_value AS after,
        actor_owner_name AS actorName,created_at AS createdAt
        FROM bot_automation_audit WHERE event=? ORDER BY id DESC LIMIT ?`).all(event, limit)
    : db.prepare(`SELECT event,field,before_value AS before,after_value AS after,
        actor_owner_name AS actorName,created_at AS createdAt
        FROM bot_automation_audit ORDER BY id DESC LIMIT ?`).all(limit);
  return rows as Array<{
    event: string; field: string; before: string | null; after: string | null;
    actorName: string | null; createdAt: string;
  }>;
}
