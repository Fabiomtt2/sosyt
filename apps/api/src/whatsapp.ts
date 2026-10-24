import {groupCodeFromSubject} from "./group-name.js";
import {botPhoneAccessBlocked} from "./bot-account-access.js";
import {currentQueueEventBody,type QueueEventSnapshot} from "./bot-queue-snapshot.js";
import { botProgressReply } from "./bot-progress-replies.js";
import { declinesBotSensitiveAction, localBotFallback, classifyLocalBotIntent } from "./bot-local-intents.js";
import { encryptToken, decryptToken } from "./youtube.js";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "./config.js";
import type { AppDatabase } from "./db.js";
import { ownerAccounts, effectiveOwnerAccounts } from "./owners.js";
import { automationSettings, ensureBotAutomations } from "./bot-automation-store.js";
import { renderTemplate, isAutomationEvent, type AutomationEvent } from "./bot-automations.js";
import { featureEnabled, type BotFeatureCode } from "./bot.js";
import { ensureBotPassword, reissueBotPassword } from "./bot-password.js";
import { welcomeAlreadyGranted, welcomeReference } from "./wallet-guards.js";
import { enqueueGroupJoin, ensureGroupJoinQueue, processGroupJoin } from "./bot-group-join.js";
import { createEvolutionClient, assertDistinctFromOfficial, jidToPhone, sameWhatsAppNumber, DEFAULT_CADENCE, nextSendDelayMs, warmupCapForDay } from "./bot-evolution.js";
import { effectiveWhatsAppConfig, readWhatsAppIntegration } from "./integrations.js";
import { materializeApprovedMembership, recordGroupVerification, recordMemberVerification } from "./group-verification.js";
import { classifyInbound, ensureBotOptOut, extractPreferredName, looksLikeName, nameRejectionReason, replyFor, setOptOut, MEDIA_REPLY, TOO_LONG_REPLY } from "./bot-inbound.js";
import { humanHandoffAlert, humanSupportNumber } from "./bot-human-handoff.js";
import { variedInboundReply } from "./bot-menu-variants.js";
import { aiClassifyIntent } from "./bot-ai-intent.js";
import { openHumanRelay, routeHumanRelay } from "./bot-human-relay.js";
import { renderAutomation } from "./bot-dispatch.js";
import { supportAvailableNow } from "./support-availability.js";
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
export function queueGroupAutomation(db:AppDatabase,config:Config,groupJid:string,body:string,dedupeKey:string,options?:{event:string;deliveryClass:"QUEUE"|"ENGAGEMENT";availableAt?:string;expiresAt?:string;queueSnapshot?:QueueEventSnapshot}){
  const runtime=effectiveWhatsAppConfig(db,config);
  if(!["EVOLUTION","HYBRID_PLUS"].includes(runtime.WHATSAPP_MODE)||!evolutionConfigured(runtime))return {queued:false,reason:"PROVIDER_NOT_READY"};
  if(!/^\d+(?:-\d+)?@g\.us$/.test(groupJid)||!body.trim())return {queued:false,reason:"INVALID_RECIPIENT"};
  if(runtime.WHATSAPP_MODE==="HYBRID_PLUS")assertDistinctFromOfficial(runtime.EVOLUTION_PHONE,runtime.WHATSAPP_BUSINESS_PHONE);
  const prior=db.prepare("SELECT id FROM whatsapp_outbox WHERE dedupe_key=?").get(dedupeKey) as {id:string}|undefined;
  if(prior)return {queued:true,outboxId:prior.id};
  const payload={_transport:"EVOLUTION_GROUP",_instance:runtime.EVOLUTION_INSTANCE,_phone:runtime.EVOLUTION_PHONE,
    _deliveryClass:options?.deliveryClass??"ENGAGEMENT",_event:options?.event??dedupeKey,...(options?.queueSnapshot?{_queueSnapshot:options.queueSnapshot}:{}),text:{body:body.slice(0,4096)}};
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
  if(featureEnabled(db,"COMMUNITY_GROUP_ONLY")){
    // Financial details and gifts stay in the account inbox. Never publish them to a group.
    if(["PURCHASE_CONFIRMED","ITEM_RECEIVED","OWNER_BENEFIT"].includes(event)||event.startsWith("GAMIFICATION_"))return {queued:false,reason:"COMMUNITY_IN_APP_ONLY"};
    if(["LEVEL_UP","COINS_EARNED","STREAK_MILESTONE"].includes(event)){
      const group=db.prepare(`SELECT g.whatsapp_group_id AS jid FROM groups g JOIN group_memberships m ON m.group_code=g.code
        WHERE m.phone=? AND g.enabled=1 AND g.whatsapp_group_id IS NOT NULL ORDER BY CAST(g.code AS INTEGER),g.code LIMIT 1`).get(phone) as {jid:string}|undefined;
      if(!group)return {queued:false,reason:"NO_CONFIRMED_GROUP"};
      return queueGroupAutomation(db,config,group.jid,body.replace(/(?:\+?\d[\s().-]*){8,15}/g,"[dado privado]"),dedupeKey+":group:"+group.jid,{event,deliveryClass:"ENGAGEMENT",expiresAt:new Date(Date.now()+86_400_000).toISOString()});
    }
  }

  const verdict=canDeliver(db,phone,deliveryClass);
  if(!verdict.allowed) {
    recordSuppressed(db,phone,event,verdict.reason);
    return {queued:false,reason:verdict.reason};
  }
  const safePayload=(payload:Payload):Payload=>({... (options?.encryptPayload?{encryptedNotification:encryptToken(JSON.stringify(payload),config)}:payload),_event:event,_deliveryClass:deliveryClass});
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

export function queueOwnerAlerts(db: AppDatabase, config: Config, requestId: string, phone: string, name: string, eventId: string, deliveryNotice?:string) {
  config = effectiveWhatsAppConfig(db,config);
  if(!featureEnabled(db,"OWNER_ALERTS"))return;
  if (!config.WHATSAPP_OWNER_ALERT_TEMPLATE && config.WHATSAPP_MODE!=="EVOLUTION") return;
  const participationCount = (db.prepare("SELECT COUNT(*) AS n FROM participation_requests WHERE status='PENDING'").get() as { n: number }).n;
  const hasGoogleClaims = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='google_identity_claims'").get();
  const identityCount = hasGoogleClaims ? (db.prepare("SELECT COUNT(*) AS n FROM google_identity_claims WHERE status='PENDING'").get() as { n: number }).n : 0;
  const count = participationCount + identityCount;
  const request=db.prepare("SELECT status FROM participation_requests WHERE id=?").get(requestId) as {status:string}|undefined;
  const confirmed=db.prepare(`SELECT DISTINCT v.group_code AS code FROM whatsapp_member_verifications v
    JOIN groups g ON g.code=v.group_code AND g.whatsapp_group_id=v.external_group_id
    WHERE v.phone=? AND v.revoked_at IS NULL AND g.enabled=1 ORDER BY CAST(v.group_code AS INTEGER)`).all(phone) as Array<{code:string}>;
  const groupNotice=confirmed.length
    ? `A sincronização confirmou presença em: ${confirmed.map(group=>"SOS YOUTUBER "+group.code).join(", ")}.`
    : "A entrada automática no primeiro grupo SOS disponível está na fila. O bot avisará o resultado; cadastro criado ainda não confirma presença no grupo.";
  const alertBody=deliveryNotice??(request?.status==="APPROVED"
    ? `Cadastro automático concluído: ${name} (${phone}). ${groupNotice} Nenhuma aprovação manual do cadastro é necessária.`
    : `Nova solicitação: ${name} (${phone}). Há ${count} solicitações aguardando análise no painel.`);
  const recipients = config.OWNER_ALERT_WHATSAPP
    ? [{ id: "primary", phone: config.OWNER_ALERT_WHATSAPP }]
    : ownerAccounts(config).filter((owner) => owner.phone).map((owner) => ({ id: owner.id, phone: owner.phone! }));
  for (const recipient of recipients) queue(
    db,
    recipient.phone,
    config.WHATSAPP_MODE==="EVOLUTION"?{type:"text",text:{body:alertBody}}:template(config,config.WHATSAPP_OWNER_ALERT_TEMPLATE!,[name,phone,String(count)]),
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
      ? `Olá, ${request.name}! Seu cadastro foi aprovado no SOS YOUTUBER ${groupCode}. Você já pode acessar ${config.WEB_APP_URL} com o mesmo WhatsApp e a senha enviada por este bot. Se precisar de outra senha, responda 3. Seu grupo é reconhecido automaticamente.`
      : `Olá, ${request.name}. Sua solicitação ao SOS YouTube não foi aprovada neste momento. Se acreditar que houve engano, responda por aqui para que os Owners possam revisar.`;
    const configuredBody=status==="APPROVED"?welcomeCopy(db,config,request.phone,body,groupCode,false):body;
    if(!configuredBody)return false;
    queue(db,request.phone,{type:"text",text:{preview_url:true,body:configuredBody}},dedupe,config.WHATSAPP_MODE==="EVOLUTION"?undefined:serviceExpiresAt!.toISOString(),config);
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



async function graphJson<T>(config: Config, path: string): Promise<T> {
  if (!config.WHATSAPP_ACCESS_TOKEN) throw new Error("WHATSAPP_NOT_CONFIGURED");
  const response = await fetch(`https://graph.facebook.com/${config.WHATSAPP_GRAPH_VERSION}/${path}`, {
    headers: { authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`, accept: "application/json" },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`WHATSAPP_GROUPS_${response.status}`);
  return await response.json() as T;
}

/** Catalog copy never replaces password delivery or other essential account actions. */
function welcomeCopy(db:AppDatabase,config:Config,phone:string,fallback:string,groupCode?:string,vary=true) {
  const rule=automationSettings(db,"WELCOME_DM");
  if(!rule.enabled)return undefined;
  const user=db.prepare("SELECT name FROM users WHERE phone=? AND deleted_at IS NULL").get(phone) as {name:string}|undefined;
  const request=db.prepare("SELECT name FROM participation_requests WHERE phone=?").get(phone) as {name:string}|undefined;
  if(!vary&&!rule.customized)return fallback;
  const rendered=renderAutomation(db,"WELCOME_DM",{nome:user?.name??request?.name??"participante",grupo:groupCode??"da comunidade",link:config.WEB_APP_URL});
  return "text" in rendered ? rendered.text : fallback;
}
/** First complete synchronization establishes a quiet baseline; only later arrivals welcome. */
function welcomeNewGroupMember(db:AppDatabase,config:Config,phone:string,groupCode:string,groupJid:string) {
  if(!featureEnabled(db,"DECISION_NOTICE"))return;
  const rule=automationSettings(db,"WELCOME_MEMBER");
  if(!rule.enabled||rule.channel!=="EVOLUTION"||rule.target!=="GROUP")return;
  const person=db.prepare("SELECT name FROM users WHERE phone=? AND deleted_at IS NULL").get(phone) as {name:string}|undefined;
  const request=db.prepare("SELECT name FROM participation_requests WHERE phone=?").get(phone) as {name:string}|undefined;
  const name=person?.name??request?.name??"participante";
  const body=renderTemplate(rule.text,{nome:name,grupo:groupCode,link:config.WEB_APP_URL})
    .replace(/(?:\+?\d[\s().-]*){8,15}/g,"[dado privado]");
  queueGroupAutomation(db,config,groupJid,body,"welcome-member:"+groupJid+":"+createHash("sha256").update(phone).digest("hex"),
    {event:"WELCOME_MEMBER",deliveryClass:"ENGAGEMENT",expiresAt:new Date(Date.now()+86_400_000).toISOString()});
}
export async function syncEvolutionWhatsAppGroups(db:AppDatabase,config:Config){
  const runtime=effectiveWhatsAppConfig(db,config);
  const empty={discovered:0,linked:0,memberships:0,skipped:[] as Array<{code:string;reason:string}>};
  if(!["EVOLUTION","HYBRID_PLUS"].includes(runtime.WHATSAPP_MODE)||!runtime.WHATSAPP_GROUPS_SYNC_ENABLED||!featureEnabled(db,"GROUP_SYNC"))return empty;
  const client=evolutionClient(runtime);
  if(!(await client.health()).connected)return {...empty,skipped:[{code:"session",reason:"DISCONNECTED"}]};
  let groups: Awaited<ReturnType<typeof client.groups>>;
  let fallback=false;
  const skipped:Array<{code:string;reason:string}>=[];
  try { groups=await client.groups(); }
  catch {
    // A broken discovery endpoint cannot turn a partial response into mass removal.
    // Recover only mappings already paired by the Owner; failed reads stay untouched.
    fallback=true;groups=[];
    skipped.push({code:"discovery",reason:"GROUP_DISCOVERY_UNAVAILABLE"});
    const paired=db.prepare("SELECT code,whatsapp_group_id AS id FROM groups WHERE enabled=1 AND whatsapp_group_id IS NOT NULL").all() as Array<{code:string;id:string}>;
    for(const group of paired){
      if(!/^\d+(?:-\d+)?@g\.us$/.test(group.id)||!/^\d{1,3}$/.test(group.code))continue;
      try {
        const phones=await client.groupParticipants(group.id);
        groups.push({id:group.id,subject:"SOS YOUTUBER "+group.code,participants:phones.map(phone=>({id:phone+"@s.whatsapp.net"}))});
      } catch { skipped.push({code:group.code,reason:"GROUP_PARTICIPANTS_UNAVAILABLE"}); }
    }
  }
  let linked=0,memberships=0;
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
      if(!fallback)recordGroupVerification(db,"EVOLUTION",code,group.id,group.subject,group.participants.filter(p=>p.admin==="admin"||p.admin==="superadmin").length,stamp);
      const baselineKey="bot.welcome.baseline:"+group.id;
      const baseline=Boolean(db.prepare("SELECT 1 FROM integration_settings WHERE key=?").get(baselineKey));
      for(const phone of phones){
        const known=Boolean(db.prepare("SELECT 1 FROM whatsapp_member_verifications WHERE provider='EVOLUTION' AND group_code=? AND phone=? AND revoked_at IS NULL").get(code,phone));
        recordMemberVerification(db,"EVOLUTION",code,phone,group.id,true,stamp);
        materializeApprovedMembership(db,phone,code,stamp);
        if(baseline&&!known)welcomeNewGroupMember(db,runtime,phone,code,group.id);
      }
      if(!reason)db.prepare("INSERT OR IGNORE INTO integration_settings(key,value,updated_at) VALUES(?,'1',?)").run(baselineKey,stamp);
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
  // Routing and Owner-policy metadata belong exclusively to our durable envelope.
  const providerPayload=Object.fromEntries(Object.entries(payload).filter(([key])=>!key.startsWith("_")));
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
function reserveEvolutionAttempt(db:AppDatabase,config:Config,job:{id:string;recipient:string;event?:string},group:boolean,at:Date){
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
  // AUDITORIA / DM NAO TEM TETO DIARIO DE IDENTIDADE. Aprendizado caro em producao:
  // o teto global derrubava a CONVERSA (o bot parava de responder no meio do papo), e
  // ainda era consumido por RETENTATIVA de envio que falhou — bastou um punhado de
  // mensagens de teste para um numero inexistente para calar o bot o dia inteiro.
  // O teto existe contra DISPARO EM MASSA, que e fenomeno de GRUPO/broadcast; para DM
  // o que protege e (a) a cadencia minGap entre envios, (b) o breaker de sessao e
  // (c) o orcamento POR PESSOA da politica de entrega (canDeliver), que ja limita
  // engajamento a poucas mensagens/dia por destinatario. Responder quem escreveu e o
  // comportamento mais seguro que existe no WhatsApp — nunca pode ser bloqueado.
  if(group && (counts.groupSent>=groupCap || counts.groupTotal>=DEFAULT_CADENCE.dailyCapPerGroup))
    return {allowed:false,nextAt:nextEvolutionBusinessDay(at),reason:counts.groupTotal>=DEFAULT_CADENCE.dailyCapPerGroup?"EVOLUTION_GROUP_DAILY_CAP":"EVOLUTION_WARMUP_DAILY_CAP"};
  // Keep greeting capacity inside the SAME hard caps; uploads must not consume
  // the last slots before all linked groups receive their morning/night cycle.
  if(group&&!['GOOD_MORNING','GOOD_NIGHT'].includes(job.event??'')){
    const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Bahia',hour:'2-digit',hourCycle:'h23'}).format(at));
    const events=([['GOOD_MORNING',12],['GOOD_NIGHT',23]] as const).filter(([event,end])=>hour<end&&automationSettings(db,event).enabled).map(([event])=>event);
    if(events.length){
      const linked=db.prepare("SELECT DISTINCT whatsapp_group_id AS id FROM groups WHERE enabled=1 AND whatsapp_group_id IS NOT NULL").all() as {id:string}[];
      let globalReserved=0,groupReserved=0;
      for(const target of linked)for(const event of events){
        const attempted=db.prepare("SELECT 1 FROM evolution_delivery_attempts a JOIN whatsapp_outbox o ON o.id=a.outbox_id WHERE a.identity=? AND a.business_day=? AND a.recipient=? AND json_extract(o.payload,'$._event')=? LIMIT 1").get(identity,day,target.id,event);
        if(!attempted){globalReserved++;if(target.id===job.recipient)groupReserved++;}
      }
      if(counts.groupSent>=Math.max(0,groupCap-globalReserved)||counts.groupTotal>=Math.max(0,DEFAULT_CADENCE.dailyCapPerGroup-groupReserved))
        return {allowed:false as const,nextAt:nextEvolutionBusinessDay(at),reason:'EVOLUTION_GREETING_CAPACITY_RESERVED'};
    }
  }
  db.prepare("INSERT INTO evolution_delivery_attempts(id,identity,outbox_id,recipient,is_group,attempted_at,business_day) VALUES(?,?,?,?,?,?,?)").run(randomUUID(),identity,job.id,job.recipient,group?1:0,stamp,day);
  db.prepare("UPDATE evolution_attempt_state SET next_attempt_at=?,breaker_until=NULL WHERE identity=?").run(new Date(at.getTime()+nextSendDelayMs()).toISOString(),identity);
  return {allowed:true,nextAt:stamp,reason:null};
}
function catalogDeliveryFeature(event:AutomationEvent):BotFeatureCode|undefined {
  if(event.startsWith("QUEUE")||event==="UPLOAD_NOTICE")return "QUEUE_ANNOUNCE";
  if(event.startsWith("WELCOME"))return "DECISION_NOTICE";
  if(["WEEKLY_XP_RANK","MONTHLY_TOP","BROADCAST_GLOBAL","PINNED_MESSAGE"].includes(event))return "BROADCAST";
  if(event==="SUPPORT_HANDOFF")return "HUMAN_HANDOFF";
  if(event.startsWith("SUPPORT"))return "SUPPORT_CHAT";
  return undefined;
}
/** Revalidate waiting catalog work before spending a transport attempt. Secrets and
 * direct inbound fallback replies deliberately carry no catalog event envelope. */
function queuedAutomationDisabled(db:AppDatabase,payload:Payload) {
  if(payload._humanRelay===true&&!featureEnabled(db,"HUMAN_HANDOFF"))return true;
  if(typeof payload._event!=="string"||!isAutomationEvent(payload._event))return false;
  const event=payload._event;
  // Historical MONTHLY_TOP DMs are prize receipts from the gamification bridge;
  // the catalog event with this name governs only the public group ranking.
  if(event==="MONTHLY_TOP"&&payload._transport!=="EVOLUTION_GROUP")return false;
  const feature=catalogDeliveryFeature(event);
  return !automationSettings(db,event).enabled||Boolean(feature&&!featureEnabled(db,feature));
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
      const row = db.prepare("SELECT * FROM whatsapp_outbox WHERE ((status='PENDING' AND available_at<=?) OR (status='SENDING' AND lease_until<=?)) AND (? OR COALESCE(json_extract(payload,'$._transport'),'META')!='EVOLUTION_GROUP') AND (? OR json_extract(payload,'$._transport')='EVOLUTION_GROUP') ORDER BY CASE WHEN json_extract(payload,'$._transport')='EVOLUTION_GROUP' THEN CASE WHEN json_extract(payload,'$._event') IN ('GOOD_MORNING','GOOD_NIGHT') THEN 3 ELSE 4 END WHEN json_extract(payload,'$._deliveryClass')='ENGAGEMENT' THEN 2 WHEN json_extract(payload,'$._deliveryClass')='REWARD' THEN 1 ELSE 0 END,created_at,rowid LIMIT 1").get(stamp,stamp,evoOnline?1:0,whatsappConfigured(config)?1:0) as { id: string; recipient: string; payload: string; attempts: number } | undefined;
      if (row){
        const stored=JSON.parse(row.payload) as Payload;
        const passwordDelivery=db.prepare("SELECT u.phone FROM bot_password_deliveries d JOIN users u ON u.id=d.user_id WHERE d.outbox_id=?").get(row.id) as {phone:string}|undefined;
        if((passwordDelivery||stored._event==="BOT_PASSWORD_INFO")&&botPhoneAccessBlocked(db,passwordDelivery?.phone??row.recipient)){
          db.prepare("UPDATE whatsapp_outbox SET status='FAILED',last_error='ACCOUNT_ACCESS_REVOKED',lease_until=NULL WHERE id=?").run(row.id);
          return {deferred:true as const};
        }
        const group=stored._transport==="EVOLUTION_GROUP";
        const communityEvent=String(stored._event??"");
        if(!group&&featureEnabled(db,"COMMUNITY_GROUP_ONLY")&&(["WELCOME_DM","SUPER_EXPIRING","INACTIVITY_NUDGE","LEVEL_UP","COINS_EARNED","STREAK_MILESTONE","PURCHASE_CONFIRMED","ITEM_RECEIVED","OWNER_BENEFIT"].includes(communityEvent)||communityEvent.startsWith("GAMIFICATION_"))){
          db.prepare("UPDATE whatsapp_outbox SET status='FAILED',last_error='COMMUNITY_GROUP_ONLY',lease_until=NULL WHERE id=?").run(row.id);
          return {deferred:true as const};
        }

        const groupState=group?db.prepare("SELECT enabled FROM groups WHERE whatsapp_group_id=?").get(row.recipient) as {enabled:number}|undefined:undefined;
        if(queuedAutomationDisabled(db,stored)||(groupState&&groupState.enabled!==1)){
          db.prepare("UPDATE whatsapp_outbox SET status='FAILED',last_error=?,lease_until=NULL WHERE id=?")
            .run(groupState&&groupState.enabled!==1?"GROUP_DISABLED":"EVENT_DISABLED",row.id);
          return {deferred:true as const};
        }
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
          const gate=reserveEvolutionAttempt(db,config,{...row,event:typeof stored._event==="string"?stored._event:undefined},stored._transport==="EVOLUTION_GROUP",new Date(stamp));
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
        const original=String((stored.text as {body?:string})?.body??"");
        const snapshot=stored._queueSnapshot as QueueEventSnapshot|undefined;
        const body=snapshot?currentQueueEventBody(db,original,snapshot):original;
        id=await evolutionClient(config).sendText(job.recipient,body);
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
  const groupsLinked = (db.prepare("SELECT COUNT(*) AS n FROM groups WHERE whatsapp_group_id IS NOT NULL AND membership_mode IN ('META_GROUPS_API','EVOLUTION')").get() as { n: number }).n;
  const automaticMemberships = (db.prepare("SELECT COUNT(*) AS n FROM whatsapp_member_verifications WHERE provider IN ('META_GROUPS_API','EVOLUTION') AND revoked_at IS NULL").get() as { n: number }).n;
  return {
    configured: whatsappConfigured(config),
    otpConfigured:whatsappOtpConfigured(config),
    ownerAlertsConfigured: featureEnabled(db,"OWNER_ALERTS")&&Boolean((config.WHATSAPP_MODE==="EVOLUTION"||config.WHATSAPP_OWNER_ALERT_TEMPLATE) && (config.OWNER_ALERT_WHATSAPP || ownerAccounts(config).some((o) => o.phone))),
    decisionTemplateConfigured: Boolean(config.WHATSAPP_MODE==="EVOLUTION"&&whatsappConfigured(config)||config.WHATSAPP_DECISION_TEMPLATE),
    groupsSyncEnabled: Boolean(config.WHATSAPP_GROUPS_SYNC_ENABLED),
    groupsLinked,
    automaticMemberships,
    queued: count("PENDING")+count("SENDING"),
    failed: count("FAILED"),
    sent: count("SENT"),
    membershipMode: groupsLinked > 0 ? config.WHATSAPP_MODE==="EVOLUTION"?"EVOLUTION":"META_GROUPS_API" : "OWNER_VERIFIED"
  };
}
/**
 * AUDITORIA / cadastro self-service: cria a conta da pessoa (se ainda nao existe) e
 * dispara a senha do bot. E o primeiro passo do fluxo que o dono desenhou — a pessoa
 * loga com essa senha (validacao real de posse do numero) e so DEPOIS entra no grupo.
 * Nao exige vinculo de grupo previo nem aprovacao manual.
 */
export function ensureSelfServiceAccount(db:AppDatabase,config:Config,phone:string,name:string):{userId:string;created:boolean;passwordSent:boolean}{
  if(botPhoneAccessBlocked(db,phone))throw Object.assign(new Error("Acesso pausado pela administração."),{statusCode:403,code:"ACCOUNT_ACCESS_REVOKED"});
  const stamp=now();
  let user=db.prepare("SELECT id FROM users WHERE phone=? AND deleted_at IS NULL").get(phone) as {id:string}|undefined;
  let created=false;
  if(!user){
    const id=randomUUID();
    db.prepare("INSERT INTO users (id,name,phone,group_code,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run(id,name.slice(0,80),phone,"",stamp,stamp);
    const firstWelcome=!welcomeAlreadyGranted(db,phone);
    db.prepare("INSERT OR IGNORE INTO wallets (user_id,promo_millis,updated_at) VALUES (?,?,?)").run(id,firstWelcome?10000:0,stamp);
    // boas-vindas uma vez por PESSOA (telefone), nunca por linha recriada
    if(firstWelcome)
      db.prepare("INSERT INTO wallet_ledger (id,user_id,kind,amount_millis,reference_id,created_at) VALUES (?,?,'WELCOME',10000,?,?)")
        .run(randomUUID(),id,welcomeReference(phone),stamp);
    user={id};created=true;
  }else{
    db.prepare("UPDATE users SET name=?,updated_at=? WHERE id=?").run(name.slice(0,80),stamp,user.id);
  }
  const senha=ensureBotPassword(db,config,user.id,true);
  return {userId:user.id,created,passwordSent:Boolean(senha.queued)};
}

/**
 * Timestamp de entrada em ms. Aceita segundos (padrao) e milissegundos (algumas
 * versoes da Evolution), e devolve "agora" quando vier ausente/absurdo — nunca
 * descarta a mensagem por causa do relogio do remetente.
 */
function normalizeInboundTimestamp(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  const ms = n > 1e11 ? n : n * 1000;              // > 1e11 ja esta em milissegundos
  const agora = Date.now();
  if (ms > agora + 300_000 || ms < agora - 30 * 86400_000) return agora;  // relogio fora
  return ms;
}

function supportReply(db:AppDatabase,event:AutomationEvent,phone:string,fallback:string){
  const settings=automationSettings(db,event);
  if(!settings.enabled)return undefined;
  const user=db.prepare("SELECT name FROM users WHERE phone=?").get(phone) as {name:string}|undefined;
  // Keep the audited classifier defaults while applying an Owner's saved response exactly.
  return settings.customized?renderTemplate(settings.text,{nome:user?.name??"participante"}):fallback;
}
type InboundMessage={id?:string;from?:string;type?:string;timestamp?:string;text?:{body?:string}};
// `aiHint` chega JA RESOLVIDA de fora. Motivo: o processamento roda dentro de uma
// transacao SQLite sincrona, onde nao existe `await` — fazer I/O de rede aqui
// travaria o banco. Entao o webhook consulta a IA ANTES de abrir a transacao e
// passa apenas o rotulo. Mesmo padrao da fila de entrada em grupo.
function processInboundMessages(db:AppDatabase,runtimeConfig:Config,messages:InboundMessage[],aiHint?:string){
          for (const msg of messages) {
            // AUDITORIA / "ninguem nunca fala sozinho". Antes, tudo que nao fosse
            // texto curto caia num `continue` mudo: audio, foto, video e desabafo
            // longo sumiam sem um pio, e a pessoa achava que foi ignorada.
            if (!msg.id || msg.id.length>256 || !msg.from || !phoneValid(msg.from)) continue;
            const fresh = db.prepare("INSERT OR IGNORE INTO whatsapp_received (message_id,received_at) VALUES (?,?)").run(msg.id,now()); if (!fresh.changes) continue;
            const stampGuard = normalizeInboundTimestamp(msg.timestamp);
            const expiresGuard = new Date((Number.isFinite(stampGuard)?stampGuard:Date.now())+24*3600_000).toISOString();
            if (msg.type !== "text" || !msg.text?.body || msg.text.body.length>500) {
              const earlyRelay=routeHumanRelay(db,runtimeConfig,{phone:msg.from,text:msg.text?.body??"",media:msg.type!=="text"||!msg.text?.body,enabled:featureEnabled(db,"HUMAN_HANDOFF")});
              if(earlyRelay.handled){
                for(const delivery of earlyRelay.messages)queue(db,delivery.recipient,{type:"text",_humanRelay:!["relay-paused","relay-too-long","relay-resume","relay-denied","relay-missing","relay-empty"].includes(delivery.key),text:{preview_url:false,body:delivery.body}},`${msg.id}:${delivery.key}`,expiresGuard,runtimeConfig);
                continue;
              }
            }
            if (msg.type !== "text" || !msg.text?.body) {
              queue(db,msg.from,{type:"text",text:{preview_url:false,body:MEDIA_REPLY}},`${msg.id}:media`,expiresGuard,runtimeConfig);
              continue;
            }
            if (msg.text.body.length>500) {
              queue(db,msg.from,{type:"text",text:{preview_url:false,body:TOO_LONG_REPLY}},`${msg.id}:too-long`,expiresGuard,runtimeConfig);
              continue;
            }
            // AUDITORIA / NENHUMA MENSAGEM SOME POR CAUSA DE RELOGIO. Antes, timestamp
            // ausente (a Meta o declara opcional) ou em milissegundos (algumas versoes
            // da Evolution) fazia `continue` MUDO — e como a mensagem ja fora marcada
            // como recebida, o reenvio do webhook era deduplicado: silencio definitivo.
            // Agora normalizamos: segundos ou milissegundos, e cai em "agora" se vier
            // invalido. O horario serve para a janela de servico, nunca para descartar
            // a pessoa.
            const stamp = normalizeInboundTimestamp(msg.timestamp);
            const expires = new Date(stamp+24*3600_000).toISOString();
            const text = msg.text.body.trim();
            const conversation = db.prepare("SELECT stage FROM whatsapp_conversations WHERE phone=?").get(msg.from) as { stage: string } | undefined;

            // AUDITORIA / toda entrada e classificada; nenhuma fica sem resposta.
            const explicitIntent = classifyInbound(text, { awaitingName: conversation?.stage === "WAITING_NAME" });
            const accessBlocked = botPhoneAccessBlocked(db,msg.from);
            // Local NLU is a last resort, never a replacement for names, commands,
            // opt-out, the human relay or an authoritative engine response.
            const declinedAction = (explicitIntent === "HUMAN" || explicitIntent === "RESEND_CODE") && declinesBotSensitiveAction(text);
            const localRoute = declinedAction
              ? {intent:"HELP" as const,explanation:"Tudo bem. Não abri um atendimento nem alterei sua senha por esta mensagem. Envie MENU para ver as opções. Se quiser uma pessoa, escreva Tenho dúvidas; para solicitar uma nova senha de participante, responda 3."}
              : accessBlocked ? undefined : localBotFallback(text, explicitIntent, conversation?.stage === "WAITING_NAME");
            // ESCADA DE PRECEDENCIA (o gratuito e deterministico sempre primeiro):
            //   1. gatilho explicito  2. NLU local  3. IA
            // A IA so e consultada quando as duas primeiras falharam, e so pode
            // escolher uma porta que o bot JA sabe atender. Ela nunca escreve o texto
            // que a pessoa le — por isso nao tem como inventar preco, prazo ou regra.
            const intentPreIa = localRoute?.intent ?? explicitIntent;
            const intent = (intentPreIa === "UNKNOWN" && aiHint && !accessBlocked && conversation?.stage !== "WAITING_NAME")
              ? aiHint as typeof intentPreIa
              : intentPreIa;

            // Opt-out e opt-in sao atendidos na hora, antes de qualquer fluxo: quem
            // pede para parar e continua recebendo bloqueia o numero, e bloqueio
            // derruba a nota de qualidade que entrega o codigo de acesso de todos.
            if (intent === "OPT_OUT" || intent === "OPT_IN") {
              setOptOut(db, msg.from, intent === "OPT_OUT");
              queue(db,msg.from,{type:"text",text:{preview_url:false,body:variedInboundReply(db,intent) ?? replyFor(intent)!}},`${msg.id}:${intent}`,expires,runtimeConfig);
              continue;
            }
            const relay=routeHumanRelay(db,runtimeConfig,{phone:msg.from,text,enabled:featureEnabled(db,"HUMAN_HANDOFF")});
            if(relay.handled){
              for(const delivery of relay.messages)queue(db,delivery.recipient,{type:"text",_humanRelay:!["relay-paused","relay-too-long","relay-resume","relay-denied","relay-missing","relay-empty"].includes(delivery.key),text:{preview_url:false,body:delivery.body}},`${msg.id}:${delivery.key}`,expires,runtimeConfig);
              continue;
            }
            // "humano": o proprio bot mandava escrever isso e nao havia handler.
            if (intent === "HUMAN" && !featureEnabled(db,"HUMAN_HANDOFF")) {
              queue(db,msg.from,{type:"text",text:{preview_url:false,body:"O atendimento humano está pausado pelo gerenciamento. Não encaminhei seu pedido. Você pode continuar usando o atendimento automático: envie MENU."}},`${msg.id}:human-paused`,expires,runtimeConfig);
              continue;
            }
            if (intent === "HUMAN" && featureEnabled(db,"HUMAN_HANDOFF")) {
              db.prepare("INSERT INTO whatsapp_conversations (phone,stage,updated_at) VALUES (?,'HUMAN_REQUESTED',?) ON CONFLICT(phone) DO UPDATE SET stage='HUMAN_REQUESTED',updated_at=excluded.updated_at").run(msg.from,now());
              // AUDITORIA / PEDIR AJUDA HUMANA NUNCA PODE CAIR NO VAZIO. Antes isto era
              // `if(response)` e supportReply devolve undefined quando a automacao
              // SUPPORT_HANDOFF esta sem texto habilitado — resultado: a pessoa pedia
              // uma pessoa de verdade e NADA acontecia (nem resposta a ela, nem aviso ao
              // atendimento). O interruptor do handoff e a feature HUMAN_HANDOFF, ja
              // checada acima; a automacao decide apenas o TEXTO.
              const outsideHours=!supportAvailableNow(db);
              const supportEvent=outsideHours?"SUPPORT_OFFHOURS":"SUPPORT_HANDOFF";
              const fallback=outsideHours
                ? "Seu pedido ficou registrado e a equipe já foi avisada. Estamos fora do horário de atendimento humano e responderemos assim que possível. Você pode adiantar sua dúvida por aqui."
                : "Seu pedido ficou registrado e a equipe já foi avisada. Uma pessoa responderá assim que possível. Enquanto isso, pode me contar o que precisa.";
              const response=supportReply(db,supportEvent,msg.from,fallback) ?? fallback;
              const who=db.prepare("SELECT name FROM users WHERE phone=? AND deleted_at IS NULL").get(msg.from) as {name?:string}|undefined;
              const ticket=openHumanRelay(db,runtimeConfig,{phone:msg.from,name:who?.name,message:text});
              for(const delivery of ticket.messages)queue(db,delivery.recipient,{type:"text",_humanRelay:!["relay-paused","relay-too-long","relay-resume","relay-denied","relay-missing","relay-empty"].includes(delivery.key),text:{preview_url:false,body:delivery.body}},`${msg.id}:${delivery.key}`,expires,runtimeConfig);
              queue(db,msg.from,{type:"text",_humanRelay:true,text:{preview_url:false,body:ticket.ticketId
                ? response+"\n\n"+`Seu chamado é #${ticket.ticketId}. A equipe responde por esta mesma conversa. Suas próximas mensagens serão encaminhadas à equipe. Para retomar o bot, envie VOLTAR AO BOT.`
                : "Este número é o atendimento humano configurado. Os chamados recebidos trazem instruções para RESPONDER e ENCERRAR."}},`${msg.id}:human`,expires,runtimeConfig);
              continue;
            }
            if(accessBlocked){
              queue(db,msg.from,{type:"text",text:{preview_url:false,body:"Seu acesso foi pausado pela administração. Sua conta e seu histórico continuam preservados. O bot não pode liberar o acesso nem gerar outra senha. Se quiser falar com a equipe, escreva Tenho dúvidas."}},`${msg.id}:access-blocked`,expires,runtimeConfig);
              continue;
            }
            // A historical declined conversation is not an account lock: commands,
            // password recovery and human support must remain reachable.
            if(!featureEnabled(db,"SUPPORT_CHAT"))continue;

            // AUDITORIA / O BOT PRECISA AGIR, NAO SO FALAR. Antes, "3 / senha" mandava
            // "vou providenciar o reenvio" e NAO FAZIA NADA — o dono notou com razao que
            // nao havia integracao real. Agora a opcao de senha EXECUTA: se a pessoa tem
            // vinculo de grupo ativo, o bot gera a senha e entrega; senao explica o que
            // falta. Tratado ANTES do fluxo de nome para que um numero do menu nunca seja
            // confundido com o nome da pessoa (era o que travava a conversa em "1".."5").
            if (intent === "RESEND_CODE") {
              // AUDITORIA / A OPCAO SENHA SEMPRE RESOLVE. Antes ela (a) exigia vinculo de
              // grupo que o fluxo novo nem usa mais, (b) prometia "sua conta esta sendo
              // preparada" sem preparar nada, e (c) mandava responder "TROCAR SENHA" —
              // string que nenhum gatilho reconhecia, criando um laco infinito para quem
              // esqueceu a senha. Agora: sem conta, cria; com conta e sem senha, emite;
              // com senha, EMITE UMA NOVA de fato (a pessoa pediu porque nao consegue
              // entrar). Nenhuma promessa sem execucao.
              const alvo=db.prepare("SELECT id FROM users WHERE phone=? AND deleted_at IS NULL").get(msg.from) as {id:string}|undefined;
              let corpo:string;
              if (!alvo) {
                corpo="Ainda não tenho uma conta no seu nome. 💛 Responda *1* que eu faço seu cadastro agora e já te mando a senha — leva menos de um minuto.";
              } else {
                const r=reissueBotPassword(db,runtimeConfig,alvo.id,true);
                corpo=r.created
                  ? `Prontinho! 🔐 Gerei uma senha nova e ela está sendo enviada aqui nesta conversa. Entre em ${runtimeConfig.WEB_APP_URL} com este WhatsApp e essa senha — depois você pode trocar por uma de sua preferência.`
                  : r.reason==="ADMIN_ACCOUNT"
                    ? "Esta conta é administrativa e entra com a credencial do painel, não com a senha do bot. 💛"
                    : "Tentei gerar sua senha e não consegui agora. 💛 Já avisei uma pessoa da equipe — se preferir falar direto, escreva *Tenho dúvidas*.";
                // Falhar em silencio foi o que deixou gente presa. Se nao deu, a equipe
                // fica sabendo na hora, com o motivo tecnico, sem o usuario ter que insistir.
                if (!r.created && r.reason!=="ADMIN_ACCOUNT") {
                  const suporte=humanSupportNumber(db,runtimeConfig);
                  if (suporte && suporte!==msg.from.replace(/\D/g,"")) {
                    const aviso=humanHandoffAlert({userPhone:msg.from,lastMessage:`Pediu nova senha e o envio falhou (${r.reason ?? "motivo desconhecido"}).`});
                    queue(db,suporte,{type:"text",text:{preview_url:true,body:aviso}},`${msg.id}:senha-falha`,expires,runtimeConfig);
                  }
                }
              }
              queue(db,msg.from,{type:"text",text:{preview_url:true,body:corpo}},`${msg.id}:senha`,expires,runtimeConfig);
              continue;
            }

            const knownAccount=db.prepare("SELECT id,name FROM users WHERE phone=? AND deleted_at IS NULL").get(msg.from) as {id:string;name:string}|undefined;
            const administrative=effectiveOwnerAccounts(db,runtimeConfig).some(owner=>owner.phone&&sameWhatsAppNumber(owner.phone,msg.from??"")) ||
              Boolean(db.prepare("SELECT 1 FROM owner_access WHERE phone=? AND active=1").get(msg.from));
            const needsName=!administrative&&(!knownAccount||!looksLikeName(knownAccount.name));
            // AUDITORIA / CAUSA RAIZ DA "SENHA SOLTA DEPOIS DE UMA MENSAGEM".
            //
            // Aqui um simples "oi" gravava stage=WAITING_NAME e pedia o nome. A
            // mensagem SEGUINTE — qualquer uma — era aceita como nome, criando conta e
            // disparando senha para quem so tinha cumprimentado. O dono relatou isso
            // duas vezes ("o bot integra pendencia de cadastro com a primeira mensagem
            // tipo 'oi'") e foi explicito sobre a regra: "A pessoa fala com o bot e nao
            // deve ser cadastrada automaticamente por isso. So se ela escolher."
            //
            // A saudacao agora so acolhe e mostra o menu. O nome passa a ser pedido
            // apenas no ramo PARTICIPATE, depois da pessoa responder 1 ou dizer que
            // quer se cadastrar — que e onde WAITING_NAME continua sendo armado.
            if (intent === "GREETING" && needsName) {
              const greeting=welcomeCopy(db,runtimeConfig,msg.from,"Oi! 👋 Que bom ter você no SOS YOUTUBER! 💛");
              const body=[greeting,variedInboundReply(db,"GREETING") ?? replyFor("GREETING")].filter(Boolean).join("\n\n");
              queue(db,msg.from,{type:"text",text:{preview_url:false,body}},`${msg.id}:greeting`,expires,runtimeConfig);
              continue;
            }
            // AUDITORIA / "COMO ENTRO NO GRUPO" TEM QUE COLOCAR NO GRUPO.
            // A automacao de entrada ja existia (bot-group-join), mas nao havia como
            // pedi-la FALANDO: quem escrevia "me adiciona no grupo" recebia o menu
            // genérico. Responder sem executar e o vicio que esta auditoria persegue,
            // entao aqui a mensagem e o enfileiramento andam juntos. Idempotente por
            // telefone: pedir dez vezes nao gera dez pendencias para o Owner.
            if (intent === "GROUP_ACCESS") {
              const vinculo=db.prepare("SELECT group_code AS code FROM group_memberships WHERE phone=? AND revoked_at IS NULL").get(msg.from) as {code:string}|undefined;
              const conta=db.prepare("SELECT id,name FROM users WHERE phone=? AND deleted_at IS NULL").get(msg.from) as {id:string;name?:string}|undefined;
              let corpo:string;
              if (vinculo) {
                corpo=`Você já está no grupo *SOS YOUTUBER ${vinculo.code}*! 🙌 Se não estiver vendo as mensagens, confira se não arquivou a conversa do grupo no WhatsApp.\n\nPra participar das filas, entre em ${runtimeConfig.WEB_APP_URL} com este WhatsApp e sua senha. Esqueceu? Responda *3*. 💛`;
              } else if (!conta) {
                // Sem conta eu nao sei nem o nome da pessoa: o cadastro vem primeiro.
                corpo="Posso te colocar num grupo sim! 🤝 Só preciso te cadastrar primeiro — responda *1* que eu faço agora, te mando a senha e já encaminho sua entrada no grupo. Leva menos de um minuto. 💛";
              } else {
                const r=enqueueGroupJoin(db,msg.from,conta.name ?? "");
                corpo=r.queued
                  ? replyFor("GROUP_ACCESS")!
                  : "Tentei te encaminhar para um grupo e não consegui agora. 💛 Já avisei a equipe — se preferir falar direto, escreva *Tenho dúvidas*.";
                if (!r.queued) {
                  const suporte=humanSupportNumber(db,runtimeConfig);
                  if (suporte && suporte!==msg.from.replace(/\D/g,""))
                    queue(db,suporte,{type:"text",text:{preview_url:true,body:humanHandoffAlert({name:conta.name,userPhone:msg.from,lastMessage:`Pediu entrada em grupo e o enfileiramento falhou (${r.reason ?? "motivo desconhecido"}).`})}},`${msg.id}:grupo-falha`,expires,runtimeConfig);
                }
              }
              queue(db,msg.from,{type:"text",text:{preview_url:true,body:corpo}},`${msg.id}:grupo`,expires,runtimeConfig);
              continue;
            }

            if (intent === "PARTICIPATE") {
              db.prepare("INSERT INTO whatsapp_conversations (phone,stage,updated_at) VALUES (?,'WAITING_NAME',?) ON CONFLICT(phone) DO UPDATE SET stage='WAITING_NAME',updated_at=excluded.updated_at").run(msg.from,now());
              const group=db.prepare("SELECT group_code AS code FROM group_memberships WHERE phone=? AND revoked_at IS NULL").get(msg.from) as {code:string}|undefined;
              const greeting=welcomeCopy(db,runtimeConfig,msg.from,`Olá! 👋 Seja bem-vindo ao Projeto SOS YouTube. Aqui, participantes dos grupos SOS YOUTUBER colaboram na montagem de ciclos com 10 links e podem levar a seleção para a própria conta do YouTube. Seu acesso é individual e o grupo é identificado automaticamente pelo WhatsApp informado.`,group?.code);
              if(greeting)queue(db,msg.from,{type:"text",text:{preview_url:true,body:greeting}},`${msg.id}:welcome`,expires,runtimeConfig);
              queue(db,msg.from,{type:"text",text:{preview_url:true,body:"Como gostaria de ser chamado? Responda apenas com seu nome ou com a forma como prefere ser chamado."}},`${msg.id}:ask-name`,expires,runtimeConfig);
            // AUDITORIA / "oi" NAO E NOME. Antes este ramo usava looksLikeName(text), que
            // so olha tamanho/link — entao um "oi", "bom dia" ou um numero do menu virava
            // o NOME da pessoa e abria cadastro pendente sem ela ter pedido nada (o dono
            // viu exatamente isso: pendencia criada na primeira mensagem). Agora usamos o
            // intent: o classificador ja resolve saudacao/comando ANTES, e so devolve
            // NAME_CANDIDATE quando o texto nao e nenhuma outra coisa conhecida.
            } else if (conversation?.stage === "WAITING_NAME" && intent === "NAME_CANDIDATE") {
              const preferredName=extractPreferredName(text);
              if(!preferredName){
                queue(db,msg.from,{type:"text",text:{preview_url:false,body:"Pode me dizer apenas como prefere ser chamado? Exemplo: Meu nome é Ana."}},`${msg.id}:invalid-name`,expires,runtimeConfig);
                continue;
              }

              const hasActiveMembership = Boolean(db.prepare("SELECT 1 FROM group_memberships WHERE phone=? AND revoked_at IS NULL").get(msg.from));
              // AUDITORIA / QUEM JA TEM CONTA NAO RECEBE OFERTA DE CADASTRO (bug relatado
              // pelo dono). Antes o bot dizia "criei sua conta" para quem ja era
              // cadastrado, confundindo a pessoa e sujando o painel. Agora reconhecemos a
              // conta existente e seguimos direto para o que ela realmente precisa.
              const jaTemConta = db.prepare("SELECT id FROM users WHERE phone=? AND deleted_at IS NULL").get(msg.from) as { id: string } | undefined;
              if (jaTemConta) {
                // Repair legacy command-as-name records without issuing another welcome grant.
                if(!administrative&&knownAccount&&!looksLikeName(knownAccount.name))
                  ensureSelfServiceAccount(db,runtimeConfig,msg.from,preferredName);
                const temSenha = Boolean(db.prepare("SELECT 1 FROM user_passwords WHERE user_id=?").get(jaTemConta.id));
                db.prepare("UPDATE whatsapp_conversations SET stage='SUBMITTED',updated_at=? WHERE phone=?").run(now(),msg.from);
                queue(db,msg.from,{type:"text",text:{preview_url:true,body: temSenha
                  ? `Oi de novo, ${preferredName}! 😊 Você já tem conta aqui — é só entrar em ${runtimeConfig.WEB_APP_URL} com este WhatsApp e sua senha. Esqueceu a senha? Responda *3* que eu providencio uma nova. 💛`
                  : `Oi, ${preferredName}! Sua conta já existe e estou preparando sua senha — ela chega aqui em instantes. Depois é só entrar em ${runtimeConfig.WEB_APP_URL} com este WhatsApp. 💛`}},`${msg.id}:ja-cadastrado`,expires,runtimeConfig);
                if (!temSenha) ensureBotPassword(db,runtimeConfig,jaTemConta.id,true);
                if(!hasActiveMembership)enqueueGroupJoin(db,msg.from,preferredName);
                continue;
              }
              let responseBody = `Obrigado, ${preferredName}! Seu pedido de participação será validado em breve. 📨`;
              if (!hasActiveMembership) {
                const existing = db.prepare("SELECT id,status,retry_block_until AS retryBlockUntil FROM participation_requests WHERE phone=?").get(msg.from) as
                  | { id: string; status: "PENDING" | "APPROVED" | "DECLINED"; retryBlockUntil?: string }
                  | undefined;
                const stamp = now(), blockActive = Boolean(existing?.retryBlockUntil && Date.parse(existing.retryBlockUntil) > Date.now());
                if (existing?.status === "DECLINED" && blockActive) {
                  db.prepare("UPDATE participation_requests SET source='WHATSAPP',whatsapp_verified_at=?,updated_at=? WHERE id=?")
                    .run(stamp,stamp,existing.id);
                  responseBody = `Olá, ${preferredName}. Este cadastro foi analisado recentemente e o prazo de segurança ainda está ativo. Seus dados continuam preservados; aguarde antes de uma nova solicitação.`;
                } else {
                  // The inbound WhatsApp number is already proved by transport.
                  // After a valid name, queue real group admission immediately;
                  // only confirmed external presence grants membership access.
                  const id = existing?.id ?? randomUUID();
                  db.prepare(`INSERT INTO participation_requests (id,phone,name,status,source,whatsapp_verified_at,approved_at,duplicate_attempts,created_at,updated_at)
                    VALUES (?,?,?,'APPROVED','WHATSAPP',?,?,0,?,?)
                    ON CONFLICT(phone) DO UPDATE SET name=excluded.name,status='APPROVED',source='WHATSAPP',
                      whatsapp_verified_at=excluded.whatsapp_verified_at,
                      approved_at=COALESCE(participation_requests.approved_at,excluded.approved_at),
                      duplicate_attempts=0,updated_at=excluded.updated_at`)
                    .run(id,msg.from,preferredName,stamp,stamp,stamp,stamp);
                  const conta=ensureSelfServiceAccount(db,runtimeConfig,msg.from,preferredName);
                  enqueueGroupJoin(db,msg.from,preferredName);
                  responseBody = conta.passwordSent
                    ? `Pronto, ${preferredName}! 🎉 Criei sua conta e estou te mandando a SENHA aqui nesta conversa.\n\nEntre em ${runtimeConfig.WEB_APP_URL} com este WhatsApp e essa senha. Já encaminhei sua entrada em um grupo SOS YOUTUBER com vaga. Se a privacidade do WhatsApp impedir a inclusão, envio um convite por aqui. O acesso às filas é liberado após confirmar sua presença. 💛`
                    : `Pronto, ${preferredName}! 🎉 Criei sua conta. Em instantes eu te mando a senha aqui mesmo — depois é só entrar em ${runtimeConfig.WEB_APP_URL} com este WhatsApp. 💛`;
                  // Owner INFORMADO, nunca bloqueando: ele acompanha e pode intervir.
                  queueOwnerAlerts(db,runtimeConfig,id,msg.from,preferredName,msg.id);
                }
              } else {
                // AUDITORIA / AUTO-APROVACAO (pedido do dono: "reduzir acao humana ao
                // maximo"). Se o telefone JA esta num grupo SOS verificado, nao ha nada
                // para um humano decidir — a prova de pertencimento e o proprio grupo.
                // Entao o bot APROVA sozinho: registra como APPROVED e o reconciliador
                // (que roda no tick) cria a conta e entrega a senha por aqui. Antes isto
                // so mandava "use o acesso normal" e deixava a pessoa sem conta e sem
                // senha, obrigando aprovacao manual do Owner para quem ja era membro.
                const stamp=now();
                const vinculo=db.prepare("SELECT group_code AS code FROM group_memberships WHERE phone=? AND revoked_at IS NULL ORDER BY approved_at DESC LIMIT 1").get(msg.from) as {code:string}|undefined;
                db.prepare(`INSERT INTO participation_requests (id,phone,name,status,source,whatsapp_verified_at,approved_at,preferred_group,duplicate_attempts,created_at,updated_at)
                  VALUES (?,?,?,'APPROVED','WHATSAPP',?,?,?,0,?,?)
                  ON CONFLICT(phone) DO UPDATE SET name=excluded.name,status='APPROVED',source='WHATSAPP',
                    whatsapp_verified_at=excluded.whatsapp_verified_at,approved_at=COALESCE(participation_requests.approved_at,excluded.approved_at),
                    preferred_group=COALESCE(excluded.preferred_group,participation_requests.preferred_group),updated_at=excluded.updated_at`)
                  .run(randomUUID(),msg.from,preferredName,stamp,stamp,vinculo?.code ?? null,stamp,stamp);
                ensureSelfServiceAccount(db,runtimeConfig,msg.from,preferredName);
                responseBody = `Prontinho, ${preferredName}! ✅ Confirmei seu número no grupo SOS YOUTUBER${vinculo?.code?` ${vinculo.code}`:""} e já liberei seu acesso. Em instantes eu te mando a senha aqui mesmo — depois é só entrar em ${runtimeConfig.WEB_APP_URL} com este WhatsApp. 💛`;
              }
              db.prepare("UPDATE whatsapp_conversations SET stage='SUBMITTED',updated_at=? WHERE phone=?").run(now(),msg.from);
              queue(db,msg.from,{type:"text",text:{preview_url:true,body:responseBody}},`${msg.id}:received`,expires,runtimeConfig);
              queue(db,msg.from,{type:"text",text:{preview_url:true,body:"Enquanto isso: o SOS YouTube organiza contribuições em Filas de 10 links. Entre no aplicativo com este WhatsApp e a senha enviada pelo bot. O grupo é reconhecido automaticamente; se você ainda não estiver em um, sua entrada já foi encaminhada. Se não for possível adicionar automaticamente, você receberá um convite por aqui."}},`${msg.id}:project-info`,expires,runtimeConfig);
            } else if (conversation?.stage === "WAITING_NAME" && intent === "UNKNOWN") {
              // Nome com link, vazio ou longo demais caia num else-if mudo: a pessoa
              // nao sabia que errou nem como consertar. Agora explicamos com carinho
              // e mantemos a conversa no mesmo estagio para ela tentar de novo.
              const motivo = nameRejectionReason(text) ?? "Pode me mandar só o seu nome?";
              queue(db,msg.from,{type:"text",text:{preview_url:false,body:`${motivo} 💛`}},`${msg.id}:name-retry`,expires,runtimeConfig);
            } else {
              // REDE FINAL: qualquer coisa que chegou ate aqui ganha resposta.
              // Nenhuma mensagem de uma pessoa termina em silencio.
              // AUDITORIA / BOT MUDO: antes era `if(response)`, e supportReply devolve
              // undefined quando a automacao SUPPORT_AUTO esta DESLIGADA no painel.
              // Resultado: desligar um texto desligava a CONVERSA INTEIRA, em silencio —
              // a promessa do comentario acima era falsa. Agora o toggle SUPPORT_AUTO
              // decide apenas se vale o texto CUSTOMIZADO do Owner; a resposta padrao
              // sempre sai. Para o bot ficar realmente quieto existe o interruptor
              // proprio (feature SUPPORT_CHAT), que e uma escolha explicita do Owner.
              const account=db.prepare("SELECT name FROM users WHERE phone=? AND deleted_at IS NULL").get(msg.from) as {name:string}|undefined;
              const membership=db.prepare("SELECT group_code AS code FROM group_memberships WHERE phone=? AND revoked_at IS NULL").get(msg.from) as {code:string}|undefined;
              const status=intent==="STATUS"
                ? account
                  ? `${account.name}, sua conta está criada. 💛 ${membership ? `Seu vínculo com o grupo SOS YOUTUBER ${membership.code} está confirmado.` : "Sua entrada no grupo ainda está sendo confirmada; isso é separado da criação da conta."} Entre em ${runtimeConfig.WEB_APP_URL} com seu WhatsApp e senha. Se precisar de uma nova senha, responda *3*.`
                  : "Ainda não concluímos seu cadastro. 💛 Responda *1* para começar; vou pedir como prefere ser chamado e preparar seu acesso."
                : undefined;
              const liveProgress=botProgressReply(db,msg.from,localRoute?.progressCommand ?? text);
              // AUDITORIA / a mensagem mais vista e a que mais cansa: varia abertura e fecho.
              const padrao=status ?? liveProgress ?? localRoute?.explanation ?? variedInboundReply(db,intent) ?? replyFor(intent) ?? variedInboundReply(db,"UNKNOWN") ?? replyFor("UNKNOWN")!;
              // AUDITORIA / O TEXTO DO OWNER NAO PODE ENGOLIR O MENU. supportReply devolve
              // o texto customizado de SUPPORT_AUTO quando existe — e isso sobrepunha
              // TODAS as respostas: "oi" deixava de abrir o menu, "2" nao explicava mais
              // as filas, "4" nao dava status. Virava papagaio de uma frase so (foi o que
              // o dono viu). SUPPORT_AUTO e a PRIMEIRA RESPOSTA para o que o bot NAO sabe
              // responder; quando ha resposta especifica, ela sempre ganha.
              const response=intent==="UNKNOWN"
                ? (supportReply(db,"SUPPORT_AUTO",msg.from,padrao) ?? padrao)
                : padrao;
              queue(db,msg.from,{type:"text",text:{preview_url:false,body:response}},`${msg.id}:fallback`,expires,runtimeConfig);
            }
          }
}
/**
 * AUDITORIA / worker da entrada automatica em grupo. Pega UM pedido da fila, tenta
 * adicionar a pessoa no grupo com vaga e avisa o desfecho por DM. Se o WhatsApp dela
 * bloqueia "ser adicionada", manda o LINK DE CONVITE. So aciona o Owner quando nem o
 * add nem o convite resolvem — exatamente o "reduzir acao humana ao maximo" pedido.
 */
export async function drainGroupJoin(db: AppDatabase, config: Config, log?: { error: (...args: unknown[]) => void }) {
  const runtime = effectiveWhatsAppConfig(db, config);
  if (runtime.WHATSAPP_MODE !== "EVOLUTION" && runtime.WHATSAPP_MODE !== "HYBRID_PLUS") return;
  if (!evolutionConfigured(runtime)) return;
  try {
    const client = evolutionClient(runtime);
    if (!(await client.health()).connected) return;   // sessao caida: a fila espera
    const outcome=await processGroupJoin(db, config, client, {
      sendInvite: (phone, groupCode, inviteUrl) => {
        queueBotNotification(db, config, phone,
          `Quase lá! 💛 Seu WhatsApp não permite que eu te adicione direto a grupos, então aqui está o convite do SOS YOUTUBER ${groupCode}: ${inviteUrl}\nÉ só tocar para entrar — e assim que você entrar eu te mando sua senha de acesso.`,
          `group-invite:${phone}:${groupCode}`, undefined, { deliveryClass: "TRANSACTIONAL", event: "GROUP_INVITE" });
      },
      escalate: (phone, name, reason) => {
        const id = db.prepare("SELECT id FROM participation_requests WHERE phone=?").get(phone) as { id: string } | undefined;
        if (id) queueOwnerAlerts(db, runtime, id.id, phone, name ?? "Participante", `group-join:${phone}`,`Entrada no grupo não concluída para ${name ?? "Participante"} (${phone}). Motivo: ${reason}. O cadastro existe, mas isso não confirma entrada no grupo. Verifique o pareamento, os privilégios do bot e os grupos no painel.`);
      },
    });
    if(outcome?.added&&outcome.groupCode){
      const message=outcome.alreadyMember
        ? `Você já participa do SOS YOUTUBER ${outcome.groupCode}! 💛 Confirmei sua presença; não vou adicionar você de novo. Seu acesso ao site está liberado.`
        : `Pronto! 💛 Adicionei você ao SOS YOUTUBER ${outcome.groupCode} e confirmei sua presença. Seu acesso ao site está liberado.`;
      queueBotNotification(db,config,outcome.phone,message,`group-confirmed:${outcome.requestId}`,undefined,{deliveryClass:"TRANSACTIONAL",event:"GROUP_JOIN_CONFIRMED"});
      const request=db.prepare("SELECT id,name FROM participation_requests WHERE phone=?").get(outcome.phone) as {id:string;name:string}|undefined;
      if(request)queueOwnerAlerts(db,runtime,request.id,outcome.phone,request.name,`group-confirmed:${outcome.requestId}`,`${request.name} (${outcome.phone}): ${outcome.alreadyMember?"já participa do":"adicionado e presença confirmada no"} SOS YOUTUBER ${outcome.groupCode}. Acesso liberado.`);
    }
  } catch (cause) { log?.error(cause, "Group join worker failed"); }
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
    const data=z.object({key:z.object({id:z.string().min(1).max(220),remoteJid:z.string(),remoteJidAlt:z.string().optional(),fromMe:z.boolean().optional()}),messageTimestamp:z.union([z.string(),z.number()]).optional(),message:z.object({conversation:z.string().optional(),extendedTextMessage:z.object({text:z.string().optional()}).optional()}).passthrough()}).parse(body.data);
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
    // IA (opcional, desligada por padrao): so pagamos/chamamos quando o caminho
    // gratuito nao entendeu. Qualquer falha devolve undefined e o bot age como antes.
    // AUDITORIA / ACHADO DO ASTRA, e ele estava certo: eu descrevi uma escada de tres
    // degraus (gatilho -> NLU local -> IA) e implementei dois. A condicao olhava so
    // `classifyInbound`, entao mensagens que o NLU LOCAL resolveria de graca iam para a
    // IA assim mesmo — latencia e cota gastas a toa. Agora a IA so e consultada quando
    // os DOIS caminhos gratuitos falham, que e o que o comentario sempre prometeu.
    const aiHint = text && classifyInbound(text) === "UNKNOWN" && !classifyLocalBotIntent(text)
      ? await aiClassifyIntent(db,text)
      : undefined;
    db.transaction(()=>processInboundMessages(db,runtime,[{id:`evo:${body.instance}:${data.key.id}`,from:senderJid.split("@")[0],type:text?"text":"media",timestamp:String(data.messageTimestamp),text:text?{body:text}:undefined}],aiHint))();
    return {ok:true};
  });
  ensureBotAutomations(db);
  ensureGroupJoinQueue(db);
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
      // AUDITORIA / entrada automatica em grupo: logo apos drenar a fila de envio,
      // processa UM pedido de entrada em grupo. Fica no MESMO tick e sob o mesmo guard
      // `busy` para nunca concorrer com o envio nem furar a cadencia anti-ban.
      running = flushWhatsAppOutbox(db,config)
        .then(() => drainGroupJoin(db,config,app.log))
        .catch(() => app.log.error("WhatsApp outbox worker failed"))
        .finally(() => { busy=false; });
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
