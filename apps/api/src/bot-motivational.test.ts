// AUDITORIA / testes das diárias motivacionais que nunca repetem.
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "./db.js";
import {
  MORNING_GREETINGS, MORNING_MOTIVATION, NIGHT_GREETINGS, NIGHT_MOTIVATION,
  dailyMessage, dailyVariantCount, ensureMessageRotation, pickNonRepeating, varyFrom,
} from "./bot-motivational.js";

let db: AppDatabase;
beforeEach(() => { db = new Database(":memory:") as AppDatabase; ensureMessageRotation(db); });

describe("seletor não-repetição", () => {
  it("não repete dentro da janela de memória", () => {
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) seen.push(pickNonRepeating(db, "b", 10, { window: 5 }));
    // os últimos 5 nunca repetem entre si
    const last5 = seen.slice(-5);
    expect(new Set(last5).size).toBe(5);
  });

  it("nunca devolve o índice imediatamente anterior", () => {
    let prev = -1;
    for (let i = 0; i < 50; i++) {
      const cur = pickNonRepeating(db, "c", 8);
      expect(cur).not.toBe(prev);
      prev = cur;
    }
  });

  it("pool de tamanho 1 não quebra", () => {
    expect(pickNonRepeating(db, "one", 1)).toBe(0);
  });

  it("a memória sobrevive (persistida no banco)", () => {
    const first = pickNonRepeating(db, "persist", 5, { window: 4 });
    const again = pickNonRepeating(db, "persist", 5, { window: 4 });
    expect(again).not.toBe(first);
    const row = db.prepare("SELECT recent FROM message_rotation WHERE bucket='persist'").get() as { recent: string };
    expect(JSON.parse(row.recent).length).toBeGreaterThan(0);
  });
});

describe("mensagem diária", () => {
  it("monta saudação + motivacional", () => {
    const msg = dailyMessage(db, "MORNING");
    expect(msg.length).toBeGreaterThan(20);
    // começa com alguma saudação de manhã
    expect(MORNING_GREETINGS.some((g) => msg.startsWith(g))).toBe(true);
    expect(MORNING_MOTIVATION.some((m) => msg.includes(m))).toBe(true);
  });

  it("boa noite usa os poços da noite", () => {
    const msg = dailyMessage(db, "NIGHT");
    expect(NIGHT_GREETINGS.some((g) => msg.startsWith(g))).toBe(true);
    expect(NIGHT_MOTIVATION.some((m) => msg.includes(m))).toBe(true);
  });

  it("gera muitas mensagens seguidas sem repetir a anterior", () => {
    const msgs: string[] = [];
    for (let i = 0; i < 30; i++) msgs.push(dailyMessage(db, "MORNING"));
    for (let i = 1; i < msgs.length; i++) expect(msgs[i]).not.toBe(msgs[i - 1]);
  });

  it("tem centenas de combinações possíveis", () => {
    expect(dailyVariantCount("MORNING")).toBeGreaterThan(300);
    expect(dailyVariantCount("NIGHT")).toBeGreaterThan(300);
  });

  it("nenhuma mensagem usa travessão (soa humano)", () => {
    for (const g of [...MORNING_GREETINGS, ...NIGHT_GREETINGS, ...MORNING_MOTIVATION, ...NIGHT_MOTIVATION]) {
      expect(g).not.toMatch(/—/);
    }
  });
});

describe("variação genérica (também para o privado)", () => {
  it("varia respostas de um poço qualquer sem repetir a anterior", () => {
    const pool = ["a", "b", "c", "d", "e"];
    let prev = "";
    for (let i = 0; i < 20; i++) {
      const v = varyFrom(db, "privado:oi", pool);
      expect(v).not.toBe(prev);
      prev = v;
    }
  });

  it("poço vazio devolve string vazia", () => {
    expect(varyFrom(db, "x", [])).toBe("");
  });
});
