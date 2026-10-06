import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "./config.js";
import type { AppDatabase } from "./db.js";
import { ownerAccounts } from "./owners.js";
import { effectiveWhatsAppConfig } from "./integrations.js";
import { materializeApprovedMembership, recordGroupVerification, recordMemberVerification } from "./group-verification.js";

declare module "fastify" { interface FastifyRequest { whatsappRawBody?: Buffer } }
type Payload = Record<string, unknown>;
const now = () => new Date().toISOString();
const phoneValid = (phone: string) => /^[1-9]\d{7,14}$/.test(phone);
export const whatsappConfigured = (config: Config) => Boolean(config.WHATSAPP_PHONE_NUMBER_ID && config.WHATSAPP_ACCESS_TOKEN && config.WHATSAPP_APP_SECRET && config.WHATSAPP_VERIFY_TOKEN);
const equal = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
export function publicWhatsAppNumber(config: Config) {
  return config.OWNER_WHATSAPP ?? config.OWNER_RAFAEL_WHATSAPP;
}
export function whatsappJoinUrl(config: Config) {
  const phone = publicWhatsAppNumber(config);
  return phone ? `https://wa.me/${phone}?text=${encodeURIComponent("Olá! Quero participar do projeto SOS YouTube.")}` : undefined;
}
function queue(db: AppDatabase, recipient: string, payload: Payload, dedupeKey: string, expiresAt?: string) {
  db.prepare("INSERT OR IGNORE INTO whatsapp_outbox (id,dedupe_key,recipient,payload,available_at,expires_at,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(randomUUID(),dedupeKey,recipient,JSON.stringify(payload),now(),expiresAt ?? null,now());
}
function template(config: Config, name: string, parameters: string[]): Payload {
  return { type: "template", template: { name, language: { code: config.WHATSAPP_TEMPLATE_LANGUAGE }, components: [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text })) }] } };
}
export function queueOwnerAlerts(db: AppDatabase, config: Config, requestId: string, phone: string, name: string, eventId: string) {
  if (!config.WHATSAPP_OWNER_ALERT_TEMPLATE) return;
  const count = (db.prepare("SELECT COUNT(*) AS n FROM participation_requests WHERE status='PENDING'").get() as { n: number }).n;
  const recipients = config.OWNER_ALERT_WHATSAPP
    ? [{ id: "primary", phone: config.OWNER_ALERT_WHATSAPP }]
    : ownerAccounts(config).filter((owner) => owner.phone).map((owner) => ({ id: owner.id, phone: owner.phone! }));
  for (const recipient of recipients) queue(
    db,
    recipient.phone,
    template(config,config.WHATSAPP_OWNER_ALERT_TEMPLATE,[name,phone,String(count)]),
    eventId + ":owner:" + recipient.id + ":" + requestId
  );
}

export function queueParticipationDecision(
  db: AppDatabase,
  config: Config,
  requestId: string,
  status: "APPROVED" | "DECLINED",
  groupCode?: string
) {
  const request = db.prepare("SELECT phone,name,source,whatsapp_verified_at AS verifiedAt FROM participation_requests WHERE id=?").get(requestId) as
    | { phone: string; name: string; source: string; verifiedAt?: string }
    | undefined;
  if (!request || request.source !== "WHATSAPP") return false;

  const stage = status === "APPROVED" ? "APPROVED" : "DECLINED";
  db.prepare("INSERT INTO whatsapp_conversations (phone,stage,updated_at) VALUES (?,?,?) ON CONFLICT(phone) DO UPDATE SET stage=excluded.stage,updated_at=excluded.updated_at")
    .run(request.phone,stage,now());

  const serviceStart = request.verifiedAt ? Date.parse(request.verifiedAt) : NaN;
  const serviceExpiresAt = Number.isFinite(serviceStart) ? new Date(serviceStart + 24 * 3600_000) : undefined;
  const inServiceWindow = Boolean(serviceExpiresAt && serviceExpiresAt.getTime() > Date.now());
  const dedupe = `decision:${requestId}:${status}:${groupCode ?? "-"}`;

  if (inServiceWindow && serviceExpiresAt) {
    const body = status === "APPROVED"
      ? `Olá, ${request.name}! Seu cadastro foi aprovado no SOS YOUTUBER ${groupCode}. Você já pode acessar ${config.WEB_APP_URL} usando seu nome, WhatsApp e o grupo ${groupCode}. Nenhuma credencial adicional é necessária.`
      : `Olá, ${request.name}. Sua solicitação ao SOS YouTube não foi aprovada neste momento. Se acreditar que houve engano, responda por aqui para que os Owners possam revisar.`;
    queue(db,request.phone,{type:"text",text:{body}},dedupe,serviceExpiresAt.toISOString());
    return true;
  }

  if (config.WHATSAPP_DECISION_TEMPLATE) {
    const label = status === "APPROVED" ? "APROVADO" : "NÃO APROVADO";
    queue(db,request.phone,template(config,config.WHATSAPP_DECISION_TEMPLATE,[request.name,label,groupCode ?? "-",config.WEB_APP_URL]),dedupe);
    return true;
  }
  return false;
}
type MetaGroupSummary = { id: string; subject: string };
type MetaGroupInfo = { id?: string; subject?: string; participants?: Array<{ wa_id?: string }> };

