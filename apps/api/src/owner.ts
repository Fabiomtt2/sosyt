import { humanSupportNumber, humanHandoffAlert } from "./bot-human-handoff.js";
import { readSupportAvailability, saveSupportAvailability } from "./support-availability.js";
import { botAutomationRuntimeStatus, recordBotAutomationEvent, dispatchBotAutomations } from "./bot-automation-runtime.js";
import { featureEnabled } from "./bot.js";
import { gamificationData } from "./gamification-view.js";
import { listCatalog, catalogTierOf } from "./avatar-tiers.js";
import { superState, grantSuper, revokeSuper, setAutoRenew, activePins, removePin, SUPER_DAYS } from "./super.js";
import { credentialState, setCredential, clearCredential, verifyCredential } from "./admin-credentials.js";
import { generateBotPassword, generateAdminCredential } from "./password.js";
import { checkNumberHealth, lastNumberHealth, REPLACEMENT_STEPS } from "./number-health.js";
import { adminDeleteMessage as chatDelete, adminSetPinned, adminClearChat, adminMute, adminUnmute, adminSetCooldown, adminRemoveFromRoom, adminRestoreToRoom } from "./global-chat.js";
import { botStatus, saveBotSettings, BOT_FEATURES } from "./bot.js";
import { ownerBroadcast, ownerListRecent, ownerDeleteMessage } from "./mailbox.js";
import { listStoreProducts, upsertStoreProduct, setStoreProductActive } from "./store.js";
import { generateSetupCode, normalizeSetupCode, hashPassword } from "./password.js";
import { watchRewardView } from "./watch-rewards.js";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "./config.js";
import { devAuthEnabled } from "./config.js";
import type { AppDatabase } from "./db.js";
import { effectiveOwnerAccounts, ownerPhoneKey, administrativeSessionValid, dynamicOwnerVersion, eligibleAdminName, normalizeOwnerName, ownerAccounts, ownerNameMatches, ownerCredentialVersion, type OwnerRole } from "./owners.js";
import { publicWhatsAppNumber, whatsappJoinUrl, whatsappStatus, whatsappRuntimeStatus, queueOwnerAlerts, queueParticipationDecision } from "./whatsapp.js";
import { normalizePhone } from "./phone.js";
import { effectiveWhatsAppConfig, effectivePaymentConfig, generateAndSaveVerifyToken, gitVersionInfo, readYouTubeIntegration, saveYouTubeIntegration, readPaymentIntegration, readWhatsAppIntegration, savePaymentIntegration, saveWhatsAppIntegration, validateMetaWhatsApp } from "./integrations.js";
import { ensureAsaasWebhook } from "./payments.js";
import { groupVerificationState, materializeApprovedMembership } from "./group-verification.js";
import { AUTOMATION_CATALOG, automationsByCategory } from "./bot-automations.js";
import { importAvatarLibrary } from "./avatar-library-import.js";
import { createPasswordReset, markResetDelivered, passwordResetHistory, passwordResetStatus, resetMessage } from "./password-reset.js";
import { welcomeAlreadyGranted, welcomeReference } from "./wallet-guards.js";
import { queueBotNotification } from "./whatsapp.js";
import { AutomationValidationError, automationSettings, automationAudit, ensureBotAutomations, listAutomationSettings, resetAutomationSettings, saveAutomationSettings } from "./bot-automation-store.js";

const phoneSchema = z.string().transform(normalizePhone).pipe(z.string().regex(/^[1-9]\d{7,14}$/, "Informe o WhatsApp com código do país."));
const groupSchema = z.string().regex(/^[1-9]\d{0,2}$/);
const avatarSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("PRESET"),presetId:z.string().regex(/^(?:avatar-(?:0[1-9]|[12]\d|3[0-4])|cat-[a-z0-9]{12})$/)}),
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

function avatarFromProfileRow(db:AppDatabase,row?:{kind:string;preset?:string;image?:Buffer;mime?:string}) {
  if (row?.kind==="PRESET" && row.preset) {
    if(row.preset.startsWith("cat-")) { const tier=catalogTierOf(db,row.preset); return tier ? {kind:"CATALOG" as const,slug:row.preset,tier} : undefined; }
    return {kind:"PRESET" as const,presetId:row.preset};
  }
  if (row?.kind==="CUSTOM" && Buffer.isBuffer(row.image) && row.mime) return {kind:"CUSTOM" as const,dataUrl:`data:${row.mime};base64,${row.image.toString("base64")}`};
  return undefined;
}
function adminAvatar(db:AppDatabase,userId?:string) {
  if (!userId) return undefined;
  return avatarFromProfileRow(db,db.prepare("SELECT avatar_kind AS kind,avatar_preset AS preset,avatar_image AS image,avatar_mime AS mime FROM user_profiles WHERE user_id=?").get(userId) as {kind:string;preset?:string;image?:Buffer;mime?:string}|undefined);
}
function ownerAvatar(db:AppDatabase,ownerId:string) {
  return avatarFromProfileRow(db,db.prepare("SELECT avatar_kind AS kind,avatar_preset AS preset,avatar_image AS image,avatar_mime AS mime FROM owner_profiles WHERE owner_id=?").get(ownerId) as {kind:string;preset?:string;image?:Buffer;mime?:string}|undefined);
}

/** Persist configured ROOT identities for inventory, ranking and credential guards. No account or wallet is created. */
export function syncConfiguredRootOwners(db:AppDatabase,config:Config) {
  db.transaction(()=>{
    for(const owner of effectiveOwnerAccounts(db,config)) {
      const marker="root:"+owner.id;
      const user=db.prepare("SELECT id FROM users WHERE phone=? AND deleted_at IS NULL").get(owner.phone) as {id:string}|undefined;
      if(!user){
        db.prepare("UPDATE owner_access SET active=0,updated_at=? WHERE created_by_owner_id=? AND role='ROOT_OWNER' AND active=1").run(new Date().toISOString(),marker);
        continue;
      }
      // AUDITORIA / red team C-03: a promocao de um vinculo ADMIN existente a ROOT
      // (preservando o id) e LEGITIMA — e o caso de o proprio Fabio/Rafael ter sido
      // cadastrado primeiro como ADMIN. O vetor de escalada nao e a promocao: e um
      // impostor ADQUIRIR o telefone configurado do ROOT. Por isso a trava fica na
      // porta de entrada (PATCH /admin/participants recusa telefone de Owner), e nao
      // aqui — travar aqui quebraria a reconciliacao real do dono.
      const linked=db.prepare("SELECT id FROM owner_access WHERE user_id=? OR phone=? ORDER BY CASE WHEN user_id=? THEN 0 ELSE 1 END LIMIT 1").get(user.id,owner.phone,user.id) as {id:string}|undefined;
      const id=linked?.id??marker,stamp=new Date().toISOString();
      db.prepare("UPDATE owner_access SET active=0,updated_at=? WHERE created_by_owner_id=? AND role='ROOT_OWNER' AND id<>? AND active=1").run(stamp,marker,id);
      db.prepare(`INSERT INTO owner_access(id,user_id,phone,normalized_name,role,active,created_by_owner_id,created_at,updated_at)
        VALUES(?,?,?,?,'ROOT_OWNER',1,?,?,?)
        ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,phone=excluded.phone,normalized_name=excluded.normalized_name,
          role='ROOT_OWNER',active=1,created_by_owner_id=excluded.created_by_owner_id,updated_at=excluded.updated_at
        WHERE owner_access.user_id<>excluded.user_id OR owner_access.phone<>excluded.phone OR owner_access.normalized_name<>excluded.normalized_name
          OR owner_access.role<>'ROOT_OWNER' OR owner_access.active<>1 OR COALESCE(owner_access.created_by_owner_id,'')<>excluded.created_by_owner_id`)
        .run(id,user.id,owner.phone,normalizeOwnerName(owner.name),marker,stamp,stamp);
    }
  })();
}

