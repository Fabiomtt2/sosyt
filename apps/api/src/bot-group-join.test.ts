import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createDatabase,type AppDatabase} from "./db.js";
import {loadConfig,type Config} from "./config.js";
import {createEvolutionClient} from "./bot-evolution.js";
import {enqueueGroupJoin,processGroupJoin} from "./bot-group-join.js";

describe("group join confirms real membership before granting access",()=>{
 let db:AppDatabase,config:Config;
 const phone="5511999990001",stamp="2026-10-18T03:00:00.000Z";
 beforeEach(()=>{
  db=createDatabase(":memory:");config=loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",WHATSAPP_MODE:"EVOLUTION",ALLOWED_GROUP_CODES:"1",JWT_SECRET:"synthetic-group-join-secret-32"});
  db.prepare("INSERT OR IGNORE INTO groups(code,enabled) VALUES('1',1)").run();
  db.prepare("UPDATE groups SET whatsapp_group_id='123@g.us',membership_mode='EVOLUTION' WHERE code='1'").run();
  db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES('u','Synthetic',?,'',?,?)").run(phone,stamp,stamp);
  db.prepare("INSERT INTO participation_requests(id,phone,name,status,created_at,updated_at) VALUES('r',?,'Synthetic','APPROVED',?,?)").run(phone,stamp,stamp);
  enqueueGroupJoin(db,phone,"Synthetic");
 });
 afterEach(()=>db.close());
 function client(presentAfter:boolean,status="200"){
  let added=false;
  const fetchImpl=vi.fn(async(url:string)=>({ok:true,status:200,json:async()=>url.includes("/participants/")
   ?{participants:added&&presentAfter?[{id:"100000000000001@lid",phoneNumber:phone+"@s.whatsapp.net"}]:[{id:"5511988888888@s.whatsapp.net"}]}
   :url.includes("updateParticipant")?(added=true,{participants:[{jid:phone+"@s.whatsapp.net",status}]})
   :{inviteCode:"synthetic-invite"}}));
  return createEvolutionClient({config:{url:"https://example.test",instance:"sos",apiKey:"synthetic"},fetchImpl});
 }
 it("confirms phoneNumber from LID metadata and grants dashboard group atomically",async()=>{
  expect(await processGroupJoin(db,config,client(true))).toMatchObject({added:true,groupCode:"1"});
  expect(db.prepare("SELECT group_code FROM users WHERE id='u'").get()).toEqual({group_code:"1"});
  expect(db.prepare("SELECT source,revoked_at FROM group_memberships WHERE phone=?").get(phone)).toEqual({source:"VERIFIED_EVOLUTION",revoked_at:null});
  expect(db.prepare("SELECT status FROM group_join_requests WHERE phone=?").get(phone)).toEqual({status:"DONE"});
 });
 it("200 without actual membership only offers an invite and never approves group access",async()=>{
  const sendInvite=vi.fn();expect(await processGroupJoin(db,config,client(false),{sendInvite})).toMatchObject({invited:true,reason:"EVOLUTION_MEMBERSHIP_NOT_CONFIRMED"});
  expect(sendInvite).toHaveBeenCalledOnce();expect(db.prepare("SELECT 1 FROM group_memberships WHERE phone=?").get(phone)).toBeUndefined();
  expect(db.prepare("SELECT group_code FROM users WHERE id='u'").get()).toEqual({group_code:""});
 });
 it("inner 403 offers invitation rather than DONE",async()=>{
  expect(await processGroupJoin(db,config,client(false,"403"))).toMatchObject({invited:true});
  expect(db.prepare("SELECT status FROM group_join_requests WHERE phone=?").get(phone)).toEqual({status:"INVITED"});
 });
 it("explicit revocation cannot be undone by the auto-join worker",async()=>{
  db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,revoked_at) VALUES(?,'1',?,?)").run(phone,stamp,stamp);
  const c=client(true),add=vi.spyOn(c,"addParticipant");
  expect(await processGroupJoin(db,config,c)).toMatchObject({escalated:true,reason:"MEMBERSHIP_REVOKED_REQUIRES_REVIEW"});
  expect(add).not.toHaveBeenCalled();
 });
 it.each(['missing','full'])("skips %s group 1 and uses verified group 2; ignores unpaired 3",async(mode)=>{
  db.prepare("INSERT INTO groups(code,enabled,whatsapp_group_id,membership_mode) VALUES('2',1,'222@g.us','EVOLUTION'),('3',1,NULL,'EVOLUTION')").run();
  const c=client(true);
  let added=false;
  vi.spyOn(c,'groupParticipants').mockImplementation(async(gid)=>{
    if(gid==='123@g.us'){
      if(mode==='missing')throw new Error('404');
      return mode==='full'?Array.from({length:1024},(_,i)=>'55119'+String(i).padStart(8,'0')):[];
    }
    return added?['5511988888888',phone]:['5511988888888'];
  });
  const add=vi.spyOn(c,'addParticipant').mockImplementation(async()=>{added=true;return {};});
  expect(await processGroupJoin(db,config,c)).toMatchObject({added:true,groupCode:'2'});
  expect(add).toHaveBeenCalledOnce();expect(add).toHaveBeenCalledWith('222@g.us',phone);
 });
 it("empty real group 1 is tried but admission still requires presence confirmation",async()=>{
  const c=client(true);vi.spyOn(c,'groupParticipants').mockResolvedValue([]);
  const add=vi.spyOn(c,'addParticipant');
  expect(await processGroupJoin(db,config,c)).toMatchObject({groupCode:'1',reason:'EVOLUTION_MEMBERSHIP_NOT_CONFIRMED'});
  expect(add).toHaveBeenCalledOnce();
  expect(db.prepare('SELECT 1 FROM group_memberships WHERE phone=?').get(phone)).toBeUndefined();
 });

 it("uses empty real1 before group2 once the new presence is confirmed",async()=>{
  db.prepare("INSERT INTO groups(code,enabled,whatsapp_group_id) VALUES('2',1,'222@g.us')").run();
  const c=client(true);let joined=false;
  vi.spyOn(c,'groupParticipants').mockImplementation(async gid=>gid==='123@g.us'?(joined?[phone]:[]):['5511888888888']);
  const add=vi.spyOn(c,'addParticipant').mockImplementation(async()=>{joined=true;return {};});
  expect(await processGroupJoin(db,config,c)).toMatchObject({added:true,groupCode:'1'});
  expect(add).toHaveBeenCalledWith('123@g.us',phone);
 });

 it("recognizes an existing LID-backed member in group 2 without adding them to empty group 1",async()=>{
  db.prepare("INSERT INTO groups(code,enabled,whatsapp_group_id) VALUES('2',1,'222@g.us')").run();
  const c=client(true);
  vi.spyOn(c,'groupParticipants').mockImplementation(async gid=>gid==='222@g.us'?[phone]:[]);
  const add=vi.spyOn(c,'addParticipant');
  expect(await processGroupJoin(db,config,c)).toMatchObject({added:true,alreadyMember:true,groupCode:'2'});
  expect(add).not.toHaveBeenCalled();
  expect(db.prepare("SELECT status,group_code FROM group_join_requests WHERE phone=?").get(phone)).toEqual({status:'DONE',group_code:'2'});
 });

});
