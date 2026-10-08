import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createDatabase } from "./db.js";
import { loadConfig } from "./config.js";
import { initializeWhatsAppIntegration,readWhatsAppIntegration,saveWhatsAppIntegration,effectiveWhatsAppConfig,validateMetaWhatsApp } from "./integrations.js";
import { whatsappConfigured,whatsappJoinUrl } from "./whatsapp.js";

const config=()=>loadConfig({NODE_ENV:"test",AUTH_DEV_MODE:"true",PAYMENTS_DEV_MODE:"true",DATABASE_PATH:":memory:",
 WHATSAPP_BUSINESS_PHONE:undefined,WHATSAPP_PHONE_NUMBER_ID:undefined,WHATSAPP_ACCESS_TOKEN:undefined,WHATSAPP_APP_SECRET:undefined,WHATSAPP_VERIFY_TOKEN:undefined,
 OWNER_FABIO_WHATSAPP:"5571999990001",OWNER_RAFAEL_WHATSAPP:"5571999990002"});
afterEach(()=>vi.unstubAllGlobals());
describe("número Business único, persistente e editável",()=>{
 it("inicializa o número aprovado e mantém edição após reabrir SQLite com outro default",()=>{
  const base=resolve("../../.local-tmp");mkdirSync(base,{recursive:true});
  const dir=mkdtempSync(join(base,"business-config-test-")),file=join(dir,"fixture.db");
  let db=createDatabase(file);
  try{
   const settings=config();initializeWhatsAppIntegration(db,settings);
   expect(readWhatsAppIntegration(db,settings).businessPhone).toBe("5571993978956");
   expect(db.prepare("SELECT value FROM integration_settings WHERE key='whatsapp.meta.business_phone'").get()).toEqual({value:"5571993978956"});
   const saved=saveWhatsAppIntegration(db,settings,{mode:"OFFICIAL",businessPhone:"+55 (71) 99999-9090"});
   expect(saved.businessPhone).toBe("5571999999090");
   expect(whatsappJoinUrl(effectiveWhatsAppConfig(db,settings))).toContain("wa.me/5571999999090");
   expect(settings.OWNER_FABIO_WHATSAPP).toBe("5571999990001");
   expect(settings.OWNER_RAFAEL_WHATSAPP).toBe("5571999990002");
   db.close();db=createDatabase(file);
   const alternate={...settings,WHATSAPP_BUSINESS_PHONE:"5571999998080"};
   initializeWhatsAppIntegration(db,alternate);
   expect(readWhatsAppIntegration(db,alternate).businessPhone).toBe("5571999999090");
   expect(whatsappJoinUrl(effectiveWhatsAppConfig(db,alternate))).toContain("wa.me/5571999999090");
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
 });
 it("rejeita telefone inválido sem gravar parcialmente os demais campos",()=>{
  const db=createDatabase(":memory:"),settings=config();
  try{
   initializeWhatsAppIntegration(db,settings);
   expect(()=>saveWhatsAppIntegration(db,settings,{mode:"EVOLUTION",businessPhone:"abc"})).toThrow();
   expect(readWhatsAppIntegration(db,settings)).toMatchObject({mode:"OFFICIAL",businessPhone:"5571993978956"});
  }finally{db.close();}
 });
 it("não libera remetente Meta de outro número e exige nova validação após troca",async()=>{
  const db=createDatabase(":memory:"),settings=config();
  try{
   initializeWhatsAppIntegration(db,settings);
   saveWhatsAppIntegration(db,settings,{mode:"OFFICIAL",phoneNumberId:"123456789",businessAccountId:"999999999",
    accessToken:"test-meta-token-long-enough",appSecret:"test-meta-app-secret",verifyToken:"test-verify-token-long"});
   expect(whatsappConfigured(effectiveWhatsAppConfig(db,settings))).toBe(false);
   let display="+55 71 99999-0000";
   const fetchMock=vi.fn(async()=>new Response(JSON.stringify({data:[{id:"123456789",display_phone_number:display}]}),{status:200}));
   vi.stubGlobal("fetch",fetchMock);
   await expect(validateMetaWhatsApp(db,settings)).rejects.toThrow("diferente");
   expect(readWhatsAppIntegration(db,settings).tokenValidatedAt).toBeUndefined();
   display="+55 71 99397-8956";
   await expect(validateMetaWhatsApp(db,settings)).resolves.toMatchObject({ok:true});
   expect(whatsappConfigured(effectiveWhatsAppConfig(db,settings))).toBe(true);
   saveWhatsAppIntegration(db,settings,{mode:"OFFICIAL",businessPhone:"+55 71 99999-9090"});
   expect(whatsappJoinUrl(effectiveWhatsAppConfig(db,settings))).toContain("wa.me/5571999999090");
   expect(readWhatsAppIntegration(db,settings)).toMatchObject({senderValidationRequired:true});
   expect(readWhatsAppIntegration(db,settings).tokenValidatedAt).toBeUndefined();
   expect(whatsappConfigured(effectiveWhatsAppConfig(db,settings))).toBe(false);
   expect(fetchMock).toHaveBeenCalledTimes(2); // Only identity lookups; no messages.
  }finally{db.close();}
 });
 it("não confirma resultado antigo quando outro Owner muda o número durante consulta Meta",async()=>{
  const db=createDatabase(":memory:"),settings=config();
  try{
   initializeWhatsAppIntegration(db,settings);
   saveWhatsAppIntegration(db,settings,{mode:"OFFICIAL",phoneNumberId:"123456789",businessAccountId:"999999999",accessToken:"test-meta-token-long-enough"});
   vi.stubGlobal("fetch",vi.fn(async()=>{
    saveWhatsAppIntegration(db,settings,{mode:"OFFICIAL",businessPhone:"5571999999090"});
    return new Response(JSON.stringify({data:[{id:"123456789",display_phone_number:"+55 71 99397-8956"}]}),{status:200});
   }));
   await expect(validateMetaWhatsApp(db,settings)).rejects.toThrow("mudou");
   expect(readWhatsAppIntegration(db,settings).tokenValidatedAt).toBeUndefined();
   expect(readWhatsAppIntegration(db,settings).senderValidationRequired).toBe(true);
  }finally{db.close();}
 });
});
