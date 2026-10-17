// AUDITORIA / agendador das mensagens diárias (Bom dia 07:00 / Boa noite 21:00).
//
// O dono quer "Bom dia + motivacional" todo dia às 07:00 e "Boa noite" às 21:00
// (America/Bahia), em todos os grupos, nunca repetindo o texto. Este módulo decide
// QUANDO disparar; o texto vem do motor de não-repetição (dailyMessage), e o envio
// usa a fila durável + o worker com freios anti-ban (queueGroupAutomation -> outbox
// -> flushWhatsAppOutbox). Nada de executor direto em rajada.
//
// Idempotência: o dedupe do outbox é `EVENT:grupo:DIA`, então mesmo rodando a cada
// poucos segundos, cada grupo recebe no máximo UMA vez por dia. A janela de horário
// (ex.: 7h às 10h) garante que não sai "bom dia" às 15h se o servidor reiniciar.
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";
import { effectiveWhatsAppConfig } from "./integrations.js";
import { dailyMessage } from "./bot-motivational.js";
import { DAILY_SCHEDULE } from "./bot-variants.js";
import { automationSettings } from "./bot-automation-store.js";
import { announceToGroups } from "./bot-announce.js";

/** Hora (0-23) e data (YYYY-MM-DD) no fuso America/Bahia, de forma robusta. */
export function bahiaParts(now: Date): { hour: number; dayKey: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bahia", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return { hour: Number(parts.hour), dayKey: `${parts.year}-${parts.month}-${parts.day}` };
}

/** Janelas de disparo: do horário alvo até 3h depois (tolera reinício do servidor). */
const WINDOWS = [
  { kind: "MORNING" as const, event: "GOOD_MORNING", start: DAILY_SCHEDULE.MORNING.hour, end: DAILY_SCHEDULE.MORNING.until },
  { kind: "NIGHT" as const, event: "GOOD_NIGHT", start: DAILY_SCHEDULE.NIGHT.hour, end: DAILY_SCHEDULE.NIGHT.until },
];

export type DailyRunResult = { queued: Array<{ event: string; groups: number }> };

/**
 * Enfileira as diárias que estão na janela de horário agora, uma vez por grupo/dia.
 * Só opera em modo EVOLUTION/HYBRID_PLUS; em outros modos é no-op. Seguro para rodar
 * a cada tick do timer.
 */
export function runDailyAutomations(db: AppDatabase, config: Config, now: Date = new Date()): DailyRunResult {
  const result: DailyRunResult = { queued: [] };
  const runtime = effectiveWhatsAppConfig(db, config);
  if (runtime.WHATSAPP_MODE !== "EVOLUTION" && runtime.WHATSAPP_MODE !== "HYBRID_PLUS") return result;

  const { hour, dayKey } = bahiaParts(now);

  for (const window of WINDOWS) {
    if (hour < window.start || hour >= window.end) continue;
    // AUDITORIA / achado do ASTRA (C): usa announceToGroups -> renderAutomation, que
    // RESPEITA o texto e o publico que o Owner configurou no painel. O texto rotativo
    // (dailyMessage) vai como var {mensagem}; se o Owner escreveu um texto proprio, o
    // dele ganha. Validade de 5h (M1): "Bom dia" obsoleto do backlog e descartado.
    const announced = announceToGroups(
      db, config, window.event, { mensagem: dailyMessage(db, window.kind) },
      { dedupeKey: dayKey, expiresMinutes: 360, now },
    );
    if (announced.queued) result.queued.push({ event: window.event, groups: announced.queued });
  }

  // AUDITORIA / status de filas "de tempos em tempos": ao meio-dia (12h-13h Bahia),
  // uma vez por dia, anuncia quantas filas estao livres e quantas posicoes ocupadas.
  if (hour >= 12 && hour < 13 && automationSettings(db, "QUEUE_STATUS" as never).enabled) {
    const abertas = (db.prepare("SELECT COUNT(*) AS n FROM rounds WHERE status='OPEN' AND closed_at IS NULL").get() as { n: number }).n;
    const ocupadas = (db.prepare("SELECT COUNT(*) AS n FROM submissions s JOIN rounds r ON r.id=s.round_id WHERE r.status='OPEN' AND r.closed_at IS NULL").get() as { n: number }).n;
    const vagas = Math.max(0, abertas * 10 - ocupadas);
    const r = announceToGroups(db, config, "QUEUE_STATUS",
      { abertas, ocupadas, vagas, link: config.WEB_APP_URL },
      { dedupeKey: `status:${dayKey}` });
    if (r.queued) result.queued.push({ event: "QUEUE_STATUS", groups: r.queued });
  }
  return result;
}
