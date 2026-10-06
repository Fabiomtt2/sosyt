import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "./config.js";
import type { AppDatabase } from "./db.js";
import { ownerAccounts, ownerNameMatches, ownerCredentialVersion } from "./owners.js";
import { publicWhatsAppNumber, whatsappJoinUrl, whatsappStatus, queueOwnerAlerts, queueParticipationDecision } from "./whatsapp.js";
import { normalizePhone } from "./phone.js";
import { effectivePaymentConfig, generateAndSaveVerifyToken, gitVersionInfo, readPaymentIntegration, readWhatsAppIntegration, savePaymentIntegration, saveWhatsAppIntegration, validateMetaWhatsApp } from "./integrations.js";
import { ensureAsaasWebhook } from "./payments.js";
import { groupVerificationState, materializeApprovedMembership } from "./group-verification.js";

const phoneSchema = z.string().transform(normalizePhone).pipe(z.string().regex(/^[1-9]\d{7,14}$/, "Informe o WhatsApp com código do país."));
const groupSchema = z.string().regex(/^[1-9]\d{0,2}$/);
export function hasMembership(db: AppDatabase, phone: string, group?: string): boolean {
  const member = db.prepare("SELECT m.group_code FROM group_memberships m JOIN groups g ON g.code = m.group_code WHERE m.phone = ? AND m.revoked_at IS NULL AND g.enabled = 1").get(phone) as { group_code: string } | undefined;
  return Boolean(member && (!group || member.group_code === group));
}

