import { encryptToken, decryptToken } from "./youtube.js";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "./config.js";
import type { AppDatabase } from "./db.js";
import { ownerAccounts } from "./owners.js";
import { automationSettings, ensureBotAutomations } from "./bot-automation-store.js";
import { renderTemplate, type AutomationEvent } from "./bot-automations.js";
import { featureEnabled } from "./bot.js";
import { createEvolutionClient, assertDistinctFromOfficial, jidToPhone, DEFAULT_CADENCE, nextSendDelayMs, warmupCapForDay } from "./bot-evolution.js";
import { effectiveWhatsAppConfig, readWhatsAppIntegration } from "./integrations.js";
import { materializeApprovedMembership, recordGroupVerification, recordMemberVerification } from "./group-verification.js";
import { classifyInbound, ensureBotOptOut, looksLikeName, nameRejectionReason, replyFor, setOptOut, DECLINED_FOLLOWUP_REPLY, MEDIA_REPLY, TOO_LONG_REPLY } from "./bot-inbound.js";
import { humanHandoffAlert, humanSupportNumber } from "./bot-human-handoff.js";
import { canDeliver, ensureBotDelivery, recordDelivery, recordSuppressed, inQuietHours, nextQuietHoursEnd, DEFAULT_DELIVERY_POLICY, type DeliveryClass } from "./bot-delivery-policy.js";

