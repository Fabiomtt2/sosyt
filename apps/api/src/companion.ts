import { createHash,randomBytes,randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance,FastifyReply,FastifyRequest } from "fastify";
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";

const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
type Device={id:string;user_id:string;expires_at:number;revoked_at?:string;last_sequence:number};
type Rewards={verifiedSeconds:number;coins:number;secondsToNextReward:number};

/** Optional corroborating observations only. This module cannot write rewards. */
export function registerCompanion(app:FastifyInstance,db:AppDatabase,config:Config,
 authGuard:(request:FastifyRequest,reply:FastifyReply)=>Promise<unknown>,
 rewards:(userId:string)=>Rewards){
 db.exec(`
  CREATE TABLE IF NOT EXISTS companion_pairings (
   code_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),label TEXT NOT NULL,expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS companion_devices (
   id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),token_hash TEXT NOT NULL UNIQUE,label TEXT NOT NULL,
   created_at TEXT NOT NULL,expires_at INTEGER NOT NULL,revoked_at TEXT,
   last_sequence INTEGER NOT NULL DEFAULT 0,last_seen_at TEXT,signal TEXT,position_seconds REAL,duration_seconds REAL,player_matches INTEGER NOT NULL DEFAULT 0);
 `);
 function device(request:FastifyRequest):Device|undefined {
  const token=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization??"")?.[1];
  if(!token)return;
  return db.prepare(`SELECT d.* FROM companion_devices d JOIN users u ON u.id=d.user_id
   WHERE d.token_hash=? AND d.revoked_at IS NULL AND d.expires_at>? AND u.deleted_at IS NULL`).get(hash(token),Date.now()) as Device|undefined;
 }
 app.post("/companion/pairings",{preHandler:authGuard,config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async(request,reply)=>{
  const body=z.object({consent:z.literal(true),label:z.string().trim().min(2).max(60).default("Meu computador")}).parse(request.body);
  const count=db.prepare("SELECT COUNT(*) AS n FROM companion_devices WHERE user_id=? AND revoked_at IS NULL AND expires_at>?").get(request.user.sub,Date.now()) as {n:number};
  if(count.n>=5)return reply.code(409).send({message:"Revogue um computador antigo antes de conectar outro."});
  const code=randomBytes(6).toString("hex").toUpperCase();
  db.transaction(()=>{
   db.prepare("DELETE FROM companion_pairings WHERE user_id=? OR expires_at<=?").run(request.user.sub,Date.now());
   db.prepare("INSERT INTO companion_pairings VALUES(?,?,?,?)").run(hash(code),request.user.sub,body.label,Date.now()+300_000);
  })();
  return {pairingCode:code,expiresInSeconds:300,apiUrl:config.API_PUBLIC_URL};
 });
 app.post("/companion/pair",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request,reply)=>{
  const code=z.object({code:z.string().trim().transform(value=>value.toUpperCase()).pipe(z.string().regex(/^[A-F0-9]{12}$/))}).parse(request.body).code;
  const row=db.prepare("SELECT p.user_id,p.label FROM companion_pairings p JOIN users u ON u.id=p.user_id WHERE p.code_hash=? AND p.expires_at>? AND u.deleted_at IS NULL").get(hash(code),Date.now()) as {user_id:string;label:string}|undefined;
  if(!row)return reply.code(401).send({message:"Código expirado ou já utilizado. Gere outro no webapp."});
  const token=randomBytes(32).toString("hex"),id=randomUUID(),stamp=new Date().toISOString();
  db.transaction(()=>{
   db.prepare("DELETE FROM companion_pairings WHERE code_hash=?").run(hash(code));
   db.prepare("INSERT INTO companion_devices(id,user_id,token_hash,label,created_at,expires_at) VALUES(?,?,?,?,?,?)")
    .run(id,row.user_id,hash(token),row.label,stamp,Date.now()+30*86400_000);
  })();
  return {deviceToken:token,deviceId:id,label:row.label,expiresInDays:30};
 });
 app.get("/companion/device",{config:{rateLimit:{max:30,timeWindow:"1 minute"}}},async(request,reply)=>{
  const current=device(request);if(!current)return reply.code(401).send({message:"Companion desconectado ou autorização expirada."});
  return {deviceId:current.id,nextSequence:current.last_sequence+1,rewards:rewards(current.user_id)};
 });
 app.delete("/companion/device",async(request,reply)=>{
  const current=device(request);if(!current)return reply.code(401).send({message:"Companion já desconectado."});
  db.prepare("UPDATE companion_devices SET revoked_at=?,signal='STOPPED',player_matches=0 WHERE id=?").run(new Date().toISOString(),current.id);
  return {ok:true};
 });
 app.post("/companion/observations",{config:{rateLimit:{max:30,timeWindow:"1 minute"}}},async(request,reply)=>{
  const current=device(request);if(!current)return reply.code(401).send({message:"Companion desconectado ou autorização expirada."});
  const body=z.object({sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
   signal:z.enum(["ADVANCING","PAUSED","UNREADABLE","STOPPED"]),
   positionSeconds:z.number().finite().min(0).max(86400).optional(),
   durationSeconds:z.number().finite().positive().max(86400).optional()}).strict().parse(request.body);
  if(body.sequence<=current.last_sequence)return reply.code(409).send({message:"Observação já recebida.",nextSequence:current.last_sequence+1});
  if(body.signal==="ADVANCING"&&(body.positionSeconds===undefined||body.durationSeconds===undefined||body.positionSeconds>body.durationSeconds))
   return reply.code(400).send({message:"O tempo reconhecido não é válido."});
  const state=db.prepare("SELECT player_seconds,duration_seconds,observed_at,active FROM watch_observation_state WHERE user_id=?").get(current.user_id) as
   {player_seconds:number;duration_seconds:number;observed_at:string;active:number}|undefined;
  const age=state?Date.now()-Date.parse(state.observed_at):Infinity;
  const matches=Boolean(body.signal==="ADVANCING"&&state?.active&&age>=0&&age<15000&&
   Math.abs((body.positionSeconds??-100)-state.player_seconds)<=10&&Math.abs((body.durationSeconds??-100)-state.duration_seconds)<=3);
  db.prepare("UPDATE companion_devices SET last_sequence=?,last_seen_at=?,signal=?,position_seconds=?,duration_seconds=?,player_matches=? WHERE id=?")
   .run(body.sequence,new Date().toISOString(),body.signal,body.positionSeconds??null,body.durationSeconds??null,matches?1:0,current.id);
  return {ok:true,nextSequence:body.sequence+1,playerMatches:matches,rewards:rewards(current.user_id)};
 });
 app.get("/companion/devices",{preHandler:authGuard},async request=>({
  devices:db.prepare(`SELECT id,label,created_at AS createdAt,last_seen_at AS lastSeenAt,signal,player_matches AS playerMatches,
   CASE WHEN revoked_at IS NULL AND expires_at>? THEN 1 ELSE 0 END AS authorized
   FROM companion_devices WHERE user_id=? ORDER BY created_at DESC LIMIT 20`).all(Date.now(),request.user.sub)
 }));
 app.delete("/companion/devices/:id",{preHandler:authGuard},async(request,reply)=>{
  const id=z.string().uuid().parse((request.params as {id:string}).id);
  const changed=db.prepare("UPDATE companion_devices SET revoked_at=?,signal='STOPPED',player_matches=0 WHERE id=? AND user_id=?")
   .run(new Date().toISOString(),id,request.user.sub);
  if(!changed.changes)return reply.code(404).send({message:"Computador não encontrado."});
  return {ok:true};
 });
}
