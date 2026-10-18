import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {buildApp} from "./app.js";
import {createDatabase,type AppDatabase} from "./db.js";
import {loadConfig,type Config} from "./config.js";
import {ensureSelfServiceAccount} from "./whatsapp.js";
import {decryptToken} from "./youtube.js";
import {resolveStoredPhone} from "./phone-identity.js";
describe("senha recebida abre conta antes da adesão ao grupo",()=>{
 let db:AppDatabase,config:Config,app:Awaited<ReturnType<typeof buildApp>>;
 const phone="557186907800",typed="5571986907800";
 beforeEach(async()=>{
  db=createDatabase(":memory:");config=loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",AUTH_DEV_MODE:"false",REQUIRE_GROUP_MEMBERSHIP:"true",
   EVOLUTION_URL:"https://evolution.example.test",EVOLUTION_INSTANCE:"sos-primary",EVOLUTION_PHONE:"5571999990999",EVOLUTION_API_KEY:"synthetic-evolution-key",
   EVOLUTION_WEBHOOK_SECRET:"synthetic-webhook-secret-32-long",WHATSAPP_MODE:"EVOLUTION",JWT_SECRET:"synthetic-admission-jwt-secret-32"});
  app=await buildApp(config,db);
 });
 afterEach(async()=>{await app.close();db.close();});
 function signup(){
  const user=ensureSelfServiceAccount(db,config,phone,"Pessoa Sintetica");
  const row=db.prepare("SELECT payload FROM whatsapp_outbox WHERE dedupe_key=?").get("bot-password:"+user.userId) as {payload:string};
  const body=JSON.parse(decryptToken(JSON.parse(row.payload).encryptedNotification,config)).text.body as string;
  const password=/é: ([A-Za-z0-9]{14})\./u.exec(body)?.[1];
  expect(password).toBeTruthy();return {...user,password};
 }
 it("PN brasileiro sem nono dígito aceita forma do formulário, permite trocar senha e não libera fila sem grupo",async()=>{
  const user=signup();
  const login=await app.inject({method:"POST",url:"/auth/password/login",payload:{phone:typed,password:user.password}});
  expect(login.statusCode,login.body).toBe(200);expect(login.json().user.phone).toBe(phone);
  const headers={authorization:"Bearer "+login.json().token};
  const dashboard=await app.inject({url:"/dashboard",headers});expect(dashboard.statusCode,dashboard.body).toBe(200);
  expect(dashboard.json().groupAccess).toMatchObject({ready:false,state:"JOINING"});
  expect((await app.inject({method:"POST",url:"/rounds/current/submissions",headers,payload:{url:"https://youtu.be/abcdefghijk"}})).statusCode).toBe(403);
  const changed=await app.inject({method:"POST",url:"/auth/password/set",headers,payload:{currentPassword:user.password,newPassword:"NovaSenhaValida123"}});
  expect(changed.statusCode,changed.body).toBe(200);
  expect((await app.inject({method:"POST",url:"/auth/password/login",payload:{phone:typed,password:user.password}})).statusCode).toBe(401);
  expect((await app.inject({method:"POST",url:"/auth/password/login",payload:{phone:typed,password:"NovaSenhaValida123"}})).statusCode).toBe(200);
  db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES(?,'1',?,'VERIFIED_EVOLUTION')").run(phone,new Date().toISOString());
  const member=await app.inject({url:"/dashboard",headers});
  expect(member.json().groupAccess).toMatchObject({ready:true,state:"MEMBER"});
  expect(member.json().user.groupCode).toBe("1");
 });
 it("Root configurado não recebe senha comum pela variante brasileira sem nono dígito",()=>{
  const rootConfig={...config,OWNER_FABIO_ID:"root",OWNER_FABIO_NAME:"Fabio0",OWNER_FABIO_WHATSAPP:typed,OWNER_FABIO_SECRET:"synthetic-root-secret-32-characters"};
  const result=ensureSelfServiceAccount(db,rootConfig,phone,"Fabio");
  expect(result.passwordSent).toBe(false);
  expect(db.prepare("SELECT 1 FROM user_passwords WHERE user_id=?").get(result.userId)).toBeUndefined();
  expect(db.prepare("SELECT 1 FROM bot_password_deliveries WHERE user_id=?").get(result.userId)).toBeUndefined();
 });
 it("não procura senha em outra conta quando a forma exata já existe",()=>{
  signup();const at=new Date().toISOString();
  db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES('exact','Conta distinta',?,'',?,?)").run(typed,at,at);
  expect(resolveStoredPhone(db,typed)).toBe(typed);
  expect(resolveStoredPhone(db,phone)).toBe(phone);
  expect(resolveStoredPhone(db,"12025550187")).toBe("12025550187");
 });
});
