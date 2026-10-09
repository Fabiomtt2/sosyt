// AUDITORIA / chat global: canal público, único, sempre visível. A regra de ouro é
// que a mensagem é SEMPRE texto puro — nenhuma marcação é interpretada no cliente
// (React escapa por padrão; aqui barramos na entrada também, defesa em profundidade).
// Camadas: sanitização de controle/HTML, anti-link (membros), anti-injeção,
// anti-xingamento, limite de tamanho, cooldown, mute e banimento ("remover da sala").
import { randomUUID } from "node:crypto";
import type { AppDatabase } from "./db.js";
import { identityOf } from "./mailbox.js";
import { effectiveSuper, superState } from "./super.js";

// SUPER tem estetica propria no chat, abaixo do destaque de ADMIN/OWNER.
export type ChatRole = "USER" | "SUPER" | "ADMIN" | "OWNER";
const BODY_MAX = 500;
const DEFAULT_COOLDOWN_SECONDS = 180; // 3 minutos para membros comuns (owner configura)

// ---------- camadas de segurança ----------

/** Normaliza para detectar ofuscação (leet, acentos, repetição, zero-width). */
function normalizeForScan(text: string): string {
  return text
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")       // tira acentos combinantes
    .replace(/[\u200b-\u200d\ufeff]/g, "")                  // zero-width
    .toLowerCase()
    .replace(/[0@]/g, "o").replace(/[1!|]/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t").replace(/\$/g, "s")
    .replace(/(.)\1{2,}/g, "$1$1");                           // colapsa repeticao (aaaa -> aa)
}

/** Links e "letras+números que remetem a URL". Membros não podem; admin/owner sim. */
export function looksLikeLink(text: string): boolean {
  const t = text.toLowerCase();
  if (/\bhttps?:\/\//.test(t) || /\bwww\./.test(t)) return true;
  if (/\b[a-z0-9-]+\.(com|net|org|io|app|br|gg|me|xyz|tv|link|site|online|dev|co|info|biz|ly|be)\b/.test(t)) return true; // dominio.tld
  if (/\b[a-z0-9-]{1,30}\s*(?:\.|\(ponto\)|\[ponto\]|\bponto\b|\bdot\b)\s*(?:com|net|org|br|io|gg|me|tv)\b/.test(normalizeForScan(text))) return true; // "site ponto com"
  if (/\bt\.me\/|\bwa\.me\/|\bbit\.ly\/|\bdiscord\.gg\//.test(t)) return true;
  return false;
}

/** HTML/script/injeção: barra qualquer tag, entidade perigosa, data:/js:, template. */
export function hasUnsafeMarkup(text: string): boolean {
  if (/[<>]/.test(text)) return true;                          // nenhuma tag
  if (/&#|&lt;|&gt;|&amp;#/i.test(text)) return true;          // entidades
  if (/\b(?:javascript|data|vbscript):/i.test(text)) return true;
  if (/\bon\w+\s*=/i.test(text)) return true;                  // onerror=, onclick=
  if (/\$\{|\{\{|<%|%>/.test(text)) return true;               // template injection
  if (/data:image|base64,/i.test(text)) return true;          // nada de imagem/midia embutida
  return false;
}

// blocklist PT-BR enxuta (owner poderá editar depois). Casada sobre texto normalizado.
const PROFANITY = [
  "merda", "porra", "caralho", "puta", "putaria", "viado", "viadinho", "cuzao", "cuzinho", "arrombado",
  "fdp", "foda-se", "fodase", "buceta", "boceta", "piranha", "vagabunda", "corno", "otario", "babaca",
  "desgraca", "filho da puta", "vai se fuder", "vsf", "retardado", "imbecil", "idiota"
];
export function hasProfanity(text: string): boolean {
  const n = normalizeForScan(text);
  return PROFANITY.some((w) => new RegExp(`(^|[^a-z])${w.replace(/[-\s]/g, "[-\\s]?")}([^a-z]|$)`).test(n));
}

function err(statusCode: number, message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { statusCode, ...extra });
}
function sanitizePlain(raw: unknown): string {
  if (typeof raw !== "string") throw err(400, "Mensagem invalida.");
  // remove controles (mantem quebras e tabs), normaliza espacos
  const cleaned = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (cleaned.length < 1) throw err(400, "Escreva uma mensagem.");
  if (cleaned.length > BODY_MAX) throw err(400, `Maximo de ${BODY_MAX} caracteres.`);
  return cleaned;
}

// ---------- papel do remetente ----------
export function chatRoleOf(db: AppDatabase, userId: string): ChatRole {
  const row = db.prepare("SELECT role FROM owner_access WHERE user_id=? AND active=1").get(userId) as { role: string } | undefined;
  if (row?.role === "ROOT_OWNER") return "OWNER";
  if (row?.role === "ADMIN_OWNER") return "ADMIN";
  // Assinatura viva vira papel SUPER; ao vencer, volta a USER sozinho.
  return superState(db, userId).active ? "SUPER" : "USER";
}
const isStaff = (r: ChatRole) => r === "ADMIN" || r === "OWNER";

// ---------- estado de moderação por usuário ----------
type ModState = { removed: boolean; mutedUntil?: string; cooldownSeconds: number };
export function moderationState(db: AppDatabase, userId: string): ModState {
  const row = db.prepare("SELECT removed, muted_until AS mutedUntil, cooldown_seconds AS cooldownSeconds FROM global_chat_members WHERE user_id=?").get(userId) as
    | { removed: number; mutedUntil?: string; cooldownSeconds?: number } | undefined;
  return { removed: Boolean(row?.removed), mutedUntil: row?.mutedUntil, cooldownSeconds: row?.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS };
}
function upsertMember(db: AppDatabase, userId: string, patch: Record<string, unknown>) {
  const cols = Object.keys(patch);
  const existing = db.prepare("SELECT user_id FROM global_chat_members WHERE user_id=?").get(userId);
  const now = new Date().toISOString();
  if (existing) db.prepare(`UPDATE global_chat_members SET ${cols.map((c) => `${c}=?`).join(",")}, updated_at=? WHERE user_id=?`).run(...cols.map((c) => patch[c]), now, userId);
  else db.prepare(`INSERT INTO global_chat_members (user_id, ${cols.join(",")}, updated_at) VALUES (?, ${cols.map(() => "?").join(",")}, ?)`).run(userId, ...cols.map((c) => patch[c]), now);
}

// ---------- envio ----------
export function sendGlobalMessage(db: AppDatabase, userId: string, rawBody: string) {
  const role = chatRoleOf(db, userId);
  const mod = moderationState(db, userId);
  if (mod.removed) throw err(403, "Você não está no chat da comunidade no momento.", { code: "CHAT_REMOVED" });
  if (mod.mutedUntil && Date.parse(mod.mutedUntil) > Date.now()) throw err(403, "Você está temporariamente silenciado no chat.", { code: "CHAT_MUTED", until: mod.mutedUntil });

  const body = sanitizePlain(rawBody);
  if (hasUnsafeMarkup(body)) throw err(400, "Sua mensagem contém formatação não permitida.", { code: "CHAT_UNSAFE" });
  if (!isStaff(role)) {
    if (looksLikeLink(body)) throw err(400, "Links não são permitidos no chat da comunidade.", { code: "CHAT_LINK" });
    if (hasProfanity(body)) throw err(400, "Vamos manter o respeito 🙂 Reescreva sem ofensas.", { code: "CHAT_PROFANITY" });
    // AUDITORIA / SUPER: assinatura viva dispensa a espera entre mensagens.
    const sup = effectiveSuper(db, userId);
    const cooldown = sup.chatCooldownSeconds === 0 ? 0 : mod.cooldownSeconds;
    const last = cooldown > 0
      ? db.prepare("SELECT created_at AS at FROM global_chat_messages WHERE user_id=? ORDER BY created_at DESC LIMIT 1").get(userId) as { at: string } | undefined
      : undefined;
    if (last) {
      const waited = (Date.now() - Date.parse(last.at)) / 1000;
      if (waited < cooldown) throw err(429, "Aguarde um pouco antes de enviar outra mensagem.", { code: "CHAT_COOLDOWN", retryAfterSeconds: Math.ceil(cooldown - waited) });
    }
  }
  const id = randomUUID(), now = new Date().toISOString();
  db.prepare(`INSERT INTO global_chat_messages (id,user_id,sender_role,body,created_at,deleted_at,pinned) VALUES (?,?,?,?,?,NULL,0)`)
    .run(id, userId, role, body, now);
  return { id, createdAt: now, role };
}

// ---------- leitura (polling em tempo real por cursor) ----------
export function listGlobalMessages(db: AppDatabase, viewerId: string, opts: { afterId?: string; limit?: number } = {}) {
  const mod = moderationState(db, viewerId);
  if (mod.removed) return { removed: true as const, messages: [], pinned: [], cooldownSeconds: mod.cooldownSeconds, viewerRole: chatRoleOf(db, viewerId) };
  const limit = Math.min(100, Math.max(1, opts.limit ?? 60));
  let rows: Array<Record<string, unknown>>;
  if (opts.afterId) {
    const after = db.prepare("SELECT created_at AS at FROM global_chat_messages WHERE id=?").get(opts.afterId) as { at: string } | undefined;
    rows = db.prepare(`SELECT id,user_id AS userId,sender_role AS role,body,created_at AS createdAt,pinned FROM global_chat_messages
      WHERE deleted_at IS NULL AND created_at > ? ORDER BY created_at ASC LIMIT ?`).all(after?.at ?? "", limit) as Array<Record<string, unknown>>;
  } else {
    rows = (db.prepare(`SELECT id,user_id AS userId,sender_role AS role,body,created_at AS createdAt,pinned FROM global_chat_messages
      WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`).all(limit) as Array<Record<string, unknown>>).reverse();
  }
  const decorate = (r: Record<string, unknown>) => {
    const id = identityOf(db, String(r.userId));
    return {
      id: String(r.id), role: String(r.role) as ChatRole, body: String(r.body), createdAt: String(r.createdAt), pinned: Boolean(r.pinned),
      sender: id ? { id: id.id, name: id.name, groupCode: id.groupCode, avatar: id.avatar } : { id: String(r.userId), name: "Participante", groupCode: "", avatar: null }
    };
  };
  const pinned = (db.prepare(`SELECT id,user_id AS userId,sender_role AS role,body,created_at AS createdAt,pinned FROM global_chat_messages
    WHERE deleted_at IS NULL AND pinned=1 ORDER BY created_at DESC LIMIT 3`).all() as Array<Record<string, unknown>>).map(decorate);
  // O cooldown informado ao cliente ja considera o privilegio SUPER.
  const viewerSuper = effectiveSuper(db, viewerId);
  return { removed: false as const, messages: rows.map(decorate), pinned,
    cooldownSeconds: viewerSuper.chatCooldownSeconds === 0 ? 0 : mod.cooldownSeconds,
    viewerRole: chatRoleOf(db, viewerId) };
}

// ---------- ações administrativas ----------
export function adminDeleteMessage(db: AppDatabase, id: string): boolean {
  return db.prepare("UPDATE global_chat_messages SET deleted_at=? WHERE id=? AND deleted_at IS NULL").run(new Date().toISOString(), id).changes > 0;
}
export function adminSetPinned(db: AppDatabase, id: string, pinned: boolean): boolean {
  return db.prepare("UPDATE global_chat_messages SET pinned=? WHERE id=? AND deleted_at IS NULL").run(pinned ? 1 : 0, id).changes > 0;
}
export function adminClearChat(db: AppDatabase): number {
  return db.prepare("UPDATE global_chat_messages SET deleted_at=? WHERE deleted_at IS NULL").run(new Date().toISOString()).changes;
}
export function adminMute(db: AppDatabase, userId: string, minutes: number) {
  const until = new Date(Date.now() + Math.max(1, minutes) * 60_000).toISOString();
  upsertMember(db, userId, { muted_until: until });
  return { mutedUntil: until };
}
export function adminUnmute(db: AppDatabase, userId: string) { upsertMember(db, userId, { muted_until: null }); }
export function adminSetCooldown(db: AppDatabase, userId: string, seconds: number) {
  upsertMember(db, userId, { cooldown_seconds: Math.max(0, Math.min(86_400, Math.round(seconds))) });
}
export function adminRemoveFromRoom(db: AppDatabase, userId: string) { upsertMember(db, userId, { removed: 1 }); }
export function adminRestoreToRoom(db: AppDatabase, userId: string) { upsertMember(db, userId, { removed: 0 }); }
export { DEFAULT_COOLDOWN_SECONDS };
