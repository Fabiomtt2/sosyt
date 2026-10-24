// AUDITORIA / GOSTEI E NAO GOSTEI NAS FILAS — DENTRO DE CASA, SO.
//
// Pedido do dono: um botao de like/deslike nos videos da fila "interferindo apenas no
// proprio sistema sem implicação externa", e poder ver QUEM reagiu a cada URL.
//
// Duas decisoes que vale registrar:
//
// 1) Nada sai daqui para o YouTube. Nenhuma chamada, nenhum like remoto. O projeto
//    inteiro se sustenta na promessa de "sem views automaticas, sem reproducao
//    oculta" — mandar like para fora quebraria isso e poria os canais em risco.
//
// 2) Reagir NAO da XP. Seria farmavel com um toque e distorceria o ranking. A
//    reacao e sinal da comunidade, nao moeda de progresso.
//
// A autoria e aberta de proposito (o dono pediu para ver quem deu like e quem deu
// deslike): numa comunidade pequena, reacao anonima vira ferramenta de sabotagem.
// Assumir o que se curte mantem o ambiente responsavel.
import type { AppDatabase } from "./db.js";
import { assertSocialInteractionAllowed, isSocialBlocked } from "./social-blocks.js";

export type ReactionKind = "LIKE" | "DISLIKE";

export function ensureSubmissionReactions(db: AppDatabase) {
  db.exec(`CREATE TABLE IF NOT EXISTS submission_reactions (
    submission_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('LIKE','DISLIKE')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (submission_id,user_id)
  );`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_submission_reactions_sub ON submission_reactions(submission_id);");
}

export class ReactionError extends Error {
  readonly statusCode = 409;
  constructor(readonly code: "SUBMISSION_NOT_FOUND" | "OWN_SUBMISSION", message: string) {
    super(message); this.name = "ReactionError";
  }
}

/**
 * Registra, troca ou remove a reacao. Tocar no mesmo botao duas vezes desfaz — e o
 * que a pessoa espera, e evita que um toque acidental fique permanente.
 */
export function react(db: AppDatabase, submissionId: string, userId: string, kind: ReactionKind) {
  ensureSubmissionReactions(db);
  const sub = db.prepare("SELECT user_id AS autor FROM submissions WHERE id=?").get(submissionId) as { autor: string } | undefined;
  if (!sub) throw new ReactionError("SUBMISSION_NOT_FOUND", "Este vídeo não está mais na fila.");
  // Ninguem vota no proprio video: seria ruido garantido no sinal da comunidade.
  if (sub.autor === userId) throw new ReactionError("OWN_SUBMISSION", "Você não pode reagir ao próprio vídeo.");
  assertSocialInteractionAllowed(db, userId, sub.autor);
  const stamp = new Date().toISOString();
  return db.transaction(() => {
    const atual = db.prepare("SELECT kind FROM submission_reactions WHERE submission_id=? AND user_id=?").get(submissionId, userId) as { kind: ReactionKind } | undefined;
    if (atual?.kind === kind) {
      db.prepare("DELETE FROM submission_reactions WHERE submission_id=? AND user_id=?").run(submissionId, userId);
      return { kind: null as ReactionKind | null, ...summary(db, submissionId, userId) };
    }
    db.prepare(`INSERT INTO submission_reactions (submission_id,user_id,kind,created_at,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(submission_id,user_id) DO UPDATE SET kind=excluded.kind,updated_at=excluded.updated_at`)
      .run(submissionId, userId, kind, stamp, stamp);
    return { kind, ...summary(db, submissionId, userId) };
  })();
}

/** Contagem e AUTORIA das reacoes de um video (o dono pediu para ver quem reagiu). */
export function summary(db: AppDatabase, submissionId: string, viewerId?: string) {
  ensureSubmissionReactions(db);
  // Avatar nao vem daqui de proposito: ele vive em tabela propria e ja tem rota
  // dedicada. Repetir a imagem em cada reacao incharia a resposta sem necessidade.
  const rows = db.prepare(`SELECT r.kind, r.user_id AS userId, u.name
    FROM submission_reactions r JOIN users u ON u.id=r.user_id
    WHERE r.submission_id=? AND u.deleted_at IS NULL ORDER BY r.updated_at DESC`)
    .all(submissionId) as Array<{ kind: ReactionKind; userId: string; name: string }>;
  const visibleRows = viewerId ? rows.filter(row => !isSocialBlocked(db, viewerId, row.userId)) : rows;
  return {
    minhaReacao: viewerId ? (visibleRows.find(row => row.userId === viewerId)?.kind ?? null) : null,
    likes: visibleRows.filter((r) => r.kind === "LIKE").length,
    dislikes: visibleRows.filter((r) => r.kind === "DISLIKE").length,
    quemGostou: visibleRows.filter((r) => r.kind === "LIKE").map(({ userId, name }) => ({ userId, name })),
    quemNaoGostou: visibleRows.filter((r) => r.kind === "DISLIKE").map(({ userId, name }) => ({ userId, name })),
  };
}

/** Resumo de uma fila inteira, para a tela montar tudo numa requisicao so. */
export function summaryForRound(db: AppDatabase, roundId: string, viewerId: string) {
  ensureSubmissionReactions(db);
  const subs = db.prepare("SELECT id FROM submissions WHERE round_id=?").all(roundId) as Array<{ id: string }>;
  return Object.fromEntries(subs.map(({ id }) => {
    const minha = db.prepare("SELECT kind FROM submission_reactions WHERE submission_id=? AND user_id=?").get(id, viewerId) as { kind: ReactionKind } | undefined;
    return [id, { ...summary(db, id, viewerId), minhaReacao: minha?.kind ?? null }];
  }));
}
