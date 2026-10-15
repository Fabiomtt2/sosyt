import { randomUUID } from "node:crypto";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { createDatabase,type AppDatabase } from "./db.js";
import { grantSuper } from "./super.js";
import { itemQuantity } from "./inventory.js";
import { initializeGamification,gamificationConfig,saveGamificationConfig,recordVerifiedXp,gamificationView,boosterView,claimBooster,redeemRewardItem,settleClosedMonths,leaderboards,trialSuperView,giftRewardCoins } from "./gamification.js";

describe("gamificação: cobertura verificada, recompensas e trilha",()=>{
  let db:AppDatabase;let round:string;
  const user=(id:string)=>{
    const now=new Date().toISOString();
    db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(id,id,"5571"+String(id.charCodeAt(0)).padStart(9,"0"),"1",now,now);
    db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES(?,?)").run(id,now);
    return id;
  };
  const coverage=(id:string,seconds:number,index=0,duration=100)=>{
    db.prepare("INSERT OR IGNORE INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,created_at,video_duration_seconds) VALUES(?,?,?,?,?,?,?,?)")
      .run(randomUUID(),round,index+1,id,"https://youtu.be/abcdefghijk","video"+index,new Date().toISOString(),duration);
    db.prepare("INSERT INTO playlist_watch_progress(round_id,user_id,watched_seconds_json,durations_json,percent,observed_intervals_json,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(round_id,user_id) DO UPDATE SET observed_intervals_json=excluded.observed_intervals_json")
      .run(round,id,"[]","[]",0,JSON.stringify({[index]:[[0,seconds]]}),new Date().toISOString());
    return recordVerifiedXp(db,id,round,index,seconds,duration);
  };
  const earned=(id:string)=>(db.prepare("SELECT reward_millis AS value FROM wallets WHERE user_id=?").get(id) as {value:number}).value/1000;
  const config=(patch:Partial<ReturnType<typeof gamificationConfig>>)=>{
    const c={...gamificationConfig(db),...patch};saveGamificationConfig(db,c,"root-fixture");return c;
  };
  beforeEach(()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-15T15:00:00Z"));
    db=createDatabase(":memory:");initializeGamification(db);
    round=(db.prepare("SELECT id FROM rounds LIMIT 1").get() as {id:string}).id;
  });
  afterEach(()=>{db.close();vi.useRealTimers();});
  it("XP só vem dos intervalos persistidos e duração confirmada, nunca de um percentual enviado",()=>{
    const id=user("a");
    expect(recordVerifiedXp(db,id,round,0,100000,1).xpDelta).toBe(0);
    coverage(id,0);
    db.prepare("UPDATE submissions SET video_duration_seconds=NULL WHERE round_id=?").run(round);
    expect(recordVerifiedXp(db,id,round,0,100000,1).xpDelta).toBe(0);
    expect(gamificationView(db,id).xp).toBe(0);
  });
  it("deltas são monotônicos, trechos sobrepostos/replay não duplicam XP nem moedas",()=>{
    const id=user("a");
    expect(coverage(id,40).xpDelta).toBe(40);
    expect(coverage(id,40).xpDelta).toBe(0);
    db.prepare("UPDATE playlist_watch_progress SET observed_intervals_json=? WHERE user_id=?").run('{"0":[[0,40],[20,60],[80,100]]}',id);
    expect(recordVerifiedXp(db,id,round,0).xpDelta).toBe(40);
    expect(coverage(id,100).levelRewards).toEqual([{level:2,coins:1,trialDays:0}]);
    expect(coverage(id,90).xpDelta).toBe(0);
    expect(gamificationView(db,id).xp).toBe(100);expect(earned(id)).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM gamification_bot_events").get()).toEqual({n:1});
  });
  it("configuração nova não reprecifica fontes/curva já iniciadas",()=>{
    const id=user("a");coverage(id,20);
    config({xpPerVideo:1000,curve:{firstStep:1,stepIncrease:0}});
    coverage(id,100);
    expect(gamificationView(db,id).xp).toBe(100);expect(gamificationView(db,id).level).toBe(2);
    coverage(id,100,1);expect(gamificationView(db,id).xp).toBe(1100);
    expect(gamificationView(db,id).level).toBe(6);
    expect(earned(id)).toBe(5);
  });
  it("a curva inicial100 e incremento50 avança exatamente nos limites",()=>{
    const id=user("a");coverage(id,100);
    coverage(id,100,1);expect(gamificationView(db,id).level).toBe(2);
    coverage(id,50,2);expect(gamificationView(db,id).level).toBe(3);
    expect(gamificationView(db,id).nextLevelXp).toBe(450);
  });
  it("nível30 oferece7dias de trial independente sem estender assinatura paga",()=>{
    const id=user("a");config({curve:{firstStep:1,stepIncrease:0}});
    const paid=grantSuper(db,id,{days:30,source:"PAYMENT",referenceId:"payment-1"});
    const result=coverage(id,29);
    expect(result.levelRewards.find(r=>r.level===30)).toEqual({level:30,coins:21,trialDays:7});
    expect(earned(id)).toBe(89);expect(trialSuperView(db,id).active).toBe(true);
    expect((db.prepare("SELECT expires_at AS at FROM super_subscriptions WHERE user_id=?").get(id) as {at:string}).at).toBe(paid.expiresAt);
    vi.advanceTimersByTime(7*86400000);expect(trialSuperView(db,id).active).toBe(false);
  });
  it("view é somente leitura e ledger de eventos é imutável",()=>{
    const id=user("a");coverage(id,50);const before=db.prepare("SELECT COUNT(*) AS n FROM gamification_events").get();
    gamificationView(db,id);boosterView(db,id);leaderboards(db);
    expect(db.prepare("SELECT COUNT(*) AS n FROM gamification_events").get()).toEqual(before);
    expect(()=>db.prepare("UPDATE gamification_events SET xp_delta=999").run()).toThrow(/Immutable/);
    expect(()=>db.prepare("DELETE FROM gamification_events").run()).toThrow(/Immutable/);
  });
  it("Booster usa sexta-feira06h até23:59 da Bahia e claim único por data",()=>{
    const id=user("a");
    vi.setSystemTime(new Date("2026-10-16T08:59:59Z"));expect(boosterView(db,id).available).toBe(false);
    expect(()=>claimBooster(db,id)).toThrow(/Booster/);
    vi.setSystemTime(new Date("2026-10-16T09:00:00Z"));expect(boosterView(db,id).available).toBe(true);
    const first=claimBooster(db,id),balance=earned(id);
    expect(first.replayed).toBe(false);expect(claimBooster(db,id).replayed).toBe(true);expect(earned(id)).toBe(balance);
    vi.setSystemTime(new Date("2026-10-17T02:59:59Z"));expect(boosterView(db,user("b")).available).toBe(true);
    vi.setSystemTime(new Date("2026-10-17T03:00:00Z"));expect(boosterView(db,id).available).toBe(false);
    vi.setSystemTime(new Date("2026-10-23T09:00:00Z"));expect(boosterView(db,id).available).toBe(true);
  });
  it("chances públicas somam100%; configuração inválida rejeitada; cada benefício real é entregue",()=>{
    const id=user("a"),c=gamificationConfig(db);
    expect(boosterView(db,id).odds.reduce((n,d)=>n+d.probabilityPercent,0)).toBe(100);
    expect(()=>config({boosterDrops:c.boosterDrops.map(d=>({...d,weight:1}))})).toThrow();
    vi.setSystemTime(new Date("2026-10-16T09:00:00Z"));
    config({boosterDrops:c.boosterDrops.map(d=>({...d,weight:d.code==="PASS"?10000:0}))});
    expect(claimBooster(db,id).reward.code).toBe("PASS");
    expect(db.prepare("SELECT extra_slot_passes AS n FROM wallets WHERE user_id=?").get(id)).toEqual({n:1});
    vi.setSystemTime(new Date("2026-10-23T09:00:00Z"));
    config({boosterDrops:c.boosterDrops.map(d=>({...d,weight:d.code==="SKIP"?10000:0}))});
    expect(claimBooster(db,id).reward.code).toBe("SKIP");expect(itemQuantity(db,id,"SKIP")).toBe(1);
  });
  it("troca usa somente rewardcoins e é idempotente, com referência vinculada ao item",()=>{
    const id=user("a");db.prepare("UPDATE wallets SET purchased_millis=999000,promo_millis=999000 WHERE user_id=?").run(id);
    expect(()=>redeemRewardItem(db,id,"SKIP",randomUUID())).toThrow(/recompensa/);
    db.prepare("UPDATE wallets SET reward_millis=200000 WHERE user_id=?").run(id);
    const ref=randomUUID();redeemRewardItem(db,id,"SKIP",ref);redeemRewardItem(db,id,"SKIP",ref);
    expect(itemQuantity(db,id,"SKIP")).toBe(1);expect(earned(id)).toBe(100);
    expect(()=>redeemRewardItem(db,id,"PASS",ref)).toThrow(/outro item/);
    redeemRewardItem(db,id,"PASS",randomUUID());expect(earned(id)).toBe(0);
    expect(db.prepare("SELECT purchased_millis AS purchased,extra_slot_passes AS passes FROM wallets WHERE user_id=?").get(id)).toEqual({purchased:999000,passes:1});
  });
  it("TOP3 paga15/10/5 uma única vez ao fechar o mês Bahia; admins ficam fora",()=>{
    vi.setSystemTime(new Date("2026-02-01T02:58:00Z"));
    for(const [id,n]of [["a",100],["b",80],["c",60],["d",50],["r",100]] as const){user(id);coverage(id,n);}
    db.prepare("INSERT INTO owner_access(id,user_id,phone,normalized_name,role,active,created_at,updated_at) VALUES('root','r','root-fixture','r','ROOT_OWNER',1,?,?)").run(new Date().toISOString(),new Date().toISOString());
    expect(leaderboards(db).month).toBe("2026-01");
    expect(leaderboards(db).monthly.map(r=>r.userId)).toEqual(["a","b","c","d"]);
    expect(settleClosedMonths(db).paid).toHaveLength(0);
    const balances=["a","b","c"].map(earned);
    config({monthlyRewards:[100,100,100]}); // the closed month keeps its earned snapshot
    vi.setSystemTime(new Date("2026-02-01T03:00:00Z"));
    expect(leaderboards(db).monthly).toEqual([]);
    expect(settleClosedMonths(db).paid.map(r=>r.coins)).toEqual([15,10,5]);
    expect(["a","b","c"].map((id,i)=>earned(id)-balances[i])).toEqual([15,10,5]);
    expect(settleClosedMonths(db).paid).toEqual([]);
    expect(leaderboards(db).permanent).toHaveLength(4);
  });
  it("empate é estável por horário de alcance e id; histórico de cada pessoa não vaza",()=>{
    for(const id of ["b","a","c"]){user(id);coverage(id,50);}
    expect(leaderboards(db).monthly.map(r=>r.userId)).toEqual(["a","b","c"]);
    expect(JSON.stringify(leaderboards(db))).not.toContain("phone");
    const history=gamificationView(db,"a").history;
    expect(history).toHaveLength(1);expect(history[0].xpDelta).toBe(50);
  });
  it("transferência preserva origem recompensa, atomicidade e replay alvo/quantidade",()=>{
    user("a");user("b");user("c");
    db.prepare("UPDATE wallets SET purchased_millis=100000,reward_millis=10000 WHERE user_id='a'").run();
    const ref=randomUUID();giftRewardCoins(db,"a","b",5,ref);
    expect(giftRewardCoins(db,"a","b",5,ref).replayed).toBe(true);
    expect(earned("a")).toBe(5);expect(earned("b")).toBe(5);
    expect(()=>giftRewardCoins(db,"a","c",5,ref)).toThrow(/outros dados/);
    expect(()=>giftRewardCoins(db,"a","b",6,randomUUID())).toThrow(/recompensa/);
    expect(earned("a")).toBe(5);expect(earned("b")).toBe(5);
    expect(db.prepare("SELECT SUM(amount_millis) AS total FROM wallet_ledger WHERE kind LIKE 'REWARD_GIFT_%'").get()).toEqual({total:0});
  });
  it("flags pausam XP,Booster/trocas/pagamento mensal sem apagar histórico",()=>{
    const id=user("a");coverage(id,50);
    config({enabled:false});
    expect(coverage(id,100).xpDelta).toBe(0);expect(gamificationView(db,id).xp).toBe(50);
    vi.setSystemTime(new Date("2026-10-16T09:00:00Z"));expect(()=>claimBooster(db,id)).toThrow();
    expect(()=>redeemRewardItem(db,id,"PASS",randomUUID())).toThrow(/pausadas/);
    expect(settleClosedMonths(db).paid).toEqual([]);
  });
});

