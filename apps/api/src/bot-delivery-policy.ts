// AUDITORIA / HYBRID+ — política de entrega: quando o bot PODE falar.
//
// Três freios que a reauditoria pediu, num lugar só, para o disparo consultar
// antes de enfileirar qualquer coisa:
//
//  1. SILÊNCIO NOTURNO — ninguém merece ser acordado por aviso de fila. Respeito
//     básico, e também higiene do número: mensagem de madrugada é a que mais vira
//     bloqueio.
//  2. ORÇAMENTO DIÁRIO — 19 automações + eventos de gamificação + booster podem
//     render 8 mensagens num dia bom para a mesma pessoa. `COINS_EARNED`,
//     `LEVEL_UP` e `STREAK_MILESTONE` disparam no MESMO instante, pelo mesmo
//     motivo. Limite genérico não resolve: é preciso PRIORIDADE, para o aviso que
//     importa ("é a sua vez") não ser descartado por causa de três parabéns.
//  3. OPT-OUT — respeitado aqui também (ver `bot-inbound.ts`).
//
// Por que descartar em vez de adiar: um "nova fila aberta" entregue 6 horas depois
// é pior que não entregue — confunde e irrita. Recompensa atrasada idem. O que
// não couber hoje não deve aparecer amanhã fora de hora.
//
// REGRA DURA (repetida de propósito): nada disso vale para mensagem transacional.
// Código de acesso e decisão de cadastro passam sempre, a qualquer hora, acima de
// qualquer orçamento. Sem o código a pessoa não entra na própria conta.
import type { AppDatabase } from "./db.js";
import { isOptedOut } from "./bot-inbound.js";

/** Quanto mais baixo, mais importante. Transacional nem entra na fila de corte. */
export const DELIVERY_PRIORITY = {
  TRANSACTIONAL: 0,  // código de acesso, decisão de cadastro, resposta de suporte
  QUEUE: 1,          // "é a sua vez", fila pronta — ação esperada da pessoa
  REWARD: 2,         // moedas, nível, streak — bom, mas pode esperar/agrupar
  ENGAGEMENT: 3,     // reativação, novidades, ranking
} as const;
export type DeliveryClass = keyof typeof DELIVERY_PRIORITY;

export type DeliveryPolicy = {
  /** Hora local em que o bot pode começar a falar (0-23). */
  quietEndHour: number;
  /** Hora local a partir da qual o bot se cala (0-23). */
  quietStartHour: number;
  /** Máximo de mensagens não transacionais por pessoa por dia. */
  dailyBudget: number;
  timeZone: string;
};

// O dia ativo do projeto ja esta definido pelo booster semanal: 06:00 as 23:59
// (America/Bahia). O bot segue a MESMA convencao, em vez de inventar outra — nada
// confunde mais o dono do que duas nocoes de "e cedo demais" no mesmo produto.
export const DEFAULT_DELIVERY_POLICY: DeliveryPolicy = {
  quietStartHour: 0,    // silencia a partir da meia-noite
  quietEndHour: 6,      // volta a falar as 06:00
  dailyBudget: 3,
  timeZone: "America/Bahia",
};

