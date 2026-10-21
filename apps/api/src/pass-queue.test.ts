import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "./db.js";
import { activeRounds, joinRound, myRounds, openRound } from "./queues.js";
import { initializePassQueues, joinNextQueueWithPass, queuePassBalance, extraUrlAllowance } from "./pass-queue.js";

describe("Passe libera somente URL adicional na mesma fila", () => {
  let db: AppDatabase;
  const user = "pass-fixture";
  beforeEach(() => {
    db = createDatabase(":memory:"); initializePassQueues(db);
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,'Pessoa','5571999000011','1',?,?)").run(user, now, now);
    db.prepare("INSERT INTO wallets(user_id,extra_slot_passes,updated_at) VALUES(?,2,?)").run(user, now);
    joinRound(db, activeRounds(db)[0].id, user);
  });
  afterEach(() => db.close());

  it("estoque não libera URL antes do uso; dois usos somam duas URLs na mesma fila", () => {
    const first=activeRounds(db)[0]; expect(extraUrlAllowance(db,user,first.id)).toBe(0);
    const two=joinNextQueueWithPass(db,user,randomUUID(),first.id);
    const three=joinNextQueueWithPass(db,user,randomUUID(),first.id);
    expect(two.queue.id).toBe(first.id); expect(three.queue.id).toBe(first.id);
    expect(extraUrlAllowance(db,user,first.id)).toBe(2); expect(queuePassBalance(db,user)).toBe(0);
    expect(myRounds(db,user)).toHaveLength(1); expect(activeRounds(db)).toHaveLength(1);
    expect(db.prepare("SELECT source FROM round_participants WHERE round_id=? AND user_id=?").get(first.id,user)).toEqual({source:"FREE"});
  });
  it("sem alvo usa fila atual já inscrita e nunca abre outra",()=>{
    const first=activeRounds(db)[0],other=openRound(db);
    expect(joinNextQueueWithPass(db,user,randomUUID()).queue.id).toBe(first.id);
    expect(extraUrlAllowance(db,user,other)).toBe(0);expect(myRounds(db,user)).toHaveLength(1);expect(activeRounds(db)).toHaveLength(2);
  });
  it("retry não duplica débito, cota ou ledger e preserva referência",()=>{
    const first=activeRounds(db)[0],ref=randomUUID(),result=joinNextQueueWithPass(db,user,ref,first.id);
    expect(joinNextQueueWithPass(db,user,ref,first.id)).toMatchObject({replayed:true,queue:result.queue});
    expect(extraUrlAllowance(db,user,first.id)).toBe(1);expect(queuePassBalance(db,user)).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE kind='QUEUE_PASS_USED'").get()).toEqual({n:1});
    expect(()=>joinNextQueueWithPass(db,user,ref,openRound(db))).toThrow("Esta referência já foi usada em outra fila.");
  });
  it("não inscrito, saída, READY, encerrada ou expirada não consomem nem concedem cota",()=>{
    const current=activeRounds(db)[0],other=openRound(db);
    expect(()=>joinNextQueueWithPass(db,user,randomUUID(),other)).toThrow(/já participa/);
    for(const sql of ["UPDATE round_participants SET left_at='2026-01-01'", "UPDATE rounds SET status='READY'", "UPDATE rounds SET closed_at='2026-01-01'", "UPDATE rounds SET created_at='2020-01-01'"]){
      expect(()=>db.transaction(()=>{
        db.exec(sql);expect(()=>joinNextQueueWithPass(db,user,randomUUID(),current.id)).toThrow(/já participa/);
        throw new Error("rollback fixture");
      })()).toThrow("rollback fixture");
    }
    expect(extraUrlAllowance(db,user,current.id)).toBe(0);expect(queuePassBalance(db,user)).toBe(2);
  });

  it("sem Passe ou carteira em análise não modifica cota",()=>{
    const id=activeRounds(db)[0].id;
    db.prepare("UPDATE wallets SET extra_slot_passes=0 WHERE user_id=?").run(user);
    expect(()=>joinNextQueueWithPass(db,user,randomUUID(),id)).toThrow(/precisa de um Passe/);
    db.prepare("UPDATE wallets SET extra_slot_passes=2,payment_hold=1 WHERE user_id=?").run(user);
    expect(()=>joinNextQueueWithPass(db,user,randomUUID(),id)).toThrow(/em análise/);
    expect(extraUrlAllowance(db,user,id)).toBe(0);expect(queuePassBalance(db,user)).toBe(2);
  });
  it("falha no recibo reverte débito, cota e ledger",()=>{
    const id=activeRounds(db)[0].id;
    db.exec("CREATE TRIGGER reject_pass BEFORE INSERT ON queue_pass_requests BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
    expect(()=>joinNextQueueWithPass(db,user,randomUUID(),id)).toThrow(/fixture failure/);
    expect(extraUrlAllowance(db,user,id)).toBe(0);expect(queuePassBalance(db,user)).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE kind='QUEUE_PASS_USED'").get()).toEqual({n:0});
  });
  it("Root mantém estoque persistido, sem criar inscrição e com retry idempotente",()=>{
    const now=new Date().toISOString(),id=activeRounds(db)[0].id;
    db.prepare("INSERT INTO owner_access(id,user_id,phone,normalized_name,role,active,created_at,updated_at) VALUES('root-pass',?,'root-pass-fixture','root','ROOT_OWNER',1,?,?)").run(user,now,now);
    const ref=randomUUID();expect(joinNextQueueWithPass(db,user,ref,id).passesAvailable).toBe(Number.MAX_SAFE_INTEGER);
    expect(joinNextQueueWithPass(db,user,ref,id).replayed).toBe(true);expect(extraUrlAllowance(db,user,id)).toBe(1);
    expect(db.prepare("SELECT extra_slot_passes AS n FROM wallets WHERE user_id=?").get(user)).toEqual({n:2});expect(myRounds(db,user)).toHaveLength(1);
  });
  it("fila cheia não aceita Passe nem aumenta cota",()=>{
    const id=activeRounds(db)[0].id,now=new Date().toISOString();
    for(let slot=1;slot<=10;slot++)db.prepare("INSERT INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,created_at) VALUES(?,?,?,?,?,?,?)").run(randomUUID(),id,slot,user,"https://youtu.be/PASS"+slot,"PASS"+slot,now);
    expect(()=>joinNextQueueWithPass(db,user,randomUUID(),id)).toThrow(/já está completa/);
    expect(queuePassBalance(db,user)).toBe(2);expect(extraUrlAllowance(db,user,id)).toBe(0);
  });
  it("tarefa finalizada não permite reviver acesso usando Passe",()=>{
    const id=activeRounds(db)[0].id,now=new Date().toISOString();
    db.prepare("INSERT INTO playlist_watch_progress(round_id,user_id,watched_seconds_json,durations_json,percent,updated_at,finalized_at) VALUES(?,?,'[]','[]',100,?,?)").run(id,user,now,now);
    expect(()=>joinNextQueueWithPass(db,user,randomUUID(),id)).toThrow(/já participa/);
    expect(queuePassBalance(db,user)).toBe(2);expect(extraUrlAllowance(db,user,id)).toBe(0);
  });

});
