// AUDITORIA / anúncio de evento nos grupos pelo caminho durável (outbox + anti-ban).
//
// Ponte entre os gatilhos do sistema (abriu fila, alguém fez upload, ...) e os grupos
// do WhatsApp. Renderiza o texto da automação (com variantes, se o Owner não
// customizou) e enfileira para o(s) grupo(s)-alvo via queueGroupAutomation, que passa
// pelo flushWhatsAppOutbox com cadência/warmup. Respeita enabled e canal do catálogo.
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";
import { renderAutomation, targetGroups, type AutomationContext } from "./bot-dispatch.js";
import { queueGroupAutomation } from "./whatsapp.js";
import { featureEnabled, type BotFeatureCode } from "./bot.js";
import { spreadFanOut } from "./bot-evolution.js";

function featureForAnnouncement(event: string): BotFeatureCode | undefined {
  if(event.startsWith("QUEUE_") || event==="UPLOAD_NOTICE")return "QUEUE_ANNOUNCE";
  if(event.startsWith("WELCOME_"))return "DECISION_NOTICE";
  if(["BROADCAST_GLOBAL","WEEKLY_XP_RANK","MONTHLY_TOP","PINNED_MESSAGE"].includes(event))return "BROADCAST";
  return undefined;
}

/**
 * Anuncia um evento nos grupos. `dedupeKey` garante idempotência (ex.: o id da
 * submissão para UPLOAD_NOTICE; o id da fila para QUEUE_OPEN). Devolve quantos grupos
 * receberam (ou o motivo do skip).
 */
export function announceToGroups(
  db: AppDatabase, config: Config, event: string,
  vars: Record<string, string | number>,
  opts: { dedupeKey: string; ctx?: AutomationContext; expiresMinutes?: number; now?: Date },
): { queued: number; skipped?: string } {
  const feature=featureForAnnouncement(event);
  if(feature && !featureEnabled(db,feature))return {queued:0,skipped:"feature-disabled"};
  const rendered = renderAutomation(db, event, vars);
  if ("skipped" in rendered) return { queued: 0, skipped: rendered.skipped };
  if (rendered.channel !== "EVOLUTION") return { queued: 0, skipped: "not-group-channel" };
  const groups = targetGroups(db, rendered.target as "GROUP" | "ALL_GROUPS", opts.ctx ?? {});
  // AUDITORIA / Teo M1: anuncio de evento tem validade (padrao 12h). Se o backlog de
  // warmup/silencio adiar alem disso, descarta em vez de postar "fulano fez upload" de
  // um video velho. 0 = sem validade.
  const minutes = opts.expiresMinutes ?? 720;
  const at=opts.now ?? new Date();
  const delays=spreadFanOut(groups.length);
  const expiresAt = minutes > 0 ? new Date(at.getTime() + minutes * 60_000).toISOString() : undefined;
  let queued = 0;
  for (const [index,group] of groups.entries()) {
    const result = queueGroupAutomation(
      db, config, group.groupId, rendered.text,
      `${event}:${group.groupId}:${opts.dedupeKey}`,
      { event, deliveryClass: rendered.deliveryClass==="QUEUE" ? "QUEUE" : "ENGAGEMENT", availableAt:new Date(at.getTime()+(delays[index]??0)).toISOString(), expiresAt },
    );
    if (result.queued) queued += 1;
  }
  return { queued };
}
