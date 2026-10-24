// AUDITORIA / gostei e nao gostei: sinal da comunidade, nunca moeda de progresso.
import { blockSocialUser } from "./social.js";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "./db.js";
import { react, summary, summaryForRound, ReactionError } from "./submission-reactions.js";
import { awardContributionXp, CONTRIBUTION_XP } from "./gamification.js";
import { initializeGamification } from "./gamification.js";

describe("reações nos vídeos da fila", () => {
  let db: AppDatabase; const autor = randomUUID(), ana = randomUUID(), bruno = randomUUID();
  let roundId: string, subId: string;
  beforeEach(() => {
    db = createDatabase(":memory:"); initializeGamification(db);
    const stamp = new Date().toISOString();
    for (const [id, nome, tel] of [[autor, "Autor", "5571900000001"], [ana, "Ana", "5571900000002"], [bruno, "Bruno", "5571900000003"]] as const) {
      db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,?,?,'1',?,?)").run(id, nome, tel, stamp, stamp);
      db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES(?,?)").run(id, stamp);
    }
    roundId = (db.prepare("SELECT id FROM rounds LIMIT 1").get() as { id: string }).id;
    subId = randomUUID();
    db.prepare(`INSERT INTO submissions (id,round_id,slot,user_id,youtube_url,video_id,created_at,author_name,author_group)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(subId, roundId, 1, autor, "https://youtu.be/abc", "abc", stamp, "Autor", "1");
  });

  it("conta e mostra QUEM gostou e QUEM não gostou", () => {
    react(db, subId, ana, "LIKE");
    react(db, subId, bruno, "DISLIKE");
    const s = summary(db, subId);
    expect(s.likes).toBe(1); expect(s.dislikes).toBe(1);
    expect(s.quemGostou.map(p => p.name)).toEqual(["Ana"]);
    expect(s.quemNaoGostou.map(p => p.name)).toEqual(["Bruno"]);
  });

  it("tocar no mesmo botão desfaz; tocar no outro troca", () => {
    react(db, subId, ana, "LIKE");
    expect(react(db, subId, ana, "LIKE").kind).toBeNull();          // desfez
    expect(summary(db, subId).likes).toBe(0);
    react(db, subId, ana, "LIKE");
    expect(react(db, subId, ana, "DISLIKE").kind).toBe("DISLIKE");  // trocou
    const s = summary(db, subId);
    expect(s.likes).toBe(0); expect(s.dislikes).toBe(1);            // nunca conta nos dois
  });

  it("devolve a seleção atual no envio, na troca e na remoção", () => {
    expect(react(db, subId, ana, "LIKE").minhaReacao).toBe("LIKE");
    expect(summary(db, subId, ana).minhaReacao).toBe("LIKE");
    expect(react(db, subId, ana, "DISLIKE").minhaReacao).toBe("DISLIKE");
    expect(react(db, subId, ana, "DISLIKE").minhaReacao).toBeNull();
  });

  it("bloqueio impede reação nos dois sentidos sem alterar o histórico", () => {
    react(db, subId, ana, "LIKE");
    blockSocialUser(db, autor, ana);
    expect(() => react(db, subId, ana, "DISLIKE")).toThrow(/interação não está disponível/);
    expect(summary(db, subId, autor).likes).toBe(0);
    expect(summary(db, subId, bruno).likes).toBe(1);
    expect(summaryForRound(db, roundId, autor)[subId].quemGostou).toEqual([]);
    expect(db.prepare("SELECT kind FROM submission_reactions WHERE submission_id=? AND user_id=?").get(subId, ana)).toEqual({kind:"LIKE"});
    blockSocialUser(db, bruno, autor);
    expect(() => react(db, subId, bruno, "LIKE")).toThrow(/interação não está disponível/);
  });

  it("ninguém reage ao próprio vídeo", () => {
    expect(() => react(db, subId, autor, "LIKE")).toThrowError(ReactionError);
    try { react(db, subId, autor, "LIKE"); } catch (e) { expect(e).toMatchObject({ code: "OWN_SUBMISSION", statusCode: 409 }); }
  });

  // AUDITORIA / o dono decidiu que reagir DA XP. Eu havia levantado o risco de farm;
  // ele reafirmou. O desenho preserva a intencao sem o abuso: a referencia do XP e o
  // VIDEO, entao alternar like/deslike no mesmo video paga uma vez so.
  it("reagir dá XP, mas uma vez por vídeo — alternar não vira máquina de XP", () => {
    const xp = () => (db.prepare("SELECT COALESCE(SUM(xp_delta),0) AS xp FROM gamification_events WHERE user_id=? AND kind='CONTRIBUTION_XP'").get(ana) as { xp: number }).xp;
    awardContributionXp(db, ana, "REACTION", subId, { kind: "LIKE" });
    expect(xp()).toBe(CONTRIBUTION_XP.REACTION);
    for (let i = 0; i < 5; i++) awardContributionXp(db, ana, "REACTION", subId, { kind: "DISLIKE" });
    expect(xp(), "cinco trocas no mesmo vídeo não podem pagar de novo").toBe(CONTRIBUTION_XP.REACTION);
  });

  it("reagir a OUTRO vídeo paga de novo — é contribuição nova", () => {
    const outro = randomUUID(), stamp = new Date().toISOString();
    db.prepare(`INSERT INTO submissions (id,round_id,slot,user_id,youtube_url,video_id,created_at,author_name,author_group)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(outro, roundId, 2, bruno, "https://youtu.be/def", "def", stamp, "Bruno", "1");
    awardContributionXp(db, ana, "REACTION", subId, {});
    awardContributionXp(db, ana, "REACTION", outro, {});
    const xp = (db.prepare("SELECT COALESCE(SUM(xp_delta),0) AS xp FROM gamification_events WHERE user_id=? AND kind='CONTRIBUTION_XP'").get(ana) as { xp: number }).xp;
    expect(xp).toBe(CONTRIBUTION_XP.REACTION * 2);
  });

  it("participar do chat dá XP, uma vez por mensagem", () => {
    awardContributionXp(db, ana, "CHAT", "msg-1", {});
    awardContributionXp(db, ana, "CHAT", "msg-1", {});     // reenvio do mesmo id
    awardContributionXp(db, ana, "CHAT", "msg-2", {});
    const xp = (db.prepare("SELECT COALESCE(SUM(xp_delta),0) AS xp FROM gamification_events WHERE user_id=? AND kind='CONTRIBUTION_XP'").get(ana) as { xp: number }).xp;
    expect(xp).toBe(CONTRIBUTION_XP.CHAT * 2);
  });

  it("contribuir de verdade continua valendo muito mais que reagir", () => {
    expect(CONTRIBUTION_XP.SUBMISSION).toBeGreaterThanOrEqual(CONTRIBUTION_XP.REACTION * 50);
  });

  it("o resumo da fila traz a reação de quem está olhando", () => {
    react(db, subId, ana, "LIKE");
    expect(summaryForRound(db, roundId, ana)[subId]).toMatchObject({ likes: 1, minhaReacao: "LIKE" });
    expect(summaryForRound(db, roundId, bruno)[subId]).toMatchObject({ likes: 1, minhaReacao: null });
  });
});

