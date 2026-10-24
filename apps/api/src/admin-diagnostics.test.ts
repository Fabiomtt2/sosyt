// AUDITORIA / "Se não consigo ver o que está tudo ativo, não tenho como observar bugs."
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { activeRounds, joinRound } from "./queues.js";

describe("diagnóstico e controle de filas do Owner", () => {
  let db: AppDatabase; let app: Awaited<ReturnType<typeof buildApp>>; let config: Config; let token: string;
  const owner = { name: "Fábio", identifier: "+55 71 [9]9999-0001", groupCode: "#", secret: "diag-owner-secret-32-characters-long" };
  beforeEach(async () => {
    config = loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:", AUTH_DEV_MODE: "true", PAYMENTS_DEV_MODE: "true",
      JWT_SECRET: "diag-test-secret-32-characters-okay", AUTH_CODE_PEPPER: "diag-pepper-32-characters-okay",
      OWNER_FABIO_NAME: owner.name, OWNER_FABIO_ID: "fabio", OWNER_FABIO_SECRET: owner.secret,
      OWNER_FABIO_WHATSAPP: "5571999990001", YOUTUBE_API_KEY: undefined });
    db = createDatabase(":memory:"); app = await buildApp(config, db);
    const login = await app.inject({ method: "POST", url: "/admin/login", payload: owner });
    expect(login.statusCode, login.body).toBe(200); token = login.json().token;
  });
  afterEach(async () => { await app.close(); db.close(); });
  const headers = () => ({ authorization: `Bearer ${token}` });

  it("mostra de uma vez o que está ativo: gamificação, IA, bot e filas", async () => {
    const r = await app.inject({ method: "GET", url: "/admin/diagnostics", headers: headers() });
    expect(r.statusCode, r.body).toBe(200);
    const d = r.json();
    // a flag que esconde a Jornada inteira precisa estar VISIVEL aqui
    expect(d.gamificacao).toHaveProperty("ativa");
    // a IA precisa dizer se esta ligada e quanto usou — era impossivel saber
    expect(d.ia).toMatchObject({ ativa: expect.any(Boolean), chaveConfigurada: expect.any(Boolean) });
    expect(d.ia.hoje).toMatchObject({ calls: expect.any(Number), hits: expect.any(Number) });
    expect(d.filas).toHaveProperty("vazias");
    expect(d.bot).toHaveProperty("modo");
  });

  it("nunca devolve segredo — só se a credencial existe", async () => {
    const corpo = (await app.inject({ method: "GET", url: "/admin/diagnostics", headers: headers() })).body;
    expect(corpo).not.toContain(owner.secret);
    expect(corpo).not.toMatch(/gsk_[A-Za-z0-9]/);        // chave da IA
    expect(corpo).not.toContain("diag-test-secret");     // JWT
  });

  it("o Owner fecha uma fila vazia (antes nao havia como; elas ficavam 72h na tela)", async () => {
    const fila = activeRounds(db)[0]!;
    const r = await app.inject({ method: "POST", url: `/admin/rounds/${fila.id}/close`, headers: headers() });
    expect(r.statusCode, r.body).toBe(200);
    expect(activeRounds(db).some(f => f.id === fila.id)).toBe(false);
  });

  it("RECUSA fechar fila com gente dentro — ninguem perde trabalho por limpeza de tela", async () => {
    const stamp = new Date().toISOString(), userId = randomUUID();
    db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,?,?,'1',?,?)")
      .run(userId, "Participante", "5571988881111", stamp, stamp);
    const fila = activeRounds(db)[0]!;
    joinRound(db, fila.id, userId, "FREE");
    const r = await app.inject({ method: "POST", url: `/admin/rounds/${fila.id}/close`, headers: headers() });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("QUEUE_NOT_EMPTY");
    expect(activeRounds(db).some(f => f.id === fila.id), "a fila nao pode ter sido fechada").toBe(true);
  });

  it("fila inexistente devolve 404, nao erro de servidor", async () => {
    const r = await app.inject({ method: "POST", url: `/admin/rounds/${randomUUID()}/close`, headers: headers() });
    expect(r.statusCode).toBe(404);
  });
  // AUDITORIA / "outras pessoas não conseguem criar playlist" — relato do dono, sem
  // nenhum numero por tras. Enquanto a tela de permissao do Google estiver em modo
  // Teste, todo e-mail fora da lista recebe access_denied: o participante ve bloqueio
  // e nos nao viamos nada. Diagnostico por relato solto e adivinhacao.
  it("conta as recusas do Google e aponta a causa provável", async () => {
    const { recordYouTubeDenial } = await import("./youtube-denials.js");
    const stamp = new Date().toISOString();
    for (const id of ["p1", "p1", "p2"]) {
      db.prepare("INSERT OR IGNORE INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,?,?,'1',?,?)")
        .run(id, id, "55719000000" + id.slice(1), stamp, stamp);
      recordYouTubeDenial(db, id, "access_denied");
    }
    const d = (await app.inject({ method: "GET", url: "/admin/diagnostics", headers: headers() })).json();
    expect(d.youtube.recusas.recusasNaSemana).toBe(3);
    expect(d.youtube.recusas.pessoasAfetadas, "três recusas, duas pessoas").toBe(2);
    expect(d.youtube.recusas.causaProvavel).toContain("modo Teste");
  });

  it("sem recusas, não inventa problema", async () => {
    const d = (await app.inject({ method: "GET", url: "/admin/diagnostics", headers: headers() })).json();
    expect(d.youtube.recusas.recusasNaSemana).toBe(0);
    expect(d.youtube.recusas.causaProvavel).toBeNull();
  });
});
