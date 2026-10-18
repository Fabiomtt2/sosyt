import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {createDatabase,type AppDatabase} from "./db.js";
import {botProgressReply} from "./bot-progress-replies.js";
import {classifyInbound} from "./bot-inbound.js";
describe("bot reads persisted progress without mutating engines",()=>{
 let db:AppDatabase;
 const phone="557198765432",now="2026-10-18T12:00:00.000Z";
 beforeEach(()=>{
  db=createDatabase(":memory:");
  db.prepare("INSERT OR IGNORE INTO groups(code,enabled) VALUES(\'1\',1)").run();
  db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES('u','Lia',?,'1',?,?)").run(phone,now,now);
  db.prepare("INSERT INTO wallets(user_id,promo_millis,purchased_millis,reward_millis,extra_slot_passes,updated_at) VALUES('u',10000,2000,3000,2,?)").run(now);
 });
 afterEach(()=>db.close());
 it("recognizes live commands before accepting commands as names",()=>{
  for(const command of ["ranking","meu nível","xp","carteira"])expect(classifyInbound(command,{awaitingName:true})).toBe("HELP");
  expect(classifyInbound("minhas filas",{awaitingName:true})).toBe("QUEUE_INFO");
  expect(classifyInbound("Frank",{awaitingName:true})).toBe("NAME_CANDIDATE");
  expect(botProgressReply(db,phone,"oi")).toBeUndefined();
 });
 it("shows actual wallet and phone alias without granting XP",()=>{
  const before=db.prepare("SELECT total_changes() AS n").get();
  const reply=botProgressReply(db,"5571998765432","carteira");
  expect(reply).toContain("Lia,");expect(reply).toContain("Nível 1 · 0 XP");
  expect(reply).toContain("Moedas: 15");expect(reply).toContain("Compradas: 2 · Recompensas: 3 · Promocionais: 10");
  expect(reply).toContain("Passe: 2 · Pular: 0");expect(reply).toContain("SUPER: inativo");
  expect(db.prepare("SELECT total_changes() AS n").get()).toEqual(before);
 });
 it("does not invent queue access before real membership",()=>{
  expect(botProgressReply(db,phone,"minhas filas")).toContain("entrada no grupo ainda precisa ser confirmada");
 });
 it("only lists current participation, hiding finalized, closed or left queues",()=>{
  db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at) VALUES(?,'1',?)").run(phone,now);
  const round=(db.prepare("SELECT id FROM rounds LIMIT 1").get() as {id:string}).id;
  db.prepare("INSERT INTO round_participants(round_id,user_id,joined_at) VALUES(?,'u',?)").run(round,now);
  expect(botProgressReply(db,phone,"minhas filas")).toContain("Fila 1 · 0/10");
  db.prepare("UPDATE round_participants SET left_at=? WHERE user_id='u'").run(now);
  expect(botProgressReply(db,phone,"minhas filas")).not.toContain("Fila 1 ·");
  db.prepare("UPDATE round_participants SET left_at=NULL WHERE user_id='u'").run();
  db.prepare("INSERT INTO playlist_watch_progress(round_id,user_id,watched_seconds_json,durations_json,percent,updated_at,finalized_at) VALUES(?,\'u\',\'[]\',\'[]\',100,?,?)").run(round,now,now);
  expect(botProgressReply(db,phone,"minhas filas")).not.toContain("Fila 1 ·");
  db.prepare("UPDATE playlist_watch_progress SET finalized_at=NULL WHERE user_id=\'u\'").run();
  db.prepare("UPDATE rounds SET closed_at=? WHERE id=?").run(now,round);
  expect(botProgressReply(db,phone,"minhas filas")).not.toContain("Fila 1 ·");
 });
 it("never shows counterfeit level or spendable balance for Root",()=>{
  db.prepare("INSERT INTO owner_access(id,user_id,phone,normalized_name,role,created_at,updated_at) VALUES('root','u',?,'lia','ROOT_OWNER',?,?)").run(phone,now,now);
  const reply=botProgressReply(db,phone,"xp")!;
  expect(reply).toContain("XP ilimitado");expect(reply).not.toContain("Nível 1");expect(reply).not.toContain("Moedas: 15");
  expect(botProgressReply(db,phone,"ranking")).toContain("fora da competição");
 });
 it("does not pretend to know an unregistered person's account",()=>{
  expect(botProgressReply(db,"5511988887777","ranking")).toContain("preparar seu acesso primeiro");
 });
});
