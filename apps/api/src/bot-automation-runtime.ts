import { renderAutomation } from "./bot-dispatch.js";
import {captureQueueEvent} from "./bot-queue-snapshot.js";
import { createHash } from "node:crypto";
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";
import { automationMeta, AUTOMATION_CATALOG, formatXpRanking, renderTemplate, type AutomationEvent, type AutomationTarget } from "./bot-automations.js";
import { automationSettings, ensureBotAutomations, validateAutomationText } from "./bot-automation-store.js";
import { queueBotNotification, queueGroupAutomation } from "./whatsapp.js";
import { effectiveOwnerAccounts } from "./owners.js";
import { spreadFanOut } from "./bot-evolution.js";
import { featureEnabled,type BotFeatureCode } from "./bot.js";
import { isOptedOut } from "./bot-inbound.js";
import { bahiaClock, gamificationConfig } from "./gamification.js";

type Variables = Record<string, string | number>;
export type AutomationInput = {
  event: AutomationEvent; sourceId: string; userId?: string; phone?: string; groupCode?: string; vars: Variables;
};
const idFor = (value: string) => createHash("sha256").update(value).digest("hex");
const stamp = () => new Date().toISOString();

export function ensureBotAutomationRuntime(db: AppDatabase) {
  ensureBotAutomations(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_automation_events (
      id TEXT PRIMARY KEY,event TEXT NOT NULL,source_id TEXT NOT NULL,user_id TEXT,phone TEXT,group_code TEXT,
      vars_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',reason TEXT,created_at TEXT NOT NULL,
      UNIQUE(event,source_id)
    );
    CREATE TABLE IF NOT EXISTS bot_automation_deliveries (
      id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES bot_automation_events(id),recipient TEXT NOT NULL,
      target TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'WAITING',reason TEXT,
      outbox_id TEXT,available_at TEXT NOT NULL,created_at TEXT NOT NULL,checked_at TEXT NOT NULL,
      UNIQUE(event_id,recipient)
    );
    CREATE INDEX IF NOT EXISTS idx_bot_automation_waiting ON bot_automation_deliveries(status,available_at);
    CREATE TABLE IF NOT EXISTS bot_automation_clocks(event TEXT PRIMARY KEY,last_run_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bot_automation_activity(
      user_id TEXT PRIMARY KEY,last_activity_at TEXT NOT NULL,first_seen_at TEXT NOT NULL,last_nudged_at TEXT
    );
  `);
}

/** Source ID is the immutable business fact, never a timestamp generated for each retry. */
export function recordBotAutomationEvent(db: AppDatabase, input: AutomationInput) {
  if (!input.sourceId.trim()) throw new Error("AUTOMATION_SOURCE_REQUIRED");
  const meta = automationMeta(input.event), vars: Variables = {};
  for (const key of meta.placeholders) {
    const value = input.vars[key];
    if (typeof value === "string" || typeof value === "number") vars[key] = value;
  }
  const id = idFor(input.event + ":" + input.sourceId);
  db.prepare(`INSERT OR IGNORE INTO bot_automation_events
    (id,event,source_id,user_id,phone,group_code,vars_json,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(id,input.event,input.sourceId,input.userId ?? null,input.phone ?? null,input.groupCode ?? null,JSON.stringify(vars),stamp());
  return id;
}

type EventRow = { id: string; event: AutomationEvent; userId: string | null; phone: string | null; groupCode: string | null; vars: string; createdAt: string };
type Recipient = { address: string; target: string };
/** Names may themselves contain a phone number; privacy holds even for hostile profile input. */
function groupSafeBody(body: string) {
  return body.replace(/(?:\+?\d[\s().-]*){8,15}/g,"[dado privado]");
}
function recipientsFor(db: AppDatabase, config: Config, row: EventRow, target: AutomationTarget): Recipient[] {
  if (target === "GROUP" || target === "ALL_GROUPS") {
    const rows = db.prepare(`SELECT whatsapp_group_id AS address FROM groups
      WHERE enabled=1 AND whatsapp_group_id IS NOT NULL ${target === "GROUP" ? "AND code=?" : ""}`)
      .all(...(target === "GROUP" ? [row.groupCode ?? ""] : [])) as Array<{ address: string }>;
    return rows.filter(r => /^\d[\d-]*@g\.us$/.test(r.address)).map(r => ({...r,target}));
  }
  if (target === "OWNERS") return effectiveOwnerAccounts(db,config).filter(r => r.phone).map(r => ({address:r.phone!,target}));
  const user = row.userId ? db.prepare("SELECT phone,deleted_at AS deletedAt FROM users WHERE id=?").get(row.userId) as { phone: string; deletedAt: string | null } | undefined : undefined;
  if (row.userId && (!user || user.deletedAt)) return [];
  const phone = user?.phone ?? row.phone;
  return phone && /^[1-9]\d{7,14}$/.test(phone) ? [{address:phone,target}] : [];
}

type RuntimeQueue = {
  dm: typeof queueBotNotification;
  group: typeof queueGroupAutomation;
};
const queues: RuntimeQueue = {dm:queueBotNotification,group:queueGroupAutomation};
function featureFor(event: AutomationEvent): BotFeatureCode | undefined {
  if(event.startsWith("QUEUE") || event==="UPLOAD_NOTICE") return "QUEUE_ANNOUNCE";
  if(event.startsWith("WELCOME")) return "DECISION_NOTICE";
  if(event==="BROADCAST_GLOBAL" || event==="WEEKLY_XP_RANK" || event==="MONTHLY_TOP" || event==="PINNED_MESSAGE") return "BROADCAST";
  if(event==="SUPPORT_HANDOFF") return "HUMAN_HANDOFF";
  if(event.startsWith("SUPPORT")) return "SUPPORT_CHAT";
  return undefined;
}
const enabledByFeature = (db:AppDatabase,event:AutomationEvent) => {
  const feature=featureFor(event);if(feature && !featureEnabled(db,feature))return false;
  if(automationMeta(event).requires?.includes("GAMIFICATION")) {
    const settings=gamificationConfig(db);
    if(!settings.enabled)return false;
    if(event==="BOOSTER_FRIDAY" && !settings.boosterEnabled)return false;
    if(event==="MONTHLY_TOP" && !settings.monthlyEnabled)return false;
    if(["STREAK_MILESTONE","WEEKLY_XP_RANK","LEVEL_UP"].includes(event) && !settings.xpEnabled)return false;
  }
  return true;
};
const deliveryClass = (event: AutomationEvent) => event.startsWith("WELCOME") || event.startsWith("SUPPORT") ? "TRANSACTIONAL" as const :
  event.startsWith("QUEUE") || event === "UPLOAD_NOTICE" ? "QUEUE" as const :
  ["COINS_EARNED","LEVEL_UP","STREAK_MILESTONE"].includes(event) ? "REWARD" as const : "ENGAGEMENT" as const;

/** Persist recipients and rendered bodies once; future groups do not receive old broadcasts. */
function materialize(db: AppDatabase,config: Config,at: Date) {
  const rows = db.prepare(`SELECT id,event,user_id AS userId,phone,group_code AS groupCode,vars_json AS vars,created_at AS createdAt
    FROM bot_automation_events WHERE status='PENDING' ORDER BY created_at,rowid LIMIT 100`).all() as EventRow[];
  for (const row of rows) {
    const settings = automationSettings(db,row.event);
    const finish = (status: string,reason?: string) => db.prepare("UPDATE bot_automation_events SET status=?,reason=? WHERE id=?").run(status,reason ?? null,row.id);
    if (!settings.enabled || !enabledByFeature(db,row.event)) {finish("SKIPPED","EVENT_DISABLED");continue;}
    if (at.getTime()-Date.parse(row.createdAt)>86_400_000) {finish("SKIPPED","EVENT_EXPIRED");continue;}
    try {validateAutomationText(row.event,settings.text,settings.target);}
    catch {finish("FAILED","INVALID_CONFIGURATION");continue;}
    const vars = JSON.parse(row.vars) as Variables;
    const used = Array.from(settings.text.matchAll(/\{(\w+)\}/g),m=>m[1]);
    if (used.some(key=>vars[key] === undefined)) {finish("FAILED","MISSING_EVENT_DATA");continue;}
    if(featureEnabled(db,"COMMUNITY_GROUP_ONLY")&&["WELCOME_DM","SUPER_EXPIRING","INACTIVITY_NUDGE"].includes(row.event)){finish("SKIPPED","COMMUNITY_GROUP_ONLY");continue;}
     const groupOnly=featureEnabled(db,"COMMUNITY_GROUP_ONLY")&&["COINS_EARNED","LEVEL_UP","STREAK_MILESTONE"].includes(row.event);
     let targets = recipientsFor(db,config,row,settings.target);
     if(groupOnly){
       const member=row.userId?db.prepare("SELECT phone FROM users WHERE id=? AND deleted_at IS NULL").get(row.userId) as {phone:string}|undefined:undefined;
       const group=member?db.prepare("SELECT g.whatsapp_group_id AS address FROM groups g JOIN group_memberships m ON m.group_code=g.code WHERE m.phone=? AND g.enabled=1 AND g.whatsapp_group_id IS NOT NULL ORDER BY CAST(g.code AS INTEGER),g.code LIMIT 1").get(member.phone) as {address:string}|undefined:undefined;
       targets=group?[{address:group.address,target:"GROUP"}]:[];
     }
    if (!targets.length) {finish("SKIPPED","NO_ELIGIBLE_RECIPIENT");continue;}
    const group = groupOnly || settings.target === "GROUP" || settings.target === "ALL_GROUPS";
    const rendered=renderAutomation(db,row.event,vars);
    const text="skipped" in rendered?renderTemplate(settings.text,vars):rendered.text, body = group ? groupSafeBody(text) : text;
    const delays = group ? spreadFanOut(targets.length) : targets.map(()=>0);
    for (const [index,target] of targets.entries()) {
      const id = idFor(row.id+":"+target.address);
      db.prepare(`INSERT OR IGNORE INTO bot_automation_deliveries
        (id,event_id,recipient,target,body,available_at,created_at,checked_at) VALUES(?,?,?,?,?,?,?,?)`)
        .run(id,row.id,target.address,target.target,body,new Date(at.getTime()+delays[index]).toISOString(),at.toISOString(),at.toISOString());
    }
    finish("MATERIALIZED");
  }
}

/** This queues durable jobs only. SENT is copied exclusively from a confirmed outbox receipt. */
export function dispatchBotAutomations(db: AppDatabase,config: Config,at: Date = new Date(),transport: RuntimeQueue = queues) {
  return db.transaction(()=>{
    materialize(db,config,at);
    db.exec(`UPDATE bot_automation_deliveries SET
      status=(SELECT status FROM whatsapp_outbox o WHERE o.id=outbox_id),
      reason=(SELECT last_error FROM whatsapp_outbox o WHERE o.id=outbox_id)
      WHERE status='QUEUED' AND outbox_id IN (SELECT id FROM whatsapp_outbox WHERE status IN ('SENT','FAILED'))`);
    const rows = db.prepare(`SELECT d.*,e.event,e.user_id AS userId,e.created_at AS eventCreatedAt,e.source_id AS sourceId,e.vars_json AS eventVars FROM bot_automation_deliveries d
      JOIN bot_automation_events e ON e.id=d.event_id
      WHERE d.status='WAITING' AND d.available_at<=? ORDER BY d.available_at,d.rowid LIMIT 100`).all(at.toISOString()) as Array<{
        id:string;recipient:string;target:string;body:string;event:AutomationEvent;userId:string|null;eventCreatedAt:string;sourceId:string;eventVars:string;
      }>;
    let queued=0,waiting=0,suppressed=0;
    for (const row of rows) {
      const set=(status:string,reason?:string,outboxId?:string) => db.prepare("UPDATE bot_automation_deliveries SET status=?,reason=?,outbox_id=COALESCE(?,outbox_id),checked_at=? WHERE id=?")
        .run(status,reason ?? null,outboxId ?? null,at.toISOString(),row.id);
      if (!automationSettings(db,row.event).enabled || !enabledByFeature(db,row.event)) {set("SKIPPED","EVENT_DISABLED");continue;}
      if (at.getTime()-Date.parse(row.eventCreatedAt)>86_400_000) {set("SKIPPED","EVENT_EXPIRED");continue;}
      const group=row.target==="GROUP" || row.target==="ALL_GROUPS";
      if (!group && row.userId && !db.prepare("SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL").get(row.userId)) {
        set("SKIPPED","ACCOUNT_UNAVAILABLE");continue;
      }
      // Retention/reward respects opt-out even before the transport is configured.
      if (!group && deliveryClass(row.event)!=="TRANSACTIONAL" && isOptedOut(db,row.recipient)) {set("SKIPPED","OPTED_OUT");suppressed++;continue;}
      if (group) {
        if (!db.prepare("SELECT 1 FROM groups WHERE whatsapp_group_id=? AND enabled=1").get(row.recipient)) {set("SKIPPED","GROUP_UNAVAILABLE");continue;}
        // The live outbox worker reserves actual Evolution attempts. Producer-side
        // budgeting would discard valid jobs and count queued work as delivered.
      }
      const result=group ? transport.group(db,config,row.recipient,row.body,"automation:"+row.id,{event:row.event,queueSnapshot:captureQueueEvent(db,row.event,row.sourceId,JSON.parse(row.eventVars) as Variables,row.eventCreatedAt),deliveryClass:deliveryClass(row.event)==="QUEUE"?"QUEUE":"ENGAGEMENT",expiresAt:new Date(Date.parse(row.eventCreatedAt)+86_400_000).toISOString()})
        : transport.dm(db,config,row.recipient,row.body,"automation:"+row.id,undefined,{event:row.event,deliveryClass:deliveryClass(row.event)});
      if (result.queued && result.outboxId) {set("QUEUED",undefined,result.outboxId);queued++;}
      else if (["OPTED_OUT","QUIET_HOURS","BUDGET_EXCEEDED"].includes(result.reason ?? "")) {set("SKIPPED",result.reason);suppressed++;}
      else {set("WAITING",result.reason ?? "PROVIDER_UNAVAILABLE");waiting++;}
    }
    return {processed:rows.length,queued,waiting,suppressed};
  })();
}

const DAY = 86_400_000;
const PERIODIC_OWNED = new Set<AutomationEvent>(["WEEKLY_XP_RANK","MONTHLY_TOP","SUPER_EXPIRING","INACTIVITY_NUDGE","BOOSTER_FRIDAY"]);
const dayOf = (at: string | Date) => bahiaClock(new Date(at)).date;
const dayNumber = (date: string) => Math.floor(Date.parse(date+"T00:00:00.000Z")/DAY);
const administrativeIds = (db: AppDatabase, config: Config) => new Set([
  ...(db.prepare("SELECT user_id AS id FROM owner_access WHERE active=1").all() as Array<{id:string}>).map(r=>r.id),
  ...effectiveOwnerAccounts(db,config).map(r=>r.id),
]);
function eligibleUser(db: AppDatabase,config: Config,id: string) {
  if (administrativeIds(db,config).has(id)) return false;
  const user=db.prepare("SELECT phone FROM users WHERE id=? AND deleted_at IS NULL").get(id) as {phone:string}|undefined;
  return Boolean(user && !effectiveOwnerAccounts(db,config).some(o=>o.phone===user.phone));
}

/** Verified watch XP is the sole streak/inactivity source. Gifts, login and admin XP never count. */
export function scheduleParticipationSignals(db: AppDatabase,config: Config,at=new Date()) {
  const clock=db.prepare("SELECT last_run_at AS at FROM bot_automation_clocks WHERE event='ACTIVITY_SCAN'").get() as {at:string}|undefined;
  if(clock && at.getTime()-Date.parse(clock.at)<300_000) return {created:0};
  return db.transaction(()=>{
    let created=0;
    const previous=clock?.at;
    db.prepare("INSERT INTO bot_automation_clocks(event,last_run_at) VALUES('ACTIVITY_SCAN',?) ON CONFLICT(event) DO UPDATE SET last_run_at=excluded.last_run_at").run(at.toISOString());
    if(!gamificationConfig(db).enabled || !gamificationConfig(db).xpEnabled) return {created};
    const activity=db.prepare(`SELECT u.id,u.name,MAX(e.created_at) AS lastAt
      FROM users u JOIN gamification_events e ON e.user_id=u.id
      WHERE u.deleted_at IS NULL AND e.kind='VIDEO_XP' AND e.xp_delta>0 AND e.created_at<=?
      GROUP BY u.id`).all(at.toISOString()) as Array<{id:string;name:string;lastAt:string}>;
    const today=dayOf(at);
    for(const user of activity) {
      if(!eligibleUser(db,config,user.id))continue;
      const seen=db.prepare("SELECT first_seen_at AS firstSeen,last_nudged_at AS nudged FROM bot_automation_activity WHERE user_id=?").get(user.id) as {firstSeen:string;nudged:string|null}|undefined;
      db.prepare("INSERT INTO bot_automation_activity(user_id,last_activity_at,first_seen_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET last_activity_at=excluded.last_activity_at").run(user.id,user.lastAt,at.toISOString());
      // Bootstrap observes current facts only. A restart cannot replay old milestones.
      if(previous && dayOf(user.lastAt)===today && Date.parse(user.lastAt)>Date.parse(previous) && automationSettings(db,"STREAK_MILESTONE").enabled) {
        const days=(db.prepare("SELECT created_at AS at FROM gamification_events WHERE user_id=? AND kind='VIDEO_XP' AND xp_delta>0 AND created_at>=? AND created_at<=?").all(user.id,new Date(at.getTime()-31*DAY).toISOString(),at.toISOString()) as Array<{at:string}>);
        const active=new Set(days.map(d=>dayNumber(dayOf(d.at))));
        let streak=0;for(let day=dayNumber(today);active.has(day);day--)streak++;
        if([3,7,30].includes(streak)) {
          recordBotAutomationEvent(db,{event:"STREAK_MILESTONE",sourceId:user.id+":"+today+":"+streak,userId:user.id,vars:{nome:user.name,dias:streak}});created++;
        }
      }
      // One reminder per inactive episode, after at least seven observed days.
      if(seen && at.getTime()-Date.parse(seen.firstSeen)>=Math.max(7*DAY,(automationSettings(db,"INACTIVITY_NUDGE").intervalMinutes??1440)*60_000) && at.getTime()-Date.parse(user.lastAt)>=7*DAY &&
        (!seen.nudged || Date.parse(user.lastAt)>Date.parse(seen.nudged)) && automationSettings(db,"INACTIVITY_NUDGE").enabled) {
        recordBotAutomationEvent(db,{event:"INACTIVITY_NUDGE",sourceId:user.id+":"+user.lastAt,userId:user.id,vars:{nome:user.name,link:config.WEB_APP_URL}});
        db.prepare("UPDATE bot_automation_activity SET last_nudged_at=? WHERE user_id=?").run(at.toISOString(),user.id);created++;
      }
    }
    return {created};
  })();
}

/** Durable clocks, no historical catch-up. Daily/status announcements belong to bot-scheduler. */
export function scheduleBotAutomations(db: AppDatabase,config: Config,at: Date = new Date()) {
  let created=scheduleParticipationSignals(db,config,at).created;
  for(const meta of AUTOMATION_CATALOG.filter(m=>m.periodic && PERIODIC_OWNED.has(m.event) && m.event!=="INACTIVITY_NUDGE")) {
    const settings=automationSettings(db,meta.event);
    if(!settings.enabled || !enabledByFeature(db,meta.event)) continue;
    if(meta.requires?.includes("GAMIFICATION") && !gamificationConfig(db).enabled)continue;
    const previous=db.prepare("SELECT last_run_at AS at FROM bot_automation_clocks WHERE event=?").get(meta.event) as {at:string}|undefined;
    if(!previous) {
      db.prepare("INSERT INTO bot_automation_clocks(event,last_run_at) VALUES(?,?)").run(meta.event,meta.event==="BOOSTER_FRIDAY"?new Date(at.getTime()-7*DAY).toISOString():at.toISOString());
      continue;
    }
    const intervalMinutes=meta.event==="MONTHLY_TOP" && settings.intervalMinutes===meta.defaultIntervalMinutes
      ? 5 : (settings.intervalMinutes ?? meta.defaultIntervalMinutes ?? 1440);
    if(at.getTime()-Date.parse(previous.at)<intervalMinutes*60_000)continue;
    db.transaction(()=>{
      const sourceId="scheduled:"+meta.event+":"+dayOf(at);
      if(meta.event==="SUPER_EXPIRING") {
        const rows=db.prepare(`SELECT u.id,u.name,s.expires_at AS expiresAt FROM super_subscriptions s JOIN users u ON u.id=s.user_id
          WHERE u.deleted_at IS NULL AND s.revoked_at IS NULL AND s.expires_at>? AND s.expires_at<=?`)
          .all(at.toISOString(),new Date(at.getTime()+3*DAY).toISOString()) as Array<{id:string;name:string;expiresAt:string}>;
        for(const row of rows) if(eligibleUser(db,config,row.id)) {
          // One notice per expiration, even if the configured scan runs every 15 minutes.
          recordBotAutomationEvent(db,{event:meta.event,sourceId:row.id+":"+row.expiresAt,userId:row.id,
            vars:{nome:row.name,dias:Math.ceil((Date.parse(row.expiresAt)-at.getTime())/DAY),link:config.WEB_APP_URL}});created++;
        }
      }else if(meta.event==="WEEKLY_XP_RANK") {
        const rows=db.prepare(`SELECT u.id,u.name,SUM(e.xp_delta) AS xp,MAX(e.created_at) AS reachedAt FROM gamification_events e JOIN users u ON u.id=e.user_id
          WHERE e.kind='VIDEO_XP' AND e.created_at>=? AND e.created_at<=? AND u.deleted_at IS NULL
          GROUP BY u.id HAVING xp>0 ORDER BY xp DESC,reachedAt ASC,u.id ASC`)
          .all(new Date(at.getTime()-7*DAY).toISOString(),at.toISOString()) as Array<{id:string;name:string;xp:number}>;
        const ranking=rows.filter(r=>eligibleUser(db,config,r.id));
        if(ranking.length){recordBotAutomationEvent(db,{event:meta.event,sourceId,vars:{ranking:formatXpRanking(ranking),semana:dayOf(at)}});created++;}
      }else if(meta.event==="MONTHLY_TOP") {
        const month=db.prepare("SELECT month FROM gamification_months WHERE settled_at IS NOT NULL AND settled_at>=? AND settled_at<=? ORDER BY month DESC LIMIT 1").get(previous.at,at.toISOString()) as {month:string}|undefined;
        if(month) {
          const rows=db.prepare("SELECT u.id,u.name,p.xp FROM gamification_month_prizes p JOIN users u ON u.id=p.user_id WHERE p.month=? AND u.deleted_at IS NULL ORDER BY p.place").all(month.month) as Array<{id:string;name:string;xp:number}>;
          const ranking=rows.filter(r=>eligibleUser(db,config,r.id));
          if(ranking.length){recordBotAutomationEvent(db,{event:meta.event,sourceId:"settled:"+month.month,vars:{ranking:formatXpRanking(ranking),mes:month.month}});created++;}
        }
      }else if(meta.event==="BOOSTER_FRIDAY") {
        const clock=bahiaClock(at);
        if(clock.friday && clock.hour>=6 && clock.hour<22) {
          recordBotAutomationEvent(db,{event:meta.event,sourceId:"booster:"+clock.date,vars:{link:config.WEB_APP_URL}});created++;
        }else return; // Keep due until the next Friday window rather than drift a week.
      }
      db.prepare("UPDATE bot_automation_clocks SET last_run_at=? WHERE event=?").run(at.toISOString(),meta.event);
    })();
  }
  return {created};
}

export function botAutomationRuntimeStatus(db: AppDatabase) {
  const delegated:Partial<Record<AutomationEvent,string>>={
    PINNED_MESSAGE:"TEXT_ONLY_PIN_UNAVAILABLE",GOOD_MORNING:"DELEGATED_DAILY_SCHEDULER",GOOD_NIGHT:"DELEGATED_DAILY_SCHEDULER",
    QUEUE_STATUS:"DELEGATED_DAILY_SCHEDULER",QUEUE_OPEN:"DELEGATED_QUEUE_ANNOUNCER",UPLOAD_NOTICE:"DELEGATED_QUEUE_ANNOUNCER",
    LEVEL_UP:"DELEGATED_GAMIFICATION_BOT",COINS_EARNED:"WIRED_WALLET_LEDGER",WELCOME_MEMBER:"DELEGATED_GROUP_SYNC",
    WELCOME_DM:"DELEGATED_INBOUND_ENGINE",SUPPORT_AUTO:"DELEGATED_INBOUND_ENGINE",SUPPORT_HANDOFF:"DELEGATED_INBOUND_ENGINE",
    SUPPORT_OFFHOURS:"DELEGATED_SUPPORT_AVAILABILITY",BROADCAST_GLOBAL:"WIRED_ROOT_MANUAL",
  };
  return {
    wired:true,
    deliveries:db.prepare(`SELECT e.event,e.source_id AS sourceId,d.target,d.status,d.reason,d.outbox_id AS outboxId,d.created_at AS createdAt
      FROM bot_automation_deliveries d JOIN bot_automation_events e ON e.id=d.event_id ORDER BY d.created_at DESC,d.rowid DESC LIMIT 100`).all(),
    events:db.prepare("SELECT event,status,reason,COUNT(*) AS total FROM bot_automation_events GROUP BY event,status,reason").all(),
    capabilities:AUTOMATION_CATALOG.map(m=>({event:m.event,status:delegated[m.event]??"WIRED"})),
  };
}
