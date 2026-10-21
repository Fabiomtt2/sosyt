import Database from "better-sqlite3";
import { mkdtempSync,rmSync,statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect,it } from "vitest";
import { backupBeforeQueuePassMigration } from "./db.js";
import { initializePassQueues } from "./pass-queue.js";

it("backup anterior ao Passe captura WAL e permanece intacto após migração idempotente",async()=>{
 const folder=mkdtempSync(join(tmpdir(),"sos-pass-backup-")),filename=join(folder,"legacy.sqlite");
 const db=new Database(filename);
 try{
  db.pragma("journal_mode=WAL");
  db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT); INSERT INTO users VALUES('synthetic','Estado anterior preservado');");
  const backup=await backupBeforeQueuePassMigration(filename);
  expect(backup).toBeTruthy();expect(statSync(backup!).mode&0o777).toBe(0o600);
  const saved=new Database(backup!,{readonly:true});
  try{
   expect(saved.pragma("quick_check",{simple:true})).toBe("ok");
   expect(saved.prepare("SELECT name FROM users WHERE id='synthetic'").get()).toEqual({name:"Estado anterior preservado"});
   expect(saved.prepare("SELECT 1 FROM sqlite_master WHERE name='queue_pass_requests'").get()).toBeUndefined();
  }finally{saved.close();}
  initializePassQueues(db);initializePassQueues(db);
  // Backup remains necessary if another additive community/selection table is missing.
  expect(await backupBeforeQueuePassMigration(filename)).toBeTruthy();
  for(const name of ["social_blocks","community_config","community_preferences","friendships","community_notifications","community_audit","coin_transfers","direct_message_requests","playlist_selections","participant_access_restrictions","participant_access_audit"])db.exec("CREATE TABLE "+name+"(id TEXT)");
  // The new playlist archive also requires a snapshot before its first migration.
  expect(await backupBeforeQueuePassMigration(filename)).toBeTruthy();
  db.exec("CREATE TABLE playlist_selection_history(id TEXT)");
  expect(await backupBeforeQueuePassMigration(filename)).toBeUndefined();
  expect(db.prepare("SELECT name FROM users WHERE id='synthetic'").get()).toEqual({name:"Estado anterior preservado"});
 }finally{db.close();rmSync(folder,{recursive:true,force:true});}
});
