import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { encryptToken } from "./youtube.js";
import { normalizePhone } from "./phone.js";

describe("tempo verificado de acompanhamento",()=>{
  let db:AppDatabase;
  let app:Awaited<ReturnType<typeof buildApp>>;
  let config:Config;

  beforeEach(async()=>{
    config=loadConfig({
      REQUIRE_GROUP_MEMBERSHIP:"false",NODE_ENV:"test",DATABASE_PATH:":memory:",AUTH_DEV_MODE:"true",PAYMENTS_DEV_MODE:"true",
      JWT_SECRET:"watch-time-test-secret-32-characters",AUTH_CODE_PEPPER:"watch-time-pepper",
      GOOGLE_CLIENT_ID:"test-client",GOOGLE_CLIENT_SECRET:"test-secret",
      YOUTUBE_API_KEY:undefined,MERCADO_PAGO_ACCESS_TOKEN:undefined,MERCADO_PAGO_WEBHOOK_SECRET:"test-webhook"
    });
    db=createDatabase(":memory:");
    app=await buildApp(config,db);
  });
  afterEach(async()=>{await app.close();db.close();});

  const auth=(token:string)=>({authorization:`Bearer ${token}`});

  async function register(phone="71999999111"){
    const normalized=normalizePhone(phone),stamp=new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO groups(code,enabled,membership_mode) VALUES ('12',1,'OWNER')").run();
    db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES (?,'12',?,'TEST')").run(normalized,stamp);
    const requested=await app.inject({method:"POST",url:"/auth/request-code",payload:{name:"Pessoa Tempo",phone}});
    const verified=await app.inject({method:"POST",url:"/auth/verify",payload:{phone,code:requested.json().devCode}});
    expect(verified.statusCode).toBe(200);
    return {token:verified.json().token as string,userId:verified.json().user.id as string};
  }

  async function readyRound(userId:string){
    const round=db.prepare("SELECT id FROM rounds WHERE status='OPEN'").get() as {id:string};
    const stamp=new Date().toISOString();
    for(let slot=1;slot<=10;slot++) db.prepare(
      "INSERT INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,created_at) VALUES (?,?,?,?,?,?,?)"
    ).run(randomUUID(),round.id,slot,userId,`https://youtu.be/time${String(slot).padStart(7,"0")}`,`time${String(slot).padStart(7,"0")}`,stamp);
    db.prepare("UPDATE rounds SET status='READY',completed_at=? WHERE id=?").run(stamp,round.id);
    db.prepare("INSERT INTO youtube_connections(user_id,refresh_token_cipher,scope,updated_at) VALUES (?,?,?,?)")
      .run(userId,encryptToken("refresh",config),"youtube",stamp);
    db.prepare("INSERT INTO playlist_exports(id,round_id,user_id,youtube_playlist_id,status,added_count,created_at,updated_at) VALUES (?,?,?,?, 'SUCCESS',10,?,?)")
      .run(randomUUID(),round.id,userId,"playlist-time",stamp,stamp);
    return round.id;
  }

  async function observe(token:string,roundId:string,body:{sessionId:string;videoIndex:number;playerSeconds:number;duration:number;playbackRate:number;playing:boolean;visible:boolean}){
    return app.inject({method:"POST",url:`/rounds/${roundId}/watch-observation`,headers:auth(token),payload:body});
  }

  function ageState(userId:string,millis:number){
    db.prepare("UPDATE watch_observation_state SET observed_at=? WHERE user_id=?")
      .run(new Date(Date.now()-millis).toISOString(),userId);
  }

  it("usa relógio do servidor, rejeita seek e não conta trecho repetido",async()=>{
    const user=await register(),roundId=await readyRound(user.userId),sessionId=randomUUID();
    const base={sessionId,videoIndex:0,duration:100,playbackRate:1,playing:true,visible:true};

    const seed=await observe(user.token,roundId,{...base,playerSeconds:0});
    expect(seed.statusCode).toBe(200);
    expect(seed.json().acceptedSeconds).toBe(0);

    ageState(user.userId,5000);
    const natural=await observe(user.token,roundId,{...base,playerSeconds:5});
    expect(natural.statusCode).toBe(200);
    expect(natural.json().acceptedSeconds).toBeGreaterThan(4);
    expect(natural.json().acceptedSeconds).toBeLessThanOrEqual(5.2);
    expect(natural.json().verifiedSeconds).toBeGreaterThanOrEqual(4);

    ageState(user.userId,5000);
    const duplicate=await observe(user.token,roundId,{...base,playerSeconds:5});
    expect(duplicate.json().acceptedSeconds).toBe(0);

    ageState(user.userId,5000);
    const rewind=await observe(user.token,roundId,{...base,playerSeconds:0});
    expect(rewind.json().acceptedSeconds).toBe(0);
    ageState(user.userId,5000);
    const replay=await observe(user.token,roundId,{...base,playerSeconds:5});
    expect(replay.json().acceptedSeconds).toBe(0);

    ageState(user.userId,5000);
    const seek=await observe(user.token,roundId,{...base,playerSeconds:50});
    expect(seek.json().acceptedSeconds).toBe(0);
  });

  it("impede duas sessões simultâneas para o mesmo usuário",async()=>{
    const user=await register("71999999112"),roundId=await readyRound(user.userId);
    const first=randomUUID(),second=randomUUID();
    await observe(user.token,roundId,{sessionId:first,videoIndex:0,playerSeconds:0,duration:100,playbackRate:1,playing:true,visible:true});
    const conflict=await observe(user.token,roundId,{sessionId:second,videoIndex:0,playerSeconds:1,duration:100,playbackRate:1,playing:true,visible:true});
    expect(conflict.statusCode).toBe(200);
    expect(conflict.json()).toMatchObject({sessionConflict:true,acceptedSeconds:0});
    expect((db.prepare("SELECT session_id AS sessionId FROM watch_observation_state WHERE user_id=?").get(user.userId) as {sessionId:string}).sessionId).toBe(first);
  });

  it("concede uma moeda somente ao cruzar 20 minutos globais verificados e mantém ledger idempotente",async()=>{
    const user=await register("71999999113"),roundId=await readyRound(user.userId),sessionId=randomUUID();
    const base={sessionId,videoIndex:0,duration:300,playbackRate:1,playing:true,visible:true};
    await observe(user.token,roundId,{...base,playerSeconds:0});
    db.prepare("INSERT OR REPLACE INTO watch_time_totals(user_id,verified_millis,rewarded_coins,updated_at) VALUES (?,?,0,?)")
      .run(user.userId,1_190_000,new Date().toISOString());
    ageState(user.userId,11_000);
    const crossed=await observe(user.token,roundId,{...base,playerSeconds:11});
    expect(crossed.statusCode).toBe(200);
    expect(crossed.json().rewardDeltaCoins).toBe(1);
    expect(crossed.json().rewardCoins).toBe(1);
    expect(crossed.json().walletTotal).toBe(11);
    expect((db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE user_id=? AND kind='WATCH_TIME'").get(user.userId) as {n:number}).n).toBe(1);

    ageState(user.userId,5000);
    const noSecond=await observe(user.token,roundId,{...base,playerSeconds:16});
    expect(noSecond.json().rewardDeltaCoins).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE user_id=? AND kind='WATCH_TIME'").get(user.userId) as {n:number}).n).toBe(1);
  });

  it("não converte moedas WATCH_PROGRESS antigas em minutos verificados",async()=>{
    const user=await register("71999999114");
    db.prepare("INSERT INTO wallet_ledger(id,user_id,kind,amount_millis,reference_id,created_at) VALUES (?,?, 'WATCH_PROGRESS',1000,'legacy:1',?)")
      .run(randomUUID(),user.userId,new Date().toISOString());
    db.prepare("UPDATE wallets SET reward_millis=reward_millis+1000 WHERE user_id=?").run(user.userId);
    const dashboard=await app.inject({method:"GET",url:"/dashboard",headers:auth(user.token)});
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().wallet.reward).toBe(1);
    expect(dashboard.json().watchRewards).toEqual({verifiedSeconds:0,coins:0,secondsToNextReward:1200});
  });
  it("percentual legado de 100% não vira conclusão validada na primeira observação",async()=>{
    const user=await register("71999999115"),roundId=await readyRound(user.userId);
    const legacy=await app.inject({method:"PUT",url:`/rounds/${roundId}/watch-progress`,headers:auth(user.token),payload:{watchedSeconds:Array(10).fill(100),durations:Array(10).fill(100)}});
    expect(legacy.statusCode).toBe(200);
    const observation=await observe(user.token,roundId,{sessionId:randomUUID(),videoIndex:0,playerSeconds:0,duration:100,playbackRate:1,playing:true,visible:true});
    expect(observation.json().acceptedSeconds).toBe(0);
    expect(observation.json().finalizedAt).toBeUndefined();
    expect(observation.json().cooldownUntil).toBeUndefined();
    expect((db.prepare("SELECT finalized_at FROM playlist_watch_progress WHERE round_id=? AND user_id=?").get(roundId,user.userId) as {finalized_at:string|null}).finalized_at).toBeNull();
  });

  it("retomar após amostra pausada ou oculta ancora novamente sem premiar o intervalo",async()=>{
    const user=await register("71999999116"),roundId=await readyRound(user.userId),sessionId=randomUUID();
    const base={sessionId,videoIndex:0,duration:100,playbackRate:1,playing:true,visible:true};
    await observe(user.token,roundId,{...base,playerSeconds:0,playing:false});
    ageState(user.userId,5000);
    const resumed=await observe(user.token,roundId,{...base,playerSeconds:5});
    expect(resumed.json().acceptedSeconds).toBe(0);
    ageState(user.userId,5000);
    expect((await observe(user.token,roundId,{...base,playerSeconds:10})).json().acceptedSeconds).toBeGreaterThan(4);
    await observe(user.token,roundId,{...base,playerSeconds:10,visible:false});
    ageState(user.userId,5000);
    expect((await observe(user.token,roundId,{...base,playerSeconds:15})).json().acceptedSeconds).toBe(0);
  });

  it("a última observação natural conclui a fila somente com cobertura dos dez vídeos",async()=>{
    const user=await register("71999999117"),roundId=await readyRound(user.userId),sessionId=randomUUID();
    const base={sessionId,videoIndex:9,duration:10,playbackRate:1,playing:true,visible:true};
    await observe(user.token,roundId,{...base,playerSeconds:0});
    const intervals=Object.fromEntries(Array.from({length:9},(_,index)=>[String(index),[[0,10]]]));
    db.prepare("UPDATE playlist_watch_progress SET observed_intervals_json=?,watched_seconds_json=?,durations_json=?,percent=90 WHERE round_id=? AND user_id=?")
      .run(JSON.stringify(intervals),JSON.stringify([...Array(9).fill(10),0]),JSON.stringify(Array(10).fill(10)),roundId,user.userId);
    ageState(user.userId,10_000);
    const end=await observe(user.token,roundId,{...base,playerSeconds:10,playing:false});
    expect(end.json().acceptedSeconds).toBe(10);
    expect(end.json().percent).toBe(100);
    expect(end.json().finalizedAt).toBeTruthy();
    expect(end.json().cooldownUntil).toBeTruthy();
    expect(end.json().rewardDeltaCoins).toBe(0); // 10 seconds are not 20 minutes.
  });

});
