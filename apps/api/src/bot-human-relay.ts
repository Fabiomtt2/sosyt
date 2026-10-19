import { randomUUID } from "node:crypto";
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";
import { sameWhatsAppNumber } from "./bot-evolution.js";
import { humanSupportNumber } from "./bot-human-handoff.js";

type Ticket={id:string;phone:string;name:string|null;status:string};
export type RelayMessage={recipient:string;body:string;key:string};
export function ensureHumanRelay(db:AppDatabase){
  db.exec(`CREATE TABLE IF NOT EXISTS bot_support_tickets(
    id TEXT PRIMARY KEY,phone TEXT NOT NULL,name TEXT,status TEXT NOT NULL DEFAULT 'OPEN',
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS bot_support_one_open ON bot_support_tickets(phone) WHERE status='OPEN';`);
}
const stamp=()=>new Date().toISOString();
/** Human-readable codes coexist with historical 12-character hexadecimal tickets. */
function nextTicketId(db:AppDatabase){
  for(let i=0;i<20;i++){
    const id=randomUUID().replace(/-/g,"").slice(0,6).toUpperCase();
    if(!db.prepare("SELECT 1 FROM bot_support_tickets WHERE id=?").get(id))return id;
  }
  throw new Error("Não foi possível gerar um código de atendimento exclusivo.");
}
function instructions(id:string){
  return `Código do atendimento (copie):\n${id}\n\nPara responder, cole o código e escreva a mensagem na mesma mensagem do WhatsApp. Exemplo:\n${id} Olá! No que posso ajudar?\n\nTambém funciona: RESPONDER ${id} sua mensagem\nA pessoa recebe “Admin:” na conversa original com o BOT. Não abra outra conversa.\nPara concluir: ENCERRAR ${id}\nNão encaminhe senhas ou códigos de acesso.`;
}
function replyText(raw:string){
  const body=raw.trim();
  const pairs=[["\"","\""],["“","”"],["'","'"]];
  return pairs.some(([a,b])=>body.startsWith(a)&&body.endsWith(b)&&body.length>=2)?body.slice(1,-1).trim():body;
}
function close(db:AppDatabase,ticket:Ticket){
  db.prepare("UPDATE bot_support_tickets SET status='CLOSED',updated_at=? WHERE id=? AND status='OPEN'").run(stamp(),ticket.id);
  db.prepare("UPDATE whatsapp_conversations SET stage='ACTIVE',updated_at=? WHERE phone=? AND stage='HUMAN_REQUESTED'").run(stamp(),ticket.phone);
}
export function openHumanRelay(db:AppDatabase,config:Config,input:{phone:string;name?:string;message:string}){
  ensureHumanRelay(db);
  const support=humanSupportNumber(db,config);
  if(sameWhatsAppNumber(support,input.phone))return {ticketId:null,messages:[] as RelayMessage[]};
  let ticket=db.prepare("SELECT * FROM bot_support_tickets WHERE phone=? AND status='OPEN'").get(input.phone) as Ticket|undefined;
  if(!ticket){
    ticket={id:nextTicketId(db),phone:input.phone,name:input.name??null,status:"OPEN"};
    db.prepare("INSERT INTO bot_support_tickets(id,phone,name,created_at,updated_at) VALUES(?,?,?,?,?)").run(ticket.id,input.phone,input.name??null,stamp(),stamp());
  }
  return {ticketId:ticket.id,messages:[{recipient:support,key:"human-ticket",body:
    `🙋 Atendimento #${ticket.id}\nParticipante: ${input.name||"Participante"}\nMensagem: ${input.message.slice(0,500)}\n\n${instructions(ticket.id)}`}]};
}
export function routeHumanRelay(db:AppDatabase,config:Config,input:{phone:string;text:string;enabled?:boolean;media?:boolean}):{handled:boolean;messages:RelayMessage[]}{
  ensureHumanRelay(db);
  const support=humanSupportNumber(db,config),text=input.text.trim();
  const enabled=input.enabled!==false;
  const paused=(recipient:string):RelayMessage=>({recipient,key:"relay-paused",body:"O atendimento humano está pausado pelo gerenciamento. Nenhuma mensagem foi encaminhada. Seu chamado continua registrado. Para retomar o bot, envie VOLTAR AO BOT."});
  const tooLong=(recipient:string):RelayMessage=>({recipient,key:"relay-too-long",body:"Neste atendimento, envie até 3000 caracteres por mensagem. Este texto não foi encaminhado; divida-o em mensagens menores para enviar tudo."});
  const explicit=text.match(/^(responder|encerrar)\s+#?([a-z0-9]{6}|[a-f0-9]{12})(?:\s*[:—-]?\s+([\s\S]+))?$/i);
  const compact=text.match(/^#?([a-z0-9]{6}|[a-f0-9]{12})(?:\s*[:—-]?\s+([\s\S]+))?$/i);
  const compactAllowed=compact&&(sameWhatsAppNumber(support,input.phone)||Boolean(db.prepare("SELECT 1 FROM bot_support_tickets WHERE id=?").get(compact[1].toUpperCase())));
  const command=explicit??(compactAllowed?[compact![0],"responder",compact![1],compact![2]]:null);
  if(command){
    if(!sameWhatsAppNumber(support,input.phone))return {handled:true,messages:[{recipient:input.phone,key:"relay-denied",body:"Este comando é exclusivo do atendimento humano configurado."}]};
    const ticket=db.prepare("SELECT * FROM bot_support_tickets WHERE id=? AND status='OPEN'").get(command[2].toUpperCase()) as Ticket|undefined;
    if(!ticket)return {handled:true,messages:[{recipient:support,key:"relay-missing",body:"Chamado não encontrado ou já encerrado. Confira o identificador."}]};
    if(!enabled)return {handled:true,messages:[paused(support)]};
    if(command[1].toLowerCase()==="encerrar"){
      close(db,ticket);
      return {handled:true,messages:[
        {recipient:ticket.phone,key:"relay-closed-user",body:"O atendimento humano foi encerrado. 💛 Você pode continuar usando o bot: envie MENU. Se precisar, peça atendimento humano novamente."},
        {recipient:support,key:"relay-closed-human",body:`Chamado #${ticket.id} encerrado.`}]};
    }
    const body=replyText(command[3]??"");
    if(!body)return {handled:true,messages:[{recipient:support,key:"relay-empty",body:instructions(ticket.id)}]};
    if(body.length>3000)return {handled:true,messages:[tooLong(support)]};
    db.prepare("UPDATE bot_support_tickets SET updated_at=? WHERE id=?").run(stamp(),ticket.id);
    return {handled:true,messages:[
      {recipient:ticket.phone,key:"relay-response",body:`Admin: ${body}\n\nPode responder aqui mesmo. Para voltar ao atendimento automático, envie VOLTAR AO BOT.`},
      {recipient:support,key:"relay-queued",body:`Resposta do chamado #${ticket.id} registrada para envio. A entrega segue a fila do WhatsApp.`}]};
  }
  if(sameWhatsAppNumber(support,input.phone)){
    if(/^(responder|encerrar)\b/i.test(text))return {handled:true,messages:[{recipient:support,key:"relay-empty",body:"Não reconheci o código. Copie o código do aviso de atendimento e envie na mesma mensagem que sua resposta. Exemplo: ABC123 Olá! No que posso ajudar? Para encerrar: ENCERRAR ABC123."}]};
    return {handled:false,messages:[]};
  }
  const ticket=db.prepare("SELECT * FROM bot_support_tickets WHERE phone=? AND status='OPEN'").get(input.phone) as Ticket|undefined;
  if(!ticket)return {handled:false,messages:[]};
  if(/^voltar\s+ao\s+bot[.!]?$/i.test(text)){
    close(db,ticket);
    return {handled:true,messages:[
      {recipient:input.phone,key:"relay-resume",body:"Você voltou ao atendimento automático. 💛 Envie MENU para ver as opções."},
      ...(enabled?[{recipient:support,key:"relay-user-closed",body:`Chamado #${ticket.id}: a pessoa voltou ao bot e encerrou o atendimento.`}]:[])]};
  }
  if(!enabled)return {handled:true,messages:[paused(input.phone)]};
  if(input.media)return {handled:true,messages:[
    {recipient:support,key:"relay-media-alert",body:`Chamado #${ticket.id}: a pessoa enviou áudio, imagem ou outro anexo. O arquivo NÃO foi encaminhado: este atendimento pelo bot aceita somente texto. Oriente a pessoa a descrever a dúvida por escrito.
RESPONDER ${ticket.id} sua resposta`},
    {recipient:input.phone,key:"relay-media-user",body:"Seu chamado continua aberto. Avisei à equipe que você enviou um anexo, mas o arquivo não pode ser encaminhado por este atendimento. Escreva sua dúvida em texto para a equipe receber por esta conversa."}]};
  if(text.length>3000)return {handled:true,messages:[tooLong(input.phone)]};
  db.prepare("UPDATE bot_support_tickets SET updated_at=? WHERE id=?").run(stamp(),ticket.id);
  return {handled:true,messages:[
    {recipient:support,key:"relay-user-message",body:`💬 Chamado #${ticket.id} · ${ticket.name||"Participante"}\n${text}\n\n${instructions(ticket.id)}`},
    {recipient:input.phone,key:"relay-user-receipt",body:"Sua mensagem ficou registrada para a equipe humana responder por esta mesma conversa. 💛 Para voltar ao bot, envie VOLTAR AO BOT."}]};
}
