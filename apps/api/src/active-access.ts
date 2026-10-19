import type { AppDatabase } from "./db.js";

/** Existing memberships remain usable while the interval gates new free entry. */
export function isBypassCooldownForJoinedQueue(db: AppDatabase, userId: string, roundId?: string): boolean {
  if (db.prepare("SELECT 1 FROM owner_access WHERE user_id=? AND active=1 AND role='ROOT_OWNER'").get(userId)) return true;
  const roundFilter = roundId ? " AND r.id=?" : "";
  return Boolean(db.prepare(`SELECT 1 FROM round_participants rp JOIN rounds r ON r.id=rp.round_id
    LEFT JOIN playlist_watch_progress p ON p.round_id=r.id AND p.user_id=rp.user_id
    WHERE rp.user_id=? AND rp.left_at IS NULL AND r.closed_at IS NULL
      AND p.finalized_at IS NULL${roundFilter} LIMIT 1`).get(userId, ...(roundId ? [roundId] : [])));
}

/** Never use another queue's entitlement to acquire a new FREE membership. */
export function assertFreeQueueEntryAllowed(db: AppDatabase, userId: string, roundId?: string): void {
  if (db.prepare("SELECT 1 FROM owner_access WHERE user_id=? AND active=1 AND role='ROOT_OWNER'").get(userId)) return;
  const account = db.prepare("SELECT cooldown_until AS until FROM users WHERE id=?").get(userId) as { until?: string } | undefined;
  const until = account?.until ? Date.parse(account.until) : 0;
  if (!Number.isFinite(until) || until <= Date.now()) return;
  if (roundId && isBypassCooldownForJoinedQueue(db, userId, roundId)) return;
  throw Object.assign(new Error("Você pode continuar nas filas já liberadas. Aguarde o intervalo para entrar gratuitamente em outra fila."), {
    statusCode: 423, code: "COOLDOWN_ACTIVE", cooldownUntil: account!.until,
    secondsRemaining: Math.max(1, Math.ceil((until - Date.now()) / 1000))
  });
}

/** Historical URLs never grant a fresh mutation after leaving or completing a task. */
export function hasActiveRoundTask(db:AppDatabase,userId:string,roundId:string):boolean {
  return Boolean(db.prepare("SELECT 1 FROM round_participants rp JOIN rounds r ON r.id=rp.round_id LEFT JOIN playlist_watch_progress p ON p.round_id=r.id AND p.user_id=rp.user_id WHERE rp.user_id=? AND r.id=? AND rp.left_at IS NULL AND r.closed_at IS NULL AND (r.status='READY' OR EXISTS(SELECT 1 FROM playlist_selections ps WHERE ps.round_id=r.id AND ps.user_id=rp.user_id)) AND p.finalized_at IS NULL AND EXISTS(SELECT 1 FROM submissions s WHERE s.round_id=r.id AND s.user_id=rp.user_id)").get(userId,roundId));
}
