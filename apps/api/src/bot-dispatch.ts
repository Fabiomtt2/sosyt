// AUDITORIA / HYBRID+ — o despachante: liga uma automação ao motor certo.
//
// Até aqui, as peças existiam soltas: o catálogo de automações (texto editável), a
// política de entrega (silêncio/orçamento/opt-out), e o motor Evolution (grupos com
// freios anti-ban). Faltava o fio que junta tudo: dado um EVENTO, decidir o canal,
// renderizar a fala, checar se PODE enviar, e entregar pelo motor certo.
//
//  - canal OFFICIAL (DM): reusa a fila durável `whatsapp_outbox` via queueBotNotification.
//  - canal EVOLUTION (grupo): resolve os grupos-alvo e produz um PLANO de fan-out com
//    cadência/jitter (nunca uma rajada), que o executor manda pelo cliente Evolution.
//
// O planejamento é puro e testável; a execução é fina e recebe os motores por injeção.
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";
import { automationSettings } from "./bot-automation-store.js";
import { renderTemplate, type AutomationCategory } from "./bot-automations.js";
import {
  DEFAULT_DELIVERY_POLICY, canDeliver, recordDelivery, recordSuppressed,
  type DeliveryClass, type DeliveryPolicy,
} from "./bot-delivery-policy.js";
import {
  DEFAULT_CADENCE, spreadFanOut, type CadencePolicy, type EvolutionClient,
} from "./bot-evolution.js";

/** Cada categoria do catálogo tem uma prioridade de entrega. */
const DELIVERY_CLASS_BY_CATEGORY: Record<AutomationCategory, DeliveryClass> = {
  SUPPORT: "TRANSACTIONAL",   // resposta de suporte não pode ser cortada por orçamento
  ONBOARDING: "QUEUE",
  QUEUES: "QUEUE",
  REWARDS: "REWARD",
  RETENTION: "ENGAGEMENT",
  BROADCAST: "ENGAGEMENT",
};

export type AutomationContext = {
  /** telefone do participante, para automações no privado (MEMBER). */
  phone?: string;
  /** código do grupo específico, para automações com alvo GROUP. */
  groupCode?: string;
  /** telefones dos Owners, para automações com alvo OWNERS. */
  ownerPhones?: string[];
};

export type GroupSend = { code: string; groupId: string; text: string; delayMs: number };

export type RenderedAutomation =
  | { skipped: string }
  | {
      event: string; enabled: true; channel: "OFFICIAL" | "EVOLUTION";
      target: "MEMBER" | "OWNERS" | "GROUP" | "ALL_GROUPS";
      text: string; deliveryClass: DeliveryClass;
    };

/** Renderiza o que vale AGORA para um evento, ou diz por que foi pulado. */
export function renderAutomation(db: AppDatabase, event: string, vars: Record<string, string | number>): RenderedAutomation {
  let settings;
  try { settings = automationSettings(db, event as never); }
  catch { return { skipped: "unknown-event" }; }
  if (!settings.enabled) return { skipped: "disabled" };
  const category = (automationSettingsCategory(event) ?? "BROADCAST");
  // AUDITORIA / variantes: se o Owner NÃO customizou o texto (segue o padrão) e existe
  // um poço de variantes para o evento, escolhe uma variante sem repetir — assim os
  // anúncios recorrentes (fila, upload, XP, ranks) não ficam repetitivos. Texto
  // customizado pelo Owner sempre tem prioridade.
  let base = settings.text;
  try {
    const meta = automationMeta(event as never);
    if (settings.text === meta.defaultText) {
      const variant = pickEventVariant(db, event);
      if (variant) base = variant;
    }
  } catch { /* evento sem meta: usa o texto como veio */ }
  return {
    event, enabled: true, channel: settings.channel, target: settings.target,
    text: renderTemplate(base, vars),
    deliveryClass: DELIVERY_CLASS_BY_CATEGORY[category],
  };
}

// pequeno espelho do catálogo só para a categoria (evita acoplar o store ao catálogo aqui)
import { automationMeta } from "./bot-automations.js";
import { pickEventVariant } from "./bot-variants.js";
function automationSettingsCategory(event: string): AutomationCategory | undefined {
  try { return automationMeta(event as never).category; } catch { return undefined; }
}

/** Grupos que recebem uma automação de grupo. ALL_GROUPS = todos habilitados com id do WhatsApp. */
export function targetGroups(db: AppDatabase, target: "GROUP" | "ALL_GROUPS", ctx: AutomationContext): Array<{ code: string; groupId: string }> {
  if (target === "GROUP") {
    if (!ctx.groupCode) return [];
    const row = db.prepare("SELECT code,whatsapp_group_id AS gid FROM groups WHERE code=? AND enabled=1 AND whatsapp_group_id IS NOT NULL")
      .get(ctx.groupCode) as { code: string; gid: string } | undefined;
    return row ? [{ code: row.code, groupId: row.gid }] : [];
  }
  return (db.prepare("SELECT code,whatsapp_group_id AS gid FROM groups WHERE enabled=1 AND whatsapp_group_id IS NOT NULL ORDER BY code")
    .all() as Array<{ code: string; gid: string }>).map((r) => ({ code: r.code, groupId: r.gid }));
}

