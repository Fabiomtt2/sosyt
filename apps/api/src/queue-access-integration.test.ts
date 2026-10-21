import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { grantItem, ITEM_SKIP, itemQuantity } from "./inventory.js";
import { joinRound, openRound } from "./queues.js";
import { hasActiveRoundTask } from "./active-access.js";
import { normalizePhone } from "./phone.js";
import { encryptToken } from "./youtube.js";

describe("contratos HTTP de acesso às filas independentes", () => {
  let db: AppDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let config: Config;
  const stamp = () => new Date().toISOString();
  const auth = (token: string) => ({ authorization: "Bearer " + token });

  beforeEach(async () => {
    config = loadConfig({
      NODE_ENV: "test", DATABASE_PATH: ":memory:", AUTH_DEV_MODE: "true",
      REQUIRE_GROUP_MEMBERSHIP: "false", PAYMENTS_DEV_MODE: "true",
      JWT_SECRET: "queue-integration-secret-32-characters",
      AUTH_CODE_PEPPER: "queue-integration-pepper-32-characters",
      GOOGLE_CLIENT_ID: "synthetic-google-client", GOOGLE_CLIENT_SECRET: "synthetic-google-secret",
      YOUTUBE_API_KEY: undefined
    });
    db = createDatabase(":memory:");
    app = await buildApp(config, db);
  });
  afterEach(async () => { vi.unstubAllGlobals(); await app.close(); db.close(); });

  async function register() {
    const phone = "71991000101", normalized = normalizePhone(phone);
    db.prepare("INSERT OR IGNORE INTO groups(code,enabled,membership_mode) VALUES ('12',1,'OWNER')").run();
    db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES (?,'12',?,'TEST')")
      .run(normalized, stamp());
    const requested = await app.inject({ method: "POST", url: "/auth/request-code", payload: { name: "Participante Sintetico", phone } });
    expect(requested.statusCode, requested.body).toBe(200);
    const verified = await app.inject({ method: "POST", url: "/auth/verify", payload: { phone, code: requested.json().devCode } });
    expect(verified.statusCode, verified.body).toBe(200);
    return { id: verified.json().user.id as string, token: verified.json().token as string };
  }
  function cooldown(userId: string) {
    db.prepare("UPDATE users SET cooldown_until=?,cooldown_reason='Teste de intervalo' WHERE id=?")
      .run(new Date(Date.now() + 1_800_000).toISOString(), userId);
  }
  function ready(roundId: string, userId: string) {
    // Estado anterior legítimo de uma fila completa: dez autores distintos.
    for (let slot = 1; slot <= 10; slot++) {
      const author = slot === 1 ? userId : randomUUID();
      if (slot !== 1) db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES (?,?,?,'12',?,?)")
        .run(author, "Autor Sintetico " + slot, "seed-" + author, stamp(), stamp());
      db.prepare("INSERT INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,created_at,video_duration_seconds) VALUES (?,?,?,?,?,?,?,100)")
        .run(randomUUID(), roundId, slot, author, "https://youtu.be/test" + String(slot).padStart(7, "0"), "test" + String(slot).padStart(7, "0"), stamp());
      if (slot !== 1) joinRound(db, roundId, author, "FREE");
    }
    db.prepare("UPDATE rounds SET status='READY',completed_at=? WHERE id=?").run(stamp(), roundId);
    db.prepare("INSERT OR IGNORE INTO youtube_connections(user_id,refresh_token_cipher,scope,updated_at) VALUES (?,?,?,?)")
      .run(userId, encryptToken("synthetic-refresh", config), "youtube", stamp());
    db.prepare("INSERT INTO playlist_exports(id,round_id,user_id,youtube_playlist_id,status,added_count,created_at,updated_at) VALUES (?,?,?,'synthetic-playlist','SUCCESS',10,?,?)")
      .run(randomUUID(), roundId, userId, stamp(), stamp());
  }
  const observation = () => ({ sessionId: randomUUID(), videoIndex: 0, playerSeconds: 0, duration: 100, playbackRate: 1, playing: true, visible: true });
  const progress = () => ({ watchedSeconds: Array(10).fill(0), durations: Array(10).fill(100) });
  function ledgerCount(userId: string) {
    return (db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE user_id=?").get(userId) as { n: number }).n;
  }

  it.each(["FREE", "PASS"] as const)("concluir %s mantém a outra inscrição, histórico e acompanhamento acessíveis", async (completedSource) => {
    const user = await register();
    const first = (db.prepare("SELECT id FROM rounds WHERE status='OPEN' ORDER BY sequence LIMIT 1").get() as { id: string }).id;
    joinRound(db, first, user.id, "FREE");
    db.prepare("UPDATE wallets SET extra_slot_passes=1 WHERE user_id=?").run(user.id);
    const bought = await app.inject({ method: "POST", url: "/queues/pass", headers: auth(user.token), payload: { referenceId: randomUUID() } });
    expect(bought.statusCode, bought.body).toBe(200);
    const second = bought.json().queue.id as string;
    expect(second).not.toBe(first);
    ready(first, user.id); ready(second, user.id);
    const completed = completedSource === "FREE" ? first : second;
    const remaining = completed === first ? second : first;
    const finished = await app.inject({ method: "POST", url: "/rounds/" + completed + "/watch-progress/finalize", headers: auth(user.token) });
    expect(finished.statusCode, finished.body).toBe(200);
    expect(finished.json().cooldownUntil).toBeTruthy();
    const beforeLedger = ledgerCount(user.id);
    for (const url of ["/dashboard", "/queues/mine", "/chat/global", "/gamification/me"]) {
      const response = await app.inject({ url, headers: auth(user.token) });
      expect(response.statusCode, url + ": " + response.body).toBe(200);
    }
    const mine = await app.inject({ url: "/queues/mine", headers: auth(user.token) });
    expect(mine.json().queues.map((q: { id: string }) => q.id)).toContain(remaining);
    expect(mine.json().queues.map((q: { id: string }) => q.id)).not.toContain(completed);
    const observed = await app.inject({ method: "POST", url: "/rounds/" + remaining + "/watch-observation", headers: auth(user.token), payload: observation() });
    expect(observed.statusCode, observed.body).toBe(200);
    const saved = await app.inject({ method: "PUT", url: "/rounds/" + remaining + "/watch-progress", headers: auth(user.token), payload: progress() });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE round_id=?").get(completed)).toEqual({ n: 10 });
    expect(db.prepare("SELECT finalized_at FROM playlist_watch_progress WHERE round_id=? AND user_id=?").get(completed, user.id)).toMatchObject({ finalized_at: expect.any(String) });
    expect(ledgerCount(user.id)).toBe(beforeLedger); // zero-second observations cannot mint a reward.
    expect(db.prepare("SELECT source FROM round_participants WHERE round_id=? AND user_id=?").get(second, user.id)).toEqual({ source: "PASS" });
  });

  it.each(["pass", "skip"] as const)("%s durante intervalo consome uma vez, sem ingresso FREE implícito ou ressurreição no replay", async (method) => {
    const user = await register(); cooldown(user.id);
    // Login de fixture pode ter uma inscrição FREE; ela foi abandonada anteriormente.
    db.prepare("UPDATE round_participants SET left_at=? WHERE user_id=?").run(stamp(), user.id);
    db.prepare("UPDATE wallets SET extra_slot_passes=1 WHERE user_id=?").run(user.id);
    grantItem(db, { userId: user.id, itemCode: ITEM_SKIP, delta: 1, kind: "OWNER_ADJUST" });
    const activeRows = () => db.prepare("SELECT COUNT(*) AS n FROM round_participants WHERE user_id=? AND left_at IS NULL").get(user.id);
    expect(activeRows()).toEqual({ n: 0 });
    const referenceId = randomUUID();
    const request = () => app.inject({ method: "POST", url: "/queues/" + method, headers: auth(user.token), payload: { referenceId } });
    const first = await request(); expect(first.statusCode, first.body).toBe(200);
    const roundId = first.json().queue.id as string;
    expect(db.prepare("SELECT source,left_at FROM round_participants WHERE round_id=? AND user_id=?").get(roundId, user.id))
      .toEqual({ source: method.toUpperCase(), left_at: null });
    expect(activeRows()).toEqual({ n: 1 });
    expect((await request()).json().queue.id).toBe(roundId);
    const quantity = () => method === "skip" ? itemQuantity(db, user.id, ITEM_SKIP) :
      (db.prepare("SELECT extra_slot_passes AS n FROM wallets WHERE user_id=?").get(user.id) as { n: number }).n;
    expect(quantity()).toBe(0);
    const leftAt = stamp();
    db.prepare("UPDATE round_participants SET left_at=? WHERE round_id=? AND user_id=?").run(leftAt, roundId, user.id);
    db.prepare("UPDATE rounds SET closed_at=? WHERE id=?").run(leftAt, roundId);
    const replay = await request(); expect(replay.statusCode, replay.body).toBe(200);
    expect(db.prepare("SELECT left_at FROM round_participants WHERE round_id=? AND user_id=?").get(roundId, user.id)).toEqual({ left_at: leftAt });
    expect(quantity()).toBe(0);
    expect(activeRows()).toEqual({ n: 0 });
  });

  it.each(["left", "closed", "finalized"] as const)("%s não autoriza watch, conexão ou exportação pela contribuição histórica", async (state) => {
    const user = await register(), roundId = openRound(db);
    joinRound(db, roundId, user.id, "FREE"); ready(roundId, user.id);
    await app.inject({ method: "PUT", url: "/rounds/" + roundId + "/watch-progress", headers: auth(user.token), payload: progress() });
    if (state === "left") db.prepare("UPDATE round_participants SET left_at=? WHERE round_id=? AND user_id=?").run(stamp(), roundId, user.id);
    if (state === "closed") db.prepare("UPDATE rounds SET closed_at=? WHERE id=?").run(stamp(), roundId);
    if (state === "finalized") db.prepare("UPDATE playlist_watch_progress SET finalized_at=?,finalize_reason='MANUAL' WHERE round_id=? AND user_id=?").run(stamp(), roundId, user.id);
    const fetch = vi.fn(() => { throw new Error("Nenhuma chamada externa é autorizada neste cenário."); });
    vi.stubGlobal("fetch", fetch);
    const beforeLedger = ledgerCount(user.id);
    const requests = [
      { method: "GET" as const, url: "/youtube/connect?roundId=" + roundId },
      { method: "POST" as const, url: "/rounds/" + roundId + "/export" },
      { method: "POST" as const, url: "/rounds/" + roundId + "/watch-observation", payload: observation() },
      { method: "PUT" as const, url: "/rounds/" + roundId + "/watch-progress", payload: progress() }
    ];
    for (const request of requests) {
      const response = await app.inject({ ...request, headers: auth(user.token) });
      expect([403, 409], request.url + ": " + response.body).toContain(response.statusCode);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(ledgerCount(user.id)).toBe(beforeLedger);
    expect(db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE round_id=?").get(roundId)).toEqual({ n: 10 });
    expect(db.prepare("SELECT status FROM playlist_exports WHERE round_id=? AND user_id=?").get(roundId, user.id)).toEqual({ status: "SUCCESS" });
  });

  it.each(["left", "closed", "finalized"] as const)("OAuth iniciado antes de %s revalida a permissão antes da troca externa", async (state) => {
    const user = await register(), roundId = openRound(db);
    joinRound(db, roundId, user.id, "FREE"); ready(roundId, user.id);
    const started = await app.inject({ url: "/youtube/connect?roundId=" + roundId, headers: auth(user.token) });
    expect(started.statusCode, started.body).toBe(200);
    const oauthState = new URL(started.json().url).searchParams.get("state");
    expect(oauthState).toBeTruthy();
    if (state === "left") db.prepare("UPDATE round_participants SET left_at=? WHERE round_id=? AND user_id=?").run(stamp(), roundId, user.id);
    if (state === "closed") db.prepare("UPDATE rounds SET closed_at=? WHERE id=?").run(stamp(), roundId);
    if (state === "finalized") db.prepare("INSERT INTO playlist_watch_progress(round_id,user_id,watched_seconds_json,durations_json,percent,updated_at,finalized_at) VALUES (?,?,?, ?,0,?,?)")
      .run(roundId, user.id, JSON.stringify(Array(10).fill(0)), JSON.stringify(Array(10).fill(100)), stamp(), stamp());
    const fetch = vi.fn(() => { throw new Error("Uma autorização revogada não pode trocar o código OAuth."); });
    vi.stubGlobal("fetch", fetch);
    const callback = await app.inject({ url: "/youtube/callback?code=synthetic-code&state=" + encodeURIComponent(oauthState!) });
    expect(callback.statusCode, callback.body).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    const replay = await app.inject({ url: "/youtube/callback?code=synthetic-code&state=" + encodeURIComponent(oauthState!) });
    expect([400, 403, 409]).toContain(replay.statusCode);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("intervalo protege novo ingresso FREE sem debitar saldo ou criar participação; após expirar libera", async () => {
    const user = await register();
    db.prepare("UPDATE round_participants SET left_at=? WHERE user_id=?").run(stamp(), user.id);
    const target = (db.prepare("SELECT id FROM rounds WHERE status='OPEN' AND closed_at IS NULL ORDER BY display_number,sequence LIMIT 1").get() as { id: string }).id;
    cooldown(user.id);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ title: "Vídeo sintético", author_name: "Canal de teste" }), { status: 200, headers: { "content-type": "application/json" } })));
    const snapshot = () => ({
      ledger: db.prepare("SELECT id,kind,amount_millis,reference_id FROM wallet_ledger WHERE user_id=? ORDER BY id").all(user.id),
      wallet: db.prepare("SELECT promo_millis,purchased_millis,reward_millis,extra_slot_passes FROM wallets WHERE user_id=?").get(user.id)
    });
    const before = snapshot();
    const count = db.prepare("SELECT COUNT(*) AS n FROM round_participants WHERE user_id=?").get(user.id);
    const submit = () => app.inject({ method: "POST", url: "/rounds/current/submissions", headers: auth(user.token), payload: { url: "https://youtu.be/abcdefghijk", expectedRoundId: target } });
    const blocked = await submit();
    expect(blocked.statusCode, blocked.body).toBe(423);
    expect(snapshot()).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM round_participants WHERE user_id=?").get(user.id)).toEqual(count);
    expect(db.prepare("SELECT 1 FROM submissions WHERE user_id=?").get(user.id)).toBeUndefined();
    db.prepare("UPDATE users SET cooldown_until=? WHERE id=?").run(new Date(Date.now() - 1).toISOString(), user.id);
    const allowed = await submit();
    expect([200, 201], allowed.body).toContain(allowed.statusCode);
    expect(db.prepare("SELECT source FROM round_participants WHERE user_id=? AND round_id=? AND left_at IS NULL").get(user.id, target)).toEqual({ source: "FREE" });
  });
  it.each(["pass","skip"] as const)("nova referência %s paga reentrada e retry conserva o débito único",async(method)=>{
    const user=await register();cooldown(user.id);
    db.prepare("UPDATE wallets SET extra_slot_passes=2 WHERE user_id=?").run(user.id);
    grantItem(db,{userId:user.id,itemCode:ITEM_SKIP,delta:2,kind:"OWNER_ADJUST"});
    const enter=(referenceId:string)=>app.inject({method:"POST",url:"/queues/"+method,headers:auth(user.token),payload:{referenceId}});
    const first=await enter(randomUUID());expect(first.statusCode,first.body).toBe(200);
    const id=first.json().queue.id;
    const left=await app.inject({method:"POST",url:"/queues/"+id+"/leave",headers:auth(user.token)});expect(left.statusCode,left.body).toBe(200);
    const reference=randomUUID(),second=await enter(reference);expect(second.statusCode,second.body).toBe(200);
    expect(second.json().queue.id).toBe(id);
    const quantity=()=>method==="skip"?itemQuantity(db,user.id,ITEM_SKIP):(db.prepare("SELECT extra_slot_passes AS n FROM wallets WHERE user_id=?").get(user.id) as {n:number}).n;
    expect(quantity()).toBe(0);
    expect((await enter(reference)).statusCode).toBe(200);expect(quantity()).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM round_participants WHERE user_id=? AND left_at IS NULL").get(user.id)).toEqual({n:1});
  });
  it.each(["pass","skip"] as const)("carteira em análise não abre fila ou consome %s",async(method)=>{
    const user=await register();db.prepare("UPDATE wallets SET extra_slot_passes=1,payment_hold=1 WHERE user_id=?").run(user.id);
    grantItem(db,{userId:user.id,itemCode:ITEM_SKIP,delta:1,kind:"OWNER_ADJUST"});
    const before=db.prepare("SELECT * FROM round_participants WHERE user_id=?").all(user.id);
    const result=await app.inject({method:"POST",url:"/queues/"+method,headers:auth(user.token),payload:{referenceId:randomUUID()}});
    expect(result.statusCode,result.body).toBe(409);
    expect(db.prepare("SELECT * FROM round_participants WHERE user_id=?").all(user.id)).toEqual(before);
    expect(itemQuantity(db,user.id,ITEM_SKIP)).toBe(1);
    expect(db.prepare("SELECT extra_slot_passes AS n FROM wallets WHERE user_id=?").get(user.id)).toEqual({n:1});
  });
  it("revogação explícita bloqueia ingresso pago sem consumir itens",async()=>{
    const user=await register();db.prepare("UPDATE wallets SET extra_slot_passes=1 WHERE user_id=?").run(user.id);
    grantItem(db,{userId:user.id,itemCode:ITEM_SKIP,delta:1,kind:"OWNER_ADJUST"});
    db.prepare("UPDATE group_memberships SET revoked_at=? WHERE phone=(SELECT phone FROM users WHERE id=?)").run(stamp(),user.id);
    for(const method of ["pass","skip"]){
      const result=await app.inject({method:"POST",url:"/queues/"+method,headers:auth(user.token),payload:{referenceId:randomUUID()}});
      expect(result.statusCode,result.body).toBe(403);
    }
    expect(itemQuantity(db,user.id,ITEM_SKIP)).toBe(1);
    expect(db.prepare("SELECT extra_slot_passes AS n FROM wallets WHERE user_id=?").get(user.id)).toEqual({n:1});
  });
  it("senha ainda abre sessão durante o intervalo, sem apagar o prazo",async()=>{
    const user=await register();
    const set=await app.inject({method:"POST",url:"/auth/password/set",headers:auth(user.token),payload:{newPassword:"synthetic-password-2026"}});expect(set.statusCode,set.body).toBe(200);
    cooldown(user.id);const phone=(db.prepare("SELECT phone FROM users WHERE id=?").get(user.id) as {phone:string}).phone;
    const login=await app.inject({method:"POST",url:"/auth/password/login",payload:{phone,password:"synthetic-password-2026"}});expect(login.statusCode,login.body).toBe(200);
    expect((await app.inject({url:"/dashboard",headers:auth(login.json().token)})).statusCode).toBe(200);
    expect(Date.parse((db.prepare("SELECT cooldown_until AS until FROM users WHERE id=?").get(user.id) as {until:string}).until)).toBeGreaterThan(Date.now());
  });

  it("abandonar outra tarefa não apaga o intervalo criado por uma conclusão",async()=>{
    const user=await register(),first=openRound(db);joinRound(db,first,user.id,"FREE");ready(first,user.id);
    const second=openRound(db);joinRound(db,second,user.id,"PASS");ready(second,user.id);
    const finished=await app.inject({method:"POST",url:"/rounds/"+first+"/watch-progress/finalize",headers:auth(user.token)});expect(finished.statusCode,finished.body).toBe(200);
    const until=finished.json().cooldownUntil;
    const abandoned=await app.inject({method:"POST",url:"/rounds/"+second+"/watch-progress/abandon",headers:auth(user.token)});expect(abandoned.statusCode,abandoned.body).toBe(200);
    expect(Date.parse(abandoned.json().cooldownUntil)).toBeGreaterThan(Date.parse(until));
    expect(Date.parse(abandoned.json().cooldownUntil)-Date.now()).toBeGreaterThan(3_590_000);
    const next=await app.inject({method:"POST",url:"/rounds/current/submissions",headers:auth(user.token),payload:{url:"https://youtu.be/abcdefghijk"}});expect(next.statusCode,next.body).toBe(423);
  });

  it("abandono aplica60min uma vez, conserva URLs e exibe todas as filas sem dar acesso grátis",async()=>{
    const user=await register();const first=(db.prepare("SELECT id FROM rounds WHERE status='OPEN'").get() as {id:string}).id;
    joinRound(db,first,user.id);const second=openRound(db);
    const left=await app.inject({method:"POST",url:"/queues/"+first+"/leave",headers:auth(user.token)});
    expect(left.statusCode,left.body).toBe(200);const until=left.json().cooldownUntil;
    expect(Date.parse(until)-Date.now()).toBeGreaterThan(3_590_000);
    const retry=await app.inject({method:"POST",url:"/queues/"+first+"/leave",headers:auth(user.token)});expect(retry.json().cooldownUntil).toBe(until);
    const overview=await app.inject({url:"/queues/mine",headers:auth(user.token)});
    expect(overview.json().available.map((q:{id:string})=>q.id)).toEqual(expect.arrayContaining([first,second]));
    expect(overview.json().queues).toHaveLength(0);
    const denied=await app.inject({method:"POST",url:"/rounds/current/submissions",headers:auth(user.token),payload:{url:"https://youtu.be/E2EQUE00001",expectedRoundId:first}});expect(denied.statusCode).toBe(423);
    const resumeBlocked=await app.inject({method:"POST",url:"/queues/"+first+"/resume",headers:auth(user.token)});expect(resumeBlocked.statusCode).toBe(423);
    db.prepare("UPDATE users SET cooldown_until=? WHERE id=?").run(new Date(Date.now()-1).toISOString(),user.id);
    const resumed=await app.inject({method:"POST",url:"/queues/"+first+"/resume",headers:auth(user.token)});expect(resumed.statusCode,resumed.body).toBe(200);
    const again=await app.inject({method:"POST",url:"/queues/"+first+"/resume",headers:auth(user.token)});expect(again.json().replayed).toBe(true);
    expect((await app.inject({url:"/queues/mine",headers:auth(user.token)})).json().queues.map((q:{id:string})=>q.id)).toContain(first);
  });

  it("playlist parcial exige confirmação e amplia para dez sem perder histórico ou repetir XP",async()=>{
    const user=await register();const first=(db.prepare("SELECT id FROM rounds WHERE status='OPEN'").get() as {id:string}).id;joinRound(db,first,user.id);
    db.prepare("INSERT INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,created_at,video_duration_seconds) VALUES(?,?,1,?,'https://youtu.be/E2EQUE00001','E2EQUE00001',?,10)").run(randomUUID(),first,user.id,stamp());
    const prepare=(acceptPartial:boolean)=>app.inject({method:"POST",url:"/rounds/"+first+"/prepare-playlist",headers:auth(user.token),payload:{acceptPartial}});
    const denied=await prepare(false);expect(denied.statusCode,denied.body).toBe(409);expect(denied.json().code).toBe("PARTIAL_CONFIRMATION_REQUIRED");
    const confirmed=await prepare(true);expect(confirmed.statusCode,confirmed.body).toBe(200);expect(confirmed.json()).toMatchObject({count:1,rewardEligible:false,videos:["E2EQUE00001"]});
    expect((await prepare(false)).json()).toEqual(confirmed.json());
    db.prepare("INSERT INTO playlist_exports(id,round_id,user_id,youtube_playlist_id,status,added_count,created_at,updated_at) VALUES(?,?,?,'synthetic-playlist','SUCCESS',1,?,?)").run(randomUUID(),first,user.id,stamp(),stamp());
    const invalid=await app.inject({method:"POST",url:"/rounds/"+first+"/watch-observation",headers:auth(user.token),payload:{...observation(),videoIndex:1}});expect(invalid.statusCode).toBe(409);
    const dashboard=await app.inject({url:"/dashboard",headers:auth(user.token)});expect(dashboard.json().readyRounds.find((r:{id:string})=>r.id===first).slots).toHaveLength(1);
    const sessionId=randomUUID();
    db.prepare("INSERT INTO watch_time_totals(user_id,verified_millis,rewarded_coins,updated_at) VALUES(?,1199000,0,?)").run(user.id,stamp());
    const start=await app.inject({method:"POST",url:"/rounds/"+first+"/watch-observation",headers:auth(user.token),payload:{...observation(),duration:10,sessionId}});expect(start.statusCode,start.body).toBe(200);
    db.prepare("UPDATE watch_observation_state SET observed_at=? WHERE user_id=?").run(new Date(Date.now()-10_000).toISOString(),user.id);
    const before=(db.prepare("SELECT reward_millis AS n FROM wallets WHERE user_id=?").get(user.id) as {n:number}).n;
    const end=await app.inject({method:"POST",url:"/rounds/"+first+"/watch-observation",headers:auth(user.token),payload:{...observation(),duration:10,sessionId,playerSeconds:10,playing:false}});
    expect(end.statusCode,end.body).toBe(200);expect(end.json().xpDelta).toBeGreaterThan(0);expect(end.json().rewardDeltaCoins).toBe(0);expect(end.json().percent).toBe(100);expect(end.json().finalizedAt).toBeUndefined();
    expect(db.prepare("SELECT closed_at AS closed FROM rounds WHERE id=?").get(first)).toEqual({closed:null});
    const current=(await app.inject({url:"/dashboard",headers:auth(user.token)})).json().openRound;expect(current.id).toBe(first);
    expect(db.prepare("SELECT reward_millis AS n FROM wallets WHERE user_id=?").get(user.id)).toEqual({n:before});
    expect(db.prepare("SELECT verified_millis AS n FROM watch_time_totals WHERE user_id=?").get(user.id)).toEqual({n:1199000});
    for(let slot=2;slot<=10;slot++)db.prepare("INSERT INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,created_at,video_duration_seconds) VALUES(?,?,?,?,?,?,?,10)").run(randomUUID(),first,slot,user.id,"https://youtu.be/E2EQUE000"+String(slot).padStart(2,"0"),"E2EQUE000"+String(slot).padStart(2,"0"),stamp());
    db.prepare("UPDATE rounds SET status='READY' WHERE id=?").run(first);
    const dashboardFull=(await app.inject({url:"/dashboard",headers:auth(user.token)})).json().readyRounds.find((r:{id:string})=>r.id===first);
    expect(dashboardFull.slots).toHaveLength(1);expect(dashboardFull.availableSlots.filter((v:{videoId?:string})=>v.videoId)).toHaveLength(10);
    // An active export cannot be archived underneath a remote request.
    db.prepare("INSERT INTO export_locks(round_id,user_id,owner,expires_at) VALUES(?,?,'test-lock',?)").run(first,user.id,new Date(Date.now()+60000).toISOString());
    expect((await prepare(false)).statusCode).toBe(409);
    db.prepare("DELETE FROM export_locks WHERE round_id=?").run(first);
    const full=await prepare(false);expect(full.statusCode,full.body).toBe(200);expect(full.json()).toMatchObject({count:10,rewardEligible:true});
    expect((await prepare(false)).json()).toEqual(full.json());
    const history=db.prepare("SELECT export_json AS exported,selection_json AS selection,progress_json AS progress FROM playlist_selection_history WHERE round_id=?").all(first) as {exported:string;selection:string;progress:string}[];
    expect(history).toHaveLength(1);expect(JSON.parse(history[0].exported).youtube_playlist_id).toBe("synthetic-playlist");expect(JSON.parse(history[0].selection).count).toBe(1);expect(JSON.parse(history[0].progress).percent).toBe(100);
    expect(()=>db.prepare("DELETE FROM playlist_selection_history").run()).toThrow("Immutable playlist history");
    expect(db.prepare("SELECT youtube_playlist_id AS id,status,added_count AS count FROM playlist_exports WHERE round_id=? AND user_id=?").get(first,user.id)).toEqual({id:null,status:"PENDING",count:0});
    const smaller=await app.inject({method:"POST",url:"/rounds/"+first+"/prepare-playlist",headers:auth(user.token),payload:{acceptPartial:true,videoCount:1}});expect(smaller.statusCode).toBe(409);
    db.prepare("UPDATE playlist_exports SET youtube_playlist_id='synthetic-full',status='SUCCESS',added_count=10 WHERE round_id=? AND user_id=?").run(first,user.id);
    const observe=(videoIndex:number,playerSeconds:number)=>app.inject({method:"POST",url:"/rounds/"+first+"/watch-observation",headers:auth(user.token),payload:{...observation(),duration:10,sessionId,videoIndex,playerSeconds}});
    await observe(0,0);db.prepare("UPDATE watch_observation_state SET observed_at=? WHERE user_id=?").run(new Date(Date.now()-10000).toISOString(),user.id);
    const replay=await observe(0,10);expect(replay.statusCode,replay.body).toBe(200);expect(replay.json().acceptedSeconds).toBe(0);expect(replay.json().xpDelta).toBe(0);expect(replay.json().rewardDeltaCoins).toBe(0);
    await observe(9,0);db.prepare("UPDATE watch_observation_state SET observed_at=? WHERE user_id=?").run(new Date(Date.now()-10000).toISOString(),user.id);
    const fresh=await observe(9,10);expect(fresh.statusCode,fresh.body).toBe(200);expect(fresh.json().xpDelta).toBeGreaterThan(0);expect(fresh.json().rewardDeltaCoins).toBe(1);

  });

  it("HTTP expires72h queues without deleting URLs or granting new rewards",async()=>{
    const user=await register();const first=(db.prepare("SELECT id FROM rounds WHERE status='OPEN'").get() as {id:string}).id;
    joinRound(db,first,user.id);ready(first,user.id);const before=ledgerCount(user.id);
    db.prepare("UPDATE rounds SET created_at=? WHERE id=?").run(new Date(Date.now()-3*24*60*60_000-1).toISOString(),first);
    const response=await app.inject({url:"/dashboard",headers:auth(user.token)});expect(response.statusCode,response.body).toBe(200);
    expect(response.json().openRound.number).toBe(1);expect(response.json().openRound.id).not.toBe(first);
    expect(response.json().readyRounds.some((r:{id:string})=>r.id===first)).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE round_id=?").get(first)).toEqual({n:10});expect(ledgerCount(user.id)).toBe(before);
    const denied=await app.inject({method:"POST",url:"/rounds/"+first+"/watch-observation",headers:auth(user.token),payload:observation()});expect(denied.statusCode).toBe(409);
  });

  it("preview público não concede acesso; Pular libera fila READY sem URL própria uma única vez", async () => {
    const user = await register();
    const first = (db.prepare("SELECT id FROM rounds WHERE status='OPEN' ORDER BY sequence LIMIT 1").get() as { id: string }).id;
    const author = randomUUID(), target = openRound(db);
    db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES (?,?,?,'12',?,?)")
      .run(author, "Autor de outra fila", "seed-" + author, stamp(), stamp());
    joinRound(db, target, author); ready(target, author);
    grantItem(db, { userId: user.id, itemCode: ITEM_SKIP, delta: 2, kind: "OWNER_ADJUST" });
    const preview = await app.inject({ url: "/queues/" + target + "/preview", headers: auth(user.token) });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().round.slots).toHaveLength(10);
    expect(preview.json().joined).toBe(false);
    expect(preview.body).not.toMatch(/participantPhone|playlist_exports|youtube_playlist_id|private_messages/);
    expect(hasActiveRoundTask(db, user.id, target)).toBe(false);
    expect(db.prepare("SELECT 1 FROM round_participants WHERE round_id=? AND user_id=?").get(target, user.id)).toBeUndefined();
    expect(itemQuantity(db, user.id, ITEM_SKIP)).toBe(2);
    const prepare = () => app.inject({ method: "POST", url: "/rounds/" + target + "/prepare-playlist", headers: auth(user.token), payload: { acceptPartial: false } });
    expect((await prepare()).statusCode).toBe(409);
    const referenceId = randomUUID();
    const skip = () => app.inject({ method: "POST", url: "/queues/skip", headers: auth(user.token), payload: { referenceId, targetRoundId: target } });
    const joined = await skip(); expect(joined.statusCode, joined.body).toBe(200);
    const replay = await skip(); expect(replay.statusCode, replay.body).toBe(200);
    expect(joined.json().queue.id).toBe(target); expect(replay.json().queue.id).toBe(target);
    expect(itemQuantity(db, user.id, ITEM_SKIP)).toBe(1);
    expect(hasActiveRoundTask(db, user.id, target)).toBe(true);
    expect(db.prepare("SELECT 1 FROM submissions WHERE round_id=? AND user_id=?").get(target, user.id)).toBeUndefined();
    const dashboard = await app.inject({ url: "/dashboard", headers: auth(user.token) });
    expect(dashboard.statusCode, dashboard.body).toBe(200);
    expect(dashboard.json().readyRounds.find((r: { id: string }) => r.id === target))
      .toMatchObject({ viewerCanParticipate: true, viewerContributed: false });
    expect(dashboard.json().viewer.contributionBlockedByPendingTask).toBe(true);
    const prepared = await prepare(); expect(prepared.statusCode, prepared.body).toBe(200);
    expect(prepared.json()).toMatchObject({ count: 10, rewardEligible: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ title: "Vídeo sintético", author_name: "Canal de teste" }), { status: 200, headers: { "content-type": "application/json" } })));
    const submit = () => app.inject({ method: "POST", url: "/rounds/current/submissions", headers: auth(user.token), payload: { url: "https://youtu.be/E2EQUE00091", expectedRoundId: first } });
    const blocked = await submit(); expect(blocked.statusCode, blocked.body).toBe(409);
    expect(blocked.json().code).toBe("ACTIVE_TASK_PENDING");
    expect(db.prepare("SELECT 1 FROM round_participants WHERE round_id=? AND user_id=?").get(first, user.id)).toBeUndefined();
    db.prepare("UPDATE wallets SET extra_slot_passes=1 WHERE user_id=?").run(user.id);
    const pass = await app.inject({ method: "POST", url: "/queues/pass", headers: auth(user.token), payload: { referenceId: randomUUID(), targetRoundId: first } });
    expect(pass.statusCode, pass.body).toBe(200); expect(pass.json().queue.id).toBe(first);
    const allowed = await submit(); expect([200, 201], allowed.body).toContain(allowed.statusCode);
  });

});
