import {afterEach,beforeEach,describe,expect,it} from "vitest";
import Database from "better-sqlite3";
import {checkWatchPresence,confirmWatchPresence,initializeWatchPresence,PRESENCE_WINDOW_MS,PRESENCE_CHALLENGE_MS} from "./watch-presence.js";
describe("confirmação periódica global de acompanhamento",()=>{
 let db:Database.Database;
 const start=Date.parse("2026-10-21T00:00:00Z");
 beforeEach(()=>{db=new Database(":memory:");db.exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY);INSERT INTO users VALUES('a'),('b');CREATE TABLE watch_observation_state(user_id TEXT PRIMARY KEY,active INTEGER);INSERT INTO watch_observation_state VALUES('a',1),('b',1);");initializeWatchPresence(db);});
 afterEach(()=>db.close());
 it("abre cinco minutos e mantém limite persistido após reinicialização do módulo",()=>{
  expect(checkWatchPresence(db,"a",start)).toEqual({required:false,confirmedUntil:new Date(start+PRESENCE_WINDOW_MS).toISOString()});
  initializeWatchPresence(db);
  expect(checkWatchPresence(db,"a",start+PRESENCE_WINDOW_MS-1).required).toBe(false);
  const due=checkWatchPresence(db,"a",start+PRESENCE_WINDOW_MS);expect(due.required).toBe(true);
  expect(checkWatchPresence(db,"a",start+PRESENCE_WINDOW_MS+10)).toEqual(due);
 });
 it("nonce pertence à conta, só vale uma vez e confirmação desarma crédito parado",()=>{
  checkWatchPresence(db,"a",start);const due=checkWatchPresence(db,"a",start+PRESENCE_WINDOW_MS);if(!due.required)throw Error("challenge missing");
  expect(confirmWatchPresence(db,"b",due.challengeId,start+PRESENCE_WINDOW_MS+1)).toBe(false);
  expect(confirmWatchPresence(db,"a","wrong",start+PRESENCE_WINDOW_MS+1)).toBe(false);
  expect(confirmWatchPresence(db,"a",due.challengeId,start+PRESENCE_WINDOW_MS+1)).toBe(true);
  expect(confirmWatchPresence(db,"a",due.challengeId,start+PRESENCE_WINDOW_MS+2)).toBe(false);
  expect(db.prepare("SELECT active FROM watch_observation_state WHERE user_id='a'").get()).toEqual({active:0});
  expect(db.prepare("SELECT active FROM watch_observation_state WHERE user_id='b'").get()).toEqual({active:1});
  expect(checkWatchPresence(db,"a",start+PRESENCE_WINDOW_MS+2).required).toBe(false);
 });
 it("expiração não libera acompanhamento, gira nonce e rejeita o anterior",()=>{
  checkWatchPresence(db,"a",start);const first=checkWatchPresence(db,"a",start+PRESENCE_WINDOW_MS);if(!first.required)throw Error("challenge missing");
  const later=start+PRESENCE_WINDOW_MS+PRESENCE_CHALLENGE_MS;
  expect(confirmWatchPresence(db,"a",first.challengeId,later)).toBe(false);
  const next=checkWatchPresence(db,"a",later);expect(next.required).toBe(true);
  if(!next.required)throw Error("challenge missing");expect(next.challengeId).not.toBe(first.challengeId);
  expect(confirmWatchPresence(db,"a",first.challengeId,later+1)).toBe(false);
  expect(confirmWatchPresence(db,"a",next.challengeId,later+1)).toBe(true);
 });
});
