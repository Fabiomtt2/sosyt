import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "./config.js";
import type { AppDatabase } from "./db.js";
import { ownerAccounts, normalizeOwnerName, ownerCredentialVersion } from "./owners.js";
import { whatsappJoinUrl, whatsappStatus, queueOwnerAlerts } from "./whatsapp.js";
import { normalizeBrazilMobile } from "./phone.js";

const phoneSchema = z.string().transform(normalizeBrazilMobile).pipe(z.string().regex(/^55[1-9]\d9\d{8}$/, "Informe um celular brasileiro no formato +55 DD 9XXXX-XXXX."));
const groupSchema = z.string().regex(/^[1-9]\d*$/).max(8);
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
  app.get("/public/groups", async () => ({
    groups: (db.prepare("SELECT code FROM groups WHERE enabled = 1 ORDER BY length(code), code").all() as Array<{ code: string }>).map(({ code }) => code),
    ownerContactAvailable: Boolean(config.OWNER_WHATSAPP),
    membershipRequired: config.REQUIRE_GROUP_MEMBERSHIP, whatsappJoinUrl: whatsappJoinUrl(config)
  }));
  app.post("/participation/request", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const body = z.object({ name: z.string().trim().min(2).max(80), phone: phoneSchema, groupCode: groupSchema.optional(), consent: z.literal(true) }).parse(request.body);
    if (hasMembership(db, body.phone)) return { ok: true, alreadyApproved: true, message: "Seu número já foi aprovado. Entre com o grupo autorizado pelo Owner." };
    if (body.groupCode && !db.prepare("SELECT 1 FROM groups WHERE code = ? AND enabled = 1").get(body.groupCode)) return reply.code(400).send({ message: "Selecione um grupo disponível." });
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO participation_requests (id, name, phone, preferred_group, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET name = excluded.name, preferred_group = excluded.preferred_group, status = 'PENDING', updated_at = excluded.updated_at`)
      .run(randomUUID(), body.name, body.phone, body.groupCode ?? null, now, now);
    const row = db.prepare("SELECT id FROM participation_requests WHERE phone=?").get(body.phone) as { id: string };
    queueOwnerAlerts(db,config,row.id,body.phone,body.name,`web:${randomUUID()}`);
    const text = `Olá! Quero participar do projeto SOS YouTube. Meu nome é ${body.name}, WhatsApp ${body.phone}. ${body.groupCode ? "Gostaria de entrar no SOS YOUTUBER " + body.groupCode + "." : "Gostaria de entrar em um grupo SOS YOUTUBER."} Minha solicitação já está no painel.`;
    return { ok: true, message: "Solicitação registrada. O Owner vai conferir sua participação no grupo e liberar seu acesso.", whatsappUrl: config.OWNER_WHATSAPP ? `https://wa.me/${config.OWNER_WHATSAPP}?text=${encodeURIComponent(text)}` : undefined };
  });
  app.post("/admin/login", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const body = z.object({ secret: z.string().min(1).max(256), name: z.string().trim().min(2).max(80), identifier: z.string().trim().min(3).max(80), groupCode: z.literal("#") }).parse(request.body);
    const account = ownerAccounts(config).find((o) => normalizeOwnerName(o.name) === normalizeOwnerName(body.name));
    if (!account?.secret) return reply.code(401).send({ message: "Conta ou credencial do Owner inválida." });
    const ownerPhone = account.phone
      ? z.string().regex(/^\+55 [1-9]\d \[9\] ?\d{4}-\d{4}$/, "Use o formato +55 DD [9]XXXX-XXXX.").transform(normalizeBrazilMobile).safeParse(body.identifier)
      : undefined;
    const identifierMatches = account.phone
      ? Boolean(ownerPhone?.success && ownerPhone.data === account.phone)
      : body.identifier.toLowerCase() === account.identifier.toLowerCase();
    const hash = (value: string) => createHash("sha256").update(value).digest();
    if (!timingSafeEqual(hash(body.secret),hash(account.secret)) || !identifierMatches) return reply.code(401).send({ message: "Conta ou credencial do Owner inválida." });
    return { token: app.jwt.sign({ sub: `owner:${account.id}`, purpose: "owner", aud: "conexao-owner", jti: ownerCredentialVersion(account.secret) }, { expiresIn: "1h" }), role: "owner", owner: { name: account.name, groupCode: "#" } };
  });

  app.get("/admin/overview", { preHandler: ownerGuard }, async (request) => {
    const account = ownerAccounts(config).find((o) => `owner:${o.id}` === request.user.sub)!;
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia", year: "numeric", month: "2-digit" }).formatToParts(new Date());
    const fallback = `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
    const { month } = z.object({ month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/).default(fallback) }).parse(request.query);
    const [year, index] = month.split("-").map(Number);
    const start = new Date(Date.UTC(year, index - 1, 1, 3)).toISOString(), end = new Date(Date.UTC(year, index, 1, 3)).toISOString();
    const count = (sql: string, ...params: string[]) => (db.prepare(sql).get(...params) as { n: number }).n;
    const revenue = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payments WHERE provider = 'MERCADO_PAGO' AND status = 'APPROVED' AND approved_at >= ? AND approved_at < ?").get(start, end) as { n: number };
    return {
      month, timezone: "America/Bahia", owner: { name: account.name, groupCode: "#" }, whatsapp: whatsappStatus(db,config),
      metrics: {
        registeredUsers: count("SELECT COUNT(*) AS n FROM users"),
        activeUsers30d: count("SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= ?", new Date(Date.now() - 30 * 86400_000).toISOString()),
        approvedMembers: count("SELECT COUNT(*) AS n FROM group_memberships m JOIN groups g ON g.code = m.group_code WHERE revoked_at IS NULL AND g.enabled = 1"),
        requestsTotal: count("SELECT COUNT(*) AS n FROM participation_requests"),
        pendingRequests: count("SELECT COUNT(*) AS n FROM participation_requests WHERE status = 'PENDING'"),
        requestsMonth: count("SELECT COUNT(*) AS n FROM participation_requests WHERE created_at >= ? AND created_at < ?", start, end),
        completedCyclesMonth: count("SELECT COUNT(*) AS n FROM rounds WHERE status = 'READY' AND completed_at >= ? AND completed_at < ?", start, end),
        playlistsCreatedMonth: count("SELECT COUNT(*) AS n FROM playlist_exports WHERE status = 'SUCCESS' AND updated_at >= ? AND updated_at < ?", start, end),
        approvedPurchasesMonth: count("SELECT COUNT(*) AS n FROM payments WHERE provider = 'MERCADO_PAGO' AND status = 'APPROVED' AND approved_at >= ? AND approved_at < ?", start, end),
        demoPurchasesMonth: count("SELECT COUNT(*) AS n FROM payments WHERE provider = 'DEMO' AND status = 'APPROVED' AND approved_at >= ? AND approved_at < ?", start, end),
        revenueCentsMonth: revenue.n
      },
      groups: db.prepare("SELECT code, enabled FROM groups ORDER BY length(code), code").all(),
      requests: db.prepare("SELECT id, name, phone, preferred_group AS preferredGroup, status, source, whatsapp_verified_at AS whatsappVerifiedAt, created_at AS createdAt FROM participation_requests ORDER BY CASE status WHEN 'PENDING' THEN 0 ELSE 1 END, updated_at DESC LIMIT 200").all(),
      users: db.prepare(`SELECT u.id,u.name,u.phone,u.group_code AS groupCode,u.created_at AS createdAt,u.last_seen_at AS lastSeenAt,
        w.promo_millis + w.reward_millis + w.purchased_millis AS balanceMillis,w.extra_slot_passes AS extraPasses,w.payment_hold AS paymentHold
        FROM users u JOIN wallets w ON w.user_id = u.id ORDER BY u.created_at DESC LIMIT 200`).all(),
      members: db.prepare("SELECT phone, group_code AS groupCode, approved_at AS approvedAt, revoked_at AS revokedAt FROM group_memberships ORDER BY approved_at DESC LIMIT 200").all(),
      purchases: db.prepare("SELECT p.id,u.name,u.phone,p.provider,p.status,p.amount_cents AS amountCents,p.created_at AS createdAt,p.approved_at AS approvedAt FROM payments p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 200").all()
    };
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
    const body = z.object({ code: groupSchema, enabled: z.boolean().default(true) }).parse(request.body);
    db.prepare("INSERT INTO groups (code, enabled) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET enabled = excluded.enabled").run(body.code, body.enabled ? 1 : 0);
    return { ok: true };
  });
  app.post("/admin/members", { preHandler: ownerGuard }, async (request, reply) => {
    const body = z.object({ phone: phoneSchema, groupCode: groupSchema }).parse(request.body);
    if (!db.prepare("SELECT 1 FROM groups WHERE code = ? AND enabled = 1").get(body.groupCode)) return reply.code(400).send({ message: "Grupo inexistente ou desativado." });
    db.prepare("INSERT INTO group_memberships (phone,group_code,approved_at) VALUES (?,?,?) ON CONFLICT(phone) DO UPDATE SET group_code=excluded.group_code,approved_at=excluded.approved_at,revoked_at=NULL").run(body.phone,body.groupCode,new Date().toISOString());
    db.prepare("UPDATE participation_requests SET status='APPROVED',updated_at=? WHERE phone=?").run(new Date().toISOString(),body.phone);
    return { ok: true };
  });
  app.delete("/admin/members/:phone", { preHandler: ownerGuard }, async (request) => {
    const phone = phoneSchema.parse((request.params as { phone: string }).phone);
    db.prepare("UPDATE group_memberships SET revoked_at=? WHERE phone=?").run(new Date().toISOString(),phone);
    return { ok: true };
  });
  app.post("/admin/requests/:id/decision", { preHandler: ownerGuard }, async (request, reply) => {
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const body = z.object({ status: z.enum(["APPROVED","DECLINED"]), groupCode: groupSchema.optional() }).parse(request.body);
    const row = db.prepare("SELECT phone, preferred_group FROM participation_requests WHERE id=?").get(id) as { phone: string; preferred_group?: string } | undefined;
    if (!row) return reply.code(404).send({ message: "Solicitação não encontrada." });
    const group = body.groupCode ?? row.preferred_group;
    if (body.status === "APPROVED" && (!group || !db.prepare("SELECT 1 FROM groups WHERE code=? AND enabled=1").get(group))) return reply.code(400).send({ message: "Escolha um grupo ativo para aprovar." });
    db.transaction(() => {
      const now = new Date().toISOString();
      if (body.status === "APPROVED") db.prepare("INSERT INTO group_memberships (phone,group_code,approved_at) VALUES (?,?,?) ON CONFLICT(phone) DO UPDATE SET group_code=excluded.group_code,approved_at=excluded.approved_at,revoked_at=NULL").run(row.phone,group!,now);
      else db.prepare("UPDATE group_memberships SET revoked_at=? WHERE phone=?").run(now,row.phone);
      db.prepare("UPDATE participation_requests SET status=?,updated_at=? WHERE id=?").run(body.status,now,id);
    })();
    return { ok: true };
  });
  return { ownerGuard };
}