/**
 * Plano de fan-out: uma mensagem por grupo, com atrasos espalhados pela janela de
 * cadência. É isso que impede 40 grupos de receberem em rajada (assinatura de bot).
 */
export function planGroupFanout(
  groups: Array<{ code: string; groupId: string }>, text: string,
  policy: CadencePolicy = DEFAULT_CADENCE, rand: () => number = Math.random,
): GroupSend[] {
  const delays = spreadFanOut(groups.length, policy, rand);
  return groups.map((g, index) => ({ code: g.code, groupId: g.groupId, text, delayMs: delays[index] ?? 0 }));
}

export type DispatchEngines = {
  /** envio 1:1 oficial — normalmente queueBotNotification parcialmente aplicado. */
  sendOfficial?: (phone: string, body: string, dedupeKey: string, deliveryClass: DeliveryClass, event: string) => { queued: boolean; reason?: string };
  evolution?: EvolutionClient;
};

export type DispatchResult = {
  event: string;
  skipped?: string;
  official?: Array<{ phone: string; queued: boolean; reason?: string }>;
  groupPlan?: GroupSend[];
};

/**
 * Despacha um evento. Para DM, enfileira no outbox (a própria queueBotNotification já
 * checa opt-out/silêncio/orçamento). Para grupo, devolve o PLANO; a execução temporizada
 * fica a cargo do worker de grupo (respeita os atrasos, para não disparar em rajada).
 */
export function dispatchAutomation(
  db: AppDatabase, config: Config, event: string, vars: Record<string, string | number>,
  ctx: AutomationContext, engines: DispatchEngines,
  opts: { cadence?: CadencePolicy; deliveryPolicy?: DeliveryPolicy; rand?: () => number; now?: Date } = {},
): DispatchResult {
  const rendered = renderAutomation(db, event, vars);
  if ("skipped" in rendered) return { event, skipped: rendered.skipped };

  if (rendered.channel === "OFFICIAL") {
    const phones = rendered.target === "OWNERS" ? (ctx.ownerPhones ?? []) : (ctx.phone ? [ctx.phone] : []);
    if (!phones.length) return { event, skipped: "no-recipient" };
    const official = phones.map((phone) => {
      const result = engines.sendOfficial
        ? engines.sendOfficial(phone, rendered.text, `${event}:${phone}:${dayKey(opts.now)}`, rendered.deliveryClass, event)
        : { queued: false, reason: "NO_OFFICIAL_ENGINE" };
      return { phone, ...result };
    });
    return { event, official };
  }

  // EVOLUTION / grupo
  const groups = targetGroups(db, rendered.target as "GROUP" | "ALL_GROUPS", ctx);
  if (!groups.length) return { event, skipped: "no-groups" };
  return { event, groupPlan: planGroupFanout(groups, rendered.text, opts.cadence, opts.rand) };
}

/** Executa um plano de grupo respeitando os atrasos, com a política de entrega por grupo. */
export async function runGroupPlan(
  db: AppDatabase, plan: GroupSend[], client: EvolutionClient,
  opts: { deliveryPolicy?: DeliveryPolicy; event?: string; sleep?: (ms: number) => Promise<void>; now?: Date } = {},
): Promise<{ sent: number; suppressed: number; failed: number }> {
  const policy = opts.deliveryPolicy ?? DEFAULT_DELIVERY_POLICY;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const health = await client.health();
  if (!health.connected) {
    // breaker: sessão caída não acumula para despejar tudo na reconexão.
    for (const send of plan) recordSuppressed(db, send.groupId, opts.event ?? "GROUP", "EVOLUTION_DOWN", opts.now);
    return { sent: 0, suppressed: plan.length, failed: 0 };
  }
  let sent = 0, suppressed = 0, failed = 0, previous = 0;
  for (const send of plan) {
    await sleep(Math.max(0, send.delayMs - previous));
    previous = send.delayMs;
    const verdict = canDeliver(db, send.groupId, "QUEUE", policy, opts.now);
    if (!verdict.allowed) { recordSuppressed(db, send.groupId, opts.event ?? "GROUP", verdict.reason, opts.now); suppressed++; continue; }
    try {
      await client.sendGroupText(send.groupId, send.text);
      recordDelivery(db, send.groupId, "QUEUE", opts.event ?? "GROUP", policy, opts.now);
      sent++;
    } catch { failed++; }
  }
  return { sent, suppressed, failed };
}

function dayKey(now?: Date): string {
  return (now ?? new Date()).toISOString().slice(0, 10);
}
