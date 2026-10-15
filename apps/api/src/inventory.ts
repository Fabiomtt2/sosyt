// AUDITORIA / inventário: itens do usuário. Base do item "Pular" e dos presentes
// entre participantes. Toda mudança passa por item_grants (trilha auditável e
// idempotente por reference_id — mesmo princípio do wallet_ledger, que o motor
// já usa e que a auditoria verificou como sólido).
import { randomUUID } from "node:crypto";
import type { AppDatabase } from "./db.js";
import { isRootOwner } from "./super.js";

export const ITEM_SKIP = "SKIP";

export type GrantKind = "PURCHASE" | "GIFT_IN" | "GIFT_OUT" | "OWNER_ADJUST" | "CONSUME" | "REWARD" | "REWARD_EXCHANGE";

function err(statusCode: number, message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { statusCode, ...extra });
}

/**
 * AUDITORIA: o ROOT_OWNER possui TODOS os itens, atuais e futuros, em quantidade
 * ilimitada e sem gasto. Em vez de semear linhas (que precisariam ser atualizadas
 * a cada item novo), o saldo dele e derivado — qualquer item criado amanha ja
 * nasce disponivel. O ADMIN_OWNER nao tem esse privilegio.
 */
export const ROOT_ITEM_QUANTITY = Number.MAX_SAFE_INTEGER;

export function itemQuantity(db: AppDatabase, userId: string, itemCode: string): number {
  if (isRootOwner(db, userId)) return ROOT_ITEM_QUANTITY;
  const row = db.prepare("SELECT quantity FROM user_items WHERE user_id=? AND item_code=?").get(userId, itemCode) as { quantity: number } | undefined;
  return row?.quantity ?? 0;
}

export function listInventory(db: AppDatabase, userId: string) {
  return db.prepare("SELECT item_code AS itemCode, quantity FROM user_items WHERE user_id=? AND quantity>0 ORDER BY item_code")
    .all(userId) as Array<{ itemCode: string; quantity: number }>;
}

/**
 * Move itens. `delta` positivo credita, negativo debita. Nunca deixa negativo.
 * Com `referenceId`, a operação é idempotente: repetir não duplica.
 * Retorna false quando a operação já tinha sido aplicada (idempotência).
 */
export function grantItem(db: AppDatabase, input: {
  userId: string; itemCode: string; delta: number; kind: GrantKind; referenceId?: string; note?: string;
}): boolean {
  const { userId, itemCode, delta, kind, referenceId, note } = input;
  if (!Number.isInteger(delta) || delta === 0) throw err(400, "Quantidade inválida.");
  // O saldo do ROOT e derivado (ilimitado); somar delta a ele estouraria o numero.
  // Nao gravamos linha para o ROOT — ele nunca ganha nem gasta.
  if (isRootOwner(db, userId)) return true;
  return db.transaction(() => {
    if (referenceId) {
      const already = db.prepare("SELECT 1 FROM item_grants WHERE user_id=? AND kind=? AND reference_id=?").get(userId, kind, referenceId);
      if (already) return false;
    }
    const now = new Date().toISOString();
    const current = itemQuantity(db, userId, itemCode);
    const next = current + delta;
    if (next < 0) throw err(409, "Você não tem esse item disponível.", { code: "ITEM_INSUFFICIENT" });
    db.prepare(`INSERT INTO user_items (user_id,item_code,quantity,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(user_id,item_code) DO UPDATE SET quantity=excluded.quantity,updated_at=excluded.updated_at`)
      .run(userId, itemCode, next, now);
    db.prepare("INSERT INTO item_grants (id,user_id,item_code,delta,kind,reference_id,note,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(randomUUID(), userId, itemCode, delta, kind, referenceId ?? null, note ?? null, now);
    return true;
  })();
}

/** Consome 1 unidade. Lança 409 se não houver. */
export function consumeItem(db: AppDatabase, userId: string, itemCode: string, referenceId?: string): void {
  if (isRootOwner(db, userId)) return;   // ROOT usa sem gastar
  const applied = grantItem(db, { userId, itemCode, delta: -1, kind: "CONSUME", referenceId, note: `Uso de ${itemCode}` });
  if (!applied) throw err(409, "Esta ação já foi registrada.", { code: "ALREADY_APPLIED" });
}

/**
 * Presente entre participantes: debita do remetente e credita no destinatário
 * numa única transação, com a MESMA referência nos dois lados (rastreável).
 */
export function giftItem(db: AppDatabase, fromUserId: string, toUserId: string, itemCode: string, quantity = 1,rootAccess=false,referenceId?:string) {
  if (fromUserId === toUserId) throw err(400, "Você não pode presentear a si mesmo.");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw err(400, "Quantidade inválida.");
  const recipient = db.prepare("SELECT id FROM users WHERE id=? AND deleted_at IS NULL").get(toUserId);
  if (!recipient) throw err(404, "Destinatário não encontrado.");
  const reference = referenceId??randomUUID();
  const unlimited=rootAccess||isRootOwner(db,fromUserId);
  return db.transaction(() => {
    const previous=db.prepare("SELECT item_code AS itemCode,delta,note FROM item_grants WHERE user_id=? AND kind='GIFT_OUT' AND reference_id=?").get(fromUserId,reference) as {itemCode:string;delta:number;note:string}|undefined;
    if(previous){
      if(previous.itemCode!==itemCode||previous.delta!==-quantity||!previous.note.endsWith("para "+toUserId)) throw err(409,"Este presente já foi registrado com outros dados.");
      return {reference,itemCode,quantity};
    }
    if(!unlimited) grantItem(db, { userId: fromUserId, itemCode, delta: -quantity, kind: "GIFT_OUT", referenceId: reference, note: `Presente para ${toUserId}` });
    if(unlimited) db.prepare("INSERT INTO item_grants (id,user_id,item_code,delta,kind,reference_id,note,created_at) VALUES (?,?,?,?,?,?,?,?)").run(randomUUID(),fromUserId,itemCode,-quantity,"GIFT_OUT",reference,"Presente ROOT_OWNER para "+toUserId,new Date().toISOString());
    grantItem(db, { userId: toUserId, itemCode, delta: quantity, kind: "GIFT_IN", referenceId: reference, note: `Presente de ${fromUserId}` });
    return { reference, itemCode, quantity };
  })();
}
