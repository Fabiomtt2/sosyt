import type { AppDatabase } from "./db.js";

/** Directional choice with bidirectional effects; callers never expose who blocked them. */
export function socialBlockState(db: AppDatabase, viewerId: string, otherId: string) {
  const rows = db.prepare("SELECT blocker_id AS blockerId FROM social_blocks WHERE active=1 AND ((blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?))")
    .all(viewerId, otherId, otherId, viewerId) as Array<{ blockerId: string }>;
  return { blockedByMe: rows.some(row => row.blockerId === viewerId), interactionBlocked: rows.length > 0 };
}
export function isSocialBlocked(db: AppDatabase, a: string, b: string): boolean {
  return socialBlockState(db, a, b).interactionBlocked;
}
export function assertSocialInteractionAllowed(db: AppDatabase, a: string, b: string) {
  if (isSocialBlocked(db, a, b)) throw Object.assign(new Error("Esta interação não está disponível."), {
    statusCode: 403, code: "SOCIAL_INTERACTION_BLOCKED"
  });
}
/** Static SQL column expressions only. Never pass user-supplied strings here. */
export function socialVisibilitySql(viewer: string, other: string): string {
  return `NOT EXISTS (SELECT 1 FROM social_blocks sb WHERE sb.active=1 AND
    ((sb.blocker_id=${viewer} AND sb.blocked_id=${other}) OR (sb.blocker_id=${other} AND sb.blocked_id=${viewer})))`;
}
