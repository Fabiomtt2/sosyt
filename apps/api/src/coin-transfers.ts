import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";
import { assertRootCommunityActor, assertSocialInteractionAllowed, communityConfig, notifyCommunity } from "./social.js";

function fail(statusCode:number,message:string,code:string):never {
  throw Object.assign(new Error(message),{statusCode,code});
}
export function ensureCoinTransferSchema(db:AppDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coin_transfers (
      id TEXT PRIMARY KEY,from_user_id TEXT NOT NULL REFERENCES users(id),to_user_id TEXT NOT NULL REFERENCES users(id),
      reference_id TEXT NOT NULL,amount_millis INTEGER NOT NULL CHECK(amount_millis>0),
      reward_millis INTEGER NOT NULL CHECK(reward_millis>=0),
      purchased_millis INTEGER NOT NULL CHECK(purchased_millis>=0),created_at TEXT NOT NULL,
      CHECK(from_user_id<>to_user_id),CHECK(amount_millis=reward_millis+purchased_millis),
      UNIQUE(from_user_id,reference_id)
    );
    CREATE INDEX IF NOT EXISTS idx_coin_transfers_recipient ON coin_transfers(to_user_id,created_at);
    CREATE TRIGGER IF NOT EXISTS coin_transfers_no_update BEFORE UPDATE ON coin_transfers
      BEGIN SELECT RAISE(ABORT,'Immutable coin transfer'); END;
    CREATE TRIGGER IF NOT EXISTS coin_transfers_no_delete BEFORE DELETE ON coin_transfers
      BEGIN SELECT RAISE(ABORT,'Immutable coin transfer'); END;
  `);
}
type TransferRow = {
  id:string;toUserId:string;amountMillis:number;rewardMillis:number;purchasedMillis:number;createdAt:string;
};
function wallet(db:AppDatabase,userId:string) {
  return db.prepare(`SELECT w.reward_millis AS reward,w.purchased_millis AS purchased,w.payment_hold AS hold
    FROM wallets w JOIN users u ON u.id=w.user_id WHERE w.user_id=? AND u.deleted_at IS NULL`)
    .get(userId) as {reward:number;purchased:number;hold:number}|undefined;
}
/** Welcome/promo balance is deliberately excluded to prevent multi-account welcome farming. */
export function transferableCoins(db:AppDatabase,userId:string) {
  const row=wallet(db,userId);
  return row ? (row.reward+row.purchased)/1000 : 0;
}

/**
 * One amount for the participant; exact origin stays in the private audit.
 * Purchased coins remain purchased after gifting; earned coins remain earned.
 * No payment or revenue entry is created.
 */
export function giftCoins(db:AppDatabase,fromUserId:string,toUserId:string,coins:number,referenceId:string) {
  z.string().uuid().parse(referenceId);
  if (fromUserId===toUserId) fail(400,"Escolha outra pessoa para presentear.","SELF_GIFT");
  if (!Number.isInteger(coins)||coins<1||coins>10000) fail(400,"Informe uma quantidade inteira de moedas.","INVALID_GIFT");
  return db.transaction(()=>{
    const previous=db.prepare(`SELECT id,to_user_id AS toUserId,amount_millis AS amountMillis,
      reward_millis AS rewardMillis,purchased_millis AS purchasedMillis,created_at AS createdAt
      FROM coin_transfers WHERE from_user_id=? AND reference_id=?`).get(fromUserId,referenceId) as TransferRow|undefined;
    if (previous) {
      if (previous.toUserId!==toUserId||previous.amountMillis!==coins*1000)
        fail(409,"Este presente já foi registrado com outros dados.","REFERENCE_CONFLICT");
      return {id:previous.id,toUserId,coins,replayed:true};
    }
    // An in-flight retry from the previous release must not charge a second gift.
    const legacy=db.prepare("SELECT id,payload_json AS payload FROM gamification_events WHERE user_id=? AND kind='REWARD_GIFT_OUT' AND reference_id=?")
      .get(fromUserId,referenceId) as {id:string;payload:string}|undefined;
    if (legacy) {
      const data=JSON.parse(legacy.payload) as {toUserId:string;coins:number};
      if (data.toUserId!==toUserId||data.coins!==coins)
        fail(409,"Este presente já foi registrado com outros dados.","REFERENCE_CONFLICT");
      return {id:legacy.id,toUserId,coins,replayed:true};
    }
    assertSocialInteractionAllowed(db,fromUserId,toUserId);
    const config=communityConfig(db);
    if (!config.coinGiftsEnabled) fail(409,"Os presentes de moedas estão pausados no momento.","COIN_GIFTS_DISABLED");
    if (coins>config.maxGiftCoins) fail(400,"Esta quantidade ultrapassa o limite de moedas por presente.","GIFT_LIMIT");
    const sender=wallet(db,fromUserId),recipient=wallet(db,toUserId);
    if (!sender||!recipient) fail(404,"Participante não disponível para receber este presente.","PARTICIPANT_UNAVAILABLE");
    if (sender.hold) fail(409,"Sua carteira está em revisão. Aguarde a liberação para presentear.","PAYMENT_HOLD");
    const amount=coins*1000;
    if (sender.reward+sender.purchased<amount)
      fail(409,"Você ainda não tem moedas suficientes disponíveis para presentear.","COINS_INSUFFICIENT");
    const reward=Math.min(sender.reward,amount),purchased=amount-reward;
    const stamp=new Date().toISOString(),id=randomUUID();
    const debit=db.prepare(`UPDATE wallets SET reward_millis=reward_millis-?,purchased_millis=purchased_millis-?,updated_at=?
      WHERE user_id=? AND reward_millis>=? AND purchased_millis>=? AND payment_hold=0`)
      .run(reward,purchased,stamp,fromUserId,reward,purchased);
    if (!debit.changes) fail(409,"Seu saldo foi atualizado. Confira a carteira antes de tentar de novo.","WALLET_CHANGED");
    if (!db.prepare("UPDATE wallets SET reward_millis=reward_millis+?,purchased_millis=purchased_millis+?,updated_at=? WHERE user_id=?")
      .run(reward,purchased,stamp,toUserId).changes)
      fail(409,"Não foi possível entregar este presente. Nenhuma moeda foi debitada.","RECIPIENT_UNAVAILABLE");
    db.prepare(`INSERT INTO coin_transfers(id,from_user_id,to_user_id,reference_id,amount_millis,reward_millis,purchased_millis,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(id,fromUserId,toUserId,referenceId,amount,reward,purchased,stamp);
    const ledger=db.prepare("INSERT INTO wallet_ledger(id,user_id,kind,amount_millis,reference_id,created_at) VALUES(?,?,?,?,?,?)");
    ledger.run(randomUUID(),fromUserId,"COINS_GIFT_OUT",-amount,id,stamp);
    ledger.run(randomUUID(),toUserId,"COINS_GIFT_IN",amount,id,stamp);
    const event=db.prepare(`INSERT INTO gamification_events
      (id,user_id,kind,reference_id,xp_delta,payload_json,created_at) VALUES(?,?,?,?,0,?,?)`);
    event.run(id,fromUserId,"COINS_GIFT_OUT",referenceId,JSON.stringify({toUserId,coins,transferId:id}),stamp);
    event.run(randomUUID(),toUserId,"COINS_GIFT_IN",fromUserId+":"+referenceId,JSON.stringify({fromUserId,coins,transferId:id}),stamp);
    notifyCommunity(db,{userId:toUserId,kind:"COINS_RECEIVED",actorId:fromUserId,referenceId:id,payload:{coins,transferId:id}});
    db.prepare(`INSERT INTO gamification_bot_events(id,event,user_id,payload_json,status,created_at)
      VALUES(?,'REWARD_COINS_GIFTED',?,?,'PENDING',?)`)
      .run("coins:"+id,toUserId,JSON.stringify({fromUserId,coins,transferId:id}),stamp);
    return {id,toUserId,coins,replayed:false};
  })();
}