declare module "fastify" { interface FastifyRequest { whatsappRawBody?: Buffer } }
type Payload = Record<string, unknown>;
const now = () => new Date().toISOString();
const phoneValid = (phone: string) => /^[1-9]\d{7,14}$/.test(phone);
const evolutionConfigured=(config:Config)=>Boolean(config.EVOLUTION_URL&&config.EVOLUTION_INSTANCE&&config.EVOLUTION_API_KEY&&config.EVOLUTION_PHONE&&config.EVOLUTION_WEBHOOK_SECRET);
export const whatsappConfigured = (config: Config) => config.WHATSAPP_MODE==="DISABLED" ? false : config.WHATSAPP_MODE==="EVOLUTION" ? evolutionConfigured(config) : Boolean(!config.WHATSAPP_SENDER_VALIDATION_REQUIRED && config.WHATSAPP_PHONE_NUMBER_ID && config.WHATSAPP_ACCESS_TOKEN && config.WHATSAPP_APP_SECRET && config.WHATSAPP_VERIFY_TOKEN);
export const whatsappOtpConfigured=(config:Config)=>config.WHATSAPP_MODE!=="EVOLUTION"&&config.WHATSAPP_MODE!=="DISABLED"&&whatsappConfigured(config)&&Boolean(config.WHATSAPP_OTP_TEMPLATE);
function evolutionClient(config:Config){
  if(!evolutionConfigured(config))throw Object.assign(new Error("Configure URL, instância, chave, telefone e segredo do webhook Evolution."),{statusCode:409});
  if(config.WHATSAPP_MODE==="HYBRID_PLUS")assertDistinctFromOfficial(config.EVOLUTION_PHONE,config.WHATSAPP_BUSINESS_PHONE);
  return createEvolutionClient({config:{url:config.EVOLUTION_URL!,instance:config.EVOLUTION_INSTANCE!,apiKey:config.EVOLUTION_API_KEY!,number:config.EVOLUTION_PHONE}});
}
export async function whatsappRuntimeStatus(db:AppDatabase,config:Config){
  const state=readWhatsAppIntegration(db,config),runtime=effectiveWhatsAppConfig(db,config);
  const enabled=state.mode==="EVOLUTION"||state.mode==="HYBRID_PLUS";
  const health=enabled&&state.evolutionConfigured?await evolutionClient(runtime).health():{connected:false,state:"not_configured"};
  return {mode:state.mode,configured:whatsappConfigured(runtime),otpConfigured:whatsappOtpConfigured(runtime),otpBlockedReason:state.mode==="EVOLUTION"?"O código de acesso exige um número oficial independente. Use HYBRID+ com as duas linhas configuradas.":null,connected:state.mode==="EVOLUTION"?health.connected:null,checkedAt:now(),
    evolution:{configured:state.evolutionConfigured,...health,instance:state.evolutionInstance,phone:state.evolutionPhone},
    official:{configured:state.officialReady,connected:null}};
}
export async function connectEvolutionSession(db:AppDatabase,config:Config,expectedInstance:string,expectedPhone:string){
  const runtime=effectiveWhatsAppConfig(db,config);
  if(runtime.WHATSAPP_MODE!=="EVOLUTION"&&runtime.WHATSAPP_MODE!=="HYBRID_PLUS")throw Object.assign(new Error("Selecione Evolution ou HYBRID+ antes de conectar."),{statusCode:409});
  if(runtime.EVOLUTION_INSTANCE!==expectedInstance||runtime.EVOLUTION_PHONE!==expectedPhone)throw Object.assign(new Error("A configuração mudou. Recarregue o painel antes de conectar."),{statusCode:409});
  const client=evolutionClient(runtime);
  await client.configureWebhook(new URL("/webhooks/whatsapp/evolution",runtime.API_PUBLIC_URL).toString(),runtime.EVOLUTION_WEBHOOK_SECRET!);
  const data=await client.connect(expectedPhone);
  const current=effectiveWhatsAppConfig(db,config);
  if(current.EVOLUTION_INSTANCE!==expectedInstance||current.EVOLUTION_PHONE!==expectedPhone||current.EVOLUTION_URL!==runtime.EVOLUTION_URL)throw Object.assign(new Error("A configuração mudou durante a conexão. Recarregue o painel."),{statusCode:409});
  return {instance:expectedInstance,phone:expectedPhone,...Object.fromEntries(["base64","code","pairingCode","state"].flatMap(key=>typeof data[key]==="string"?[[key,data[key]]]:[]))};
}
const equal = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
export function publicWhatsAppNumber(config: Config, businessPhone?: string) {
  const persisted = businessPhone?.replace(/\D/g,"");
  if (persisted && phoneValid(persisted)) return persisted;
  return config.WHATSAPP_BUSINESS_PHONE || (config.OWNER_WHATSAPP ?? config.OWNER_BUSINESS_WHATSAPP ?? config.OWNER_RAFAEL_WHATSAPP);
}
export function whatsappJoinUrl(config: Config, businessPhone?: string) {
  const phone = publicWhatsAppNumber(config,businessPhone);
  return phone ? `https://wa.me/${phone}?text=${encodeURIComponent("Olá! Quero participar do projeto SOS YouTube.")}` : undefined;
}
function queue(db: AppDatabase, recipient: string, payload: Payload, dedupeKey: string, expiresAt?: string, identity?:Config) {
  payload={...payload,_transport:identity?.WHATSAPP_MODE==="EVOLUTION"?"EVOLUTION":"META",...(identity?.WHATSAPP_MODE==="EVOLUTION"?{_instance:identity.EVOLUTION_INSTANCE,_phone:identity.EVOLUTION_PHONE}:identity?{_phoneNumberId:identity.WHATSAPP_PHONE_NUMBER_ID}:{})};
  db.prepare("INSERT OR IGNORE INTO whatsapp_outbox (id,dedupe_key,recipient,payload,available_at,expires_at,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(randomUUID(),dedupeKey,recipient,JSON.stringify(payload),now(),expiresAt ?? null,now());
}
function template(config: Config, name: string, parameters: string[]): Payload {
  return { type: "template", template: { name, language: { code: config.WHATSAPP_TEMPLATE_LANGUAGE }, components: [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text })) }] } };
}
export function queueGroupAutomation(db:AppDatabase,config:Config,groupJid:string,body:string,dedupeKey:string,options?:{event:string;deliveryClass:"QUEUE"|"ENGAGEMENT";availableAt?:string;expiresAt?:string}){
  const runtime=effectiveWhatsAppConfig(db,config);
  if(!["EVOLUTION","HYBRID_PLUS"].includes(runtime.WHATSAPP_MODE)||!evolutionConfigured(runtime))return {queued:false,reason:"PROVIDER_NOT_READY"};
  if(!/^\d+(?:-\d+)?@g\.us$/.test(groupJid)||!body.trim())return {queued:false,reason:"INVALID_RECIPIENT"};
  if(runtime.WHATSAPP_MODE==="HYBRID_PLUS")assertDistinctFromOfficial(runtime.EVOLUTION_PHONE,runtime.WHATSAPP_BUSINESS_PHONE);
  const prior=db.prepare("SELECT id FROM whatsapp_outbox WHERE dedupe_key=?").get(dedupeKey) as {id:string}|undefined;
  if(prior)return {queued:true,outboxId:prior.id};
  const payload={_transport:"EVOLUTION_GROUP",_instance:runtime.EVOLUTION_INSTANCE,_phone:runtime.EVOLUTION_PHONE,text:{body:body.slice(0,4096)}};
  const id=randomUUID(),stamp=now(),availableAt=options?.availableAt??stamp;
  if(!Number.isFinite(Date.parse(availableAt)))return {queued:false,reason:"INVALID_SCHEDULE"};
  // AUDITORIA / Teo M1: anuncio de grupo pode carregar validade. Se o backlog de warmup
  // adiar alem disso (ou cair no silencio e so acordar depois), o varredor de expiracao
  // descarta em vez de entregar "Bom dia" obsoleto de madrugada.
  const expiresAt=options?.expiresAt&&Number.isFinite(Date.parse(options.expiresAt))?options.expiresAt:null;
  db.prepare("INSERT OR IGNORE INTO whatsapp_outbox(id,dedupe_key,recipient,payload,available_at,expires_at,created_at) VALUES(?,?,?,?,?,?,?)").run(id,dedupeKey,groupJid,JSON.stringify(payload),availableAt,expiresAt,stamp);
  return {queued:true,outboxId:id};
}
/** Queues a real notification; dispatch/receipt status stays in the durable outbox. */
export function queueBotNotification(db:AppDatabase,config:Config,phone:string,body:string,dedupeKey:string,approvedTemplate?:{name:string;language:string},options?:{encryptPayload?:boolean;deliveryClass?:DeliveryClass;event?:string}) {
  config=effectiveWhatsAppConfig(db,config);
  if(!phoneValid(phone)||!whatsappConfigured(config))return {queued:false,reason:"PROVIDER_NOT_READY"};
  // AUDITORIA / politica de entrega: opt-out, silencio noturno e orcamento diario
  // sao consultados AQUI, antes de ocupar a fila. Quem chama sem declarar a classe
  // recebe o tratamento mais conservador (ENGAGEMENT) — o padrao seguro e o que
  // respeita mais a pessoa, nao o que fala mais.
  const deliveryClass:DeliveryClass=options?.deliveryClass??"ENGAGEMENT";
  const event=options?.event??dedupeKey;
  const verdict=canDeliver(db,phone,deliveryClass);
  if(!verdict.allowed) {
    recordSuppressed(db,phone,event,verdict.reason);
    return {queued:false,reason:verdict.reason};
  }
  const safePayload=(payload:Payload):Payload=>options?.encryptPayload?{encryptedNotification:encryptToken(JSON.stringify(payload),config)}:payload;
  const proof=db.prepare("SELECT MAX(whatsapp_verified_at) AS at FROM participation_requests WHERE phone=? AND source='WHATSAPP'").get(phone) as {at:string|null};
  const start=proof.at?Date.parse(proof.at):0;
  const expires=start+24*3600_000;
  if(config.WHATSAPP_MODE==="EVOLUTION" || (start>0&&start<=Date.now()&&expires>Date.now())) {
    queue(db,phone,safePayload({type:"text",text:{preview_url:true,body:body.slice(0,4096)}}),dedupeKey,config.WHATSAPP_MODE==="EVOLUTION"?undefined:new Date(expires).toISOString(),config);
  } else if(approvedTemplate?.name) {
    const payload=template(config,approvedTemplate.name,[body.slice(0,1024)]);
    (payload.template as {language:{code:string}}).language.code=approvedTemplate.language;
    queue(db,phone,safePayload(payload),dedupeKey);
  } else return {queued:false,reason:"TEMPLATE_OR_SERVICE_WINDOW_REQUIRED"};
  const row=db.prepare("SELECT id FROM whatsapp_outbox WHERE dedupe_key=?").get(dedupeKey) as {id:string}|undefined;
  if(row)recordDelivery(db,phone,deliveryClass,event);
  return {queued:Boolean(row),outboxId:row?.id};
}

