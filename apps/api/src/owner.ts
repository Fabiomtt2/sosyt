import { watchRewardView } from "./watch-rewards.js";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "./config.js";
import type { AppDatabase } from "./db.js";
import { administrativeSessionValid, dynamicOwnerVersion, eligibleAdminName, normalizeOwnerName, ownerAccounts, ownerNameMatches, ownerCredentialVersion, type OwnerRole } from "./owners.js";
import { publicWhatsAppNumber, whatsappJoinUrl, whatsappStatus, queueOwnerAlerts, queueParticipationDecision } from "./whatsapp.js";
import { normalizePhone } from "./phone.js";
import { effectivePaymentConfig, generateAndSaveVerifyToken, gitVersionInfo, readPaymentIntegration, readWhatsAppIntegration, savePaymentIntegration, saveWhatsAppIntegration, validateMetaWhatsApp } from "./integrations.js";
import { ensureAsaasWebhook } from "./payments.js";
import { groupVerificationState, materializeApprovedMembership } from "./group-verification.js";

const phoneSchema = z.string().transform(normalizePhone).pipe(z.string().regex(/^[1-9]\d{7,14}$/, "Informe o WhatsApp com código do país."));
const groupSchema = z.string().regex(/^[1-9]\d{0,2}$/);
const avatarSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("PRESET"),presetId:z.string().regex(/^avatar-(?:0[1-9]|[12]\d|3[0-4])$/)}),
  z.object({kind:z.literal("CUSTOM"),dataUrl:z.string().max(350_000)})
]);
export function resolveGroupForPhone(db:AppDatabase,phone:string):{groupCode?:string;source:"APPROVED"|"EXTERNAL"|"NONE";provider?:string;verifiedAt?:string} {
  const approved=db.prepare(`SELECT m.group_code AS groupCode
    FROM group_memberships m JOIN groups g ON g.code=m.group_code
    WHERE m.phone=? AND m.revoked_at IS NULL AND g.enabled=1 LIMIT 1`).get(phone) as {groupCode:string}|undefined;
  if (approved) return {groupCode:approved.groupCode,source:"APPROVED"};

  const verified=db.prepare(`SELECT mv.group_code AS groupCode,mv.provider,mv.verified_at AS verifiedAt
    FROM whatsapp_member_verifications mv
    JOIN groups g ON g.code=mv.group_code
    WHERE mv.phone=? AND mv.revoked_at IS NULL AND g.enabled=1
    ORDER BY mv.verified_at DESC LIMIT 1`).get(phone) as {groupCode:string;provider:string;verifiedAt:string}|undefined;
  if (verified) return {groupCode:verified.groupCode,source:"EXTERNAL",provider:verified.provider,verifiedAt:verified.verifiedAt};
  return {source:"NONE"};
}

export function hasMembership(db: AppDatabase, phone: string, group?: string): boolean {
  const member = db.prepare("SELECT m.group_code FROM group_memberships m JOIN groups g ON g.code = m.group_code WHERE m.phone = ? AND m.revoked_at IS NULL AND g.enabled = 1").get(phone) as { group_code: string } | undefined;
  if (!member || (group && member.group_code!==group)) return false;
  const verification=groupVerificationState(db,phone,member.group_code);
  return !verification.required || verification.accessReady;
}

function avatarFromProfileRow(row?:{kind:string;preset?:string;image?:Buffer;mime?:string}) {
  if (row?.kind==="PRESET" && row.preset) return {kind:"PRESET" as const,presetId:row.preset};
  if (row?.kind==="CUSTOM" && Buffer.isBuffer(row.image) && row.mime) return {kind:"CUSTOM" as const,dataUrl:`data:${row.mime};base64,${row.image.toString("base64")}`};
  return undefined;
}
function adminAvatar(db:AppDatabase,userId?:string) {
  if (!userId) return undefined;
  return avatarFromProfileRow(db.prepare("SELECT avatar_kind AS kind,avatar_preset AS preset,avatar_image AS image,avatar_mime AS mime FROM user_profiles WHERE user_id=?").get(userId) as {kind:string;preset?:string;image?:Buffer;mime?:string}|undefined);
}
function ownerAvatar(db:AppDatabase,ownerId:string) {
  return avatarFromProfileRow(db.prepare("SELECT avatar_kind AS kind,avatar_preset AS preset,avatar_image AS image,avatar_mime AS mime FROM owner_profiles WHERE owner_id=?").get(ownerId) as {kind:string;preset?:string;image?:Buffer;mime?:string}|undefined);
}

