// AUDITORIA / blindagem — testa que as trilhas append-only não podem ser adulteradas.
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "./db.js";
import { APPEND_ONLY_TABLES, ensureLedgerIntegrity } from "./ledger-integrity.js";

let db: AppDatabase;
beforeEach(() => {
  db = new Database(":memory:") as AppDatabase;
  db.exec(`CREATE TABLE wallet_ledger (id TEXT PRIMARY KEY, user_id TEXT, kind TEXT,
    amount_millis INTEGER, reference_id TEXT, actor_owner_name TEXT, created_at TEXT);`);
  db.exec("CREATE TABLE super_events (id TEXT PRIMARY KEY, user_id TEXT, kind TEXT, days INTEGER);");
});

describe("integridade das trilhas append-only", () => {
  it("INSERT continua funcionando (o rastro é escrito normalmente)", () => {
    ensureLedgerIntegrity(db);
    expect(() => db.prepare("INSERT INTO wallet_ledger (id,user_id,kind,amount_millis,created_at) VALUES ('1','u','WELCOME',10000,'now')").run())
      .not.toThrow();
    expect((db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger").get() as { n: number }).n).toBe(1);
  });

  it("UPDATE é abortado — ninguém reescreve um lançamento", () => {
    ensureLedgerIntegrity(db);
    db.prepare("INSERT INTO wallet_ledger (id,user_id,kind,amount_millis,actor_owner_name,created_at) VALUES ('1','u','ADJUST',1000,'Fulano','now')").run();
    expect(() => db.prepare("UPDATE wallet_ledger SET amount_millis=999999 WHERE id='1'").run())
      .toThrow(/append-only/);
    expect(() => db.prepare("UPDATE wallet_ledger SET actor_owner_name='Outro' WHERE id='1'").run())
      .toThrow(/append-only/);
    // o valor original permanece intacto
    expect((db.prepare("SELECT amount_millis AS a FROM wallet_ledger WHERE id='1'").get() as { a: number }).a).toBe(1000);
  });

  it("DELETE é abortado — ninguém apaga a prova", () => {
    ensureLedgerIntegrity(db);
    db.prepare("INSERT INTO wallet_ledger (id,user_id,kind,amount_millis,created_at) VALUES ('1','u','WELCOME',10000,'now')").run();
    expect(() => db.prepare("DELETE FROM wallet_ledger WHERE id='1'").run()).toThrow(/append-only/);
    expect((db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger").get() as { n: number }).n).toBe(1);
  });

  it("protege também super_events", () => {
    ensureLedgerIntegrity(db);
    db.prepare("INSERT INTO super_events (id,user_id,kind,days) VALUES ('1','u','GRANT',30)").run();
    expect(() => db.prepare("DELETE FROM super_events WHERE id='1'").run()).toThrow(/append-only/);
  });

  it("é idempotente e pula tabela inexistente sem quebrar", () => {
    const first = ensureLedgerIntegrity(db);
    expect(first.protected).toContain("wallet_ledger");
    expect(first.protected).not.toContain("item_grants");   // tabela não criada neste teste
    expect(() => ensureLedgerIntegrity(db)).not.toThrow();   // segunda chamada ok
  });

  it("a lista cobre as cinco trilhas sensíveis", () => {
    expect(APPEND_ONLY_TABLES).toEqual([
      "wallet_ledger", "super_events", "item_grants",
      "gamification_config_audit", "bot_automation_audit",
    ]);
  });
});