/** Root-only provenance. Revenue continues to come exclusively from approved real payments. */
export function adminCoinTransfers(db:AppDatabase,actorId:string,limit=100,config?:Config) {
  assertRootCommunityActor(db,actorId,config);
  const maximum=Math.min(200,Math.max(1,Math.floor(limit)||100));
  const totals=db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(amount_millis),0) AS amountMillis,
    COALESCE(SUM(reward_millis),0) AS rewardMillis,COALESCE(SUM(purchased_millis),0) AS purchasedMillis
    FROM coin_transfers`).get() as {count:number;amountMillis:number;rewardMillis:number;purchasedMillis:number};
  const transfers=db.prepare(`SELECT t.id,t.from_user_id AS fromUserId,f.name AS fromName,
    t.to_user_id AS toUserId,r.name AS toName,t.reference_id AS referenceId,t.amount_millis AS amountMillis,
    t.reward_millis AS rewardMillis,t.purchased_millis AS purchasedMillis,t.created_at AS createdAt
    FROM coin_transfers t JOIN users f ON f.id=t.from_user_id JOIN users r ON r.id=t.to_user_id
    ORDER BY t.created_at DESC,t.rowid DESC LIMIT ?`).all(maximum);
  return {totals:{...totals,revenueCents:0},transfers};
}
