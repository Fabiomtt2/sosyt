import {randomUUID} from "node:crypto";
import type {AppDatabase} from "./db.js";

export const PRESENCE_WINDOW_MS=5*60*1000;
export const PRESENCE_CHALLENGE_MS=90*1000;
export type WatchPresence={required:false;confirmedUntil:string}|{required:true;challengeId:string;expiresAt:string};
type Row={next_check_at:number;challenge_id:string|null;challenge_expires_at:number|null};
export function initializeWatchPresence(db:AppDatabase){
 db.exec(`CREATE TABLE IF NOT EXISTS watch_presence (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 next_check_at INTEGER NOT NULL, challenge_id TEXT, challenge_expires_at INTEGER
 )`);
}
/** Global per account: switching queue, browser or export never refreshes this window. */
export function checkWatchPresence(db:AppDatabase,userId:string,now=Date.now()):WatchPresence{
 return db.transaction(()=>{
  db.prepare("INSERT OR IGNORE INTO watch_presence(user_id,next_check_at) VALUES(?,?)").run(userId,now+PRESENCE_WINDOW_MS);
  const row=db.prepare("SELECT * FROM watch_presence WHERE user_id=?").get(userId) as Row;
  if(now<row.next_check_at&&!row.challenge_id)return {required:false as const,confirmedUntil:new Date(row.next_check_at).toISOString()};
  if(row.challenge_id&&row.challenge_expires_at!==null&&now<row.challenge_expires_at)
   return {required:true as const,challengeId:row.challenge_id,expiresAt:new Date(row.challenge_expires_at).toISOString()};
  const id=randomUUID(),expires=now+PRESENCE_CHALLENGE_MS;
  db.prepare("UPDATE watch_presence SET challenge_id=?,challenge_expires_at=? WHERE user_id=?").run(id,expires,userId);
  return {required:true as const,challengeId:id,expiresAt:new Date(expires).toISOString()};
 })();
}
/** Only a current, unexpired nonce belonging to this authenticated account is accepted. */
export function confirmWatchPresence(db:AppDatabase,userId:string,challengeId:string,now=Date.now()):boolean{
 return db.transaction(()=>{
  const changed=db.prepare(`UPDATE watch_presence SET next_check_at=?,challenge_id=NULL,challenge_expires_at=NULL
   WHERE user_id=? AND challenge_id=? AND challenge_expires_at>?`).run(now+PRESENCE_WINDOW_MS,userId,challengeId,now);
  if(!changed.changes)return false;
  // The first observation after confirmation is a baseline, never credit for the paused gap.
  db.prepare("UPDATE watch_observation_state SET active=0 WHERE user_id=?").run(userId);
  return true;
 })();
}
