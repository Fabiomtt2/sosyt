import { assertSocialInteractionAllowed } from "./social-blocks.js";
import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppDatabase } from "./db.js";
import { grantItem } from "./inventory.js";

// Only server-accepted video intervals create XP. Percentages and client claims never do.
const dropSchema=z.object({
  code:z.enum(["COINS_5","COINS_10","COINS_15","COINS_20","COINS_25","SKIP","PASS","SUPER_TRIAL"]),
  weight:z.number().int().min(0).max(10000)
});
export const gamificationConfigSchema=z.object({
  enabled:z.boolean(),xpEnabled:z.boolean(),boosterEnabled:z.boolean(),redeemEnabled:z.boolean(),monthlyEnabled:z.boolean(),
  xpPerVideo:z.number().int().min(1).max(10000),
  curve:z.object({firstStep:z.number().int().min(1).max(100000),stepIncrease:z.number().int().min(0).max(100000)}),
  levelCoins:z.number().int().min(0).max(100),milestoneEvery:z.number().int().min(1).max(1000),milestoneCoins:z.number().int().min(0).max(1000),
  trialEvery:z.number().int().min(1).max(1000),trialDays:z.number().int().min(1).max(30),
  monthlyRewards:z.tuple([z.number().int().min(0).max(1000),z.number().int().min(0).max(1000),z.number().int().min(0).max(1000)]),
  redeemPrices:z.object({SKIP:z.number().int().min(1).max(10000),PASS:z.number().int().min(1).max(10000)}),
  boosterDrops:z.array(dropSchema).length(8)
}).superRefine((c,ctx)=>{
  if(new Set(c.boosterDrops.map(d=>d.code)).size!==8||c.boosterDrops.reduce((n,d)=>n+d.weight,0)!==10000)
    ctx.addIssue({code:"custom",message:"As oito chances precisam ser distintas e somar 100%."});
});
export type GamificationConfig=z.infer<typeof gamificationConfigSchema>;
export const DEFAULT_GAMIFICATION_CONFIG:GamificationConfig={
  enabled:true,xpEnabled:true,boosterEnabled:true,redeemEnabled:true,monthlyEnabled:true,xpPerVideo:100,
  curve:{firstStep:100,stepIncrease:50},levelCoins:1,milestoneEvery:10,milestoneCoins:20,trialEvery:30,trialDays:7,
  monthlyRewards:[15,10,5],redeemPrices:{SKIP:100,PASS:100},
  boosterDrops:[{code:"COINS_5",weight:4500},{code:"COINS_10",weight:2500},{code:"COINS_15",weight:1300},{code:"COINS_20",weight:800},{code:"COINS_25",weight:500},{code:"SKIP",weight:200},{code:"PASS",weight:150},{code:"SUPER_TRIAL",weight:50}]
};
type DropCode=GamificationConfig["boosterDrops"][number]["code"];
function fail(statusCode:number,message:string,code:string):never {throw Object.assign(new Error(message),{statusCode,code});}
const stamp=()=>new Date().toISOString();
function isRootProgress(db:AppDatabase,userId:string):boolean {
  return Boolean(db.prepare("SELECT 1 FROM owner_access WHERE user_id=? AND active=1 AND role='ROOT_OWNER'").get(userId));
}
export type GamificationProgress =
  | {administrative:true;unlimitedXp:true;xp:null;level:null;nextLevelXp:null;levelStartXp:null}
  | {administrative:false;unlimitedXp:false;xp:number;level:number;nextLevelXp:number;levelStartXp:number};
