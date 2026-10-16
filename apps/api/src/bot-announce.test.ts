// AUDITORIA / testes do anúncio em grupos + integração de variantes.
import { beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "./db.js";
import { loadConfig, type Config } from "./config.js";
import { ensureBotAutomations, saveAutomationSettings } from "./bot-automation-store.js";
import { ensureBotDelivery } from "./bot-delivery-policy.js";
import { ensureBotOptOut } from "./bot-inbound.js";
import { ensureMessageRotation } from "./bot-motivational.js";
import { renderAutomation } from "./bot-dispatch.js";
import { announceToGroups } from "./bot-announce.js";

let db: AppDatabase; let config: Config;
beforeEach(() => {
  db = createDatabase(":memory:");
  ensureBotAutomations(db); ensureBotOptOut(db); ensureBotDelivery(db); ensureMessageRotation(db);
  db.prepare("INSERT OR REPLACE INTO groups (code,enabled,whatsapp_group_id) VALUES ('1',1,'123@g.us')").run();
  config = loadConfig({
    NODE_ENV: "test", DATABASE_PATH: ":memory:", JWT_SECRET: "ann-jwt-32-characters-okayokayokay", AUTH_CODE_PEPPER: "ann-pepper-32-characters-okayokayok",
    EVOLUTION_URL: "https://evo.example.test", EVOLUTION_INSTANCE: "sos-primary", EVOLUTION_API_KEY: "evolution-key-long-enough-1234", EVOLUTION_PHONE: "5571993951582", EVOLUTION_WEBHOOK_SECRET: "evolution-webhook-secret-min-24-chars",
  });
  saveAutomationSettings(db, "UPLOAD_NOTICE", { enabled: true }, { id: "root", name: "Root" });
  saveAutomationSettings(db, "QUEUE_OPEN", { enabled: true }, { id: "root", name: "Root" });
});

describe("variantes no render", () => {
  it("usa uma variante quando o Owner não customizou o texto", () => {
    // o texto segue o padrão -> deve render uma das variantes de UPLOAD_NOTICE
    const r = renderAutomation(db, "UPLOAD_NOTICE", { nome: "Ana", sala: "1", posicao: 3, aba: 2, fila: 2, url: "https://youtu.be/x" });
    expect("text" in r && r.text).toBeTruthy();
    if ("text" in r) { expect(r.text).toContain("Ana"); expect(r.text).toContain("https://youtu.be/x"); }
  });

  it("texto customizado pelo Owner tem prioridade sobre variante", () => {
    saveAutomationSettings(db, "UPLOAD_NOTICE", { text: "custom {nome} {url}" }, { id: "root", name: "Root" });
    const r = renderAutomation(db, "UPLOAD_NOTICE", { nome: "Ana", url: "https://youtu.be/x" });
    if ("text" in r) expect(r.text).toBe("custom Ana https://youtu.be/x");
  });
});

describe("announceToGroups", () => {
  it("UPLOAD_NOTICE vai pro grupo da pessoa com a URL e sem telefone", () => {
    const r = announceToGroups(db, config, "UPLOAD_NOTICE",
      { nome: "Ana", sala: "1", posicao: 3, aba: 2, fila: 2, url: "https://youtu.be/abc" },
      { dedupeKey: "sub-1", ctx: { groupCode: "1" } });
    expect(r.queued).toBe(1);
    const row = db.prepare("SELECT recipient,payload FROM whatsapp_outbox").get() as { recipient: string; payload: string };
    expect(row.recipient).toBe("123@g.us");
    const body = (JSON.parse(row.payload) as { text: { body: string } }).text.body;
    expect(body).toContain("youtu.be/abc");
    expect(body).toContain("Ana");
    // o CORPO nunca carrega telefone (privacidade); o _phone do envelope é a
    // identidade do BOT, não do usuário.
    expect(body).not.toMatch(/\d{10,13}/);
  });

  it("dedupe por chave: o mesmo upload não duplica", () => {
    announceToGroups(db, config, "UPLOAD_NOTICE", { nome: "Ana", sala: "1", posicao: 1, aba: 1, fila: 1, url: "https://youtu.be/a" }, { dedupeKey: "sub-1", ctx: { groupCode: "1" } });
    announceToGroups(db, config, "UPLOAD_NOTICE", { nome: "Ana", sala: "1", posicao: 1, aba: 1, fila: 1, url: "https://youtu.be/a" }, { dedupeKey: "sub-1", ctx: { groupCode: "1" } });
    expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get()).toEqual({ n: 1 });
  });

  it("QUEUE_OPEN vai para TODOS os grupos", () => {
    db.prepare("INSERT OR REPLACE INTO groups (code,enabled,whatsapp_group_id) VALUES ('2',1,'456@g.us')").run();
    const r = announceToGroups(db, config, "QUEUE_OPEN", { fila: 5, link: "https://sos.app" }, { dedupeKey: "round-5" });
    expect(r.queued).toBe(2);
  });

  it("automação desligada não anuncia", () => {
    saveAutomationSettings(db, "UPLOAD_NOTICE", { enabled: false }, { id: "root", name: "Root" });
    expect(announceToGroups(db, config, "UPLOAD_NOTICE", { nome: "Ana", sala: "1", posicao: 1, aba: 1, fila: 1, url: "x" }, { dedupeKey: "s", ctx: { groupCode: "1" } }).skipped).toBe("disabled");
  });
});
