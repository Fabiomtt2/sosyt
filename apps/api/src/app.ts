import { watchRewardView,WATCH_REWARD_INTERVAL_MILLIS } from "./watch-rewards.js";
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import { z } from "zod";
import { registerOwnerRoutes, hasMembership, resolveGroupForPhone } from "./owner.js";
import { registerCompanion } from "./companion.js";
import { registerGoogleLogin } from "./google-login.js";
import { administrativeSessionValid } from "./owners.js";
import { groupVerificationState } from "./group-verification.js";
import { registerWhatsAppRoutes, sendWhatsAppOtp, whatsappConfigured, queueOwnerAlerts } from "./whatsapp.js";
import { effectivePaymentConfig, effectiveWhatsAppConfig, initializeWhatsAppIntegration } from "./integrations.js";
import { normalizePhone } from "./phone.js";
import type { Config } from "./config.js";
import { createDatabase, ensureOpenRound, type AppDatabase } from "./db.js";
import { PAYMENT_PRODUCTS, createPixPayment, fetchPagBankWebhookPublicKey, fetchProviderPayment, verifyAsaasWebhookToken, verifyPagBankWebhookSignature, verifyWebhookSignature, type PaymentConfirmation } from "./payments.js";
import {
  createPrivatePlaylist,
  decryptToken,
  encryptToken,
  exchangeGoogleCode,
  fetchOwnYouTubeChannel,
  googleAuthorizationUrl,
  verifyYouTubeVideo
} from "./youtube.js";

declare module "fastify" {
  interface FastifyRequest { paymentRawBody?: Buffer }
}
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; purpose?: string; returnTo?: string; aud?: string; jti?: string; displayName?: string; ownerRole?: "ROOT_OWNER"|"ADMIN_OWNER"; ownerId?:string; adminRole?: "ROOT_OWNER"|"ADMIN_OWNER"; authMethod?: "google"|"otp"; authPhone?:string; googleSubject?:string };
    user: { sub: string; purpose?: string; returnTo?: string; aud?: string; jti?: string; displayName?: string; ownerRole?: "ROOT_OWNER"|"ADMIN_OWNER"; ownerId?:string; adminRole?: "ROOT_OWNER"|"ADMIN_OWNER"; authMethod?: "google"|"otp"; authPhone?:string; googleSubject?:string };
  }
}

const requestCodeSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().transform(normalizePhone).pipe(z.string().regex(/^[1-9]\d{7,14}$/, "Informe o WhatsApp com código do país."))
});
const verifyCodeSchema = z.object({
  phone: z.string().transform(normalizePhone).pipe(z.string().regex(/^[1-9]\d{7,14}$/, "Informe o WhatsApp com código do país.")),
  code: z.string().regex(/^\d{6}$/)
});
const submitSchema = z.object({ url: z.string().trim().min(1).max(500), expectedRoundId:z.string().uuid().optional() });
const pixSchema = z.object({
  email: z.string().email(),
  cpf: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().length(11)),
  product: z.enum(["COINS_LAUNCH","PASS_SINGLE"]).default("COINS_LAUNCH")
});
const watchVectorSchema = z.array(z.number().finite().min(0).max(86_400)).length(10);
const watchProgressSchema = z.object({ watchedSeconds: watchVectorSchema, durations: watchVectorSchema });
const watchObservationSchema = z.object({
  sessionId: z.string().uuid(),
  videoIndex: z.number().int().min(0).max(9),
  playerSeconds: z.number().finite().min(0).max(86_400),
  duration: z.number().finite().positive().max(86_400),
  playbackRate: z.number().finite().min(0.25).max(2),
  playing: z.boolean(),
  visible: z.boolean()
});

const WATCH_SESSION_STALE_MILLIS = 15_000;
const avatarSchema = z.discriminatedUnion("kind",[
  z.object({kind:z.literal("PRESET"),presetId:z.string().regex(/^avatar-(?:0[1-9]|[12]\d|3[0-4])$/)}),
  z.object({kind:z.literal("CUSTOM"),dataUrl:z.string().max(180_000)})
]);

type Row = Record<string, unknown>;

function watchPercent(watchedSeconds: number[], durations: number[]): number {
  return Math.min(100, Math.floor(watchedSeconds.reduce((sum, watched, index) => {
    const duration = durations[index] ?? 0;
    return sum + (duration > 0 ? Math.min(1, watched / duration) : 0);
  }, 0) * 10));
}

type WatchInterval = [number, number];
type WatchIntervalMap = Record<string, WatchInterval[]>;

function parseWatchIntervals(raw?: string | null): WatchIntervalMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: WatchIntervalMap = {};
    for (const [key, value] of Object.entries(parsed ?? {})) {
      if (!Array.isArray(value)) continue;
      result[key] = value.flatMap((entry) => {
        if (!Array.isArray(entry) || entry.length !== 2) return [];
        const start = Number(entry[0]), end = Number(entry[1]);
        return Number.isFinite(start) && Number.isFinite(end) && end > start && start >= 0 ? [[start, end] as WatchInterval] : [];
      }).sort((a,b)=>a[0]-b[0]);
    }
    return result;
  } catch { return {}; }
}

function mergeWatchInterval(existing: WatchInterval[], start: number, end: number): { intervals: WatchInterval[]; addedSeconds: number } {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { intervals: existing, addedSeconds: 0 };
  const before = existing.reduce((sum,[a,b])=>sum+(b-a),0);
  const sorted = [...existing,[start,end] as WatchInterval].sort((a,b)=>a[0]-b[0]);
  const merged: WatchInterval[] = [];
  for (const current of sorted) {
    const last=merged[merged.length-1];
    if (!last || current[0] > last[1] + 0.05) merged.push([current[0],current[1]]);
    else last[1]=Math.max(last[1],current[1]);
  }
  const after=merged.reduce((sum,[a,b])=>sum+(b-a),0);
  return { intervals: merged, addedSeconds: Math.max(0,after-before) };
}

