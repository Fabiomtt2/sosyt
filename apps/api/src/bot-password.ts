import {isParticipantBlocked} from "./participant-access.js";
import {effectiveOwnerAccounts} from "./owners.js";
import {sameWhatsAppNumber} from "./bot-evolution.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";
import { generateBotPassword,hashPassword } from "./password.js";
import { readWhatsAppIntegration } from "./integrations.js";
import { queueBotNotification } from "./whatsapp.js";

export const botPasswordSettingsSchema=z.object({
  enabled:z.boolean(),templateName:z.string().trim().regex(/^[a-z0-9_]*$/).max(512),
  templateLanguage:z.string().regex(/^[a-z]{2}(?:_[A-Z]{2})?$/)
});
export type BotPasswordSettings=z.infer<typeof botPasswordSettingsSchema>;
export function initializeBotPassword(db:AppDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_password_config(id INTEGER PRIMARY KEY CHECK(id=1),settings_json TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bot_password_config_audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,settings_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bot_password_deliveries(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,outbox_id TEXT NOT NULL UNIQUE REFERENCES whatsapp_outbox(id),created_at TEXT NOT NULL);
  `);
  db.prepare("INSERT OR IGNORE INTO bot_password_config(id,settings_json,updated_at) VALUES(1,?,?)").run(JSON.stringify({enabled:true,templateName:"",templateLanguage:"pt_BR"}),new Date().toISOString());
}
export function readBotPasswordSettings(db:AppDatabase) {
  const row=db.prepare("SELECT settings_json AS json FROM bot_password_config WHERE id=1").get() as {json:string};
  return {
    ...botPasswordSettingsSchema.parse(JSON.parse(row.json)),
    deliveries:db.prepare(`SELECT d.user_id AS userId,u.name,d.outbox_id AS outboxId,o.status,d.created_at AS createdAt
      FROM bot_password_deliveries d JOIN users u ON u.id=d.user_id JOIN whatsapp_outbox o ON o.id=d.outbox_id
      ORDER BY d.created_at DESC,d.rowid DESC LIMIT 100`).all()
  };
}
export function saveBotPasswordSettings(db:AppDatabase,raw:unknown,actorId:string) {
  const settings=botPasswordSettingsSchema.parse(raw);
  if(!actorId.trim())throw Object.assign(new Error("Informe quem alterou o acesso automático."),{statusCode:400});
  db.transaction(()=>{
    const stamp=new Date().toISOString(),json=JSON.stringify(settings);
    db.prepare("UPDATE bot_password_config SET settings_json=?,updated_at=? WHERE id=1").run(json,stamp);
    db.prepare("INSERT INTO bot_password_config_audit(id,actor_id,settings_json,created_at) VALUES(?,?,?,?)").run(randomUUID(),actorId,json,stamp);
  })();
  return readBotPasswordSettings(db);
}
/** Only trusted proof callbacks may call this. No plaintext password is returned, logged or mailed internally. */
export function ensureBotPassword(db:AppDatabase,config:Config,userId:string,proofVerified:boolean):{created:boolean;queued:boolean;reason?:string} {
  if(!proofVerified)return {created:false,queued:false,reason:"PHONE_PROOF_REQUIRED"};
  if(isParticipantBlocked(db,userId))return {created:false,queued:false,reason:"ACCOUNT_ACCESS_REVOKED"};
  const settings=readBotPasswordSettings(db);
  if(!settings.enabled)return {created:false,queued:false,reason:"PASSWORD_BOT_DISABLED"};
  const wa=readWhatsAppIntegration(db,config);
  // AUDITORIA / Evolution cobre tudo: a senha sai pelo motor nao-oficial quando o
  // modo e EVOLUTION e o motor esta configurado. OFFICIAL/HYBRID exigem Meta pronta.
  if(wa.mode==="EVOLUTION"){
    if(!wa.evolutionConfigured)return {created:false,queued:false,reason:"EVOLUTION_NOT_READY"};
  }else if(wa.mode==="OFFICIAL"||wa.mode==="HYBRID_PLUS"){
    if(!wa.officialReady)return {created:false,queued:false,reason:"META_NOT_READY"};
  }else return {created:false,queued:false,reason:"MODE_UNAVAILABLE"};
  return db.transaction(()=>{
    const user=db.prepare("SELECT phone,name FROM users WHERE id=? AND deleted_at IS NULL").get(userId) as {phone:string;name:string}|undefined;
    if(!user)return {created:false,queued:false,reason:"ACCOUNT_UNAVAILABLE"};
    if(db.prepare("SELECT 1 FROM owner_access WHERE user_id=? AND active=1").get(userId)||effectiveOwnerAccounts(db,config).some(owner=>owner.phone&&sameWhatsAppNumber(owner.phone,user.phone)))return {created:false,queued:false,reason:"ADMIN_ACCOUNT"};
    if(db.prepare("SELECT 1 FROM user_passwords WHERE user_id=?").get(userId))return {created:false,queued:false,reason:"PASSWORD_ALREADY_SET"};
    if(db.prepare("SELECT 1 FROM whatsapp_outbox WHERE dedupe_key=?").get("bot-password:"+userId))return {created:false,queued:false,reason:"DELIVERY_STATE_CONFLICT"};
    const password=generateBotPassword();
    const body="Oi, "+user.name+"! Seu acesso ao SOS YouTuber está pronto. Sua senha para entrar com este WhatsApp é: "+password+". Guarde-a em um lugar seguro e troque-a após entrar. Não compartilhe sua senha com outras pessoas. Para recuperar o acesso, fale comigo neste mesmo WhatsApp.";
    const result=queueBotNotification(db,config,user.phone,body,"bot-password:"+userId,
      settings.templateName?{name:settings.templateName,language:settings.templateLanguage}:undefined,{encryptPayload:true,deliveryClass:"TRANSACTIONAL",event:"BOT_PASSWORD"});
    if(!result.queued||!result.outboxId)return {created:false,queued:false,reason:result.reason??"DELIVERY_UNAVAILABLE"};
    const outbox=db.prepare("SELECT payload FROM whatsapp_outbox WHERE id=?").get(result.outboxId) as {payload:string}|undefined;
    if(!outbox)return {created:false,queued:false,reason:"OUTBOX_NOT_FOUND"};
    const envelope=JSON.parse(outbox.payload) as {encryptedNotification?:unknown};
    if(typeof envelope.encryptedNotification!=="string")throw Object.assign(new Error("O envio de senha exige armazenamento cifrado."),{statusCode:503,code:"PASSWORD_ENCRYPTION_REQUIRED"});
    const stamp=new Date().toISOString();
    db.prepare("INSERT INTO user_passwords(user_id,password_hash,must_change,attempts,locked_until,updated_at) VALUES(?,?,1,0,NULL,?)").run(userId,hashPassword(password),stamp);
    db.prepare("INSERT INTO bot_password_deliveries(user_id,outbox_id,created_at) VALUES(?,?,?)").run(userId,result.outboxId,stamp);
    return {created:true,queued:true};
  })();
}

/**
 * AUDITORIA / "esqueci a senha" tem que RESOLVER.
 *
 * `ensureBotPassword` é deliberadamente idempotente: se já existe senha ou já existe
 * uma entrega na outbox, ele recusa (PASSWORD_ALREADY_SET / DELIVERY_STATE_CONFLICT).
 * Isso é correto para o cadastro — evita duas senhas na mesma conta — mas transformava
 * a opção "trocar senha" do bot num beco sem saída: quem perdeu a senha ouvia "você já
 * tem senha cadastrada" para sempre e nunca conseguia entrar.
 *
 * Reemitir é um pedido legítimo e diferente de criar: aqui a entrega anterior é
 * invalidada e uma senha nova é gerada. Só o próprio dono do número chega neste ponto
 * (a prova é a mensagem vir do WhatsApp dele), que é a mesma prova usada no cadastro.
 * A senha antiga deixa de valer no mesmo instante — ninguém fica com duas válidas.
 */
export function reissueBotPassword(db:AppDatabase,config:Config,userId:string,proofVerified:boolean):{created:boolean;queued:boolean;reason?:string} {
  if(!proofVerified)return {created:false,queued:false,reason:"PHONE_PROOF_REQUIRED"};
  if(isParticipantBlocked(db,userId))return {created:false,queued:false,reason:"ACCOUNT_ACCESS_REVOKED"};
  // Contas administrativas entram pela credencial do painel: nada a reemitir.
  if(db.prepare("SELECT 1 FROM owner_access WHERE user_id=? AND active=1").get(userId))return {created:false,queued:false,reason:"ADMIN_ACCOUNT"};
  type Result = ReturnType<typeof ensureBotPassword>;
  class ReissueRejected extends Error {
    constructor(readonly result:Result){super("Password reissue unavailable");}
  }
  try {
    return db.transaction(()=>{
      const previous=db.prepare("SELECT outbox_id AS id FROM bot_password_deliveries WHERE user_id=?").get(userId) as {id:string}|undefined;
      // Preserve the old delivery receipt. Pending old secrets must never be sent
      // after a replacement, and a failed replacement must restore this exact state.
      if(previous) db.prepare(`UPDATE whatsapp_outbox SET
        dedupe_key=?,status=CASE WHEN status IN ('PENDING','SENDING') THEN 'FAILED' ELSE status END,
        last_error=CASE WHEN status IN ('PENDING','SENDING') THEN 'PASSWORD_SUPERSEDED' ELSE last_error END,
        lease_until=NULL WHERE id=?`).run("bot-password:"+userId+":superseded:"+randomUUID(),previous.id);
      db.prepare("DELETE FROM bot_password_deliveries WHERE user_id=?").run(userId);
      db.prepare("DELETE FROM user_passwords WHERE user_id=?").run(userId);
      const result=ensureBotPassword(db,config,userId,true);
      if(!result.created || !result.queued) throw new ReissueRejected(result);
      return result;
    })();
  } catch(error) {
    if(error instanceof ReissueRejected)return error.result;
    throw error;
  }
}
