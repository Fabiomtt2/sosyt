import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { createPrivatePlaylist, encryptToken } from "./youtube.js";

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

  async function code(phone: string, groupCode = "123") {
    const result = await app.inject({ method: "POST", url: "/auth/request-code", payload: { name: "Pessoa Teste", phone, groupCode } });
    expect(result.statusCode).toBe(200);
    return result.json().devCode as string;
  }
  async function register(phone = "71999999001", groupCode = "123") {
    const otp = await code(phone, groupCode);
    const result = await app.inject({ method: "POST", url: "/auth/verify", payload: { phone, code: otp } });
    expect(result.statusCode).toBe(200);
    return { token: result.json().token as string, userId: result.json().user.id as string };
  }
  const headers = (token: string) => ({ authorization: `Bearer ${token}` });
  async function dashboard(token: string) { return (await app.inject({ method: "GET", url: "/dashboard", headers: headers(token) })).json(); }
  async function submit(token: string, id: string) { return app.inject({ method: "POST", url: "/rounds/current/submissions", headers: headers(token), payload: { url: `https://youtu.be/${id}` } }); }
  async function pix(token: string) { return app.inject({ method: "POST", url: "/payments/pix", headers: headers(token), payload: { email: "test@example.com", cpf: "12345678901" } }); }
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
    db.prepare("INSERT INTO youtube_connections VALUES (?,?,?,?)").run(userId, encryptToken("test-refresh", config), "youtube", new Date().toISOString());
    return row.id;
  }

  it("mantém quadro global com autoria, grupo e horário", async () => {
    const a = await register(), b = await register("71999999002", "456");
    expect((await submit(a.token, "dQw4w9WgXcQ")).statusCode).toBe(201);
    const slot = (await dashboard(b.token)).openRound.slots[0];
    expect(slot.groupCode).toBe("123"); expect(slot.userName).toBe("Pessoa Teste"); expect(slot.createdAt).toBeTruthy();
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
    expect((await submit(users[0].token, "next0000001")).statusCode).toBe(201);
  });
  it("rejeita grupo zero e URL falsa sem débito", async () => {
    expect((await app.inject({ method: "POST", url: "/auth/request-code", payload: { name: "Teste", phone: "71999999001", groupCode: "0" } })).statusCode).toBe(400);
    const user = await register();
    expect((await app.inject({ method: "POST", url: "/rounds/current/submissions", headers: headers(user.token), payload: { url: "https://youtube.example/watch?v=dQw4w9WgXcQ" } })).statusCode).toBe(400);
    expect((await dashboard(user.token)).wallet.total).toBe(10);
  });
  it("passe comprado libera uma única contribuição extra e falha não o consome", async () => {
    const user = await register();
    expect((await submit(user.token, "dQw4w9WgXcQ")).statusCode).toBe(201);
    const payment = await pix(user.token);
    const approve = () => app.inject({ method: "POST", url: `/payments/${payment.json().id}/demo-approve`, headers: headers(user.token) });
    expect((await approve()).statusCode).toBe(200); await approve();
    expect((await dashboard(user.token)).wallet).toMatchObject({ purchased: 20, extraPasses: 1 });
    expect((await submit(user.token, "dQw4w9WgXcQ")).statusCode).toBe(409);
    expect((await dashboard(user.token)).wallet.extraPasses).toBe(1);
    expect((await submit(user.token, "9bZkp7q19f0")).statusCode).toBe(201);
    expect((await submit(user.token, "next0000001")).statusCode).toBe(409);
    expect((await dashboard(user.token)).wallet).toMatchObject({ purchased: 20, promo: 8, extraPasses: 0 });
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
    expect((await app.inject({ method: "POST", url: "/auth/request-code", payload: { name: "Teste", phone: "71999999001", groupCode: "123" } })).statusCode).toBe(429);
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    expect((await dashboard(user.token)).wallet).toMatchObject({ purchased: 20, extraPasses: 1 });
    const webhook = () => app.inject({ method: "POST", url: "/payments/webhooks/mercado-pago?data.id=901", headers: webhookHeaders(), payload: { data: { id: "901" } } });
    expect((await webhook()).statusCode).toBe(200); await webhook();
    expect((await dashboard(user.token)).wallet).toMatchObject({ purchased: 20, extraPasses: 1 });
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
    expect((await dashboard(user.token)).wallet.purchased).toBe(20);
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
    expect((await dashboard(user.token)).wallet).toMatchObject({ purchased: 20, paymentHold: true });
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