export async function registerOwnerRoutes(app: FastifyInstance, db: AppDatabase, config: Config) {
  for (const code of config.ALLOWED_GROUP_CODES.split(",")) db.prepare("INSERT OR IGNORE INTO groups (code) VALUES (?)").run(code);
  async function ownerGuard(request: FastifyRequest, reply: FastifyReply) {
    try {

      await request.jwtVerify();
      const account = ownerAccounts(config).find((o) => `owner:${o.id}` === request.user.sub);
      if (request.user.purpose !== "owner" || request.user.aud !== "conexao-owner" || !account?.secret || request.user.jti !== ownerCredentialVersion(account.secret)) throw new Error("Wrong role");
    } catch { return reply.code(401).send({ message: "Acesso exclusivo do Owner. Entre novamente." }); }
  }
  const participationToken = (id: string) => app.jwt.sign({ sub: `participation:${id}`, purpose: "participation-status", aud: "conexao-participation" }, { expiresIn: "30d" });
  app.get("/public/groups", async () => {
    const rows = db.prepare("SELECT code,join_url AS joinUrl FROM groups WHERE enabled = 1 ORDER BY length(code), code").all() as Array<{ code: string; joinUrl?: string }>;
    return {
      groups: rows.map(({ code }) => code),
      groupLinks: Object.fromEntries(rows.filter((row)=>row.joinUrl).map((row)=>[row.code,row.joinUrl!])),
      ownerContactAvailable: Boolean(publicWhatsAppNumber(config)),
      membershipRequired: config.REQUIRE_GROUP_MEMBERSHIP,
      whatsappJoinUrl: whatsappJoinUrl(config)
    };
  });
  app.post("/participation/request", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const body = z.object({ name: z.string().trim().min(2).max(80), phone: phoneSchema, groupCode: groupSchema.optional(), consent: z.literal(true) }).parse(request.body);
    const member = db.prepare("SELECT group_code AS groupCode FROM group_memberships WHERE phone=? AND revoked_at IS NULL").get(body.phone) as { groupCode: string } | undefined;
    if (member) return reply.code(409).send({ code: "ALREADY_REGISTERED", alreadyApproved: true, groupCode: member.groupCode, message: "Esse número já foi registrado. Entre pelo acesso normal com o grupo autorizado ou fale com um Owner se precisar atualizar seu cadastro." });
    if (body.groupCode) db.prepare("INSERT OR IGNORE INTO groups (code,enabled,membership_mode) VALUES (?,1,'OWNER')").run(body.groupCode);

    const existing = db.prepare("SELECT id,status,retry_block_until AS retryBlockUntil FROM participation_requests WHERE phone=?").get(body.phone) as
      | { id: string; status: "PENDING" | "APPROVED" | "DECLINED"; retryBlockUntil?: string }
      | undefined;
    const now = new Date();
    if (existing?.status === "APPROVED") return reply.code(409).send({ code: "ALREADY_REGISTERED", alreadyApproved: true, message: "Esse número já foi registrado. Use o acesso normal ou fale com um Owner se precisar atualizar seus dados." });
    if (existing?.status === "PENDING") {
      const currentBlock = existing.retryBlockUntil ? Date.parse(existing.retryBlockUntil) : 0;
      const blockedUntil = currentBlock > now.getTime() ? existing.retryBlockUntil! : new Date(now.getTime() + 120 * 60_000).toISOString();
      db.prepare("UPDATE participation_requests SET duplicate_attempts=duplicate_attempts+1,retry_block_until=?,updated_at=? WHERE id=?")
        .run(blockedUntil,now.toISOString(),existing.id);
      return reply.code(423).send({
        code: "REQUEST_RETRY_BLOCKED",
        status: "PENDING",
        blockedUntil,
        requestToken: participationToken(existing.id),
        message: "Sua solicitação já está registrada e continua aguardando análise. Para proteger seu cadastro, uma nova solicitação fica bloqueada temporariamente."
      });
    }
    if (existing?.status === "DECLINED" && existing.retryBlockUntil && Date.parse(existing.retryBlockUntil) > now.getTime()) {
      return reply.code(423).send({
        code: "REQUEST_RETRY_BLOCKED",
        status: "DECLINED",
        blockedUntil: existing.retryBlockUntil,
        requestToken: participationToken(existing.id),
        message: "Este cadastro foi analisado recentemente. Aguarde o prazo exibido antes de enviar uma nova solicitação."
      });
    }

    const stamp = now.toISOString();
    const blockedUntil = new Date(now.getTime() + 120 * 60_000).toISOString();
    const id = existing?.id ?? randomUUID();
    db.prepare(`INSERT INTO participation_requests (id,name,phone,preferred_group,status,retry_block_until,duplicate_attempts,created_at,updated_at)
      VALUES (?,?,?,?,'PENDING',?,0,?,?)
      ON CONFLICT(phone) DO UPDATE SET name=excluded.name,preferred_group=excluded.preferred_group,status='PENDING',
        retry_block_until=excluded.retry_block_until,duplicate_attempts=0,updated_at=excluded.updated_at`)
      .run(id,body.name,body.phone,body.groupCode ?? null,blockedUntil,stamp,stamp);
    const row = db.prepare("SELECT id FROM participation_requests WHERE phone=?").get(body.phone) as { id: string };
    queueOwnerAlerts(db,config,row.id,body.phone,body.name,`web:${randomUUID()}`);
    return {
      ok: true,
      status: "PENDING",
      requestToken: participationToken(row.id),
      blockedUntil,
      message: "Sua solicitação de cadastro foi registrada e será validada em breve."
    };
  });

  app.post("/participation/status", { config: { rateLimit: { max: 60, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const { token } = z.object({ token: z.string().min(20).max(4096) }).parse(request.body);
    let payload: { sub?: string; purpose?: string; aud?: string };
    try { payload = app.jwt.verify(token) as { sub?: string; purpose?: string; aud?: string }; }
    catch { return reply.code(401).send({ message: "Acompanhamento desta solicitação expirou neste aparelho." }); }
    if (payload.purpose !== "participation-status" || payload.aud !== "conexao-participation" || !payload.sub?.startsWith("participation:")) {
      return reply.code(401).send({ message: "Acompanhamento desta solicitação inválido." });
    }
    const id = payload.sub.slice("participation:".length);
    const row = db.prepare(`SELECT pr.id,pr.name,pr.phone,pr.preferred_group AS preferredGroup,pr.status,pr.retry_block_until AS blockedUntil,
      gm.group_code AS approvedGroup
      FROM participation_requests pr LEFT JOIN group_memberships gm ON gm.phone=pr.phone AND gm.revoked_at IS NULL
      WHERE pr.id=?`).get(id) as
      | { id: string; name: string; phone: string; preferredGroup?: string; status: string; blockedUntil?: string; approvedGroup?: string }
      | undefined;
    if (!row) return reply.code(404).send({ message: "Solicitação não encontrada." });
    const ownerApproved = row.status === "APPROVED";
    const verificationPending = ownerApproved && !row.approvedGroup;
    const verification = row.preferredGroup ? groupVerificationState(db,row.phone,row.preferredGroup) : undefined;
    const publicStatus = verificationPending ? "PENDING" : row.status;
    return {
      ...row,
      status: publicStatus,
      ownerApproved,
      verificationPending,
      verification,
      requestToken: participationToken(row.id),
      message: row.status === "APPROVED" && row.approvedGroup
        ? "Seu cadastro foi aprovado e todas as verificações necessárias foram concluídas. Você já pode voltar ao login."
        : verificationPending
          ? "A aprovação do Owner foi registrada. Agora aguardamos a confirmação do grupo antes de liberar o acesso."
          : row.status === "DECLINED"
            ? "Sua solicitação foi analisada e não foi aprovada neste momento."
            : "Sua solicitação continua aguardando análise dos Owners."
    };
  });
  app.post("/auth/role", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (request) => {
    const body = z.object({ name: z.string().trim().min(2).max(80), phone: phoneSchema }).parse(request.body);
    const account = ownerAccounts(config).find((owner) => owner.phone === body.phone && ownerNameMatches(owner.name, body.name));
    return { role: account ? "owner" as const : "user" as const };
  });

  app.post("/admin/login", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const body = z.object({ secret: z.string().min(1).max(256), name: z.string().trim().min(2).max(80), identifier: phoneSchema, groupCode: z.literal("#") }).parse(request.body);
    const account = ownerAccounts(config).find((o) => ownerNameMatches(o.name, body.name) && o.phone === body.identifier);
    if (!account?.secret) return reply.code(401).send({ message: "Conta ou credencial inválida." });
    const hash = (value: string) => createHash("sha256").update(value).digest();
    const devCredentialAccepted = config.AUTH_DEV_MODE && body.secret === "sosyout";
    if (!devCredentialAccepted && !timingSafeEqual(hash(body.secret),hash(account.secret))) return reply.code(401).send({ message: "Conta ou credencial inválida." });
    const displayName = body.name.trim();
    return { token: app.jwt.sign({ sub: `owner:${account.id}`, purpose: "owner", aud: "conexao-owner", jti: ownerCredentialVersion(account.secret), displayName }, { expiresIn: "1h" }), role: "owner", owner: { name: displayName, canonicalName: account.name, groupCode: "#" } };
  });

  app.get("/admin/overview", { preHandler: ownerGuard }, async (request) => {
    const account = ownerAccounts(config).find((o) => `owner:${o.id}` === request.user.sub)!;
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia", year: "numeric", month: "2-digit" }).formatToParts(new Date());
    const fallback = `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
    const { month } = z.object({ month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/).default(fallback) }).parse(request.query);
    const [year, index] = month.split("-").map(Number);
    const start = new Date(Date.UTC(year, index - 1, 1, 3)).toISOString(), end = new Date(Date.UTC(year, index, 1, 3)).toISOString();
    const count = (sql: string, ...params: string[]) => (db.prepare(sql).get(...params) as { n: number }).n;
    const revenue = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payments WHERE provider <> 'DEMO' AND status = 'APPROVED' AND approved_at >= ? AND approved_at < ?").get(start, end) as { n: number };
    return {
      month, timezone: "America/Bahia", owner: { name: request.user.displayName?.trim() || account.name, canonicalName: account.name, groupCode: "#" }, whatsapp: { ...whatsappStatus(db,config), integration: readWhatsAppIntegration(db,config) }, payments: readPaymentIntegration(db,config), version: gitVersionInfo(),
      metrics: {
        registeredUsers: count("SELECT COUNT(*) AS n FROM users"),
        activeUsers30d: count("SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= ?", new Date(Date.now() - 30 * 86400_000).toISOString()),
        approvedMembers: count("SELECT COUNT(*) AS n FROM group_memberships m JOIN groups g ON g.code = m.group_code WHERE revoked_at IS NULL AND g.enabled = 1"),
        requestsTotal: count("SELECT COUNT(*) AS n FROM participation_requests"),
        pendingRequests: count("SELECT COUNT(*) AS n FROM participation_requests WHERE status = 'PENDING'"),
        requestsMonth: count("SELECT COUNT(*) AS n FROM participation_requests WHERE created_at >= ? AND created_at < ?", start, end),
        completedCyclesMonth: count("SELECT COUNT(*) AS n FROM rounds WHERE status = 'READY' AND completed_at >= ? AND completed_at < ?", start, end),
        playlistsCreatedMonth: count("SELECT COUNT(*) AS n FROM playlist_exports WHERE status = 'SUCCESS' AND updated_at >= ? AND updated_at < ?", start, end),
        approvedPurchasesMonth: count("SELECT COUNT(*) AS n FROM payments WHERE provider <> 'DEMO' AND status = 'APPROVED' AND approved_at >= ? AND approved_at < ?", start, end),
        demoPurchasesMonth: count("SELECT COUNT(*) AS n FROM payments WHERE provider = 'DEMO' AND status = 'APPROVED' AND approved_at >= ? AND approved_at < ?", start, end),
        revenueCentsMonth: revenue.n
      },
      groups: db.prepare(`SELECT g.code,g.enabled,g.whatsapp_group_id AS whatsappGroupId,g.membership_mode AS membershipMode,
        g.last_synced_at AS lastSyncedAt,g.join_url AS joinUrl,
        (SELECT v.provider FROM whatsapp_group_verifications v WHERE v.group_code=g.code ORDER BY v.verified_at DESC LIMIT 1) AS verificationProvider,
        (SELECT v.owner_admin_count FROM whatsapp_group_verifications v WHERE v.group_code=g.code ORDER BY v.verified_at DESC LIMIT 1) AS ownerAdminCount,
        (SELECT v.verified_at FROM whatsapp_group_verifications v WHERE v.group_code=g.code ORDER BY v.verified_at DESC LIMIT 1) AS verifiedAt
        FROM groups g ORDER BY length(g.code),g.code`).all(),
      requests: db.prepare(`SELECT id,name,phone,preferred_group AS preferredGroup,status,source,whatsapp_verified_at AS whatsappVerifiedAt,
        approved_at AS approvedAt,approved_by_owner_id AS approvedByOwnerId,approved_by_owner_name AS approvedByOwnerName,
        created_at AS createdAt,updated_at AS updatedAt
        FROM participation_requests ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END,updated_at DESC LIMIT 200`).all(),
      users: db.prepare(`SELECT COALESCE(u.id,pr.id,gm.phone) AS id,u.id AS userId,COALESCE(u.name,pr.name,'Participante') AS name,gm.phone,
        gm.group_code AS groupCode,COALESCE(u.created_at,pr.created_at,gm.approved_at) AS createdAt,u.last_seen_at AS lastSeenAt,
        u.cooldown_until AS cooldownUntil,u.cooldown_reason AS cooldownReason,
        COALESCE(w.promo_millis,0)+COALESCE(w.reward_millis,0)+COALESCE(w.purchased_millis,0) AS balanceMillis,
        COALESCE(w.promo_millis,0) AS promoMillis,COALESCE(w.purchased_millis,0) AS purchasedMillis,COALESCE(w.reward_millis,0) AS rewardMillis,
        COALESCE(w.extra_slot_passes,0) AS extraPasses,COALESCE(w.payment_hold,0) AS paymentHold,
        gm.approved_at AS approvedAt,gm.approved_by_owner_id AS approvedByOwnerId,gm.approved_by_owner_name AS approvedByOwnerName,
        gm.revoked_at AS revokedAt,gm.source,pr.status AS requestStatus,pr.source AS requestSource
        FROM group_memberships gm
        LEFT JOIN users u ON u.phone=gm.phone
        LEFT JOIN wallets w ON w.user_id=u.id
        LEFT JOIN participation_requests pr ON pr.phone=gm.phone
        ORDER BY gm.approved_at DESC LIMIT 200`).all(),
      members: db.prepare("SELECT phone, group_code AS groupCode, approved_at AS approvedAt, approved_by_owner_id AS approvedByOwnerId, approved_by_owner_name AS approvedByOwnerName, revoked_at AS revokedAt, source FROM group_memberships ORDER BY approved_at DESC LIMIT 200").all(),
      purchases: db.prepare("SELECT p.id,u.name,u.phone,p.provider,p.status,p.amount_cents AS amountCents,p.created_at AS createdAt,p.approved_at AS approvedAt FROM payments p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 200").all()
    };
  });
  app.get("/admin/version", { preHandler: ownerGuard }, async () => gitVersionInfo());
  app.get("/admin/integrations/whatsapp", { preHandler: ownerGuard }, async () => readWhatsAppIntegration(db,config));
  app.post("/admin/integrations/whatsapp", { preHandler: ownerGuard }, async (request) => saveWhatsAppIntegration(db,config,request.body));
  app.get("/admin/integrations/payments", { preHandler: ownerGuard }, async () => readPaymentIntegration(db,config));
  app.post("/admin/integrations/payments", { preHandler: ownerGuard }, async (request) => {
    const state=savePaymentIntegration(db,config,request.body);
    if (state.provider!=="ASAAS" || !state.ready) return state;
    try {
      const setup=await ensureAsaasWebhook(effectivePaymentConfig(db,config));
      return {...state,providerSetup:{ok:true,message:setup.created ? "Webhook Asaas criado e ativado." : "Webhook Asaas atualizado e mantido ativo."}};
    } catch (cause) {
      return {...state,providerSetup:{ok:false,message:cause instanceof Error ? cause.message : "Configuração salva, mas o webhook Asaas precisa ser revisado."}};
    }
  });
  app.post("/admin/integrations/whatsapp/verify-token", { preHandler: ownerGuard }, async () => {
    const verifyToken = generateAndSaveVerifyToken(db,config);
    return { ok:true, verifyToken, state:readWhatsAppIntegration(db,config) };
  });
  app.post("/admin/integrations/whatsapp/validate", { preHandler: ownerGuard }, async () => validateMetaWhatsApp(db,config));

  app.get("/admin/participants/:phone", { preHandler: ownerGuard }, async (request, reply) => {
    const phone = phoneSchema.parse((request.params as { phone: string }).phone);
    const membership = db.prepare(`SELECT phone,group_code AS groupCode,approved_at AS approvedAt,revoked_at AS revokedAt,source,
      approved_by_owner_id AS approvedByOwnerId,approved_by_owner_name AS approvedByOwnerName
      FROM group_memberships WHERE phone=?`).get(phone) as Record<string, unknown> | undefined;
    const participantRequest = db.prepare(`SELECT id,name,phone,preferred_group AS preferredGroup,status,source,whatsapp_verified_at AS whatsappVerifiedAt,
      retry_block_until AS retryBlockUntil,approved_at AS approvedAt,approved_by_owner_id AS approvedByOwnerId,
      approved_by_owner_name AS approvedByOwnerName,created_at AS createdAt,updated_at AS updatedAt
      FROM participation_requests WHERE phone=?`).get(phone) as Record<string, unknown> | undefined;
    const user = db.prepare(`SELECT id,name,phone,group_code AS groupCode,created_at AS createdAt,updated_at AS updatedAt,last_seen_at AS lastSeenAt,
      cooldown_until AS cooldownUntil,cooldown_reason AS cooldownReason FROM users WHERE phone=?`).get(phone) as
      | { id:string; name:string; phone:string; groupCode:string; createdAt:string; updatedAt:string; lastSeenAt?:string; cooldownUntil?:string; cooldownReason?:string }
      | undefined;
    if (!membership && !participantRequest && !user) return reply.code(404).send({ message: "Participante não encontrado." });
    const wallet = user ? db.prepare(`SELECT promo_millis AS promoMillis,purchased_millis AS purchasedMillis,reward_millis AS rewardMillis,
      extra_slot_passes AS extraPasses,payment_hold AS paymentHold,updated_at AS updatedAt FROM wallets WHERE user_id=?`).get(user.id) : undefined;
    const purchases = user ? db.prepare(`SELECT id,provider,status,amount_cents AS amountCents,credits_millis AS creditsMillis,
      extra_passes AS extraPasses,created_at AS createdAt,approved_at AS approvedAt,provider_payment_id AS providerPaymentId
      FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 50`).all(user.id) : [];
    const ledger = user ? db.prepare(`SELECT id,kind,amount_millis AS amountMillis,reference_id AS referenceId,note,
      actor_owner_name AS actorOwnerName,created_at AS createdAt FROM wallet_ledger WHERE user_id=? ORDER BY created_at DESC LIMIT 80`).all(user.id) : [];
    const activity = user ? {
      submissions: (db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE user_id=?").get(user.id) as {n:number}).n,
      playlists: (db.prepare("SELECT COUNT(*) AS n FROM playlist_exports WHERE user_id=? AND status='SUCCESS'").get(user.id) as {n:number}).n
    } : { submissions:0,playlists:0 };
    const effectiveGroup = (membership as { groupCode?:string } | undefined)?.groupCode ?? user?.groupCode ?? (participantRequest as { preferredGroup?:string } | undefined)?.preferredGroup;
    return {
      profile: {
        name: user?.name ?? (participantRequest as { name?:string } | undefined)?.name ?? "Participante",
        phone,
        groupCode: effectiveGroup,
        userId: user?.id,
        createdAt: user?.createdAt ?? (participantRequest as { createdAt?:string } | undefined)?.createdAt,
        lastSeenAt: user?.lastSeenAt,
        cooldownUntil: user?.cooldownUntil,
        cooldownReason: user?.cooldownReason
      },
      membership,
      request: participantRequest,
      wallet,
      purchases,
      ledger,
      activity,
      verification: effectiveGroup ? groupVerificationState(db,phone,effectiveGroup) : undefined
    };
  });

  app.patch("/admin/participants/:phone", { preHandler: ownerGuard }, async (request, reply) => {
    const currentPhone = phoneSchema.parse((request.params as { phone: string }).phone);
    const body = z.object({
      name: z.string().trim().min(2).max(80),
      phone: phoneSchema,
      groupCode: groupSchema
    }).parse(request.body);
    if (!db.prepare("SELECT 1 FROM groups WHERE code=? AND enabled=1").get(body.groupCode)) return reply.code(400).send({ message:"Grupo inexistente ou desativado." });
    if (body.phone !== currentPhone) {
      const collision = db.prepare(`SELECT 1 FROM users WHERE phone=? UNION SELECT 1 FROM participation_requests WHERE phone=? UNION SELECT 1 FROM group_memberships WHERE phone=? LIMIT 1`)
        .get(body.phone,body.phone,body.phone);
      if (collision) return reply.code(409).send({ message:"O novo WhatsApp já pertence a outro cadastro." });
    }
    const membership = db.prepare("SELECT 1 FROM group_memberships WHERE phone=?").get(currentPhone);
    const participantRequest = db.prepare("SELECT 1 FROM participation_requests WHERE phone=?").get(currentPhone);
    const user = db.prepare("SELECT id FROM users WHERE phone=?").get(currentPhone) as {id:string}|undefined;
    if (!membership && !participantRequest && !user) return reply.code(404).send({ message:"Participante não encontrado." });
    const account = ownerAccounts(config).find((o) => `owner:${o.id}` === request.user.sub)!;
    const ownerName = request.user.displayName?.trim() || account.name;
    const stamp = new Date().toISOString();
    db.transaction(() => {
      if (body.phone !== currentPhone) {
        db.prepare("UPDATE users SET phone=?,updated_at=? WHERE phone=?").run(body.phone,stamp,currentPhone);
        db.prepare("UPDATE participation_requests SET phone=?,updated_at=? WHERE phone=?").run(body.phone,stamp,currentPhone);
        db.prepare("UPDATE group_memberships SET phone=? WHERE phone=?").run(body.phone,currentPhone);
        db.prepare("UPDATE login_codes SET phone=? WHERE phone=?").run(body.phone,currentPhone);
        db.prepare("UPDATE whatsapp_member_verifications SET phone=? WHERE phone=?").run(body.phone,currentPhone);
        const conversation = db.prepare("SELECT 1 FROM whatsapp_conversations WHERE phone=?").get(currentPhone);
        if (conversation && !db.prepare("SELECT 1 FROM whatsapp_conversations WHERE phone=?").get(body.phone)) {
          db.prepare("UPDATE whatsapp_conversations SET phone=? WHERE phone=?").run(body.phone,currentPhone);
        }
      }
      db.prepare("UPDATE users SET name=?,group_code=?,updated_at=? WHERE phone=?").run(body.name,body.groupCode,stamp,body.phone);
      db.prepare(`UPDATE participation_requests SET name=?,preferred_group=?,approved_at=COALESCE(approved_at,?),approved_by_owner_id=COALESCE(approved_by_owner_id,?),
        approved_by_owner_name=COALESCE(approved_by_owner_name,?),updated_at=? WHERE phone=?`)
        .run(body.name,body.groupCode,stamp,account.id,ownerName,stamp,body.phone);
      db.prepare(`UPDATE group_memberships SET group_code=?,approved_by_owner_id=COALESCE(approved_by_owner_id,?),
        approved_by_owner_name=COALESCE(approved_by_owner_name,?) WHERE phone=?`).run(body.groupCode,account.id,ownerName,body.phone);
    })();
    return { ok:true,phone:body.phone };
  });

  app.post("/admin/participants/:phone/action", { preHandler: ownerGuard }, async (request, reply) => {
    const phone = phoneSchema.parse((request.params as { phone: string }).phone);
    const { action } = z.object({ action:z.enum(["REVOKE","RESTORE","CLEAR_COOLDOWN","REVIEW_ON","REVIEW_OFF"]) }).parse(request.body);
    const membership = db.prepare("SELECT group_code AS groupCode FROM group_memberships WHERE phone=?").get(phone) as {groupCode:string}|undefined;
    const user = db.prepare("SELECT id FROM users WHERE phone=?").get(phone) as {id:string}|undefined;
    if (!membership && !user) return reply.code(404).send({ message:"Participante não encontrado." });
    const account = ownerAccounts(config).find((o) => `owner:${o.id}` === request.user.sub)!;
    const approvedBy = { id:account.id,name:request.user.displayName?.trim() || account.name };
    const stamp = new Date().toISOString();
    if (action === "REVOKE") db.prepare("UPDATE group_memberships SET revoked_at=? WHERE phone=?").run(stamp,phone);
    if (action === "RESTORE") {
      if (!membership) return reply.code(409).send({ message:"Não existe grupo associado para restaurar." });
      const result=materializeApprovedMembership(db,phone,membership.groupCode,stamp,approvedBy);
      if (!result.accessGranted) return reply.code(409).send({ message:"A aprovação Owner está registrada, mas a verificação externa exigida pelo grupo ainda não foi concluída.",verification:result.state });
    }
    if (action === "CLEAR_COOLDOWN") {
      if (!user) return reply.code(409).send({ message:"Este participante ainda não criou uma conta de uso." });
      db.prepare("UPDATE users SET cooldown_until=NULL,cooldown_reason=NULL,updated_at=? WHERE id=?").run(stamp,user.id);
    }
    if (action === "REVIEW_ON" || action === "REVIEW_OFF") {
      if (!user) return reply.code(409).send({ message:"Este participante ainda não possui carteira." });
      db.prepare("UPDATE wallets SET payment_hold=?,updated_at=? WHERE user_id=?").run(action==="REVIEW_ON" ? 1 : 0,stamp,user.id);
    }
    return { ok:true };
  });

  app.post("/admin/participants/:phone/wallet-adjustment", { preHandler: ownerGuard }, async (request, reply) => {
    const phone = phoneSchema.parse((request.params as { phone: string }).phone);
    const body = z.object({ amountCoins:z.number().min(-1000).max(1000).refine((value)=>value!==0), reason:z.string().trim().min(5).max(240) }).parse(request.body);
    const user = db.prepare("SELECT id FROM users WHERE phone=?").get(phone) as {id:string}|undefined;
    if (!user) return reply.code(409).send({ message:"Este participante ainda não possui carteira." });
    const wallet = db.prepare("SELECT reward_millis AS rewardMillis FROM wallets WHERE user_id=?").get(user.id) as {rewardMillis:number};
    const amountMillis=Math.round(body.amountCoins*1000);
    if (wallet.rewardMillis+amountMillis<0) return reply.code(409).send({ message:"O ajuste negativo ultrapassa o saldo de bônus/recompensas disponível." });
    const account = ownerAccounts(config).find((o) => `owner:${o.id}` === request.user.sub)!;
    const ownerName=request.user.displayName?.trim() || account.name;
    const stamp=new Date().toISOString(), reference=randomUUID();
    db.transaction(() => {
      db.prepare("UPDATE wallets SET reward_millis=reward_millis+?,updated_at=? WHERE user_id=?").run(amountMillis,stamp,user.id);
      db.prepare(`INSERT INTO wallet_ledger (id,user_id,kind,amount_millis,reference_id,created_at,note,actor_owner_id,actor_owner_name)
        VALUES (?,?,'ADMIN_ADJUSTMENT',?,?,?,?,?,?)`).run(randomUUID(),user.id,amountMillis,reference,stamp,body.reason,account.id,ownerName);
    })();
    return { ok:true,amountMillis };
  });

  app.get("/admin/users.csv", { preHandler: ownerGuard }, async (_request, reply) => {
    const rows = db.prepare("SELECT u.name,u.phone,u.group_code,u.created_at,u.last_seen_at,w.promo_millis+w.reward_millis+w.purchased_millis AS balance_millis,w.extra_slot_passes FROM users u JOIN wallets w ON w.user_id=u.id ORDER BY u.created_at DESC").all() as Array<Record<string, unknown>>;
    const columns = ["name","phone","group_code","created_at","last_seen_at","balance_millis","extra_slot_passes"];
    const cell = (value: unknown) => {
      let text = String(value ?? "");
      if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    const csv = [columns.map(cell).join(","), ...rows.map((row) => columns.map((key) => cell(row[key])).join(","))].join("\r\n");
    return reply.type("text/csv; charset=utf-8").header("content-disposition", 'attachment; filename="conexao-usuarios.csv"').send("\ufeff" + csv);
  });
  app.post("/admin/groups", { preHandler: ownerGuard }, async (request) => {
    const body = z.object({
      code: groupSchema,
      enabled: z.boolean().optional(),
      joinUrl: z.union([z.string().url(),z.literal("")]).optional()
    }).parse(request.body);
    const requestedEnabled = body.enabled ?? (body.joinUrl===undefined ? true : undefined);
    db.prepare("INSERT OR IGNORE INTO groups (code, enabled) VALUES (?, ?)").run(body.code,requestedEnabled ? 1 : 0);
    if (requestedEnabled!==undefined) db.prepare("UPDATE groups SET enabled=? WHERE code=?").run(requestedEnabled ? 1 : 0,body.code);
    if (body.joinUrl!==undefined) db.prepare("UPDATE groups SET join_url=? WHERE code=?").run(body.joinUrl || null,body.code);
    const group = db.prepare(`SELECT code,enabled,whatsapp_group_id AS whatsappGroupId,membership_mode AS membershipMode,
      last_synced_at AS lastSyncedAt,join_url AS joinUrl FROM groups WHERE code=?`).get(body.code);
    return { ok:true,group };
  });
  app.post("/admin/members", { preHandler: ownerGuard }, async (request, reply) => {
    const body = z.object({ phone: phoneSchema, groupCode: groupSchema, name: z.string().trim().min(2).max(80).optional() }).parse(request.body);
    db.prepare("INSERT INTO groups (code,enabled) VALUES (?,1) ON CONFLICT(code) DO UPDATE SET enabled=1").run(body.groupCode);
    let pending = db.prepare("SELECT id,name,phone,source FROM participation_requests WHERE phone=?").get(body.phone) as { id: string; name: string; phone: string; source: string } | undefined;
    const account = ownerAccounts(config).find((o) => `owner:${o.id}` === request.user.sub)!;
    const approvedBy = { id: account.id, name: request.user.displayName?.trim() || account.name };
    const stamp = new Date().toISOString();
    if (!pending && body.name) {
      const id=randomUUID();
      db.prepare(`INSERT INTO participation_requests
        (id,phone,name,preferred_group,status,source,approved_at,approved_by_owner_id,approved_by_owner_name,created_at,updated_at)
        VALUES (?,?,?,?,'APPROVED','OWNER_MANUAL',?,?,?,?,?)`)
        .run(id,body.phone,body.name,body.groupCode,stamp,approvedBy.id,approvedBy.name,stamp,stamp);
      pending={ id,name:body.name,phone:body.phone,source:"OWNER_MANUAL" };
    } else if (pending) {
      db.prepare("UPDATE participation_requests SET status='APPROVED',preferred_group=?,approved_at=?,approved_by_owner_id=?,approved_by_owner_name=?,updated_at=? WHERE phone=?")
        .run(body.groupCode,stamp,approvedBy.id,approvedBy.name,stamp,body.phone);
    } else {
      return reply.code(400).send({ message: "Informe o nome para uma autorização manual sem solicitação anterior." });
    }
    const result = materializeApprovedMembership(db,body.phone,body.groupCode,stamp,approvedBy);
    if (pending && result.accessGranted) queueParticipationDecision(db,config,pending.id,"APPROVED",body.groupCode);
    return {
      ok: true,
      accessGranted: result.accessGranted,
      verification: result.state,
      message: result.accessGranted
        ? "Aprovação registrada e acesso liberado."
        : "Aprovação registrada. O acesso será liberado após a verificação necessária do grupo."
    };
  });
  app.delete("/admin/members/:phone", { preHandler: ownerGuard }, async (request) => {
    const phone = phoneSchema.parse((request.params as { phone: string }).phone);
    db.prepare("UPDATE group_memberships SET revoked_at=? WHERE phone=?").run(new Date().toISOString(),phone);
    return { ok: true };
  });
  app.post("/admin/requests/:id/decision", { preHandler: ownerGuard }, async (request, reply) => {
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const body = z.object({ status: z.enum(["APPROVED","DECLINED"]), groupCode: groupSchema.optional() }).parse(request.body);
    const row = db.prepare("SELECT id,phone,name,source,preferred_group FROM participation_requests WHERE id=?").get(id) as { id: string; phone: string; name: string; source: string; preferred_group?: string } | undefined;
    if (!row) return reply.code(404).send({ message: "Solicitação não encontrada." });
    const group = body.groupCode ?? row.preferred_group;
    if (body.status === "APPROVED" && !group) return reply.code(400).send({ message: "Escolha um grupo para aprovar." });
    if (body.status === "APPROVED") db.prepare("INSERT INTO groups (code,enabled) VALUES (?,1) ON CONFLICT(code) DO UPDATE SET enabled=1").run(group);
    const account = ownerAccounts(config).find((o) => `owner:${o.id}` === request.user.sub)!;
    const approvedBy = { id: account.id, name: request.user.displayName?.trim() || account.name };
    const now = new Date().toISOString();
    db.prepare(`UPDATE participation_requests SET status=?,approved_at=?,approved_by_owner_id=?,approved_by_owner_name=?,updated_at=? WHERE id=?`)
      .run(body.status,body.status==="APPROVED" ? now : null,body.status==="APPROVED" ? approvedBy.id : null,body.status==="APPROVED" ? approvedBy.name : null,now,id);
    if (body.status === "DECLINED") {
      db.prepare("UPDATE group_memberships SET revoked_at=? WHERE phone=?").run(now,row.phone);
      queueParticipationDecision(db,config,id,"DECLINED",group);
      return { ok:true,accessGranted:false };
    }
    const result = materializeApprovedMembership(db,row.phone,group!,now,approvedBy);
    if (result.accessGranted) queueParticipationDecision(db,config,id,"APPROVED",group);
    return {
      ok:true,
      accessGranted:result.accessGranted,
      verification:result.state,
      message: result.accessGranted
        ? "Aprovação registrada e acesso liberado."
        : "Aprovação do Owner registrada. Aguardando verificação do grupo antes de liberar o acesso."
    };
  });
  return { ownerGuard };
}
