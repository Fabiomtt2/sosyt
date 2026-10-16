// AUDITORIA / blindagem da carteira — o que o red team (Téo) encontrou e ficou aberto.
//
// Três furos distintos, com uma causa comum: a trava existe num caminho e não nos
// outros. Quem lê a API usa o caminho sem trava.
//
//  1. `payment_hold` (carteira em revisão por estorno/chargeback) só era checado em
//     `debitContribution`. Resgate, presente de moedas, presente de item e consumo
//     de Pular passavam direto — então, entre o estorno e a revisão do Owner, dava
//     para esvaziar a carteira em itens e presentes para um laranja. A revisão caía
//     no vazio.
//  2. O bônus de boas-vindas era chaveado pela EXISTÊNCIA de linha viva em `users`.
//     Como o apagamento troca o telefone por `deleted:<id>`, reentrar com o mesmo
//     número cria conta nova e recredita. O histórico certo (`account_deletions`)
//     A correção chaveia o bônus por uma referência derivada do TELEFONE.
//  3. DM não passava pelo filtro anti-link que o chat global aplica, e o
//     destinatário era um id arbitrário. Vira canal privado de spam/assédio.
//
// Aqui ficam as guardas puras e reutilizáveis; quem chama são as rotas.
import { createHash } from "node:crypto";
import type { AppDatabase } from "./db.js";

export class WalletGuardError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 409) {
    super(message);
    this.name = "WalletGuardError";
  }
}

/**
 * A carteira está em revisão de pagamento? Enquanto estiver, NENHUMA saída de valor
 * pode acontecer — nem contribuição, nem resgate, nem presente, nem consumo de item.
 * Entrada de valor continua livre: segurar o que a pessoa ganha seria punir sem culpa.
 */
export function paymentHoldActive(db: AppDatabase, userId: string): boolean {
  const row = db.prepare("SELECT payment_hold AS hold FROM wallets WHERE user_id=?").get(userId) as { hold: number } | undefined;
  return Boolean(row?.hold);
}

/** Lança se a carteira estiver em revisão. Use antes de QUALQUER saída de valor. */
export function assertNoPaymentHold(db: AppDatabase, userId: string) {
  if (paymentHoldActive(db, userId)) {
    throw new WalletGuardError("PAYMENT_HOLD",
      "Sua carteira está em revisão de pagamento. Enquanto isso, trocas, presentes e uso de itens ficam pausados. Nada foi perdido.");
  }
}

// ───────────────── Boas-vindas: uma vez por pessoa, não por linha ─────────────────

/**
 * Identidade durável derivada do telefone. Sobrevive a apagar e recriar conta, que é
 * exatamente o ciclo que duplicava o bônus. Hash (não o número cru) para a referência
 * do ledger não carregar dado pessoal.
 */
export function phoneIdentity(phone: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return createHash("sha256").update("sosyt-identity:" + digits).digest("hex").slice(0, 24);
}

/** Referência idempotente do bônus de boas-vindas, estável por telefone. */
export const welcomeReference = (phone: string) => "welcome:" + phoneIdentity(phone);

/**
 * Este telefone já recebeu boas-vindas alguma vez? A referência do ledger é derivada
 * do TELEFONE (não do id do usuário), então a linha de WELCOME sobrevive ao apagamento
 * da conta: recriar com o mesmo número reencontra o registro e NÃO recredita.
 *
 * Nota honesta de retrocompatibilidade: contas apagadas ANTES desta mudança gravaram
 * WELCOME com reference_id=NULL, e o apagamento substitui o telefone por `deleted:<id>`
 * — ou seja, não há como reassociar aquele bônus a um número. Esse resíduo histórico
 * (no máximo um bônus de boas-vindas por conta reaberta do período antigo) é aceito;
 * daqui em diante a duplicação está fechada.
 */
export function welcomeAlreadyGranted(db: AppDatabase, phone: string): boolean {
  const byReference = db.prepare("SELECT 1 FROM wallet_ledger WHERE kind='WELCOME' AND reference_id=?")
    .get(welcomeReference(phone));
  return Boolean(byReference);
}

// ───────────────── DM: mesmo cuidado do chat público ─────────────────

/**
 * O destinatário existe e está ativo? `toUserId` chegava como string livre, então
 * dava para mirar qualquer id colhido do payload do chat.
 */
export function assertRecipientActive(db: AppDatabase, toUserId: string) {
  const row = db.prepare("SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL").get(toUserId);
  if (!row) {
    throw new WalletGuardError("RECIPIENT_NOT_FOUND", "Não encontrei essa pessoa. Ela pode ter saído da comunidade.", 404);
  }
}

/** Ninguém presenteia nem escreve para si mesmo (lavagem e ruído). */
export function assertNotSelf(fromUserId: string, toUserId: string) {
  if (fromUserId === toUserId) {
    throw new WalletGuardError("SELF_TARGET", "Essa ação precisa de outra pessoa como destinatário.", 400);
  }
}
