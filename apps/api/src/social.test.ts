import { randomUUID } from "node:crypto";
import { beforeEach,afterEach,describe,it,expect,vi } from "vitest";
import { createDatabase,type AppDatabase } from "./db.js";
import {
  ensureSocialSchema,communityConfig,saveCommunityConfig,socialPreferences,saveSocialPreferences,
  socialOverview,socialProfile,findFriendByPhone,requestFriendship,respondFriendship,
  listCommunityNotifications,markCommunityNotificationsRead,adminCommunityOverview,adminRevokeFriendship
} from "./social.js";

describe("amizades: consentimento, notificações, privacidade e moderação",()=>{
  let db:AppDatabase;
  const a="00000000-0000-4000-a000-000000000001",b="00000000-0000-4000-a000-000000000002";
  const c="00000000-0000-4000-a000-000000000003",root="00000000-0000-4000-a000-000000000004";
  function user(id:string,index:number) {
    const stamp=new Date().toISOString();
    db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .run(id,"Pessoa "+index,"557199900"+String(index).padStart(4,"0"),"12",stamp,stamp);
    db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES(?,?)").run(id,stamp);
  }
  beforeEach(()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-15T15:00:00Z"));
    db=createDatabase(":memory:");ensureSocialSchema(db);
    [a,b,c,root].forEach((id,i)=>user(id,i+1));
    const stamp=new Date().toISOString();
    db.prepare(`INSERT INTO owner_access(id,user_id,phone,normalized_name,role,created_at,updated_at)
      VALUES('root-test',?,'5571999000004','root','ROOT_OWNER',?,?)`).run(root,stamp,stamp);
  });
  afterEach(()=>{db.close();vi.useRealTimers();});
  const invite=(from=a,to=b)=>requestFriendship(db,from,to,randomUUID());
  it("convite recíproco não simula aceite; somente destinatário autoriza",()=>{
    const sent=invite();
    expect(socialOverview(db,a).friends).toHaveLength(0);
    expect(socialOverview(db,b).incoming).toHaveLength(1);
    expect(socialOverview(db,b).unread).toBe(1);
    expect(invite(b,a)).toMatchObject({status:"REQUEST_RECEIVED",invitationId:sent.invitationId});
    expect(()=>respondFriendship(db,a,sent.invitationId,"ACCEPT")).toThrow(/quem recebeu/);
    expect(()=>respondFriendship(db,c,sent.invitationId,"ACCEPT")).toThrow(/não encontrado/);
    expect(respondFriendship(db,b,sent.invitationId,"ACCEPT")).toEqual({status:"ACCEPTED",replayed:false});
    expect(respondFriendship(db,b,sent.invitationId,"ACCEPT").replayed).toBe(true);
    expect(socialOverview(db,a).friends[0].user?.id).toBe(b);
    expect(socialOverview(db,b).friends[0].user?.id).toBe(a);
    expect(socialOverview(db,b).unread).toBe(0);
    expect(listCommunityNotifications(db,a).notifications[0].kind).toBe("FRIEND_ACCEPTED");
  });
  it("repetição do mesmo UUID não duplica convite nem notificação e não troca alvo",()=>{
    const reference=randomUUID();
    const first=requestFriendship(db,a,b,reference);
    expect(requestFriendship(db,a,b,reference)).toMatchObject({invitationId:first.invitationId,replayed:true});
    expect(()=>requestFriendship(db,a,c,reference)).toThrow(/outra pessoa/);
    expect(socialOverview(db,b).incoming).toHaveLength(1);
    expect(listCommunityNotifications(db,b).notifications).toHaveLength(1);
  });
  it("recusa respeita intervalo; uma resposta antiga não aceita novo convite",()=>{
    const first=invite();
    respondFriendship(db,b,first.invitationId,"DECLINE");
    expect(()=>invite()).toThrow(/Aguarde/);
    vi.advanceTimersByTime(25*3600000);
    const second=invite();
    expect(second.invitationId).not.toBe(first.invitationId);
    expect(()=>respondFriendship(db,b,first.invitationId,"ACCEPT")).toThrow(/atualizado/);
    expect(socialOverview(db,b).incoming[0].id).toBe(second.invitationId);
  });
  it("remetente cancela; qualquer amigo pode remover vínculo aceito",()=>{
    const first=invite();
    expect(()=>respondFriendship(db,b,first.invitationId,"CANCEL")).toThrow(/quem enviou/);
    respondFriendship(db,a,first.invitationId,"CANCEL");
    expect(socialOverview(db,b).incoming).toHaveLength(0);
    const second=invite();
    respondFriendship(db,b,second.invitationId,"ACCEPT");
    expect(respondFriendship(db,a,second.invitationId,"REMOVE").status).toBe("REMOVED");
    expect(socialOverview(db,b).friends).toHaveLength(0);
    expect(()=>respondFriendship(db,b,second.invitationId,"ACCEPT")).toThrow(/atualizado/);
  });
  it("busca exige número exato internacional e devolve somente identidade pública",()=>{
    const match=findFriendByPhone(db,a,"+55 (71) 99900-0002");
    expect(match.user?.id).toBe(b);
    expect(JSON.stringify(match)).not.toContain("5571999000002");
    expect(JSON.stringify(socialProfile(db,a,b))).not.toContain("phone");
    expect(()=>findFriendByPhone(db,a,"999000002")).toThrow(/Não encontramos/);
    expect(()=>findFriendByPhone(db,a,"5571999")).toThrow(/WhatsApp completo/);
    expect(()=>findFriendByPhone(db,a,"557199900000")).toThrow(/Não encontramos/);
  });
  it("preferência do destinatário impede novos convites sem esconder amigos já aceitos",()=>{
    expect(socialPreferences(db,b).acceptFriendRequests).toBe(true);
    saveSocialPreferences(db,b,{acceptFriendRequests:false});
    expect(()=>findFriendByPhone(db,a,"+5571999000002")).toThrow(/Não encontramos/);
    expect(()=>invite()).toThrow(/não está recebendo/);
    saveSocialPreferences(db,b,{acceptFriendRequests:true});
    const first=invite();respondFriendship(db,b,first.invitationId,"ACCEPT");
    saveSocialPreferences(db,b,{acceptFriendRequests:false});
    expect(findFriendByPhone(db,a,"+5571999000002").relationship.status).toBe("FRIEND");
    expect(socialOverview(db,a).friends).toHaveLength(1);
  });
  it("pausa global impede novos aceites, mas permite recusar ou cancelar pendências",()=>{
    const first=invite();
    saveCommunityConfig(db,{...communityConfig(db),friendsEnabled:false},"root-test");
    expect(()=>respondFriendship(db,b,first.invitationId,"ACCEPT")).toThrow(/pausados/);
    expect(()=>invite(a,c)).toThrow(/pausados/);
    respondFriendship(db,b,first.invitationId,"DECLINE");
    expect(socialOverview(db,b).incoming).toHaveLength(0);
    expect(socialOverview(db,b).enabled).toBe(false);
  });
  it("leitura de notificação é restrita ao destinatário e idempotente",()=>{
    invite();
    const notification=listCommunityNotifications(db,b).notifications[0];
    expect(markCommunityNotificationsRead(db,a,[notification.id]).read).toBe(0);
    expect(listCommunityNotifications(db,b).unread).toBe(1);
    expect(markCommunityNotificationsRead(db,b,[notification.id])).toEqual({read:1,unread:0});
    expect(markCommunityNotificationsRead(db,b,[notification.id])).toEqual({read:0,unread:0});
  });
  it("Root configura e revoga com auditoria, sem fabricar consentimento",()=>{
    const first=invite();
    expect(()=>saveCommunityConfig(db,communityConfig(db),a)).toThrow(/Root Owner/);
    expect(()=>adminCommunityOverview(db,a)).toThrow(/Root Owner/);
    expect(()=>adminRevokeFriendship(db,a,first.invitationId,"Revisão de segurança")).toThrow(/Root Owner/);
    expect(()=>respondFriendship(db,root,first.invitationId,"ACCEPT")).toThrow(/não encontrado/);
    expect(adminRevokeFriendship(db,"root-test",first.invitationId,"Revisão de segurança")).toEqual({ok:true,replayed:false});
    expect(adminCommunityOverview(db,root).stats.pendingInvitations).toBe(0);
    const audit=adminCommunityOverview(db,root).audit as Array<{action:string;payload:string}>;
    expect(audit[0]).toMatchObject({action:"ADMIN_FRIENDSHIP_REVOKED"});
    expect(audit[0].payload).toContain("Revisão de segurança");
  });
  it("migração repetida preserva preferências, configuração, vínculos e saldo",()=>{
    const first=invite();respondFriendship(db,b,first.invitationId,"ACCEPT");
    saveCommunityConfig(db,{...communityConfig(db),maxGiftCoins:25},root);
    saveSocialPreferences(db,b,{acceptFriendRequests:false});
    ensureSocialSchema(db);ensureSocialSchema(db);
    expect(communityConfig(db).maxGiftCoins).toBe(25);
    expect(socialPreferences(db,b).acceptFriendRequests).toBe(false);
    expect(socialOverview(db,a).friends).toHaveLength(1);
    expect(db.prepare("SELECT promo_millis AS amount FROM wallets WHERE user_id=?").get(a)).toEqual({amount:9000});
  });
  it("conta removida deixa de aparecer na lista e não aceita novo vínculo",()=>{
    const first=invite();respondFriendship(db,b,first.invitationId,"ACCEPT");
    db.prepare("UPDATE users SET deleted_at=? WHERE id=?").run(new Date().toISOString(),b);
    expect(socialOverview(db,a).friends).toHaveLength(0);
    expect(()=>socialProfile(db,a,b)).toThrow(/não disponível/);
    expect(()=>invite(a,b)).toThrow(/não disponível/);
  });
});
