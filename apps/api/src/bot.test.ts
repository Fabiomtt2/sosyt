// AUDITORIA / cérebro do bot: modos, flags e prontidão — tudo via painel, instantâneo.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { botStatus, botMode, featureEnabled, saveBotSettings } from "./bot.js";

describe("cérebro do bot (config no painel, tempo real)", () => {
  let db: AppDatabase; let app: Awaited<ReturnType<typeof buildApp>>; let config: Config;
  const ownerBody = { name: "Fabio0", identifier: "+55 71 [9] 9999-0001", groupCode: "#", secret: "fabio-secret-32-characters-long-okay" };
  beforeEach(async () => {
    config = loadConfig({
      NODE_ENV: "test", DATABASE_PATH: ":memory:", AUTH_DEV_MODE: "false", REQUIRE_GROUP_MEMBERSHIP: "false",
      JWT_SECRET: "bot-secret-32-characters-okay!!!!", AUTH_CODE_PEPPER: "bot-pepper-32-characters-okay!!!!",
      OWNER_FABIO_NAME: "Fabio0", OWNER_FABIO_ID: "fabio0", OWNER_FABIO_SECRET: "fabio-secret-32-characters-long-okay", OWNER_FABIO_WHATSAPP: "5571999990001",
      YOUTUBE_API_KEY: undefined
    });
    db = createDatabase(":memory:");
    app = await buildApp(config, db);
  });
  afterEach(async () => { await app.close(); db.close(); });
  const ownerToken = async () => (await app.inject({ method: "POST", url: "/admin/login", payload: ownerBody })).json().token as string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  it("começa DISABLED e aponta o que falta para ativar", () => {
    const st = botStatus(db, config);
    expect(st.mode).toBe("DISABLED");
    expect(st.fullyActive).toBe(false);
    expect(st.missing[0]).toMatch(/Escolha um modo/);
  });

  it("salvar modo/flags no painel vale na hora (sem reiniciar)", async () => {
    const token = await ownerToken();
    const save = await app.inject({ method: "POST", url: "/admin/bot", headers: auth(token), payload: { mode: "HYBRID", features: { GROUP_SYNC: true, BROADCAST: true } } });
    expect(save.statusCode).toBe(200);
    expect(botMode(db)).toBe("HYBRID_PLUS");
    expect(featureEnabled(db, "GROUP_SYNC")).toBe(true);
    expect(featureEnabled(db, "BROADCAST")).toBe(true);
    // efeito imediato no status
    expect(save.json().status.mode).toBe("HYBRID_PLUS");
  });

  it("HYBRID sem credenciais: funções ficam BLOQUEADAS com motivo, não ativas", async () => {
    saveBotSettings(db, { mode: "HYBRID" });
    const st = botStatus(db, config);
    expect(st.engines.messaging.ready).toBe(false);
    expect(st.engines.group.ready).toBe(false);
    const login = st.features.find((f) => f.code === "LOGIN_CODE")!;
    expect(login.active).toBe(false);
    expect(login.blockedReason).toMatch(/motor de mensagens/i);
    const group = st.features.find((f) => f.code === "GROUP_SYNC")!;
    expect(group.riskNote).toMatch(/risco de bloqueio/i);
    expect(st.missing.join(" ")).toMatch(/Meta Cloud API/);
  });

  it("credenciais oficiais prontas não declaram funções não integradas como ativas", () => {
    // simula credenciais oficiais prontas pelo painel (via integration_settings)
    const now = new Date().toISOString();
    const put = (k: string, v: string) => db.prepare("INSERT INTO integration_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, v, now);
    put("whatsapp.meta.waba_id", "123456789");
    put("whatsapp.meta.phone_number_id", "987654321");
    // segredos cifrados exigiriam seal(); para o teste, marcamos via env efetiva:
    const cfg = { ...config, WHATSAPP_BUSINESS_ACCOUNT_ID: "123456789", WHATSAPP_PHONE_NUMBER_ID: "987654321", WHATSAPP_ACCESS_TOKEN: "tok-aaaaaaaaaaaaaaaaaaaa", WHATSAPP_APP_SECRET: "app-secret-okay-123456", WHATSAPP_VERIFY_TOKEN: "verify-token-okay-123456" } as Config;
    saveBotSettings(db, { mode: "OFFICIAL" });
    const st = botStatus(db, cfg);
    expect(st.engines.messaging.ready).toBe(true);
    // AUDITORIA / pos-convergencia: as funcoes de mensageria FORAM ligadas ao runtime
    // (inbound, senha, filas, suporte, handoff, diarias), entao com o motor pronto elas
    // sao ATIVAS de verdade. O painel mentia ao marcar tudo como "bloqueada".
    expect(st.features.find((f) => f.code === "LOGIN_CODE")!.active).toBe(true);
    expect(st.features.find((f) => f.code === "LOGIN_CODE")!.blockedReason).toBeNull();
    expect(st.features.find((f) => f.code === "GROUP_SYNC")!.active).toBe(false); // OFFICIAL não gere grupo
    // GROUP_SYNC vem desligada por padrão, então não há motivo de bloqueio a reportar.
    expect(st.features.find((f) => f.code === "GROUP_SYNC")!.enabled).toBe(false);
  });

  it("não-ROOT não altera o bot", async () => {
    expect((await app.inject({ method: "POST", url: "/admin/bot", payload: { mode: "OFFICIAL" } })).statusCode).toBe(401);
  });
});
