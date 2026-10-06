import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import { z } from "zod";
import { registerOwnerRoutes, hasMembership } from "./owner.js";
import { registerWhatsAppRoutes, sendWhatsAppOtp, whatsappConfigured } from "./whatsapp.js";
import { effectiveWhatsAppConfig } from "./integrations.js";
import { normalizePhone } from "./phone.js";
import type { Config } from "./config.js";
import { createDatabase, ensureOpenRound, type AppDatabase } from "./db.js";
import { createPixPayment, fetchMercadoPagoPayment, verifyWebhookSignature, type PaymentConfirmation } from "./payments.js";
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
    payload: { sub: string; purpose?: string; returnTo?: string; aud?: string; jti?: string; displayName?: string };
    user: { sub: string; purpose?: string; returnTo?: string; aud?: string; jti?: string; displayName?: string };
  }
}

const requestCodeSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().transform(normalizePhone).pipe(z.string().regex(/^[1-9]\d{7,14}$/, "Informe o WhatsApp com código do país.")),
  groupCode: z.string().trim().regex(/^(?:[1-9]|[1-9]\d)$/, "Informe um grupo SOS YOUTUBER entre 1 e 99.")
});
const verifyCodeSchema = z.object({
  phone: z.string().transform(normalizePhone).pipe(z.string().regex(/^[1-9]\d{7,14}$/, "Informe o WhatsApp com código do país.")),
  code: z.string().regex(/^\d{6}$/)
});
const submitSchema = z.object({ url: z.string().trim().min(1).max(500) });
const pixSchema = z.object({ email: z.string().email(), cpf: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().length(11)) });
const watchVectorSchema = z.array(z.number().finite().min(0).max(86_400)).length(10);
const watchProgressSchema = z.object({ watchedSeconds: watchVectorSchema, durations: watchVectorSchema });

type Row = Record<string, unknown>;

function watchPercent(watchedSeconds: number[], durations: number[]): number {
  return Math.min(100, Math.round(watchedSeconds.reduce((sum, watched, index) => {
    const duration = durations[index] ?? 0;
    return sum + (duration > 0 ? Math.min(1, watched / duration) : 0);
  }, 0) * 10));
}

function codeHash(config: Config, phone: string, code: string): string {
  return createHash("sha256").update(`${config.AUTH_CODE_PEPPER}:${phone}:${code}`).digest("hex");
}

function centsToCredits(millis: number): number {
  return millis / 1000;
}

async function verifySession(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    if (request.user.purpose !== "session" || request.user.aud !== "conexao-session") throw new Error("Wrong token purpose");
  } catch {
    return reply.code(401).send({ message: "Sessão inválida ou expirada." });
  }
}

function getUser(db: AppDatabase, userId: string) {
  return db.prepare("SELECT id, name, phone, group_code AS groupCode FROM users WHERE id = ?").get(userId) as Row | undefined;
}

function walletView(db: AppDatabase, userId: string) {
  const wallet = db.prepare(`SELECT promo_millis AS promo, purchased_millis AS purchased,
    reward_millis AS reward, extra_slot_passes AS extraPasses, payment_hold AS paymentHold FROM wallets WHERE user_id = ?`).get(userId) as {
      promo: number; purchased: number; reward: number; extraPasses: number; paymentHold: number;
    };
  return {
    promo: centsToCredits(wallet.promo),
    purchased: centsToCredits(wallet.purchased),
    reward: centsToCredits(wallet.reward),
    total: centsToCredits(wallet.promo + wallet.purchased + wallet.reward),
    extraPasses: wallet.extraPasses,
    paymentHold: Boolean(wallet.paymentHold)
  };
}

function cooldownState(db: AppDatabase, userId: string) {
  const row = db.prepare("SELECT cooldown_until AS cooldownUntil, cooldown_reason AS cooldownReason FROM users WHERE id = ?").get(userId) as
    | { cooldownUntil?: string; cooldownReason?: string }
    | undefined;
  if (!row?.cooldownUntil) return undefined;
  const until = Date.parse(row.cooldownUntil);
  if (!Number.isFinite(until) || until <= Date.now()) return undefined;
  return {
    cooldownUntil: row.cooldownUntil,
    cooldownReason: row.cooldownReason ?? "Intervalo após conclusão de uma fila",
    secondsRemaining: Math.max(1, Math.ceil((until - Date.now()) / 1000))
  };
}