export function ensureBotDelivery(db: AppDatabase) {
  db.exec(`CREATE TABLE IF NOT EXISTS bot_delivery_log (
    phone TEXT NOT NULL,
    local_date TEXT NOT NULL,
    delivery_class TEXT NOT NULL,
    event TEXT NOT NULL,
    sent_at TEXT NOT NULL
  );`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_bot_delivery_log_day ON bot_delivery_log(phone,local_date);");
  // Supressões também são dado: taxa alta = política mal calibrada.
  db.exec(`CREATE TABLE IF NOT EXISTS bot_delivery_suppressed (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    event TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`);
}

/** Data e hora local do usuário (o fuso do projeto, não o do servidor). */
export function localClock(policy: DeliveryPolicy, at: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: policy.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const read = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${read("year")}-${read("month")}-${read("day")}`, hour: Number(read("hour")) };
}

/**
 * Está no horário de silêncio? Trata corretamente a janela que cruza a meia-noite
 * (ex.: silêncio das 21h às 8h).
 */
export function inQuietHours(policy: DeliveryPolicy, at: Date = new Date()): boolean {
  const { hour } = localClock(policy, at);
  const { quietStartHour: start, quietEndHour: end } = policy;
  if (start === end) return false;              // sem silêncio
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

/**
 * Próximo instante em que o silêncio TERMINA (sai de quiet hours). Avança em passos
 * de 15 min — robusto a qualquer fuso/política, sem aritmética de UTC frágil. Usado
 * para ADIAR (não descartar) envios de grupo que caíram na madrugada.
 */
export function nextQuietHoursEnd(policy: DeliveryPolicy, at: Date = new Date()): string {
  const d = new Date(at.getTime());
  for (let step = 0; step < 48 && inQuietHours(policy, d); step++) {
    d.setTime(d.getTime() + 15 * 60 * 1000);
  }
  return d.toISOString();
}

export type DeliveryDecision =
  | { allowed: true }
  | { allowed: false; reason: "OPTED_OUT" | "QUIET_HOURS" | "BUDGET_EXCEEDED" };

/**
 * Pode entregar AGORA? Consulta opt-out, silêncio e orçamento — nessa ordem, da
 * razão mais permanente para a mais circunstancial, para o motivo reportado ser o
 * mais útil ao Owner.
 */
export function canDeliver(
  db: AppDatabase,
  phone: string,
  deliveryClass: DeliveryClass,
  policy: DeliveryPolicy = DEFAULT_DELIVERY_POLICY,
  at: Date = new Date(),
): DeliveryDecision {
  if (deliveryClass === "TRANSACTIONAL") return { allowed: true };
  if (isOptedOut(db, phone)) return { allowed: false, reason: "OPTED_OUT" };
  if (inQuietHours(policy, at)) return { allowed: false, reason: "QUIET_HOURS" };

  const { date } = localClock(policy, at);
  const used = (db.prepare(
    "SELECT COUNT(*) AS n FROM bot_delivery_log WHERE phone=? AND local_date=? AND delivery_class<>'TRANSACTIONAL'"
  ).get(phone, date) as { n: number }).n;
  if (used >= policy.dailyBudget) return { allowed: false, reason: "BUDGET_EXCEEDED" };
  return { allowed: true };
}

/** Registra uma entrega para o orçamento do dia. */
export function recordDelivery(
  db: AppDatabase, phone: string, deliveryClass: DeliveryClass, event: string,
  policy: DeliveryPolicy = DEFAULT_DELIVERY_POLICY, at: Date = new Date(),
) {
  const { date } = localClock(policy, at);
  db.prepare("INSERT INTO bot_delivery_log (phone,local_date,delivery_class,event,sent_at) VALUES (?,?,?,?,?)")
    .run(phone, date, deliveryClass, event, at.toISOString());
}

/** Registra uma supressão — a taxa é o sinal de que a política precisa de ajuste. */
export function recordSuppressed(db: AppDatabase, phone: string, event: string, reason: string, at: Date = new Date()) {
  db.prepare("INSERT INTO bot_delivery_suppressed (phone,event,reason,created_at) VALUES (?,?,?,?)")
    .run(phone, event, reason, at.toISOString());
}

/** Painel do Owner: quanto está sendo cortado e por quê. */
export function suppressionStats(db: AppDatabase, sinceIso?: string) {
  const since = sinceIso ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
  return db.prepare(
    "SELECT reason, COUNT(*) AS total FROM bot_delivery_suppressed WHERE created_at>=? GROUP BY reason ORDER BY total DESC"
  ).all(since) as Array<{ reason: string; total: number }>;
}

/**
 * Quando várias recompensas disparam no mesmo instante, mandar três mensagens é
 * ruído. Esta função escolhe a de maior prioridade e devolve as demais para serem
 * agrupadas num resumo — em vez de competirem pelo mesmo orçamento.
 */
export function collapseByPriority<T extends { deliveryClass: DeliveryClass }>(items: T[]): { primary?: T; collapsed: T[] } {
  if (!items.length) return { collapsed: [] };
  const sorted = [...items].sort((a, b) => DELIVERY_PRIORITY[a.deliveryClass] - DELIVERY_PRIORITY[b.deliveryClass]);
  return { primary: sorted[0], collapsed: sorted.slice(1) };
}
