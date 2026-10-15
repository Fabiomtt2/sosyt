import type { AppDatabase } from "./db.js";
/** Receipt of applied benefits. Later catalog edits cannot change this history. */
export function paymentReceipt(db:AppDatabase,userId:string,paymentId:string) {
  const payment=db.prepare(`SELECT p.id,p.product_code AS productCode,p.amount_cents AS amountCents,
    p.credits_millis AS creditsMillis,p.extra_passes AS extraPasses,p.approved_at AS approvedAt
    FROM payments p WHERE p.id=? AND p.user_id=? AND p.status='APPROVED'
    AND EXISTS(SELECT 1 FROM wallet_ledger l WHERE l.user_id=p.user_id AND l.reference_id=p.id AND l.kind='PIX_PURCHASE')`)
    .get(paymentId,userId) as {id:string;productCode:string;amountCents:number;creditsMillis:number;extraPasses:number;approvedAt:string}|undefined;
  if(!payment)return undefined;
  const items=db.prepare("SELECT item_code AS itemCode,delta AS quantity FROM item_grants WHERE user_id=? AND reference_id=? AND kind='PURCHASE' AND delta>0")
    .all(userId,paymentId) as Array<{itemCode:string;quantity:number}>;
  const subscription=db.prepare("SELECT days FROM super_events WHERE user_id=? AND reference_id=? AND kind='GRANT'")
    .get(userId,paymentId) as {days:number}|undefined;
  return {userId,paymentId:payment.id,productCode:payment.productCode,amountCents:payment.amountCents,
    approvedAt:payment.approvedAt,credits:payment.creditsMillis/1000,extraPasses:payment.extraPasses,
    items,subscriptionDays:subscription?.days??0};
}
