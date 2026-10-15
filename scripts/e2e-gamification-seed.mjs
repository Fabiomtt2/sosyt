// Isolated browser fixture only: never reads environment database paths.
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { recordVerifiedXp, gamificationConfig } from "../apps/api/src/gamification.ts";
const path=resolve(".local-tmp/browser-test.db");
const userId=process.argv[2];
if(!/^[0-9a-f-]{36}$/.test(userId??""))throw new Error("Fixture user UUID required");
const db=new Database(path);
const now=new Date().toISOString();
const max=db.prepare("SELECT MAX(sequence) AS n FROM rounds").get().n??0;
db.transaction(()=>{
 for(let roundNo=0;roundNo<24;roundNo++){
  const round=randomUUID();
  db.prepare("INSERT INTO rounds(id,sequence,status,created_at,completed_at,closed_at,display_number) VALUES(?,?,'READY',?,?,?,?)").run(round,max+roundNo+1,now,now,now,max+roundNo+1);
  for(let slot=1;slot<=10;slot++)db.prepare("INSERT INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,created_at,video_duration_seconds) VALUES(?,?,?,?,?,?,?,100)").run(randomUUID(),round,slot,userId,"https://youtu.be/abcdefghijk",String(roundNo).padStart(3,"0")+String(slot).padStart(2,"0")+"fixture",now);
  const intervals=Object.fromEntries(Array.from({length:10},(_,i)=>[i,[[0,100]]]));
  db.prepare("INSERT INTO playlist_watch_progress(round_id,user_id,watched_seconds_json,durations_json,percent,observed_intervals_json,updated_at,finalized_at) VALUES(?,?,?,?,100,?,?,?)").run(round,userId,JSON.stringify(Array(10).fill(100)),JSON.stringify(Array(10).fill(100)),JSON.stringify(intervals),now,now);
  for(let index=0;index<10;index++)recordVerifiedXp(db,userId,round,index);
 }
 // Seed a historical verified-time reward for currency-flow tests, separately
 // from purchased credits; the real watch clock/ledger is covered by API tests.
 db.prepare("UPDATE wallets SET reward_millis=230000 WHERE user_id=?").run(userId);
 db.prepare("INSERT INTO wallet_ledger(id,user_id,kind,amount_millis,reference_id,created_at,note) VALUES(?,?,'WATCH_TIME',141000,'fixture-historical-time',?,?)").run(randomUUID(),userId,now,"Isolated historical verified-time fixture");
}).immediate();
db.close();
