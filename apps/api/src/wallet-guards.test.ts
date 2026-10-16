// AUDITORIA / testes das guardas de carteira (furos do Teo: B2 payment_hold, B5 WELCOME, B6 destinatario).
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "./db.js";
import {
  WalletGuardError, assertNoPaymentHold, assertNotSelf, assertRecipientActive,
  paymentHoldActive, phoneIdentity, welcomeAlreadyGranted, welcomeReference,
} from "./wallet-guards.js";

let db: AppDatabase;
beforeEach(() => {
  db = new Database(":memory:") as AppDatabase;
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, phone TEXT, deleted_at TEXT);
    CREATE TABLE wallets (user_id TEXT PRIMARY KEY, payment_hold INTEGER DEFAULT 0);
    CREATE TABLE wallet_ledger (id TEXT PRIMARY KEY, user_id TEXT, kind TEXT, amount_millis INTEGER, reference_id TEXT, created_at TEXT);`);
});

describe("B2 — carteira em revisão não deixa valor sair", () => {
  it("assertNoPaymentHold bloqueia quando payment_hold=1", () => {
    db.prepare("INSERT INTO wallets(user_id,payment_hold) VALUES('u1',1)").run();
    expect(paymentHoldActive(db, "u1")).toBe(true);
    expect(() => assertNoPaymentHold(db, "u1")).toThrow(WalletGuardError);
    try { assertNoPaymentHold(db, "u1"); } catch (e) {
      expect((e as WalletGuardError).code).toBe("PAYMENT_HOLD");
      expect((e as WalletGuardError).statusCode).toBe(409);
    }
  });

  it("carteira sem revisão passa livre", () => {
    db.prepare("INSERT INTO wallets(user_id,payment_hold) VALUES('u1',0)").run();
    expect(() => assertNoPaymentHold(db, "u1")).not.toThrow();
  });
});

describe("B5 — boas-vindas uma vez por PESSOA, não por linha", () => {
  it("a referência é derivada do telefone e é estável", () => {
    expect(welcomeReference("+55 71 99395-1582")).toBe(welcomeReference("5571993951582"));
    expect(phoneIdentity("+5571993951582")).toMatch(/^[0-9a-f]{24}$/);
  });

  it("recriar conta com o mesmo telefone NÃO recredita", () => {
    const phone = "5571993951582";
    // conta antiga recebeu WELCOME com a referência durável
    db.prepare("INSERT INTO wallet_ledger(id,user_id,kind,amount_millis,reference_id,created_at) VALUES('l1','velho','WELCOME',10000,?,?)")
      .run(welcomeReference(phone), "2026-01-01");
    // conta foi apagada (telefone vira tombstone), reentra como novo id
    expect(welcomeAlreadyGranted(db, phone)).toBe(true);   // já ganhou — não credita de novo
  });

  it("telefone que nunca ganhou é creditado", () => {
    expect(welcomeAlreadyGranted(db, "5571900000000")).toBe(false);
  });
});

describe("B6 — destinatário de presente/DM precisa existir e não ser você", () => {
  it("rejeita presentear a si mesmo", () => {
    expect(() => assertNotSelf("u1", "u1")).toThrow(/outra pessoa/);
  });

  it("rejeita destinatário inexistente ou apagado", () => {
    db.prepare("INSERT INTO users(id,phone,deleted_at) VALUES('u2','x','2026-01-01')").run();
    expect(() => assertRecipientActive(db, "u2")).toThrow(/não encontrei/i);
    expect(() => assertRecipientActive(db, "fantasma")).toThrow(WalletGuardError);
  });

  it("aceita destinatário ativo", () => {
    db.prepare("INSERT INTO users(id,phone,deleted_at) VALUES('u2','x',NULL)").run();
    expect(() => assertRecipientActive(db, "u2")).not.toThrow();
  });
});
