import { randomUUID } from "node:crypto";
import { afterEach,beforeEach,describe,it,expect } from "vitest";
import { createDatabase,type AppDatabase } from "./db.js";
import { ensureSocialSchema,requestDirectConversation,respondDirectConversation,directConversationRequests,requestFriendship,respondFriendship,blockSocialUser,unblockSocialUser,listCommunityNotifications } from "./social.js";
import { sendDirectMessage,readThread,unreadCount } from "./mailbox.js";
describe("consentimento explícito de conversa",()=>{
 let db:AppDatabase;const a=randomUUID(),b=randomUUID(),c=randomUUID();
 beforeEach(()=>{db=createDatabase(":memory:");ensureSocialSchema(db);for(const [i,id]of[a,b,c].entries()){const stamp=new Date().toISOString();db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,?,?,'1',?,?)").run(id,"Pessoa "+i,"557199990000"+i,stamp,stamp);db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES(?,?)").run(id,stamp);}});
 afterEach(()=>db.close());
 it("não entrega mensagem antes de consentir, solicitação gratuita notifica uma vez",()=>{
  const before=db.prepare("SELECT * FROM wallets ORDER BY user_id").all();
  expect(()=>sendDirectMessage(db,a,b,"Indesejada")).toThrow(/precisa aceitar/);
  expect(readThread(db,b,a)).toEqual([]);expect(unreadCount(db,b)).toBe(0);
  const request=requestDirectConversation(db,a,b);expect(request.status).toBe("PENDING");
  expect(requestDirectConversation(db,a,b).replayed).toBe(true);
  expect(listCommunityNotifications(db,b).notifications).toHaveLength(1);
  expect(directConversationRequests(db,b)[0]).toMatchObject({incoming:true,status:"PENDING"});
  expect(()=>respondDirectConversation(db,c,requestId(request),true)).toThrow(/não encontrada/);
  expect(()=>respondDirectConversation(db,a,requestId(request),true)).toThrow(/não encontrada/);
  respondDirectConversation(db,b,requestId(request),true);
  sendDirectMessage(db,a,b,"Consentida");sendDirectMessage(db,b,a,"Resposta");
  expect(readThread(db,b,a)).toHaveLength(2);
  expect(db.prepare("SELECT * FROM wallets ORDER BY user_id").all()).toEqual(before);
 });
 it("recusa não aceita recíproco automaticamente e bloqueio revoga permissão",()=>{
  const req=requestDirectConversation(db,a,b);respondDirectConversation(db,b,requestId(req),false);
  expect(()=>sendDirectMessage(db,a,b,"Não")).toThrow(/precisa aceitar/);
  const reverse=requestDirectConversation(db,b,a);expect(reverse.status).toBe("PENDING");
  expect(()=>sendDirectMessage(db,b,a,"Ainda não")).toThrow(/precisa aceitar/);
  respondDirectConversation(db,a,requestId(reverse),true);sendDirectMessage(db,b,a,"Sim");
  blockSocialUser(db,b,a);expect(()=>sendDirectMessage(db,a,b,"Não")).toThrow(/interação/);
  expect(readThread(db,a,b)).toEqual([]);unblockSocialUser(db,b,a);
  expect(()=>sendDirectMessage(db,a,b,"Não recupera consentimento")).toThrow(/precisa aceitar/);
 });
 it("aceitar amizade permite conversa e remover amizade conserva consentimento separado",()=>{
  const invite=requestFriendship(db,a,b,randomUUID());respondFriendship(db,b,invite.invitationId,"ACCEPT");
  sendDirectMessage(db,a,b,"Amigo");respondFriendship(db,b,invite.invitationId,"REMOVE");
  expect(()=>sendDirectMessage(db,a,b,"Conversa consentida")).not.toThrow();
 });
});

function requestId(request:{id?:string}):string {
  expect(typeof request.id).toBe("string");
  if(typeof request.id!=="string")throw new Error("Fixture expected a persisted conversation request");
  return request.id;
}