function intervalCoverage(intervals: WatchInterval[]): number {
  return intervals.reduce((sum,[start,end])=>sum+Math.max(0,end-start),0);
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

function avatarFromRow(row: Row) {
  if (row.avatarKind==="PRESET" && typeof row.avatarPreset==="string") return {kind:"PRESET" as const,presetId:row.avatarPreset};
  if (row.avatarKind==="CUSTOM" && Buffer.isBuffer(row.avatarImage) && typeof row.avatarMime==="string") {
    return {kind:"CUSTOM" as const,dataUrl:`data:${row.avatarMime};base64,${row.avatarImage.toString("base64")}`};
  }
  return undefined;
}

function getUser(db: AppDatabase, userId: string) {
  const row=db.prepare(`SELECT u.id,u.name,u.phone,u.group_code AS groupCode,
    p.avatar_kind AS avatarKind,p.avatar_preset AS avatarPreset,p.avatar_image AS avatarImage,p.avatar_mime AS avatarMime,
    y.channel_id AS youtubeChannelId,y.channel_title AS youtubeChannelTitle,y.channel_thumbnail_url AS youtubeChannelThumbnailUrl
    FROM users u
    LEFT JOIN user_profiles p ON p.user_id=u.id
    LEFT JOIN youtube_connections y ON y.user_id=u.id
    WHERE u.id=? AND u.deleted_at IS NULL`).get(userId) as Row | undefined;
  if (!row) return undefined;
  return {
    id:row.id,name:row.name,phone:row.phone,groupCode:row.groupCode,
    avatar:avatarFromRow(row),
    youtubeChannel:row.youtubeChannelTitle ? {id:row.youtubeChannelId,title:row.youtubeChannelTitle,thumbnailUrl:row.youtubeChannelThumbnailUrl} : undefined
  };
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

function profileSummary(db: AppDatabase, userId: string) {
  const user=getUser(db,userId);
  if (!user) return undefined;
  const membership=db.prepare(`SELECT gm.group_code AS groupCode,gm.approved_at AS approvedAt,gm.source,gm.revoked_at AS revokedAt,
    g.enabled,g.membership_mode AS membershipMode,g.last_synced_at AS lastSyncedAt
    FROM group_memberships gm LEFT JOIN groups g ON g.code=gm.group_code WHERE gm.phone=?`).get(String(user.phone)) as
    | {groupCode:string;approvedAt?:string;source?:string;revokedAt?:string;enabled?:number;membershipMode?:string;lastSyncedAt?:string}
    | undefined;
  const verification=membership?.groupCode ? groupVerificationState(db,String(user.phone),membership.groupCode) : undefined;
  const activity={
    submissions:(db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE user_id=?").get(userId) as {n:number}).n,
    rounds:(db.prepare("SELECT COUNT(DISTINCT round_id) AS n FROM submissions WHERE user_id=?").get(userId) as {n:number}).n,
    playlists:(db.prepare("SELECT COUNT(*) AS n FROM playlist_exports WHERE user_id=? AND status='SUCCESS'").get(userId) as {n:number}).n,
    completedTasks:(db.prepare("SELECT COUNT(*) AS n FROM playlist_watch_progress WHERE user_id=? AND finalized_at IS NOT NULL").get(userId) as {n:number}).n
  };
  const purchases=db.prepare(`SELECT id,product_code AS productCode,provider,status,amount_cents AS amountCents,
    credits_millis AS creditsMillis,extra_passes AS extraPasses,created_at AS createdAt,approved_at AS approvedAt
    FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 40`).all(userId) as Array<Record<string,unknown>>;
  const adminAccess=db.prepare("SELECT role FROM owner_access WHERE user_id=? AND active=1").get(userId) as {role:"ROOT_OWNER"|"ADMIN_OWNER"}|undefined;
  const totals=db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN status='APPROVED' THEN credits_millis ELSE 0 END),0) AS coinsPurchasedMillis,
    COALESCE(SUM(CASE WHEN status='APPROVED' AND product_code='PASS_SINGLE' THEN extra_passes ELSE 0 END),0) AS passesPurchased,
    COALESCE(SUM(CASE WHEN status='APPROVED' AND product_code='COINS_LAUNCH' THEN extra_passes ELSE 0 END),0) AS bonusPasses,
    COALESCE(SUM(CASE WHEN status='APPROVED' THEN amount_cents ELSE 0 END),0) AS approvedSpendCents
    FROM payments WHERE user_id=?`).get(userId) as {coinsPurchasedMillis:number;passesPurchased:number;bonusPasses:number;approvedSpendCents:number};
  return {
    activity,
    access:{
      groupCode:membership?.groupCode ?? String(user.groupCode),
      enabled:membership ? Boolean(membership.enabled) : false,
      approvedAt:membership?.approvedAt,
      source:membership?.source,
      revoked:Boolean(membership?.revokedAt),
      membershipMode:membership?.membershipMode,
      lastSyncedAt:membership?.lastSyncedAt,
      verification
    },
    adminAccess,
    purchases:{
      coinsPurchased:totals.coinsPurchasedMillis/1000,
      passesPurchased:totals.passesPurchased,
      bonusPasses:totals.bonusPasses,
      approvedSpendCents:totals.approvedSpendCents,
      history:purchases
    }
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

function finalizeRoundTask(db: AppDatabase, userId: string, roundId: string, reason: "COMPLETE" | "MANUAL" | "ABANDONED") {
  const stamp = new Date();
  const current = db.prepare("SELECT finalized_at AS finalizedAt, percent FROM playlist_watch_progress WHERE round_id=? AND user_id=?")
    .get(roundId,userId) as { finalizedAt?: string; percent: number } | undefined;
  if (!current) throw new Error("Acompanhe a playlist antes de concluir esta tarefa.");
  if (current.finalizedAt) {
    const cooldown = cooldownState(db,userId);
    return { finalizedAt: current.finalizedAt, percent: current.percent, ...cooldown };
  }
  const finalizedAt = stamp.toISOString();
  db.prepare("UPDATE playlist_watch_progress SET finalized_at=?, finalize_reason=? WHERE round_id=? AND user_id=?")
    .run(finalizedAt,reason,roundId,userId);
  if (reason==="ABANDONED") {
    db.prepare("UPDATE users SET cooldown_until=NULL,cooldown_reason=NULL,updated_at=? WHERE id=?").run(finalizedAt,userId);
    return { finalizedAt, percent: current.percent, abandoned:true as const };
  }
  const cooldownUntil = new Date(stamp.getTime()+30*60_000).toISOString();
  db.prepare("UPDATE users SET cooldown_until=?, cooldown_reason=?, updated_at=? WHERE id=?")
    .run(cooldownUntil,`Fila concluída em ${current.percent}%`,finalizedAt,userId);
  return { finalizedAt, percent: current.percent, cooldownUntil, secondsRemaining: 1800 };
}

function roundView(db: AppDatabase, roundId: string, includeAdminPrivate=false) {
  const round = db.prepare("SELECT id, sequence, status, created_at AS createdAt, completed_at AS completedAt FROM rounds WHERE id = ?").get(roundId) as Row;
  const raw = db.prepare(`SELECT s.id,s.slot,s.youtube_url AS youtubeUrl,s.video_id AS videoId,
    s.video_title AS videoTitle,s.video_channel_title AS videoChannelTitle,
    COALESCE(s.video_thumbnail_url,'https://i.ytimg.com/vi/' || s.video_id || '/hqdefault.jpg') AS videoThumbnailUrl,
    s.created_at AS createdAt,u.id AS userId,u.phone AS userPhone,COALESCE(s.author_name,u.name) AS userName,COALESCE(s.author_group,u.group_code) AS groupCode,
    COALESCE(s.author_channel_title,y.channel_title) AS userChannelTitle,
    COALESCE(s.author_channel_thumbnail_url,y.channel_thumbnail_url) AS userChannelThumbnailUrl,
    s.author_admin_role AS adminRole,
    p.avatar_kind AS avatarKind,p.avatar_preset AS avatarPreset,p.avatar_image AS avatarImage,p.avatar_mime AS avatarMime
    FROM submissions s
    JOIN users u ON u.id=s.user_id
    LEFT JOIN user_profiles p ON p.user_id=u.id
    LEFT JOIN youtube_connections y ON y.user_id=u.id
    WHERE s.round_id=? ORDER BY s.slot`).all(roundId) as Row[];
  const submissions=raw.map((item)=>({
    id:item.id,slot:item.slot,youtubeUrl:item.youtubeUrl,videoId:item.videoId,videoTitle:item.videoTitle,
    videoChannelTitle:item.videoChannelTitle,videoThumbnailUrl:item.videoThumbnailUrl,createdAt:item.createdAt,
    userId:item.userId,userName:item.userName,groupCode:item.groupCode,userChannelTitle:item.userChannelTitle,
    userChannelThumbnailUrl:item.userChannelThumbnailUrl,adminRole:item.adminRole,
    ...(includeAdminPrivate ? {participantPhone:item.userPhone} : {}),
    avatar:avatarFromRow(item)
  }));
  const bySlot = new Map(submissions.map((item) => [item.slot, item]));
  return { ...round, slots: Array.from({ length: 10 }, (_, index) => bySlot.get(index + 1) ?? { slot: index + 1 }) };
}

async function backfillActiveSubmissionMetadata(db:AppDatabase,apiKey?:string) {
  if (!apiKey) return;
  const rows=db.prepare(`SELECT s.id,s.youtube_url AS youtubeUrl
    FROM submissions s JOIN rounds r ON r.id=s.round_id
    WHERE r.status IN ('OPEN','READY')
      AND (s.video_title IS NULL OR s.video_channel_title IS NULL OR s.video_thumbnail_url IS NULL)
    ORDER BY s.created_at DESC LIMIT 20`).all() as Array<{id:string;youtubeUrl:string}>;
  if (!rows.length) return;
  await Promise.allSettled(rows.map(async(row)=>{
    const info=await verifyYouTubeVideo(row.youtubeUrl,apiKey);
    db.prepare(`UPDATE submissions SET
      video_title=COALESCE(video_title,?),
      video_channel_title=COALESCE(video_channel_title,?),
      video_thumbnail_url=COALESCE(video_thumbnail_url,?)
      WHERE id=?`).run(info.title ?? null,info.channelTitle ?? null,info.thumbnailUrl ?? null,row.id);
  }));
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
  initializeWhatsAppIntegration(db,config);
  const app = Fastify({ logger: config.NODE_ENV === "test" ? false : { redact: ["req.headers.authorization", "req.headers.cookie", "req.url", "res.headers.location"] } });
  await app.register(cors, {
    origin: [config.WEB_APP_URL, config.ANDROID_APP_ORIGIN],
    credentials: false,
    methods: ["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"]
  });
  await app.register(helmet);
  await app.register(rateLimit, { global: false, errorResponseBuilder: () => ({ statusCode: 429, message: "Muitas tentativas. Aguarde antes de tentar novamente." }) });
  await app.register(jwt, { secret: config.JWT_SECRET, sign: { expiresIn: "8h" } });

  function establishUserSession(name: string, phone: string, groupCode: string) {
    const now = new Date().toISOString();
    let user = db.prepare("SELECT id,deleted_at AS deletedAt FROM users WHERE phone = ?").get(phone) as { id: string; deletedAt?:string } | undefined;
    db.transaction(() => {
      if (!user) {
        user = { id: randomUUID() };
        db.prepare("INSERT INTO users (id, name, phone, group_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(user.id, name, phone, groupCode, now, now);
        db.prepare("INSERT INTO wallets (user_id, updated_at) VALUES (?, ?)").run(user.id, now);
        db.prepare("INSERT INTO wallet_ledger (id, user_id, kind, amount_millis, reference_id, created_at) VALUES (?, ?, 'WELCOME', 10000, NULL, ?)")
          .run(randomUUID(), user.id, now);
      } else {
        db.prepare("UPDATE users SET name=?,group_code=?,updated_at=?,deleted_at=NULL WHERE id=?").run(name,groupCode,now,user.id);
      }
    })();
    return {
      token: app.jwt.sign({ sub: user!.id, purpose: "session", aud: "conexao-session" }),
      user: getUser(db, user!.id)
    };
  }

  async function participantIdentityGuard(request:FastifyRequest,reply:FastifyReply){
    await verifySession(request,reply);
    if(reply.sent)return;
    const user=getUser(db,request.user.sub);
    if(!user)return reply.code(401).send({message:"Sessão inválida ou expirada."});
    if(request.user.adminRole && !administrativeSessionValid(db,config,request.user)) return reply.code(401).send({message:"A permissão administrativa mudou. Entre novamente no painel Owner."});
    if (!config.AUTH_DEV_MODE && !request.user.adminRole) {
      const proof=request.user.authMethod;
      if (!proof || request.user.authPhone!==user.phone) return reply.code(401).send({message:"Confirme seu acesso por código WhatsApp ou por uma identidade Google já vinculada."});
      if (proof==="google" && !db.prepare("SELECT 1 FROM google_identities WHERE user_id=? AND google_sub=?").get(request.user.sub,request.user.googleSubject??"")) return reply.code(401).send({message:"A identidade Google mudou. Entre novamente."});
    }
    db.prepare("UPDATE users SET last_seen_at=? WHERE id=?").run(new Date().toISOString(),request.user.sub);
  }

  async function authGuard(request: FastifyRequest, reply: FastifyReply) {
    await participantIdentityGuard(request,reply);
    if(reply.sent)return;
    const user=getUser(db,request.user.sub)!;
    const administrativeParticipant=Boolean(request.user.adminRole);
    const cooldown=cooldownState(db,request.user.sub);
    if(!administrativeParticipant&&cooldown)return reply.code(423).send({code:"COOLDOWN_ACTIVE",message:"Seu intervalo após concluir uma fila ainda está em andamento.",...cooldown});
    if(!administrativeParticipant&&config.REQUIRE_GROUP_MEMBERSHIP&&!hasMembership(db,String(user.phone),String(user.groupCode)))return reply.code(403).send({message:"Seu acesso precisa da aprovação do Owner em um grupo SOS YOUTUBER."});
  }
  const {ownerGuard,rootOwnerGuard}=await registerOwnerRoutes(app,db,config,participantIdentityGuard);
  registerGoogleLogin(app,db,config,rootOwnerGuard);
  registerCompanion(app,db,config,participantIdentityGuard,userId=>watchRewardView(db,userId));
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
    if (!config.AUTH_DEV_MODE) return reply.code(403).send({code:"IDENTITY_PROOF_REQUIRED",message:"Receba um código no WhatsApp ou use uma identidade Google já vinculada para entrar."});
    const body=requestCodeSchema.parse(request.body);
    const resolved=resolveGroupForPhone(db,body.phone);
    const groupCode=resolved.groupCode;
    if (!groupCode || (config.REQUIRE_GROUP_MEMBERSHIP && !hasMembership(db,body.phone,groupCode))) {
      return reply.code(403).send({
        code:"GROUP_NOT_CONFIRMED",
        detectedGroup:groupCode,
        message:groupCode
          ? `Seu WhatsApp foi reconhecido no SOS YOUTUBER ${groupCode}, mas o acesso ainda aguarda aprovação.`
          : "Ainda não conseguimos confirmar em qual grupo SOS YOUTUBER este WhatsApp está. Use Quero participar para registrar a solicitação."
      });
    }
    const existing=db.prepare("SELECT id FROM users WHERE phone=? AND deleted_at IS NULL").get(body.phone) as {id:string}|undefined;
    if (existing) {
      const cooldown=cooldownState(db,existing.id);
      if (cooldown) return reply.code(423).send({code:"COOLDOWN_ACTIVE",message:"Você concluiu uma fila recentemente. Seu novo acesso será liberado automaticamente ao fim deste intervalo.",...cooldown});
    }
    return reply.send(establishUserSession(body.name,body.phone,groupCode));
  });

  app.post("/auth/request-code", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const runtimeWhatsApp=effectiveWhatsAppConfig(db,config);
    if (!config.AUTH_DEV_MODE && (!whatsappConfigured(runtimeWhatsApp) || !runtimeWhatsApp.WHATSAPP_OTP_TEMPLATE)) return reply.code(503).send({message:"A entrega WhatsApp ainda precisa ser configurada pelos Owners."});
    const body=requestCodeSchema.extend({registration:z.boolean().default(false),consent:z.literal(true).optional()}).parse(request.body);
    if(body.registration&&!body.consent)return reply.code(400).send({message:"Autorize o uso do seu nome e WhatsApp para solicitar o cadastro."});
    const resolved=resolveGroupForPhone(db,body.phone);
    const groupCode=resolved.groupCode;
    const approved=Boolean(groupCode&&(!config.REQUIRE_GROUP_MEMBERSHIP||hasMembership(db,body.phone,groupCode)));
    if (!approved && !body.registration) {
      return reply.code(403).send({code:"GROUP_NOT_CONFIRMED",detectedGroup:groupCode,message:"Seu WhatsApp ainda não possui um grupo aprovado para receber o código de acesso."});
    }
    const recent = db.prepare("SELECT created_at FROM login_codes WHERE phone = ? ORDER BY created_at DESC LIMIT 1").get(body.phone) as { created_at: string } | undefined;
    if (recent && Date.now() - Date.parse(recent.created_at) < 60_000) return reply.code(429).send({ message: "Aguarde um minuto para pedir outro código." });
    db.prepare("DELETE FROM login_codes WHERE expires_at < ?").run(new Date().toISOString());
    db.prepare("UPDATE login_codes SET used_at = ? WHERE phone = ? AND used_at IS NULL").run(new Date().toISOString(), body.phone);
    const code = String(randomInt(100000, 1_000_000));
    const now = new Date();
    db.prepare(`INSERT INTO login_codes (id, phone, name, group_code, code_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(),body.phone,body.name,approved?groupCode!:"",codeHash(config,body.phone,code),new Date(now.getTime()+5*60_000).toISOString(),now.toISOString());
    if (!config.AUTH_DEV_MODE) {
      try { await sendWhatsAppOtp(runtimeWhatsApp,body.phone,code); }
      catch { db.prepare("UPDATE login_codes SET used_at=? WHERE phone=? AND used_at IS NULL").run(new Date().toISOString(),body.phone); return reply.code(503).send({ message: "Não foi possível entregar o código pelo WhatsApp. Tente novamente mais tarde." }); }
    }
    return reply.send({ ok: true, expiresInSeconds: 300, ...(config.AUTH_DEV_MODE ? { devCode: code } : {}) });
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
    const detected=resolveGroupForPhone(db,row.phone);
    const currentGroup=detected.groupCode;
    const approved=Boolean(currentGroup&&(!config.REQUIRE_GROUP_MEMBERSHIP||hasMembership(db,row.phone,currentGroup)));
    if (!approved && row.group_code!=="") return reply.code(403).send({message:"Seu número precisa de aprovação para este grupo."});
    if (!approved) {
      const stamp=new Date().toISOString();
      const prior=db.prepare("SELECT id,status FROM participation_requests WHERE phone=?").get(row.phone) as {id:string;status:string}|undefined;
      const id=prior?.id??randomUUID();
      db.transaction(()=>{
        db.prepare("UPDATE login_codes SET used_at=? WHERE id=?").run(stamp,row.id);
        db.prepare(`INSERT OR IGNORE INTO participation_requests(id,phone,name,preferred_group,status,created_at,updated_at)
          VALUES(?,?,?,?,'PENDING',?,?)`).run(id,row.phone,row.name,currentGroup??null,stamp,stamp);
        if(!prior)queueOwnerAlerts(db,config,id,row.phone,row.name,"verified-phone:"+id);
      })();
      const requestToken=app.jwt.sign({sub:`participation:${id}`,purpose:"participation-status",aud:"conexao-participation"},{expiresIn:"30d"});
      return {participation:{requestToken,status:prior?.status==="DECLINED"?"DECLINED":"PENDING",name:row.name,phone:row.phone,
        message:prior?.status==="DECLINED"?"Seu WhatsApp foi confirmado. Converse com um Owner sobre a solicitação já analisada.":"WhatsApp confirmado! Sua solicitação está salva e aguarda a liberação do grupo pelo Owner."}};
    }
    row.group_code=currentGroup!;
    const now = new Date().toISOString();
    let user = db.prepare("SELECT id,deleted_at AS deletedAt FROM users WHERE phone = ?").get(body.phone) as { id: string; deletedAt?:string } | undefined;
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
        db.prepare("UPDATE users SET name=?,group_code=?,updated_at=?,deleted_at=NULL WHERE id=?").run(row.name,row.group_code,now,user.id);
      }
    })();
    return reply.send({ token: app.jwt.sign({ sub: user!.id, purpose: "session", aud: "conexao-session", authMethod:"otp", authPhone:row.phone }), user: getUser(db, user!.id) });
  });

  app.delete("/profile/account", { preHandler: authGuard }, async (request, reply) => {
    const body=z.object({confirmation:z.literal("DELETE_MY_ACCOUNT")}).parse(request.body);
    void body;
    const user=db.prepare("SELECT id,name,phone,group_code AS groupCode FROM users WHERE id=? AND deleted_at IS NULL").get(request.user.sub) as
      | {id:string;name:string;phone:string;groupCode:string}
      | undefined;
    if (!user) return reply.code(404).send({message:"Esta conta já não está ativa."});
    const deletedAt=new Date().toISOString();
    const submissions=(db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE user_id=?").get(user.id) as {n:number}).n;
    const rounds=(db.prepare("SELECT COUNT(DISTINCT round_id) AS n FROM submissions WHERE user_id=?").get(user.id) as {n:number}).n;
    const purchaseTotals=db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN status='APPROVED' THEN amount_cents ELSE 0 END),0) AS approvedPaymentCents,
      COALESCE(SUM(CASE WHEN status='APPROVED' THEN credits_millis ELSE 0 END),0) AS coinsPurchasedMillis,
      COALESCE(SUM(CASE WHEN status='APPROVED' THEN extra_passes ELSE 0 END),0) AS passesPurchased
      FROM payments WHERE user_id=?`).get(user.id) as {approvedPaymentCents:number;coinsPurchasedMillis:number;passesPurchased:number};
    const tombstonePhone=`deleted:${user.id}`;
    db.transaction(()=>{
      db.prepare(`INSERT OR REPLACE INTO account_deletions
        (id,user_id,group_code,deleted_at,source,submissions_count,rounds_count,approved_payment_cents,coins_purchased_millis,passes_purchased)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(randomUUID(),user.id,user.groupCode,deletedAt,"USER_SELF_SERVICE",submissions,rounds,purchaseTotals.approvedPaymentCents,purchaseTotals.coinsPurchasedMillis,purchaseTotals.passesPurchased);
      db.prepare("DELETE FROM user_profiles WHERE user_id=?").run(user.id);
      db.prepare("DELETE FROM youtube_connections WHERE user_id=?").run(user.id);
      db.prepare("DELETE FROM google_identities WHERE user_id=?").run(user.id);
      db.prepare("DELETE FROM companion_pairings WHERE user_id=?").run(user.id);
      db.prepare("DELETE FROM companion_devices WHERE user_id=?").run(user.id);
      for (const table of ["google_login_states","google_login_results","google_identity_claims"]) db.prepare(`DELETE FROM ${table} WHERE phone=?`).run(user.phone);
      db.prepare("DELETE FROM playlist_watch_progress WHERE user_id=?").run(user.id);
      db.prepare("DELETE FROM watch_observation_state WHERE user_id=?").run(user.id);
      db.prepare("DELETE FROM watch_time_totals WHERE user_id=?").run(user.id);
      db.prepare("DELETE FROM playlist_exports WHERE user_id=?").run(user.id);
      db.prepare("DELETE FROM export_locks WHERE user_id=?").run(user.id);
      db.prepare("DELETE FROM oauth_states WHERE user_id=?").run(user.id);
      db.prepare("DELETE FROM login_codes WHERE phone=?").run(user.phone);
      db.prepare("DELETE FROM participation_requests WHERE phone=?").run(user.phone);
      db.prepare("DELETE FROM group_memberships WHERE phone=?").run(user.phone);
      db.prepare("DELETE FROM whatsapp_member_verifications WHERE phone=?").run(user.phone);
      db.prepare("DELETE FROM whatsapp_conversations WHERE phone=?").run(user.phone);
      db.prepare("DELETE FROM whatsapp_outbox WHERE recipient=?").run(user.phone);
      db.prepare(`UPDATE submissions SET author_name='Conta removida',author_channel_title=NULL,author_channel_thumbnail_url=NULL WHERE user_id=?`).run(user.id);
      db.prepare(`UPDATE wallets SET promo_millis=0,purchased_millis=0,reward_millis=0,extra_slot_passes=0,payment_hold=0,updated_at=? WHERE user_id=?`).run(deletedAt,user.id);
      db.prepare(`UPDATE users SET name='Conta removida',phone=?,deleted_at=?,deleted_source='USER_SELF_SERVICE',
        cooldown_until=NULL,cooldown_reason=NULL,updated_at=? WHERE id=?`).run(tombstonePhone,deletedAt,deletedAt,user.id);
    })();
    return {ok:true,userId:user.id,deletedAt};
  });

  app.put("/profile/avatar", { preHandler: authGuard }, async (request, reply) => {
    const body=avatarSchema.parse(request.body);
    const now=new Date().toISOString();
    if (body.kind==="PRESET") {
      db.prepare(`INSERT INTO user_profiles (user_id,avatar_kind,avatar_preset,avatar_image,avatar_mime,updated_at)
        VALUES (?, 'PRESET', ?, NULL, NULL, ?)
        ON CONFLICT(user_id) DO UPDATE SET avatar_kind='PRESET',avatar_preset=excluded.avatar_preset,avatar_image=NULL,avatar_mime=NULL,updated_at=excluded.updated_at`)
        .run(request.user.sub,body.presetId,now);
    } else {
      const match=/^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl);
      if (!match) return reply.code(400).send({message:"Use uma foto em formato de imagem. O SOS prepara a foto em WebP antes de salvar."});
      const bytes=Buffer.from(match[1],"base64");
      const validWebp=bytes.length>=12 && bytes.subarray(0,4).toString("ascii")==="RIFF" && bytes.subarray(8,12).toString("ascii")==="WEBP";
      if (!validWebp || bytes.length>120_000) return reply.code(400).send({message:"A foto não pôde ser salva. Escolha outra imagem ou tente novamente."});
      db.prepare(`INSERT INTO user_profiles (user_id,avatar_kind,avatar_preset,avatar_image,avatar_mime,updated_at)
        VALUES (?, 'CUSTOM', NULL, ?, 'image/webp', ?)
        ON CONFLICT(user_id) DO UPDATE SET avatar_kind='CUSTOM',avatar_preset=NULL,avatar_image=excluded.avatar_image,avatar_mime='image/webp',updated_at=excluded.updated_at`)
        .run(request.user.sub,bytes,now);
    }
    return {avatar:getUser(db,request.user.sub)?.avatar};
  });

  app.delete("/profile/avatar", { preHandler: authGuard }, async (request) => {
    db.prepare("DELETE FROM user_profiles WHERE user_id=?").run(request.user.sub);
    return {ok:true};
  });

  app.get("/dashboard", { preHandler: authGuard }, async (request) => {
    ensureOpenRound(db);
    await backfillActiveSubmissionMetadata(db,config.YOUTUBE_API_KEY);
    const open = db.prepare("SELECT id FROM rounds WHERE status = 'OPEN' ORDER BY sequence DESC LIMIT 1").get() as { id: string };
    const ready = request.user.adminRole
      ? db.prepare("SELECT id FROM rounds WHERE status='READY' ORDER BY sequence DESC LIMIT 8").all() as Array<{id:string}>
      : db.prepare(`SELECT DISTINCT r.id FROM rounds r
          JOIN submissions s ON s.round_id=r.id
          LEFT JOIN playlist_watch_progress p ON p.round_id=r.id AND p.user_id=?
          WHERE r.status='READY' AND s.user_id=? AND p.finalized_at IS NULL
          ORDER BY r.sequence ASC`).all(request.user.sub,request.user.sub) as Array<{id:string}>;
    const contributionCount = db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE round_id = ? AND user_id = ?")
      .get(open.id, request.user.sub) as { count: number };
    const connection = db.prepare("SELECT 1 FROM youtube_connections WHERE user_id = ?").get(request.user.sub);
    const exports = db.prepare("SELECT round_id AS roundId, status, added_count AS addedCount, youtube_playlist_id AS playlistId FROM playlist_exports WHERE user_id = ?")
      .all(request.user.sub) as Array<{ roundId: string; status: string; playlistId?: string }>;
    const watchRows = db.prepare("SELECT round_id AS roundId, watched_seconds_json AS watchedSecondsJson, durations_json AS durationsJson, percent, finalized_at AS finalizedAt, finalize_reason AS finalizeReason, updated_at AS updatedAt FROM playlist_watch_progress WHERE user_id = ?")
      .all(request.user.sub) as Array<{ roundId: string; watchedSecondsJson: string; durationsJson: string; percent: number; finalizedAt?: string; finalizeReason?: string; updatedAt: string }>;
    const watchRewardRefs = db.prepare("SELECT reference_id AS referenceId FROM wallet_ledger WHERE user_id = ? AND kind = 'WATCH_PROGRESS'")
      .all(request.user.sub) as Array<{ referenceId?: string }>;
    const currentUser=getUser(db,request.user.sub)!;
    const paymentRuntime=effectivePaymentConfig(db,config);
    const demoPayments=paymentRuntime.provider==="DISABLED" && config.PAYMENTS_DEV_MODE && config.NODE_ENV!=="production";
    const commerce={
      pixAvailable:paymentRuntime.provider!=="DISABLED" || demoPayments,
      provider:demoPayments ? "DEMO" as const : paymentRuntime.provider,
      products:Object.fromEntries(Object.entries(PAYMENT_PRODUCTS).map(([code,item])=>[code,{
        code,amountCents:item.amountCents,credits:item.creditsMillis/1000,extraPasses:item.extraPasses,description:item.description
      }]))
    };
    return {
      user: currentUser,
      wallet: walletView(db, request.user.sub),
      openRound: roundView(db, open.id,Boolean(request.user.adminRole)),
      readyRounds: ready.map(({ id }) => {
        const viewerContributed=Boolean(db.prepare("SELECT 1 FROM submissions WHERE round_id=? AND user_id=? LIMIT 1").get(id,request.user.sub));
        const exportRow = exports.find((entry) => entry.roundId === id);
        const watch = watchRows.find((entry) => entry.roundId === id);
        return {
          ...roundView(db,id,Boolean(request.user.adminRole)),
          viewerContributed,
          export:exportRow ? {
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
      viewer: { contributionsInOpenRound: contributionCount.count, youtubeConnected: Boolean(connection), adminRole:request.user.adminRole },
      profile: profileSummary(db,request.user.sub),
      watchRewards: watchRewardView(db,request.user.sub),
      commerce
    };
  });

  app.post("/rounds/:id/watch-observation", { preHandler: authGuard, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const roundId=z.string().uuid().parse((request.params as {id:string}).id);
    const body=watchObservationSchema.parse(request.body);
    const exported=db.prepare("SELECT 1 FROM playlist_exports WHERE round_id=? AND user_id=? AND status='SUCCESS' AND youtube_playlist_id IS NOT NULL")
      .get(roundId,request.user.sub);
    if(!exported) return reply.code(409).send({message:"Crie sua playlist desta fila antes de iniciar o acompanhamento."});

    const existing=db.prepare(`SELECT watched_seconds_json AS watchedSecondsJson,durations_json AS durationsJson,percent,
      observed_intervals_json AS observedIntervalsJson,finalized_at AS finalizedAt
      FROM playlist_watch_progress WHERE round_id=? AND user_id=?`).get(roundId,request.user.sub) as
      | {watchedSecondsJson:string;durationsJson:string;percent:number;observedIntervalsJson?:string;finalizedAt?:string}
      | undefined;
    if(existing?.finalizedAt) return reply.code(409).send({message:"Esta tarefa já foi concluída. O progresso final permanece salvo."});

    const watchedSeconds=existing ? JSON.parse(existing.watchedSecondsJson) as number[] : Array(10).fill(0);
    const durations=existing ? JSON.parse(existing.durationsJson) as number[] : Array(10).fill(0);
    const intervals=parseWatchIntervals(existing?.observedIntervalsJson);
    durations[body.videoIndex]=Math.max(durations[body.videoIndex] ?? 0,body.duration);

    const state=db.prepare(`SELECT session_id AS sessionId,round_id AS roundId,video_index AS videoIndex,
      player_seconds AS playerSeconds,duration_seconds AS durationSeconds,playback_rate AS playbackRate,active,observed_at AS observedAt
      FROM watch_observation_state WHERE user_id=?`).get(request.user.sub) as
      | {sessionId:string;roundId:string;videoIndex:number;playerSeconds:number;durationSeconds:number;playbackRate:number;active:number;observedAt:string}
      | undefined;
    const nowMs=Date.now();
    const now=new Date(nowMs).toISOString();
    const stateAgeMs=state ? nowMs-Date.parse(state.observedAt) : Number.POSITIVE_INFINITY;
    const stateFresh=state && Number.isFinite(stateAgeMs) && stateAgeMs>=0 && stateAgeMs<=WATCH_SESSION_STALE_MILLIS;
    if(stateFresh && state!.sessionId!==body.sessionId) {
      return {
        watchedSeconds,durations,percent:existing?.percent ?? watchPercent(watchedSeconds,durations),
        acceptedSeconds:0,sessionConflict:true,walletTotal:walletView(db,request.user.sub).total,
        ...watchRewardView(db,request.user.sub),updatedAt:now
      };
    }

    let acceptedMillis=0;
    const sameStream=Boolean(state && state.sessionId===body.sessionId && state.roundId===roundId && state.videoIndex===body.videoIndex);
    if(sameStream && state!.active===1 && body.visible) {
      const serverDeltaMs=Math.max(0,nowMs-Date.parse(state!.observedAt));
      const playerDelta=body.playerSeconds-state!.playerSeconds;
      const rate=Math.max(0.25,Math.min(2,body.playbackRate));
      const maxNaturalAdvance=(serverDeltaMs/1000)*Math.max(rate,state!.playbackRate)+2;
      if(serverDeltaMs>=250 && serverDeltaMs<=WATCH_SESSION_STALE_MILLIS && playerDelta>0 && playerDelta<=maxNaturalAdvance) {
        const start=Math.max(0,Math.min(state!.playerSeconds,body.duration));
        const end=Math.max(start,Math.min(body.playerSeconds,body.duration));
        const key=String(body.videoIndex);
        const merged=mergeWatchInterval(intervals[key] ?? [],start,end);
        if(merged.addedSeconds>0) {
          intervals[key]=merged.intervals;
          const uniqueWallMillis=Math.floor((merged.addedSeconds/rate)*1000);
          acceptedMillis=Math.max(0,Math.min(serverDeltaMs,uniqueWallMillis));
          watchedSeconds[body.videoIndex]=Math.max(
            watchedSeconds[body.videoIndex] ?? 0,
            Math.min(durations[body.videoIndex] ?? body.duration,intervalCoverage(merged.intervals))
          );
        }
      }
    }
    const percent=Math.max(existing?.percent ?? 0,watchPercent(watchedSeconds,durations));

    const result=db.transaction(()=>{
      db.prepare(`INSERT INTO playlist_watch_progress
        (round_id,user_id,watched_seconds_json,durations_json,percent,observed_intervals_json,updated_at)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(round_id,user_id) DO UPDATE SET
          watched_seconds_json=excluded.watched_seconds_json,
          durations_json=excluded.durations_json,
          percent=MAX(playlist_watch_progress.percent,excluded.percent),
          observed_intervals_json=excluded.observed_intervals_json,
          updated_at=excluded.updated_at`)
        .run(roundId,request.user.sub,JSON.stringify(watchedSeconds),JSON.stringify(durations),percent,JSON.stringify(intervals),now);
      db.prepare(`INSERT INTO watch_observation_state
        (user_id,session_id,round_id,video_index,player_seconds,duration_seconds,playback_rate,observed_at,active)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET
          session_id=excluded.session_id,round_id=excluded.round_id,video_index=excluded.video_index,
          player_seconds=excluded.player_seconds,duration_seconds=excluded.duration_seconds,
          playback_rate=excluded.playback_rate,observed_at=excluded.observed_at,active=excluded.active`)
        .run(request.user.sub,body.sessionId,roundId,body.videoIndex,body.playerSeconds,body.duration,body.playbackRate,now,body.playing&&body.visible?1:0);
      db.prepare(`INSERT OR IGNORE INTO watch_time_totals(user_id,verified_millis,rewarded_coins,updated_at) VALUES (?,0,0,?)`)
        .run(request.user.sub,now);
      if(acceptedMillis>0) db.prepare("UPDATE watch_time_totals SET verified_millis=verified_millis+?,updated_at=? WHERE user_id=?")
        .run(acceptedMillis,now,request.user.sub);
      const total=db.prepare("SELECT verified_millis AS verifiedMillis,rewarded_coins AS rewardedCoins FROM watch_time_totals WHERE user_id=?")
        .get(request.user.sub) as {verifiedMillis:number;rewardedCoins:number};
      const targetCoins=Math.floor(total.verifiedMillis/WATCH_REWARD_INTERVAL_MILLIS);
      let credited=0;
      for(let coin=total.rewardedCoins+1;coin<=targetCoins;coin++) {
        const inserted=db.prepare("INSERT OR IGNORE INTO wallet_ledger(id,user_id,kind,amount_millis,reference_id,created_at,note) VALUES (?,?,'WATCH_TIME',1000,?,?,?)")
          .run(randomUUID(),request.user.sub,`watch-time:${coin}`,now,"1 moeda por 20 minutos verificados");
        credited+=inserted.changes;
      }
      if(credited) db.prepare("UPDATE wallets SET reward_millis=reward_millis+?,updated_at=? WHERE user_id=?")
        .run(credited*1000,now,request.user.sub);
      if(targetCoins!==total.rewardedCoins) db.prepare("UPDATE watch_time_totals SET rewarded_coins=?,updated_at=? WHERE user_id=?")
        .run(targetCoins,now,request.user.sub);
      return {rewardDeltaCoins:credited};
    })();

    const rewards=watchRewardView(db,request.user.sub);
    const observedComplete=durations.every((duration,index)=>duration>0&&intervalCoverage(intervals[String(index)]??[])>=duration);
    const finalization=observedComplete && acceptedMillis>0 ? db.transaction(()=>finalizeRoundTask(db,request.user.sub,roundId,"COMPLETE"))() : undefined;
    return {
      watchedSeconds,durations,percent,acceptedSeconds:acceptedMillis/1000,
      rewardCoins:rewards.coins,rewardDeltaCoins:result.rewardDeltaCoins,
      walletTotal:walletView(db,request.user.sub).total,...rewards,updatedAt:now,...finalization
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

    db.prepare(`INSERT INTO playlist_watch_progress (round_id, user_id, watched_seconds_json, durations_json, percent, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(round_id, user_id) DO UPDATE SET
        watched_seconds_json = excluded.watched_seconds_json,
        durations_json = excluded.durations_json,
        percent = MAX(playlist_watch_progress.percent, excluded.percent),
        updated_at = excluded.updated_at`)
      .run(roundId, request.user.sub, JSON.stringify(watchedSeconds), JSON.stringify(durations), percent, now);

    // Compatibilidade para clientes antigos: preserva o percentual, mas NÃO concede
    // novas moedas. Recompensas novas só podem nascer de observações server-time.
    const legacyRewardCoins = (db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE user_id = ? AND kind = 'WATCH_PROGRESS' AND reference_id LIKE ?")
      .get(request.user.sub, `${roundId}:%`) as { n: number }).n;
    return {
      watchedSeconds,durations,percent,rewardCoins:legacyRewardCoins,rewardDeltaCoins:0,
      walletTotal:walletView(db,request.user.sub).total,protocol:"LEGACY_NO_REWARD_NO_FINALIZE",
      ...watchRewardView(db,request.user.sub),updatedAt:now
    };
  });

  app.post("/rounds/:id/watch-progress/abandon", { preHandler: authGuard }, async (request, reply) => {
    const roundId=z.string().uuid().parse((request.params as {id:string}).id);
    const eligible=db.prepare(`SELECT 1 FROM submissions s JOIN rounds r ON r.id=s.round_id
      JOIN playlist_exports e ON e.round_id=r.id AND e.user_id=? AND e.status='SUCCESS'
      WHERE r.id=? AND r.status='READY' AND s.user_id=? LIMIT 1`).get(request.user.sub,roundId,request.user.sub);
    if (!eligible) return reply.code(409).send({message:"Esta tarefa ainda não pode ser abandonada por esta conta."});
    const stamp=new Date().toISOString();
    db.prepare(`INSERT OR IGNORE INTO playlist_watch_progress
      (round_id,user_id,watched_seconds_json,durations_json,percent,updated_at)
      VALUES (?,?,?,?,0,?)`).run(roundId,request.user.sub,JSON.stringify(Array(10).fill(0)),JSON.stringify(Array(10).fill(0)),stamp);
    const result=db.transaction(()=>finalizeRoundTask(db,request.user.sub,roundId,"ABANDONED"))();
    const open=db.prepare("SELECT id,sequence FROM rounds WHERE status='OPEN' ORDER BY sequence DESC LIMIT 1").get() as {id:string;sequence:number}|undefined;
    return {...result,nextOpenRound:open};
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
        const administrativeParticipant=Boolean(request.user.adminRole);
        const pending = pendingReadyRound(db,request.user.sub);
        if (pending && !administrativeParticipant) throw new Error(`Finalize sua tarefa da Fila ${pending.sequence} antes de contribuir em uma nova fila.`);
        const duplicate = db.prepare("SELECT 1 FROM submissions WHERE video_id=? LIMIT 1").get(verified.videoId);
        if (duplicate) throw new Error("Este vídeo do YouTube já foi usado em uma fila anterior ou atual. Escolha outro vídeo.");
        const open = db.prepare("SELECT id, sequence FROM rounds WHERE status = 'OPEN' ORDER BY sequence DESC LIMIT 1").get() as { id: string; sequence: number };
        if(body.expectedRoundId && body.expectedRoundId!==open.id) throw Object.assign(new Error(`A fila mudou enquanto seu vídeo era conferido. Agora estamos na Fila ${open.sequence}.`),{code:"QUEUE_CHANGED",currentRoundId:open.id,currentRoundSequence:open.sequence});
        const next = db.prepare("SELECT COUNT(*) + 1 AS slot FROM submissions WHERE round_id = ?").get(open.id) as { slot: number };
        if (next.slot > 10) throw new Error("Este ciclo já foi concluído. Atualize a página.");
        const previous = db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE round_id = ? AND user_id = ?").get(open.id, request.user.sub) as { count: number };
        if (previous.count > 0 && !administrativeParticipant) {
          const changed = db.prepare("UPDATE wallets SET extra_slot_passes = extra_slot_passes - 1 WHERE user_id = ? AND extra_slot_passes > 0")
            .run(request.user.sub);
          if (!changed.changes) throw new Error("Você já contribuiu neste ciclo. Uma compra aprovada libera uma posição extra.");
        }
        debitContribution(db, request.user.sub);
        const submissionId = randomUUID();
        const now = new Date().toISOString();
        const author=getUser(db,request.user.sub)!;
        db.prepare(`INSERT INTO submissions (
          id,round_id,slot,user_id,youtube_url,video_id,video_title,video_channel_title,video_thumbnail_url,
          author_channel_title,author_channel_thumbnail_url,author_admin_role,created_at,author_name,author_group
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            submissionId,open.id,next.slot,request.user.sub,verified.canonicalUrl,verified.videoId,
            verified.title ?? null,verified.channelTitle ?? null,verified.thumbnailUrl ?? null,
            author.youtubeChannel?.title ?? null,author.youtubeChannel?.thumbnailUrl ?? null,request.user.adminRole ?? null,
            now,String(author.name),String(author.groupCode)
          );
        db.prepare("INSERT INTO wallet_ledger (id, user_id, kind, amount_millis, reference_id, created_at) VALUES (?, ?, 'SUBMISSION', -1000, ?, ?)")
          .run(randomUUID(), request.user.sub, submissionId, now);

        if (next.slot === 10) {
          db.prepare("UPDATE rounds SET status = 'READY', completed_at = ? WHERE id = ?").run(now, open.id);
          const contributors = db.prepare("SELECT DISTINCT user_id AS userId FROM submissions WHERE round_id = ?").all(open.id) as Array<{ userId: string }>;
          for (const contributor of contributors) {
            const inserted=db.prepare("INSERT OR IGNORE INTO wallet_ledger (id, user_id, kind, amount_millis, reference_id, created_at) VALUES (?, ?, 'CURATION_REWARD', 1000, ?, ?)")
              .run(randomUUID(), contributor.userId, open.id, now);
            if(inserted.changes) db.prepare("UPDATE wallets SET reward_millis = reward_millis + 1000, updated_at = ? WHERE user_id = ?")
              .run(now, contributor.userId);
          }
          db.prepare("INSERT INTO rounds (id, sequence, status, created_at) VALUES (?, ?, 'OPEN', ?)")
            .run(randomUUID(), open.sequence + 1, now);
        }
        return { submissionId, slot: next.slot, roundCompleted: next.slot === 10 };
      })();
      return reply.code(201).send(result);
    } catch (error) {
      const queueError=error as {code?:string;currentRoundId?:string;currentRoundSequence?:number};
      return reply.code(409).send({ message: error instanceof Error ? error.message : "Não foi possível salvar o link.", ...(queueError.code==="QUEUE_CHANGED"?{code:"QUEUE_CHANGED",currentRoundId:queueError.currentRoundId,currentRoundSequence:queueError.currentRoundSequence}:{}) });
    }
  });

  app.post("/payments/pix", { preHandler: authGuard, config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const body = pixSchema.parse(request.body);
    const user = getUser(db, request.user.sub)!;
    const paymentId = randomUUID();
    const now = new Date().toISOString();
    const paymentConfig = effectivePaymentConfig(db,config);
    const provider = paymentConfig.provider === "DISABLED" && config.PAYMENTS_DEV_MODE && config.NODE_ENV !== "production" ? "DEMO" : paymentConfig.provider;
    if (provider === "DISABLED") return reply.code(409).send({ message:"O Owner ainda não configurou um provedor Pix ativo." });
    const product=PAYMENT_PRODUCTS[body.product];
    db.prepare(`INSERT INTO payments (id, user_id, provider, product_code, status, amount_cents, credits_millis, extra_passes, created_at)
      VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)`)
      .run(paymentId, request.user.sub, provider, body.product, product.amountCents, product.creditsMillis, product.extraPasses, now);
    try {
      const pix = provider === "DEMO"
        ? { providerPaymentId:`demo_${paymentId}`, status:"PENDING" as const }
        : await createPixPayment(paymentConfig, { paymentId, email: body.email, cpf: body.cpf, name: String(user.name), productCode:body.product });
      db.prepare(`UPDATE payments SET provider_payment_id = ?, status = ?, qr_code = ?, qr_code_base64 = ?, ticket_url = ? WHERE id = ?`)
        .run(pix.providerPaymentId, pix.status === "APPROVED" ? "PENDING" : pix.status, pix.qrCode ?? null, pix.qrCodeBase64 ?? null, pix.ticketUrl ?? null, paymentId);
      if (pix.status === "APPROVED") settlePayment(db, paymentId);
      return reply.code(201).send({ id: paymentId, ...pix, provider, product:body.product, credits:product.creditsMillis/1000, extraPasses:product.extraPasses });
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

  function applyPaymentConfirmation(provider: string, result: PaymentConfirmation) {
    const local = db.prepare("SELECT id, user_id, amount_cents, status, approved_at FROM payments WHERE provider = ? AND provider_payment_id = ?").get(provider,result.providerPaymentId) as {
      id: string; user_id: string; amount_cents: number; status: string; approved_at?: string;
    } | undefined;
    if (!local) return;
    if (result.internalId !== local.id || result.amountCents !== local.amount_cents || result.currency !== "BRL" || result.paymentMethod !== "pix") {
      throw Object.assign(new Error("Pagamento não corresponde ao pedido registrado."), { statusCode: 409 });
    }
    if (result.status === "APPROVED") {
      settlePayment(db, local.id);
    } else if (result.status === "CANCELLED" && local.approved_at) {
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
    if (payment.provider !== "DEMO" && payment.provider_payment_id && payment.status === "PENDING") {
      const confirmation = await fetchProviderPayment(effectivePaymentConfig(db,config),payment.provider,payment.provider_payment_id);
      if (confirmation.providerPaymentId !== payment.provider_payment_id) return reply.code(409).send({ message: "Identificador do pagamento divergente." });
      applyPaymentConfirmation(payment.provider,confirmation);
    }
    const updated = db.prepare("SELECT status FROM payments WHERE id = ?").get(id) as { status: string };
    return { id, status: updated.status };
  });

  app.post("/payments/webhooks/mercado-pago", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    const paymentConfig=effectivePaymentConfig(db,config);
    if (!paymentConfig.mercadoPagoAccessToken || !paymentConfig.mercadoPagoWebhookSecret) return reply.code(503).send({ message: "Webhook Mercado Pago não configurado." });
    const query = z.object({ "data.id": z.string().regex(/^\d{1,30}$/) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ message: "Notificação sem identificador assinado." });
    const providerId = query.data["data.id"];
    const bodyId = (request.body as { data?: { id?: string | number } } | undefined)?.data?.id;
    if (bodyId !== undefined && String(bodyId) !== providerId) return reply.code(400).send({ message: "Identificador da notificação divergente." });
    if (!verifyWebhookSignature(paymentConfig.mercadoPagoWebhookSecret, providerId, request.headers["x-request-id"] as string | undefined, request.headers["x-signature"] as string | undefined)) {
      return reply.code(401).send({ message: "Assinatura de notificação inválida." });
    }
    const known = db.prepare("SELECT 1 FROM payments WHERE provider = 'MERCADO_PAGO' AND provider_payment_id = ?").get(providerId);
    if (!known) return { ok: true };
    const confirmation = await fetchProviderPayment(paymentConfig,"MERCADO_PAGO",providerId);
    if (confirmation.providerPaymentId !== providerId) return reply.code(409).send({ message: "Identificador do pagamento divergente." });
    applyPaymentConfirmation("MERCADO_PAGO",confirmation);
    return { ok: true };
  });

  app.post("/payments/webhooks/asaas", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    const paymentConfig=effectivePaymentConfig(db,config);
    if (!paymentConfig.asaasApiKey || !paymentConfig.asaasWebhookToken) return reply.code(503).send({ message:"Webhook Asaas não configurado." });
    const token=request.headers["asaas-access-token"] as string | undefined;
    if (!verifyAsaasWebhookToken(paymentConfig.asaasWebhookToken,token)) return reply.code(401).send({ message:"Token de webhook Asaas inválido." });
    const payload=request.body as { id?:string; event?:string; payment?:{ id?:string } };
    if (!payload?.id || !payload.payment?.id) return reply.code(400).send({ message:"Notificação Asaas incompleta." });
    const recorded=db.prepare("INSERT OR IGNORE INTO payment_webhook_events (provider,event_id,received_at) VALUES ('ASAAS',?,?)").run(payload.id,new Date().toISOString());
    if (!recorded.changes) return { ok:true,duplicate:true };
    const providerId=payload.payment.id;
    const known=db.prepare("SELECT 1 FROM payments WHERE provider='ASAAS' AND provider_payment_id=?").get(providerId);
    if (!known) return { ok:true };
    const confirmation=await fetchProviderPayment(paymentConfig,"ASAAS",providerId);
    if (confirmation.providerPaymentId!==providerId) return reply.code(409).send({ message:"Identificador do pagamento divergente." });
    applyPaymentConfirmation("ASAAS",confirmation);
    return { ok:true };
  });

  app.post("/payments/webhooks/pagbank", {
    bodyLimit:65536,
    config:{ rateLimit:{ max:120,timeWindow:"1 minute" } },
    preParsing:async (request,_reply,payload)=>{
      const chunks:Buffer[]=[]; let length=0;
      for await (const chunk of payload) {
        const buffer=Buffer.from(chunk); length+=buffer.length;
        if (length>65536) throw Object.assign(new Error("Payload too large"),{statusCode:413});
        chunks.push(buffer);
      }
      request.paymentRawBody=Buffer.concat(chunks);
      return Readable.from([request.paymentRawBody]);
    }
  }, async (request,reply)=>{
    const paymentConfig=effectivePaymentConfig(db,config);
    if (!paymentConfig.pagBankToken) return reply.code(503).send({ message:"Webhook PagBank não configurado." });
    const raw=request.paymentRawBody;
    if (!raw?.length) return reply.code(400).send({ message:"Notificação PagBank sem corpo original." });
    const publicKey=await fetchPagBankWebhookPublicKey(paymentConfig);
    const signature=request.headers["x-payload-signature"] as string | string[] | undefined;
    if (!verifyPagBankWebhookSignature(raw,signature,publicKey)) return reply.code(401).send({ message:"Assinatura PagBank inválida." });
    const eventId=createHash("sha256").update(raw).digest("hex");
    const recorded=db.prepare("INSERT OR IGNORE INTO payment_webhook_events (provider,event_id,received_at) VALUES ('PAGBANK',?,?)").run(eventId,new Date().toISOString());
    if (!recorded.changes) return { ok:true,duplicate:true };
    const payload=request.body as { id?:string };
    if (!payload?.id) return reply.code(400).send({ message:"Notificação PagBank sem identificador do pedido." });
    const known=db.prepare("SELECT 1 FROM payments WHERE provider='PAGBANK' AND provider_payment_id=?").get(payload.id);
    if (!known) return { ok:true };
    const confirmation=await fetchProviderPayment(paymentConfig,"PAGBANK",payload.id);
    if (confirmation.providerPaymentId!==payload.id) return reply.code(409).send({ message:"Identificador do pagamento divergente." });
    applyPaymentConfirmation("PAGBANK",confirmation);
    return { ok:true };
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
    let channel:{id?:string;title?:string;thumbnailUrl?:string}={};
    try { channel=await fetchOwnYouTubeChannel(config,tokens.refreshToken); } catch { /* OAuth connection remains valid even if channel enrichment is temporarily unavailable. */ }
    db.prepare(`INSERT INTO youtube_connections (user_id, refresh_token_cipher, scope, channel_id, channel_title, channel_thumbnail_url, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET refresh_token_cipher=excluded.refresh_token_cipher,scope=excluded.scope,
        channel_id=COALESCE(excluded.channel_id,youtube_connections.channel_id),
        channel_title=COALESCE(excluded.channel_title,youtube_connections.channel_title),
        channel_thumbnail_url=COALESCE(excluded.channel_thumbnail_url,youtube_connections.channel_thumbnail_url),
        updated_at=excluded.updated_at`)
      .run(state.sub,encryptToken(tokens.refreshToken,config),tokens.scope,channel.id ?? null,channel.title ?? null,channel.thumbnailUrl ?? null,new Date().toISOString());
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
