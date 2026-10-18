import Database from "better-sqlite3";
import { afterEach,beforeEach,describe,expect,it } from "vitest";
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";
import { openHumanRelay,routeHumanRelay } from "./bot-human-relay.js";
let db:AppDatabase;
const config={} as Config,user="5511998887766",human="5571993332391";
beforeEach(()=>{db=new Database(":memory:") as AppDatabase;db.exec("CREATE TABLE integration_settings(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE whatsapp_conversations(phone TEXT PRIMARY KEY,stage TEXT,updated_at TEXT);");db.prepare("INSERT INTO integration_settings VALUES('whatsapp.support.human_number',?)").run(human);db.prepare("INSERT INTO whatsapp_conversations VALUES(?,'HUMAN_REQUESTED','now')").run(user);});
afterEach(()=>db.close());
describe("atendimento humano pela conversa original",()=>{
 it("persiste chamado, entrega texto do humano ao usuário e encaminha retorno",()=>{
 const opened=openHumanRelay(db,config,{phone:user,name:"Pessoa",message:"Tenho dúvidas"});
 expect(opened.messages[0].recipient).toBe(human);
 expect(opened.messages[0].body).toContain("RESPONDER "+opened.ticketId);
 expect(opened.messages[0].body).not.toContain("wa.me");
 const reply=routeHumanRelay(db,config,{phone:"557193332391",text:`RESPONDER ${opened.ticketId} Como posso ajudar?`});
 expect(reply.handled).toBe(true);expect(reply.messages[0].recipient).toBe(user);
 expect(reply.messages[0].body).toContain("Como posso ajudar?");
 const incoming=routeHumanRelay(db,config,{phone:user,text:"Não consigo entrar."});
 expect(incoming.messages[0].recipient).toBe(human);expect(incoming.messages[0].body).toContain("Não consigo entrar.");
 });
 it("reutiliza chamado aberto e mantém a identidade telefone",()=>{
 const a=openHumanRelay(db,config,{phone:user,message:"humano"});
 expect(openHumanRelay(db,config,{phone:user,message:"humano"}).ticketId).toBe(a.ticketId);
 expect((db.prepare("SELECT count(*) AS n FROM bot_support_tickets").get() as {n:number}).n).toBe(1);
 });
 it("recusa terceiro mesmo com identificador conhecido, sem vazar usuário",()=>{
 const a=openHumanRelay(db,config,{phone:user,message:"humano"});
 const reply=routeHumanRelay(db,config,{phone:"5511988881111",text:`RESPONDER ${a.ticketId} invasor`});
 expect(reply.handled).toBe(true);expect(reply.messages).toHaveLength(1);
 expect(reply.messages[0].recipient).toBe("5511988881111");
 expect(reply.messages[0].body).not.toContain(user);
 });
 it("encerramento humano retoma bot e bloqueia novas respostas ao chamado",()=>{
 const a=openHumanRelay(db,config,{phone:user,message:"humano"});
 expect(routeHumanRelay(db,config,{phone:human,text:`ENCERRAR ${a.ticketId}`}).messages[0].recipient).toBe(user);
 expect(routeHumanRelay(db,config,{phone:user,text:"oi"}).handled).toBe(false);
 expect(routeHumanRelay(db,config,{phone:human,text:`RESPONDER ${a.ticketId} tarde`}).messages[0].body).toContain("já encerrado");
 expect((db.prepare("SELECT stage FROM whatsapp_conversations").get() as {stage:string}).stage).toBe("ACTIVE");
 });
 it("usuário pode voltar ao bot e abrir outro chamado",()=>{
 const a=openHumanRelay(db,config,{phone:user,message:"humano"});
 expect(routeHumanRelay(db,config,{phone:user,text:"VOLTAR AO BOT"}).messages[0].recipient).toBe(user);
 expect(openHumanRelay(db,config,{phone:user,message:"humano"}).ticketId).not.toBe(a.ticketId);
 });
 it("mudança do número humano revoga autorização anterior imediatamente",()=>{
 const a=openHumanRelay(db,config,{phone:user,message:"humano"});
 db.prepare("UPDATE integration_settings SET value='5511988882222'").run();
 expect(routeHumanRelay(db,config,{phone:human,text:`RESPONDER ${a.ticketId} texto`}).messages[0].body).toContain("exclusivo");
 });
 it("texto de 3000 caracteres preservado nos dois sentidos e payload menor que 4096",()=>{
 const a=openHumanRelay(db,config,{phone:user,message:"humano"});
 const text="x".repeat(3000);
 const outgoing=routeHumanRelay(db,config,{phone:user,text});
 expect(outgoing.messages[0].body).toContain(text);
 expect(outgoing.messages[0].body.length).toBeLessThan(4096);
 const response=routeHumanRelay(db,config,{phone:human,text:`RESPONDER ${a.ticketId} ${text}`});
 expect(response.messages[0].body).toContain(text);
 expect(response.messages[0].body.length).toBeLessThan(4096);
 expect(routeHumanRelay(db,config,{phone:user,text:text+"x"}).messages).toHaveLength(1);
 expect(routeHumanRelay(db,config,{phone:user,text:text+"x"}).messages[0].body).toContain("não foi encaminhado");
 });
 it("pausa bloqueia ambos sentidos, preserva chamado e permite voltar sem avisos ao humano",()=>{
 const a=openHumanRelay(db,config,{phone:user,message:"humano"});
 const paused=routeHumanRelay(db,config,{phone:user,text:"Preciso de ajuda",enabled:false});
 expect(paused.messages).toHaveLength(1);expect(paused.messages[0].recipient).toBe(user);
 expect(paused.messages[0].body).toContain("Nenhuma mensagem foi encaminhada");
 const response=routeHumanRelay(db,config,{phone:human,text:`RESPONDER ${a.ticketId} resposta`,enabled:false});
 expect(response.messages).toHaveLength(1);expect(response.messages[0].recipient).toBe(human);
 expect(db.prepare("SELECT status FROM bot_support_tickets WHERE id=?").get(a.ticketId)).toEqual({status:"OPEN"});
 const resume=routeHumanRelay(db,config,{phone:user,text:"VOLTAR AO BOT",enabled:false});
 expect(resume.messages).toHaveLength(1);expect(resume.messages[0].recipient).toBe(user);
 expect(db.prepare("SELECT status FROM bot_support_tickets WHERE id=?").get(a.ticketId)).toEqual({status:"CLOSED"});
 });
 it("anexo só gera aviso explícito e orientação para texto, nunca finge arquivo encaminhado",()=>{
 openHumanRelay(db,config,{phone:user,message:"humano"});
 const response=routeHumanRelay(db,config,{phone:user,text:"",media:true});
 expect(response.messages[0].recipient).toBe(human);
 expect(response.messages[0].body).toContain("arquivo NÃO foi encaminhado");
 expect(response.messages[1].body).toContain("Escreva sua dúvida em texto");
 });
 it("não cria loop para o próprio humano e mensagem comum não é relayed",()=>{
 expect(openHumanRelay(db,config,{phone:human,message:"humano"}).ticketId).toBeNull();
 expect(routeHumanRelay(db,config,{phone:human,text:"oi"}).handled).toBe(false);
 expect(routeHumanRelay(db,config,{phone:user,text:"oi"}).handled).toBe(false);
 });
});
