import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createDatabase,type AppDatabase} from "./db.js";
import {loadConfig,type Config} from "./config.js";
import {queueBotNotification,queueGroupAutomation,flushWhatsAppOutbox} from "./whatsapp.js";
import {saveBotSettings} from "./bot.js";
import {captureQueueEvent} from "./bot-queue-snapshot.js";
import {announceToGroups} from "./bot-announce.js";
describe('durable interactive priority and current queue facts',()=>{
 let db:AppDatabase,config:Config;
 const at=new Date('2026-10-18T15:00:00Z'),group='123456789@g.us',person='5511999999001';
 let sent:{number:string;text:string}[];
 beforeEach(()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(at);vi.spyOn(Math,'random').mockReturnValue(0);
  db=createDatabase(':memory:');
  config=loadConfig({NODE_ENV:'test',DATABASE_PATH:':memory:',EVOLUTION_URL:'https://evolution.example.test',EVOLUTION_INSTANCE:'sos-primary',EVOLUTION_PHONE:'5511999999000',EVOLUTION_API_KEY:'synthetic',EVOLUTION_WEBHOOK_SECRET:'synthetic-webhook-secret-32-characters'});
  db.prepare("INSERT INTO groups(code,enabled,whatsapp_group_id) VALUES('1',1,?)").run(group);
  sent=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,options?:{body?:string})=>{
   if(url.includes('/message/sendText/'))sent.push(JSON.parse(options!.body!));
   return new Response(JSON.stringify(url.includes('connectionState')?{instance:{state:'open'}}:url.includes('fetchInstances')?[{name:'sos-primary',ownerJid:'5511999999000@s.whatsapp.net'}]:{key:{id:'confirmed'}}),{status:200});
  }));
 });
 afterEach(()=>{db.close();vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
 it('interactive DM overtakes older group work while the same global gap is enforced',async()=>{
  queueGroupAutomation(db,config,group,'Grupo antigo','older-group',{event:'QUEUE_OPEN',deliveryClass:'QUEUE'});
  queueBotNotification(db,config,person,'Resposta ao pedido humano','human-reply',undefined,{deliveryClass:'TRANSACTIONAL',event:'HUMAN_FALLBACK'});
  await flushWhatsAppOutbox(db,config,10);
  expect(sent.map(s=>s.number)).toEqual([person]);
  expect(db.prepare("SELECT status,last_error FROM whatsapp_outbox WHERE dedupe_key='older-group'").get()).toEqual({status:'PENDING',last_error:'EVOLUTION_CADENCE_OR_BREAKER'});
  await flushWhatsAppOutbox(db,config,10);expect(sent).toHaveLength(1);
  vi.setSystemTime(at.getTime()+8000);await flushWhatsAppOutbox(db,config,10);
  expect(sent.map(s=>s.number)).toEqual([person,group]);
  expect(db.prepare('SELECT COUNT(*) AS n FROM evolution_delivery_attempts').get()).toEqual({n:2});
 });
 it('persists immutable upload reference then renders actual occupancy at delivery',async()=>{
  const round=(db.prepare('SELECT id FROM rounds LIMIT 1').get() as {id:string}).id;
  db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES('u','Pessoa',?,'1',?,?)").run(person,at.toISOString(),at.toISOString());
  const add=(id:string,slot:number)=>db.prepare("INSERT INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,created_at) VALUES(?,?,?,'u',?,?,?)").run(id,round,slot,'https://youtu.be/'+id,id,at.toISOString());
  add('video000001',1);
  announceToGroups(db,config,'UPLOAD_NOTICE',{nome:'Pessoa',sala:'1',posicao:1,aba:1,fila:1,url:'https://youtu.be/video000001'},{dedupeKey:'video000001',ctx:{groupCode:'1'},now:at});
  const row=db.prepare('SELECT payload FROM whatsapp_outbox').get() as {payload:string};
  expect(JSON.parse(row.payload)._queueSnapshot.roundId).toBe(round);
  add('video000002',2);
  db.prepare('UPDATE rounds SET display_number=2 WHERE id=?').run(round);
  await flushWhatsAppOutbox(db,config,10);
  expect(sent).toHaveLength(1);
  expect(sent[0].text).toContain('Registro do envio');
  expect(sent[0].text).toContain('agora aparece como Fila 2');
  expect(sent[0].text).toContain('Fila 2: 2/10 links 🟪🟪⬜');
  expect(sent[0].text.length).toBeLessThanOrEqual(4096);
  expect(captureQueueEvent(db,'UPLOAD_NOTICE','missing',{},at.toISOString())).toBeUndefined();
 });
 it('closed source cannot masquerade as a reused display slot',async()=>{
  const round=(db.prepare('SELECT id FROM rounds LIMIT 1').get() as {id:string}).id;
  const snapshot=captureQueueEvent(db,'QUEUE_OPEN',round,{fila:1},at.toISOString())!;
  queueGroupAutomation(db,config,group,'Fila 1 foi aberta','historical-closed',{event:'QUEUE_OPEN',deliveryClass:'QUEUE',queueSnapshot:snapshot});
  db.prepare('UPDATE rounds SET closed_at=? WHERE id=?').run(at.toISOString(),round);
  await flushWhatsAppOutbox(db,config,10);
  expect(sent[0].text).toContain('fila deste registro já foi encerrada');
  expect(sent[0].text).not.toContain('agora aparece como Fila 1');
 });
 it('reserves the last group slot for night without exceeding the hard daily cap',async()=>{
  for(let n=0;n<6;n++)queueGroupAutomation(db,config,group,'Upload '+n,'reserve-'+n,{event:'UPLOAD_NOTICE',deliveryClass:'QUEUE'});
  for(let n=0;n<6;n++){vi.setSystemTime(at.getTime()+n*21000);await flushWhatsAppOutbox(db,config,10);}
  expect(sent).toHaveLength(5);
  expect(db.prepare("SELECT last_error AS reason FROM whatsapp_outbox WHERE dedupe_key='reserve-5'").get()).toEqual({reason:'EVOLUTION_GREETING_CAPACITY_RESERVED'});
  vi.setSystemTime(new Date('2026-10-18T23:00:00Z'));
  queueGroupAutomation(db,config,group,'Boa noite','reserved-night',{event:'GOOD_NIGHT',deliveryClass:'ENGAGEMENT'});
  await flushWhatsAppOutbox(db,config,10);
  expect(sent).toHaveLength(6);expect(sent[5].text).toContain('Boa noite');
  expect(db.prepare("SELECT COUNT(*) AS n FROM evolution_delivery_attempts").get()).toEqual({n:6});
 });

 it('group-only suppresses stale private reward jobs, keeps gifts in-app and preserves human replies',async()=>{
  queueBotNotification(db,config,person,'Recompensa antiga','old-reward',undefined,{deliveryClass:'REWARD',event:'LEVEL_UP'});
  saveBotSettings(db,{features:{COMMUNITY_GROUP_ONLY:true}});
  expect(queueBotNotification(db,config,person,'Dados da compra','private-purchase',undefined,{deliveryClass:'TRANSACTIONAL',event:'PURCHASE_CONFIRMED'})).toMatchObject({queued:false,reason:'COMMUNITY_IN_APP_ONLY'});
  queueBotNotification(db,config,person,'Admin: Como posso ajudar?','requested-help',undefined,{deliveryClass:'TRANSACTIONAL',event:'HUMAN_FALLBACK'});
  await flushWhatsAppOutbox(db,config,10);
  expect(sent).toHaveLength(1);expect(sent[0].text).toContain('Admin:');
  expect(db.prepare("SELECT status,last_error FROM whatsapp_outbox WHERE dedupe_key='old-reward'").get()).toEqual({status:'FAILED',last_error:'COMMUNITY_GROUP_ONLY'});
  expect(db.prepare("SELECT 1 FROM whatsapp_outbox WHERE dedupe_key='private-purchase'").get()).toBeUndefined();
 });

});