function groupCodeFromSubject(subject: string): string | undefined {
  return /^SOS\s+YOUTUBER\s+([1-9]|[1-9]\d)$/iu.exec(subject.trim())?.[1];
}

async function graphJson<T>(config: Config, path: string): Promise<T> {
  if (!config.WHATSAPP_ACCESS_TOKEN) throw new Error("WHATSAPP_NOT_CONFIGURED");
  const response = await fetch(`https://graph.facebook.com/${config.WHATSAPP_GRAPH_VERSION}/${path}`, {
    headers: { authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`, accept: "application/json" },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`WHATSAPP_GROUPS_${response.status}`);
  return await response.json() as T;
}

export async function syncOfficialWhatsAppGroups(db: AppDatabase, config: Config) {
  config = effectiveWhatsAppConfig(db,config);
  if (!config.WHATSAPP_GROUPS_SYNC_ENABLED || !config.WHATSAPP_PHONE_NUMBER_ID || !config.WHATSAPP_ACCESS_TOKEN) {
    return { discovered: 0, linked: 0, memberships: 0 };
  }
  const listing = await graphJson<{ data?: { groups?: MetaGroupSummary[] } }>(config,`${config.WHATSAPP_PHONE_NUMBER_ID}/groups?limit=1024`);
  const discovered = listing.data?.groups ?? [];
  let linked = 0, memberships = 0;
  for (const group of discovered) {
    const code = groupCodeFromSubject(group.subject);
    if (!code) continue;
    const info = await graphJson<MetaGroupInfo>(config,`${group.id}?fields=id,subject,participants,total_participant_count`);
    const phones = new Set((info.participants ?? []).map((item) => item.wa_id ?? "").filter(phoneValid));
    const stamp = now();
    db.transaction(() => {
      db.prepare(`INSERT INTO groups (code,enabled,whatsapp_group_id,membership_mode,last_synced_at)
        VALUES (?,1,?,'META_GROUPS_API',?)
        ON CONFLICT(code) DO UPDATE SET
          enabled=1,
          whatsapp_group_id=excluded.whatsapp_group_id,
          membership_mode='META_GROUPS_API',
          last_synced_at=excluded.last_synced_at`).run(code,group.id,stamp);
      recordGroupVerification(db,"META_GROUPS_API",code,group.id,group.subject,0,stamp);
      for (const phone of phones) {
        recordMemberVerification(db,"META_GROUPS_API",code,phone,group.id,true,stamp);
        materializeApprovedMembership(db,phone,code,stamp);
      }
      const existing = db.prepare("SELECT phone FROM whatsapp_member_verifications WHERE provider='META_GROUPS_API' AND group_code=? AND revoked_at IS NULL")
        .all(code) as Array<{ phone: string }>;
      for (const member of existing) if (!phones.has(member.phone)) {
        recordMemberVerification(db,"META_GROUPS_API",code,member.phone,group.id,false,stamp);
        db.prepare("UPDATE group_memberships SET revoked_at=? WHERE phone=? AND group_code=? AND revoked_at IS NULL").run(stamp,member.phone,code);
      }
    })();
    linked += 1;
    memberships += phones.size;
  }
  return { discovered: discovered.length, linked, memberships };
}

function applyGroupParticipantWebhook(db: AppDatabase, config: Config, entryId: string | undefined, group: {
  timestamp?: string; group_id: string; type: string;
  added_participants?: Array<{ wa_id?: string }>;
  removed_participants?: Array<{ wa_id?: string }>;
}) {
  const mapping = db.prepare("SELECT code FROM groups WHERE whatsapp_group_id=? AND enabled=1").get(group.group_id) as { code: string } | undefined;
  if (!mapping) return;
  const phones = [
    ...(group.added_participants ?? []).map((item) => item.wa_id ?? ""),
    ...(group.removed_participants ?? []).map((item) => item.wa_id ?? "")
  ].filter(phoneValid).sort();
  const eventKey = createHash("sha256").update([entryId ?? "",group.group_id,group.type,group.timestamp ?? "",...phones].join("|")).digest("hex");
  const fresh = db.prepare("INSERT OR IGNORE INTO whatsapp_group_events (event_key,received_at) VALUES (?,?)").run(eventKey,now());
  if (!fresh.changes) return;
  if (group.type === "group_participants_add") {
    for (const item of group.added_participants ?? []) if (item.wa_id && phoneValid(item.wa_id)) {
      recordMemberVerification(db,"META_GROUPS_API",mapping.code,item.wa_id,group.group_id,true);
      materializeApprovedMembership(db,item.wa_id,mapping.code);
    }
  }
  if (group.type === "group_participants_remove") {
    for (const item of group.removed_participants ?? []) if (item.wa_id && phoneValid(item.wa_id)) {
      recordMemberVerification(db,"META_GROUPS_API",mapping.code,item.wa_id,group.group_id,false);
      db.prepare("UPDATE group_memberships SET revoked_at=? WHERE phone=? AND group_code=? AND revoked_at IS NULL").run(now(),item.wa_id,mapping.code);
    }
  }
}

async function send(config: Config, recipient: string, payload: Payload): Promise<string> {
  if (!config.WHATSAPP_ACCESS_TOKEN || !config.WHATSAPP_PHONE_NUMBER_ID) throw new Error("WHATSAPP_NOT_CONFIGURED");
  const response = await fetch(`https://graph.facebook.com/${config.WHATSAPP_GRAPH_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST", signal: AbortSignal.timeout(15_000), headers: { authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: recipient, ...payload })
  });
  const data = await response.json() as { messages?: Array<{ id?: string }> };
  if (!response.ok || !data.messages?.[0]?.id) throw new Error(`WHATSAPP_DELIVERY_${response.status}`);
  return data.messages[0].id;
}
function otpPayload(config: Config, code: string): Payload {
  if (!config.WHATSAPP_OTP_TEMPLATE) throw new Error("WHATSAPP_OTP_TEMPLATE_MISSING");
  const payload = template(config,config.WHATSAPP_OTP_TEMPLATE,[code]);
  (payload.template as { components: unknown[] }).components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] });
  return payload;
}