describe("trials e desempate permanente independentes",()=>{
 let db:AppDatabase;
 beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-16T09:00:00Z"));db=createDatabase(":memory:");initializeGamification(db);});
 afterEach(()=>{db.close();vi.useRealTimers();});
 it("dois participantes recebem trialSUPER no mesmoFriday sem colisão global",()=>{
   for(const [id,phone]of [["a","5571000000001"],["b","5571000000002"]]){
     db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,?,?,'1',?,?)").run(id,id,phone,new Date().toISOString(),new Date().toISOString());
     db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES(?,?)").run(id,new Date().toISOString());
   }
   const c=gamificationConfig(db);saveGamificationConfig(db,{...c,boosterDrops:c.boosterDrops.map(d=>({...d,weight:d.code==="SUPER_TRIAL"?10000:0}))},"root");
   for(const id of ["a","b"]){expect(claimBooster(db,id).reward.code).toBe("SUPER_TRIAL");expect(trialSuperView(db,id).active).toBe(true);expect(claimBooster(db,id).replayed).toBe(true);}
   expect(db.prepare("SELECT COUNT(*) AS n FROM gamification_trials").get()).toEqual({n:2});
 });
});

describe("ranking permanente por nível",()=>{
 it("nível precedeXP quando curvas foram configuradas em momentos diferentes",()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-16T09:00:00Z"));const db=createDatabase(":memory:");initializeGamification(db);
  try{
   const round=(db.prepare("SELECT id FROM rounds LIMIT 1").get() as {id:string}).id;
   for(const [id,phone,seconds]of [["a","5571000000011",100],["b","5571000000012",50]] as const){
    const now=new Date().toISOString();db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,?,?,'1',?,?)").run(id,id,phone,now,now);db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES(?,?)").run(id,now);
    if(id==="b")saveGamificationConfig(db,{...gamificationConfig(db),curve:{firstStep:1,stepIncrease:0}},"root");
    db.prepare("INSERT OR IGNORE INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,created_at,video_duration_seconds) VALUES(?,?,1,?,'https://youtu.be/abcdefghijk','rank-video',?,100)").run(randomUUID(),round,id,now);
    db.prepare("INSERT INTO playlist_watch_progress(round_id,user_id,watched_seconds_json,durations_json,percent,observed_intervals_json,updated_at) VALUES(?,?,'[]','[]',0,?,?)").run(round,id,JSON.stringify({"0":[[0,seconds]]}),now);
    recordVerifiedXp(db,id,round,0);
   }
   expect(leaderboards(db).permanent.map(r=>r.userId)).toEqual(["b","a"]);
   expect(leaderboards(db).monthly.map(r=>r.userId)).toEqual(["a","b"]);
  }finally{db.close();vi.useRealTimers();}
 });
});