function pendingReadyRound(db: AppDatabase, userId: string) {
  return db.prepare(`SELECT r.id, r.sequence FROM rounds r
    JOIN submissions s ON s.round_id = r.id
    LEFT JOIN playlist_watch_progress p ON p.round_id = r.id AND p.user_id = ?
    WHERE r.status = 'READY' AND s.user_id = ? AND p.finalized_at IS NULL
    ORDER BY r.sequence ASC LIMIT 1`).get(userId, userId) as { id: string; sequence: number } | undefined;
}

function finalizeRoundTask(db: AppDatabase, userId: string, roundId: string, reason: "COMPLETE" | "MANUAL") {
  const stamp = new Date();
  const current = db.prepare("SELECT finalized_at AS finalizedAt, percent FROM playlist_watch_progress WHERE round_id=? AND user_id=?")
    .get(roundId,userId) as { finalizedAt?: string; percent: number } | undefined;
  if (!current) throw new Error("Acompanhe a playlist antes de concluir esta tarefa.");
  if (current.finalizedAt) {
    const cooldown = cooldownState(db,userId);
    return { finalizedAt: current.finalizedAt, percent: current.percent, ...cooldown };
  }
  const finalizedAt = stamp.toISOString();
  const cooldownUntil = new Date(stamp.getTime()+30*60_000).toISOString();
  db.prepare("UPDATE playlist_watch_progress SET finalized_at=?, finalize_reason=? WHERE round_id=? AND user_id=?")
    .run(finalizedAt,reason,roundId,userId);
  db.prepare("UPDATE users SET cooldown_until=?, cooldown_reason=?, updated_at=? WHERE id=?")
    .run(cooldownUntil,`Fila concluída em ${current.percent}%`,finalizedAt,userId);
  return { finalizedAt, percent: current.percent, cooldownUntil, secondsRemaining: 1800 };
}

function roundView(db: AppDatabase, roundId: string) {
  const round = db.prepare("SELECT id, sequence, status, created_at AS createdAt, completed_at AS completedAt FROM rounds WHERE id = ?").get(roundId) as Row;
  const submissions = db.prepare(`SELECT s.id, s.slot, s.youtube_url AS youtubeUrl, s.video_id AS videoId,
    s.created_at AS createdAt, u.id AS userId, COALESCE(s.author_name, u.name) AS userName, COALESCE(s.author_group, u.group_code) AS groupCode
    FROM submissions s JOIN users u ON u.id = s.user_id WHERE s.round_id = ? ORDER BY s.slot`).all(roundId) as Row[];
  const bySlot = new Map(submissions.map((item) => [item.slot, item]));
  return { ...round, slots: Array.from({ length: 10 }, (_, index) => bySlot.get(index + 1) ?? { slot: index + 1 }) };
}

