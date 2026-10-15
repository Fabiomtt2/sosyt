// AUDITORIA / HYBRID+ — testes da política de entrega (silêncio, orçamento, prioridade).
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "./db.js";
import { ensureBotOptOut, setOptOut } from "./bot-inbound.js";
import {
  DEFAULT_DELIVERY_POLICY, canDeliver, collapseByPriority, ensureBotDelivery,
  inQuietHours, localClock, recordDelivery, recordSuppressed, suppressionStats,
  type DeliveryPolicy,
} from "./bot-delivery-policy.js";

let db: AppDatabase;
const PHONE = "5571992679840";
beforeEach(() => {
  db = new Database(":memory:") as AppDatabase;
  ensureBotDelivery(db);
  ensureBotOptOut(db);
});

// America/Bahia = UTC-3. 12:00Z = 09:00 local; 02:00Z = 23:00 local do dia anterior.
const atLocal = (iso: string) => new Date(iso);

describe("HYBRID+ / silêncio noturno", () => {
  it("cala de madrugada e fala de dia", () => {
    expect(inQuietHours(DEFAULT_DELIVERY_POLICY, atLocal("2026-10-15T12:00:00Z"))).toBe(false); // 09h local
    expect(inQuietHours(DEFAULT_DELIVERY_POLICY, atLocal("2026-10-15T06:00:00Z"))).toBe(true);  // 03h local
  });

  it("segue o dia ativo do projeto: 06:00 às 23:59", () => {
    const p = DEFAULT_DELIVERY_POLICY;
    expect(inQuietHours(p, atLocal("2026-10-16T08:59:00Z"))).toBe(true);  // 05:59 local -> ainda calado
    expect(inQuietHours(p, atLocal("2026-10-16T09:00:00Z"))).toBe(false); // 06:00 local -> pode falar
    expect(inQuietHours(p, atLocal("2026-10-16T02:30:00Z"))).toBe(false); // 23:30 local -> ainda pode
    expect(inQuietHours(p, atLocal("2026-10-16T03:30:00Z"))).toBe(true);  // 00:30 local -> silêncio
  });

  it("a janela que cruza a meia-noite continua correta (política customizada)", () => {
    const noturna: DeliveryPolicy = { ...DEFAULT_DELIVERY_POLICY, quietStartHour: 21, quietEndHour: 8 };
    expect(inQuietHours(noturna, atLocal("2026-10-15T23:30:00Z"))).toBe(false); // 20:30 local
    expect(inQuietHours(noturna, atLocal("2026-10-16T00:30:00Z"))).toBe(true);  // 21:30 local
    expect(inQuietHours(noturna, atLocal("2026-10-16T11:30:00Z"))).toBe(false); // 08:30 local
  });

  it("silêncio desligado quando início == fim", () => {
    const sem: DeliveryPolicy = { ...DEFAULT_DELIVERY_POLICY, quietStartHour: 0, quietEndHour: 0 };
    expect(inQuietHours(sem, atLocal("2026-10-15T06:00:00Z"))).toBe(false);
  });

  it("usa o fuso do projeto, não o do servidor", () => {
    expect(localClock(DEFAULT_DELIVERY_POLICY, atLocal("2026-10-15T12:00:00Z")))
      .toEqual({ date: "2026-10-15", hour: 9 });
  });
});

describe("HYBRID+ / REGRA DURA: transacional passa sempre", () => {
  it("passa de madrugada, com opt-out e com orçamento estourado", () => {
    const madrugada = atLocal("2026-10-15T06:00:00Z");
    setOptOut(db, PHONE, true);
    for (let i = 0; i < 10; i++) recordDelivery(db, PHONE, "ENGAGEMENT", "x", DEFAULT_DELIVERY_POLICY, madrugada);
    expect(canDeliver(db, PHONE, "TRANSACTIONAL", DEFAULT_DELIVERY_POLICY, madrugada)).toEqual({ allowed: true });
  });
});

describe("HYBRID+ / opt-out e orçamento", () => {
  const dia = atLocal("2026-10-15T12:00:00Z"); // 09h local

  it("quem pediu silêncio não recebe divulgação", () => {
    setOptOut(db, PHONE, true);
    expect(canDeliver(db, PHONE, "ENGAGEMENT", DEFAULT_DELIVERY_POLICY, dia))
      .toEqual({ allowed: false, reason: "OPTED_OUT" });
  });

  it("corta ao estourar o orçamento diário", () => {
    for (let i = 0; i < DEFAULT_DELIVERY_POLICY.dailyBudget; i++) {
      expect(canDeliver(db, PHONE, "REWARD", DEFAULT_DELIVERY_POLICY, dia).allowed, `msg ${i}`).toBe(true);
      recordDelivery(db, PHONE, "REWARD", "COINS_EARNED", DEFAULT_DELIVERY_POLICY, dia);
    }
    expect(canDeliver(db, PHONE, "REWARD", DEFAULT_DELIVERY_POLICY, dia))
      .toEqual({ allowed: false, reason: "BUDGET_EXCEEDED" });
  });

  it("o orçamento vira no dia seguinte", () => {
    for (let i = 0; i < 5; i++) recordDelivery(db, PHONE, "REWARD", "x", DEFAULT_DELIVERY_POLICY, dia);
    expect(canDeliver(db, PHONE, "REWARD", DEFAULT_DELIVERY_POLICY, atLocal("2026-10-16T12:00:00Z")).allowed).toBe(true);
  });

  it("o orçamento é por pessoa", () => {
    for (let i = 0; i < 5; i++) recordDelivery(db, PHONE, "REWARD", "x", DEFAULT_DELIVERY_POLICY, dia);
    expect(canDeliver(db, "5571900000000", "REWARD", DEFAULT_DELIVERY_POLICY, dia).allowed).toBe(true);
  });

  it("transacional não consome o orçamento dos outros", () => {
    for (let i = 0; i < 9; i++) recordDelivery(db, PHONE, "TRANSACTIONAL", "LOGIN_CODE", DEFAULT_DELIVERY_POLICY, dia);
    expect(canDeliver(db, PHONE, "QUEUE", DEFAULT_DELIVERY_POLICY, dia).allowed).toBe(true);
  });
});

describe("HYBRID+ / prioridade: o aviso que importa não perde para três parabéns", () => {
  it("escolhe a maior prioridade e agrupa o resto", () => {
    const { primary, collapsed } = collapseByPriority([
      { deliveryClass: "REWARD" as const, event: "COINS_EARNED" },
      { deliveryClass: "ENGAGEMENT" as const, event: "INACTIVITY_NUDGE" },
      { deliveryClass: "QUEUE" as const, event: "QUEUE_READY" },
    ]);
    expect(primary?.event).toBe("QUEUE_READY");
    expect(collapsed.map((c) => c.event)).toEqual(["COINS_EARNED", "INACTIVITY_NUDGE"]);
  });

  it("lista vazia não quebra", () => {
    expect(collapseByPriority([])).toEqual({ collapsed: [] });
  });
});

describe("HYBRID+ / supressões são dado para o Owner", () => {
  it("agrupa por motivo", () => {
    recordSuppressed(db, PHONE, "COINS_EARNED", "BUDGET_EXCEEDED");
    recordSuppressed(db, PHONE, "LEVEL_UP", "BUDGET_EXCEEDED");
    recordSuppressed(db, PHONE, "INACTIVITY_NUDGE", "QUIET_HOURS");
    expect(suppressionStats(db)).toEqual([
      { reason: "BUDGET_EXCEEDED", total: 2 },
      { reason: "QUIET_HOURS", total: 1 },
    ]);
  });
});