export async function registerOwnerRoutes(
  app: FastifyInstance,
  db: AppDatabase,
  config: Config,
  participantGuard?: (request:FastifyRequest,reply:FastifyReply)=>Promise<unknown>
) {
  syncConfiguredRootOwners(db,config);
  for (const code of config.ALLOWED_GROUP_CODES.split(",")) db.prepare("INSERT OR IGNORE INTO groups (code) VALUES (?)").run(code);

  // Reconcile legacy profiles on startup, so existing participant sessions also
  // receive the avatar saved before this release. No account or wallet is created.
  const profileLinks=effectiveOwnerAccounts(db,config).flatMap(owner=>{
    const user=db.prepare("SELECT id FROM users WHERE phone=? AND deleted_at IS NULL").get(owner.phone) as {id:string}|undefined;
    return user?[{ownerId:owner.id,userId:user.id}]:[];
  });
  const delegatedLinks=db.prepare("SELECT id AS ownerId,user_id AS userId FROM owner_access WHERE active=1").all() as Array<{ownerId:string;userId:string}>;
  db.transaction(()=>{
    for(const link of [...profileLinks,...delegatedLinks]){
      const ownerProfile=db.prepare("SELECT updated_at AS updatedAt FROM owner_profiles WHERE owner_id=?").get(link.ownerId) as {updatedAt:string}|undefined;
      const userProfile=db.prepare("SELECT updated_at AS updatedAt FROM user_profiles WHERE user_id=?").get(link.userId) as {updatedAt:string}|undefined;
      if(!ownerProfile&&!userProfile)continue;
      if(ownerProfile&&(!userProfile||ownerProfile.updatedAt>=userProfile.updatedAt)){
        db.prepare(`INSERT INTO user_profiles (user_id,avatar_kind,avatar_preset,avatar_image,avatar_mime,updated_at)
          SELECT ?,avatar_kind,avatar_preset,avatar_image,avatar_mime,updated_at FROM owner_profiles WHERE owner_id=?
          ON CONFLICT(user_id) DO UPDATE SET avatar_kind=excluded.avatar_kind,avatar_preset=excluded.avatar_preset,avatar_image=excluded.avatar_image,avatar_mime=excluded.avatar_mime,updated_at=excluded.updated_at`).run(link.userId,link.ownerId);
      }else{
        db.prepare(`INSERT INTO owner_profiles (owner_id,avatar_kind,avatar_preset,avatar_image,avatar_mime,updated_at)
          SELECT ?,avatar_kind,avatar_preset,avatar_image,avatar_mime,updated_at FROM user_profiles WHERE user_id=?
          ON CONFLICT(owner_id) DO UPDATE SET avatar_kind=excluded.avatar_kind,avatar_preset=excluded.avatar_preset,avatar_image=excluded.avatar_image,avatar_mime=excluded.avatar_mime,updated_at=excluded.updated_at`).run(link.ownerId,link.userId);
      }
    }
  })();

  type OwnerContext={id:string;name:string;canonicalName:string;phone:string;role:OwnerRole;userId?:string;dynamic:boolean};

  function resolveOwnerContext(request:FastifyRequest):OwnerContext|undefined {
    if (request.user.purpose!=="owner" || request.user.aud!=="conexao-owner") return undefined;
    const staticAccount=effectiveOwnerAccounts(db,config).find((item)=>`owner:${item.id}`===request.user.sub);
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
    // AUDITORIA / contato publico: em EVOLUTION o "Conversar com o SOS" tem que abrir o
    // NUMERO DO BOT (que auto-atende), nao o numero business (que por padrao e o do
    // Rafael, atendimento humano). Senao o botao manda a pessoa direto pro humano.
    const publicContact = integration.mode === "EVOLUTION" ? (integration.evolutionPhone || integration.businessPhone) : integration.businessPhone;
    const publicPhone=publicWhatsAppNumber(config,publicContact);
    return {
      groups: rows.map(({ code }) => code),
      groupLinks: Object.fromEntries(rows.filter((row)=>row.joinUrl).map((row)=>[row.code,row.joinUrl!])),
      ownerContactAvailable: Boolean(publicPhone),
      membershipRequired: config.REQUIRE_GROUP_MEMBERSHIP,
      whatsappJoinUrl: whatsappJoinUrl(config,publicContact)
    };
  });
  app.post("/participation/request", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (request, reply) => {
    if(!devAuthEnabled(config)) return reply.code(403).send({code:"IDENTITY_PROOF_REQUIRED",message:"Confirme este WhatsApp com a chave de acesso antes de enviar uma solicitação."});
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
    const account = effectiveOwnerAccounts(db,config).find((owner) => owner.phone === body.phone && ownerNameMatches(owner.name, body.name));
    return { role: account ? "owner" as const : "user" as const };
  });

  app.post("/admin/login", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (request, reply) => {
    // AUDITORIA: a identidade do Owner e NOME + TELEFONE. `phone` e o campo correto;
    // `identifier` segue aceito como apelido para nao quebrar clientes antigos.
    const body = z.object({
      secret: z.string().min(1).max(256), name: z.string().trim().min(2).max(80),
      phone: phoneSchema.optional(), identifier: phoneSchema.optional(), groupCode: z.literal("#")
    }).parse(request.body);
    const loginPhone = body.phone ?? body.identifier;
    if (!loginPhone) return reply.code(400).send({ message: "Informe o WhatsApp do Owner." });
    // Telefone EFETIVO: respeita a troca de numero feita no painel.
    const account = effectiveOwnerAccounts(db, config).find((o) => ownerNameMatches(o.name, body.name) && o.phone === loginPhone);
    if (!account?.secret) return reply.code(401).send({ message: "Conta ou credencial inválida." });
    const hash = (value: string) => createHash("sha256").update(value).digest();
    // AUDITORIA A-02: credencial de atalho só existe fora de produção, apenas com
    // AUTH_DEV_MODE explícito e apenas se OWNER_DEV_SECRET estiver configurado.
    const devCredentialAccepted = devAuthEnabled(config) && config.NODE_ENV !== "production"
      && Boolean(config.OWNER_DEV_SECRET) && body.secret === config.OWNER_DEV_SECRET;
    // AUDITORIA: a senha do PAINEL (hash scrypt, com bloqueio por tentativas) vale como
    // credencial principal — e permite uma senha memorizavel com seguranca. O segredo
    // do ambiente continua valendo como entrada de emergencia (break-glass).
    let panelCredentialAccepted = false;
    try { panelCredentialAccepted = verifyCredential(db, account.id, body.secret); }
    catch (error) { const e = error as { statusCode?: number; message?: string; code?: string };
      return reply.code(e.statusCode ?? 429).send({ message: e.message ?? "Credencial bloqueada.", code: e.code }); }
    if (!devCredentialAccepted && !panelCredentialAccepted && !timingSafeEqual(hash(body.secret),hash(account.secret))) return reply.code(401).send({ message: "Conta ou credencial inválida." });
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
          COALESCE(SUM(CASE WHEN credits_millis>0 THEN amount_cents ELSE 0 END),0) AS coinsRevenue,
          COALESCE(SUM(CASE WHEN credits_millis=0 AND extra_passes>0 THEN amount_cents ELSE 0 END),0) AS passRevenue,
          COALESCE(SUM(CASE WHEN credits_millis=0 AND extra_passes=0 THEN amount_cents ELSE 0 END),0) AS legacyRevenue,
          COALESCE(SUM(CASE WHEN credits_millis>0 THEN 1 ELSE 0 END),0) AS coinsPurchases,
          COALESCE(SUM(CASE WHEN credits_millis=0 AND extra_passes>0 THEN 1 ELSE 0 END),0) AS passPurchases
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
  app.get("/admin/profile/avatar-catalog",{preHandler:ownerGuard},async()=>({
    avatars:listCatalog(db,{activeOnly:true}).map(row=>({slug:row.slug,tier:row.tier,category:row.category,label:row.label,locked:false}))
  }));
  app.put("/admin/profile/avatar", { preHandler: ownerGuard }, async (request,reply) => {
    const account=resolveOwnerContext(request);
    if (!account) return reply.code(401).send({message:"Conta Owner não encontrada."});
    const body=avatarSchema.parse(request.body);
    const now=new Date().toISOString();
    if (body.kind==="PRESET") {
      if(body.presetId.startsWith("cat-") && !catalogTierOf(db,body.presetId)) return reply.code(404).send({message:"Este avatar não está mais disponível."});
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
    const linked=db.prepare("SELECT id FROM users WHERE phone=? AND deleted_at IS NULL").get(account.phone) as {id:string}|undefined;
    if(linked) db.prepare(`INSERT INTO user_profiles (user_id,avatar_kind,avatar_preset,avatar_image,avatar_mime,updated_at)
      SELECT ?,avatar_kind,avatar_preset,avatar_image,avatar_mime,updated_at FROM owner_profiles WHERE owner_id=?
      ON CONFLICT(user_id) DO UPDATE SET avatar_kind=excluded.avatar_kind,avatar_preset=excluded.avatar_preset,avatar_image=excluded.avatar_image,avatar_mime=excluded.avatar_mime,updated_at=excluded.updated_at`).run(linked.id,account.id);
    return {avatar:ownerAvatar(db,account.id)};
  });
  app.delete("/admin/profile/avatar", { preHandler: ownerGuard }, async (request,reply) => {
    const account=resolveOwnerContext(request);
    if (!account) return reply.code(401).send({message:"Conta Owner não encontrada."});
    db.prepare("DELETE FROM owner_profiles WHERE owner_id=?").run(account.id);
    const linked=db.prepare("SELECT id FROM users WHERE phone=? AND deleted_at IS NULL").get(account.phone) as {id:string}|undefined;
    if(linked) db.prepare("DELETE FROM user_profiles WHERE user_id=?").run(linked.id);
    return {ok:true};
  });

  app.get("/admin/version", { preHandler: ownerGuard }, async () => gitVersionInfo());
  app.get("/admin/integrations/whatsapp/runtime",{preHandler:rootOwnerGuard},async()=>whatsappRuntimeStatus(db,config));
  app.get("/admin/integrations/whatsapp", { preHandler: rootOwnerGuard }, async () => readWhatsAppIntegration(db,config));
  app.post("/admin/integrations/whatsapp", { preHandler: rootOwnerGuard }, async (request) => saveWhatsAppIntegration(db,config,request.body));
  // AUDITORIA I-01: terceira integracao, no mesmo molde das outras duas.
  app.get("/admin/integrations/youtube", { preHandler: rootOwnerGuard }, async () => readYouTubeIntegration(db,config));
  app.post("/admin/integrations/youtube", { preHandler: rootOwnerGuard }, async (request) => saveYouTubeIntegration(db,config,request.body));
  // AUDITORIA / chat global: poderes de moderação (só Owner/Admin).
  app.delete("/admin/chat/global/:id", { preHandler: ownerGuard }, async (request, reply) => {
    return chatDelete(db, String((request.params as { id: string }).id)) ? { ok: true } : reply.code(404).send({ message: "Mensagem não encontrada." });
  });
  app.post("/admin/chat/global/:id/pin", { preHandler: ownerGuard }, async (request, reply) => {
    const b = z.object({ pinned: z.boolean() }).safeParse(request.body);
    if (!b.success) return reply.code(400).send({ message: "Informe pinned." });
    return adminSetPinned(db, String((request.params as { id: string }).id), b.data.pinned) ? { ok: true } : reply.code(404).send({ message: "Mensagem não encontrada." });
  });
  app.post("/admin/chat/global/clear", { preHandler: rootOwnerGuard }, async () => ({ ok: true, cleared: adminClearChat(db) }));
  app.post("/admin/chat/global/moderate", { preHandler: ownerGuard }, async (request, reply) => {
    const b = z.object({
      userId: z.string().min(8),
      action: z.enum(["MUTE", "UNMUTE", "COOLDOWN", "REMOVE", "RESTORE"]),
      minutes: z.number().int().min(1).max(10080).optional(),
      seconds: z.number().int().min(0).max(86400).optional()
    }).safeParse(request.body);
    if (!b.success) return reply.code(400).send({ message: "Parâmetros inválidos." });
    const { userId, action, minutes, seconds } = b.data;
    if (action === "MUTE") return adminMute(db, userId, minutes ?? 10);
    if (action === "UNMUTE") { adminUnmute(db, userId); return { ok: true }; }
    if (action === "COOLDOWN") { adminSetCooldown(db, userId, seconds ?? 30); return { ok: true }; }
    if (action === "REMOVE") { adminRemoveFromRoom(db, userId); return { ok: true }; }
    adminRestoreToRoom(db, userId); return { ok: true };
  });
  // AUDITORIA / cérebro do bot: estado/prontidão e configuração em tempo real.
  // HIERARQUIA: configuracao de APIs e bot nao e visivel ao ADMIN_OWNER.
  app.get("/admin/bot", { preHandler: rootOwnerGuard }, async () => ({ status: botStatus(db, config), catalog: BOT_FEATURES }));
  app.post("/admin/bot", { preHandler: rootOwnerGuard }, async (request, reply) => {
    try { saveBotSettings(db, request.body); return { ok: true, status: botStatus(db, config) }; }
    catch (error) { const e = error as { statusCode?: number; message?: string }; return reply.code(e.statusCode ?? 400).send({ message: e.message ?? "Configuração inválida." }); }
  });
  // AUDITORIA / HYBRID+: as ATITUDES do bot (falas, eventos, avisos) que o Owner
  // edita. HIERARQUIA: ROOT_OWNER apenas — quem escreve a fala do bot fala em nome
  // do projeto para toda a comunidade, e o ADMIN_OWNER nao tem esse poder.
  ensureBotAutomations(db);
  app.get("/admin/bot/automations", { preHandler: rootOwnerGuard }, async () => ({
    automations: listAutomationSettings(db),
    catalog: AUTOMATION_CATALOG,
    groups: automationsByCategory().map((g) => ({ category: g.category, events: g.items.map((i) => i.event) }))
  }));
  app.get("/admin/bot/deliveries",{preHandler:rootOwnerGuard},async()=>{
    const entries=db.prepare("SELECT id,status,last_error AS reason,attempts,available_at AS availableAt,created_at AS createdAt,provider_message_id IS NOT NULL AS providerConfirmed,substr(recipient,-4) AS recipientSuffix,json_extract(payload,'$._event') AS event,json_extract(payload,'$._transport') AS transport FROM whatsapp_outbox ORDER BY created_at DESC,rowid DESC LIMIT 100").all();
    return {entries};
  });
  app.post("/admin/bot/test-message",{preHandler:rootOwnerGuard},async(request,reply)=>{
    const {referenceId,target}=z.object({referenceId:z.string().uuid(),target:z.enum(["SELF","HUMAN"]).default("SELF")}).parse(request.body),account=resolveOwnerContext(request)!;
    const event=target==="HUMAN"?"ROOT_HUMAN_TEST":"ROOT_SELF_TEST",recipient=target==="HUMAN"?humanSupportNumber(db,config):account.phone;
    const key="owner-test:"+event+":"+account.id+":"+referenceId;
    const result=db.transaction(()=>{
      const old=db.prepare("SELECT id AS outboxId FROM whatsapp_outbox WHERE dedupe_key=?").get(key) as {outboxId:string}|undefined;
      if(old)return {queued:true,...old};
      const recent=db.prepare("SELECT 1 FROM bot_automation_audit WHERE event=? AND actor_owner_id=? AND created_at>?").get(event,account.id,new Date(Date.now()-60_000).toISOString());
      if(recent)return {queued:false,reason:"Aguarde um minuto antes de solicitar outro teste."};
      const queued=queueBotNotification(db,config,recipient,target==="HUMAN"?humanHandoffAlert({name:account.name,userPhone:account.phone,lastMessage:"Teste administrativo do encaminhamento humano. Não é uma solicitação real de suporte."}):"Teste do SOS YOUTUBER: o painel solicitou esta mensagem para confirmar o envio pelo bot. Nenhuma senha ou código foi incluído.",key,undefined,{deliveryClass:"TRANSACTIONAL",event});
      if(queued.outboxId)db.prepare("INSERT INTO bot_automation_audit(event,field,after_value,actor_owner_id,actor_owner_name,created_at) VALUES(?,'dispatch',?,?,?,?)")
        .run(event,queued.outboxId,account.id,account.name,new Date().toISOString());
      return queued;
    })();
    return reply.code(result.queued?202:409).send(result);
  });
  app.get("/admin/bot/test-message/:outboxId",{preHandler:rootOwnerGuard},async(request,reply)=>{
    const account=resolveOwnerContext(request)!;
    const {outboxId}=z.object({outboxId:z.string().uuid()}).parse(request.params);
    const row=db.prepare("SELECT o.status,o.last_error AS reason,o.provider_message_id AS providerId FROM whatsapp_outbox o JOIN bot_automation_audit a ON a.after_value=o.id WHERE o.id=? AND a.event IN ('ROOT_SELF_TEST','ROOT_HUMAN_TEST') AND a.actor_owner_id=?")
      .get(outboxId,account.id) as {status:string;reason:string|null;providerId:string|null}|undefined;
    if(!row)return reply.code(404).send({message:"Teste não encontrado."});
    return {status:row.status,reason:row.reason,providerConfirmed:row.status==="SENT"&&Boolean(row.providerId)};
  });
  app.get("/admin/bot/support-availability",{preHandler:rootOwnerGuard},async()=>readSupportAvailability(db));
  app.post("/admin/bot/support-availability",{preHandler:rootOwnerGuard},async(request)=>{
    const account=resolveOwnerContext(request)!;
    return saveSupportAvailability(db,request.body,{id:account.id,name:account.name});
  });
  app.get("/admin/bot/automations/runtime", {preHandler:rootOwnerGuard},async()=>botAutomationRuntimeStatus(db));
  app.post("/admin/bot/automations/BROADCAST_GLOBAL/dispatch",{preHandler:rootOwnerGuard},async(request,reply)=>{
    const body=z.object({message:z.string().trim().min(1).max(3000),referenceId:z.string().uuid()}).parse(request.body);
    const account=resolveOwnerContext(request)!;
    if(!featureEnabled(db,"BROADCAST") || !automationSettings(db,"BROADCAST_GLOBAL").enabled)return reply.code(409).send({message:"Ative os recados globais no painel do bot antes de enviar."});
    const result=db.transaction(()=>{
      const eventId=recordBotAutomationEvent(db,{event:"BROADCAST_GLOBAL",sourceId:"owner:"+account.id+":"+body.referenceId,
        vars:{mensagem:body.message,link:config.WEB_APP_URL}});
      if(!db.prepare("SELECT 1 FROM bot_automation_audit WHERE event='BROADCAST_GLOBAL' AND field='dispatch' AND after_value=?").get(eventId)){
        db.prepare("INSERT INTO bot_automation_audit(event,field,after_value,actor_owner_id,actor_owner_name,created_at) VALUES('BROADCAST_GLOBAL','dispatch',?,?,?,?)")
          .run(eventId,account.id,account.name,new Date().toISOString());
      }
      return {eventId,...dispatchBotAutomations(db,config)};
    })();
    return reply.code(202).send(result);
  });
  app.patch("/admin/bot/automations/:event", { preHandler: rootOwnerGuard }, async (request, reply) => {
    const account = resolveOwnerContext(request)!;
    const { event } = request.params as { event: string };
    try {
      return { ok: true, automation: saveAutomationSettings(db, event, request.body as Record<string, never>, { id: account.id, name: account.name }) };
    } catch (error) {
      if (error instanceof AutomationValidationError) return reply.code(400).send({ message: error.message, code: error.code });
      throw error;
    }
  });
  app.post("/admin/bot/automations/:event/reset", { preHandler: rootOwnerGuard }, async (request, reply) => {
    const account = resolveOwnerContext(request)!;
    const { event } = request.params as { event: string };
    try { return { ok: true, automation: resetAutomationSettings(db, event, { id: account.id, name: account.name }) }; }
    catch (error) {
      if (error instanceof AutomationValidationError) return reply.code(400).send({ message: error.message, code: error.code });
      throw error;
    }
  });
  // Trilha: quem mudou a fala do bot, quando, e qual era o texto anterior.
  app.get("/admin/bot/automations/audit", { preHandler: rootOwnerGuard }, async (request) => {
    const { event } = request.query as { event?: string };
    return { entries: automationAudit(db, event) };
  });

  // AUDITORIA / troca de senha com consentimento do titular.
  //
  // O dono pediu "ver as senhas e poder muda-las". VER e impossivel: o banco guarda
  // so o hash irreversivel. O que entregamos e melhor e mais seguro — o Owner
  // SOLICITA a troca, o codigo vai pelo bot DIRETO ao WhatsApp do titular (nunca
  // volta na resposta ao Owner), e o titular escolhe a senha nova. Isso fecha o
  // vetor de tomada de conta e mantem o controle no painel, como pedido.
  // ROOT-only, e cada pedido fica em trilha append-only.
  app.post("/admin/participants/:phone/password-reset", { preHandler: rootOwnerGuard }, async (request, reply) => {
    const phone = phoneSchema.parse((request.params as { phone: string }).phone);
    const user = db.prepare("SELECT id,name FROM users WHERE phone=? AND deleted_at IS NULL").get(phone) as {id:string;name:string}|undefined;
    if (!user) return reply.code(404).send({ message: "Participante nao encontrado." });
    const account = resolveOwnerContext(request)!;
    const actor = { id: account.id, name: request.user.displayName?.trim() || account.name };

    const req = createPasswordReset(db, phone, "OWNER", actor);
    const delivery = queueBotNotification(
      db, config, phone, resetMessage(req.code, true, config.WEB_APP_URL),
      `password-reset:${req.id}`, undefined,
      { encryptPayload: true, deliveryClass: "TRANSACTIONAL", event: "PASSWORD_RESET" },
    );
    markResetDelivered(db, req.id, delivery.queued, delivery.reason);
    // O codigo NAO volta para o Owner — so o estado da entrega.
    return {
      ok: true,
      delivered: delivery.queued,
      reason: delivery.queued ? undefined : delivery.reason,
      status: passwordResetStatus(db, phone),
    };
  });

  app.get("/admin/participants/:phone/password-reset", { preHandler: rootOwnerGuard }, async (request) => {
    const phone = phoneSchema.parse((request.params as { phone: string }).phone);
    return { status: passwordResetStatus(db, phone), history: passwordResetHistory(db, phone) };
  });

  // AUDITORIA / biblioteca de avatares: importa a arte entregue em
  // <raiz>/<TIER>/<CATEGORIA>/*.webp. A PASTA define tier e categoria, então
  // acrescentar arte nova é copiar arquivo + clicar aqui — sem tocar em codigo.
  // Nao-destrutivo: preserva o que o Owner ja editou. ROOT-only.
  app.post("/admin/avatars/import-library", { preHandler: rootOwnerGuard }, async (request, reply) => {
    const { root } = (request.body ?? {}) as { root?: string };
    if (!root || typeof root !== "string") {
      return reply.code(400).send({ message: "Informe a pasta raiz da biblioteca de avatares." });
    }
    try { return { ok: true, report: importAvatarLibrary(db, root) }; }
    catch (error) {
      app.log.error(error);
      return reply.code(400).send({ message: "Nao consegui ler essa pasta. Confira o caminho e as permissoes." });
    }
  });

  // AUDITORIA / correio interno: aviso global do Owner e moderação.
  // HIERARQUIA: falar em nome do projeto para TODA a comunidade e ler/moderar a
  // correspondencia privada sao poderes de ROOT_OWNER. ADMIN_OWNER nao acessa.
  app.post("/admin/mail/broadcast", { preHandler: rootOwnerGuard }, async (request, reply) => {
    const account = resolveOwnerContext(request)!;
    const parsed = z.object({ body: z.string().min(1).max(2000) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Escreva o aviso." });
    try { return ownerBroadcast(db, parsed.data.body, account.id); }
    catch (error) { const e = error as { statusCode?: number; message?: string }; return reply.code(e.statusCode ?? 400).send({ message: e.message ?? "Não foi possível enviar." }); }
  });
  app.get("/admin/mail", { preHandler: rootOwnerGuard }, async (request) => {
    const limit = Number((request.query as { limit?: string }).limit ?? 100);
    return { messages: ownerListRecent(db, Number.isFinite(limit) ? limit : 100) };
  });
  app.delete("/admin/mail/:id", { preHandler: rootOwnerGuard }, async (request, reply) => {
    const ok = ownerDeleteMessage(db, String((request.params as { id: string }).id));
    if (!ok) return reply.code(404).send({ message: "Mensagem não encontrada." });
    return { ok: true };
  });
  // AUDITORIA / SUPER: o ROOT controla toda a rota — conceder, doar, revogar e moderar.
  app.get("/admin/super", { preHandler: rootOwnerGuard }, async () => {
    const rows = db.prepare(`SELECT s.user_id AS userId,u.name,u.phone,s.expires_at AS expiresAt,s.auto_renew AS autoRenew,s.source,s.revoked_at AS revokedAt
      FROM super_subscriptions s JOIN users u ON u.id=s.user_id ORDER BY s.expires_at DESC`).all() as Array<Record<string, unknown>>;
    return { subscribers: rows, pins: activePins(db), defaultDays: SUPER_DAYS };
  });
  app.post("/admin/super/grant", { preHandler: rootOwnerGuard }, async (request, reply) => {
    const body = z.object({ userId: z.string().min(8), days: z.number().int().min(1).max(3650).optional(), autoRenew: z.boolean().optional() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ message: "Informe o participante." });
    if (!db.prepare("SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL").get(body.data.userId)) return reply.code(404).send({ message: "Participante não encontrado." });
    // Doacao do Owner: fonte registrada como GIFT para distinguir de compra.
    return { ok: true, state: grantSuper(db, body.data.userId, { days: body.data.days ?? SUPER_DAYS, source: "GIFT", autoRenew: body.data.autoRenew ?? false }) };
  });
  app.post("/admin/super/revoke", { preHandler: rootOwnerGuard }, async (request, reply) => {
    const me = resolveOwnerContext(request)!;
    const body = z.object({ userId: z.string().min(8) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ message: "Informe o participante." });
    revokeSuper(db, body.data.userId, me.name);
    return { ok: true, state: superState(db, body.data.userId) };
  });
  app.post("/admin/super/auto-renew", { preHandler: rootOwnerGuard }, async (request, reply) => {
    const body = z.object({ userId: z.string().min(8), autoRenew: z.boolean() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ message: "Parâmetros inválidos." });
    setAutoRenew(db, body.data.userId, body.data.autoRenew);
    return { ok: true, state: superState(db, body.data.userId) };
  });
  app.delete("/admin/super/pins/:id", { preHandler: ownerGuard }, async (request, reply) => {
    return removePin(db, String((request.params as { id: string }).id)) ? { ok: true } : reply.code(404).send({ message: "Divulgação não encontrada." });
  });

  // AUDITORIA / loja configurável: CRUD de produtos pelo ROOT_OWNER, aplicado em tempo real.
  app.get("/admin/store/products", { preHandler: rootOwnerGuard }, async () => ({ products: listStoreProducts(db) }));
  const storeProductSchema = z.object({
    code: z.string(), title: z.string(), description: z.string().optional(),
    amountCents: z.number(), credits: z.number().optional(), creditsMillis: z.number().optional(),
    extraPasses: z.number().optional(), active: z.boolean().optional(), sortOrder: z.number().optional(),
    itemReference: z.string().optional(), grantsItem: z.string().optional(),
    grantsItemQty: z.number().optional(), subscriptionDays: z.number().optional(),
    imageDataUrl: z.string().optional()
  });
  app.post("/admin/store/products", { preHandler: rootOwnerGuard }, async (request, reply) => {
    const parsed = storeProductSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Dados do produto inválidos." });
    try { return { product: upsertStoreProduct(db, parsed.data) }; }
    catch (error) { const e = error as { statusCode?: number; message?: string }; return reply.code(e.statusCode ?? 400).send({ message: e.message ?? "Produto inválido." }); }
  });
  app.post("/admin/store/products/:code/active", { preHandler: rootOwnerGuard }, async (request, reply) => {
    const code = String((request.params as { code: string }).code);
    const body = z.object({ active: z.boolean() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ message: "Informe active (booleano)." });
    setStoreProductActive(db, code, body.data.active);
    return { ok: true, products: listStoreProducts(db) };
  });
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
  // AUDITORIA / saude do numero Business: diagnostico e recomendacao de troca.
  app.get("/admin/integrations/whatsapp/health", { preHandler: rootOwnerGuard }, async () => ({
    health: lastNumberHealth(db) ?? null, replacementSteps: REPLACEMENT_STEPS
  }));
  app.post("/admin/integrations/whatsapp/health", { preHandler: rootOwnerGuard }, async () => {
    const runtime = effectiveWhatsAppConfig(db, config);
    const health = await checkNumberHealth(db, config, { accessToken: runtime.WHATSAPP_ACCESS_TOKEN });
    return { health, replacementSteps: REPLACEMENT_STEPS };
  });

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
      COALESCE(SUM(CASE WHEN status='APPROVED' AND credits_millis=0 THEN extra_passes ELSE 0 END),0) AS passesPurchased,
      COALESCE(SUM(CASE WHEN status='APPROVED' AND credits_millis>0 THEN extra_passes ELSE 0 END),0) AS bonusPasses,
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
      gamification:user ? gamificationData(db,user.id) : undefined,
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
    // AUDITORIA / escalada de privilegio (red team C-02/C-03): o telefone E a
    // identidade deste produto (login, grupo, WhatsApp e a amarracao do Owner).
    // Sem esta guarda, um ADMIN trocava o proprio telefone pelo telefone
    // configurado de um ROOT; na proxima reconciliacao, `syncConfiguredRootOwners`
    // encontrava a linha dele por user_id e a PROMOVIA a ROOT_OWNER. Tambem dava
    // para "decapitar" um ROOT trocando o telefone dele e deixando o sync desativar
    // seu acesso. Nenhum campo de formulario pode mover identidade de dono.
    const ownerPhones = new Set(effectiveOwnerAccounts(db,config).map((item)=>item.phone).filter(Boolean) as string[]);
    if (ownerPhones.has(body.phone) && body.phone !== currentPhone) {
      return reply.code(409).send({ message:"Este WhatsApp pertence a uma conta de Owner e nao pode ser atribuido aqui." });
    }
    if (ownerPhones.has(currentPhone) && resolveOwnerContext(request)?.role !== "ROOT_OWNER") {
      return reply.code(403).send({ message:"Somente um ROOT_OWNER pode editar o cadastro de um Owner." });
    }
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
  // AUDITORIA C-01 / portão híbrido: Owner emite uma credencial de setup para um
  // número já aprovado. Entregue pelo próprio Owner (o link wa.me abre a mensagem
  // pronta; o Owner clica e envia). Não depende da API Meta nem de bot automático.
  app.post("/admin/participants/:phone/setup-code", { preHandler: rootOwnerGuard }, async (request, reply) => {
    const account = resolveOwnerContext(request)!;
    const phone = normalizePhone(String((request.params as { phone: string }).phone));
    if (!/^[1-9]\d{7,14}$/.test(phone)) return reply.code(400).send({ message: "Telefone inválido." });
    const detected = resolveGroupForPhone(db, phone);
    const groupCode = detected.groupCode;
    if (!groupCode || !hasMembership(db, phone, groupCode)) {
      return reply.code(409).send({ code: "GROUP_NOT_CONFIRMED", message: "Aprove este número em um grupo SOS YOUTUBER antes de emitir a credencial de setup." });
    }
    const existingUser = db.prepare("SELECT name FROM users WHERE phone=? AND deleted_at IS NULL").get(phone) as { name: string } | undefined;
    const pendingName = db.prepare("SELECT name FROM participation_requests WHERE phone=? ORDER BY created_at DESC LIMIT 1").get(phone) as { name: string } | undefined;
    const name = existingUser?.name ?? pendingName?.name ?? null;
    const code = generateSetupCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 72 * 60 * 60_000).toISOString();
    db.prepare(`INSERT INTO setup_codes (phone,code_hash,group_code,name,issued_by_owner_id,attempts,expires_at,used_at,created_at)
      VALUES (?,?,?,?,?,0,?,NULL,?)
      ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash,group_code=excluded.group_code,name=excluded.name,
        issued_by_owner_id=excluded.issued_by_owner_id,attempts=0,expires_at=excluded.expires_at,used_at=NULL,created_at=excluded.created_at`)
      .run(phone, hashPassword(normalizeSetupCode(code)), groupCode, name, account.id, expiresAt, now.toISOString());
    const webAppUrl = config.WEB_APP_URL.replace(/\/$/, "");
    const message = `SOS YOUTUBER: seu acesso foi liberado no grupo ${groupCode}. Entre em ${webAppUrl} e use o código de ativação ${code} para criar sua senha. O código vale 72 horas e é de uso único.`;
    return reply.send({
      ok: true,
      // O código em texto claro é devolvido UMA vez, para o Owner entregar. Não fica legível depois.
      setupCode: code,
      phone, groupCode, name, expiresAt,
      deliver: {
        // Link que o Owner clica para enviar manualmente pelo WhatsApp — sem API Meta.
        whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
        message
      }
    });
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

      const staticAccount=effectiveOwnerAccounts(db,config).find((item)=>item.phone===user.phone && ownerNameMatches(item.name,user.name));
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
      if (!access || access.normalizedName!==normalizeOwnerName(user.name)) {
        return reply.code(403).send({message:"Esta conta de participante não possui acesso administrativo ativo."});
      }
      // AUDITORIA / 2o fator do ADMIN: posse do telefone nao basta. O ROOT define uma
      // credencial para cada ADMIN; sem ela, nao ha elevacao.
      if (!devAuthEnabled(config)) {
        const state = credentialState(db, access.id);
        if (!state.configured) {
          return reply.code(403).send({ code:"CREDENTIAL_REQUIRED", message:"Peça ao Owner principal para definir sua credencial administrativa." });
        }
        const offered = (request.body as { secret?: string } | undefined)?.secret;
        if (!offered) return reply.code(401).send({ code:"CREDENTIAL_REQUIRED", message:"Informe sua credencial administrativa para abrir o painel." });
        let ok = false;
        try { ok = verifyCredential(db, access.id, String(offered)); }
        catch (error) { const e = error as { statusCode?: number; message?: string; code?: string };
          return reply.code(e.statusCode ?? 429).send({ message: e.message ?? "Credencial bloqueada.", code: e.code }); }
        if (!ok) return reply.code(401).send({ message:"Credencial administrativa inválida." });
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
        if(!welcomeAlreadyGranted(db,owner.phone))
          db.prepare("INSERT INTO wallet_ledger (id,user_id,kind,amount_millis,reference_id,created_at,note,actor_owner_id,actor_owner_name) VALUES (?,?, 'WELCOME',10000,?,?,?,?,?)")
            .run(randomUUID(),id,welcomeReference(owner.phone),now,"Identidade de participação administrativa criada.",owner.id,owner.name);
      })();
      user={id,name:owner.name,phone:owner.phone,groupCode:"#"};
    } else if (user.deletedAt) {
      const now=new Date().toISOString();
      db.prepare("UPDATE users SET name=?,group_code='#',deleted_at=NULL,deleted_source=NULL,updated_at=? WHERE id=?")
        .run(owner.name,now,user.id);
      db.prepare("INSERT OR IGNORE INTO wallets (user_id,updated_at) VALUES (?,?)").run(user.id,now);
      user={...user,name:owner.name,groupCode:"#",deletedAt:undefined};
    }

    // A previously created participant may still carry the legacy login alias.
    // This route is Owner-authenticated; retain the current display name across
    // dashboard, chat and the return to the administrative panel.
    if(user.name!==owner.name){
      db.prepare("UPDATE users SET name=?,updated_at=? WHERE id=?").run(owner.name,new Date().toISOString(),user.id);
      user={...user,name:owner.name};
    }

    const linked=db.prepare("SELECT id FROM users WHERE phone=? AND deleted_at IS NULL").get(owner.phone) as {id:string}|undefined;
    if(linked) db.prepare(`INSERT INTO user_profiles (user_id,avatar_kind,avatar_preset,avatar_image,avatar_mime,updated_at)
      SELECT ?,avatar_kind,avatar_preset,avatar_image,avatar_mime,updated_at FROM owner_profiles WHERE owner_id=?
      ON CONFLICT(user_id) DO UPDATE SET avatar_kind=excluded.avatar_kind,avatar_preset=excluded.avatar_preset,avatar_image=excluded.avatar_image,avatar_mime=excluded.avatar_mime,updated_at=excluded.updated_at`).run(linked.id,owner.id);
    syncConfiguredRootOwners(db,config);
    const token=app.jwt.sign({
      sub:user.id,purpose:"session",aud:"conexao-session",adminRole:owner.role,ownerId:owner.id,displayName:owner.name,jti:request.user.jti
    });
    const rounds=db.prepare(`SELECT r.id,r.sequence,r.status,COUNT(s.id) AS submissions
      FROM rounds r LEFT JOIN submissions s ON s.round_id=r.id
      WHERE r.status IN ('OPEN','READY')
      GROUP BY r.id,r.sequence,r.status ORDER BY r.sequence DESC LIMIT 8`).all();
    return {token,user:{id:user.id,name:user.name,phone:user.phone,groupCode:user.groupCode},adminRole:owner.role,rounds};
  });

  // AUDITORIA / credenciais: o ROOT define a propria senha do painel e a de cada ADMIN.
  // AUDITORIA: troca de numero do Owner sem redeploy. Util quando o chip muda.
  app.post("/admin/owner-phone", { preHandler: rootOwnerGuard }, async (request, reply) => {
    const body = z.object({ ownerId: z.enum(["fabio", "rafael"]), phone: phoneSchema }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ message: "Informe o Owner e um WhatsApp válido." });
    const taken = effectiveOwnerAccounts(db, config).find((o) => o.phone === body.data.phone && o.id !== body.data.ownerId);
    if (taken) return reply.code(409).send({ message: "Este WhatsApp já pertence a outro Owner." });
    db.prepare(`INSERT INTO integration_settings (key,value,updated_at) VALUES (?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
      .run(ownerPhoneKey(body.data.ownerId), body.data.phone, new Date().toISOString());
    syncConfiguredRootOwners(db,config);
    return { ok: true, owners: effectiveOwnerAccounts(db, config).map((o) => ({ id: o.id, name: o.name, phone: o.phone })) };
  });

  // AUDITORIA: o ADMIN NAO compartilha a credencial do ROOT. O bot gera uma senha
  // propria, entregue UMA vez ao ROOT para repassar, com troca obrigatoria depois.
  app.post("/admin/credentials/generate", { preHandler: rootOwnerGuard }, async (request, reply) => {
    const body = z.object({ ownerId: z.string().min(1) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ message: "Informe o administrador." });
    if (!db.prepare("SELECT 1 FROM owner_access WHERE id=? AND active=1 AND role='ADMIN_OWNER'").get(body.data.ownerId)) {
      return reply.code(404).send({ message: "Administrador não encontrado." });
    }
    const generated = generateAdminCredential();
    setCredential(db, body.data.ownerId, generated, { mustChange: true });
    return { ok: true, password: generated, state: credentialState(db, body.data.ownerId) };
  });

  app.get("/admin/credentials", { preHandler: rootOwnerGuard }, async (request) => {
    const me = resolveOwnerContext(request)!;
    const admins = db.prepare("SELECT id,phone,normalized_name AS name FROM owner_access WHERE active=1 AND role='ADMIN_OWNER'").all() as Array<{id:string;phone:string;name:string}>;
    return {
      mine: { ownerId: me.id, ...credentialState(db, me.id) },
      admins: admins.map((a) => ({ ownerId: a.id, phone: a.phone, name: a.name, ...credentialState(db, a.id) })),
      // Telefone vigente de cada Owner (painel sobrepõe o ambiente) para o painel
      // mostrar o número atual ao lado do campo de troca.
      owners: effectiveOwnerAccounts(db, config).map((o) => ({ id: o.id, name: o.name, phone: o.phone }))
    };
  });
  app.post("/admin/credentials", { preHandler: rootOwnerGuard }, async (request, reply) => {
    const me = resolveOwnerContext(request)!;
    const body = z.object({ ownerId: z.string().min(1).optional(), password: z.string().min(10).max(128), mustChange: z.boolean().optional() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ message: "Informe uma credencial de 10 a 128 caracteres." });
    const target = body.data.ownerId ?? me.id;
    // So define a propria credencial ou a de um ADMIN ativo — nunca a de outro ROOT.
    if (target !== me.id && !db.prepare("SELECT 1 FROM owner_access WHERE id=? AND active=1 AND role='ADMIN_OWNER'").get(target)) {
      return reply.code(404).send({ message: "Administrador não encontrado." });
    }
    try { setCredential(db, target, body.data.password, { mustChange: target !== me.id ? body.data.mustChange ?? true : false }); }
    catch (error) { const e = error as { statusCode?: number; message?: string }; return reply.code(e.statusCode ?? 400).send({ message: e.message ?? "Credencial inválida." }); }
    return { ok: true, state: credentialState(db, target) };
  });
  app.delete("/admin/credentials/:ownerId", { preHandler: rootOwnerGuard }, async (request, reply) => {
    const me = resolveOwnerContext(request)!;
    const target = String((request.params as { ownerId: string }).ownerId);
    if (target === me.id) return reply.code(409).send({ message: "Não remova a própria credencial pelo painel." });
    clearCredential(db, target);
    return { ok: true };
  });
  app.get("/admin/owners", { preHandler: rootOwnerGuard }, async () => {
    const staticRows=effectiveOwnerAccounts(db,config).map((item)=>{
      const linked=db.prepare("SELECT id FROM users WHERE phone=? AND deleted_at IS NULL").get(item.phone) as {id:string}|undefined;
      return {id:`static:${item.id}`,name:item.name,phone:item.phone,role:item.role,active:true,static:true,userId:linked?.id};
    });
    const dynamicRows=db.prepare(`SELECT oa.id,oa.user_id AS userId,u.name,oa.phone,oa.role,oa.active,
      oa.created_by_owner_id AS createdByOwnerId,oa.created_at AS createdAt,oa.updated_at AS updatedAt
      FROM owner_access oa JOIN users u ON u.id=oa.user_id ORDER BY oa.active DESC,oa.updated_at DESC`).all() as Array<Record<string,unknown>>;
    const dynamicByUser=new Set(dynamicRows.filter((row)=>row.active===1).map((row)=>String(row.userId)));
    const staticPhones=new Set(effectiveOwnerAccounts(db,config).map((item)=>item.phone));
    const users=db.prepare(`SELECT u.id,u.name,u.phone,u.group_code AS groupCode
      FROM users u JOIN group_memberships gm ON gm.phone=u.phone AND gm.revoked_at IS NULL
      JOIN groups g ON g.code=gm.group_code AND g.enabled=1
      WHERE u.deleted_at IS NULL ORDER BY u.name`).all() as Array<{id:string;name:string;phone:string;groupCode:string}>;
    const candidates=users.filter((user)=>eligibleAdminName(user.name)&&!dynamicByUser.has(user.id)&&!staticPhones.has(user.phone));
    return {owners:[...staticRows,...dynamicRows.filter(row=>!String(row.createdByOwnerId??"").startsWith("root:"))],candidates};
  });

  app.post("/admin/owners", { preHandler: rootOwnerGuard }, async (request, reply) => {
    const {userId}=z.object({userId:z.string().uuid()}).parse(request.body);
    const user=db.prepare("SELECT id,name,phone,group_code AS groupCode FROM users WHERE id=? AND deleted_at IS NULL").get(userId) as
      | {id:string;name:string;phone:string;groupCode:string}
      | undefined;
    if (!user) return reply.code(404).send({message:"Usuário verificado não encontrado."});
    if(effectiveOwnerAccounts(db,config).some(owner=>owner.phone===user.phone)||db.prepare("SELECT 1 FROM owner_access WHERE user_id=? AND role=\'ROOT_OWNER\' AND active=1").get(user.id))return reply.code(409).send({message:"Owner principal não pode ser rebaixado a administrador."});
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
    const target=db.prepare("SELECT phone,role FROM owner_access WHERE id=?").get(id) as {phone:string;role:string}|undefined;
    if(target&&(target.role==="ROOT_OWNER"||effectiveOwnerAccounts(db,config).some(owner=>owner.phone===target.phone)))return reply.code(409).send({message:"Owner principal não pode ser removido da equipe."});
    const changed=db.prepare("UPDATE owner_access SET active=0,updated_at=? WHERE id=?").run(new Date().toISOString(),id);
    if (!changed.changes) return reply.code(404).send({message:"Administrador não encontrado."});
    return {ok:true};
  });

  return { ownerGuard, rootOwnerGuard };
}