export function queueOwnerAlerts(db: AppDatabase, config: Config, requestId: string, phone: string, name: string, eventId: string) {
  config = effectiveWhatsAppConfig(db,config);
  if(!featureEnabled(db,"OWNER_ALERTS"))return;
  if (!config.WHATSAPP_OWNER_ALERT_TEMPLATE && config.WHATSAPP_MODE!=="EVOLUTION") return;
  const participationCount = (db.prepare("SELECT COUNT(*) AS n FROM participation_requests WHERE status='PENDING'").get() as { n: number }).n;
  const hasGoogleClaims = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='google_identity_claims'").get();
  const identityCount = hasGoogleClaims ? (db.prepare("SELECT COUNT(*) AS n FROM google_identity_claims WHERE status='PENDING'").get() as { n: number }).n : 0;
  const count = participationCount + identityCount;
  const recipients = config.OWNER_ALERT_WHATSAPP
    ? [{ id: "primary", phone: config.OWNER_ALERT_WHATSAPP }]
    : ownerAccounts(config).filter((owner) => owner.phone).map((owner) => ({ id: owner.id, phone: owner.phone! }));
  for (const recipient of recipients) queue(
    db,
    recipient.phone,
    config.WHATSAPP_MODE==="EVOLUTION"?{type:"text",text:{body:`Nova solicitação: ${name} (${phone}). Há ${count} solicitações aguardando análise no painel.`}}:template(config,config.WHATSAPP_OWNER_ALERT_TEMPLATE!,[name,phone,String(count)]),
    eventId + ":owner:" + recipient.id + ":" + requestId,undefined,config
  );
}

export function queueParticipationDecision(
  db: AppDatabase,
  config: Config,
  requestId: string,
  status: "APPROVED" | "DECLINED",
  groupCode?: string
) {
  config = effectiveWhatsAppConfig(db,config);
  if(!featureEnabled(db,"DECISION_NOTICE"))return false;
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

  if ((inServiceWindow && serviceExpiresAt) || config.WHATSAPP_MODE==="EVOLUTION") {
    const body = status === "APPROVED"
      ? `Olá, ${request.name}! Seu cadastro foi aprovado no SOS YOUTUBER ${groupCode}. Você já pode acessar ${config.WEB_APP_URL} com o mesmo WhatsApp: solicite uma chave de acesso ou use sua identidade Google, se já estiver vinculada à conta. O grupo será identificado pelo seu cadastro aprovado.`
      : `Olá, ${request.name}. Sua solicitação ao SOS YouTube não foi aprovada neste momento. Se acreditar que houve engano, responda por aqui para que os Owners possam revisar.`;
    queue(db,request.phone,{type:"text",text:{preview_url:true,body}},dedupe,config.WHATSAPP_MODE==="EVOLUTION"?undefined:serviceExpiresAt!.toISOString(),config);
    return true;
  }

  if (config.WHATSAPP_DECISION_TEMPLATE) {
    const label = status === "APPROVED" ? "APROVADO" : "NÃO APROVADO";
    queue(db,request.phone,template(config,config.WHATSAPP_DECISION_TEMPLATE,[request.name,label,groupCode ?? "-",config.WEB_APP_URL]),dedupe,undefined,config);
    return true;
  }
  return false;
}
type MetaGroupSummary = { id: string; subject: string };
type MetaGroupInfo = { id?: string; subject?: string; participants?: Array<{ wa_id?: string }>; total_participant_count?: number };

