// PROVA DE DEFESA M-01 contra o CLONE CORRIGIDO da auditoria, rodando local.
//
// O que se demonstra: no codigo que esta no ar, a rota PUT /rounds/:id/watch-progress
// confia nos numeros que o PROPRIO cliente envia (watchedSeconds/durations). Nao ha
// nenhuma verificacao de tempo real de servidor. Declarando duration:1 e
// watchedSeconds:1 em cada um dos dez videos, um participante:
//   (a) atinge percent=100 instantaneamente,
//   (b) recebe as 10 moedas de WATCH_PROGRESS no ledger,
//   (c) tem a tarefa FINALIZADA (finalized_at preenchido) — sem assistir nada.
//
// Isto NAO toca a base real; roda em :memory:. Config de producao: dev modes OFF.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { encryptToken } from "./youtube.js";
import { normalizePhone } from "./phone.js";

describe("DEFESA M-01: a rota legada do clone NAO premia nem finaliza por numeros do cliente", () => {
  let db: AppDatabase; let app: Awaited<ReturnType<typeof buildApp>>; let config: Config;
  beforeEach(async () => {
    config = loadConfig({
      NODE_ENV: "production", DATABASE_PATH: ":memory:",
      AUTH_DEV_MODE: "false", PAYMENTS_DEV_MODE: "false", REQUIRE_GROUP_MEMBERSHIP: "true",
      JWT_SECRET: "prod-like-secret-de-pelo-menos-32-chars", AUTH_CODE_PEPPER: "prod-like-pepper-de-32-caracteres-ok",
      WEB_APP_URL: "https://web.example.com", API_PUBLIC_URL: "https://api.example.com",
      GOOGLE_REDIRECT_URI: "https://api.example.com/youtube/callback",
      YOUTUBE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64")
    });
    db = createDatabase(":memory:"); app = await buildApp(config, db);
    // Nenhuma chamada externa deve acontecer nesta prova.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Nenhuma rede nesta prova"); }));
  });
  afterEach(async () => { await app.close(); db.close(); vi.unstubAllGlobals(); });

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  /** Cria uma vitima/participante legitimo diretamente no banco e devolve um JWT valido. */
  async function participante(phone: string) {
    const userId = randomUUID();
    const now = new Date().toISOString();
    const normalized = normalizePhone(phone);
    db.prepare("INSERT INTO groups(code,enabled,membership_mode) VALUES ('12',1,'OPEN') ON CONFLICT(code) DO NOTHING").run();
    // Participante legitimo e aprovado pelo Owner no grupo (como qualquer membro real).
    db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES (?, '12', ?, 'OWNER')").run(normalized, now);
    db.prepare("INSERT INTO users (id,name,phone,group_code,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run(userId, "Participante", normalized, "12", now, now);
    db.prepare("INSERT INTO wallets (user_id,promo_millis,reward_millis,purchased_millis,extra_slot_passes,payment_hold,updated_at) VALUES (?,?,?,?,?,?,?)")
      .run(userId, 0, 0, 0, 0, 0, now);
    // Sessao legitima: mesmas claims que o /auth/verify emite. nome/telefone/grupo
    // nao vao no token (o getUser le do banco); authMethod/authPhone sao a prova de
    // identidade que o hotfix C-01 exige.
    const token = app.jwt.sign({ sub: userId, purpose: "session", aud: "conexao-session", authMethod: "otp", authPhone: normalized });
    return { userId, token };
  }

  /** Deixa uma fila pronta (READY) com export de playlist com sucesso para o usuario. */
  function filaProntaComPlaylist(userId: string) {
    const row = db.prepare("SELECT id FROM rounds WHERE status = 'OPEN'").get() as { id: string };
    for (let slot = 1; slot <= 10; slot++) {
      db.prepare("INSERT INTO submissions (id,round_id,slot,user_id,youtube_url,video_id,created_at) VALUES (?,?,?,?,?,?,?)")
        .run(randomUUID(), row.id, slot, userId, `https://youtu.be/vid${String(slot).padStart(8, "0")}`, `vid${String(slot).padStart(8, "0")}`, new Date().toISOString());
    }
    db.prepare("UPDATE rounds SET status = 'READY' WHERE id = ?").run(row.id);
    db.prepare("INSERT INTO youtube_connections (user_id,refresh_token_cipher,scope,updated_at) VALUES (?,?,?,?)").run(userId, encryptToken("test-refresh", config), "youtube", new Date().toISOString());
    db.prepare("INSERT INTO playlist_exports (id,round_id,user_id,youtube_playlist_id,status,added_count,created_at,updated_at) VALUES (?,?,?,?, 'SUCCESS',10,?,?)")
      .run(randomUUID(), row.id, userId, "PL_fake", new Date().toISOString(), new Date().toISOString());
    return row.id;
  }

  it("mesmo PUT forjado: percent pode subir, mas 0 moedas e SEM finalizacao", async () => {
    const vitima = await participante("5571988887777");
    const roundId = filaProntaComPlaylist(vitima.userId);

    // Um unico POST com numeros inventados. 1 segundo assistido de 1 segundo de duracao = 100%.
    const forjado = {
      watchedSeconds: Array(10).fill(1),
      durations: Array(10).fill(1)
    };
    const t0 = Date.now();
    const resposta = await app.inject({
      method: "PUT", url: `/rounds/${roundId}/watch-progress`,
      headers: auth(vitima.token), payload: forjado
    });
    const decorridoMs = Date.now() - t0;

    expect(resposta.statusCode).toBe(200);
    const corpo = resposta.json();

    // A rota legada responde, mas declara o protocolo que NAO concede recompensa.
    expect(corpo.protocol).toBe("LEGACY_NO_REWARD_NO_FINALIZE");
    // (a) NENHUMA moeda nova — nem no corpo, nem no ledger
    expect(corpo.rewardDeltaCoins).toBe(0);
    const moedas = (db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE user_id=? AND kind IN ('WATCH_PROGRESS','WATCH_TIME')")
      .get(vitima.userId) as { n: number }).n;
    expect(moedas).toBe(0);
    // (b) tarefa NAO finalizada: numeros do cliente nao concluem fila
    const prog = db.prepare("SELECT finalized_at AS finalizedAt FROM playlist_watch_progress WHERE round_id=? AND user_id=?")
      .get(roundId, vitima.userId) as { finalizedAt?: string } | undefined;
    expect(prog?.finalizedAt ?? null).toBeNull();

    void decorridoMs;
    process.stdout.write(
      ">>> M-01 DEFENDIDO no clone: mesmo PUT forjado -> 0 moedas, sem finalizacao. " +
      "Recompensa so nasce de tempo verificado pelo servidor.\n"
    );
  });
});
