// AUDITORIA / testes das variantes de anúncios.
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "./db.js";
import { ensureMessageRotation } from "./bot-motivational.js";
import {
  DAILY_SCHEDULE, EVENT_VARIANTS, eventsWithVariants, pickEventVariant,
} from "./bot-variants.js";

let db: AppDatabase;
beforeEach(() => { db = new Database(":memory:") as AppDatabase; ensureMessageRotation(db); });

describe("agenda das diárias", () => {
  it("bom dia 07:00 e boa noite 21:00 em America/Bahia", () => {
    expect(DAILY_SCHEDULE.MORNING).toEqual({ hour: 7, minute: 0 });
    expect(DAILY_SCHEDULE.NIGHT).toEqual({ hour: 21, minute: 0 });
    expect(DAILY_SCHEDULE.timeZone).toBe("America/Bahia");
  });
});

describe("variantes dos anúncios", () => {
  it("cobre os eventos que o dono pediu", () => {
    for (const ev of ["QUEUE_OPEN", "QUEUE_STATUS", "UPLOAD_NOTICE", "COINS_EARNED", "LEVEL_UP", "WEEKLY_XP_RANK", "MONTHLY_TOP"]) {
      expect(EVENT_VARIANTS[ev]?.length ?? 0).toBeGreaterThanOrEqual(4);
    }
  });

  it("o upload anuncia a URL do vídeo e NUNCA o telefone", () => {
    for (const v of EVENT_VARIANTS.UPLOAD_NOTICE) {
      expect(v).toMatch(/\{url\}/);
      expect(v).toMatch(/\{nome\}/);
      expect(v).not.toMatch(/\{(numero|telefone|phone)\}/);
    }
  });

  it("a fila livre mostra abertas e ocupadas", () => {
    for (const v of EVENT_VARIANTS.QUEUE_STATUS) {
      expect(v).toMatch(/\{abertas\}/);
      expect(v).toMatch(/\{ocupadas\}/);
    }
  });

  it("escolhe variante sem repetir a anterior", () => {
    let prev = "";
    for (let i = 0; i < 20; i++) {
      const v = pickEventVariant(db, "QUEUE_OPEN")!;
      expect(v).not.toBe(prev);
      prev = v;
    }
  });

  it("evento sem poço devolve undefined (usa o defaultText do catálogo)", () => {
    expect(pickEventVariant(db, "WELCOME_MEMBER")).toBeUndefined();
  });

  it("todas as variantes preservam placeholders conhecidos e nenhum travessão", () => {
    for (const pool of Object.values(EVENT_VARIANTS)) {
      for (const v of pool) {
        expect(v).not.toMatch(/—/);
        expect(v.length).toBeGreaterThan(10);
      }
    }
  });

  it("eventsWithVariants reporta as contagens para o painel", () => {
    const list = eventsWithVariants();
    expect(list.find((e) => e.event === "UPLOAD_NOTICE")?.count).toBeGreaterThanOrEqual(5);
  });
});

describe("placeholders das variantes não divergem do catálogo (guarda anti-drift)", () => {
  it("todo placeholder usado por uma variante existe no catálogo daquele evento", async () => {
    const { AUTOMATION_CATALOG } = await import("./bot-automations.js");
    const metaByEvent = new Map((AUTOMATION_CATALOG as readonly {event:string;placeholders:readonly string[]}[]).map((m) => [m.event, new Set(m.placeholders)]));
    for (const [event, pool] of Object.entries(EVENT_VARIANTS)) {
      const allowed = metaByEvent.get(event);
      expect(allowed, `evento ${event} no catálogo`).toBeTruthy();
      for (const tmpl of pool) {
        for (const ph of [...tmpl.matchAll(/\{(\w+)\}/g)].map((m) => m[1])) {
          expect(allowed!.has(ph), `placeholder {${ph}} de ${event} deve existir no catálogo`).toBe(true);
        }
      }
    }
  });
});
