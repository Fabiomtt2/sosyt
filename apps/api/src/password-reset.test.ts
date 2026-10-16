// AUDITORIA / testes da troca de senha com consentimento do titular.
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDatabase } from "./db.js";
import {
  PasswordResetError, RESET_CODE_TTL_MINUTES, RESET_MAX_ATTEMPTS,
  createPasswordReset, ensurePasswordResets, markResetDelivered,
  passwordResetHistory, passwordResetStatus, resetMessage, verifyPasswordReset,
} from "./password-reset.js";

const PHONE = "5571993951582";
const OWNER = { id: "oa-1", name: "Fábio" };
let db: AppDatabase;
beforeEach(() => { db = new Database(":memory:") as AppDatabase; ensurePasswordResets(db); });

describe("solicitação pelo Owner", () => {
  it("gera código de 6 dígitos com validade curta", () => {
    const req = createPasswordReset(db, PHONE, "OWNER", OWNER);
    expect(req.code).toMatch(/^\d{6}$/);
    const minutes = (Date.parse(req.expiresAt) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(RESET_CODE_TTL_MINUTES - 1);
    expect(minutes).toBeLessThanOrEqual(RESET_CODE_TTL_MINUTES);
  });

  it("o código NÃO fica recuperável no banco (só o hash)", () => {
    const req = createPasswordReset(db, PHONE, "OWNER", OWNER);
    const row = db.prepare("SELECT code_hash AS h FROM password_resets WHERE phone=?").get(PHONE) as { h: string };
    expect(row.h).not.toBe(req.code);
    expect(row.h).toMatch(/^[0-9a-f]{64}$/);
    // nenhuma coluna guarda o código em claro
    const columns = db.prepare("PRAGMA table_info(password_resets)").all() as Array<{ name: string }>;
    expect(columns.map((c) => c.name)).not.toContain("code");
  });

  it("registra QUEM pediu — troca de senha nunca é silenciosa", () => {
    createPasswordReset(db, PHONE, "OWNER", OWNER);
    const history = passwordResetHistory(db, PHONE);
    expect(history[0]).toMatchObject({ event: "REQUESTED_BY_OWNER", actorName: "Fábio" });
  });

  it("pedir de novo invalida o anterior", () => {
    const first = createPasswordReset(db, PHONE, "OWNER", OWNER);
    createPasswordReset(db, PHONE, "OWNER", OWNER);
    expect(() => verifyPasswordReset(db, PHONE, first.code)).toThrow(PasswordResetError);
  });
});

describe("confirmação pelo titular", () => {
  it("o código correto é aceito uma única vez", () => {
    const req = createPasswordReset(db, PHONE, "SELF");
    expect(verifyPasswordReset(db, PHONE, req.code)).toEqual({ ok: true });
    expect(() => verifyPasswordReset(db, PHONE, req.code)).toThrow(/Não há pedido/);
  });

  it("código errado é recusado e conta tentativa", () => {
    createPasswordReset(db, PHONE, "OWNER", OWNER);
    expect(() => verifyPasswordReset(db, PHONE, "000001")).toThrow(/incorreto/);
    const row = db.prepare("SELECT attempts FROM password_resets WHERE phone=?").get(PHONE) as { attempts: number };
    expect(row.attempts).toBe(1);
  });

  it("trava após tentativas demais (não vira força bruta de 6 dígitos)", () => {
    const req = createPasswordReset(db, PHONE, "OWNER", OWNER);
    for (let i = 0; i < RESET_MAX_ATTEMPTS; i++) {
      expect(() => verifyPasswordReset(db, PHONE, "999999")).toThrow();
    }
    // mesmo o código CERTO não passa depois do bloqueio
    expect(() => verifyPasswordReset(db, PHONE, req.code)).toThrow(/Muitas tentativas/);
  });

  it("código expirado é recusado", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
      const req = createPasswordReset(db, PHONE, "OWNER", OWNER);
      vi.setSystemTime(new Date("2026-10-16T10:20:00Z"));   // 20 min depois
      expect(() => verifyPasswordReset(db, PHONE, req.code)).toThrow(/expirou/);
    } finally { vi.useRealTimers(); }
  });

  it("formato inválido é recusado sem consultar hash", () => {
    createPasswordReset(db, PHONE, "OWNER", OWNER);
    expect(() => verifyPasswordReset(db, PHONE, "abc")).toThrow(/incorreto/);
  });

  it("sem pedido não há o que confirmar", () => {
    expect(() => verifyPasswordReset(db, "5571900000000", "123456")).toThrow(/Não há pedido/);
  });
});

describe("o que o painel enxerga", () => {
  it("mostra ESTADO, nunca o segredo", () => {
    createPasswordReset(db, PHONE, "OWNER", OWNER);
    const status = passwordResetStatus(db, PHONE);
    expect(status.state).toBe("PENDING");
    expect(JSON.stringify(status)).not.toMatch(/\b\d{6}\b/);   // nenhum código vazando
    expect(status).toMatchObject({ requestedBy: "OWNER", requestedByName: "Fábio" });
  });

  it("vira USED depois da confirmação", () => {
    const req = createPasswordReset(db, PHONE, "SELF");
    verifyPasswordReset(db, PHONE, req.code);
    expect(passwordResetStatus(db, PHONE).state).toBe("USED");
  });

  it("sem histórico, estado NONE", () => {
    expect(passwordResetStatus(db, "5571900000000")).toEqual({ state: "NONE" });
  });

  it("registra entrega e falha de entrega", () => {
    const req = createPasswordReset(db, PHONE, "OWNER", OWNER);
    markResetDelivered(db, req.id, true);
    expect(passwordResetStatus(db, PHONE).delivered).toBe(true);
    expect(passwordResetHistory(db, PHONE).some((h) => h.event === "CODE_DELIVERED")).toBe(true);
  });
});

describe("trilha de auditoria é append-only", () => {
  it("não dá para alterar nem apagar o registro", () => {
    createPasswordReset(db, PHONE, "OWNER", OWNER);
    expect(() => db.prepare("UPDATE password_reset_audit SET actor_owner_name='outro'").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM password_reset_audit").run()).toThrow(/append-only/);
  });
});

describe("mensagem ao titular", () => {
  it("explica a origem, traz o código e avisa sobre golpe", () => {
    const text = resetMessage("123456", true, "https://sosyoutuber.app");
    expect(text).toContain("123456");
    expect(text).toMatch(/equipe do SOS YOUTUBER iniciou/);
    expect(text).toMatch(/nunca vamos pedir esse código de volta/i);   // pedido do Seu Jorge
    expect(text).toMatch(/HUMANO/);                                    // caminho de socorro
  });

  it("distingue pedido do próprio titular", () => {
    expect(resetMessage("123456", false, "x")).toMatch(/Você pediu/);
  });
});
