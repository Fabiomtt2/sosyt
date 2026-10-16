// AUDITORIA / testes do agendador das diárias.
import { beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "./db.js";
import { loadConfig, type Config } from "./config.js";
import { ensureBotAutomations, saveAutomationSettings } from "./bot-automation-store.js";
import { ensureBotDelivery } from "./bot-delivery-policy.js";
import { ensureBotOptOut } from "./bot-inbound.js";
import { bahiaParts, runDailyAutomations } from "./bot-scheduler.js";

let db: AppDatabase; let config: Config;
// 2026-10-16: 10:00Z = 07:00 Bahia (manhã); 00:00Z do dia 17 = 21:00 Bahia do dia 16.
const MORNING = new Date("2026-10-16T10:30:00Z");   // 07:30 Bahia
const NIGHT = new Date("2026-10-17T00:30:00Z");     // 21:30 Bahia (dia 16)
const AFTERNOON = new Date("2026-10-16T18:00:00Z"); // 15:00 Bahia

beforeEach(() => {
  db = createDatabase(":memory:");
  ensureBotAutomations(db); ensureBotOptOut(db); ensureBotDelivery(db);
  db.prepare("INSERT OR REPLACE INTO groups (code,enabled,whatsapp_group_id) VALUES ('1',1,'123@g.us'),('2',1,'456@g.us')").run();
  // modo EVOLUTION configurado via env
  config = loadConfig({
    NODE_ENV: "test", DATABASE_PATH: ":memory:", JWT_SECRET: "sched-jwt-32-characters-okayokayoka", AUTH_CODE_PEPPER: "sched-pepper-32-characters-okayokay",
    EVOLUTION_URL: "https://evo.example.test", EVOLUTION_INSTANCE: "sos-primary", EVOLUTION_API_KEY: "evolution-key-long-enough-1234", EVOLUTION_PHONE: "5571993951582", EVOLUTION_WEBHOOK_SECRET: "evolution-webhook-secret-min-24-chars",
  });
  saveAutomationSettings(db, "GOOD_MORNING", { enabled: true }, { id: "root", name: "Root" });
  saveAutomationSettings(db, "GOOD_NIGHT", { enabled: true }, { id: "root", name: "Root" });
});

describe("fuso America/Bahia", () => {
  it("converte UTC para a hora de Bahia (UTC-3)", () => {
    expect(bahiaParts(MORNING)).toEqual({ hour: 7, dayKey: "2026-10-16" });
    expect(bahiaParts(NIGHT)).toEqual({ hour: 21, dayKey: "2026-10-16" });
  });
});

describe("disparo das diárias", () => {
  it("às 07h enfileira Bom dia para todos os grupos", () => {
    const r = runDailyAutomations(db, config, MORNING);
    expect(r.queued).toEqual([{ event: "GOOD_MORNING", groups: 2 }]);
    const rows = db.prepare("SELECT recipient,payload FROM whatsapp_outbox").all() as Array<{ recipient: string; payload: string }>;
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.payload.includes("Bom dia") || x.payload.toLowerCase().includes("dia"))).toBe(true);
  });

  it("às 21h enfileira Boa noite", () => {
    const r = runDailyAutomations(db, config, NIGHT);
    expect(r.queued).toEqual([{ event: "GOOD_NIGHT", groups: 2 }]);
  });

  it("às 15h NÃO dispara nada (fora das janelas)", () => {
    expect(runDailyAutomations(db, config, AFTERNOON).queued).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get()).toEqual({ n: 0 });
  });

  it("é idempotente: rodar de novo no mesmo dia não duplica linhas no outbox", () => {
    runDailyAutomations(db, config, MORNING);
    runDailyAutomations(db, config, new Date("2026-10-16T10:45:00Z"));
    // o dedupe por grupo/dia garante no máximo UMA mensagem por grupo naquele dia
    expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get()).toEqual({ n: 2 });
  });

  it("evento desligado não dispara", () => {
    saveAutomationSettings(db, "GOOD_MORNING", { enabled: false }, { id: "root", name: "Root" });
    expect(runDailyAutomations(db, config, MORNING).queued).toEqual([]);
  });

  it("sem grupos, não dispara", () => {
    db.prepare("DELETE FROM groups").run();
    expect(runDailyAutomations(db, config, MORNING).queued).toEqual([]);
  });

  it("modo não-Evolution é no-op", () => {
    const meta = loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:", JWT_SECRET: "sched-jwt-32-characters-okayokayoka", AUTH_CODE_PEPPER: "sched-pepper-32-characters-okayokay", WHATSAPP_MODE: "OFFICIAL" });
    db.prepare("INSERT INTO integration_settings (key,value,updated_at) VALUES ('whatsapp.mode','OFFICIAL',?)").run(new Date().toISOString());
    expect(runDailyAutomations(db, meta, MORNING).queued).toEqual([]);
  });
});
