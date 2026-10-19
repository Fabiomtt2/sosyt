import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "./db.js";
import {
  requestFriendship, respondFriendship, blockSocialUser, unblockSocialUser, socialOverview,
  socialProfile, findFriendByPhone, listCommunityNotifications, communityUnreadCount, ensureSocialSchema
} from "./social.js";
import { isSocialBlocked } from "./social-blocks.js";
import { sendDirectMessage, readThread, listInbox, unreadCount } from "./mailbox.js";
import { ensureCoinTransferSchema, giftCoins } from "./coin-transfers.js";
import { giftRewardCoins } from "./gamification.js";
import { giftItem, grantItem, ITEM_SKIP } from "./inventory.js";
import { adminSetPinned, listGlobalMessages, sendGlobalMessage } from "./global-chat.js";
import { activeRounds, joinRound } from "./queues.js";

describe("amizade paga uma vez e bloqueio pessoal integrado", () => {
  let db: AppDatabase;
  const a="00000000-0000-4000-a000-000000002001", b="00000000-0000-4000-a000-000000002002", c="00000000-0000-4000-a000-000000002003";
  const stamp=()=>new Date().toISOString();
  const snapshot=(id:string)=>db.prepare("SELECT promo_millis AS promo,reward_millis AS reward,purchased_millis AS purchased FROM wallets WHERE user_id=?").get(id);
  const count=(table:string)=>(db.prepare("SELECT COUNT(*) AS n FROM "+table).get() as {n:number}).n;
  beforeEach(()=>{
    db=createDatabase(":memory:");ensureSocialSchema(db);ensureCoinTransferSchema(db);
    for(const [i,id] of [a,b,c].entries()) {
      db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,?,?,'12',?,?)").run(id,"Pessoa QA "+i,"557199902000"+i,stamp(),stamp());
      db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES(?,?)").run(id,stamp());
    }
  });
  afterEach(()=>db.close());

  it("envio custa1, mesmo UUID/pending/recíproco não cobram, e aceite custa zero",()=>{
    const ref=randomUUID(), beforeB=snapshot(b);
    const invite=requestFriendship(db,a,b,ref);
    expect(snapshot(a)).toMatchObject({promo:9000});
    expect(requestFriendship(db,a,b,ref).replayed).toBe(true);
    expect(requestFriendship(db,a,b,randomUUID()).invitationId).toBe(invite.invitationId);
    expect(requestFriendship(db,b,a,randomUUID()).status).toBe("REQUEST_RECEIVED");
    expect(snapshot(a)).toMatchObject({promo:9000});expect(snapshot(b)).toEqual(beforeB);
    respondFriendship(db,b,invite.invitationId,"ACCEPT");
    expect(snapshot(b)).toEqual(beforeB);
    expect(db.prepare("SELECT kind,amount_millis AS amount,reference_id AS ref FROM wallet_ledger").all())
      .toEqual([{kind:"FRIEND_REQUEST",amount:-1000,ref:invite.invitationId}]);
    expect(socialOverview(db,a).friendshipRequestCost).toBe(1);
  });

  it("débito exato usa promo depois recompensa e compra; cancelamento não reembolsa",()=>{
    db.prepare("UPDATE wallets SET promo_millis=200,reward_millis=350,purchased_millis=1000 WHERE user_id=?").run(a);
    const sent=requestFriendship(db,a,b,randomUUID());
    expect(snapshot(a)).toEqual({promo:0,reward:0,purchased:550});
    respondFriendship(db,a,sent.invitationId,"CANCEL");
    expect(snapshot(a)).toEqual({promo:0,reward:0,purchased:550});
    expect(()=>requestFriendship(db,a,b,randomUUID())).toThrow(/1 moeda/);
    expect(count("friendships")).toBe(1);
  });

  it("saldo insuficiente, hold e falha de notificação não deixam débito nem convite parcial",()=>{
    db.prepare("UPDATE wallets SET promo_millis=999 WHERE user_id=?").run(a);
    expect(()=>requestFriendship(db,a,b,randomUUID())).toThrow(/1 moeda/);
    db.prepare("UPDATE wallets SET promo_millis=10000,payment_hold=1 WHERE user_id=?").run(a);
    expect(()=>requestFriendship(db,a,b,randomUUID())).toThrow(/em revisão/);
    db.prepare("UPDATE wallets SET payment_hold=0 WHERE user_id=?").run(a);
    db.exec("CREATE TRIGGER reject_notice BEFORE INSERT ON community_notifications BEGIN SELECT RAISE(ABORT,'notice fixture failure'); END;");
    expect(()=>requestFriendship(db,a,b,randomUUID())).toThrow(/notice fixture failure/);
    expect(snapshot(a)).toEqual({promo:10000,reward:0,purchased:0});
    expect(count("friendships")).toBe(0);expect(count("wallet_ledger")).toBe(0);
  });

  it("bloquear remove amizade e pendência sem apagar história; só quem bloqueou desbloqueia",()=>{
    const sent=requestFriendship(db,a,b,randomUUID());respondFriendship(db,b,sent.invitationId,"ACCEPT");
    const second=requestFriendship(db,c,b,randomUUID());
    expect(blockSocialUser(db,b,a)).toEqual({blocked:true,replayed:false});
    expect(blockSocialUser(db,b,a).replayed).toBe(true);
    expect(socialOverview(db,a).friends).toEqual([]);
    expect(socialOverview(db,b).blocked[0]).toMatchObject({userId:a,user:{id:a}});
    expect(socialProfile(db,a,b)).toMatchObject({user:null,interactionBlocked:true,blockedByMe:false,relationship:{status:"BLOCKED"}});
    expect(socialProfile(db,b,a)).toMatchObject({user:null,interactionBlocked:true,blockedByMe:true});
    expect(()=>findFriendByPhone(db,a,"5571999020001")).toThrow(/Não encontramos/);
    expect(()=>requestFriendship(db,a,b,randomUUID())).toThrow(/interação não está disponível/);
    expect(unblockSocialUser(db,a,b).replayed).toBe(true);expect(isSocialBlocked(db,a,b)).toBe(true);
    blockSocialUser(db,b,c);
    expect(()=>respondFriendship(db,b,second.invitationId,"ACCEPT")).toThrow(/atualizado|disponível/);
    ensureSocialSchema(db);expect(isSocialBlocked(db,a,b)).toBe(true);
    unblockSocialUser(db,b,a);expect(isSocialBlocked(db,a,b)).toBe(false);
    expect(socialOverview(db,a).friends).toEqual([]); // Unblocking never manufactures new consent.
    expect(count("friendships")).toBe(2);
  });

  it("DM e notificações somem nos dois sentidos, não contam unread e histórico permanece",()=>{
    const accepted=requestFriendship(db,a,b,randomUUID());respondFriendship(db,b,accepted.invitationId,"ACCEPT");
    sendDirectMessage(db,a,b,"Mensagem anterior de A");sendDirectMessage(db,b,a,"Mensagem anterior de B");
    requestFriendship(db,a,b,randomUUID());
    const rowsBefore=count("mail_messages"),noticesBefore=count("community_notifications");
    blockSocialUser(db,a,b);
    for(const [from,to] of [[a,b],[b,a]]) {
      expect(()=>sendDirectMessage(db,from,to,"Nova tentativa")).toThrow(/interação não está disponível/);
      expect(readThread(db,from,to)).toEqual([]);
      expect(listInbox(db,from)).toEqual([]);
      expect(unreadCount(db,from)).toBe(0);
      expect(communityUnreadCount(db,from)).toBe(0);
      expect(listCommunityNotifications(db,from).notifications).toEqual([]);
    }
    expect(count("mail_messages")).toBe(rowsBefore);expect(count("community_notifications")).toBe(noticesBefore);
    const other=requestFriendship(db,c,b,randomUUID());respondFriendship(db,b,other.invitationId,"ACCEPT");
    sendDirectMessage(db,c,b,"Outro participante continua");
    expect(listInbox(db,b)[0].with?.id).toBe(c);
    unblockSocialUser(db,a,b);
    expect(readThread(db,b,a)).toHaveLength(2);
  });

  it("bloqueio filtra chat global e fixadas antes do LIMIT e também no polling",()=>{
    const first=sendGlobalMessage(db,c,"Olá de C");
    const second=sendGlobalMessage(db,b,"Olá de B");adminSetPinned(db,second.id,true);
    const third=sendGlobalMessage(db,a,"Olá de A");
    blockSocialUser(db,a,b);
    expect(listGlobalMessages(db,a,{limit:2}).messages.map(row=>row.id)).toEqual([first.id,third.id]);
    expect(listGlobalMessages(db,a).pinned).toEqual([]);
    expect(listGlobalMessages(db,b).messages.map(row=>row.id)).toEqual([first.id,second.id]);
    expect(listGlobalMessages(db,a,{afterId:first.id}).messages.map(row=>row.id)).toEqual([third.id]);
    expect(listGlobalMessages(db,c).messages).toHaveLength(3);
    expect(count("global_chat_messages")).toBe(3);
    unblockSocialUser(db,a,b);expect(listGlobalMessages(db,a).pinned[0].id).toBe(second.id);
  });

  it("moedas, itens e endpoint legado não contornam bloqueio nem por Root participante",()=>{
    db.prepare("UPDATE wallets SET reward_millis=10000,purchased_millis=10000 WHERE user_id IN (?,?)").run(a,b);
    db.prepare("INSERT INTO owner_access(id,user_id,phone,normalized_name,role,active,created_at,updated_at) VALUES('qa-block-root',?,'qa-block-root-phone','root','ROOT_OWNER',1,?,?)").run(a,stamp(),stamp());
    grantItem(db,{userId:a,itemCode:ITEM_SKIP,delta:2,kind:"OWNER_ADJUST",referenceId:"qa-block-grant",note:"fixture"});
    const first=giftCoins(db,a,b,1,randomUUID());
    blockSocialUser(db,b,a);
    const before={a:snapshot(a),b:snapshot(b),transfers:count("coin_transfers"),grants:count("item_grants"),ledger:count("wallet_ledger")};
    for(const [from,to] of [[a,b],[b,a]]) {
      expect(()=>giftCoins(db,from,to,1,randomUUID())).toThrow(/interação não está disponível/);
      expect(()=>giftRewardCoins(db,from,to,1,randomUUID())).toThrow(/interação não está disponível/);
      expect(()=>giftItem(db,from,to,ITEM_SKIP,1,true,randomUUID())).toThrow(/interação não está disponível/);
    }
    expect({a:snapshot(a),b:snapshot(b),transfers:count("coin_transfers"),grants:count("item_grants"),ledger:count("wallet_ledger")}).toEqual(before);
    expect(first.coins).toBe(1);
  });

  it("remover amizade não bloqueia mensagens e bloqueio não altera participação em filas",()=>{
    const sent=requestFriendship(db,a,b,randomUUID());respondFriendship(db,b,sent.invitationId,"ACCEPT");
    respondFriendship(db,a,sent.invitationId,"REMOVE");
    expect(isSocialBlocked(db,a,b)).toBe(false);
    expect(()=>sendDirectMessage(db,a,b,"Contato continua permitido")).not.toThrow();
    const queue=activeRounds(db)[0].id;joinRound(db,queue,a);joinRound(db,queue,b);
    const before=db.prepare("SELECT * FROM round_participants WHERE round_id=? ORDER BY user_id").all(queue);
    blockSocialUser(db,a,b);
    expect(db.prepare("SELECT * FROM round_participants WHERE round_id=? ORDER BY user_id").all(queue)).toEqual(before);
  });
});
