import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { createPrivatePlaylist, encryptToken } from "./youtube.js";
import { normalizePhone } from "./phone.js";

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
describe("regressões de domínio e segurança", () => {
  let db: AppDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let config: Config;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    config = loadConfig({
      REQUIRE_GROUP_MEMBERSHIP: "false", NODE_ENV: "test", DATABASE_PATH: ":memory:", AUTH_DEV_MODE: "true", PAYMENTS_DEV_MODE: "true",
      JWT_SECRET: "regression-test-secret-32-characters", AUTH_CODE_PEPPER: "test-code-pepper",
      GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret",
      YOUTUBE_API_KEY: undefined, MERCADO_PAGO_ACCESS_TOKEN: undefined, MERCADO_PAGO_WEBHOOK_SECRET: "test-webhook-secret"
    });
    db = createDatabase(":memory:");
    app = await buildApp(config, db);
    fetchMock = vi.fn(async () => { throw new Error("Unexpected external request"); });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(async () => { await app.close(); db.close(); vi.unstubAllGlobals(); });

  async function code(phone:string,groupCode="12") {
    const stamp=new Date().toISOString();
    const normalizedPhone=normalizePhone(phone);
    db.prepare("INSERT OR IGNORE INTO groups (code,enabled,membership_mode) VALUES (?,1,'OWNER')").run(groupCode);
    db.prepare(`INSERT INTO group_memberships (phone,group_code,approved_at,revoked_at,source)
      VALUES (?,?,?,NULL,'TEST')
      ON CONFLICT(phone) DO UPDATE SET group_code=excluded.group_code,approved_at=excluded.approved_at,revoked_at=NULL,source='TEST'`)
      .run(normalizedPhone,groupCode,stamp);
    const result=await app.inject({method:"POST",url:"/auth/request-code",payload:{name:"Pessoa Teste",phone}});
    expect(result.statusCode).toBe(200);
    return result.json().devCode as string;
  }
  async function register(phone = "71999999001", groupCode = "12") {
    const otp = await code(phone, groupCode);
    const result = await app.inject({ method: "POST", url: "/auth/verify", payload: { phone, code: otp } });
    expect(result.statusCode).toBe(200);
    return { token: result.json().token as string, userId: result.json().user.id as string };
  }
  const headers = (token: string) => ({ authorization: `Bearer ${token}` });
  async function dashboard(token: string) { return (await app.inject({ method: "GET", url: "/dashboard", headers: headers(token) })).json(); }
  async function submit(token: string, id: string) { return app.inject({ method: "POST", url: "/rounds/current/submissions", headers: headers(token), payload: { url: `https://youtu.be/${id}` } }); }
  async function pix(token: string, product: "COINS_LAUNCH"|"PASS_SINGLE" = "COINS_LAUNCH") { return app.inject({ method: "POST", url: "/payments/pix", headers: headers(token), payload: { email: "test@example.com", cpf: "12345678901", product } }); }
  function providerResult(paymentId: string, status = "approved", extra: Record<string, unknown> = {}) {
    return { id: 901, external_reference: paymentId, status, transaction_amount: 20, currency_id: "BRL", payment_method_id: "pix", ...extra };
  }
  function webhookHeaders() {
    const ts = String(Date.now()), requestId = "test-request-id";
    const hash = createHmac("sha256", config.MERCADO_PAGO_WEBHOOK_SECRET!).update(`id:901;request-id:${requestId};ts:${ts};`).digest("hex");
    return { "x-request-id": requestId, "x-signature": `ts=${ts},v1=${hash}` };
  }
  async function readyRound(userId: string) {
    const row = db.prepare("SELECT id FROM rounds WHERE status = 'OPEN'").get() as { id: string };
    for (let slot = 1; slot <= 10; slot++) {
      db.prepare("INSERT INTO submissions (id,round_id,slot,user_id,youtube_url,video_id,created_at) VALUES (?,?,?,?,?,?,?)")
        .run(randomUUID(), row.id, slot, userId, `https://youtu.be/vid${String(slot).padStart(8, "0")}`, `vid${String(slot).padStart(8, "0")}`, new Date().toISOString());
    }
    db.prepare("UPDATE rounds SET status = 'READY' WHERE id = ?").run(row.id);
    db.prepare("INSERT INTO youtube_connections (user_id,refresh_token_cipher,scope,updated_at) VALUES (?,?,?,?)").run(userId,encryptToken("test-refresh",config),"youtube",new Date().toISOString());
    return row.id;
  }

  it("mantém quadro global com autoria, grupo e horário", async () => {
    const a = await register(), b = await register("71999999002", "45");
    expect((await submit(a.token, "dQw4w9WgXcQ")).statusCode).toBe(201);
    const slot = (await dashboard(b.token)).openRound.slots[0];
    expect(slot.groupCode).toBe("12"); expect(slot.userName).toBe("Pessoa Teste"); expect(slot.createdAt).toBeTruthy();
  });
  it("serializa duas submissões concorrentes em slots distintos sem débito duplo", async () => {
    const first=await register("71999110001"),second=await register("71999110002");
    const [a,b]=await Promise.all([
      submit(first.token,"conc0000001"),
      submit(second.token,"conc0000002")
    ]);
    expect([a.statusCode,b.statusCode]).toEqual([201,201]);
    const slots=[a.json().slot,b.json().slot].sort((x:number,y:number)=>x-y);
    expect(slots).toEqual([1,2]);
    expect((await dashboard(first.token)).wallet.total).toBe(9);
    expect((await dashboard(second.token)).wallet.total).toBe(9);
    const rows=db.prepare("SELECT slot,user_id AS userId FROM submissions ORDER BY slot").all() as Array<{slot:number;userId:string}>;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row)=>row.slot)).size).toBe(2);
    expect((db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE kind='SUBMISSION'").get() as {n:number}).n).toBe(2);
  });

  it("concorrência do mesmo vídeo aceita só uma submissão e reverte totalmente o perdedor", async () => {
    const first=await register("71999110003"),second=await register("71999110004");
    const [a,b]=await Promise.all([
      submit(first.token,"same0000001"),
      submit(second.token,"same0000001")
    ]);
    const codes=[a.statusCode,b.statusCode].sort();
    expect(codes).toEqual([201,409]);
    const winner=a.statusCode===201?first:second;
    const loser=a.statusCode===201?second:first;
    expect((await dashboard(winner.token)).wallet.total).toBe(9);
    expect((await dashboard(loser.token)).wallet.total).toBe(10);
    expect((db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE video_id='same0000001'").get() as {n:number}).n).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE kind='SUBMISSION'").get() as {n:number}).n).toBe(1);
  });

  it("fecha dez contribuições, recompensa uma vez e abre novo ciclo", async () => {
    const users = [];
    for (let index = 1; index <= 10; index++) {
      const user = await register(`7199999${String(index).padStart(4, "0")}`); users.push(user);
      const result = await submit(user.token, `vid${String(index).padStart(8, "0")}`);
      expect(result.statusCode).toBe(201); expect(result.json().slot).toBe(index);
    }
    const view = await dashboard(users[0].token);
    expect(view.openRound.sequence).toBe(2); expect(view.readyRounds[0].slots).toHaveLength(10);
    expect(view.wallet).toMatchObject({ promo: 9, reward: 1, total: 10, extraPasses: 0 });
    await dashboard(users[0].token);
    expect((await dashboard(users[0].token)).wallet.reward).toBe(1);
    const blocked = await submit(users[0].token, "next0000001");
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().message).toContain("Fila 1");
    const newcomer = await register("71999999011");
    const repeated = await submit(newcomer.token, "vid00000001");
    expect(repeated.statusCode).toBe(409);
    expect(repeated.json().message).toContain("já foi usado");
    expect((await submit(newcomer.token, "next0000001")).statusCode).toBe(201);
  });
  it("não joga submissão validada na fila seguinte quando a fila vista pelo usuário já fechou", async () => {
    const stale=await register("71999770001");
    const seenRound=db.prepare("SELECT id,sequence FROM rounds WHERE status='OPEN' ORDER BY sequence DESC LIMIT 1").get() as {id:string;sequence:number};
    expect(seenRound.sequence).toBe(1);
    for(let index=1;index<=10;index++) {
      const participant=await register("7199978"+String(index).padStart(4,"0"));
      expect((await submit(participant.token,"race"+String(index).padStart(7,"0"))).statusCode).toBe(201);
    }
    const before=await dashboard(stale.token);
    expect(before.openRound.sequence).toBe(2);
    expect(before.wallet.total).toBe(10);
    const result=await app.inject({
      method:"POST",url:"/rounds/current/submissions",headers:headers(stale.token),
      payload:{url:"https://youtu.be/raceSTALE01",expectedRoundId:seenRound.id}
    });
    expect(result.statusCode).toBe(409);
    expect(result.json()).toMatchObject({code:"QUEUE_CHANGED",currentRoundSequence:2});
    const after=await dashboard(stale.token);
    expect(after.wallet.total).toBe(10);
    expect(after.viewer.contributionsInOpenRound).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE user_id=?").get(stale.userId) as {n:number}).n).toBe(0);
  });

  it("não duplica saldo de curadoria quando o ledger daquela fila já existe", async () => {
    const users:Array<{token:string;userId:string}>=[];
    for(let index=1;index<=9;index++) {
      const user=await register("7199988"+String(index).padStart(4,"0"));
      users.push(user);
      const saved=await submit(user.token,"curate"+String(index).padStart(5,"0"));
      expect(saved.statusCode).toBe(201);
    }
    const round=db.prepare("SELECT id FROM rounds WHERE status='OPEN' ORDER BY sequence DESC LIMIT 1").get() as {id:string};
    const stamp=new Date().toISOString();
    db.prepare("INSERT INTO wallet_ledger(id,user_id,kind,amount_millis,reference_id,created_at) VALUES (?,?, 'CURATION_REWARD',1000,?,?)")
      .run(randomUUID(),users[0].userId,round.id,stamp);

    const tenth=await register("71999889999");
    users.push(tenth);
    const completed=await submit(tenth.token,"curate00010");
    expect(completed.statusCode).toBe(201);
    expect(completed.json().roundCompleted).toBe(true);

    const firstWallet=await dashboard(users[0].token);
    const secondWallet=await dashboard(users[1].token);
    const tenthWallet=await dashboard(tenth.token);
    expect(firstWallet.wallet).toMatchObject({promo:9,reward:0,total:9});
    expect(secondWallet.wallet).toMatchObject({promo:9,reward:1,total:10});
    expect(tenthWallet.wallet).toMatchObject({promo:9,reward:1,total:10});
    expect((db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE user_id=? AND kind='CURATION_REWARD' AND reference_id=?")
      .get(users[0].userId,round.id) as {n:number}).n).toBe(1);
  });

  it("mantém progresso legado sem regressão, mas sem conceder recompensa insegura", async () => {
    const user = await register();
    const roundId = await readyRound(user.userId);
    db.prepare("INSERT INTO playlist_exports (id, round_id, user_id, youtube_playlist_id, status, added_count, created_at, updated_at) VALUES (?, ?, ?, ?, 'SUCCESS', 10, ?, ?)")
      .run(randomUUID(), roundId, user.userId, "playlist-watch-test", new Date().toISOString(), new Date().toISOString());

    const first = await app.inject({
      method: "PUT", url: `/rounds/${roundId}/watch-progress`, headers: headers(user.token),
      payload: { watchedSeconds: [5,0,0,0,0,0,0,0,0,0], durations: [10,10,10,10,10,10,10,10,10,10] }
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ percent: 5, rewardCoins: 0, rewardDeltaCoins: 0, walletTotal: 10 });

    const progress37 = await app.inject({
      method: "PUT", url: `/rounds/${roundId}/watch-progress`, headers: headers(user.token),
      payload: { watchedSeconds: [10,10,10,7,0,0,0,0,0,0], durations: [10,10,10,10,10,10,10,10,10,10] }
    });
    expect(progress37.statusCode).toBe(200);
    expect(progress37.json()).toMatchObject({ percent: 37, rewardCoins: 0, rewardDeltaCoins: 0, walletTotal: 10, protocol:"LEGACY_NO_REWARD_NO_FINALIZE" });

    const lower = await app.inject({
      method: "PUT", url: `/rounds/${roundId}/watch-progress`, headers: headers(user.token),
      payload: { watchedSeconds: [1,0,0,0,0,0,0,0,0,0], durations: [10,10,10,10,10,10,10,10,10,10] }
    });
    expect(lower.statusCode).toBe(200);
    expect(lower.json()).toMatchObject({ percent: 37, rewardCoins: 0, rewardDeltaCoins: 0, walletTotal: 10 });
    const view = await dashboard(user.token);
    expect(view.readyRounds[0].export.watchProgress).toMatchObject({ percent: 37, rewardCoins: 0 });
    expect(view.wallet.reward).toBe(0);

    const full = await app.inject({
      method: "PUT", url: `/rounds/${roundId}/watch-progress`, headers: headers(user.token),
      payload: { watchedSeconds: Array(10).fill(10), durations: Array(10).fill(10) }
    });
    expect(full.statusCode).toBe(200);
    expect(full.json()).toMatchObject({ percent: 100, rewardCoins: 0, rewardDeltaCoins: 0, walletTotal: 10, protocol:"LEGACY_NO_REWARD_NO_FINALIZE" });
    expect(full.json().cooldownUntil).toBeUndefined();
    expect((db.prepare("SELECT finalized_at AS finalizedAt FROM playlist_watch_progress WHERE round_id=? AND user_id=?").get(roundId,user.userId) as {finalizedAt?:string}).finalizedAt).toBeFalsy();
    const duplicateFull = await app.inject({
      method: "PUT", url: `/rounds/${roundId}/watch-progress`, headers: headers(user.token),
      payload: { watchedSeconds: Array(10).fill(10), durations: Array(10).fill(10) }
    });
    expect(duplicateFull.statusCode).toBe(200);
    expect(duplicateFull.json()).toMatchObject({percent:100,protocol:"LEGACY_NO_REWARD_NO_FINALIZE"});
    const relogin = await app.inject({ method:"POST", url:"/auth/login", payload:{ name:"Pessoa Teste", phone:"71999999001", groupCode:"12" } });
    expect(relogin.statusCode).toBe(200);
    const blockedNext=await submit(user.token,"legNEXT0001");
    expect(blockedNext.statusCode).toBe(409);
    expect(blockedNext.json().message).toContain("Finalize sua tarefa");
    expect((db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE user_id=? AND kind='WATCH_PROGRESS'").get(user.userId) as {n:number}).n).toBe(0);

    const outsider = await register("71999999002");
    expect((await app.inject({
      method: "PUT", url: `/rounds/${roundId}/watch-progress`, headers: headers(outsider.token),
      payload: { watchedSeconds: Array(10).fill(1), durations: Array(10).fill(10) }
    })).statusCode).toBe(409);
  });

  it("conclusão manual preserva percentual e recompensas e aplica cooldown persistente de 30 minutos", async () => {
    const user = await register("71999999012");
    const roundId = await readyRound(user.userId);
    const stamp = new Date().toISOString();
    db.prepare("INSERT INTO playlist_exports (id,round_id,user_id,youtube_playlist_id,status,added_count,created_at,updated_at) VALUES (?,?,?,?, 'SUCCESS',10,?,?)")
      .run(randomUUID(),roundId,user.userId,"playlist-manual-finish",stamp,stamp);

    const progress = await app.inject({
      method:"PUT", url:`/rounds/${roundId}/watch-progress`, headers:headers(user.token),
      payload:{ watchedSeconds:[10,10,10,7,0,0,0,0,0,0], durations:Array(10).fill(10) }
    });
    expect(progress.statusCode).toBe(200);
    expect(progress.json()).toMatchObject({ percent:37, rewardCoins:0, rewardDeltaCoins:0, walletTotal:10 });

    const finish = await app.inject({ method:"POST", url:`/rounds/${roundId}/watch-progress/finalize`, headers:headers(user.token) });
    expect(finish.statusCode).toBe(200);
    expect(finish.json()).toMatchObject({ percent:37, secondsRemaining:1800 });
    const saved = db.prepare("SELECT percent,finalized_at AS finalizedAt,finalize_reason AS reason FROM playlist_watch_progress WHERE round_id=? AND user_id=?")
      .get(roundId,user.userId) as { percent:number; finalizedAt:string; reason:string };
    expect(saved).toMatchObject({ percent:37, reason:"MANUAL" });
    expect(saved.finalizedAt).toBeTruthy();
    expect((db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE user_id=? AND kind='WATCH_PROGRESS'").get(user.userId) as {n:number}).n).toBe(0);

    const during = await app.inject({ method:"POST",url:"/auth/login",payload:{ name:"Pessoa Teste",phone:"71999999012",groupCode:"12" } });
    expect(during.statusCode).toBe(423);
    db.prepare("UPDATE users SET cooldown_until=? WHERE id=?").run(new Date(Date.now()-1000).toISOString(),user.userId);
    const after = await app.inject({ method:"POST",url:"/auth/login",payload:{ name:"Pessoa Teste",phone:"71999999012",groupCode:"12" } });
    expect(after.statusCode).toBe(200);
  });

  it("abandonar tarefa preserva percentual e moedas, não cria cooldown e libera a fila seguinte", async () => {
    const user=await register("71999999013");
    const roundId=await readyRound(user.userId);
    const stamp=new Date().toISOString();
    db.prepare("INSERT INTO playlist_exports (id,round_id,user_id,youtube_playlist_id,status,added_count,created_at,updated_at) VALUES (?,?,?,?, 'SUCCESS',10,?,?)")
      .run(randomUUID(),roundId,user.userId,"playlist-abandon-test",stamp,stamp);
    // O dashboard garante uma nova fila aberta após a anterior ter sido marcada READY.
    const before=await dashboard(user.token);
    expect(before.openRound.sequence).toBe(2);
    const progress=await app.inject({
      method:"PUT",url:`/rounds/${roundId}/watch-progress`,headers:headers(user.token),
      payload:{watchedSeconds:[10,10,10,7,0,0,0,0,0,0],durations:Array(10).fill(10)}
    });
    expect(progress.json()).toMatchObject({percent:37,rewardCoins:0,rewardDeltaCoins:0,walletTotal:10});
    const abandoned=await app.inject({method:"POST",url:`/rounds/${roundId}/watch-progress/abandon`,headers:headers(user.token)});
    expect(abandoned.statusCode).toBe(200);
    expect(abandoned.json()).toMatchObject({percent:37,abandoned:true,nextOpenRound:{sequence:2}});
    expect(abandoned.json().cooldownUntil).toBeUndefined();
    const saved=db.prepare("SELECT percent,finalized_at AS finalizedAt,finalize_reason AS reason FROM playlist_watch_progress WHERE round_id=? AND user_id=?")
      .get(roundId,user.userId) as {percent:number;finalizedAt:string;reason:string};
    expect(saved).toMatchObject({percent:37,reason:"ABANDONED"});
    expect(saved.finalizedAt).toBeTruthy();
    const userRow=db.prepare("SELECT cooldown_until AS cooldownUntil FROM users WHERE id=?").get(user.userId) as {cooldownUntil?:string};
    expect(userRow.cooldownUntil ?? null).toBeNull();
    expect((db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE user_id=? AND kind='WATCH_PROGRESS'").get(user.userId) as {n:number}).n).toBe(0);
    const after=await dashboard(user.token);
    expect(after.readyRounds).toHaveLength(0);
    expect(after.openRound.sequence).toBe(2);
  });

  it("avatar preset fica persistido no servidor e volta no dashboard", async () => {
    const user=await register();
    const saved=await app.inject({method:"PUT",url:"/profile/avatar",headers:headers(user.token),payload:{kind:"PRESET",presetId:"avatar-17"}});
    expect(saved.statusCode).toBe(200);
    expect(saved.json().avatar).toEqual({kind:"PRESET",presetId:"avatar-17"});
    expect((await dashboard(user.token)).user.avatar).toEqual({kind:"PRESET",presetId:"avatar-17"});
  });

  it("exclusão da própria conta invalida sessão e preserva tombstone de auditoria", async () => {
    const user=await register();
    const deleted=await app.inject({method:"DELETE",url:"/profile/account",headers:headers(user.token),payload:{confirmation:"DELETE_MY_ACCOUNT"}});
    expect(deleted.statusCode,deleted.body).toBe(200);
    expect(deleted.json()).toMatchObject({ok:true,userId:user.userId});
    expect((await app.inject({method:"GET",url:"/dashboard",headers:headers(user.token)})).statusCode).toBe(401);
    const row=db.prepare("SELECT user_id AS userId,source,deleted_at AS deletedAt FROM account_deletions WHERE user_id=?").get(user.userId);
    expect(row).toMatchObject({userId:user.userId,source:"USER_SELF_SERVICE"});
    expect((db.prepare("SELECT phone,name,deleted_at AS deletedAt FROM users WHERE id=?").get(user.userId) as {phone:string;name:string;deletedAt:string})).toMatchObject({name:"Conta removida"});
    expect((db.prepare("SELECT COUNT(*) AS n FROM group_memberships WHERE phone='71999999001'").get() as {n:number}).n).toBe(0);
  });

  it("rejeita URL falsa sem débito", async () => {
    const user = await register();
    expect((await app.inject({ method: "POST", url: "/rounds/current/submissions", headers: headers(user.token), payload: { url: "https://youtube.example/watch?v=dQw4w9WgXcQ" } })).statusCode).toBe(400);
    expect((await dashboard(user.token)).wallet.total).toBe(10);
  });
  it("pacote de lançamento credita 10 moedas + 1 passe bônus e o passe libera uma única contribuição extra", async () => {
    const user = await register();
    expect((await submit(user.token, "dQw4w9WgXcQ")).statusCode).toBe(201);
    const payment = await pix(user.token);
    const approve = () => app.inject({ method: "POST", url: `/payments/${payment.json().id}/demo-approve`, headers: headers(user.token) });
    expect((await approve()).statusCode).toBe(200); await approve();
    const purchasedView=await dashboard(user.token);
    expect(purchasedView.wallet).toMatchObject({ purchased: 10, extraPasses: 1 });
    expect(purchasedView.profile).toMatchObject({
      purchases:{coinsPurchased:10,passesPurchased:0,bonusPasses:1,approvedSpendCents:2000},
      activity:{submissions:1,rounds:1}
    });
    expect(purchasedView.profile.purchases.history[0]).toMatchObject({productCode:"COINS_LAUNCH",amountCents:2000,creditsMillis:10000,extraPasses:1});
    expect((await submit(user.token, "dQw4w9WgXcQ")).statusCode).toBe(409);
    expect((await dashboard(user.token)).wallet.extraPasses).toBe(1);
    expect((await submit(user.token, "9bZkp7q19f0")).statusCode).toBe(201);
    expect((await submit(user.token, "next0000001")).statusCode).toBe(409);
    expect((await dashboard(user.token)).wallet).toMatchObject({ purchased: 10, promo: 8, extraPasses: 0 });
  });
  it("compra avulsa de passe credita 1 passe sem adicionar moedas", async () => {
    const user=await register();
    const before=await dashboard(user.token);
    const payment=await pix(user.token,"PASS_SINGLE");
    expect(payment.statusCode).toBe(201);
    expect(payment.json()).toMatchObject({product:"PASS_SINGLE",credits:0,extraPasses:1});
    expect((await app.inject({method:"POST",url:`/payments/${payment.json().id}/demo-approve`,headers:headers(user.token)})).statusCode).toBe(200);
    const after=await dashboard(user.token);
    expect(after.wallet).toMatchObject({purchased:before.wallet.purchased,extraPasses:before.wallet.extraPasses+1});
    const stored=db.prepare("SELECT product_code AS productCode,credits_millis AS creditsMillis,extra_passes AS extraPasses FROM payments WHERE id=?").get(payment.json().id);
    expect(stored).toEqual({productCode:"PASS_SINGLE",creditsMillis:0,extraPasses:1});
  });

  it("créditos naturais não liberam passe", async () => {
    const user = await register();
    db.prepare("UPDATE wallets SET reward_millis = 100000 WHERE user_id = ?").run(user.userId);
    await submit(user.token, "dQw4w9WgXcQ");
    expect((await submit(user.token, "9bZkp7q19f0")).statusCode).toBe(409);
  });
  it("OTP não pode ser reutilizado e bloqueia após cinco erros", async () => {
    const phone = "71999999001", otp = await code(phone);
    const wrong = otp === "111111" ? "222222" : "111111";
    for (let index = 0; index < 5; index++) expect((await app.inject({ method: "POST", url: "/auth/verify", payload: { phone, code: wrong } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/auth/verify", payload: { phone, code: otp } })).statusCode).toBe(429);
    const other = await register("71999999002");
    expect(other.token).toBeTruthy();
    const used = await app.inject({ method: "POST", url: "/auth/verify", payload: { phone: "71999999002", code: "111111" } });
    expect(used.statusCode).toBe(401);
  });
  it("limita reenvio de OTP e aceita CORS Android somente na origem configurada", async () => {
    await code("71999999001");
    expect((await app.inject({ method: "POST", url: "/auth/request-code", payload: { name: "Teste", phone: "71999999001", groupCode: "12" } })).statusCode).toBe(429);
    const accepted = await app.inject({ method: "OPTIONS", url: "/dashboard", headers: { origin: "https://localhost", "access-control-request-method": "GET" } });
    expect(accepted.headers["access-control-allow-origin"]).toBe("https://localhost");
    const rejected = await app.inject({ method: "OPTIONS", url: "/dashboard", headers: { origin: "https://evil.example", "access-control-request-method": "GET" } });
    expect(rejected.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("recusa state OAuth como sessão e só consome callback uma vez", async () => {
    const user = await register();
    const connected = await app.inject({ method: "GET", url: "/youtube/connect", headers: headers(user.token) });
    const state = new URL(connected.json().url).searchParams.get("state")!;
    expect((await app.inject({ method: "GET", url: "/dashboard", headers: headers(state) })).statusCode).toBe(401);
    fetchMock.mockResolvedValue(response({ refresh_token: "test-refresh", scope: "youtube" }));
    const callbackUrl = `/youtube/callback?code=test-code&state=${encodeURIComponent(state)}`;
    expect((await app.inject({ method: "GET", url: callbackUrl })).statusCode).toBe(302);
    expect((await app.inject({ method: "GET", url: callbackUrl })).statusCode).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("OAuth mantém o ciclo escolhido e impede intenção de não participante", async () => {
    const user=await register(), other=await register("71999999002"); const roundId=await readyRound(user.userId);
    expect((await app.inject({url:`/youtube/connect?roundId=${roundId}`,headers:headers(other.token)})).statusCode).toBe(403);
    const result=await app.inject({url:`/youtube/connect?roundId=${roundId}`,headers:headers(user.token)});
    const state=new URL(result.json().url).searchParams.get("state")!;
    expect((db.prepare("SELECT round_id FROM oauth_states").get() as {round_id:string}).round_id).toBe(roundId);
    fetchMock.mockResolvedValue(response({refresh_token:"refresh",scope:"youtube"}));
    const callback=await app.inject({url:`/youtube/callback?code=ok&state=${encodeURIComponent(state)}`});
    expect(callback.statusCode).toBe(302); expect(callback.headers.location).toContain(`&round=${roundId}`);
  });
  it("cancelar OAuth consome intenção sem criar playlist ou consultar Google", async () => {
    const user=await register(); const result=await app.inject({url:"/youtube/connect",headers:headers(user.token)});
    const state=new URL(result.json().url).searchParams.get("state")!;
    const callback=await app.inject({url:`/youtube/callback?error=access_denied&state=${encodeURIComponent(state)}`});
    expect(callback.statusCode).toBe(302); expect(callback.headers.location).toContain("youtube=cancelled"); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("Pix imediatamente aprovado credita exatamente uma vez", async () => {
    const user = await register(); config.MERCADO_PAGO_ACCESS_TOKEN = "test-token";
    let paymentId = "";
    fetchMock.mockImplementation(async (_url: unknown, options: RequestInit) => {
      if (options.method === "POST") paymentId = JSON.parse(options.body as string).external_reference;
      return response(providerResult(paymentId));
    });
    const payment = await pix(user.token);
    expect(payment.statusCode).toBe(201);
    expect((await dashboard(user.token)).wallet).toMatchObject({ purchased: 10, extraPasses: 1 });
    const webhook = () => app.inject({ method: "POST", url: "/payments/webhooks/mercado-pago?data.id=901", headers: webhookHeaders(), payload: { data: { id: "901" } } });
    expect((await webhook()).statusCode).toBe(200); await webhook();
    expect((await dashboard(user.token)).wallet).toMatchObject({ purchased: 10, extraPasses: 1 });
  });
  it("consulta Pix confirma pendente; outro usuário não acessa pagamento", async () => {
    const user = await register(), other = await register("71999999002"); config.MERCADO_PAGO_ACCESS_TOKEN = "test-token";
    let paymentId = "";
    fetchMock.mockImplementation(async (_url: unknown, options: RequestInit) => {
      if (options.method === "POST") { paymentId = JSON.parse(options.body as string).external_reference; return response(providerResult(paymentId, "pending")); }
      return response(providerResult(paymentId));
    });
    const payment = await pix(user.token);
    const url = `/payments/${payment.json().id}`;
    expect((await app.inject({ method: "GET", url, headers: headers(other.token) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url, headers: headers(user.token) })).json().status).toBe("APPROVED");
    expect((await dashboard(user.token)).wallet.purchased).toBe(10);
  });
  it.each([{ transaction_amount: 1 }, { currency_id: "USD" }, { payment_method_id: "credit_card" }, { external_reference: "wrong" }])("recusa confirmação divergente %j", async (extra) => {
    const user = await register(); config.MERCADO_PAGO_ACCESS_TOKEN = "test-token";
    let paymentId = "";
    fetchMock.mockImplementation(async (_url: unknown, options: RequestInit) => {
      if (options.method === "POST") { paymentId = JSON.parse(options.body as string).external_reference; return response(providerResult(paymentId, "pending")); }
      return response(providerResult(paymentId, "approved", extra));
    });
    await pix(user.token);
    const webhook = await app.inject({ method: "POST", url: "/payments/webhooks/mercado-pago?data.id=901", headers: webhookHeaders(), payload: { data: { id: "901" } } });
    expect(webhook.statusCode).toBe(409); expect((await dashboard(user.token)).wallet.purchased).toBe(0);
  });
  it("recusa webhook sem assinatura antes de consultar provedor", async () => {
    config.MERCADO_PAGO_ACCESS_TOKEN = "test-token";
    expect((await app.inject({ method: "POST", url: "/payments/webhooks/mercado-pago?data.id=901", payload: {} })).statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("estorno bloqueia novos gastos até conciliação sem apagar saldo", async () => {
    const user = await register(); config.MERCADO_PAGO_ACCESS_TOKEN = "test-token";
    let paymentId = "", refunded = false;
    fetchMock.mockImplementation(async (_url: unknown, options: RequestInit) => {
      if (options.method === "POST") paymentId = JSON.parse(options.body as string).external_reference;
      return response(providerResult(paymentId, refunded ? "refunded" : "approved"));
    });
    await pix(user.token); refunded = true;
    const webhook = await app.inject({ method: "POST", url: "/payments/webhooks/mercado-pago?data.id=901", headers: webhookHeaders(), payload: { data: { id: "901" } } });
    expect(webhook.statusCode).toBe(200);
    expect((await dashboard(user.token)).wallet).toMatchObject({ purchased: 10, paymentHold: true });
    expect((await submit(user.token, "dQw4w9WgXcQ")).statusCode).toBe(409);
  });
  it("serializa exportação por usuário/ciclo e libera trava ao concluir", async () => {
    const user = await register(), round = await readyRound(user.userId);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.includes("oauth2")) { entered(); await gate; return response({ access_token: "test-access" }); }
      if (options?.method === "POST") return response({ id: "test-playlist" });
      return response({ items: [] });
    });
    const first = app.inject({ method: "POST", url: `/rounds/${round}/export`, headers: headers(user.token) });
    await started;
    const second = await app.inject({ method: "POST", url: `/rounds/${round}/export`, headers: headers(user.token) });
    expect(second.statusCode).toBe(409); release();
    expect((await first).statusCode).toBe(200);
    expect((db.prepare("SELECT count(*) AS n FROM export_locks").get() as { n: number }).n).toBe(0);
    const before = fetchMock.mock.calls.length;
    expect((await app.inject({ method: "POST", url: `/rounds/${round}/export`, headers: headers(user.token) })).statusCode).toBe(200);
    expect(fetchMock.mock.calls.length).toBe(before);
  });
  it("retomada confere vídeos remotos antes de inserir e evita repetição", async () => {
    let inserted = 0;
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.includes("oauth2")) return response({ access_token: "test-access" });
      if (options?.method === "POST") { inserted++; return response({ id: "item" }); }
      return response({ items: [{ snippet: { position: 0, resourceId: { videoId: "dQw4w9WgXcQ" } } }] });
    });
    await createPrivatePlaylist(config, "refresh", "title", ["dQw4w9WgXcQ", "9bZkp7q19f0"], { playlistId: "existing", addedCount: 0 });
    expect(inserted).toBe(1);
  });
  it("não altera playlist modificada pelo usuário", async () => {
    fetchMock.mockImplementation(async (url: string) => url.includes("oauth2") ? response({ access_token: "test-access" }) : response({ items: [{ snippet: { position: 0, resourceId: { videoId: "different01" } } }] }));
    await expect(createPrivatePlaylist(config, "refresh", "title", ["dQw4w9WgXcQ"], { playlistId: "existing", addedCount: 1 })).rejects.toThrow("alterada");
    expect(fetchMock.mock.calls.every(([, opts]) => (opts as RequestInit | undefined)?.method !== "POST" || String(opts?.body).includes("grant_type"))).toBe(true);
  });
});

describe("configuração de produção", () => {
  it("recusa modos demo e configuração padrão", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow();
    expect(() => loadConfig({ NODE_ENV: "production", AUTH_DEV_MODE: "false", PAYMENTS_DEV_MODE: "false" })).toThrow();
  });
});
