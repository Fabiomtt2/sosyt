import { createHash, randomInt, randomUUID } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { z } from "zod";
import type { Config } from "./config.js";
import { createDatabase, ensureOpenRound, type AppDatabase } from "./db.js";
import { createPixPayment, fetchMercadoPagoPayment } from "./payments.js";
import {
  createPrivatePlaylist,
  decryptToken,
  encryptToken,
  exchangeGoogleCode,
  googleAuthorizationUrl,
  verifyYouTubeVideo
} from "./youtube.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; purpose?: string; returnTo?: string };
    user: { sub: string; purpose?: string; returnTo?: string };
  }
}

const requestCodeSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().regex(/^\d{10,15}$/)),
  groupCode: z.string().trim().regex(/^[1-9]+$/, "Use somente algarismos de 1 a 9.")
});
const verifyCodeSchema = z.object({
  phone: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().regex(/^\d{10,15}$/)),
  code: z.string().regex(/^\d{6}$/)
});
const submitSchema = z.object({ url: z.string().trim().min(1).max(500) });
const pixSchema = z.object({ email: z.string().email(), cpf: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().length(11)) });

type Row = Record<string, unknown>;

function codeHash(config: Config, phone: string, code: string): string {
  return createHash("sha256").update(`${config.AUTH_CODE_PEPPER}:${phone}:${code}`).digest("hex");
}

function centsToCredits(millis: number): number {
  return millis / 1000;
}

function authGuard(request: FastifyRequest, reply: FastifyReply) {
  return request.jwtVerify().catch(() => reply.code(401).send({ message: "Sessão inválida ou expirada." }));
}

function getUser(db: AppDatabase, userId: string) {
  return db.prepare("SELECT id, name, phone, group_code AS groupCode FROM users WHERE id = ?").get(userId) as Row | undefined;
}

function walletView(db: AppDatabase, userId: string) {
  const wallet = db.prepare(`SELECT promo_millis AS promo, purchased_millis AS purchased,
    reward_millis AS reward, extra_slot_passes AS extraPasses FROM wallets WHERE user_id = ?`).get(userId) as {
      promo: number; purchased: number; reward: number; extraPasses: number;
    };
  return {
    promo: centsToCredits(wallet.promo),
    purchased: centsToCredits(wallet.purchased),
    reward: centsToCredits(wallet.reward),
    total: centsToCredits(wallet.promo + wallet.purchased + wallet.reward),
    extraPasses: wallet.extraPasses
  };
}

function roundView(db: AppDatabase, roundId: string) {
  const round = db.prepare("SELECT id, sequence, status, created_at AS createdAt, completed_at AS completedAt FROM rounds WHERE id = ?").get(roundId) as Row;
  const submissions = db.prepare(`SELECT s.id, s.slot, s.youtube_url AS youtubeUrl, s.video_id AS videoId,
    s.created_at AS createdAt, u.id AS userId, u.name AS userName, u.group_code AS groupCode
    FROM submissions s JOIN users u ON u.id = s.user_id WHERE s.round_id = ? ORDER BY s.slot`).all(roundId) as Row[];
  const bySlot = new Map(submissions.map((item) => [item.slot, item]));
  return { ...round, slots: Array.from({ length: 10 }, (_, index) => bySlot.get(index + 1) ?? { slot: index + 1 }) };
}

function settlePayment(db: AppDatabase, paymentId: string): boolean {
  return db.transaction(() => {
    const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId) as {
      id: string; user_id: string; status: string; credits_millis: number; extra_passes: number;
    } | undefined;
    if (!payment || payment.status === "APPROVED") return false;
    const now = new Date().toISOString();
    db.prepare("UPDATE payments SET status = 'APPROVED', approved_at = ? WHERE id = ?").run(now, payment.id);
    db.prepare(`UPDATE wallets SET purchased_millis = purchased_millis + ?, extra_slot_passes = extra_slot_passes + ?, updated_at = ?
      WHERE user_id = ?`).run(payment.credits_millis, payment.extra_passes, now, payment.user_id);
    db.prepare("INSERT INTO wallet_ledger (id, user_id, kind, amount_millis, reference_id, created_at) VALUES (?, ?, 'PIX_PURCHASE', ?, ?, ?)")
      .run(randomUUID(), payment.user_id, payment.credits_millis, payment.id, now);
    return true;
  })();
}

