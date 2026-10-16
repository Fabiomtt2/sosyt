// AUDITORIA / testes do escalonamento humano.
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "./db.js";
import {
  DEFAULT_HUMAN_SUPPORT, humanHandoffAlert, humanHandoffUserReply,
  humanSupportNumber, setHumanSupportNumber,
} from "./bot-human-handoff.js";

let db: AppDatabase;
beforeEach(() => {
  db = new Database(":memory:") as AppDatabase;
  db.exec("CREATE TABLE integration_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);");
});

describe("número humano configurável", () => {
  it("usa o default business quando nada foi configurado", () => {
    expect(humanSupportNumber(db)).toBe(DEFAULT_HUMAN_SUPPORT);
  });

  it("o Owner pode trocar, e fica só com dígitos", () => {
    const saved = setHumanSupportNumber(db, "+55 71 99333-2391");
    expect(saved).toBe("5571993332391");
    expect(humanSupportNumber(db)).toBe("5571993332391");
  });

  it("recusa número inválido", () => {
    expect(() => setHumanSupportNumber(db, "123")).toThrow(/DDI, DDD/);
  });

  it("não quebra se a tabela não existir", () => {
    const bare = new Database(":memory:") as AppDatabase;
    expect(humanSupportNumber(bare)).toBe(DEFAULT_HUMAN_SUPPORT);
  });
});

describe("resposta ao usuário é acolhedora e não manda clicar em nada", () => {
  it("usa o primeiro nome quando há", () => {
    const reply = humanHandoffUserReply("Maria Silva");
    expect(reply).toMatch(/Maria/);
    expect(reply).toMatch(/pessoa de verdade/);
    expect(reply).not.toMatch(/https?:\/\//);   // o usuário NÃO recebe link/popup
  });

  it("funciona sem nome", () => {
    expect(humanHandoffUserReply()).toMatch(/Pode deixar comigo!/);
  });
});

describe("aviso ao número humano traz o link da pessoa", () => {
  it("monta o wa.me do usuário e inclui o assunto", () => {
    const alert = humanHandoffAlert({ name: "João", userPhone: "+55 71 98888-7777", lastMessage: "não consigo entrar na fila" });
    expect(alert).toMatch(/wa\.me\/5571988887777/);
    expect(alert).toMatch(/João/);
    expect(alert).toMatch(/não consigo entrar na fila/);
  });

  it("tem fallback de nome e funciona sem assunto", () => {
    const alert = humanHandoffAlert({ userPhone: "5571988887777" });
    expect(alert).toMatch(/Participante/);
    expect(alert).not.toMatch(/O que a pessoa disse/);
  });

  it("trunca assunto gigante", () => {
    const alert = humanHandoffAlert({ userPhone: "5571988887777", lastMessage: "x".repeat(1000) });
    expect(alert.length).toBeLessThan(600);
  });
});
