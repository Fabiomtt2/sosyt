import {randomUUID} from "node:crypto";
import {beforeEach,afterEach,describe,it,expect} from "vitest";
import {createDatabase,type AppDatabase} from "./db.js";
import {giftRewardCoins} from "./gamification.js";
import {ensureSocialSchema,communityConfig,saveCommunityConfig,listCommunityNotifications} from "./social.js";
import {ensureCoinTransferSchema,giftCoins,transferableCoins,adminCoinTransfers} from "./coin-transfers.js";

describe("presentes de moedas: saldo unificado e origem preservada",()=>{
  let db:AppDatabase;
  const a="00000000-0000-4000-a000-000000000011",b="00000000-0000-4000-a000-000000000012";
  const c="00000000-0000-4000-a000-000000000013",root="00000000-0000-4000-a000-000000000014";
  const stamp=()=>new Date().toISOString();
  const balance=(id:string)=>db.prepare("SELECT promo_millis AS promo,reward_millis AS reward,purchased_millis AS purchased FROM wallets WHERE user_id=?").get(id);
  const seed=(id:string,reward:number,purchased:number)=>db.prepare("UPDATE wallets SET reward_millis=?,purchased_millis=? WHERE user_id=?").run(reward,purchased,id);
  const count=(table:string)=>(db.prepare("SELECT COUNT(*) AS n FROM "+table).get() as {n:number}).n;
  beforeEach(()=>{
    db=createDatabase(":memory:");ensureSocialSchema(db);ensureCoinTransferSchema(db);
    [a,b,c,root].forEach((id,i)=>{
      db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,?,?,?,?,?)")
        .run(id,"Pessoa "+i,"557199901"+String(i).padStart(4,"0"),"1",stamp(),stamp());
      db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES(?,?)").run(id,stamp());
    });
    db.prepare(`INSERT INTO owner_access(id,user_id,phone,normalized_name,role,created_at,updated_at)
      VALUES('root-test',?,'5571999010003','root','ROOT_OWNER',?,?)`).run(root,stamp(),stamp());
  });
  afterEach(()=>db.close());
  it("envia uma quantidade única, conservando saldo comprado e recompensa no destinatário",()=>{
    seed(a,3500,20000);
    const result=giftCoins(db,a,b,10,randomUUID());
    expect(result).toMatchObject({toUserId:b,coins:10,replayed:false});
    expect(result).not.toHaveProperty("rewardMillis");expect(result).not.toHaveProperty("purchasedMillis");
    expect(balance(a)).toEqual({promo:10000,reward:0,purchased:13500});
    expect(balance(b)).toEqual({promo:10000,reward:3500,purchased:6500});
    const audit=adminCoinTransfers(db,root);
    expect(audit.transfers[0]).toMatchObject({amountMillis:10000,rewardMillis:3500,purchasedMillis:6500});
    expect(audit.totals).toMatchObject({count:1,amountMillis:10000,rewardMillis:3500,purchasedMillis:6500,revenueCents:0});
    expect(listCommunityNotifications(db,b).notifications[0]).toMatchObject({kind:"COINS_RECEIVED",payload:{coins:10}});
  });
  it("novas doações não convertem moeda ganha em compra nem compra em recompensa",()=>{
    seed(a,2000,5000);
    giftCoins(db,a,b,7,randomUUID());giftCoins(db,b,c,7,randomUUID());
    expect(balance(a)).toEqual({promo:10000,reward:0,purchased:0});
    expect(balance(b)).toEqual({promo:10000,reward:0,purchased:0});
    expect(balance(c)).toEqual({promo:10000,reward:2000,purchased:5000});
    expect(adminCoinTransfers(db,root).totals).toMatchObject({count:2,rewardMillis:4000,purchasedMillis:10000,revenueCents:0});
  });
  it("não transfere boas-vindas e não altera carteira quando o saldo elegível é insuficiente",()=>{
    expect(transferableCoins(db,a)).toBe(0);
    expect(()=>giftCoins(db,a,b,1,randomUUID())).toThrow(/moedas suficientes/);
    expect(balance(a)).toEqual({promo:10000,reward:0,purchased:0});
    expect(count("coin_transfers")).toBe(0);expect(count("wallet_ledger")).toBe(0);
    seed(a,500,0);
    expect(()=>giftCoins(db,a,b,1,randomUUID())).toThrow(/moedas suficientes/);
    expect(balance(a)).toEqual({promo:10000,reward:500,purchased:0});
  });
  it("replay não duplica saldo, ledger, evento, bot ou notificação; UUID fica vinculado aos dados",()=>{
    seed(a,5000,10000);
    const reference=randomUUID(),first=giftCoins(db,a,b,10,reference);
    const snapshot={a:balance(a),b:balance(b),ledger:count("wallet_ledger"),events:count("gamification_events"),bot:count("gamification_bot_events")};
    expect(giftCoins(db,a,b,10,reference)).toEqual({...first,replayed:true});
    expect(()=>giftCoins(db,a,c,10,reference)).toThrow(/outros dados/);
    expect(()=>giftCoins(db,a,b,9,reference)).toThrow(/outros dados/);
    expect({a:balance(a),b:balance(b),ledger:count("wallet_ledger"),events:count("gamification_events"),bot:count("gamification_bot_events")}).toEqual(snapshot);
    expect(listCommunityNotifications(db,b).notifications).toHaveLength(1);
    seed(c,1000,0);expect(giftCoins(db,c,b,1,reference).replayed).toBe(false);
  });
  it("reconhece retry da versão reward-only anterior sem cobrar ou notificar novamente",()=>{
    seed(a,10000,10000);
    const reference=randomUUID();giftRewardCoins(db,a,b,5,reference);
    const snapshot={a:balance(a),b:balance(b),ledger:count("wallet_ledger"),events:count("gamification_events")};
    expect(giftCoins(db,a,b,5,reference).replayed).toBe(true);
    expect({a:balance(a),b:balance(b),ledger:count("wallet_ledger"),events:count("gamification_events")}).toEqual(snapshot);
    expect(count("coin_transfers")).toBe(0);
    expect(()=>giftCoins(db,a,c,5,reference)).toThrow(/outros dados/);
  });
  it("hold bloqueia nova saída; reenvio confirmado continua sendo apenas leitura",()=>{
    seed(a,0,10000);
    const reference=randomUUID();giftCoins(db,a,b,2,reference);
    db.prepare("UPDATE wallets SET payment_hold=1 WHERE user_id=?").run(a);
    expect(()=>giftCoins(db,a,b,1,randomUUID())).toThrow(/em revisão/);
    expect(giftCoins(db,a,b,2,reference).replayed).toBe(true);
    expect(balance(a)).toEqual({promo:10000,reward:0,purchased:8000});
    expect(balance(b)).toEqual({promo:10000,reward:0,purchased:2000});
  });
  it("rejeita destinatário removido, autoenvio e quantidades inválidas sem débito",()=>{
    seed(a,2000,10000);
    db.prepare("UPDATE users SET deleted_at=? WHERE id=?").run(stamp(),b);
    expect(()=>giftCoins(db,a,b,2,randomUUID())).toThrow(/não disponível/);
    expect(()=>giftCoins(db,a,a,2,randomUUID())).toThrow(/outra pessoa/);
    for(const coins of [0,-1,0.5,10001,Number.NaN]) expect(()=>giftCoins(db,a,c,coins,randomUUID())).toThrow(/quantidade inteira/);
    expect(balance(a)).toEqual({promo:10000,reward:2000,purchased:10000});
    expect(count("coin_transfers")).toBe(0);
  });
  it("limites e pausa de presentes configurados pelo Root são efetivos no servidor",()=>{
    seed(a,100000,100000);
    saveCommunityConfig(db,{...communityConfig(db),maxGiftCoins:5},root);
    expect(()=>giftCoins(db,a,b,6,randomUUID())).toThrow(/ultrapassa o limite/);
    expect(giftCoins(db,a,b,5,randomUUID()).coins).toBe(5);
    saveCommunityConfig(db,{...communityConfig(db),coinGiftsEnabled:false},root);
    expect(()=>giftCoins(db,a,b,1,randomUUID())).toThrow(/pausados/);
    expect(()=>adminCoinTransfers(db,a)).toThrow(/Root Owner/);
    expect(adminCoinTransfers(db,"root-test").totals.count).toBe(1);
  });
  it("receita e compras permanecem inalteradas após transferência de saldo comprado",()=>{
    seed(a,0,10000);
    db.prepare(`INSERT INTO payments(id,user_id,provider,status,amount_cents,credits_millis,extra_passes,created_at,approved_at)
      VALUES(?,?,'PIX_TEST','APPROVED',2000,10000,0,?,?)`).run(randomUUID(),a,stamp(),stamp());
    const revenue=()=>db.prepare("SELECT COUNT(*) AS purchases,SUM(amount_cents) AS revenue FROM payments WHERE status='APPROVED' AND provider<>'DEMO'").get();
    const previous=revenue();
    giftCoins(db,a,b,6,randomUUID());giftCoins(db,b,c,6,randomUUID());
    expect(revenue()).toEqual(previous);expect(revenue()).toEqual({purchases:1,revenue:2000});
    expect(adminCoinTransfers(db,root).totals.revenueCents).toBe(0);
    expect(count("wallet_ledger")).toBe(4);
  });
  it("opera em milésimos exatos e conserva fração de recompensa ao completar uma moeda inteira",()=>{
    seed(a,3500,500);
    giftCoins(db,a,b,4,randomUUID());
    expect(balance(a)).toEqual({promo:10000,reward:0,purchased:0});
    expect(balance(b)).toEqual({promo:10000,reward:3500,purchased:500});
    expect(transferableCoins(db,b)).toBe(4);
  });
  it("trilha imutável preserva histórico ao repetir migração",()=>{
    seed(a,1000,0);giftCoins(db,a,b,1,randomUUID());
    expect(()=>db.prepare("UPDATE coin_transfers SET reward_millis=0").run()).toThrow(/Immutable/);
    expect(()=>db.prepare("DELETE FROM coin_transfers").run()).toThrow(/Immutable/);
    ensureCoinTransferSchema(db);ensureSocialSchema(db);
    expect(count("coin_transfers")).toBe(1);
    expect(balance(b)).toEqual({promo:10000,reward:1000,purchased:0});
  });
});
