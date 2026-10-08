import type { AppDatabase } from "./db.js";
export const WATCH_REWARD_INTERVAL_MILLIS = 20 * 60 * 1000;

export function watchRewardView(db: AppDatabase, userId: string) {
  const row=db.prepare("SELECT verified_millis AS verifiedMillis,rewarded_coins AS rewardedCoins FROM watch_time_totals WHERE user_id=?")
    .get(userId) as {verifiedMillis:number;rewardedCoins:number}|undefined;
  const verifiedMillis=Math.max(0,row?.verifiedMillis ?? 0);
  const remainder=verifiedMillis % WATCH_REWARD_INTERVAL_MILLIS;
  return {
    verifiedSeconds: Math.floor(verifiedMillis/1000),
    coins: Math.max(0,row?.rewardedCoins ?? 0),
    secondsToNextReward: Math.ceil((WATCH_REWARD_INTERVAL_MILLIS-remainder)/1000)
  };
}

