import {randomUUID} from "node:crypto";
import type {AppDatabase} from "./db.js";
export function ensureParticipantAccessSchema(db:AppDatabase){
 db.exec(`CREATE TABLE IF NOT EXISTS participant_access_restrictions (
 user_id TEXT PRIMARY KEY REFERENCES users(id),blocked_at TEXT,updated_at TEXT NOT NULL,actor_owner_id TEXT NOT NULL,reason TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS participant_access_audit (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL CHECK(action IN ('REVOKE','RESTORE')),actor_owner_id TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS participant_access_audit_no_update BEFORE UPDATE ON participant_access_audit BEGIN SELECT RAISE(ABORT,'Immutable participant access audit');END;
 CREATE TRIGGER IF NOT EXISTS participant_access_audit_no_delete BEFORE DELETE ON participant_access_audit BEGIN SELECT RAISE(ABORT,'Immutable participant access audit');END;`);
}
export function isParticipantBlocked(db:AppDatabase,userId:string):boolean {
 return Boolean(db.prepare("SELECT 1 FROM participant_access_restrictions WHERE user_id=? AND blocked_at IS NOT NULL").get(userId));
}
export function assertParticipantAccess(db:AppDatabase,userId:string):void {
 if(isParticipantBlocked(db,userId))throw Object.assign(new Error("Seu acesso foi pausado pela administração. Fale com o atendimento."),{statusCode:403,code:"ACCOUNT_ACCESS_REVOKED"});
}
export function setParticipantAccess(db:AppDatabase,userId:string,blocked:boolean,actorOwnerId:string,reason:string){
 return db.transaction(()=>{
  if(!db.prepare("SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL").get(userId))throw Object.assign(new Error("Participante não encontrado."),{statusCode:404});
  const before=isParticipantBlocked(db,userId);
  if(before===blocked)return {blocked,replayed:true};
  const at=new Date().toISOString();
  db.prepare("INSERT INTO participant_access_restrictions(user_id,blocked_at,updated_at,actor_owner_id,reason) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET blocked_at=excluded.blocked_at,updated_at=excluded.updated_at,actor_owner_id=excluded.actor_owner_id,reason=excluded.reason").run(userId,blocked?at:null,at,actorOwnerId,reason);
  db.prepare("INSERT INTO participant_access_audit(id,user_id,action,actor_owner_id,reason,created_at) VALUES(?,?,?,?,?,?)").run(randomUUID(),userId,blocked?"REVOKE":"RESTORE",actorOwnerId,reason,at);
  return {blocked,replayed:false};
 })();
}