function debitContribution(db: AppDatabase, userId: string) {
  const wallet = db.prepare("SELECT promo_millis AS promo, reward_millis AS reward, purchased_millis AS purchased FROM wallets WHERE user_id = ?").get(userId) as {
    promo: number; reward: number; purchased: number;
  };
  if (wallet.promo + wallet.reward + wallet.purchased < 1000) throw new Error("Saldo insuficiente para salvar este link.");
  let remaining = 1000;
  const promo = Math.min(wallet.promo, remaining); remaining -= promo;
  const reward = Math.min(wallet.reward, remaining); remaining -= reward;
  const purchased = remaining;
  db.prepare(`UPDATE wallets SET promo_millis = promo_millis - ?, reward_millis = reward_millis - ?,
    purchased_millis = purchased_millis - ?, updated_at = ? WHERE user_id = ?`)
    .run(promo, reward, purchased, new Date().toISOString(), userId);
}

export async function buildApp(config: Config, providedDb?: AppDatabase) {
  const db = providedDb ?? createDatabase(config.DATABASE_PATH);
  const app = Fastify({ logger: config.NODE_ENV !== "test" });
  await app.register(cors, { origin: config.WEB_APP_URL, credentials: false });
  await app.register(jwt, { secret: config.JWT_SECRET, sign: { expiresIn: "30d" } });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ message: error.issues[0]?.message ?? "Dados inválidos." });
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(error);
    return reply.code(status).send({ message: status >= 500 ? error.message || "Erro interno." : error.message });
  });

  app.get("/health", async () => ({ ok: true }));

  app.post("/auth/request-code", async (request, reply) => {
    if (!config.AUTH_DEV_MODE) return reply.code(501).send({ message: "Conecte um provedor WhatsApp para entregar o código em produção." });
    const body = requestCodeSchema.parse(request.body);
    const code = String(randomInt(100000, 1_000_000));
    const now = new Date();
    db.prepare(`INSERT INTO login_codes (id, phone, name, group_code, code_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), body.phone, body.name, body.groupCode, codeHash(config, body.phone, code), new Date(now.getTime() + 10 * 60_000).toISOString(), now.toISOString());
    return reply.send({ ok: true, expiresInSeconds: 600, devCode: code });
  });

  app.post("/auth/verify", async (request, reply) => {
    const body = verifyCodeSchema.parse(request.body);
    const row = db.prepare(`SELECT * FROM login_codes WHERE phone = ? AND used_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC LIMIT 1`).get(body.phone, new Date().toISOString()) as {
        id: string; name: string; phone: string; group_code: string; code_hash: string;
      } | undefined;
    if (!row || row.code_hash !== codeHash(config, body.phone, body.code)) return reply.code(401).send({ message: "Código inválido ou expirado." });
    const now = new Date().toISOString();
    let user = db.prepare("SELECT id FROM users WHERE phone = ?").get(body.phone) as { id: string } | undefined;
    db.transaction(() => {
      db.prepare("UPDATE login_codes SET used_at = ? WHERE id = ?").run(now, row.id);
      if (!user) {
        user = { id: randomUUID() };
        db.prepare("INSERT INTO users (id, name, phone, group_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(user.id, row.name, row.phone, row.group_code, now, now);
        db.prepare("INSERT INTO wallets (user_id, updated_at) VALUES (?, ?)").run(user.id, now);
        db.prepare("INSERT INTO wallet_ledger (id, user_id, kind, amount_millis, reference_id, created_at) VALUES (?, ?, 'WELCOME', 10000, NULL, ?)")
          .run(randomUUID(), user.id, now);
      } else {
        db.prepare("UPDATE users SET name = ?, group_code = ?, updated_at = ? WHERE id = ?").run(row.name, row.group_code, now, user.id);
      }
    })();
    return reply.send({ token: app.jwt.sign({ sub: user!.id }), user: getUser(db, user!.id) });
  });

  app.get("/dashboard", { preHandler: authGuard }, async (request) => {
    ensureOpenRound(db);
    const open = db.prepare("SELECT id FROM rounds WHERE status = 'OPEN' ORDER BY sequence DESC LIMIT 1").get() as { id: string };
    const ready = db.prepare(`SELECT DISTINCT r.id FROM rounds r JOIN submissions s ON s.round_id = r.id
      WHERE r.status = 'READY' AND s.user_id = ? ORDER BY r.sequence DESC LIMIT 5`).all(request.user.sub) as Array<{ id: string }>;
    const contributionCount = db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE round_id = ? AND user_id = ?")
      .get(open.id, request.user.sub) as { count: number };
    const connection = db.prepare("SELECT 1 FROM youtube_connections WHERE user_id = ?").get(request.user.sub);
    const exports = db.prepare("SELECT round_id AS roundId, status, youtube_playlist_id AS playlistId FROM playlist_exports WHERE user_id = ?")
      .all(request.user.sub) as Array<{ roundId: string; status: string; playlistId?: string }>;
    return {
      user: getUser(db, request.user.sub),
      wallet: walletView(db, request.user.sub),
      openRound: roundView(db, open.id),
      readyRounds: ready.map(({ id }) => ({ ...roundView(db, id), export: exports.find((entry) => entry.roundId === id) })),
      viewer: { contributionsInOpenRound: contributionCount.count, youtubeConnected: Boolean(connection) }
    };
  });

  app.post("/rounds/current/submissions", { preHandler: authGuard }, async (request, reply) => {
    const body = submitSchema.parse(request.body);
    const verified = await verifyYouTubeVideo(body.url, config.YOUTUBE_API_KEY);
    try {
      const result = db.transaction(() => {
        const open = db.prepare("SELECT id, sequence FROM rounds WHERE status = 'OPEN' ORDER BY sequence DESC LIMIT 1").get() as { id: string; sequence: number };
        const next = db.prepare("SELECT COUNT(*) + 1 AS slot FROM submissions WHERE round_id = ?").get(open.id) as { slot: number };
        if (next.slot > 10) throw new Error("Este ciclo já foi concluído. Atualize a página.");
        const previous = db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE round_id = ? AND user_id = ?").get(open.id, request.user.sub) as { count: number };
        if (previous.count > 0) {
          const changed = db.prepare("UPDATE wallets SET extra_slot_passes = extra_slot_passes - 1 WHERE user_id = ? AND extra_slot_passes > 0")
            .run(request.user.sub);
          if (!changed.changes) throw new Error("Você já contribuiu neste ciclo. Uma compra aprovada libera uma posição extra.");
        }
        debitContribution(db, request.user.sub);
        const submissionId = randomUUID();
        const now = new Date().toISOString();
        db.prepare(`INSERT INTO submissions (id, round_id, slot, user_id, youtube_url, video_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(submissionId, open.id, next.slot, request.user.sub, verified.canonicalUrl, verified.videoId, now);
        db.prepare("INSERT INTO wallet_ledger (id, user_id, kind, amount_millis, reference_id, created_at) VALUES (?, ?, 'SUBMISSION', -1000, ?, ?)")
          .run(randomUUID(), request.user.sub, submissionId, now);

        if (next.slot === 10) {
          db.prepare("UPDATE rounds SET status = 'READY', completed_at = ? WHERE id = ?").run(now, open.id);
          const contributors = db.prepare("SELECT DISTINCT user_id AS userId FROM submissions WHERE round_id = ?").all(open.id) as Array<{ userId: string }>;
          for (const contributor of contributors) {
            db.prepare("UPDATE wallets SET reward_millis = reward_millis + 1000, updated_at = ? WHERE user_id = ?").run(now, contributor.userId);
            db.prepare("INSERT OR IGNORE INTO wallet_ledger (id, user_id, kind, amount_millis, reference_id, created_at) VALUES (?, ?, 'CURATION_REWARD', 1000, ?, ?)")
              .run(randomUUID(), contributor.userId, open.id, now);
          }
          db.prepare("INSERT INTO rounds (id, sequence, status, created_at) VALUES (?, ?, 'OPEN', ?)")
            .run(randomUUID(), open.sequence + 1, now);
        }
        return { submissionId, slot: next.slot, roundCompleted: next.slot === 10 };
      })();
      return reply.code(201).send(result);
    } catch (error) {
      return reply.code(409).send({ message: error instanceof Error ? error.message : "Não foi possível salvar o link." });
    }
  });

  app.post("/payments/pix", { preHandler: authGuard }, async (request, reply) => {
    const body = pixSchema.parse(request.body);
    const user = getUser(db, request.user.sub)!;
    const paymentId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO payments (id, user_id, provider, status, amount_cents, credits_millis, extra_passes, created_at)
      VALUES (?, ?, ?, 'PENDING', 2000, 20000, 1, ?)`)
      .run(paymentId, request.user.sub, config.MERCADO_PAGO_ACCESS_TOKEN ? "MERCADO_PAGO" : "DEMO", now);
    try {
      const pix = await createPixPayment(config, { paymentId, email: body.email, cpf: body.cpf, name: String(user.name) });
      db.prepare(`UPDATE payments SET provider_payment_id = ?, status = ?, qr_code = ?, qr_code_base64 = ?, ticket_url = ? WHERE id = ?`)
        .run(pix.providerPaymentId, pix.status, pix.qrCode ?? null, pix.qrCodeBase64 ?? null, pix.ticketUrl ?? null, paymentId);
      if (pix.status === "APPROVED") settlePayment(db, paymentId);
      return reply.code(201).send({ id: paymentId, ...pix });
    } catch (error) {
      db.prepare("UPDATE payments SET status = 'REJECTED' WHERE id = ?").run(paymentId);
      throw error;
    }
  });

  app.post("/payments/:id/demo-approve", { preHandler: authGuard }, async (request, reply) => {
    if (!config.PAYMENTS_DEV_MODE || config.NODE_ENV === "production") return reply.code(404).send({ message: "Rota indisponível." });
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const owned = db.prepare("SELECT id FROM payments WHERE id = ? AND user_id = ? AND provider = 'DEMO'").get(id, request.user.sub);
    if (!owned) return reply.code(404).send({ message: "Pagamento não encontrado." });
    settlePayment(db, id);
    return { ok: true };
  });

  app.post("/payments/webhooks/mercado-pago", async (request, reply) => {
    const body = request.body as { data?: { id?: string } };
    const query = request.query as { id?: string; "data.id"?: string };
    const providerId = body?.data?.id ?? query["data.id"] ?? query.id;
    if (!providerId) return reply.code(200).send({ ok: true });
    const confirmation = await fetchMercadoPagoPayment(config, providerId);
    if (confirmation.internalId && confirmation.status === "APPROVED") settlePayment(db, confirmation.internalId);
    return reply.code(200).send({ ok: true });
  });

  app.get("/youtube/connect", { preHandler: authGuard }, async (request) => {
    const returnTo = (request.query as { returnTo?: string }).returnTo === "app" ? "app" : "web";
    const state = app.jwt.sign({ sub: request.user.sub, purpose: "youtube-oauth", returnTo }, { expiresIn: "10m" });
    return { url: googleAuthorizationUrl(config, state) };
  });

  app.get("/youtube/callback", async (request, reply) => {
    const query = z.object({ code: z.string(), state: z.string() }).parse(request.query);
    const state = app.jwt.verify<{ sub: string; purpose?: string; returnTo?: string }>(query.state);
    if (state.purpose !== "youtube-oauth") return reply.code(400).send("Estado OAuth inválido.");
    const tokens = await exchangeGoogleCode(config, query.code);
    db.prepare(`INSERT INTO youtube_connections (user_id, refresh_token_cipher, scope, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET refresh_token_cipher = excluded.refresh_token_cipher, scope = excluded.scope, updated_at = excluded.updated_at`)
      .run(state.sub, encryptToken(tokens.refreshToken, config), tokens.scope, new Date().toISOString());
    return reply.redirect(state.returnTo === "app" ? "conexaoyoutube://oauth?status=connected" : `${config.WEB_APP_URL}?youtube=connected`);
  });

  app.post("/rounds/:id/export", { preHandler: authGuard }, async (request, reply) => {
    const roundId = z.string().uuid().parse((request.params as { id: string }).id);
    const round = db.prepare("SELECT sequence, status FROM rounds WHERE id = ?").get(roundId) as { sequence: number; status: string } | undefined;
    if (!round || round.status !== "READY") return reply.code(409).send({ message: "Este ciclo ainda não está pronto." });
    const contributed = db.prepare("SELECT 1 FROM submissions WHERE round_id = ? AND user_id = ?").get(roundId, request.user.sub);
    if (!contributed) return reply.code(403).send({ message: "A exportação é exclusiva para participantes deste ciclo." });
    const connection = db.prepare("SELECT refresh_token_cipher AS token FROM youtube_connections WHERE user_id = ?").get(request.user.sub) as { token: string } | undefined;
    if (!connection) return reply.code(409).send({ message: "Conecte sua conta do YouTube primeiro." });
    const videos = db.prepare("SELECT video_id AS videoId FROM submissions WHERE round_id = ? ORDER BY slot").all(roundId) as Array<{ videoId: string }>;
    const now = new Date().toISOString();
    let exportRow = db.prepare("SELECT id, youtube_playlist_id AS playlistId, added_count AS addedCount, status FROM playlist_exports WHERE round_id = ? AND user_id = ?")
      .get(roundId, request.user.sub) as { id: string; playlistId?: string; addedCount: number; status: string } | undefined;
    if (exportRow?.status === "SUCCESS") return { ok: true, playlistId: exportRow.playlistId };
    if (!exportRow) {
      exportRow = { id: randomUUID(), addedCount: 0, status: "PENDING" };
      db.prepare("INSERT INTO playlist_exports (id, round_id, user_id, status, created_at, updated_at) VALUES (?, ?, ?, 'PENDING', ?, ?)")
        .run(exportRow.id, roundId, request.user.sub, now, now);
    }
    try {
      const playlistId = await createPrivatePlaylist(
        config,
        decryptToken(connection.token, config),
        `Conexão Youtube — Ciclo ${round.sequence}`,
        videos.map((video) => video.videoId),
        { playlistId: exportRow.playlistId, addedCount: exportRow.addedCount },
        (id, count) => db.prepare("UPDATE playlist_exports SET youtube_playlist_id = ?, added_count = ?, status = 'PENDING', updated_at = ? WHERE id = ?")
          .run(id, count, new Date().toISOString(), exportRow!.id)
      );
      db.prepare("UPDATE playlist_exports SET status = 'SUCCESS', error = NULL, updated_at = ? WHERE id = ?").run(new Date().toISOString(), exportRow.id);
      return { ok: true, playlistId };
    } catch (error) {
      db.prepare("UPDATE playlist_exports SET status = 'FAILED', error = ?, updated_at = ? WHERE id = ?")
        .run(error instanceof Error ? error.message : "Falha desconhecida", new Date().toISOString(), exportRow.id);
      throw error;
    }
  });

  app.addHook("onClose", async () => { if (!providedDb) db.close(); });
  return app;
}

