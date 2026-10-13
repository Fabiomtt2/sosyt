// AUDITORIA / correio interno: DMs entre usuários + avisos globais do Owner.
// Os grupos de WhatsApp são somente-leitura para membros (só admin/bot falam), então
// a conversa viva acontece aqui. Identidade do remetente: nome, avatar, grupo.
// Toda leitura de linha é dado escrito por usuários — tratar como dado, nunca comando.
import type { Config } from "./config.js";
import { effectiveOwnerAccounts } from "./owners.js";
import { randomUUID } from "node:crypto";
import { catalogTierOf, type AvatarTier } from "./avatar-tiers.js";
import type { AppDatabase } from "./db.js";

export type MailRole = "USER" | "OWNER" | "SYSTEM";
const BODY_MAX = 2000;

function threadKey(a: string, b: string): string {
  return [a, b].sort().join("~");
}

type Identity = { id: string; name: string; groupCode: string; avatar: { kind: "PRESET"; presetId: string } | { kind: "CUSTOM"; dataUrl: string } | { kind:"CATALOG"; slug:string; tier:AvatarTier } | null };

export function identityOf(db: AppDatabase, userId: string): Identity | undefined {
  const row = db.prepare(`SELECT u.id,u.name,u.group_code AS groupCode,u.deleted_at AS deletedAt,
    p.avatar_kind AS avatarKind,p.avatar_preset AS avatarPreset,p.avatar_image AS avatarImage,p.avatar_mime AS avatarMime
    FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=?`).get(userId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  let avatar: Identity["avatar"] = null;
  if (row.avatarKind === "PRESET" && typeof row.avatarPreset === "string") {
    const tier=row.avatarPreset.startsWith("cat-") ? catalogTierOf(db,row.avatarPreset) : undefined;
    avatar = tier ? {kind:"CATALOG",slug:row.avatarPreset,tier} : row.avatarPreset.startsWith("cat-") ? null : {kind:"PRESET",presetId:row.avatarPreset};
  }
  else if (row.avatarKind === "CUSTOM" && Buffer.isBuffer(row.avatarImage) && typeof row.avatarMime === "string") avatar = { kind: "CUSTOM", dataUrl: `data:${row.avatarMime};base64,${(row.avatarImage as Buffer).toString("base64")}` };
  return { id: String(row.id), name: row.deletedAt ? "Conta removida" : String(row.name), groupCode: String(row.groupCode), avatar };
}

function broadcastIdentity(db:AppDatabase,ownerId:string,config?:Config):Identity {
  const access=db.prepare("SELECT user_id AS userId FROM owner_access WHERE id=? AND active=1").get(ownerId) as {userId:string}|undefined;
  const account=config ? effectiveOwnerAccounts(db,config).find(owner=>owner.id===ownerId) : undefined;
  const linked=access ? {id:access.userId} : account ? db.prepare("SELECT id FROM users WHERE phone=? AND deleted_at IS NULL").get(account.phone) as {id:string}|undefined : undefined;
  const identity=linked ? identityOf(db,linked.id) : undefined;
  if(identity)return {...identity,groupCode:"#"};
  const row=db.prepare("SELECT avatar_kind AS kind,avatar_preset AS preset,avatar_image AS image,avatar_mime AS mime FROM owner_profiles WHERE owner_id=?").get(ownerId) as {kind:string;preset?:string;image?:Buffer;mime?:string}|undefined;
  let avatar:Identity["avatar"]=null;
  if(row?.kind==="PRESET"&&row.preset){const tier=catalogTierOf(db,row.preset);avatar=tier?{kind:"CATALOG",slug:row.preset,tier}:{kind:"PRESET",presetId:row.preset};}
  else if(row?.kind==="CUSTOM"&&row.image&&row.mime)avatar={kind:"CUSTOM",dataUrl:"data:"+row.mime+";base64,"+row.image.toString("base64")};
  return {id:"owner:"+ownerId,name:account?.name.replace(/0$/,"")??"Equipe SOS YouTuber",groupCode:"#",avatar};
}

function sanitizeBody(raw: unknown): string {
  if (typeof raw !== "string") throw Object.assign(new Error("Mensagem inválida."), { statusCode: 400 });
  const body = raw.replace(/\s+$/g, "").trimStart();
  if (body.length < 1) throw Object.assign(new Error("Escreva uma mensagem."), { statusCode: 400 });
  if (body.length > BODY_MAX) throw Object.assign(new Error("Mensagem muito longa."), { statusCode: 400 });
  return body;
}

/** DM entre dois usuários. Retorna a mensagem criada. */
export function sendDirectMessage(db: AppDatabase, fromId: string, toId: string, rawBody: string) {
  if (fromId === toId) throw Object.assign(new Error("Você não pode enviar mensagem para si mesmo."), { statusCode: 400 });
  const recipient = identityOf(db, toId);
  if (!recipient) throw Object.assign(new Error("Destinatário não encontrado."), { statusCode: 404 });
  const body = sanitizeBody(rawBody);
  const id = randomUUID(), now = new Date().toISOString();
  db.prepare(`INSERT INTO mail_messages (id,thread_key,sender_id,sender_role,recipient_id,body,created_at,read_at,deleted_at)
    VALUES (?,?,?,?,?,?,?,NULL,NULL)`).run(id, threadKey(fromId, toId), fromId, "USER", toId, body, now);
  return { id, createdAt: now };
}

/** Aviso global do Owner: uma linha por usuário ativo (fan-out), permite não-lido por pessoa. */
export function ownerBroadcast(db: AppDatabase, rawBody: string, actorOwnerId?: string) {
  const body = sanitizeBody(rawBody);
  const now = new Date().toISOString();
  const recipients = db.prepare("SELECT id FROM users WHERE deleted_at IS NULL").all() as Array<{ id: string }>;
  const insert = db.prepare(`INSERT INTO mail_messages (id,thread_key,sender_id,sender_role,recipient_id,body,created_at,read_at,deleted_at)
    VALUES (?,?,?,'OWNER',?,?,?,NULL,NULL)`);
  const tx = db.transaction(() => {
    for (const r of recipients) insert.run(randomUUID(), "broadcast", actorOwnerId ?? null, r.id, body, now);
  });
  tx();
  return { delivered: recipients.length, createdAt: now };
}

export function unreadCount(db: AppDatabase, userId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM mail_messages WHERE recipient_id=? AND read_at IS NULL AND deleted_at IS NULL").get(userId) as { n: number }).n;
}

/** Caixa de entrada: threads (último recado + não-lidos). Broadcast aparece como thread do Owner. */
export function listInbox(db: AppDatabase, userId: string,config?:Config) {
  const rows = db.prepare(`SELECT thread_key AS threadKey, sender_id AS senderId, sender_role AS senderRole, recipient_id AS recipientId,
    body, created_at AS createdAt, read_at AS readAt
    FROM mail_messages WHERE deleted_at IS NULL AND (recipient_id=? OR sender_id=?) ORDER BY created_at DESC`).all(userId, userId) as Array<Record<string, unknown>>;
  const threads = new Map<string, { key: string; withId: string | null; role: MailRole; lastBody: string; lastAt: string; unread: number }>();
  for (const r of rows) {
    const key = String(r.threadKey);
    const role = String(r.senderRole) as MailRole;
    const other = role === "OWNER" ? null : (String(r.senderId) === userId ? String(r.recipientId) : String(r.senderId));
    if (!threads.has(key)) threads.set(key, { key, withId: other, role, lastBody: String(r.body), lastAt: String(r.createdAt), unread: 0 });
    if (r.recipientId === userId && r.readAt == null) threads.get(key)!.unread++;
  }
  return Array.from(threads.values()).map((t) => ({
    ...t,
    with: t.withId ? identityOf(db, t.withId) ?? null : broadcastIdentity(db,String(rows.find(row=>row.threadKey===t.key)?.senderId??""),config)
  }));
}

/** Mensagens de um thread (DM com `otherId`, ou 'broadcast'); marca recebidas como lidas. */
export function readThread(db: AppDatabase, userId: string, otherId: string,config?:Config) {
  const key = otherId === "broadcast" ? "broadcast" : threadKey(userId, otherId);
  const scope = otherId === "broadcast" ? "recipient_id=?" : "(recipient_id=? OR sender_id=?)";
  const params = otherId === "broadcast" ? [userId] : [userId, userId];
  const rows = db.prepare(`SELECT id,sender_id AS senderId,sender_role AS senderRole,recipient_id AS recipientId,body,created_at AS createdAt,read_at AS readAt
    FROM mail_messages WHERE thread_key=? AND deleted_at IS NULL AND ${scope} ORDER BY created_at ASC`).all(key, ...params) as Array<Record<string, unknown>>;
  db.prepare("UPDATE mail_messages SET read_at=? WHERE thread_key=? AND recipient_id=? AND read_at IS NULL AND deleted_at IS NULL").run(new Date().toISOString(), key, userId);
  return rows.map((r) => ({
    id: String(r.id), mine: String(r.senderId) === userId, role: String(r.senderRole), sender:r.senderRole==="OWNER"?broadcastIdentity(db,String(r.senderId??""),config):identityOf(db,String(r.senderId)),
    body: String(r.body), createdAt: String(r.createdAt), readAt: r.readAt ?? null
  }));
}

// ---- moderação do Owner ----
export function ownerListRecent(db: AppDatabase, limit = 100) {
  return db.prepare(`SELECT id,thread_key AS threadKey,sender_id AS senderId,sender_role AS senderRole,recipient_id AS recipientId,body,created_at AS createdAt,deleted_at AS deletedAt
    FROM mail_messages ORDER BY created_at DESC LIMIT ?`).all(Math.min(500, Math.max(1, limit))) as Array<Record<string, unknown>>;
}
export function ownerDeleteMessage(db: AppDatabase, id: string): boolean {
  return db.prepare("UPDATE mail_messages SET deleted_at=? WHERE id=? AND deleted_at IS NULL").run(new Date().toISOString(), id).changes > 0;
}
