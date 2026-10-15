import type { AppDatabase } from "./db.js";
import { gamificationConfig, gamificationView, leaderboards } from "./gamification.js";
import { identityOf } from "./mailbox.js";

export const dropLabel = (code: string,days=7) => code.startsWith("COINS_") ? code.slice(6) + " moedas" : code === "SKIP" ? "1 Pular" : code === "PASS" ? "1 Passe" : "SUPER por "+days+" dias";
export function gamificationRanks(db: AppDatabase) {
  const ranks = leaderboards(db);
  const decorate = (rows: Array<{userId:string;xp:number}>) => rows.slice(0,3).map((row,index) => {
    const who = identityOf(db,row.userId);
    return {userId:row.userId,name:who?.name ?? "Participante",avatar:who?.avatar ?? undefined,
      presentation:who?.presentation,groupCode:who?.groupCode,progress:who?.presentation.progress,
      xp:row.xp,position:index+1};
  });
  return {month:ranks.month,monthly:decorate(ranks.monthly),allTime:decorate(ranks.permanent)};
}
export function gamificationData(db: AppDatabase,userId: string) {
  const view=gamificationView(db,userId),config=gamificationConfig(db);
  const span=Math.max(1,view.nextLevelXp-view.levelStartXp);
  const start=Math.floor(view.level/10)*10+1;
  return {enabled:config.enabled,
    progress:{xp:view.xp,level:view.level,xpIntoLevel:Math.max(0,view.xp-view.levelStartXp),
      xpForNextLevel:span,progressPercent:Math.min(100,Math.max(0,(view.xp-view.levelStartXp)/span*100)),
      rewardCoins:view.rewardCoins,roadmap:Array.from({length:10},(_,i)=>{
        const level=start+i;
        return {level,coins:level===1?0:config.levelCoins+(level%config.milestoneEvery===0?config.milestoneCoins:0),
          superDays:level>1&&level%config.trialEvery===0?config.trialDays:0};
      })},
    milestones:{every:config.milestoneEvery,coins:config.milestoneCoins,trialEvery:config.trialEvery,trialDays:config.trialDays},
    ranks:gamificationRanks(db),
    booster:{...view.booster,odds:view.booster.odds.map(d=>({...d,label:dropLabel(d.code,config.trialDays),probability:d.probabilityPercent/100}))},
    redemption:view.redeemPrices,redemptionEnabled:config.enabled&&config.redeemEnabled,
    history:view.history};
}