export async function registerOwnerRoutes(
  app: FastifyInstance,
  db: AppDatabase,
  config: Config,
  participantGuard?: (request:FastifyRequest,reply:FastifyReply)=>Promise<unknown>
) {
  for (const code of config.ALLOWED_GROUP_CODES.split(",")) db.prepare("INSERT OR IGNORE INTO groups (code) VALUES (?)").run(code);

  type OwnerContext={id:string;name:string;canonicalName:string;phone:string;role:OwnerRole;userId?:string;dynamic:boolean};

  function resolveOwnerContext(request:FastifyRequest):OwnerContext|undefined {
    if (request.user.purpose!=="owner" || request.user.aud!=="conexao-owner") return undefined;
    const staticAccount=ownerAccounts(config).find((item)=>`owner:${item.id}`===request.user.sub);
    if (staticAccount) {
      if (!staticAccount.secret || !staticAccount.phone || request.user.jti!==ownerCredentialVersion(staticAccount.secret)) return undefined;
      const linked=db.prepare("SELECT id FROM users WHERE phone=? AND deleted_at IS NULL").get(staticAccount.phone) as {id:string}|undefined;
      return {
        id:staticAccount.id,
        name:request.user.displayName?.trim() || staticAccount.name,
        canonicalName:staticAccount.name,
        phone:staticAccount.phone,
        role:staticAccount.role,
        userId:linked?.id,
        dynamic:false
      };
    }
    if (!request.user.sub.startsWith("owner-access:")) return undefined;
    const id=request.user.sub.slice("owner-access:".length);
    const row=db.prepare(`SELECT oa.id,oa.user_id AS userId,oa.phone,oa.normalized_name AS normalizedName,oa.role,oa.active,oa.updated_at AS updatedAt,u.name
      FROM owner_access oa JOIN users u ON u.id=oa.user_id
      WHERE oa.id=? AND oa.active=1 AND u.deleted_at IS NULL`).get(id) as
      | {id:string;userId:string;phone:string;normalizedName:string;role:OwnerRole;active:number;updatedAt:string;name:string}
      | undefined;
    if (!row || request.user.jti!==dynamicOwnerVersion(row.id,row.userId,row.role,row.updatedAt)) return undefined;
    return {id:row.id,name:row.name,canonicalName:row.name,phone:row.phone,role:row.role,userId:row.userId,dynamic:true};
  }

  async function ownerGuard(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      if (!resolveOwnerContext(request)) throw new Error("Wrong role");
    } catch { return reply.code(401).send({ message: "Acesso exclusivo do Owner. Entre novamente." }); }
  }

  async function rootOwnerGuard(request:FastifyRequest,reply:FastifyReply) {
    await ownerGuard(request,reply);
    if (reply.sent) return;
    const owner=resolveOwnerContext(request);
    if (owner?.role!=="ROOT_OWNER") return reply.code(403).send({message:"Esta configuração é exclusiva do Owner principal."});
  }
  const participationToken = (id: string) => app.jwt.sign({ sub: `participation:${id}`, purpose: "participation-status", aud: "conexao-participation" }, { expiresIn: "30d" });
  app.get("/public/groups", async () => {
    const rows = db.prepare("SELECT code,join_url AS joinUrl FROM groups WHERE enabled = 1 ORDER BY length(code), code").all() as Array<{ code: string; joinUrl?: string }>;
    const integration=readWhatsAppIntegration(db,config);
    const publicPhone=publicWhatsAppNumber(config,integration.businessPhone);
    return {
      groups: rows.map(({ code }) => code),
      groupLinks: Object.fromEntries(rows.filter((row)=>row.joinUrl).map((row)=>[row.code,row.joinUrl!])),
      ownerContactAvailable: Boolean(publicPhone),
      membershipRequired: config.REQUIRE_GROUP_MEMBERSHIP,
      whatsappJoinUrl: whatsappJoinUrl(config,integration.businessPhone)
    };
  });
  app.post("/participation/request", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (request, reply) => {
    if(!config.AUTH_DEV_MODE) return reply.code(403).send({code:"IDENTITY_PROOF_REQUIRED",message:"Confirme este WhatsApp com a chave de acesso antes de enviar uma solicitação."});
    const body=z.object({name:z.string().trim().min(2).max(80),phone:phoneSchema,consent:z.literal(true)}).parse(request.body);
    const member=db.prepare("SELECT group_code AS groupCode FROM group_memberships WHERE phone=? AND revoked_at IS NULL").get(body.phone) as {groupCode:string}|undefined;
    if (member) return reply.code(409).send({code:"ALREADY_REGISTERED",alreadyApproved:true,message:"Esse número já possui acesso registrado. Entre pelo acesso normal ou confirme seu WhatsApp para continuar."});
    const detected=resolveGroupForPhone(db,body.phone);
    const detectedGroup=detected.groupCode ?? null;

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
      .run(id,body.name,body.phone,detectedGroup,blockedUntil,stamp,stamp);
    const row = db.prepare("SELECT id FROM participation_requests WHERE phone=?").get(body.phone) as { id: string };
    queueOwnerAlerts(db,config,row.id,body.phone,body.name,`web:${randomUUID()}`);
    return {
      ok: true,
      status: "PENDING",
      requestToken: participationToken(row.id),
      blockedUntil,
      detectedGroup:detectedGroup ?? undefined,
      groupDetectionSource:detected.source,
      message:detectedGroup
        ? `Sua solicitação foi registrada. O número foi reconhecido no SOS YOUTUBER ${detectedGroup} e aguarda decisão do Owner.`
        : "Sua solicitação foi registrada. O grupo será preenchido automaticamente quando a integração confirmar em qual SOS YOUTUBER este número participa."
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
    let row = db.prepare(`SELECT pr.id,pr.name,pr.phone,pr.preferred_group AS preferredGroup,pr.status,pr.retry_block_until AS blockedUntil,
      gm.group_code AS approvedGroup
      FROM participation_requests pr LEFT JOIN group_memberships gm ON gm.phone=pr.phone AND gm.revoked_at IS NULL
      WHERE pr.id=?`).get(id) as
      | { id: string; name: string; phone: string; preferredGroup?: string; status: string; blockedUntil?: string; approvedGroup?: string }
      | undefined;
    if (!row) return reply.code(404).send({ message: "Solicitação não encontrada." });
    if (!row.preferredGroup) {
      const detected=resolveGroupForPhone(db,row.phone);
      if (detected.groupCode) {
        db.prepare("UPDATE participation_requests SET preferred_group=?,updated_at=? WHERE id=?").run(detected.groupCode,new Date().toISOString(),row.id);
        row={...row,preferredGroup:detected.groupCode};
      }
    }
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
    return {
      token: app.jwt.sign({ sub:`owner:${account.id}`,purpose:"owner",aud:"conexao-owner",jti:ownerCredentialVersion(account.secret),displayName,ownerRole:account.role,ownerId:account.id },{expiresIn:"1h"}),
      role:"owner",
      owner:{name:displayName,canonicalName:account.name,groupCode:"#",ownerRole:account.role}
    };
  });

  app.get("/admin/overview", { preHandler: ownerGuard }, async (request) => {
    const account=resolveOwnerContext(request)!;
    const unresolved=db.prepare("SELECT id,phone FROM participation_requests WHERE status='PENDING' AND preferred_group IS NULL").all() as Array<{id:string;phone:string}>;
    for (const pending of unresolved) {
      const detected=resolveGroupForPhone(db,pending.phone);
      if (detected.groupCode) db.prepare("UPDATE participation_requests SET preferred_group=?,updated_at=? WHERE id=?").run(detected.groupCode,new Date().toISOString(),pending.id);
    }
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia", year: "numeric", month: "2-digit" }).formatToParts(new Date());
    const fallback = `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
    const { month } = z.object({ month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/).default(fallback) }).parse(request.query);
    const [year, index] = month.split("-").map(Number);
    const start = new Date(Date.UTC(year, index - 1, 1, 3)).toISOString(), end = new Date(Date.UTC(year, index, 1, 3)).toISOString();
    const count = (sql: string, ...params: string[]) => (db.prepare(sql).get(...params) as { n: number }).n;
    const root=account.role==="ROOT_OWNER";
    const revenue = root
      ? db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payments WHERE provider <> 'DEMO' AND status = 'APPROVED' AND approved_at >= ? AND approved_at < ?").get(start, end) as { n: number }
      : {n:0};
    const productRevenue=root
      ? db.prepare(`SELECT
          COALESCE(SUM(CASE WHEN product_code='COINS_LAUNCH' THEN amount_cents ELSE 0 END),0) AS coinsRevenue,
          COALESCE(SUM(CASE WHEN product_code='PASS_SINGLE' THEN amount_cents ELSE 0 END),0) AS passRevenue,
          COALESCE(SUM(CASE WHEN product_code='LEGACY' THEN amount_cents ELSE 0 END),0) AS legacyRevenue,
          COALESCE(SUM(CASE WHEN product_code='COINS_LAUNCH' THEN 1 ELSE 0 END),0) AS coinsPurchases,
          COALESCE(SUM(CASE WHEN product_code='PASS_SINGLE' THEN 1 ELSE 0 END),0) AS passPurchases
          FROM payments WHERE provider<>'DEMO' AND status='APPROVED' AND approved_at>=? AND approved_at<?`).get(start,end) as
          {coinsRevenue:number;passRevenue:number;legacyRevenue:number;coinsPurchases:number;passPurchases:number}
      : {coinsRevenue:0,passRevenue:0,legacyRevenue:0,coinsPurchases:0,passPurchases:0};
    return {
      month,
      timezone:"America/Bahia",
      owner:{
        name:account.name,canonicalName:account.canonicalName,groupCode:"#",avatar:ownerAvatar(db,account.id),
        role:account.role,linkedUserId:account.userId,
        permissions:{
          canConfigure:root,canManageOwners:root,canOperate:true,canParticipate:true,
          canViewSensitive:root,canAdjustWallet:root,canExport:root
        }
      },
      whatsapp:{...whatsappStatus(db,config),integration:readWhatsAppIntegration(db,config)},
      payments:readPaymentIntegration(db,config),
      version:gitVersionInfo(),
      activeRounds:db.prepare(`SELECT r.id,r.sequence,r.status,r.created_at AS createdAt,r.completed_at AS completedAt,COUNT(s.id) AS submissions
        FROM rounds r LEFT JOIN submissions s ON s.round_id=r.id
        WHERE r.status IN ('OPEN','READY')
        GROUP BY r.id,r.sequence,r.status,r.created_at,r.completed_at
        ORDER BY r.sequence DESC LIMIT 8`).all(),
      metrics: {
        registeredUsers: count("SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL"),
        deletedUsers: count("SELECT COUNT(*) AS n FROM account_deletions"),
        activeUsers30d: count("SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL AND last_seen_at >= ?", new Date(Date.now() - 30 * 86400_000).toISOString()),
        approvedMembers: count("SELECT COUNT(*) AS n FROM group_memberships m JOIN groups g ON g.code = m.group_code WHERE revoked_at IS NULL AND g.enabled = 1"),
        requestsTotal: count("SELECT COUNT(*) AS n FROM participation_requests"),
        pendingRequests: count("SELECT COUNT(*) AS n FROM participation_requests WHERE status = 'PENDING'"),
        requestsMonth: count("SELECT COUNT(*) AS n FROM participation_requests WHERE created_at >= ? AND created_at < ?", start, end),
        completedCyclesMonth: count("SELECT COUNT(*) AS n FROM rounds WHERE status = 'READY' AND completed_at >= ? AND completed_at < ?", start, end),
        playlistsCreatedMonth: count("SELECT COUNT(*) AS n FROM playlist_exports WHERE status = 'SUCCESS' AND updated_at >= ? AND updated_at < ?", start, end),
        approvedPurchasesMonth: root ? count("SELECT COUNT(*) AS n FROM payments WHERE provider <> 'DEMO' AND status = 'APPROVED' AND approved_at >= ? AND approved_at < ?", start, end) : 0,
        demoPurchasesMonth: root ? count("SELECT COUNT(*) AS n FROM payments WHERE provider = 'DEMO' AND status = 'APPROVED' AND approved_at >= ? AND approved_at < ?", start, end) : 0,
        revenueCentsMonth: revenue.n,
        coinsPackagePurchasesMonth:productRevenue.coinsPurchases,
        passPurchasesMonth:productRevenue.passPurchases,
        coinsPackageRevenueCentsMonth:productRevenue.coinsRevenue,
        passRevenueCentsMonth:productRevenue.passRevenue,
        legacyRevenueCentsMonth:productRevenue.legacyRevenue
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
        u.cooldown_until AS cooldownUntil,u.cooldown_reason AS cooldownReason,u.deleted_at AS deletedAt,
        COALESCE(w.promo_millis,0)+COALESCE(w.reward_millis,0)+COALESCE(w.purchased_millis,0) AS balanceMillis,
        COALESCE(w.promo_millis,0) AS promoMillis,COALESCE(w.purchased_millis,0) AS purchasedMillis,COALESCE(w.reward_millis,0) AS rewardMillis,
        COALESCE(w.extra_slot_passes,0) AS extraPasses,COALESCE(w.payment_hold,0) AS paymentHold,
        gm.approved_at AS approvedAt,gm.approved_by_owner_id AS approvedByOwnerId,gm.approved_by_owner_name AS approvedByOwnerName,
        gm.revoked_at AS revokedAt,gm.source,pr.status AS requestStatus,pr.source AS requestSource,
        y.channel_id AS youtubeChannelId,y.channel_title AS youtubeChannelTitle,y.channel_thumbnail_url AS youtubeChannelThumbnailUrl
        FROM group_memberships gm
        LEFT JOIN users u ON u.phone=gm.phone
        LEFT JOIN wallets w ON w.user_id=u.id
        LEFT JOIN youtube_connections y ON y.user_id=u.id
        LEFT JOIN participation_requests pr ON pr.phone=gm.phone
        ORDER BY gm.approved_at DESC LIMIT 200`).all(),
      members: db.prepare("SELECT phone, group_code AS groupCode, approved_at AS approvedAt, approved_by_owner_id AS approvedByOwnerId, approved_by_owner_name AS approvedByOwnerName, revoked_at AS revokedAt, source FROM group_memberships ORDER BY approved_at DESC LIMIT 200").all(),
      purchases: root ? db.prepare(`SELECT p.id,p.user_id AS userId,u.name,u.phone,u.deleted_at AS userDeletedAt,p.product_code AS productCode,
        p.provider,p.status,p.amount_cents AS amountCents,p.credits_millis AS creditsMillis,p.extra_passes AS extraPasses,
        p.created_at AS createdAt,p.approved_at AS approvedAt
        FROM payments p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 200`).all() : [],
      deletedAccounts: db.prepare(`SELECT user_id AS userId,group_code AS groupCode,deleted_at AS deletedAt,source,
        submissions_count AS submissionsCount,rounds_count AS roundsCount,approved_payment_cents AS approvedPaymentCents,
        coins_purchased_millis AS coinsPurchasedMillis,passes_purchased AS passesPurchased
        FROM account_deletions ORDER BY deleted_at DESC LIMIT 200`).all()
    };
  });
  app.put("/admin/profile/avatar", { preHandler: ownerGuard }, async (request,reply) => {
    const account=resolveOwnerContext(request);
    if (!account) return reply.code(401).send({message:"Conta Owner não encontrada."});
    const body=avatarSchema.parse(request.body);
    const now=new Date().toISOString();
    if (body.kind==="PRESET") {
      db.prepare(`INSERT INTO owner_profiles (owner_id,avatar_kind,avatar_preset,avatar_image,avatar_mime,updated_at)
        VALUES (?,'PRESET',?,NULL,NULL,?)
        ON CONFLICT(owner_id) DO UPDATE SET avatar_kind='PRESET',avatar_preset=excluded.avatar_preset,avatar_image=NULL,avatar_mime=NULL,updated_at=excluded.updated_at`)
        .run(account.id,body.presetId,now);
    } else {
      const match=/^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl);
      if (!match) return reply.code(400).send({message:"Use uma foto preparada em WebP."});
      const buffer=Buffer.from(match[1],"base64");
      if (buffer.length>240_000) return reply.code(413).send({message:"A foto ficou grande demais. Escolha uma imagem menor."});
      db.prepare(`INSERT INTO owner_profiles (owner_id,avatar_kind,avatar_preset,avatar_image,avatar_mime,updated_at)
        VALUES (?,'CUSTOM',NULL,?,'image/webp',?)
        ON CONFLICT(owner_id) DO UPDATE SET avatar_kind='CUSTOM',avatar_preset=NULL,avatar_image=excluded.avatar_image,avatar_mime='image/webp',updated_at=excluded.updated_at`)
        .run(account.id,buffer,now);
    }
    return {avatar:ownerAvatar(db,account.id)};
  });
  app.delete("/admin/profile/avatar", { preHandler: ownerGuard }, async (request,reply) => {
    const account=resolveOwnerContext(request);
    if (!account) return reply.code(401).send({message:"Conta Owner não encontrada."});
    db.prepare("DELETE FROM owner_profiles WHERE owner_id=?").run(account.id);
    return {ok:true};
  });

  app.get("/admin/version", { preHandler: ownerGuard }, async () => gitVersionInfo());
  app.get("/admin/integrations/whatsapp", { preHandler: rootOwnerGuard }, async () => readWhatsAppIntegration(db,config));
  app.post("/admin/integrations/whatsapp", { preHandler: rootOwnerGuard }, async (request) => saveWhatsAppIntegration(db,config,request.body));
  app.get("/admin/integrations/payments", { preHandler: rootOwnerGuard }, async () => readPaymentIntegration(db,config));
  app.post("/admin/integrations/payments", { preHandler: rootOwnerGuard }, async (request) => {
    const state=savePaymentIntegration(db,config,request.body);
    if (state.provider!=="ASAAS" || !state.ready) return state;
    try {
      const setup=await ensureAsaasWebhook(effectivePaymentConfig(db,config));
      return {...state,providerSetup:{ok:true,message:setup.created ? "Webhook Asaas criado e ativado." : "Webhook Asaas atualizado e mantido ativo."}};
    } catch (cause) {
      return {...state,providerSetup:{ok:false,message:cause instanceof Error ? cause.message : "Configuração salva, mas o webhook Asaas precisa ser revisado."}};
    }
  });
  app.post("/admin/integrations/whatsapp/verify-token", { preHandler: rootOwnerGuard }, async () => {
    const verifyToken = generateAndSaveVerifyToken(db,config);
    return { ok:true, verifyToken, state:readWhatsAppIntegration(db,config) };
  });
  app.post("/admin/integrations/whatsapp/validate", { preHandler: rootOwnerGuard }, async () => validateMetaWhatsApp(db,config));

  app.get("/admin/participants/:phone", { preHandler: ownerGuard }, async (request, reply) => {
    const account=resolveOwnerContext(request)!;
    const canViewSensitive=account.role==="ROOT_OWNER";
    const phone = phoneSchema.parse((request.params as { phone: string }).phone);
    const membership = db.prepare(`SELECT phone,group_code AS groupCode,approved_at AS approvedAt,revoked_at AS revokedAt,source,
      approved_by_owner_id AS approvedByOwnerId,approved_by_owner_name AS approvedByOwnerName
      FROM group_memberships WHERE phone=?`).get(phone) as Record<string, unknown> | undefined;
    const participantRequest = db.prepare(`SELECT id,name,phone,preferred_group AS preferredGroup,status,source,whatsapp_verified_at AS whatsappVerifiedAt,
      retry_block_until AS retryBlockUntil,approved_at AS approvedAt,approved_by_owner_id AS approvedByOwnerId,
      approved_by_owner_name AS approvedByOwnerName,created_at AS createdAt,updated_at AS updatedAt
      FROM participation_requests WHERE phone=?`).get(phone) as Record<string, unknown> | undefined;
    const user = db.prepare(`SELECT u.id,u.name,u.phone,u.group_code AS groupCode,u.created_at AS createdAt,u.updated_at AS updatedAt,u.last_seen_at AS lastSeenAt,
      u.cooldown_until AS cooldownUntil,u.cooldown_reason AS cooldownReason,
      y.channel_id AS youtubeChannelId,y.channel_title AS youtubeChannelTitle,y.channel_thumbnail_url AS youtubeChannelThumbnailUrl
      FROM users u LEFT JOIN youtube_connections y ON y.user_id=u.id WHERE u.phone=?`).get(phone) as
      | { id:string; name:string; phone:string; groupCode:string; createdAt:string; updatedAt:string; lastSeenAt?:string; cooldownUntil?:string; cooldownReason?:string;
          youtubeChannelId?:string; youtubeChannelTitle?:string; youtubeChannelThumbnailUrl?:string }
      | undefined;
    if (!membership && !participantRequest && !user) return reply.code(404).send({ message: "Participante não encontrado." });
    const wallet = user ? db.prepare(`SELECT promo_millis AS promoMillis,purchased_millis AS purchasedMillis,reward_millis AS rewardMillis,
      extra_slot_passes AS extraPasses,payment_hold AS paymentHold,updated_at AS updatedAt FROM wallets WHERE user_id=?`).get(user.id) : undefined;
    const purchases = canViewSensitive && user ? db.prepare(`SELECT id,product_code AS productCode,provider,status,amount_cents AS amountCents,credits_millis AS creditsMillis,
      extra_passes AS extraPasses,created_at AS createdAt,approved_at AS approvedAt,provider_payment_id AS providerPaymentId
      FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 50`).all(user.id) : [];
    const ledger = canViewSensitive && user ? db.prepare(`SELECT id,kind,amount_millis AS amountMillis,reference_id AS referenceId,note,
      actor_owner_name AS actorOwnerName,created_at AS createdAt FROM wallet_ledger WHERE user_id=? ORDER BY created_at DESC LIMIT 80`).all(user.id) : [];
    const activity = user ? {
      submissions: (db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE user_id=?").get(user.id) as {n:number}).n,
      rounds: (db.prepare("SELECT COUNT(DISTINCT round_id) AS n FROM submissions WHERE user_id=?").get(user.id) as {n:number}).n,
      playlists: (db.prepare("SELECT COUNT(*) AS n FROM playlist_exports WHERE user_id=? AND status='SUCCESS'").get(user.id) as {n:number}).n,
      completedTasks:(db.prepare("SELECT COUNT(*) AS n FROM playlist_watch_progress WHERE user_id=? AND finalized_at IS NOT NULL").get(user.id) as {n:number}).n
    } : { submissions:0,rounds:0,playlists:0,completedTasks:0 };
    const purchaseTotals=canViewSensitive && user ? db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN status='APPROVED' THEN credits_millis ELSE 0 END),0) AS coinsPurchasedMillis,
      COALESCE(SUM(CASE WHEN status='APPROVED' AND product_code='PASS_SINGLE' THEN extra_passes ELSE 0 END),0) AS passesPurchased,
      COALESCE(SUM(CASE WHEN status='APPROVED' AND product_code='COINS_LAUNCH' THEN extra_passes ELSE 0 END),0) AS bonusPasses,
      COALESCE(SUM(CASE WHEN status='APPROVED' THEN amount_cents ELSE 0 END),0) AS approvedSpendCents
      FROM payments WHERE user_id=?`).get(user.id) : undefined;
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
        cooldownReason: user?.cooldownReason,
        avatar:adminAvatar(db,user?.id),
        youtubeChannel:user?.youtubeChannelTitle ? {
          id:user.youtubeChannelId,
          title:user.youtubeChannelTitle,
          thumbnailUrl:user.youtubeChannelThumbnailUrl
        } : undefined
      },
      membership,
      request: participantRequest,
      wallet,
      purchases,
      purchaseTotals,
      ledger,
      activity,
      watchRewards:user ? watchRewardView(db,user.id) : {verifiedSeconds:0,coins:0,secondsToNextReward:1200},
      verification: effectiveGroup ? groupVerificationState(db,phone,effectiveGroup) : undefined,
      permissions:{canViewSensitive,canAdjustWallet:canViewSensitive,canReviewWallet:canViewSensitive}
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
    const account=resolveOwnerContext(request)!;
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
    const account=resolveOwnerContext(request)!;
    if ((action==="REVIEW_ON" || action==="REVIEW_OFF") && account.role!=="ROOT_OWNER") {
      return reply.code(403).send({message:"A revisão financeira é exclusiva de um Owner principal."});
    }
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

  app.post("/admin/participants/:phone/wallet-adjustment", { preHandler: rootOwnerGuard }, async (request, reply) => {
    const phone = phoneSchema.parse((request.params as { phone: string }).phone);
    const body = z.object({ amountCoins:z.number().min(-1000).max(1000).refine((value)=>value!==0), reason:z.string().trim().min(5).max(240) }).parse(request.body);
    const user = db.prepare("SELECT id FROM users WHERE phone=?").get(phone) as {id:string}|undefined;
    if (!user) return reply.code(409).send({ message:"Este participante ainda não possui carteira." });
    const wallet = db.prepare("SELECT reward_millis AS rewardMillis FROM wallets WHERE user_id=?").get(user.id) as {rewardMillis:number};
    const amountMillis=Math.round(body.amountCoins*1000);
    if (wallet.rewardMillis+amountMillis<0) return reply.code(409).send({ message:"O ajuste negativo ultrapassa o saldo de bônus/recompensas disponível." });
    const account=resolveOwnerContext(request)!;
    const ownerName=request.user.displayName?.trim() || account.name;
    const stamp=new Date().toISOString(), reference=randomUUID();
    db.transaction(() => {
      db.prepare("UPDATE wallets SET reward_millis=reward_millis+?,updated_at=? WHERE user_id=?").run(amountMillis,stamp,user.id);
      db.prepare(`INSERT INTO wallet_ledger (id,user_id,kind,amount_millis,reference_id,created_at,note,actor_owner_id,actor_owner_name)
        VALUES (?,?,'ADMIN_ADJUSTMENT',?,?,?,?,?,?)`).run(randomUUID(),user.id,amountMillis,reference,stamp,body.reason,account.id,ownerName);
    })();
    return { ok:true,amountMillis };
  });

  app.get("/admin/users.csv", { preHandler: rootOwnerGuard }, async (_request, reply) => {
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
  app.post("/admin/groups", { preHandler: rootOwnerGuard }, async (request) => {
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
    const account=resolveOwnerContext(request)!;
    const activeGroup=db.prepare("SELECT 1 FROM groups WHERE code=? AND enabled=1").get(body.groupCode);
    if (account.role==="ROOT_OWNER") db.prepare("INSERT INTO groups (code,enabled) VALUES (?,1) ON CONFLICT(code) DO UPDATE SET enabled=1").run(body.groupCode);
    else if (!activeGroup) return reply.code(403).send({message:"Administradores delegados só podem autorizar participantes em grupos já habilitados por um Owner principal."});
    let pending = db.prepare("SELECT id,name,phone,source FROM participation_requests WHERE phone=?").get(body.phone) as { id: string; name: string; phone: string; source: string } | undefined;
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
    const body=z.object({status:z.enum(["APPROVED","DECLINED"])}).parse(request.body);
    const row = db.prepare("SELECT id,phone,name,source,preferred_group FROM participation_requests WHERE id=?").get(id) as { id: string; phone: string; name: string; source: string; preferred_group?: string } | undefined;
    if (!row) return reply.code(404).send({ message: "Solicitação não encontrada." });
    const detected=resolveGroupForPhone(db,row.phone);
    const group=row.preferred_group ?? detected.groupCode;
    if (body.status==="APPROVED" && !group) return reply.code(409).send({code:"GROUP_NOT_DETECTED",message:"Ainda não foi possível confirmar o grupo deste WhatsApp. Atualize/sincronize a integração antes de aprovar."});
    const account=resolveOwnerContext(request)!;
    if (body.status === "APPROVED") {
      const activeGroup=db.prepare("SELECT 1 FROM groups WHERE code=? AND enabled=1").get(group);
      if (account.role==="ROOT_OWNER") db.prepare("INSERT INTO groups (code,enabled) VALUES (?,1) ON CONFLICT(code) DO UPDATE SET enabled=1").run(group);
      else if (!activeGroup) return reply.code(403).send({message:"Administradores delegados só podem aprovar pessoas em grupos já habilitados por um Owner principal."});
    }
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

  if (participantGuard) {
    app.post("/admin/elevate", { preHandler: participantGuard }, async (request, reply) => {
      const user=db.prepare("SELECT id,name,phone FROM users WHERE id=? AND deleted_at IS NULL").get(request.user.sub) as {id:string;name:string;phone:string}|undefined;
      if (!user) return reply.code(401).send({message:"Sua sessão de participante não está ativa."});

      const staticAccount=ownerAccounts(config).find((item)=>item.phone===user.phone && ownerNameMatches(item.name,user.name));
      if (staticAccount?.secret) {
        if (!administrativeSessionValid(db,config,request.user)) return reply.code(403).send({message:"Entre com sua credencial Owner para acessar o painel administrativo."});
        return {
          token:app.jwt.sign({
            sub:`owner:${staticAccount.id}`,purpose:"owner",aud:"conexao-owner",
            jti:ownerCredentialVersion(staticAccount.secret),displayName:user.name,ownerRole:staticAccount.role,ownerId:staticAccount.id
          },{expiresIn:"1h"}),
          role:"owner",
          ownerRole:staticAccount.role
        };
      }

      const access=db.prepare(`SELECT id,user_id AS userId,phone,normalized_name AS normalizedName,role,updated_at AS updatedAt
        FROM owner_access WHERE user_id=? AND active=1`).get(user.id) as
        | {id:string;userId:string;phone:string;normalizedName:string;role:OwnerRole;updatedAt:string}
        | undefined;
      if (!access || access.normalizedName!==normalizeOwnerName(user.name) || (!config.AUTH_DEV_MODE && request.user.authMethod!=="google" && request.user.authMethod!=="otp" && !administrativeSessionValid(db,config,request.user))) {
        return reply.code(403).send({message:"Esta conta de participante não possui acesso administrativo ativo."});
      }
      return {
        token:app.jwt.sign({
          sub:`owner-access:${access.id}`,purpose:"owner",aud:"conexao-owner",
          jti:dynamicOwnerVersion(access.id,access.userId,access.role,access.updatedAt),
          displayName:user.name,ownerRole:access.role,ownerId:access.id
        },{expiresIn:"1h"}),
        role:"owner",
        ownerRole:access.role
      };
    });
  }

  app.post("/admin/participant-session", { preHandler: ownerGuard }, async (request) => {
    const owner=resolveOwnerContext(request)!;
    let user=db.prepare("SELECT id,name,phone,group_code AS groupCode,deleted_at AS deletedAt FROM users WHERE phone=?")
      .get(owner.phone) as {id:string;name:string;phone:string;groupCode:string;deletedAt?:string}|undefined;

    if (!user) {
      const now=new Date().toISOString();
      const id=randomUUID();
      db.transaction(()=>{
        db.prepare("INSERT INTO users (id,name,phone,group_code,created_at,updated_at) VALUES (?,?,?,?,?,?)")
          .run(id,owner.name,owner.phone,"#",now,now);
        db.prepare("INSERT INTO wallets (user_id,updated_at) VALUES (?,?)").run(id,now);
        db.prepare("INSERT INTO wallet_ledger (id,user_id,kind,amount_millis,reference_id,created_at,note,actor_owner_id,actor_owner_name) VALUES (?,?, 'WELCOME',10000,NULL,?,?,?,?)")
          .run(randomUUID(),id,now,"Identidade de participação administrativa criada.",owner.id,owner.name);
      })();
      user={id,name:owner.name,phone:owner.phone,groupCode:"#"};
    } else if (user.deletedAt) {
      const now=new Date().toISOString();
      db.prepare("UPDATE users SET name=?,group_code='#',deleted_at=NULL,deleted_source=NULL,updated_at=? WHERE id=?")
        .run(owner.name,now,user.id);
      db.prepare("INSERT OR IGNORE INTO wallets (user_id,updated_at) VALUES (?,?)").run(user.id,now);
      user={...user,name:owner.name,groupCode:"#",deletedAt:undefined};
    }

    const token=app.jwt.sign({
      sub:user.id,purpose:"session",aud:"conexao-session",adminRole:owner.role,ownerId:owner.id,displayName:owner.name,jti:request.user.jti
    });
    const rounds=db.prepare(`SELECT r.id,r.sequence,r.status,COUNT(s.id) AS submissions
      FROM rounds r LEFT JOIN submissions s ON s.round_id=r.id
      WHERE r.status IN ('OPEN','READY')
      GROUP BY r.id,r.sequence,r.status ORDER BY r.sequence DESC LIMIT 8`).all();
    return {token,user:{id:user.id,name:user.name,phone:user.phone,groupCode:user.groupCode},adminRole:owner.role,rounds};
  });

  app.get("/admin/owners", { preHandler: rootOwnerGuard }, async () => {
    const staticRows=ownerAccounts(config).map((item)=>{
      const linked=db.prepare("SELECT id FROM users WHERE phone=? AND deleted_at IS NULL").get(item.phone) as {id:string}|undefined;
      return {id:`static:${item.id}`,name:item.name,phone:item.phone,role:item.role,active:true,static:true,userId:linked?.id};
    });
    const dynamicRows=db.prepare(`SELECT oa.id,oa.user_id AS userId,u.name,oa.phone,oa.role,oa.active,
      oa.created_by_owner_id AS createdByOwnerId,oa.created_at AS createdAt,oa.updated_at AS updatedAt
      FROM owner_access oa JOIN users u ON u.id=oa.user_id ORDER BY oa.active DESC,oa.updated_at DESC`).all() as Array<Record<string,unknown>>;
    const dynamicByUser=new Set(dynamicRows.filter((row)=>row.active===1).map((row)=>String(row.userId)));
    const staticPhones=new Set(ownerAccounts(config).map((item)=>item.phone));
    const users=db.prepare(`SELECT u.id,u.name,u.phone,u.group_code AS groupCode
      FROM users u JOIN group_memberships gm ON gm.phone=u.phone AND gm.revoked_at IS NULL
      JOIN groups g ON g.code=gm.group_code AND g.enabled=1
      WHERE u.deleted_at IS NULL ORDER BY u.name`).all() as Array<{id:string;name:string;phone:string;groupCode:string}>;
    const candidates=users.filter((user)=>eligibleAdminName(user.name)&&!dynamicByUser.has(user.id)&&!staticPhones.has(user.phone));
    return {owners:[...staticRows,...dynamicRows],candidates};
  });

  app.post("/admin/owners", { preHandler: rootOwnerGuard }, async (request, reply) => {
    const {userId}=z.object({userId:z.string().uuid()}).parse(request.body);
    const user=db.prepare("SELECT id,name,phone,group_code AS groupCode FROM users WHERE id=? AND deleted_at IS NULL").get(userId) as
      | {id:string;name:string;phone:string;groupCode:string}
      | undefined;
    if (!user) return reply.code(404).send({message:"Usuário verificado não encontrado."});
    if (!eligibleAdminName(user.name)) return reply.code(403).send({message:"Somente authids Fabio/Fábio ou Rafael podem receber acesso administrativo."});
    if (!hasMembership(db,user.phone,user.groupCode)) return reply.code(409).send({message:"Este authid precisa manter um acesso de participante aprovado antes da promoção."});
    const actor=resolveOwnerContext(request)!;
    const now=new Date().toISOString();
    const existing=db.prepare("SELECT id,created_at AS createdAt FROM owner_access WHERE user_id=? OR phone=? LIMIT 1").get(user.id,user.phone) as {id:string;createdAt:string}|undefined;
    const id=existing?.id ?? randomUUID();
    db.prepare(`INSERT INTO owner_access (id,user_id,phone,normalized_name,role,active,created_by_owner_id,created_at,updated_at)
      VALUES (?,?,?,?, 'ADMIN_OWNER',1,?,?,?)
      ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,phone=excluded.phone,normalized_name=excluded.normalized_name,
        role='ADMIN_OWNER',active=1,created_by_owner_id=excluded.created_by_owner_id,updated_at=excluded.updated_at`)
      .run(id,user.id,user.phone,normalizeOwnerName(user.name),actor.id,existing?.createdAt ?? now,now);
    return {ok:true,id,userId:user.id,name:user.name,phone:user.phone,role:"ADMIN_OWNER"};
  });

  app.delete("/admin/owners/:id", { preHandler: rootOwnerGuard }, async (request, reply) => {
    const id=z.string().uuid().parse((request.params as {id:string}).id);
    const changed=db.prepare("UPDATE owner_access SET active=0,updated_at=? WHERE id=?").run(new Date().toISOString(),id);
    if (!changed.changes) return reply.code(404).send({message:"Administrador não encontrado."});
    return {ok:true};
  });

  return { ownerGuard, rootOwnerGuard };
}