describe("XP por contribuição, não por ser vigiado", () => {
  let db: AppDatabase; const pessoa = randomUUID();
  beforeEach(() => {
    db = createDatabase(":memory:"); initializeGamification(db);
    const stamp = new Date().toISOString();
    db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,?,?,'1',?,?)").run(pessoa, "Ana", "5571900000009", stamp, stamp);
    db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES(?,?)").run(pessoa, stamp);
  });
  const xp = () => (db.prepare("SELECT COALESCE(SUM(xp_delta),0) AS xp FROM gamification_events WHERE user_id=?").get(pessoa) as { xp: number }).xp;

  it("enviar vídeo, fazer amizade e comprar item pontuam", () => {
    expect(awardContributionXp(db, pessoa, "SUBMISSION", "sub-1").xpDelta).toBe(CONTRIBUTION_XP.SUBMISSION);
    expect(awardContributionXp(db, pessoa, "FRIEND", "amiz-1").xpDelta).toBe(CONTRIBUTION_XP.FRIEND);
    expect(awardContributionXp(db, pessoa, "PURCHASE", "pay-1").xpDelta).toBe(CONTRIBUTION_XP.PURCHASE);
    expect(xp()).toBe(CONTRIBUTION_XP.SUBMISSION + CONTRIBUTION_XP.FRIEND + CONTRIBUTION_XP.PURCHASE);
  });

  it("a MESMA contribuição nunca paga duas vezes", () => {
    awardContributionXp(db, pessoa, "SUBMISSION", "sub-1");
    const depoisDaPrimeira = xp();
    expect(awardContributionXp(db, pessoa, "SUBMISSION", "sub-1").xpDelta).toBe(0);
    expect(xp()).toBe(depoisDaPrimeira);
  });

  it("contribuir faz SUBIR DE NÍVEL (antes o nível só vinha do tempo de vídeo)", () => {
    for (let i = 0; i < 3; i++) awardContributionXp(db, pessoa, "SUBMISSION", "sub-" + i);
    const nivel = (db.prepare("SELECT level FROM gamification_users WHERE user_id=?").get(pessoa) as { level: number }).level;
    expect(nivel, "300 XP de contribuição precisa valer nível").toBeGreaterThan(1);
  });
});
