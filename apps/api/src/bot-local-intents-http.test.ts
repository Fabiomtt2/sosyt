import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {createDatabase,type AppDatabase} from "./db.js";
import {loadConfig} from "./config.js";
import {buildApp} from "./app.js";
import {classifyInbound} from "./bot-inbound.js";
import {setParticipantAccess} from "./participant-access.js";

describe("local intent fallback in the real WhatsApp webhook",()=>{
  let db:AppDatabase,app:Awaited<ReturnType<typeof buildApp>>;
  const phone="5511999999001",secret="synthetic-webhook-secret-32-characters";
  beforeEach(async()=>{
    db=createDatabase(":memory:");
    app=await buildApp(loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",EVOLUTION_URL:"https://evolution.example.test",EVOLUTION_INSTANCE:"sos-primary",EVOLUTION_PHONE:"5511999999000",EVOLUTION_API_KEY:"test-api-key",EVOLUTION_WEBHOOK_SECRET:secret}),db);
  });
  afterEach(async()=>{await app.close();db.close();});
  async function send(text:string){
    const response=await app.inject({method:"POST",url:"/webhooks/whatsapp/evolution",headers:{"x-sos-webhook-secret":secret},payload:{event:"MESSAGES_UPSERT",instance:"sos-primary",data:{key:{id:"local-nlu:"+text,remoteJid:"900000000001@lid",remoteJidAlt:phone+"@s.whatsapp.net"},messageTimestamp:Math.floor(Date.now()/1000),message:{conversation:text}}}});
    expect(response.statusCode).toBe(200);
    return (db.prepare("SELECT payload FROM whatsapp_outbox WHERE recipient=? ORDER BY rowid").all(phone)as {payload:string}[]).map(row=>(JSON.parse(row.payload)as {text?:{body:string}}).text?.body??"").join("\n");
  }
  it("understands an unknown paraphrase without inventing a purchase or price",async()=>{
    expect(classifyInbound("onde vejo os produtos")).toBe("UNKNOWN");
    const body=await send("onde vejo os produtos");
    expect(body).toContain("Abra Loja");
    expect(body).not.toMatch(/R\$|compra efetuada/i);
    expect(db.prepare("SELECT COUNT(*) AS n FROM payments").get()).toEqual({n:0});
  });
  it("wallet paraphrases read real balances without granting items or changing credentials",async()=>{
    const at=new Date().toISOString();
    db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES('wallet-person','Lia Sintética',?,'1',?,?)").run(phone,at,at);
    db.prepare("INSERT INTO wallets(user_id,promo_millis,purchased_millis,reward_millis,extra_slot_passes,updated_at) VALUES('wallet-person',10000,2000,3000,2,?)").run(at);
    const before=db.prepare("SELECT * FROM wallets WHERE user_id='wallet-person'").get();
    expect(classifyInbound("Quantas moedinhas eu tenho?")).toBe("UNKNOWN");
    const body=await send("Quantas moedinhas eu tenho?");
    expect(body).toContain("Lia Sintética,");
    expect(body).toContain("Moedas: 15");
    expect(body).toContain("Compradas: 2 · Recompensas: 3 · Promocionais: 10");
    expect(body).toContain("Passe: 2 · Pular: 0");
    expect(db.prepare("SELECT * FROM wallets WHERE user_id='wallet-person'").get()).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM payments").get()).toEqual({n:0});
    expect(db.prepare("SELECT COUNT(*) AS n FROM user_passwords").get()).toEqual({n:0});
  });
  it("wallet paraphrases never invent a balance for an unregistered number",async()=>{
    const body=await send("Quantas moedinhas eu tenho?");
    expect(body).toContain("preparar seu acesso primeiro");
    expect(body).not.toContain("Moedas:");
    expect(db.prepare("SELECT COUNT(*) AS n FROM participation_requests").get()).toEqual({n:0});
  });
  it("password inference explains explicit confirmation and never creates credentials",async()=>{
    expect(classifyInbound("minha credencial foi rejeitada")).toBe("UNKNOWN");
    const body=await send("minha credencial foi rejeitada");
    expect(body).toContain("responda 3");expect(body).toContain("Não alterei sua senha");
    expect(db.prepare("SELECT COUNT(*) AS n FROM user_passwords").get()).toEqual({n:0});
    expect(db.prepare("SELECT COUNT(*) AS n FROM bot_password_deliveries").get()).toEqual({n:0});
  });
  it("an ambiguous request uses the existing menu and never grants access",async()=>{
    const body=await send("quero produtos e playlist");
    expect(body).toContain("1. ENTRAR");
    expect(db.prepare("SELECT COUNT(*) AS n FROM participation_requests").get()).toEqual({n:0});
    expect(db.prepare("SELECT COUNT(*) AS n FROM round_participants").get()).toEqual({n:0});
  });
  it("name capture keeps its original priority",async()=>{
    db.prepare("INSERT INTO whatsapp_conversations(phone,stage,updated_at) VALUES(?,'WAITING_NAME',?)").run(phone,new Date().toISOString());
    const body=await send("https://exemplo.test/loja");
    expect(body).toContain("Me manda só o seu nome");
    expect(body).not.toContain("Abra Loja");
    expect(db.prepare("SELECT stage FROM whatsapp_conversations WHERE phone=?").get(phone)).toEqual({stage:"WAITING_NAME"});
  });
  it.each(["não quero falar com humano","não preciso de nova senha"])("does not run a negated explicit action: %s",async text=>{
    const at=new Date().toISOString();
    db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES('local-person','Pessoa Sintética',?,'1',?,?)").run(phone,at,at);
    db.prepare("INSERT INTO user_passwords(user_id,password_hash,must_change,attempts,updated_at) VALUES('local-person','synthetic-hash-preserved',0,0,?)").run(at);
    const before=db.prepare("SELECT * FROM user_passwords WHERE user_id='local-person'").get();
    const body=await send(text);
    expect(body).toContain("Não abri um atendimento nem alterei sua senha");
    expect(db.prepare("SELECT * FROM user_passwords WHERE user_id='local-person'").get()).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM bot_password_deliveries").get()).toEqual({n:0});
    expect(db.prepare("SELECT COUNT(*) AS n FROM bot_support_tickets").get()).toEqual({n:0});
    expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_conversations WHERE stage='HUMAN_REQUESTED'").get()).toEqual({n:0});
  });
  it("never infers an exception to an Owner revocation, but preserves explicit human support",async()=>{
    const at=new Date().toISOString();
    db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES('blocked-person','Pessoa Sintética',?,'1',?,?)").run(phone,at,at);
    setParticipantAccess(db,"blocked-person",true,"root-test","Suspensão sintética");
    for(const text of ["Pessoa Renomeada","Posso conversar com uma pessoa responsável?","Quantas moedinhas eu tenho?"]){
      expect(await send(text)).toContain("pausado pela administração");
    }
    expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox WHERE dedupe_key LIKE '%:access-blocked'").get()).toEqual({n:3});
    expect(db.prepare("SELECT COUNT(*) AS n FROM bot_support_tickets").get()).toEqual({n:0});
    await send("Tenho duvidas");
    expect(db.prepare("SELECT 1 FROM bot_support_tickets WHERE phone=? AND status='OPEN'").get(phone)).toBeTruthy();
    expect(db.prepare("SELECT 1 FROM participant_access_restrictions WHERE user_id='blocked-person' AND blocked_at IS NOT NULL").get()).toBeTruthy();
  });
});