function settlePayment(db: AppDatabase, paymentId: string): boolean {
  return db.transaction(() => {
    const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId) as {
      id: string; user_id: string; status: string; credits_millis: number; extra_passes: number;
    } | undefined;
    if (!payment) return false;
    const credited = db.prepare("SELECT 1 FROM wallet_ledger WHERE user_id = ? AND kind = 'PIX_PURCHASE' AND reference_id = ?").get(payment.user_id, payment.id);
    if (credited) return false;
    if (payment.status === "CANCELLED") return false;
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
  const held = db.prepare("SELECT payment_hold FROM wallets WHERE user_id = ?").get(userId) as { payment_hold: number };
  if (held.payment_hold) throw new Error("Carteira aguardando revisão de pagamento. Nenhum novo débito foi realizado.");
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
  const app = Fastify({ logger: config.NODE_ENV === "test" ? false : { redact: ["req.headers.authorization", "req.headers.cookie", "req.url", "res.headers.location"] } });
  await app.register(cors, { origin: [config.WEB_APP_URL, config.ANDROID_APP_ORIGIN], credentials: false });
  await app.register(helmet);
  await app.register(rateLimit, { global: false, errorResponseBuilder: () => ({ statusCode: 429, message: "Muitas tentativas. Aguarde antes de tentar novamente." }) });
  await app.register(jwt, { secret: config.JWT_SECRET, sign: { expiresIn: "8h" } });

  function establishUserSession(name: string, phone: string, groupCode: string) {
    const now = new Date().toISOString();
    let user = db.prepare("SELECT id FROM users WHERE phone = ?").get(phone) as { id: string } | undefined;
    db.transaction(() => {
      if (!user) {
        user = { id: randomUUID() };
        db.prepare("INSERT INTO users (id, name, phone, group_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(user.id, name, phone, groupCode, now, now);
        db.prepare("INSERT INTO wallets (user_id, updated_at) VALUES (?, ?)").run(user.id, now);
        db.prepare("INSERT INTO wallet_ledger (id, user_id, kind, amount_millis, reference_id, created_at) VALUES (?, ?, 'WELCOME', 10000, NULL, ?)")
          .run(randomUUID(), user.id, now);
      } else {
        db.prepare("UPDATE users SET name = ?, group_code = ?, updated_at = ? WHERE id = ?").run(name, groupCode, now, user.id);
      }
    })();
    return {
      token: app.jwt.sign({ sub: user!.id, purpose: "session", aud: "conexao-session" }),
      user: getUser(db, user!.id)
    };
  }

  async function authGuard(request: FastifyRequest, reply: FastifyReply) {
    await verifySession(request, reply);
    if (reply.sent) return;
    const user = getUser(db, request.user.sub);
    if (!user) return reply.code(401).send({ message: "Sessão inválida ou expirada." });
    const cooldown = cooldownState(db, request.user.sub);
    if (cooldown) return reply.code(423).send({ code: "COOLDOWN_ACTIVE", message: "Seu intervalo após concluir uma fila ainda está em andamento.", ...cooldown });
    if (config.REQUIRE_GROUP_MEMBERSHIP && !hasMembership(db, String(user.phone), String(user.groupCode))) return reply.code(403).send({ message: "Seu acesso precisa da aprovação do Owner em um grupo SOS YOUTUBER." });
    db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(new Date().toISOString(), request.user.sub);
  }
  const { ownerGuard } = await registerOwnerRoutes(app, db, config);
  const stopWhatsApp = await registerWhatsAppRoutes(app,db,config,ownerGuard);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ message: error.issues[0]?.message ?? "Dados inválidos." });
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(error);
    const message = status >= 500 ? "Não foi possível concluir a operação. Tente novamente." : error instanceof Error ? error.message : "Dados inválidos.";
    return reply.code(status).send({ message });
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (!request.url.startsWith("/health") && !request.url.startsWith("/public/")) reply.header("cache-control", "no-store");
    return payload;
  });
  app.get("/health", async () => ({ ok: true }));

  app.post("/auth/login", { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const body = requestCodeSchema.parse(request.body);
    if (config.REQUIRE_GROUP_MEMBERSHIP && !hasMembership(db, body.phone, body.groupCode)) {
      return reply.code(403).send({ message: "Seu WhatsApp ainda não está autorizado no grupo SOS YOUTUBER informado. Use Quero participar para solicitar ou aguarde a aprovação." });
    }
    const existing = db.prepare("SELECT id FROM users WHERE phone=?").get(body.phone) as { id: string } | undefined;
    if (existing) {
      const cooldown = cooldownState(db,existing.id);
      if (cooldown) return reply.code(423).send({ code:"COOLDOWN_ACTIVE", message:"Você concluiu uma fila recentemente. Seu novo acesso será liberado automaticamente ao fim deste intervalo.", ...cooldown });
    }
    return reply.send(establishUserSession(body.name, body.phone, body.groupCode));
  });

  app.post("/auth/request-code", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const runtimeWhatsApp = effectiveWhatsAppConfig(db,config);
    if (!config.AUTH_DEV_MODE && (!whatsappConfigured(runtimeWhatsApp) || !runtimeWhatsApp.WHATSAPP_OTP_TEMPLATE)) return reply.code(503).send({ message: "A entrega WhatsApp ainda precisa ser configurada pelos Owners." });
    const body = requestCodeSchema.parse(request.body);
    if (config.REQUIRE_GROUP_MEMBERSHIP && !hasMembership(db, body.phone, body.groupCode)) return reply.code(403).send({ message: "Número e grupo ainda não aprovados. Use Quero participar! para solicitar acesso ao Owner." });
    const recent = db.prepare("SELECT created_at FROM login_codes WHERE phone = ? ORDER BY created_at DESC LIMIT 1").get(body.phone) as { created_at: string } | undefined;
    if (recent && Date.now() - Date.parse(recent.created_at) < 60_000) return reply.code(429).send({ message: "Aguarde um minuto para pedir outro código." });
    db.prepare("DELETE FROM login_codes WHERE expires_at < ?").run(new Date().toISOString());
    db.prepare("UPDATE login_codes SET used_at = ? WHERE phone = ? AND used_at IS NULL").run(new Date().toISOString(), body.phone);
    const code = String(randomInt(100000, 1_000_000));
    const now = new Date();
    db.prepare(`INSERT INTO login_codes (id, phone, name, group_code, code_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), body.phone, body.name, body.groupCode, codeHash(config, body.phone, code), new Date(now.getTime() + 10 * 60_000).toISOString(), now.toISOString());
    if (!config.AUTH_DEV_MODE) {
      try { await sendWhatsAppOtp(runtimeWhatsApp,body.phone,code); }
      catch { db.prepare("UPDATE login_codes SET used_at=? WHERE phone=? AND used_at IS NULL").run(new Date().toISOString(),body.phone); return reply.code(503).send({ message: "Não foi possível entregar o código pelo WhatsApp. Tente novamente mais tarde." }); }
    }
    return reply.send({ ok: true, expiresInSeconds: 600, ...(config.AUTH_DEV_MODE ? { devCode: code } : {}) });
  });

  app.post("/auth/verify", { config: { rateLimit: { max: 60, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const body = verifyCodeSchema.parse(request.body);
    const row = db.prepare(`SELECT * FROM login_codes WHERE phone = ? AND used_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC LIMIT 1`).get(body.phone, new Date().toISOString()) as {
        id: string; name: string; phone: string; group_code: string; code_hash: string; attempts: number;
      } | undefined;
    if (!row) return reply.code(401).send({ message: "Código inválido ou expirado." });
    if (row.attempts >= 5) return reply.code(429).send({ message: "Limite de tentativas atingido. Solicite um novo código." });
    if (!timingSafeEqual(Buffer.from(row.code_hash, "hex"), Buffer.from(codeHash(config, body.phone, body.code), "hex"))) {
      db.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?").run(row.id);
      return reply.code(401).send({ message: "Código inválido ou expirado." });
    }
    if (config.REQUIRE_GROUP_MEMBERSHIP && !hasMembership(db, row.phone, row.group_code)) return reply.code(403).send({ message: "Seu número precisa de aprovação para este grupo." });
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
    return reply.send({ token: app.jwt.sign({ sub: user!.id, purpose: "session", aud: "conexao-session" }), user: getUser(db, user!.id) });
  });

  app.get("/dashboard", { preHandler: authGuard }, async (request) => {
    ensureOpenRound(db);
    const open = db.prepare("SELECT id FROM rounds WHERE status = 'OPEN' ORDER BY sequence DESC LIMIT 1").get() as { id: string };
    const ready = db.prepare(`SELECT DISTINCT r.id FROM rounds r
      JOIN submissions s ON s.round_id = r.id
      LEFT JOIN playlist_watch_progress p ON p.round_id = r.id AND p.user_id = ?
      WHERE r.status = 'READY' AND s.user_id = ? AND p.finalized_at IS NULL
      ORDER BY r.sequence ASC`).all(request.user.sub,request.user.sub) as Array<{ id: string }>;
    const contributionCount = db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE round_id = ? AND user_id = ?")
      .get(open.id, request.user.sub) as { count: number };
    const connection = db.prepare("SELECT 1 FROM youtube_connections WHERE user_id = ?").get(request.user.sub);
    const exports = db.prepare("SELECT round_id AS roundId, status, added_count AS addedCount, youtube_playlist_id AS playlistId FROM playlist_exports WHERE user_id = ?")
      .all(request.user.sub) as Array<{ roundId: string; status: string; playlistId?: string }>;
    const watchRows = db.prepare("SELECT round_id AS roundId, watched_seconds_json AS watchedSecondsJson, durations_json AS durationsJson, percent, finalized_at AS finalizedAt, finalize_reason AS finalizeReason, updated_at AS updatedAt FROM playlist_watch_progress WHERE user_id = ?")
      .all(request.user.sub) as Array<{ roundId: string; watchedSecondsJson: string; durationsJson: string; percent: number; finalizedAt?: string; finalizeReason?: string; updatedAt: string }>;
    const watchRewardRefs = db.prepare("SELECT reference_id AS referenceId FROM wallet_ledger WHERE user_id = ? AND kind = 'WATCH_PROGRESS'")
      .all(request.user.sub) as Array<{ referenceId?: string }>;
    return {
      user: getUser(db, request.user.sub),
      wallet: walletView(db, request.user.sub),
      openRound: roundView(db, open.id),
      readyRounds: ready.map(({ id }) => {
        const exportRow = exports.find((entry) => entry.roundId === id);
        const watch = watchRows.find((entry) => entry.roundId === id);
        return {
          ...roundView(db, id),
          export: exportRow ? {
            ...exportRow,
            watchProgress: watch ? {
              watchedSeconds: JSON.parse(watch.watchedSecondsJson) as number[],
              durations: JSON.parse(watch.durationsJson) as number[],
              percent: watch.percent,
              rewardCoins: watchRewardRefs.filter((entry) => entry.referenceId?.startsWith(id + ":")).length,
              finalizedAt: watch.finalizedAt,
              finalizeReason: watch.finalizeReason,
              updatedAt: watch.updatedAt
            } : undefined
          } : undefined
        };
      }),
      viewer: { contributionsInOpenRound: contributionCount.count, youtubeConnected: Boolean(connection) }
    };
  });

  app.put("/rounds/:id/watch-progress", { preHandler: authGuard, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const roundId = z.string().uuid().parse((request.params as { id: string }).id);
    const body = watchProgressSchema.parse(request.body);
    const exported = db.prepare("SELECT 1 FROM playlist_exports WHERE round_id = ? AND user_id = ? AND status = 'SUCCESS' AND youtube_playlist_id IS NOT NULL")
      .get(roundId, request.user.sub);
    if (!exported) return reply.code(409).send({ message: "Crie sua playlist deste ciclo antes de salvar o acompanhamento." });

    const existing = db.prepare("SELECT watched_seconds_json AS watchedSecondsJson, durations_json AS durationsJson, finalized_at AS finalizedAt FROM playlist_watch_progress WHERE round_id = ? AND user_id = ?")
      .get(roundId, request.user.sub) as { watchedSecondsJson: string; durationsJson: string; finalizedAt?: string } | undefined;
    if (existing?.finalizedAt) return reply.code(409).send({ message: "Esta tarefa já foi concluída. O progresso final permanece salvo." });
    const previousWatched = existing ? JSON.parse(existing.watchedSecondsJson) as number[] : Array(10).fill(0);
    const previousDurations = existing ? JSON.parse(existing.durationsJson) as number[] : Array(10).fill(0);
    const durations = body.durations.map((duration, index) => Math.max(duration, previousDurations[index] ?? 0));
    const watchedSeconds = body.watchedSeconds.map((watched, index) => {
      const maximum = durations[index] ?? 0;
      const merged = Math.max(watched, previousWatched[index] ?? 0);
      return maximum > 0 ? Math.min(maximum, merged) : 0;
    });
    const percent = watchPercent(watchedSeconds, durations);
    const now = new Date().toISOString();

    const rewardTargetCoins = Math.floor(percent / 10);
    const rewardDeltaCoins = db.transaction(() => {
      db.prepare(`INSERT INTO playlist_watch_progress (round_id, user_id, watched_seconds_json, durations_json, percent, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(round_id, user_id) DO UPDATE SET
          watched_seconds_json = excluded.watched_seconds_json,
          durations_json = excluded.durations_json,
          percent = excluded.percent,
          updated_at = excluded.updated_at`)
        .run(roundId, request.user.sub, JSON.stringify(watchedSeconds), JSON.stringify(durations), percent, now);

      let credited = 0;
      for (let coin = 1; coin <= rewardTargetCoins; coin++) {
        const inserted = db.prepare("INSERT OR IGNORE INTO wallet_ledger (id, user_id, kind, amount_millis, reference_id, created_at) VALUES (?, ?, 'WATCH_PROGRESS', 1000, ?, ?)")
          .run(randomUUID(), request.user.sub, `${roundId}:${coin}`, now);
        credited += inserted.changes;
      }
      if (credited) {
        db.prepare("UPDATE wallets SET reward_millis = reward_millis + ?, updated_at = ? WHERE user_id = ?")
          .run(credited * 1000, now, request.user.sub);
      }
      return credited;
    })();
    const rewardCoins = (db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE user_id = ? AND kind = 'WATCH_PROGRESS' AND reference_id LIKE ?")
      .get(request.user.sub, `${roundId}:%`) as { n: number }).n;
    const finalization = percent >= 100 ? db.transaction(() => finalizeRoundTask(db,request.user.sub,roundId,"COMPLETE"))() : undefined;

    return { watchedSeconds, durations, percent, rewardCoins, rewardDeltaCoins, walletTotal: walletView(db, request.user.sub).total, updatedAt: now, ...finalization };
  });

  app.post("/rounds/:id/watch-progress/finalize", { preHandler: authGuard }, async (request, reply) => {
    const roundId = z.string().uuid().parse((request.params as { id: string }).id);
    const eligible = db.prepare(`SELECT 1 FROM submissions s JOIN rounds r ON r.id=s.round_id
      JOIN playlist_exports e ON e.round_id=r.id AND e.user_id=? AND e.status='SUCCESS'
      WHERE r.id=? AND r.status='READY' AND s.user_id=? LIMIT 1`).get(request.user.sub,roundId,request.user.sub);
    if (!eligible) return reply.code(409).send({ message:"Esta fila ainda não está pronta para ser concluída por esta conta." });
    const stamp = new Date().toISOString();
    db.prepare(`INSERT OR IGNORE INTO playlist_watch_progress
      (round_id,user_id,watched_seconds_json,durations_json,percent,updated_at)
      VALUES (?,?,?,?,0,?)`).run(roundId,request.user.sub,JSON.stringify(Array(10).fill(0)),JSON.stringify(Array(10).fill(0)),stamp);
    return db.transaction(() => finalizeRoundTask(db,request.user.sub,roundId,"MANUAL"))();
  });

  app.post("/rounds/current/submissions", { preHandler: authGuard }, async (request, reply) => {
    const body = submitSchema.parse(request.body);
    let verified: Awaited<ReturnType<typeof verifyYouTubeVideo>>;
    try { verified = await verifyYouTubeVideo(body.url, config.YOUTUBE_API_KEY); }
    catch { return reply.code(400).send({ message: "Informe um vídeo válido e acessível do YouTube." }); }
    try {
      const result = db.transaction(() => {
        const pending = pendingReadyRound(db,request.user.sub);
        if (pending) throw new Error(`Finalize sua tarefa da Fila ${pending.sequence} antes de contribuir em uma nova fila.`);
        const duplicate = db.prepare("SELECT 1 FROM submissions WHERE video_id=? LIMIT 1").get(verified.videoId);
        if (duplicate) throw new Error("Este vídeo do YouTube já foi usado em uma fila anterior ou atual. Escolha outro vídeo.");
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
        db.prepare(`INSERT INTO submissions (id, round_id, slot, user_id, youtube_url, video_id, created_at, author_name, author_group)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(submissionId, open.id, next.slot, request.user.sub, verified.canonicalUrl, verified.videoId, now, String(getUser(db, request.user.sub)!.name), String(getUser(db, request.user.sub)!.groupCode));
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

  app.post("/payments/pix", { preHandler: authGuard, config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (request, reply) => {
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
        .run(pix.providerPaymentId, pix.status === "APPROVED" ? "PENDING" : pix.status, pix.qrCode ?? null, pix.qrCodeBase64 ?? null, pix.ticketUrl ?? null, paymentId);
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

  function applyPaymentConfirmation(result: PaymentConfirmation) {
    const local = db.prepare("SELECT id, user_id, amount_cents, status, approved_at FROM payments WHERE provider = 'MERCADO_PAGO' AND provider_payment_id = ?").get(result.providerPaymentId) as {
      id: string; user_id: string; amount_cents: number; status: string; approved_at?: string;
    } | undefined;
    if (!local) return;
    if (result.internalId !== local.id || result.amountCents !== local.amount_cents || result.currency !== "BRL" || result.paymentMethod !== "pix") {
      throw Object.assign(new Error("Pagamento não corresponde ao pedido registrado."), { statusCode: 409 });
    }
    if (result.status === "APPROVED") {
      settlePayment(db, local.id);
    } else if (result.status === "CANCELLED" && local.approved_at) {
      // Spent credits require manual reconciliation; freeze further spending instead of silently creating debt.
      db.transaction(() => {
        db.prepare("UPDATE payments SET status = 'CANCELLED' WHERE id = ?").run(local.id);
        db.prepare("UPDATE wallets SET payment_hold = 1 WHERE user_id = ?").run(local.user_id);
        db.prepare("INSERT OR IGNORE INTO wallet_ledger (id, user_id, kind, amount_millis, reference_id, created_at) VALUES (?, ?, 'PAYMENT_REVIEW', 0, ?, ?)").run(randomUUID(), local.user_id, local.id, new Date().toISOString());
      })();
    } else if (!local.approved_at) {
      db.prepare("UPDATE payments SET status = ? WHERE id = ?").run(result.status, local.id);
    }
  }

  app.get("/payments/:id", { preHandler: authGuard, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const payment = db.prepare("SELECT provider, provider_payment_id, status FROM payments WHERE id = ? AND user_id = ?").get(id, request.user.sub) as { provider: string; provider_payment_id: string; status: string } | undefined;
    if (!payment) return reply.code(404).send({ message: "Pagamento não encontrado." });
    if (payment.provider === "MERCADO_PAGO" && payment.provider_payment_id && payment.status === "PENDING") {
      const confirmation = await fetchMercadoPagoPayment(config, payment.provider_payment_id);
      if (confirmation.providerPaymentId !== payment.provider_payment_id) return reply.code(409).send({ message: "Identificador do pagamento divergente." });
      applyPaymentConfirmation(confirmation);
    }
    const updated = db.prepare("SELECT status FROM payments WHERE id = ?").get(id) as { status: string };
    return { id, status: updated.status };
  });

  app.post("/payments/webhooks/mercado-pago", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!config.MERCADO_PAGO_ACCESS_TOKEN || !config.MERCADO_PAGO_WEBHOOK_SECRET) return reply.code(503).send({ message: "Webhook de pagamento não configurado." });
    const query = z.object({ "data.id": z.string().regex(/^\d{1,30}$/) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ message: "Notificação sem identificador assinado." });
    const providerId = query.data["data.id"];
    const bodyId = (request.body as { data?: { id?: string | number } } | undefined)?.data?.id;
    if (bodyId !== undefined && String(bodyId) !== providerId) return reply.code(400).send({ message: "Identificador da notificação divergente." });
    if (!verifyWebhookSignature(config.MERCADO_PAGO_WEBHOOK_SECRET, providerId, request.headers["x-request-id"] as string | undefined, request.headers["x-signature"] as string | undefined)) {
      return reply.code(401).send({ message: "Assinatura de notificação inválida." });
    }
    const known = db.prepare("SELECT 1 FROM payments WHERE provider = 'MERCADO_PAGO' AND provider_payment_id = ?").get(providerId);
    if (!known) return { ok: true };
    const confirmation = await fetchMercadoPagoPayment(config, providerId);
    if (confirmation.providerPaymentId !== providerId) return reply.code(409).send({ message: "Identificador do pagamento divergente." });
    applyPaymentConfirmation(confirmation);
    return { ok: true };
  });

  app.get("/youtube/connect", { preHandler: authGuard }, async (request) => {
    const query = z.object({ returnTo: z.enum(["app","web"]).default("web"), roundId: z.string().uuid().optional() }).parse(request.query);
    const returnTo = query.returnTo;
    if (query.roundId && !db.prepare("SELECT 1 FROM rounds r JOIN submissions s ON s.round_id=r.id WHERE r.id=? AND r.status='READY' AND s.user_id=?").get(query.roundId,request.user.sub)) throw Object.assign(new Error("Somente participantes de um ciclo completo podem criar sua playlist."),{statusCode:403});
    const state = app.jwt.sign({ sub: request.user.sub, purpose: "youtube-oauth", aud: "conexao-oauth", returnTo, jti: randomUUID() }, { expiresIn: "10m" });
    const url = googleAuthorizationUrl(config, state);
    db.prepare("DELETE FROM oauth_states WHERE expires_at < ?").run(new Date().toISOString());
    db.prepare("INSERT INTO oauth_states (state_hash, user_id, expires_at, round_id) VALUES (?, ?, ?, ?)").run(createHash("sha256").update(state).digest("hex"), request.user.sub, new Date(Date.now() + 600_000).toISOString(), query.roundId ?? null);
    return { url };
  });

  app.get("/youtube/callback", async (request, reply) => {
    const query = z.object({ code: z.string().optional(), state: z.string(), error: z.string().optional() }).parse(request.query);
    const state = app.jwt.verify<{ sub: string; purpose?: string; returnTo?: string; aud?: string; jti?: string }>(query.state);
    if (state.purpose !== "youtube-oauth" || state.aud !== "conexao-oauth") return reply.code(400).send("Estado OAuth inválido.");
    const intent = db.prepare("SELECT round_id FROM oauth_states WHERE state_hash=? AND user_id=?").get(createHash("sha256").update(query.state).digest("hex"),state.sub) as { round_id?: string } | undefined;
    const consumed = db.prepare("UPDATE oauth_states SET used_at = ? WHERE state_hash = ? AND user_id = ? AND used_at IS NULL AND expires_at > ?").run(new Date().toISOString(), createHash("sha256").update(query.state).digest("hex"), state.sub, new Date().toISOString());
    if (!consumed.changes) return reply.code(400).send("Autorização expirada ou já utilizada. Conecte novamente.");
    if (query.error || !query.code) return reply.redirect(`${config.WEB_APP_URL}?youtube=cancelled`);
    const tokens = await exchangeGoogleCode(config, query.code);
    db.prepare(`INSERT INTO youtube_connections (user_id, refresh_token_cipher, scope, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET refresh_token_cipher = excluded.refresh_token_cipher, scope = excluded.scope, updated_at = excluded.updated_at`)
      .run(state.sub, encryptToken(tokens.refreshToken, config), tokens.scope, new Date().toISOString());
    return reply.redirect(state.returnTo === "app" ? "conexaoyoutube://oauth?status=connected" : `${config.WEB_APP_URL}?youtube=connected${intent?.round_id ? `&round=${encodeURIComponent(intent.round_id)}` : ""}`);
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
    if (videos.length !== 10) return reply.code(409).send({ message: "A playlist exige exatamente dez links salvos." });
    const now = new Date().toISOString();
    const lockOwner = randomUUID();
    const acquired = db.prepare(`INSERT INTO export_locks (round_id, user_id, owner, expires_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(round_id, user_id) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at WHERE export_locks.expires_at < ?`)
      .run(roundId, request.user.sub, lockOwner, new Date(Date.now() + 600_000).toISOString(), now);
    if (!acquired.changes) return reply.code(409).send({ message: "Sua playlist já está sendo criada. Aguarde e atualize o quadro." });
    try {
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
        { playlistId: exportRow.playlistId, addedCount: exportRow.addedCount, exportId: exportRow.id },
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
    } finally {
      db.prepare("DELETE FROM export_locks WHERE round_id = ? AND user_id = ? AND owner = ?").run(roundId, request.user.sub, lockOwner);
    }
  });

  app.addHook("onClose", async () => { await stopWhatsApp(); if (!providedDb) db.close(); });
  return app;
}