function userExists(db:AppDatabase,id:string) {
  if(!db.prepare("SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL").get(id))fail(404,"Participante não encontrado.","USER_NOT_FOUND");
}
export function initializeGamification(db:AppDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gamification_config(id INTEGER PRIMARY KEY CHECK(id=1),config_json TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS gamification_config_audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,config_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS gamification_users(user_id TEXT PRIMARY KEY REFERENCES users(id),level INTEGER NOT NULL DEFAULT 1,curve_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS gamification_sources(user_id TEXT NOT NULL REFERENCES users(id),round_id TEXT NOT NULL,video_index INTEGER NOT NULL,coverage_seconds REAL NOT NULL DEFAULT 0,awarded_xp INTEGER NOT NULL DEFAULT 0,snapshot_json TEXT NOT NULL,PRIMARY KEY(user_id,round_id,video_index));
    CREATE TABLE IF NOT EXISTS gamification_events(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,reference_id TEXT NOT NULL,xp_delta INTEGER NOT NULL DEFAULT 0,payload_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(user_id,kind,reference_id));
    CREATE TRIGGER IF NOT EXISTS gamification_events_no_update BEFORE UPDATE ON gamification_events BEGIN SELECT RAISE(ABORT,'Immutable gamification event'); END;
    CREATE TRIGGER IF NOT EXISTS gamification_events_no_delete BEFORE DELETE ON gamification_events BEGIN SELECT RAISE(ABORT,'Immutable gamification event'); END;
    CREATE INDEX IF NOT EXISTS gamification_events_month ON gamification_events(created_at,kind,user_id);
    CREATE TABLE IF NOT EXISTS gamification_bot_events(id TEXT PRIMARY KEY,event TEXT NOT NULL,user_id TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',created_at TEXT NOT NULL,UNIQUE(event,user_id,id));
    CREATE TABLE IF NOT EXISTS gamification_trials(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),source TEXT NOT NULL,reference_id TEXT NOT NULL UNIQUE,starts_at TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT);
    CREATE TABLE IF NOT EXISTS gamification_booster_claims(user_id TEXT NOT NULL REFERENCES users(id),local_date TEXT NOT NULL,event_id TEXT NOT NULL,PRIMARY KEY(user_id,local_date));
    CREATE TABLE IF NOT EXISTS gamification_months(month TEXT PRIMARY KEY,snapshot_json TEXT NOT NULL,settled_at TEXT);
    CREATE TABLE IF NOT EXISTS gamification_month_prizes(month TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),place INTEGER NOT NULL,xp INTEGER NOT NULL,coins INTEGER NOT NULL,event_id TEXT NOT NULL,PRIMARY KEY(month,place),UNIQUE(month,user_id));
    CREATE TABLE IF NOT EXISTS gamification_redemptions(user_id TEXT NOT NULL REFERENCES users(id),reference_id TEXT NOT NULL,item_code TEXT NOT NULL,price_coins INTEGER NOT NULL,event_id TEXT NOT NULL,PRIMARY KEY(user_id,reference_id));
  `);
  db.prepare("INSERT OR IGNORE INTO gamification_config(id,config_json,updated_at) VALUES(1,?,?)").run(JSON.stringify(DEFAULT_GAMIFICATION_CONFIG),stamp());
}
export function gamificationConfig(db:AppDatabase):GamificationConfig {
  const row=db.prepare("SELECT config_json AS json FROM gamification_config WHERE id=1").get() as {json:string};
  return gamificationConfigSchema.parse(JSON.parse(row.json));
}
export function saveGamificationConfig(db:AppDatabase,raw:unknown,actorId:string) {
  const config=gamificationConfigSchema.parse(raw);
  if(!actorId.trim())fail(400,"Informe quem alterou a configuração.","ACTOR_REQUIRED");
  db.transaction(()=>{
    const now=stamp(),json=JSON.stringify(config);
    db.prepare("UPDATE gamification_config SET config_json=?,updated_at=? WHERE id=1").run(json,now);
    db.prepare("INSERT INTO gamification_config_audit(id,actor_id,config_json,created_at) VALUES(?,?,?,?)").run(randomUUID(),actorId,json,now);
  })();
  return config;
}
export function bahiaClock(now=new Date()) {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Bahia",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",hourCycle:"h23"}).formatToParts(now);
  const read=(kind:string)=>parts.find(p=>p.type===kind)?.value??"";
  const date=read("year")+"-"+read("month")+"-"+read("day");
  return {date,month:date.slice(0,7),friday:read("weekday")==="Fri",hour:Number(read("hour"))};
}
function levelAt(xp:number,curve:GamificationConfig["curve"]) {
  // XP to level L: (L-1)*firstStep + (L-1)*(L-2)/2*increase.
  let steps=curve.stepIncrease===0?Math.floor(xp/curve.firstStep):Math.floor((-(curve.firstStep-curve.stepIncrease/2)+Math.sqrt((curve.firstStep-curve.stepIncrease/2)**2+2*curve.stepIncrease*xp))/curve.stepIncrease);
  steps=Math.max(0,Math.min(10000,steps));
  const threshold=(n:number)=>n*curve.firstStep+n*(n-1)*curve.stepIncrease/2;
  while(steps<10000&&threshold(steps+1)<=xp)steps++;
  while(steps>0&&threshold(steps)>xp)steps--;
  return {level:steps+1,nextLevelXp:threshold(steps+1),levelStartXp:threshold(steps)};
}
function totalXp(db:AppDatabase,id:string) {return (db.prepare("SELECT COALESCE(SUM(xp_delta),0) AS xp FROM gamification_events WHERE user_id=? AND kind='VIDEO_XP'").get(id) as {xp:number}).xp;}
function emit(db:AppDatabase,userId:string,kind:string,referenceId:string,payload:Record<string,unknown>,xp=0) {
  const id=randomUUID(),now=stamp();
  const result=db.prepare("INSERT OR IGNORE INTO gamification_events(id,user_id,kind,reference_id,xp_delta,payload_json,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(id,userId,kind,referenceId,xp,JSON.stringify(payload),now);
  return result.changes?id:undefined;
}
function botEvent(db:AppDatabase,event:string,userId:string,eventId:string,payload:Record<string,unknown>) {
  db.prepare("INSERT OR IGNORE INTO gamification_bot_events(id,event,user_id,payload_json,created_at) VALUES(?,?,?,?,?)")
    .run(eventId,event,userId,JSON.stringify(payload),stamp());
}
function rewardCoins(db:AppDatabase,userId:string,coins:number,reference:string) {
  if(coins<=0)return;
  const inserted=db.prepare("INSERT OR IGNORE INTO wallet_ledger(id,user_id,kind,amount_millis,reference_id,created_at) VALUES(?,?,'GAMIFICATION_REWARD',?,?,?)")
    .run(randomUUID(),userId,coins*1000,reference,stamp());
  if(inserted.changes)db.prepare("UPDATE wallets SET reward_millis=reward_millis+?,updated_at=? WHERE user_id=?").run(coins*1000,stamp(),userId);
}
function trial(db:AppDatabase,userId:string,days:number,reference:string,source:string) {
  db.prepare("INSERT OR IGNORE INTO gamification_trials(id,user_id,source,reference_id,starts_at,expires_at) VALUES(?,?,?,?,?,?)")
    .run(randomUUID(),userId,source,userId+":"+reference,stamp(),new Date(Date.now()+days*86400000).toISOString());
}
export function trialSuperView(db:AppDatabase,userId:string) {
  const row=db.prepare("SELECT MAX(expires_at) AS expiresAt FROM gamification_trials WHERE user_id=? AND revoked_at IS NULL AND starts_at<=? AND expires_at>?")
    .get(userId,stamp(),stamp()) as {expiresAt:string|null};
  return {active:Boolean(row.expiresAt),expiresAt:row.expiresAt??undefined,source:row.expiresAt?"GAMIFICATION_TRIAL":undefined};
}
function grantReward(db:AppDatabase,userId:string,code:DropCode,reference:string,trialDays:number) {
  if(code.startsWith("COINS_"))rewardCoins(db,userId,Number(code.slice(6)),reference);
  else if(code==="SKIP")grantItem(db,{userId,itemCode:"SKIP",delta:1,kind:reference.startsWith("redeem:")?"REWARD_EXCHANGE":"REWARD",referenceId:reference,note:"Recompensa de participação"});
  else if(code==="PASS") {
    const inserted=db.prepare("INSERT OR IGNORE INTO wallet_ledger(id,user_id,kind,amount_millis,reference_id,created_at) VALUES(?,?,'GAMIFICATION_PASS',0,?,?)").run(randomUUID(),userId,reference,stamp());
    if(inserted.changes)db.prepare("UPDATE wallets SET extra_slot_passes=extra_slot_passes+1,updated_at=? WHERE user_id=?").run(stamp(),userId);
  } else trial(db,userId,trialDays,reference,"FRIDAY_BOOSTER");
}
function ensureProfile(db:AppDatabase,userId:string,c:GamificationConfig) {
  db.prepare("INSERT OR IGNORE INTO gamification_users(user_id,curve_json,created_at) VALUES(?,?,?)").run(userId,JSON.stringify(c.curve),stamp());
  return db.prepare("SELECT level,curve_json AS curveJson FROM gamification_users WHERE user_id=?").get(userId) as {level:number;curveJson:string};
}
function coverageOf(raw:string|undefined,index:number,duration:number) {
  let intervals:unknown;
  try {intervals=JSON.parse(raw??"{}")[String(index)];}catch{return 0;}
  if(!Array.isArray(intervals))return 0;
  const ranges=intervals.filter((a):a is number[]=>Array.isArray(a)&&a.length===2&&a.every(n=>typeof n==="number"&&Number.isFinite(n)))
    .map(([a,b])=>[Math.max(0,Math.min(duration,a)),Math.max(0,Math.min(duration,b))]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
  let coverage=0,end=0;
  for(const [a,b]of ranges){coverage+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}
  return coverage;
}
/** Called inside the verified-observation transaction; supplied client totals are intentionally ignored. */
export function recordVerifiedXp(db:AppDatabase,userId:string,roundId:string,videoIndex:number,_coverageSeconds?:number,_duration?:number,allowCoinRewards=true) {
  if(!Number.isInteger(videoIndex)||videoIndex<0||videoIndex>9)fail(400,"Vídeo inválido.","INVALID_VIDEO");
  const c=gamificationConfig(db);
  if(!c.enabled||!c.xpEnabled)return {xpDelta:0,levelRewards:[] as Array<{level:number;coins:number;trialDays:number}>};
  userExists(db,userId);
  // Root access is unlimited and never competes with, or collects progression
  // rewards from, participants. Historical immutable records are retained.
  if(isRootProgress(db,userId))return {xpDelta:0,levelRewards:[] as Array<{level:number;coins:number;trialDays:number}>};
  return db.transaction(()=>{
    const durationRow=db.prepare("SELECT video_duration_seconds AS duration FROM submissions WHERE round_id=? AND slot=?").get(roundId,videoIndex+1) as {duration:number}|undefined;
    const duration=durationRow?.duration;
    if(!duration||!Number.isFinite(duration)||duration<=0)return {xpDelta:0,levelRewards:[] as Array<{level:number;coins:number;trialDays:number}>};
    const progress=db.prepare("SELECT observed_intervals_json AS intervals FROM playlist_watch_progress WHERE user_id=? AND round_id=?").get(userId,roundId) as {intervals:string}|undefined;
    const coverage=coverageOf(progress?.intervals,videoIndex,duration);
    if(coverage<=0)return {xpDelta:0,levelRewards:[] as Array<{level:number;coins:number;trialDays:number}>};
    const profile=ensureProfile(db,userId,c);
    db.prepare("INSERT OR IGNORE INTO gamification_sources(user_id,round_id,video_index,snapshot_json) VALUES(?,?,?,?)")
      .run(userId,roundId,videoIndex,JSON.stringify({xpPerVideo:c.xpPerVideo,duration}));
    const source=db.prepare("SELECT coverage_seconds AS coverage,awarded_xp AS xp,snapshot_json AS snapshot FROM gamification_sources WHERE user_id=? AND round_id=? AND video_index=?").get(userId,roundId,videoIndex) as {coverage:number;xp:number;snapshot:string};
    const snap=JSON.parse(source.snapshot) as {xpPerVideo:number;duration:number};
    const target=Math.floor(Math.min(1,coverage/snap.duration)*snap.xpPerVideo+1e-8);
    const delta=Math.max(0,target-source.xp);
    if(!delta)return {xpDelta:0,levelRewards:[] as Array<{level:number;coins:number;trialDays:number}>};
    emit(db,userId,"VIDEO_XP",roundId+":"+videoIndex+":"+target,{roundId,videoIndex,coverageSeconds:coverage,durationSeconds:snap.duration,xpPerVideo:snap.xpPerVideo},delta);
    db.prepare("UPDATE gamification_sources SET coverage_seconds=MAX(coverage_seconds,?),awarded_xp=? WHERE user_id=? AND round_id=? AND video_index=?").run(coverage,target,userId,roundId,videoIndex);
    const clock=bahiaClock();
    db.prepare("INSERT OR IGNORE INTO gamification_months(month,snapshot_json) VALUES(?,?)").run(clock.month,JSON.stringify({enabled:c.monthlyEnabled,rewards:c.monthlyRewards}));
    const level=levelAt(totalXp(db,userId),JSON.parse(profile.curveJson)).level;
    const levelRewards:Array<{level:number;coins:number;trialDays:number}>=[];
    for(let next=profile.level+1;next<=level;next++){
      const coins=allowCoinRewards?c.levelCoins+(next%c.milestoneEvery===0?c.milestoneCoins:0):0,days=next%c.trialEvery===0?c.trialDays:0;
      const reference="level:"+next,event=emit(db,userId,"LEVEL_UP",reference,{level:next,coins,trialDays:days,config:c});
      if(event){rewardCoins(db,userId,coins,reference);if(days)trial(db,userId,days,reference+":"+userId,"LEVEL_MILESTONE");botEvent(db,"LEVEL_UP",userId,event,{level:next,coins,trialDays:days});levelRewards.push({level:next,coins,trialDays:days});}
    }
    db.prepare("UPDATE gamification_users SET level=MAX(level,?) WHERE user_id=?").run(level,userId);
    return {xpDelta:delta,levelRewards};
  })();
}
export function boosterView(db:AppDatabase,userId:string) {
  const c=gamificationConfig(db),clock=bahiaClock();
  const claim=db.prepare("SELECT e.payload_json AS payload FROM gamification_booster_claims b JOIN gamification_events e ON e.id=b.event_id WHERE b.user_id=? AND b.local_date=?").get(userId,clock.date) as {payload:string}|undefined;
  return {available:!isRootProgress(db,userId)&&c.enabled&&c.boosterEnabled&&clock.friday&&clock.hour>=6&&!claim,claimed:Boolean(claim),date:clock.date,
    timeZone:"America/Bahia",windowEndsAt:clock.date+"T23:59:59.999-03:00",opensAt:"sexta-feira às 06:00",closesAt:"sexta-feira às 23:59",reward:claim?JSON.parse(claim.payload):undefined,
    odds:c.boosterDrops.map(d=>({...d,probabilityPercent:d.weight/100}))};
}
export function claimBooster(db:AppDatabase,userId:string) {
  userExists(db,userId);
  if(isRootProgress(db,userId))fail(409,"Sua conta administrativa já tem acesso ilimitado aos itens. O Booster é dedicado aos participantes.","ADMINISTRATIVE_ACCESS");
  return db.transaction(()=>{
    const view=boosterView(db,userId),c=gamificationConfig(db);
    if(view.claimed)return {replayed:true,reward:view.reward};
    if(!view.available)fail(409,"O Booster abre nas sextas-feiras, das 06h até o fim do dia.","BOOSTER_UNAVAILABLE");
    const draw=randomInt(10000);let cursor=0;
    const drop=c.boosterDrops.find(d=>{cursor+=d.weight;return draw<cursor;})!;
    const reward={code:drop.code,coins:drop.code.startsWith("COINS_")?Number(drop.code.slice(6)):0,quantity:drop.code==="SKIP"||drop.code==="PASS"?1:0,trialDays:drop.code==="SUPER_TRIAL"?c.trialDays:0,date:view.date,odds:c.boosterDrops};
    const reference="booster:"+view.date,event=emit(db,userId,"BOOSTER",reference,reward)!;
    grantReward(db,userId,drop.code,reference,c.trialDays);
    db.prepare("INSERT INTO gamification_booster_claims(user_id,local_date,event_id) VALUES(?,?,?)").run(userId,view.date,event);
    botEvent(db,"BOOSTER_CLAIMED",userId,event,reward);
    return {replayed:false,reward};
  })();
}
export function redeemRewardItem(db:AppDatabase,userId:string,itemCode:"SKIP"|"PASS",referenceId:string) {
  userExists(db,userId);
  if(isRootProgress(db,userId))fail(409,"Sua conta administrativa já tem acesso ilimitado aos itens.","ADMINISTRATIVE_ACCESS");
  z.string().uuid().parse(referenceId);
  if(itemCode!=="SKIP"&&itemCode!=="PASS")fail(400,"Escolha Pular ou Passe.","INVALID_REDEMPTION");
  return db.transaction(()=>{
    const old=db.prepare("SELECT item_code AS itemCode,price_coins AS price FROM gamification_redemptions WHERE user_id=? AND reference_id=?").get(userId,referenceId) as {itemCode:string;price:number}|undefined;
    if(old){if(old.itemCode!==itemCode)fail(409,"Esta troca já foi registrada para outro item.","REFERENCE_CONFLICT");return {...old,replayed:true};}
    const c=gamificationConfig(db);
    if(!c.enabled||!c.redeemEnabled)fail(409,"As trocas estão pausadas.","REDEMPTION_DISABLED");
    const price=c.redeemPrices[itemCode],now=stamp();
    const debit=db.prepare("UPDATE wallets SET reward_millis=reward_millis-?,updated_at=? WHERE user_id=? AND reward_millis>=?").run(price*1000,now,userId,price*1000);
    if(!debit.changes)fail(409,"Você precisa de mais moedas de recompensa para esta troca.","REWARD_COINS_INSUFFICIENT");
    db.prepare("INSERT INTO wallet_ledger(id,user_id,kind,amount_millis,reference_id,created_at) VALUES(?,?,'REWARD_REDEMPTION',?,?,?)").run(randomUUID(),userId,-price*1000,referenceId,now);
    grantReward(db,userId,itemCode,"redeem:"+referenceId,c.trialDays);
    const event=emit(db,userId,"REDEEM",referenceId,{itemCode,priceCoins:price})!;
    db.prepare("INSERT INTO gamification_redemptions(user_id,reference_id,item_code,price_coins,event_id) VALUES(?,?,?,?,?)").run(userId,referenceId,itemCode,price,event);
    botEvent(db,"REWARD_REDEEMED",userId,event,{itemCode,priceCoins:price});
    return {itemCode,price,replayed:false};
  })();
}
function monthlyRows(db:AppDatabase,month:string) {
  return db.prepare(`SELECT u.id AS userId,u.name,SUM(e.xp_delta) AS xp,MAX(e.created_at) AS reachedAt
    FROM gamification_events e JOIN users u ON u.id=e.user_id WHERE e.kind='VIDEO_XP' AND u.deleted_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM owner_access oa WHERE oa.user_id=u.id AND oa.active=1)
    AND substr(datetime(e.created_at,'-3 hours'),1,7)=? GROUP BY u.id HAVING xp>0 ORDER BY xp DESC,reachedAt ASC,u.id ASC`).all(month) as Array<{userId:string;name:string;xp:number;reachedAt:string}>;
}
export function leaderboards(db:AppDatabase) {
  const permanent=db.prepare(`SELECT u.id AS userId,u.name,SUM(e.xp_delta) AS xp,MAX(e.created_at) AS reachedAt
    FROM gamification_events e JOIN users u ON u.id=e.user_id WHERE e.kind='VIDEO_XP' AND u.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM owner_access oa WHERE oa.user_id=u.id AND oa.active=1)
    GROUP BY u.id HAVING xp>0 ORDER BY xp DESC,reachedAt ASC,u.id ASC`).all() as Array<{userId:string;name:string;xp:number;reachedAt:string}>;
  return {month:bahiaClock().month,monthly:monthlyRows(db,bahiaClock().month).slice(0,100),permanent:permanent.map(row=>{
    const profile=db.prepare("SELECT curve_json AS curve FROM gamification_users WHERE user_id=?").get(row.userId) as {curve:string};
    return {...row,level:levelAt(row.xp,JSON.parse(profile.curve)).level};
  }).sort((a,b)=>b.level-a.level||b.xp-a.xp||a.reachedAt.localeCompare(b.reachedAt)||a.userId.localeCompare(b.userId)).slice(0,100)};
}
export function settleClosedMonths(db:AppDatabase) {
  const month=bahiaClock().month;
  const c=gamificationConfig(db);
  if(!c.enabled||!c.monthlyEnabled)return {paid:[] as Array<{month:string;userId:string;place:number;coins:number}>};
  return db.transaction(()=>{
    const pending=db.prepare("SELECT month,snapshot_json AS snapshot FROM gamification_months WHERE month<? AND settled_at IS NULL ORDER BY month").all(month) as Array<{month:string;snapshot:string}>;
    const paid:Array<{month:string;userId:string;place:number;coins:number}>=[];
    for(const entry of pending) {
      const snapshot=JSON.parse(entry.snapshot) as {enabled:boolean;rewards:number[]};
      if(snapshot.enabled) for(const [index,row]of monthlyRows(db,entry.month).slice(0,3).entries()){
        const coins=snapshot.rewards[index],place=index+1,reference="monthly:"+entry.month+":"+place;
        const event=emit(db,row.userId,"MONTHLY_PRIZE",reference,{month:entry.month,place,xp:row.xp,coins})!;
        rewardCoins(db,row.userId,coins,reference);
        db.prepare("INSERT INTO gamification_month_prizes(month,user_id,place,xp,coins,event_id) VALUES(?,?,?,?,?,?)").run(entry.month,row.userId,place,row.xp,coins,event);
        botEvent(db,"MONTHLY_TOP",row.userId,event,{month:entry.month,place,xp:row.xp,coins});paid.push({month:entry.month,userId:row.userId,place,coins});
      }
      db.prepare("UPDATE gamification_months SET settled_at=? WHERE month=?").run(stamp(),entry.month);
    }
    return {paid};
  })();
}
/** Lightweight public presentation; no wallet, claim state or personal event history. */
export function gamificationProgress(db:AppDatabase,userId:string):GamificationProgress {
  // JSON carries explicit administrative access, never numeric Infinity or a
  // counterfeit participant level. Promotion does not destroy prior history.
  if(isRootProgress(db,userId))return {administrative:true,unlimitedXp:true,xp:null,level:null,nextLevelXp:null,levelStartXp:null};
  const xp=totalXp(db,userId);
  const profile=db.prepare("SELECT curve_json AS curve,level FROM gamification_users WHERE user_id=?").get(userId) as {curve:string;level:number}|undefined;
  const curve=profile?JSON.parse(profile.curve):gamificationConfig(db).curve;
  const progress=levelAt(xp,curve);
  return {administrative:false,unlimitedXp:false,xp,level:Math.max(profile?.level??1,progress.level),nextLevelXp:progress.nextLevelXp,levelStartXp:progress.levelStartXp};
}
export function gamificationView(db:AppDatabase,userId:string) {
  userExists(db,userId);
  const c=gamificationConfig(db),progress=gamificationProgress(db,userId);
  const wallet=db.prepare("SELECT reward_millis AS rewards FROM wallets WHERE user_id=?").get(userId) as {rewards:number};
  return {enabled:c.enabled,...progress,
    rewardCoins:wallet.rewards/1000,redeemPrices:c.redeemPrices,trial:trialSuperView(db,userId),booster:boosterView(db,userId),
    history:db.prepare("SELECT id,kind,xp_delta AS xpDelta,payload_json AS payload,created_at AS createdAt FROM gamification_events WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50").all(userId)
      .map(row=>{const r=row as {id:string;kind:string;xpDelta:number;payload:string;createdAt:string};return {...r,payload:JSON.parse(r.payload)};})};
}

/** Transfers earned coins only, with durable provenance on both sides. */
export function giftRewardCoins(db:AppDatabase,fromUserId:string,toUserId:string,coins:number,referenceId:string) {
  userExists(db,fromUserId);userExists(db,toUserId);z.string().uuid().parse(referenceId);
  if(fromUserId===toUserId)fail(400,"Escolha outra pessoa para presentear.","SELF_GIFT");
  if(!Number.isInteger(coins)||coins<1||coins>10000)fail(400,"Informe uma quantidade inteira de moedas.","INVALID_GIFT");
  return db.transaction(()=>{
    const previous=db.prepare("SELECT payload_json AS payload FROM gamification_events WHERE user_id=? AND kind='REWARD_GIFT_OUT' AND reference_id=?").get(fromUserId,referenceId) as {payload:string}|undefined;
    if(previous) {
      const data=JSON.parse(previous.payload) as {toUserId:string;coins:number};
      if(data.toUserId!==toUserId||data.coins!==coins)fail(409,"Este presente já foi registrado com outros dados.","REFERENCE_CONFLICT");
      return {toUserId,coins,replayed:true};
    }
    assertSocialInteractionAllowed(db,fromUserId,toUserId);
    const hold=db.prepare("SELECT payment_hold AS hold FROM wallets WHERE user_id=?").get(fromUserId) as {hold:number}|undefined;
    if(hold?.hold)fail(409,"Sua carteira está em revisão.","PAYMENT_HOLD");
    const now=stamp(),amount=coins*1000;
    const debit=db.prepare("UPDATE wallets SET reward_millis=reward_millis-?,updated_at=? WHERE user_id=? AND reward_millis>=?").run(amount,now,fromUserId,amount);
    if(!debit.changes)fail(409,"Você precisa de mais moedas de recompensa para presentear.","REWARD_COINS_INSUFFICIENT");
    db.prepare("UPDATE wallets SET reward_millis=reward_millis+?,updated_at=? WHERE user_id=?").run(amount,now,toUserId);
    for(const [id,kind,delta]of [[fromUserId,"REWARD_GIFT_OUT",-amount],[toUserId,"REWARD_GIFT_IN",amount]] as const)
      db.prepare("INSERT INTO wallet_ledger(id,user_id,kind,amount_millis,reference_id,created_at) VALUES(?,?,?,?,?,?)").run(randomUUID(),id,kind,delta,fromUserId+":"+referenceId,now);
    const event=emit(db,fromUserId,"REWARD_GIFT_OUT",referenceId,{toUserId,coins})!;
    emit(db,toUserId,"REWARD_GIFT_IN",fromUserId+":"+referenceId,{fromUserId,coins});
    botEvent(db,"REWARD_COINS_GIFTED",toUserId,event,{fromUserId,coins});
    return {toUserId,coins,replayed:false};
  })();
}
