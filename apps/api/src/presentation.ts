import { gamificationConfig, gamificationProgress } from "./gamification.js";
import type { AppDatabase } from "./db.js";
import { superState } from "./super.js";
export type UserPresentation = { badge: "ADMIN" | "SUPER" | null; superActive: boolean; superExpiresAt?: string; administrative?:boolean; unlimitedXp?:boolean; progress?:{xp:number;level:number;nextLevelXp:number;levelStartXp:number} };
/** Appearance only. Permissions remain in the authorization guards. */
export function presentationOf(db: AppDatabase, userId: string): UserPresentation {
  const admin=db.prepare("SELECT 1 FROM owner_access WHERE user_id=? AND active=1").get(userId);
  const subscription=superState(db,userId);
  const progress=gamificationProgress(db,userId);
  return {badge:admin?"ADMIN":subscription.active?"SUPER":null,
    administrative:progress.administrative,unlimitedXp:progress.unlimitedXp,
    progress:gamificationConfig(db).enabled&&!progress.administrative?progress:undefined,
    superActive:subscription.active,superExpiresAt:subscription.active?subscription.expiresAt:undefined};
}