function groupCodeFromSubject(subject: string): string | undefined {
  return /^SOS\s+YOUTUBER\s+([1-9]\d{0,2})$/iu.exec(subject.trim())?.[1];
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

export async function syncEvolutionWhatsAppGroups(db:AppDatabase,config:Config){
  const runtime=effectiveWhatsAppConfig(db,config);
  const empty={discovered:0,linked:0,memberships:0,skipped:[] as Array<{code:string;reason:string}>};
  if(!["EVOLUTION","HYBRID_PLUS"].includes(runtime.WHATSAPP_MODE)||!runtime.WHATSAPP_GROUPS_SYNC_ENABLED||!featureEnabled(db,"GROUP_SYNC"))return empty;
  const client=evolutionClient(runtime);
  if(!(await client.health()).connected)return {...empty,skipped:[{code:"session",reason:"DISCONNECTED"}]};
  const groups=await client.groups();
  let linked=0,memberships=0;
  const skipped:Array<{code:string;reason:string}>=[];
  for(const group of groups){
    const code=groupCodeFromSubject(group.subject);
    if(!code||!/^\d+(?:-\d+)?@g\.us$/.test(group.id))continue;
    if(!Array.isArray(group.participants)){skipped.push({code,reason:"MISSING_PARTICIPANTS"});continue;}
    // AUDITORIA / LID: `id` pode ser LID (nao telefone); o telefone real vem em
    // `phoneNumber`. Sem isso o sync compara LIDs com telefones e nao casa ninguem.
    const phones=new Set(group.participants.map(p=>jidToPhone((p as {phoneNumber?:string}).phoneNumber)||jidToPhone(p.id)).filter(phoneValid));
    const previous=(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_member_verifications WHERE provider='EVOLUTION' AND group_code=? AND revoked_at IS NULL").get(code) as {n:number}).n;
    const reason=!phones.size?"EMPTY_PARTICIPANTS":typeof group.size==="number"&&group.size!==phones.size?"PARTIAL_PARTICIPANTS":previous-phones.size>Math.max(2,Math.ceil(previous*.2))?"SUSPICIOUS_SHRINK":undefined;
    if(reason)skipped.push({code,reason});
    const stamp=now();
    db.transaction(()=>{
      // External synchronization must not enable a group explicitly disabled by an Owner.
      db.prepare("INSERT INTO groups(code,enabled,whatsapp_group_id,membership_mode,last_synced_at) VALUES (?,1,?,'EVOLUTION',?) ON CONFLICT(code) DO UPDATE SET whatsapp_group_id=excluded.whatsapp_group_id,membership_mode=excluded.membership_mode,last_synced_at=excluded.last_synced_at").run(code,group.id,stamp);
      recordGroupVerification(db,"EVOLUTION",code,group.id,group.subject,group.participants.filter(p=>p.admin==="admin"||p.admin==="superadmin").length,stamp);
      for(const phone of phones){recordMemberVerification(db,"EVOLUTION",code,phone,group.id,true,stamp);materializeApprovedMembership(db,phone,code,stamp);}
      if(!reason){
        const existing=db.prepare("SELECT phone FROM whatsapp_member_verifications WHERE provider='EVOLUTION' AND group_code=? AND revoked_at IS NULL").all(code) as Array<{phone:string}>;
        for(const member of existing)if(!phones.has(member.phone)){
          recordMemberVerification(db,"EVOLUTION",code,member.phone,group.id,false,stamp);
          db.prepare("UPDATE group_memberships SET revoked_at=? WHERE phone=? AND group_code=? AND revoked_at IS NULL AND source='VERIFIED_EVOLUTION'").run(stamp,member.phone,code);
        }
      }
    })();linked++;memberships+=phones.size;
  }
  return {discovered:groups.length,linked,memberships,skipped};
}
export async function syncWhatsAppGroups(db:AppDatabase,config:Config){
  const runtime=effectiveWhatsAppConfig(db,config);
  return runtime.WHATSAPP_MODE==="EVOLUTION"||runtime.WHATSAPP_MODE==="HYBRID_PLUS"?syncEvolutionWhatsAppGroups(db,config):syncOfficialWhatsAppGroups(db,config);
}
export async function syncOfficialWhatsAppGroups(db: AppDatabase, config: Config) {
  config = effectiveWhatsAppConfig(db,config);
  if (config.WHATSAPP_SENDER_VALIDATION_REQUIRED || !config.WHATSAPP_GROUPS_SYNC_ENABLED || !config.WHATSAPP_PHONE_NUMBER_ID || !config.WHATSAPP_ACCESS_TOKEN) {
    return { discovered: 0, linked: 0, memberships: 0, skipped: [] as Array<{ code: string; reason: string; received: number; declaredTotal?: number; previousCount: number }> };
  }
  const listing = await graphJson<{ data?: { groups?: MetaGroupSummary[] } }>(config,`${config.WHATSAPP_PHONE_NUMBER_ID}/groups?limit=1024`);
  const discovered = listing.data?.groups ?? [];
  let linked = 0, memberships = 0;
  const skipped: Array<{ code: string; reason: string; received: number; declaredTotal?: number; previousCount: number }> = [];
  for (const group of discovered) {
    const code = groupCodeFromSubject(group.subject);
    if (!code) continue;
    const info = await graphJson<MetaGroupInfo>(config,`${group.id}?fields=id,subject,participants,total_participant_count`);
    const phones = new Set((info.participants ?? []).map((item) => item.wa_id ?? "").filter(phoneValid));
    const stamp = now();

    // AUDITORIA / guarda de revogação. Mais abaixo, todo membro que NÃO estiver em
    // `phones` perde a verificação e a associação ao grupo. Isso é correto quando a
    // lista veio completa — e catastrófico quando não veio: se a Meta mudar a versão
    // do Graph, o token perder `whatsapp_business_management`, ou a resposta vier
    // paginada, `participants` chega vazio ou parcial COM STATUS 200, e o laço
    // revogaria a base inteira numa transação, devolvendo "sucesso".
    //
    // Três freios, do mais barato ao mais conservador:
    //   1. lista vazia nunca revoga;
    //   2. a contagem tem de bater com o total que a própria Meta declarou;
    //   3. queda brusca (>20% dos membros) congela e espera conferência humana.
    // Em qualquer um deles ainda CONFIRMAMOS quem está presente — só não tiramos
    // ninguém. Errar para o lado de manter o acesso é sempre o lado seguro.
    const declaredTotal = typeof info.total_participant_count === "number" ? info.total_participant_count : undefined;
    const previousCount = (db.prepare(
      "SELECT COUNT(*) AS n FROM whatsapp_member_verifications WHERE provider='META_GROUPS_API' AND group_code=? AND revoked_at IS NULL"
    ).get(code) as { n: number }).n;
    // Saida normal (uma ou duas pessoas sairam) tem de continuar funcionando, senao
    // a guarda vira estorvo e alguem a desliga. Por isso o teto e o MAIOR entre 2
    // pessoas e 20% do grupo: grupo pequeno respira, grupo grande fica protegido de
    // uma revogacao em massa.
    const removals = Math.max(0, previousCount - phones.size);
    const allowedRemovals = Math.max(2, Math.ceil(previousCount * 0.2));
    const blockReason = phones.size === 0 ? "EMPTY_PARTICIPANTS"
      : declaredTotal !== undefined && declaredTotal !== phones.size ? "PARTIAL_PARTICIPANTS"
      : removals > allowedRemovals ? "SUSPICIOUS_SHRINK"
      : undefined;
    if (blockReason) skipped.push({ code, reason: blockReason, received: phones.size, declaredTotal, previousCount });

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
      // Só removemos quando a lista é confiável (ver guarda acima).
      if (!blockReason) {
        const existing = db.prepare("SELECT phone FROM whatsapp_member_verifications WHERE provider='META_GROUPS_API' AND group_code=? AND revoked_at IS NULL")
          .all(code) as Array<{ phone: string }>;
        for (const member of existing) if (!phones.has(member.phone)) {
          recordMemberVerification(db,"META_GROUPS_API",code,member.phone,group.id,false,stamp);
          db.prepare("UPDATE group_memberships SET revoked_at=? WHERE phone=? AND group_code=? AND revoked_at IS NULL").run(stamp,member.phone,code);
        }
      }
    })();
    linked += 1;
    memberships += phones.size;
  }
  // `skipped` sobe para o painel: sincronizar sem remover ninguém não é "sucesso
  // silencioso", é um aviso de que a Meta respondeu de forma incompleta.
  return { discovered: discovered.length, linked, memberships, skipped };
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
  if(config.WHATSAPP_MODE==="EVOLUTION"){
    if(payload._transport && payload._transport!=="EVOLUTION")throw new Error("SENDER_IDENTITY_CHANGED");
    if(payload._instance && (payload._instance!==config.EVOLUTION_INSTANCE||payload._phone!==config.EVOLUTION_PHONE))throw new Error("SENDER_IDENTITY_CHANGED");
    const text=(payload.text as {body?:string}|undefined)?.body;
    if(!text)throw new Error("EVOLUTION_TEXT_PAYLOAD_REQUIRED");
    const client=evolutionClient(config);
    if(!(await client.health()).connected)throw new Error("EVOLUTION_IDENTITY_OR_SESSION_NOT_READY");
    return client.sendText(recipient,text);
  }
  if(payload._transport==="EVOLUTION")throw new Error("SENDER_IDENTITY_CHANGED");
  if(payload._phoneNumberId && payload._phoneNumberId!==config.WHATSAPP_PHONE_NUMBER_ID)throw new Error("SENDER_IDENTITY_CHANGED");
  const {_transport:_transport,_instance:_instance,_phone:_phone,_phoneNumberId:_phoneNumberId,...providerPayload}=payload;
  void _transport;void _instance;void _phone;void _phoneNumberId;
  if (!config.WHATSAPP_ACCESS_TOKEN || !config.WHATSAPP_PHONE_NUMBER_ID) throw new Error("WHATSAPP_NOT_CONFIGURED");
  const response = await fetch(`https://graph.facebook.com/${config.WHATSAPP_GRAPH_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST", signal: AbortSignal.timeout(15_000), headers: { authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: recipient, ...providerPayload })
  });
  const data = await response.json() as { messages?: Array<{ id?: string }> };
  if (!response.ok || !data.messages?.[0]?.id) throw new Error(`WHATSAPP_DELIVERY_${response.status}`);
  return data.messages[0].id;
}
function otpPayload(config: Config, code: string): Payload {
  if(config.WHATSAPP_MODE==="EVOLUTION"||config.WHATSAPP_MODE==="DISABLED")throw new Error("WHATSAPP_OTP_OFFICIAL_CHANNEL_REQUIRED");
  if (!config.WHATSAPP_OTP_TEMPLATE) throw new Error("WHATSAPP_OTP_TEMPLATE_MISSING");
  const payload = template(config,config.WHATSAPP_OTP_TEMPLATE,[code]);
  (payload.template as { components: unknown[] }).components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] });
  return payload;
}

export async function sendWhatsAppOtp(config: Config, phone: string, code: string) {
  await send(config,phone,otpPayload(config,code));
}

export function queueWhatsAppOtp(db: AppDatabase, config: Config, phone: string, code: string, dedupeKey: string, expiresAt: string) {
  config=effectiveWhatsAppConfig(db,config);
  if(!whatsappOtpConfigured(config))return false;
  queue(db,phone,otpPayload(config,code),dedupeKey,expiresAt,config);
  return true;
}
// This is the sole production attempt gate. It reserves pacing/budget before
// network I/O, so a restart, a concurrent worker or an uncertain failed request
// cannot turn queued fan-out into an immediate burst.
function ensureEvolutionAttemptSchema(db:AppDatabase){
  db.exec(`
    CREATE TABLE IF NOT EXISTS evolution_attempt_state(
      identity TEXT PRIMARY KEY,first_seen_at TEXT NOT NULL,next_attempt_at TEXT NOT NULL,breaker_until TEXT
    );
    CREATE TABLE IF NOT EXISTS evolution_delivery_attempts(
      id TEXT PRIMARY KEY,identity TEXT NOT NULL,outbox_id TEXT NOT NULL,recipient TEXT NOT NULL,
      is_group INTEGER NOT NULL,attempted_at TEXT NOT NULL,business_day TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS evolution_attempt_day ON evolution_delivery_attempts(identity,business_day);
  `);
}
const evolutionIdentity=(config:Config)=>createHash("sha256").update("evolution-phone:"+config.EVOLUTION_PHONE).digest("hex");
const evolutionBusinessDay=(date:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Bahia",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
function nextEvolutionBusinessDay(at:Date){
  // Bahia uses UTC-3; derive its midnight from the explicit business date.
  const day=evolutionBusinessDay(at);
  return new Date(Date.parse(day+"T00:00:00-03:00")+86400000).toISOString();
}
function tripEvolutionBreaker(db:AppDatabase,config:Config,until:string){
  const identity=evolutionIdentity(config),stamp=now();
  db.prepare("INSERT OR IGNORE INTO evolution_attempt_state(identity,first_seen_at,next_attempt_at) VALUES(?,?,?)").run(identity,stamp,stamp);
  db.prepare("UPDATE evolution_attempt_state SET breaker_until=MAX(COALESCE(breaker_until,''),?) WHERE identity=?").run(until,identity);
}
/**
 * Piso diario de DM (conversa 1:1). Mesmo com o numero novinho, responder quem
 * escreveu nunca pode parar: e o comportamento mais seguro que existe no WhatsApp.
 */
const DM_DAILY_FLOOR = 60;

function reserveEvolutionAttempt(db:AppDatabase,config:Config,job:{id:string;recipient:string},group:boolean,at:Date){
  const identity=evolutionIdentity(config),stamp=at.toISOString();
  // AUDITORIA / Teo A1: silencio noturno TAMBEM nos grupos. Envio em grupo de
  // madrugada e a assinatura que mais vira ban no numero nao-oficial. Mensagem de
  // grupo que cai no silencio (00h-06h Bahia) e ADIADA para 06:00, nunca descartada.
  if(group && inQuietHours(DEFAULT_DELIVERY_POLICY, at)){
    return {allowed:false as const, nextAt:nextQuietHoursEnd(DEFAULT_DELIVERY_POLICY, at), reason:"EVOLUTION_QUIET_HOURS"};
  }
  db.prepare("INSERT OR IGNORE INTO evolution_attempt_state(identity,first_seen_at,next_attempt_at) VALUES(?,?,?)").run(identity,stamp,stamp);
  const state=db.prepare("SELECT first_seen_at AS firstSeenAt,next_attempt_at AS nextAttemptAt,breaker_until AS breakerUntil FROM evolution_attempt_state WHERE identity=?").get(identity) as {firstSeenAt:string;nextAttemptAt:string;breakerUntil:string|null};
  const waitUntil=[state.nextAttemptAt,state.breakerUntil??stamp].sort().at(-1)!;
  if(waitUntil>stamp)return {allowed:false,nextAt:waitUntil,reason:"EVOLUTION_CADENCE_OR_BREAKER"};
  const day=evolutionBusinessDay(at);
  const counts=db.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN is_group=1 THEN 1 ELSE 0 END),0) AS groupSent,COALESCE(SUM(CASE WHEN recipient=? AND is_group=1 THEN 1 ELSE 0 END),0) AS groupTotal FROM evolution_delivery_attempts WHERE identity=? AND business_day=?").get(job.recipient,identity,day) as {total:number;groupSent:number;groupTotal:number};
  const days=Math.max(0,Math.floor((at.getTime()-Date.parse(state.firstSeenAt))/86400000));
  // AUDITORIA / cota: o ban do WhatsApp vem de DISPARO EM MASSA NAO SOLICITADO, nao de
  // RESPONDER quem escreveu. Entao o teto de warm-up (baixo, numero novo) limita o que o
  // bot INICIA em GRUPO; a conversa 1:1 (DM) tem folga propria para nunca ficar muda —
  // um bot que para de responder no meio do papo e pior para a comunidade e nao reduz
  // risco de ban. A cadencia (minGap) e o breaker continuam valendo para os dois.
  const groupCap=warmupCapForDay(days);
  const dmCap=Math.max(DM_DAILY_FLOOR, groupCap * 3);
  const dmSent=counts.total-counts.groupSent;
  if(group ? (counts.groupSent>=groupCap || counts.groupTotal>=DEFAULT_CADENCE.dailyCapPerGroup) : dmSent>=dmCap)
    return {allowed:false,nextAt:nextEvolutionBusinessDay(at),reason:group&&counts.groupTotal>=DEFAULT_CADENCE.dailyCapPerGroup?"EVOLUTION_GROUP_DAILY_CAP":"EVOLUTION_WARMUP_DAILY_CAP"};
  db.prepare("INSERT INTO evolution_delivery_attempts(id,identity,outbox_id,recipient,is_group,attempted_at,business_day) VALUES(?,?,?,?,?,?,?)").run(randomUUID(),identity,job.id,job.recipient,group?1:0,stamp,day);
  db.prepare("UPDATE evolution_attempt_state SET next_attempt_at=?,breaker_until=NULL WHERE identity=?").run(new Date(at.getTime()+nextSendDelayMs()).toISOString(),identity);
  return {allowed:true,nextAt:stamp,reason:null};
}
export async function flushWhatsAppOutbox(db: AppDatabase, config: Config, limit = 10) {
  config = effectiveWhatsAppConfig(db,config);
  const groupMode=["EVOLUTION","HYBRID_PLUS"].includes(config.WHATSAPP_MODE)&&evolutionConfigured(config);
  if (!whatsappConfigured(config)&&!groupMode) return;
  ensureEvolutionAttemptSchema(db);
  const evoOnline=groupMode?(await evolutionClient(config).health()).connected:false;
  if(groupMode&&!evoOnline)tripEvolutionBreaker(db,config,new Date(Date.now()+15_000).toISOString());
  // An offline session leaves durable work pending; no draining burst or cross-identity fallback.
  if(config.WHATSAPP_MODE==="EVOLUTION" && !evoOnline)return;
  for (let index = 0; index < limit; index++) {
    const job = db.transaction(() => {
      const stamp = now();
      db.prepare("UPDATE whatsapp_outbox SET status='FAILED',last_error='SERVICE_WINDOW_EXPIRED' WHERE status IN ('PENDING','SENDING') AND expires_at IS NOT NULL AND expires_at <= ?").run(stamp);
      const row = db.prepare("SELECT * FROM whatsapp_outbox WHERE ((status='PENDING' AND available_at<=?) OR (status='SENDING' AND lease_until<=?)) AND (? OR COALESCE(json_extract(payload,'$._transport'),'META')!='EVOLUTION_GROUP') AND (? OR json_extract(payload,'$._transport')='EVOLUTION_GROUP') ORDER BY created_at,rowid LIMIT 1").get(stamp,stamp,evoOnline?1:0,whatsappConfigured(config)?1:0) as { id: string; recipient: string; payload: string; attempts: number } | undefined;
      if (row){
        const stored=JSON.parse(row.payload) as Payload;
        if(stored._transport==="EVOLUTION"||stored._transport==="EVOLUTION_GROUP"){
          const content=typeof stored.encryptedNotification==="string"?JSON.parse(decryptToken(stored.encryptedNotification,config)) as Payload:stored;
          if(stored._purpose==="OTP"||/^Sua chave de acesso ao SOS YOUTUBER é /u.test(String((content.text as {body?:string}|undefined)?.body??""))){
            db.prepare("UPDATE whatsapp_outbox SET status='FAILED',last_error='WHATSAPP_OTP_OFFICIAL_CHANNEL_REQUIRED',lease_until=NULL WHERE id=?").run(row.id);
            return {deferred:true as const};
          }
          if(!groupMode||(stored._transport==="EVOLUTION"&&config.WHATSAPP_MODE!=="EVOLUTION")||stored._instance!==config.EVOLUTION_INSTANCE||stored._phone!==config.EVOLUTION_PHONE){
            db.prepare("UPDATE whatsapp_outbox SET status='FAILED',last_error='SENDER_IDENTITY_CHANGED',lease_until=NULL WHERE id=?").run(row.id);
            return {deferred:true as const};
          }
          const gate=reserveEvolutionAttempt(db,config,row,stored._transport==="EVOLUTION_GROUP",new Date(stamp));
          if(!gate.allowed){
            db.prepare("UPDATE whatsapp_outbox SET status='PENDING',available_at=?,last_error=?,lease_until=NULL WHERE id=?").run(gate.nextAt,gate.reason,row.id);
            return {deferred:true as const};
          }
        }
        db.prepare("UPDATE whatsapp_outbox SET status='SENDING',attempts=attempts+1,lease_until=? WHERE id=?").run(new Date(Date.now()+60_000).toISOString(),row.id);
      }
      return row;
    })();
    if (!job) break;
    if("deferred" in job)continue;
    try {
      const stored=JSON.parse(job.payload) as Payload;
      const payload=typeof stored.encryptedNotification==="string"?JSON.parse(decryptToken(stored.encryptedNotification,config)):stored;
      // Invalidate pre-upgrade Evolution OTP work; group transport must never carry login secrets.
      if((stored._transport==="EVOLUTION"||stored._transport==="EVOLUTION_GROUP")&&(
        stored._purpose==="OTP"||/^Sua chave de acesso ao SOS YOUTUBER é /u.test(String((payload.text as {body?:string}|undefined)?.body??""))
      ))throw new Error("WHATSAPP_OTP_OFFICIAL_CHANNEL_REQUIRED");
      let id:string;
      if(stored._transport==="EVOLUTION_GROUP"){
        if(!groupMode||stored._instance!==config.EVOLUTION_INSTANCE||stored._phone!==config.EVOLUTION_PHONE)throw new Error("SENDER_IDENTITY_CHANGED");
        id=await evolutionClient(config).sendText(job.recipient,String((stored.text as {body?:string})?.body??""));
      }else id = await send(config,job.recipient,{...payload,_transport:stored._transport,_instance:stored._instance,_phone:stored._phone,_phoneNumberId:stored._phoneNumberId});
      db.prepare("UPDATE whatsapp_outbox SET status='SENT',provider_message_id=?,last_error=NULL,lease_until=NULL WHERE id=?").run(id,job.id);
    } catch (cause) {
      const attempts = job.attempts + 1;
      const code = cause instanceof Error && /^(WHATSAPP_|SENDER_IDENTITY_CHANGED$|EVOLUTION_)/.test(cause.message) ? cause.message : "WHATSAPP_NETWORK_ERROR";
      if((JSON.parse(job.payload) as Payload)._transport?.toString().startsWith("EVOLUTION")&&code!=="SENDER_IDENTITY_CHANGED"&&code!=="WHATSAPP_OTP_OFFICIAL_CHANNEL_REQUIRED")
        tripEvolutionBreaker(db,config,new Date(Date.now()+60_000).toISOString());
      db.prepare("UPDATE whatsapp_outbox SET status=?,available_at=?,last_error=?,lease_until=NULL WHERE id=?")
        .run(attempts >= 5 || code==="SENDER_IDENTITY_CHANGED" || code==="WHATSAPP_OTP_OFFICIAL_CHANNEL_REQUIRED" ? "FAILED" : "PENDING",new Date(Date.now()+Math.min(300_000,2**attempts*10_000)).toISOString(),code,job.id);
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
    otpConfigured:whatsappOtpConfigured(config),
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
function supportReply(db:AppDatabase,event:AutomationEvent,phone:string,fallback:string){
  const settings=automationSettings(db,event);
  if(!settings.enabled)return undefined;
  const user=db.prepare("SELECT name FROM users WHERE phone=?").get(phone) as {name:string}|undefined;
  // Keep the audited classifier defaults while applying an Owner's saved response exactly.
  return settings.customized?renderTemplate(settings.text,{nome:user?.name??"participante"}):fallback;
}
type InboundMessage={id?:string;from?:string;type?:string;timestamp?:string;text?:{body?:string}};
function processInboundMessages(db:AppDatabase,runtimeConfig:Config,messages:InboundMessage[]){
          for (const msg of messages) {
            // AUDITORIA / "ninguem nunca fala sozinho". Antes, tudo que nao fosse
            // texto curto caia num `continue` mudo: audio, foto, video e desabafo
            // longo sumiam sem um pio, e a pessoa achava que foi ignorada.
            if (!msg.id || msg.id.length>256 || !msg.from || !phoneValid(msg.from)) continue;
            const fresh = db.prepare("INSERT OR IGNORE INTO whatsapp_received (message_id,received_at) VALUES (?,?)").run(msg.id,now()); if (!fresh.changes) continue;
            const stampGuard = Number(msg.timestamp)*1000;
            const expiresGuard = new Date((Number.isFinite(stampGuard)?stampGuard:Date.now())+24*3600_000).toISOString();
            if (msg.type !== "text" || !msg.text?.body) {
              queue(db,msg.from,{type:"text",text:{preview_url:false,body:MEDIA_REPLY}},`${msg.id}:media`,expiresGuard,runtimeConfig);
              continue;
            }
            if (msg.text.body.length>500) {
              queue(db,msg.from,{type:"text",text:{preview_url:false,body:TOO_LONG_REPLY}},`${msg.id}:too-long`,expiresGuard,runtimeConfig);
              continue;
            }
            const stamp = Number(msg.timestamp)*1000;
            if (!Number.isFinite(stamp) || stamp > Date.now()+300_000) continue;
            const expires = new Date(stamp+24*3600_000).toISOString();
            const text = msg.text.body.trim();
            const conversation = db.prepare("SELECT stage FROM whatsapp_conversations WHERE phone=?").get(msg.from) as { stage: string } | undefined;

            // AUDITORIA / toda entrada e classificada; nenhuma fica sem resposta.
            const intent = classifyInbound(text, { awaitingName: conversation?.stage === "WAITING_NAME" });

            // Opt-out e opt-in sao atendidos na hora, antes de qualquer fluxo: quem
            // pede para parar e continua recebendo bloqueia o numero, e bloqueio
            // derruba a nota de qualidade que entrega o codigo de acesso de todos.
            if (intent === "OPT_OUT" || intent === "OPT_IN") {
              setOptOut(db, msg.from, intent === "OPT_OUT");
              queue(db,msg.from,{type:"text",text:{preview_url:false,body:replyFor(intent)!}},`${msg.id}:${intent}`,expires,runtimeConfig);
              continue;
            }
            // "humano": o proprio bot mandava escrever isso e nao havia handler.
            if (intent === "HUMAN" && featureEnabled(db,"HUMAN_HANDOFF")) {
              db.prepare("INSERT INTO whatsapp_conversations (phone,stage,updated_at) VALUES (?,'HUMAN_REQUESTED',?) ON CONFLICT(phone) DO UPDATE SET stage='HUMAN_REQUESTED',updated_at=excluded.updated_at").run(msg.from,now());
              const response=supportReply(db,"SUPPORT_HANDOFF",msg.from,replyFor("HUMAN")!);
              if(response){
                queue(db,msg.from,{type:"text",text:{preview_url:false,body:response}},`${msg.id}:human`,expires,runtimeConfig);
                // AUDITORIA / avisa a equipe no numero humano com link direto pra pessoa.
                // Proativo (a equipe procura), sem popup pro usuario. Respeita o toggle
                // SUPPORT_HANDOFF: se o Owner desliga o handoff, ninguem e avisado.
                const supportNumber=humanSupportNumber(db,runtimeConfig);
                if(supportNumber && supportNumber!==msg.from.replace(/\D/g,"")){
                  const who=db.prepare("SELECT name FROM users WHERE phone=? AND deleted_at IS NULL").get(msg.from) as {name?:string}|undefined;
                  const alert=humanHandoffAlert({name:who?.name,userPhone:msg.from,lastMessage:text});
                  queue(db,supportNumber,{type:"text",text:{preview_url:true,body:alert}},`${msg.id}:human-alert`,expires,runtimeConfig);
                }
              }
              continue;
            }
            // A recusa PROMETIA "responda por aqui" e nao havia quem respondesse.
            if (conversation?.stage === "DECLINED") {
              queue(db,msg.from,{type:"text",text:{preview_url:false,body:DECLINED_FOLLOWUP_REPLY}},`${msg.id}:declined-followup`,expires,runtimeConfig);
              continue;
            }
            if(!featureEnabled(db,"SUPPORT_CHAT"))continue;
            if (intent === "PARTICIPATE") {
              db.prepare("INSERT INTO whatsapp_conversations (phone,stage,updated_at) VALUES (?,'WAITING_NAME',?) ON CONFLICT(phone) DO UPDATE SET stage='WAITING_NAME',updated_at=excluded.updated_at").run(msg.from,now());
              queue(db,msg.from,{type:"text",text:{preview_url:true,body:`Olá! 👋 Seja bem-vindo ao Projeto SOS YouTube. Aqui, participantes dos grupos SOS YOUTUBER colaboram na montagem de ciclos com 10 links e podem levar a seleção para a própria conta do YouTube. Seu acesso é individual e o grupo é identificado automaticamente pelo WhatsApp informado.`}},`${msg.id}:welcome`,expires,runtimeConfig);
              queue(db,msg.from,{type:"text",text:{preview_url:true,body:"Como gostaria de ser chamado? Responda apenas com seu nome ou com a forma como prefere ser chamado."}},`${msg.id}:ask-name`,expires,runtimeConfig);
            } else if (conversation?.stage === "WAITING_NAME" && looksLikeName(text)) {
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
              queue(db,msg.from,{type:"text",text:{preview_url:true,body:responseBody}},`${msg.id}:received`,expires,runtimeConfig);
              queue(db,msg.from,{type:"text",text:{preview_url:true,body:"Enquanto isso: o SOS YouTube organiza contribuições em Filas de 10 links. Depois da aprovação, basta entrar no aplicativo com seu nome e o mesmo WhatsApp. O grupo é reconhecido automaticamente e não existe credencial adicional para participante."}},`${msg.id}:project-info`,expires,runtimeConfig);
            } else if (conversation?.stage === "WAITING_NAME") {
              // Nome com link, vazio ou longo demais caia num else-if mudo: a pessoa
              // nao sabia que errou nem como consertar. Agora explicamos com carinho
              // e mantemos a conversa no mesmo estagio para ela tentar de novo.
              const motivo = nameRejectionReason(text) ?? "Pode me mandar só o seu nome?";
              queue(db,msg.from,{type:"text",text:{preview_url:false,body:`${motivo} 💛`}},`${msg.id}:name-retry`,expires,runtimeConfig);
            } else {
              // REDE FINAL: qualquer coisa que chegou ate aqui ganha resposta.
              // Nenhuma mensagem de uma pessoa termina em silencio.
              const response=supportReply(db,"SUPPORT_AUTO",msg.from,replyFor(intent) ?? replyFor("UNKNOWN")!);
              if(response)queue(db,msg.from,{type:"text",text:{preview_url:false,body:response}},`${msg.id}:fallback`,expires,runtimeConfig);
            }
          }
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
          processInboundMessages(db,runtimeConfig,change.value.messages ?? []);
        }
      }
    })();
    return { ok: true };
  });
  app.post("/webhooks/whatsapp/evolution",{bodyLimit:65536},async(request,reply)=>{
    const runtime=effectiveWhatsAppConfig(db,config);
    // HYBRID+ inbound individual conversations belong to Meta; never mix sender identities.
    if(runtime.WHATSAPP_MODE!=="EVOLUTION"||!evolutionConfigured(runtime))return reply.code(503).send({message:"Evolution não habilitado para esta conversa."});
    const secret=request.headers["x-sos-webhook-secret"];
    if(typeof secret!=="string"||!equal(secret,runtime.EVOLUTION_WEBHOOK_SECRET!))return reply.code(401).send({message:"Webhook não autorizado."});
    const body=z.object({event:z.string(),instance:z.string(),data:z.unknown().optional()}).parse(request.body);
    if(body.instance!==runtime.EVOLUTION_INSTANCE)return reply.code(403).send({message:"Instância não autorizada."});
    if(body.event.toLowerCase().replace(/_/g,".")!=="messages.upsert")return {ok:true,ignored:true};
    const data=z.object({key:z.object({id:z.string().min(1).max(220),remoteJid:z.string(),remoteJidAlt:z.string().optional(),fromMe:z.boolean().optional()}),messageTimestamp:z.union([z.string(),z.number()]),message:z.object({conversation:z.string().optional(),extendedTextMessage:z.object({text:z.string().optional()}).optional()}).passthrough()}).parse(body.data);
    // AUDITORIA / BUG DO BOT MUDO (raiz): o WhatsApp migrou para o endereçamento LID
    // (`<id>@lid`), um identificador privado que NÃO é telefone. Só aceitar
    // `@s.whatsapp.net` fazia o bot DESCARTAR silenciosamente toda conversa de quem já
    // está no formato novo. O telefone real vem em `remoteJidAlt` — usamos ele; se não
    // vier, a conversa é ignorada (sem telefone não há como ligar à conta/grupo).
    const senderJid = /^\d{8,15}@s\.whatsapp\.net$/.test(data.key.remoteJid)
      ? data.key.remoteJid
      : (data.key.remoteJidAlt && /^\d{8,15}@s\.whatsapp\.net$/.test(data.key.remoteJidAlt) ? data.key.remoteJidAlt : "");
    if(data.key.fromMe||!senderJid)return {ok:true,ignored:true};
    const text=data.message.conversation??data.message.extendedTextMessage?.text;
    db.transaction(()=>processInboundMessages(db,runtime,[{id:`evo:${body.instance}:${data.key.id}`,from:senderJid.split("@")[0],type:text?"text":"media",timestamp:String(data.messageTimestamp),text:text?{body:text}:undefined}]))();
    return {ok:true};
  });
  ensureBotAutomations(db);
  ensureBotOptOut(db);
  ensureBotDelivery(db);
  app.post("/admin/whatsapp/retry", { preHandler: ownerGuard }, async () => {
    db.prepare("UPDATE whatsapp_outbox SET status='PENDING',attempts=0,available_at=? WHERE status='FAILED' AND (expires_at IS NULL OR expires_at>?)").run(now(),now());
    return { ok: true };
  });
  app.post("/admin/whatsapp/groups/sync", { preHandler: ownerGuard }, async (_request, reply) => {
    if (!config.WHATSAPP_GROUPS_SYNC_ENABLED) return reply.code(409).send({ message: "Sincronização automática de grupos está desativada." });
    try { return await syncWhatsAppGroups(db,config); }
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
        groupsRunning = syncWhatsAppGroups(db,config).catch((cause) => app.log.error(cause)).finally(() => { groupsBusy=false; });
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
