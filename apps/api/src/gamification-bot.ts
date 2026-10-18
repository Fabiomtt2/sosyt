import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";
import { readWhatsAppIntegration } from "./integrations.js";
import { queueBotNotification } from "./whatsapp.js";
import { automationSettings } from "./bot-automation-store.js";

// This bridge consumes real gamification events. It never claims all Claude automations are wired.
export const GAMIFICATION_BOT_EVENTS=["LEVEL_UP","BOOSTER_CLAIMED","MONTHLY_TOP","REWARD_REDEEMED","REWARD_COINS_GIFTED"] as const;
export type GamificationBotEvent=(typeof GAMIFICATION_BOT_EVENTS)[number];
const placeholders=["name","level","coins","item","rank","xp","trialDays"] as const;
const eventSchema=z.object({
  enabled:z.boolean(),internalEnabled:z.boolean(),whatsappEnabled:z.boolean(),
  text:z.string().trim().min(1).max(2000),
  templateName:z.string().trim().regex(/^[a-z0-9_]*$/).max(512),
  templateLanguage:z.string().regex(/^[a-z]{2}(?:_[A-Z]{2})?$/)
}).superRefine((event,ctx)=>{
  for(const match of event.text.matchAll(/\{(\w+)\}/g))
    if(!placeholders.includes(match[1] as typeof placeholders[number]))ctx.addIssue({code:"custom",message:"Variável de mensagem desconhecida: "+match[1]});
});
export const gamificationBotSchema=z.object({
  enabled:z.boolean(),
  events:z.object({LEVEL_UP:eventSchema,BOOSTER_CLAIMED:eventSchema,MONTHLY_TOP:eventSchema,REWARD_REDEEMED:eventSchema,REWARD_COINS_GIFTED:eventSchema})
});
export type GamificationBotSettings=z.infer<typeof gamificationBotSchema>;
const labels:Record<GamificationBotEvent,string>={
  LEVEL_UP:"Novo nível",BOOSTER_CLAIMED:"Presente do Booster",MONTHLY_TOP:"Destaque do mês",REWARD_REDEEMED:"Troca de recompensa",REWARD_COINS_GIFTED:"Presente de moedas"
};
const texts:Record<GamificationBotEvent,string>={
  LEVEL_UP:"Oi, {name}! Você chegou ao nível {level}. Recebeu {coins} moeda(s) de recompensa. Obrigado por crescer com a comunidade!",
  BOOSTER_CLAIMED:"Oi, {name}! Seu Booster trouxe {item}. O presente já está disponível na sua conta. Aproveite no seu tempo!",
  MONTHLY_TOP:"Parabéns, {name}! Você ficou em {rank}º lugar no mês, com {xp} XP, e recebeu {coins} moedas de recompensa. Obrigado por participar!",
  REWARD_REDEEMED:"Tudo certo, {name}! Você trocou {coins} moedas de recompensa por {item}. O benefício já está disponível na sua conta.",
  REWARD_COINS_GIFTED:"Oi, {name}! Você recebeu um presente de {coins} moedas da comunidade. Elas já estão disponíveis na sua conta!"
};
export const DEFAULT_GAMIFICATION_BOT_SETTINGS:GamificationBotSettings={
  enabled:true,events:Object.fromEntries(GAMIFICATION_BOT_EVENTS.map(event=>[event,{
    enabled:true,internalEnabled:true,whatsappEnabled:true,text:texts[event],templateName:"",templateLanguage:"pt_BR"
  }])) as GamificationBotSettings["events"]
};
const now=()=>new Date().toISOString();
export function initializeGamificationBot(db:AppDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gamification_bot_config(id INTEGER PRIMARY KEY CHECK(id=1),settings_json TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS gamification_bot_config_audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,settings_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS gamification_notification_deliveries(
      event_id TEXT PRIMARY KEY REFERENCES gamification_bot_events(id),
      user_id TEXT NOT NULL,body TEXT,mail_id TEXT,outbox_id TEXT,
      status TEXT NOT NULL DEFAULT 'WAITING',reason TEXT,checked_at TEXT NOT NULL,created_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT OR IGNORE INTO gamification_bot_config(id,settings_json,updated_at) VALUES(1,?,?)").run(JSON.stringify(DEFAULT_GAMIFICATION_BOT_SETTINGS),now());
  // Migrate only the former default; personalized Owner messages stay untouched.
  const row=db.prepare("SELECT settings_json AS json FROM gamification_bot_config WHERE id=1").get() as {json:string};
  const settings=gamificationBotSchema.parse(JSON.parse(row.json));
  if(settings.events.REWARD_COINS_GIFTED.text==="Oi, {name}! Você recebeu um presente de {coins} moedas de recompensa da comunidade. Elas já estão disponíveis na sua conta!"){
    settings.events.REWARD_COINS_GIFTED.text=texts.REWARD_COINS_GIFTED;
    db.prepare("UPDATE gamification_bot_config SET settings_json=?,updated_at=? WHERE id=1").run(JSON.stringify(settings),now());
  }
}
function settingsOf(db:AppDatabase):GamificationBotSettings {
  const row=db.prepare("SELECT settings_json AS json FROM gamification_bot_config WHERE id=1").get() as {json:string};
  return gamificationBotSchema.parse(JSON.parse(row.json));
}
export function readGamificationBot(db:AppDatabase) {
  return {
    settings:settingsOf(db),catalog:GAMIFICATION_BOT_EVENTS.map(event=>({event,label:labels[event],placeholders:[...placeholders]})),
    runtime:{wired:true,transport:"SELECTED_DM",note:"Os cinco eventos usam o motor selecionado: Evolution no modo puro; Meta no Oficial/HYBRID+. A fila acompanha a conexão e o recibo real de entrega."},
    deliveries:db.prepare(`SELECT d.event_id AS eventId,e.event,d.user_id AS userId,u.name,d.status,d.reason,d.mail_id AS mailId,d.outbox_id AS outboxId,d.checked_at AS checkedAt,d.created_at AS createdAt
      FROM gamification_notification_deliveries d JOIN gamification_bot_events e ON e.id=d.event_id LEFT JOIN users u ON u.id=d.user_id
      ORDER BY d.created_at DESC,d.rowid DESC LIMIT 100`).all()
  };
}
export function saveGamificationBot(db:AppDatabase,raw:unknown,actorId:string) {
  const settings=gamificationBotSchema.parse(raw);
  if(!actorId.trim())throw Object.assign(new Error("Informe quem alterou as mensagens."),{statusCode:400});
  db.transaction(()=>{
    const json=JSON.stringify(settings),stamp=now();
    db.prepare("UPDATE gamification_bot_config SET settings_json=?,updated_at=? WHERE id=1").run(json,stamp);
    db.prepare("INSERT INTO gamification_bot_config_audit(id,actor_id,settings_json,created_at) VALUES(?,?,?,?)").run(randomUUID(),actorId,json,stamp);
  })();
  return readGamificationBot(db);
}
function notificationBody(text:string,name:string,payload:Record<string,unknown>) {
  const item=payload.itemCode==="SKIP"||payload.code==="SKIP"?"Pular":payload.itemCode==="PASS"||payload.code==="PASS"?"Passe":
    payload.code==="SUPER_TRIAL"?"SUPER por "+String(payload.trialDays??7)+" dias":Number(payload.coins)>0?String(payload.coins)+" moedas de recompensa":"seu benefício";
  const vars:Record<string,string|number>={name,nome:name,nivel:Number(payload.level??1),level:Number(payload.level??1),coins:Number(payload.coins??payload.priceCoins??0),
    item,rank:Number(payload.place??0),xp:Number(payload.xp??0),trialDays:Number(payload.trialDays??0)};
  // One replacement pass: a participant name containing braces is never expanded again.
  return text.replace(/\{(\w+)\}/g,(match,key:string)=>Object.prototype.hasOwnProperty.call(vars,key)?String(vars[key]):match).slice(0,2000);
}
function correlateOutbox(db:AppDatabase) {
  const rows=db.prepare(`SELECT d.event_id AS eventId,o.status FROM gamification_notification_deliveries d
    JOIN whatsapp_outbox o ON o.id=d.outbox_id WHERE d.status='QUEUED' AND o.status IN ('SENT','FAILED')`).all() as Array<{eventId:string;status:"SENT"|"FAILED"}>;
  for(const row of rows){
    db.prepare("UPDATE gamification_notification_deliveries SET status=?,reason=?,checked_at=? WHERE event_id=?").run(row.status,row.status==="FAILED"?"OUTBOX_FAILED":null,now(),row.eventId);
    db.prepare("UPDATE gamification_bot_events SET status=? WHERE id=?").run(row.status,row.eventId);
  }
  return {sent:rows.filter(r=>r.status==="SENT").length,failed:rows.filter(r=>r.status==="FAILED").length};
}
/** Inserts durable messages/outbox jobs synchronously. Actual delivery belongs to the existing outbox worker. */
export function dispatchGamificationEvents(db:AppDatabase,config:Config) {
  const settings=settingsOf(db),wa=readWhatsAppIntegration(db,config);
  return db.transaction(()=>{
    const correlated=correlateOutbox(db);
    const rows=db.prepare(`SELECT e.id,e.event,e.user_id AS userId,e.payload_json AS payload,e.created_at AS createdAt,
      u.name,u.phone,u.deleted_at AS deletedAt,d.body,d.mail_id AS mailId,d.outbox_id AS outboxId
      FROM gamification_bot_events e LEFT JOIN users u ON u.id=e.user_id LEFT JOIN gamification_notification_deliveries d ON d.event_id=e.id
      WHERE e.status IN ('PENDING','WAITING') ORDER BY COALESCE(d.checked_at,'') ASC,e.created_at ASC,e.id ASC LIMIT 100`).all() as Array<{
        id:string;event:string;userId:string;payload:string;createdAt:string;name?:string;phone?:string;deletedAt?:string;body?:string;mailId?:string;outboxId?:string;
      }>;
    let queued=0,waiting=0,internalDelivered=0;
    for(const event of rows) {
      const stamp=now();
      db.prepare("INSERT OR IGNORE INTO gamification_notification_deliveries(event_id,user_id,checked_at,created_at) VALUES(?,?,?,?)").run(event.id,event.userId,stamp,event.createdAt);
      const setState=(status:string,reason?:string)=>{
        db.prepare("UPDATE gamification_notification_deliveries SET status=?,reason=?,checked_at=? WHERE event_id=?").run(status,reason??null,stamp,event.id);
        db.prepare("UPDATE gamification_bot_events SET status=? WHERE id=?").run(status,event.id);
      };
      if(!event.phone||event.deletedAt){setState("SKIPPED","ACCOUNT_UNAVAILABLE");continue;}
      if(!GAMIFICATION_BOT_EVENTS.includes(event.event as GamificationBotEvent)){setState("SKIPPED","UNKNOWN_EVENT");continue;}
      const baseRule=settings.events[event.event as GamificationBotEvent];
      // The five-event bridge remains the sole LEVEL_UP delivery engine. A saved
      // Owner catalog message governs it without activating a second dispatcher.
      const catalogRule=event.event==="LEVEL_UP"?automationSettings(db,"LEVEL_UP"):undefined;
      const rule=catalogRule?.customized?{...baseRule,enabled:catalogRule.enabled,text:catalogRule.text}:baseRule;
      if(!settings.enabled||!rule.enabled){setState("WAITING","EVENT_DISABLED");waiting++;continue;}
      let payload:Record<string,unknown>;
      try{payload=JSON.parse(event.payload);}catch{setState("SKIPPED","INVALID_EVENT");continue;}
      const body=event.body??notificationBody(rule.text,event.name??"Participante",payload);
      db.prepare("UPDATE gamification_notification_deliveries SET body=COALESCE(body,?) WHERE event_id=?").run(body,event.id);
      if(rule.internalEnabled&&!event.mailId){
        const mailId="gamification:"+event.id;
        const inserted=db.prepare("INSERT OR IGNORE INTO mail_messages(id,thread_key,sender_id,sender_role,recipient_id,body,created_at,read_at,deleted_at) VALUES(?,'system','system:sos','SYSTEM',?,?,?,NULL,NULL)").run(mailId,event.userId,body,stamp);
        db.prepare("UPDATE gamification_notification_deliveries SET mail_id=? WHERE event_id=?").run(mailId,event.id);
        internalDelivered+=inserted.changes;
      }
      if(!rule.whatsappEnabled){setState("WAITING","WHATSAPP_DISABLED");waiting++;continue;}
      // AUDITORIA / Evolution cobre tudo: avisos saem pelo motor nao-oficial em EVOLUTION.
      if(wa.mode==="EVOLUTION"){
        if(!wa.evolutionConfigured){setState("WAITING","EVOLUTION_NOT_READY");waiting++;continue;}
      }else if(wa.mode==="OFFICIAL"||wa.mode==="HYBRID_PLUS"){
        if(!wa.officialReady){setState("WAITING","META_NOT_READY");waiting++;continue;}
      }else{setState("WAITING","MODE_UNAVAILABLE");waiting++;continue;}
      const result=queueBotNotification(db,config,event.phone,body,"gamification:"+event.id,rule.templateName?{name:rule.templateName,language:rule.templateLanguage}:undefined,{deliveryClass:"REWARD",event:event.event==="LEVEL_UP"?"LEVEL_UP":"GAMIFICATION_"+event.event});
      if(!result.queued||!result.outboxId){setState("WAITING",result.reason??"CHANNEL_UNAVAILABLE");waiting++;continue;}
      const outbox=db.prepare("SELECT status FROM whatsapp_outbox WHERE id=?").get(result.outboxId) as {status:string}|undefined;
      if(!outbox){setState("WAITING","OUTBOX_NOT_FOUND");waiting++;continue;}
      db.prepare("UPDATE gamification_notification_deliveries SET outbox_id=? WHERE event_id=?").run(result.outboxId,event.id);
      setState(outbox.status==="SENT"?"SENT":outbox.status==="FAILED"?"FAILED":"QUEUED",outbox.status==="FAILED"?"OUTBOX_FAILED":undefined);
      queued++;
    }
    return {processed:rows.length,queued,waiting,internalDelivered,...correlated};
  })();
}
