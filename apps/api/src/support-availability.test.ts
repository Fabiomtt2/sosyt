import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { createDatabase,type AppDatabase } from "./db.js";
import { readSupportAvailability,saveSupportAvailability,supportAvailableNow } from "./support-availability.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { saveAutomationSettings } from "./bot-automation-store.js";
describe("configured human support availability",()=>{
 let db:AppDatabase;
 beforeEach(()=>{db=createDatabase(":memory:");});
 afterEach(()=>{db.close();vi.useRealTimers();});
 const root={id:"root:synthetic",name:"Root"};
 it("defaults to no invented opening hours",()=>{
  expect(readSupportAvailability(db,new Date("2026-10-18T05:00:00Z"))).toMatchObject({enabled:false,availableNow:true,timeZone:"America/Bahia"});
 });
 it("honors Bahia days and hour boundaries with an audit record",()=>{
  saveSupportAvailability(db,{enabled:true,days:[6],startHour:9,endHour:17},root);
  expect(supportAvailableNow(db,new Date("2026-10-17T11:59:00Z"))).toBe(false);
  expect(supportAvailableNow(db,new Date("2026-10-17T12:00:00Z"))).toBe(true);
  expect(supportAvailableNow(db,new Date("2026-10-17T20:00:00Z"))).toBe(false);
  expect(supportAvailableNow(db,new Date("2026-10-18T12:00:00Z"))).toBe(false);
  expect(db.prepare("SELECT event,field,actor_owner_id FROM bot_automation_audit").get()).toMatchObject({event:"SUPPORT_OFFHOURS",field:"availability",actor_owner_id:root.id});
 });
 it("an overnight shift belongs to the previous weekday after midnight",()=>{
  saveSupportAvailability(db,{enabled:true,days:[6],startHour:22,endHour:6},root);
  expect(supportAvailableNow(db,new Date("2026-10-18T05:00:00Z"))).toBe(true);
  expect(supportAvailableNow(db,new Date("2026-10-18T09:00:00Z"))).toBe(false);
 });
 it("rejects ambiguous shifts and invalid weekday duplicates",()=>{
  expect(()=>saveSupportAvailability(db,{enabled:true,days:[1],startHour:9,endHour:9},root)).toThrow();
  expect(()=>saveSupportAvailability(db,{enabled:true,days:[1,1],startHour:9,endHour:17},root)).toThrow();
 });
 it("out of hours still responds and alerts the human",async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-17T22:00:00Z"));
  const secret="synthetic-webhook-secret-32-characters";
  const config=loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",EVOLUTION_URL:"https://evolution.example.test",EVOLUTION_INSTANCE:"sos-primary",EVOLUTION_PHONE:"5511999999000",EVOLUTION_API_KEY:"synthetic-api-key",EVOLUTION_WEBHOOK_SECRET:secret});
  const app=await buildApp(config,db);
  try {
   saveSupportAvailability(db,{enabled:true,days:[6],startHour:9,endHour:17},root);
   saveAutomationSettings(db,"SUPPORT_OFFHOURS",{text:"Fora do horário, {nome}; a equipe foi avisada."},root);
   const payload={event:"MESSAGES_UPSERT",instance:"sos-primary",data:{key:{id:"outside-hours",remoteJid:"5511999999001@s.whatsapp.net"},messageTimestamp:Math.floor(Date.now()/1000),message:{conversation:"Tenho dúvidas"}}};
   expect((await app.inject({method:"POST",url:"/webhooks/whatsapp/evolution",headers:{"x-sos-webhook-secret":secret},payload})).statusCode).toBe(200);
   const rows=db.prepare("SELECT payload,dedupe_key AS dedupeKey FROM whatsapp_outbox").all() as Array<{payload:string;dedupeKey:string}>;
   expect(rows.some(r=>r.payload.includes("Fora do horário"))).toBe(true);
   expect(rows.some(r=>r.dedupeKey.endsWith(":human-ticket"))).toBe(true);
  }finally{await app.close();}
 });
});