export async function sendWhatsAppOtp(config: Config, phone: string, code: string) {
  await send(config,phone,otpPayload(config,code));
}

export function queueWhatsAppOtp(db: AppDatabase, config: Config, phone: string, code: string, dedupeKey: string, expiresAt: string) {
  if (!config.WHATSAPP_OTP_TEMPLATE) return false;
  queue(db,phone,otpPayload(config,code),dedupeKey,expiresAt);
  return true;
}
export async function flushWhatsAppOutbox(db: AppDatabase, config: Config, limit = 10) {
  config = effectiveWhatsAppConfig(db,config);
  if (!whatsappConfigured(config)) return;
  for (let index = 0; index < limit; index++) {
    const job = db.transaction(() => {
      const stamp = now();
      db.prepare("UPDATE whatsapp_outbox SET status='FAILED',last_error='SERVICE_WINDOW_EXPIRED' WHERE status IN ('PENDING','SENDING') AND expires_at IS NOT NULL AND expires_at <= ?").run(stamp);
      const row = db.prepare("SELECT * FROM whatsapp_outbox WHERE (status='PENDING' AND available_at<=?) OR (status='SENDING' AND lease_until<=?) ORDER BY created_at,rowid LIMIT 1").get(stamp,stamp) as { id: string; recipient: string; payload: string; attempts: number } | undefined;
      if (row) db.prepare("UPDATE whatsapp_outbox SET status='SENDING',attempts=attempts+1,lease_until=? WHERE id=?").run(new Date(Date.now()+60_000).toISOString(),row.id);
      return row;
    })();
    if (!job) break;
    try {
      const id = await send(config,job.recipient,JSON.parse(job.payload));
      db.prepare("UPDATE whatsapp_outbox SET status='SENT',provider_message_id=?,last_error=NULL,lease_until=NULL WHERE id=?").run(id,job.id);
    } catch (cause) {
      const attempts = job.attempts + 1;
      const code = cause instanceof Error && /^WHATSAPP_/.test(cause.message) ? cause.message : "WHATSAPP_NETWORK_ERROR";
      db.prepare("UPDATE whatsapp_outbox SET status=?,available_at=?,last_error=?,lease_until=NULL WHERE id=?")
        .run(attempts >= 5 ? "FAILED" : "PENDING",new Date(Date.now()+Math.min(300_000,2**attempts*10_000)).toISOString(),code,job.id);
    }
  }
}
export function whatsappStatus(db: AppDatabase, config: Config) {
  config = effectiveWhatsAppConfig(db,config);
  const count = (status: string) => (db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox WHERE status=?").get(status) as { n: number }).n;
  const groupsLinked = (db.prepare("SELECT COUNT(*) AS n FROM groups WHERE whatsapp_group_id IS NOT NULL AND membership_mode='META_GROUPS_API'").get() as { n: number }).n;
  const automaticMemberships = (db.prepare("SELECT COUNT(*) AS n FROM whatsapp_member_verifications WHERE provider='META_GROUPS_API' AND revoked_at IS NULL").get() as { n: number }).n;
  return {
    configured: whatsappConfigured(config),
    otpConfigured: Boolean(config.WHATSAPP_OTP_TEMPLATE),
    ownerAlertsConfigured: Boolean(config.WHATSAPP_OWNER_ALERT_TEMPLATE && (config.OWNER_ALERT_WHATSAPP || ownerAccounts(config).some((o) => o.phone))),
    decisionTemplateConfigured: Boolean(config.WHATSAPP_DECISION_TEMPLATE),
    groupsSyncEnabled: Boolean(config.WHATSAPP_GROUPS_SYNC_ENABLED),
    groupsLinked,
    automaticMemberships,
    queued: count("PENDING")+count("SENDING"),
    failed: count("FAILED"),
    sent: count("SENT"),
    membershipMode: groupsLinked > 0 ? "META_GROUPS_API" : "OWNER_VERIFIED"
  };
}
export async function registerWhatsAppRoutes(app: FastifyInstance, db: AppDatabase, config: Config, ownerGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  app.get("/webhooks/whatsapp", async (request,reply) => {
    const runtimeConfig = effectiveWhatsAppConfig(db,config);
    const query = request.query as Record<string,string>;
    if (!runtimeConfig.WHATSAPP_VERIFY_TOKEN) return reply.code(503).send({ message: "WhatsApp ainda não configurado." });
    if (query["hub.mode"] !== "subscribe" || !equal(query["hub.verify_token"] ?? "",runtimeConfig.WHATSAPP_VERIFY_TOKEN) || !/^\d{1,128}$/.test(query["hub.challenge"] ?? "")) return reply.code(403).send({ message: "Verificação inválida." });
    return reply.type("text/plain").send(query["hub.challenge"]);
  });
  app.post("/webhooks/whatsapp", { bodyLimit: 65536, preParsing: async (request,_reply,payload) => {
    const chunks: Buffer[] = []; let length = 0;
    for await (const chunk of payload) { const buffer = Buffer.from(chunk); length += buffer.length; if (length>65536) throw Object.assign(new Error("Payload too large"),{statusCode:413}); chunks.push(buffer); }
    request.whatsappRawBody = Buffer.concat(chunks); return Readable.from([request.whatsappRawBody]);
  } }, async (request,reply) => {
    const runtimeConfig = effectiveWhatsAppConfig(db,config);
    if (!whatsappConfigured(runtimeConfig)) return reply.code(503).send({ message: "WhatsApp ainda não configurado." });
    const signature = request.headers["x-hub-signature-256"];
    const expected = createHmac("sha256",runtimeConfig.WHATSAPP_APP_SECRET!).update(request.whatsappRawBody!).digest("hex");
    if (typeof signature !== "string" || !/^sha256=[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature.slice(7),"hex"),Buffer.from(expected,"hex"))) return reply.code(401).send({ message: "Assinatura inválida." });
    const body = z.object({ object: z.literal("whatsapp_business_account"), entry: z.array(z.object({ id: z.string().optional(), changes: z.array(z.object({ field: z.string().optional(), value: z.object({
      metadata: z.object({phone_number_id:z.string().optional()}).optional(),
      messages: z.array(z.object({id:z.string().optional(),from:z.string().optional(),type:z.string().optional(),timestamp:z.string().optional(),text:z.object({body:z.string().optional()}).optional()})).optional(),
      groups: z.array(z.object({
        timestamp: z.string().optional(),
        group_id: z.string(),
        type: z.string(),
        added_participants: z.array(z.object({wa_id:z.string().optional()})).optional(),
        removed_participants: z.array(z.object({wa_id:z.string().optional()})).optional()
      })).optional()
    }).optional() })).optional() })) }).parse(request.body);
    db.transaction(() => {
      for (const entry of body.entry!) {
        if (runtimeConfig.WHATSAPP_BUSINESS_ACCOUNT_ID && entry.id !== runtimeConfig.WHATSAPP_BUSINESS_ACCOUNT_ID) continue;
        for (const change of entry.changes ?? []) {
          if (!change.value || change.value.metadata?.phone_number_id !== runtimeConfig.WHATSAPP_PHONE_NUMBER_ID) continue;
          if (change.field === "group_participants_update") {
            for (const group of change.value.groups ?? []) applyGroupParticipantWebhook(db,runtimeConfig,entry.id,group);
            continue;
          }
          if (change.field !== "messages") continue;
          for (const msg of change.value.messages ?? []) {
            if (!msg.id || msg.id.length>256 || !msg.from || !phoneValid(msg.from) || msg.type !== "text" || !msg.text?.body || msg.text.body.length>500) continue;
            const fresh = db.prepare("INSERT OR IGNORE INTO whatsapp_received (message_id,received_at) VALUES (?,?)").run(msg.id,now()); if (!fresh.changes) continue;
            const stamp = Number(msg.timestamp)*1000;
            if (!Number.isFinite(stamp) || stamp > Date.now()+300_000) continue;
            const expires = new Date(stamp+24*3600_000).toISOString();
            const text = msg.text.body.trim(), normalized = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
            const conversation = db.prepare("SELECT stage FROM whatsapp_conversations WHERE phone=?").get(msg.from) as { stage: string } | undefined;
            if (normalized.includes("quero participar")) {
              db.prepare("INSERT INTO whatsapp_conversations (phone,stage,updated_at) VALUES (?,'WAITING_NAME',?) ON CONFLICT(phone) DO UPDATE SET stage='WAITING_NAME',updated_at=excluded.updated_at").run(msg.from,now());
              queue(db,msg.from,{type:"text",text:{body:`Olá! 👋 Seja bem-vindo ao Projeto SOS YouTube. Aqui, participantes dos grupos SOS YOUTUBER colaboram na montagem de ciclos com 10 links e podem levar a seleção para a própria conta do YouTube. Seu acesso é individual e depende da validação do número no grupo informado.`}},`${msg.id}:welcome`,expires);
              queue(db,msg.from,{type:"text",text:{body:"Como gostaria de ser chamado? Responda apenas com seu nome ou com a forma como prefere ser chamado."}},`${msg.id}:ask-name`,expires);
            } else if (conversation?.stage === "WAITING_NAME" && text.length>=2 && text.length<=80 && !/[\r\n]/.test(text) && !/https?:\/\//i.test(text)) {
              const hasActiveMembership = Boolean(db.prepare("SELECT 1 FROM group_memberships WHERE phone=? AND revoked_at IS NULL").get(msg.from));
              let responseBody = `Obrigado, ${text}! Seu pedido de participação será validado em breve. 📨`;
              if (!hasActiveMembership) {
                const existing = db.prepare("SELECT id,status,retry_block_until AS retryBlockUntil FROM participation_requests WHERE phone=?").get(msg.from) as
                  | { id: string; status: "PENDING" | "APPROVED" | "DECLINED"; retryBlockUntil?: string }
                  | undefined;
                const stamp = now(), blockActive = Boolean(existing?.retryBlockUntil && Date.parse(existing.retryBlockUntil) > Date.now());
                if (existing?.status === "PENDING") {
                  db.prepare("UPDATE participation_requests SET name=?,source='WHATSAPP',whatsapp_verified_at=?,updated_at=? WHERE id=?")
                    .run(text,stamp,stamp,existing.id);
                  responseBody = `Olá, ${text}! Seu pedido já está registrado e continua aguardando análise. Não é necessário enviar outro cadastro. 📨`;
                } else if ((existing?.status === "DECLINED" || existing?.status === "APPROVED") && blockActive) {
                  db.prepare("UPDATE participation_requests SET source='WHATSAPP',whatsapp_verified_at=?,updated_at=? WHERE id=?")
                    .run(stamp,stamp,existing.id);
                  responseBody = `Olá, ${text}. Este cadastro foi analisado recentemente e o prazo de segurança ainda está ativo. Seus dados continuam preservados; aguarde antes de uma nova solicitação.`;
                } else {
                  const blockedUntil = new Date(Date.now()+120*60_000).toISOString();
                  const id = existing?.id ?? randomUUID();
                  db.prepare(`INSERT INTO participation_requests (id,phone,name,status,source,whatsapp_verified_at,retry_block_until,duplicate_attempts,created_at,updated_at)
                    VALUES (?,?,?,'PENDING','WHATSAPP',?,?,0,?,?)
                    ON CONFLICT(phone) DO UPDATE SET name=excluded.name,status='PENDING',source='WHATSAPP',
                      whatsapp_verified_at=excluded.whatsapp_verified_at,retry_block_until=excluded.retry_block_until,
                      duplicate_attempts=0,updated_at=excluded.updated_at`)
                    .run(id,msg.from,text,stamp,blockedUntil,stamp,stamp);
                  queueOwnerAlerts(db,runtimeConfig,id,msg.from,text,msg.id);
                }
              } else {
                responseBody = `Olá, ${text}! Este número já está registrado em um grupo SOS YOUTUBER. Use o acesso normal do aplicativo com o grupo autorizado.`;
              }
              db.prepare("UPDATE whatsapp_conversations SET stage='SUBMITTED',updated_at=? WHERE phone=?").run(now(),msg.from);
              queue(db,msg.from,{type:"text",text:{body:responseBody}},`${msg.id}:received`,expires);
              queue(db,msg.from,{type:"text",text:{body:"Enquanto isso: o SOS YouTube organiza contribuições em Filas de 10 links. Depois da aprovação, basta entrar no aplicativo com seu nome, WhatsApp e grupo SOS YOUTUBER. Não existe credencial adicional para participante."}},`${msg.id}:project-info`,expires);
            }
          }
        }
      }
    })();
    return { ok: true };
  });
  app.post("/admin/whatsapp/retry", { preHandler: ownerGuard }, async () => {
    db.prepare("UPDATE whatsapp_outbox SET status='PENDING',attempts=0,available_at=? WHERE status='FAILED' AND (expires_at IS NULL OR expires_at>?)").run(now(),now());
    return { ok: true };
  });
  app.post("/admin/whatsapp/groups/sync", { preHandler: ownerGuard }, async (_request, reply) => {
    if (!config.WHATSAPP_GROUPS_SYNC_ENABLED) return reply.code(409).send({ message: "Sincronização automática de grupos está desativada." });
    try { return await syncOfficialWhatsAppGroups(db,config); }
    catch (cause) {
      app.log.error(cause);
      return reply.code(502).send({ message: "A Meta não permitiu sincronizar os grupos agora. Confira elegibilidade, token e número Cloud API." });
    }
  });

  let running: Promise<void> | undefined, groupsRunning: Promise<unknown> | undefined;
  let busy = false, groupsBusy = false;
  let timer: ReturnType<typeof setInterval> | undefined, groupsTimer: ReturnType<typeof setInterval> | undefined;
  if (config.NODE_ENV !== "test") app.addHook("onReady", async () => {
    timer = setInterval(() => {
      if (busy) return;
      busy=true;
      running = flushWhatsAppOutbox(db,config).catch(() => app.log.error("WhatsApp outbox worker failed")).finally(() => { busy=false; });
    },5_000);
    timer.unref();

    if (config.WHATSAPP_GROUPS_SYNC_ENABLED) {
      const sync = () => {
        if (groupsBusy) return;
        groupsBusy=true;
        groupsRunning = syncOfficialWhatsAppGroups(db,config).catch((cause) => app.log.error(cause)).finally(() => { groupsBusy=false; });
      };
      sync();
      groupsTimer = setInterval(sync,config.WHATSAPP_GROUPS_SYNC_MINUTES * 60_000);
      groupsTimer.unref();
    }
  });
  return async () => {
    if (timer) clearInterval(timer);
    if (groupsTimer) clearInterval(groupsTimer);
    await running;
    await groupsRunning;
  };
}
