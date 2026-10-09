// Testes acrescentados pela AUDITORIA EXTERNA (Claude) sobre o projeto do ASTRA.
// Cada caso falha no código original e passa com as correções propostas.
// O projeto é do ASTRA; estes testes são prova de achado, não mudança de produto.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { loadConfig, devAuthEnabled, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { encryptToken, verifyYouTubeVideo, parseIsoDurationSeconds } from "./youtube.js";
import { readYouTubeIntegration, saveYouTubeIntegration, effectiveYouTubeApiKey } from "./integrations.js";
import { normalizePhone } from "./phone.js";

const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

describe("auditoria externa — motor e verificação de vídeo", () => {
  let db: AppDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let config: Config;

  beforeEach(async () => {
    config = loadConfig({
      REQUIRE_GROUP_MEMBERSHIP: "false", NODE_ENV: "test", DATABASE_PATH: ":memory:",
      AUTH_DEV_MODE: "true", PAYMENTS_DEV_MODE: "true",
      JWT_SECRET: "audit-test-secret-32-characters-ok", AUTH_CODE_PEPPER: "audit-test-pepper",
      YOUTUBE_API_KEY: undefined, MERCADO_PAGO_ACCESS_TOKEN: undefined
    });
    db = createDatabase(":memory:");
    app = await buildApp(config, db);
  });
  afterEach(async () => { await app.close(); db.close(); vi.unstubAllGlobals(); });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function register(phone = "71999999201") {
    const normalized = normalizePhone(phone), stamp = new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO groups(code,enabled,membership_mode) VALUES ('12',1,'OWNER')").run();
    db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES (?,'12',?,'TEST')").run(normalized, stamp);
    const requested = await app.inject({ method: "POST", url: "/auth/request-code", payload: { name: "Pessoa Auditoria", phone } });
    const verified = await app.inject({ method: "POST", url: "/auth/verify", payload: { phone, code: requested.json().devCode } });
    expect(verified.statusCode).toBe(200);
    return { token: verified.json().token as string, userId: verified.json().user.id as string };
  }

  /** Monta uma fila pronta. durationSeconds=null simula contribuição sem duração verificada. */
  async function readyRound(userId: string, durationSeconds: number | null) {
    const round = db.prepare("SELECT id FROM rounds WHERE status='OPEN'").get() as { id: string };
    const stamp = new Date().toISOString();
    for (let slot = 1; slot <= 10; slot++) {
      db.prepare("INSERT INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,created_at,video_duration_seconds) VALUES (?,?,?,?,?,?,?,?)")
        .run(randomUUID(), round.id, slot, userId, `https://youtu.be/aud${String(slot).padStart(8, "0")}`, `aud${String(slot).padStart(8, "0")}`, stamp, durationSeconds);
    }
    db.prepare("UPDATE rounds SET status='READY',completed_at=? WHERE id=?").run(stamp, round.id);
    db.prepare("INSERT INTO youtube_connections(user_id,refresh_token_cipher,scope,updated_at) VALUES (?,?,?,?)")
      .run(userId, encryptToken("refresh", config), "youtube", stamp);
    db.prepare("INSERT INTO playlist_exports(id,round_id,user_id,youtube_playlist_id,status,added_count,created_at,updated_at) VALUES (?,?,?,?, 'SUCCESS',10,?,?)")
      .run(randomUUID(), round.id, userId, "playlist-audit", stamp, stamp);
    return round.id;
  }
  const observe = (token: string, roundId: string, body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/rounds/${roundId}/watch-observation`, headers: auth(token), payload: body });
  const ageState = (userId: string, millis: number) =>
    db.prepare("UPDATE watch_observation_state SET observed_at=? WHERE user_id=?")
      .run(new Date(Date.now() - millis).toISOString(), userId);

  // ===================== M-01 =====================
  it("M-01: duração declarada pelo cliente não conclui a fila nem fabrica 100%", async () => {
    // Vídeos de 600s confirmados pelo servidor; o cliente mente dizendo 1s.
    const user = await register("71999999202"), roundId = await readyRound(user.userId, 600);
    const sessionId = randomUUID();
    for (let videoIndex = 0; videoIndex < 10; videoIndex++) {
      await observe(user.token, roundId, { sessionId, videoIndex, playerSeconds: 0, duration: 1, playbackRate: 1, playing: true, visible: true });
      ageState(user.userId, 1500);
      const tick = await observe(user.token, roundId, { sessionId, videoIndex, playerSeconds: 1, duration: 1, playbackRate: 1, playing: true, visible: true });
      expect(tick.statusCode).toBe(200);
      // A duração do servidor (600s) prevalece sobre a declarada (1s).
      expect(tick.json().durations[videoIndex]).toBe(600);
      expect(tick.json().finalizedAt).toBeUndefined();
    }
    const progress = db.prepare("SELECT finalized_at AS finalizedAt, percent FROM playlist_watch_progress WHERE round_id=? AND user_id=?")
      .get(roundId, user.userId) as { finalizedAt: string | null; percent: number };
    expect(progress.finalizedAt).toBeNull();
    expect(progress.percent).toBeLessThan(100);
  });

  it("M-01: sem duração verificada a conclusão automática fica bloqueada", async () => {
    const user = await register("71999999203"), roundId = await readyRound(user.userId, null);
    const sessionId = randomUUID();
    await observe(user.token, roundId, { sessionId, videoIndex: 0, playerSeconds: 0, duration: 5, playbackRate: 1, playing: true, visible: true });
    const intervals = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i), [[0, 5]]]));
    db.prepare("UPDATE playlist_watch_progress SET observed_intervals_json=?,durations_json=? WHERE round_id=? AND user_id=?")
      .run(JSON.stringify(intervals), JSON.stringify(Array(10).fill(5)), roundId, user.userId);
    ageState(user.userId, 2000);
    const end = await observe(user.token, roundId, { sessionId, videoIndex: 0, playerSeconds: 5, duration: 5, playbackRate: 1, playing: false, visible: true });
    expect(end.json().finalizedAt).toBeUndefined();
  });

  it("M-01 preserva o acerto do ASTRA: o crédito segue limitado pelo tempo real de servidor", async () => {
    const user = await register("71999999204"), roundId = await readyRound(user.userId, 600);
    const sessionId = randomUUID();
    await observe(user.token, roundId, { sessionId, videoIndex: 0, playerSeconds: 0, duration: 600, playbackRate: 1, playing: true, visible: true });
    ageState(user.userId, 2000);
    // Cliente afirma ter avançado 500s; só ~2s reais passaram.
    const tick = await observe(user.token, roundId, { sessionId, videoIndex: 0, playerSeconds: 500, duration: 600, playbackRate: 1, playing: true, visible: true });
    expect(tick.json().acceptedSeconds).toBeLessThanOrEqual(2);
  });

  // ===================== M-02 / M-06 =====================
  it("M-02: vídeo sem incorporação é recusado quando há YOUTUBE_API_KEY", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      items: [{ status: { embeddable: false, privacyStatus: "public", uploadStatus: "processed" }, contentDetails: { duration: "PT3M20S" }, snippet: { title: "t" } }]
    })));
    await expect(verifyYouTubeVideo("https://youtu.be/dQw4w9WgXcQ", "chave-de-teste")).rejects.toThrow(/incorporada/i);
  });

  it("M-02: vídeo privado e vídeo não processado são recusados", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      items: [{ status: { embeddable: true, privacyStatus: "private" }, contentDetails: { duration: "PT1M" }, snippet: {} }]
    })));
    await expect(verifyYouTubeVideo("https://youtu.be/dQw4w9WgXcQ", "chave")).rejects.toThrow(/privado/i);
    vi.stubGlobal("fetch", vi.fn(async () => response({
      items: [{ status: { embeddable: true, uploadStatus: "uploaded" }, contentDetails: { duration: "PT1M" }, snippet: {} }]
    })));
    await expect(verifyYouTubeVideo("https://youtu.be/dQw4w9WgXcQ", "chave")).rejects.toThrow(/disponível/i);
  });

  it("M-01: a duração real do YouTube é lida de contentDetails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      items: [{ status: { embeddable: true, privacyStatus: "public", uploadStatus: "processed" }, contentDetails: { duration: "PT1H2M3S" }, snippet: { title: "t" } }]
    })));
    const info = await verifyYouTubeVideo("https://youtu.be/dQw4w9WgXcQ", "chave");
    expect(info.durationSeconds).toBe(3723);
  });

  it("M-06: sem API key, vídeo inexistente não entra na fila", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await expect(verifyYouTubeVideo("https://youtu.be/dQw4w9WgXcQ")).rejects.toThrow(/não existe|privado|incorporação/i);
  });

  it("M-06: falha de rede não é confundida com vídeo inválido", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("rede indisponível"); }));
    await expect(verifyYouTubeVideo("https://youtu.be/dQw4w9WgXcQ")).rejects.toThrow(/Tente novamente/i);
  });

  it("parseIsoDurationSeconds cobre formatos e rejeita lixo", () => {
    expect(parseIsoDurationSeconds("PT45S")).toBe(45);
    expect(parseIsoDurationSeconds("PT10M")).toBe(600);
    expect(parseIsoDurationSeconds("PT2H")).toBe(7200);
    expect(parseIsoDurationSeconds("P1DT1H1M1S")).toBe(90061);
    expect(parseIsoDurationSeconds("P0D")).toBeUndefined();
    expect(parseIsoDurationSeconds("abacaxi")).toBeUndefined();
    expect(parseIsoDurationSeconds(undefined)).toBeUndefined();
  });

  // ===================== I-01: YouTube gerenciavel pelo painel =====================
  it("I-01: sem chave, a integracao YouTube reporta STRUCTURAL_ONLY", () => {
    const state = readYouTubeIntegration(db, config);
    expect(state.apiKeyConfigured).toBe(false);
    expect(state.verification).toBe("STRUCTURAL_ONLY");
    expect(state.source).toBe("NONE");
    expect(effectiveYouTubeApiKey(db, config)).toBeUndefined();
  });

  it("I-01: chave salva pelo painel persiste cifrada e passa a valer sem reiniciar", () => {
    const saved = saveYouTubeIntegration(db, config, { apiKey: "AIzaSyExemploDeChaveDeTeste123456" });
    expect(saved.apiKeyConfigured).toBe(true);
    expect(saved.verification).toBe("VERIFIED");
    expect(saved.source).toBe("PANEL");
    // vale imediatamente, sem reiniciar o processo
    expect(effectiveYouTubeApiKey(db, config)).toBe("AIzaSyExemploDeChaveDeTeste123456");
    // o valor guardado no banco esta cifrado, nao em texto claro
    const stored = db.prepare("SELECT value FROM integration_settings WHERE key='youtube.api_key'").get() as { value: string };
    expect(stored.value).not.toContain("AIzaSyExemploDeChaveDeTeste123456");
    expect(stored.value.startsWith("v1.")).toBe(true);
  });

  it("I-01: o painel tem precedencia sobre o ambiente, e clear volta ao ambiente", () => {
    const withEnv = { ...config, YOUTUBE_API_KEY: "chave-do-ambiente-para-teste" };
    expect(effectiveYouTubeApiKey(db, withEnv)).toBe("chave-do-ambiente-para-teste");
    expect(readYouTubeIntegration(db, withEnv).source).toBe("ENVIRONMENT");
    saveYouTubeIntegration(db, withEnv, { apiKey: "AIzaSyChaveDoPainelPrevalece123" });
    expect(effectiveYouTubeApiKey(db, withEnv)).toBe("AIzaSyChaveDoPainelPrevalece123");
    saveYouTubeIntegration(db, withEnv, { clear: true });
    expect(effectiveYouTubeApiKey(db, withEnv)).toBe("chave-do-ambiente-para-teste");
  });

  // ===================== A-01 =====================
  it("A-01: devAuthEnabled ignora AUTH_DEV_MODE em produção", () => {
    expect(devAuthEnabled({ AUTH_DEV_MODE: true, NODE_ENV: "production" })).toBe(false);
    expect(devAuthEnabled({ AUTH_DEV_MODE: true, NODE_ENV: "development" })).toBe(true);
    expect(devAuthEnabled({ AUTH_DEV_MODE: true, NODE_ENV: "test" })).toBe(true);
    expect(devAuthEnabled({ AUTH_DEV_MODE: false, NODE_ENV: "development" })).toBe(false);
  });

  it("A-01: os modos de demonstração nascem desligados", () => {
    const bare = loadConfig({ NODE_ENV: "development", DATABASE_PATH: ":memory:" });
    expect(bare.AUTH_DEV_MODE).toBe(false);
    expect(bare.PAYMENTS_DEV_MODE).toBe(false);
  });

  // ===================== A-02 =====================
  it("A-02: sem OWNER_DEV_SECRET nenhuma credencial de atalho é aceita", async () => {
    const ownerConfig = loadConfig({
      NODE_ENV: "test", DATABASE_PATH: ":memory:", AUTH_DEV_MODE: "true", REQUIRE_GROUP_MEMBERSHIP: "false",
      JWT_SECRET: "audit-owner-secret-32-characters!!", AUTH_CODE_PEPPER: "audit-owner-pepper",
      OWNER_FABIO_NAME: "Fabio0", OWNER_FABIO_ID: "fabio0", OWNER_FABIO_SECRET: "fabio-secret-32-characters-long-ok",
      OWNER_FABIO_WHATSAPP: "5571999990001", YOUTUBE_API_KEY: undefined
    });
    const ownerDb = createDatabase(":memory:");
    const ownerApp = await buildApp(ownerConfig, ownerDb);
    try {
      expect(ownerConfig.OWNER_DEV_SECRET).toBeUndefined();
      const attempt = await ownerApp.inject({ method: "POST", url: "/admin/login",
        payload: { name: "Fabio0", identifier: "+55 71 [9] 9999-0001", groupCode: "#", secret: "sosyout" } });
      expect(attempt.statusCode).toBe(401);
    } finally { await ownerApp.close(); ownerDb.close(); }
  });
});
