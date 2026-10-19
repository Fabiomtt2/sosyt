import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createDatabase,type AppDatabase} from "./db.js";
import {loadConfig,type Config} from "./config.js";
import {ensureParticipantAccessSchema,setParticipantAccess} from "./participant-access.js";
import {ensureBotPassword,reissueBotPassword} from "./bot-password.js";
import {enqueueGroupJoin,processGroupJoin} from "./bot-group-join.js";
import {createEvolutionClient} from "./bot-evolution.js";
import {ensureSelfServiceAccount,flushWhatsAppOutbox} from "./whatsapp.js";
import {materializeApprovedMembership,recordGroupVerification,recordMemberVerification} from "./group-verification.js";
describe('bot cannot undo administrative account revocation without a membership row',()=>{
 let db:AppDatabase,config:Config;
 const phone='5511999990001',at='2026-10-18T15:00:00Z';
 beforeEach(()=>{
  db=createDatabase(':memory:');ensureParticipantAccessSchema(db);
  config=loadConfig({NODE_ENV:'test',DATABASE_PATH:':memory:',EVOLUTION_URL:'https://evolution.example.test',EVOLUTION_INSTANCE:'sos-primary',EVOLUTION_PHONE:'5511999999000',EVOLUTION_API_KEY:'synthetic',EVOLUTION_WEBHOOK_SECRET:'synthetic-webhook-secret-32-characters'});
  db.prepare("INSERT INTO groups(code,enabled,whatsapp_group_id) VALUES('1',1,'123@g.us')").run();
  db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES('u','Pessoa',?,'',?,?)").run(phone,at,at);
  db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES('u',?)").run(at);
  db.prepare("INSERT INTO participation_requests(id,phone,name,status,created_at,updated_at) VALUES('r',?,'Pessoa','APPROVED',?,?)").run(phone,at,at);
 });
 afterEach(()=>{db.close();vi.unstubAllGlobals();});
 const block=()=>setParticipantAccess(db,'u',true,'root-fixture','Bloqueio sintético');
 it('blocks first password, reissue, alias onboarding and queued admission without changing state',async()=>{
  enqueueGroupJoin(db,phone);block();
  expect(ensureBotPassword(db,config,'u',true).reason).toBe('ACCOUNT_ACCESS_REVOKED');
  expect(reissueBotPassword(db,config,'u',true).reason).toBe('ACCOUNT_ACCESS_REVOKED');
  expect(enqueueGroupJoin(db,phone).reason).toBe('ACCOUNT_ACCESS_REVOKED');
  expect(()=>ensureSelfServiceAccount(db,config,phone,'Mudou')).toThrow('pausado');
  const c=createEvolutionClient({config:{url:'https://evolution.example.test',instance:'sos-primary',apiKey:'synthetic'},fetchImpl:vi.fn(()=>{throw new Error('Network must not run');})});
  expect(await processGroupJoin(db,config,c)).toMatchObject({reason:'ACCOUNT_ACCESS_REVOKED'});
  expect(db.prepare('SELECT name FROM users WHERE id=?').get('u')).toEqual({name:'Pessoa'});
  expect(db.prepare('SELECT COUNT(*) AS n FROM user_passwords').get()).toEqual({n:0});
  expect(db.prepare('SELECT COUNT(*) AS n FROM group_memberships').get()).toEqual({n:0});
 });
 it('real external membership cannot re-enable an administratively blocked account',()=>{
  block();recordGroupVerification(db,'EVOLUTION','1','123@g.us','SOS YOUTUBER 1',1,at);
  recordMemberVerification(db,'EVOLUTION','1',phone,'123@g.us',true,at);
  expect(materializeApprovedMembership(db,phone,'1').accessGranted).toBe(false);
  expect(db.prepare('SELECT 1 FROM group_memberships WHERE phone=?').get(phone)).toBeUndefined();
 });
 it('invalidates a pending password when Owner revokes before delivery',async()=>{
  expect(ensureBotPassword(db,config,'u',true)).toMatchObject({created:true,queued:true});
  const hash=db.prepare("SELECT password_hash FROM user_passwords WHERE user_id='u'").get();block();
  const send=vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('connectionState')?{instance:{state:'open'}}:[{name:'sos-primary',ownerJid:'5511999999000@s.whatsapp.net'}]),{status:200}));
  vi.stubGlobal('fetch',send);
  await flushWhatsAppOutbox(db,config);
  expect(db.prepare('SELECT status,last_error FROM whatsapp_outbox').get()).toEqual({status:'FAILED',last_error:'ACCOUNT_ACCESS_REVOKED'});
  expect(send.mock.calls.some(([url])=>url.includes('sendText'))).toBe(false);
  expect(reissueBotPassword(db,config,'u',true).reason).toBe('ACCOUNT_ACCESS_REVOKED');
  expect(db.prepare("SELECT password_hash FROM user_passwords WHERE user_id='u'").get()).toEqual(hash);
 });
 it('revocation during the external add await prevents local access materialization',async()=>{
  enqueueGroupJoin(db,phone);
  const c=createEvolutionClient({config:{url:'https://evolution.example.test',instance:'sos-primary',apiKey:'synthetic'}});
  let added=false;
  vi.spyOn(c,'groupParticipants').mockImplementation(async()=>added?[phone,'5511888888888']:['5511888888888']);
  vi.spyOn(c,'addParticipant').mockImplementation(async()=>{added=true;block();return {};});
  expect(await processGroupJoin(db,config,c)).toMatchObject({reason:'ACCOUNT_ACCESS_REVOKED'});
  expect(db.prepare('SELECT 1 FROM group_memberships WHERE phone=?').get(phone)).toBeUndefined();
  expect(db.prepare('SELECT status FROM group_join_requests WHERE phone=?').get(phone)).toEqual({status:'FAILED'});
 });

});
