import {afterEach,beforeEach,expect,it} from "vitest";
import {createDatabase,type AppDatabase} from "./db.js";
import {activeRounds,closeRound,expireRounds,QUEUE_LIFETIME_MS} from "./queues.js";
let db:AppDatabase;
beforeEach(()=>{db=createDatabase(":memory:");});afterEach(()=>db.close());
it("expires at72h, conserves the queue and creates fresh display1 once",()=>{
 const now=Date.now(),old=activeRounds(db)[0].id;
 db.prepare("UPDATE rounds SET created_at=? WHERE id=?").run(new Date(now-QUEUE_LIFETIME_MS).toISOString(),old);
 expect(expireRounds(db,now)).toBe(1);
 expect(db.prepare("SELECT closed_at AS closed FROM rounds WHERE id=?").get(old)).toEqual({closed:new Date(now).toISOString()});
 const fresh=activeRounds(db);expect(fresh).toHaveLength(1);expect(fresh[0].displayNumber).toBe(1);expect(fresh[0].id).not.toBe(old);
 expect(expireRounds(db,now)).toBe(0);expect(activeRounds(db)).toEqual(fresh);
});
it("does not expire before the exact72h deadline",()=>{
 const now=Date.now(),id=activeRounds(db)[0].id;
 db.prepare("UPDATE rounds SET created_at=? WHERE id=?").run(new Date(now-QUEUE_LIFETIME_MS+1).toISOString(),id);
 expect(expireRounds(db,now)).toBe(0);expect(activeRounds(db)[0].id).toBe(id);
});
it("closing the only queue replaces1 and never deletes its UUID",()=>{
 const old=activeRounds(db)[0].id;closeRound(db,old);
 expect(activeRounds(db).map(row=>row.displayNumber)).toEqual([1]);
 expect(db.prepare("SELECT COUNT(*) AS n FROM rounds").get()).toEqual({n:2});
});
