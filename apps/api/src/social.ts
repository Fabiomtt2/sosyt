import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppDatabase } from "./db.js";
import { identityOf } from "./mailbox.js";
import type { Config } from "./config.js";
import { effectiveOwnerAccounts } from "./owners.js";
import { assertSocialInteractionAllowed, isSocialBlocked, socialBlockState, socialVisibilitySql } from "./social-blocks.js";
export { isSocialBlocked, assertSocialInteractionAllowed } from "./social-blocks.js";
export const FRIENDSHIP_REQUEST_COST = 1;

const now = () => new Date().toISOString();
function fail(statusCode: number, message: string, code: string): never {
  throw Object.assign(new Error(message), { statusCode, code });
}
export const communityConfigSchema = z.object({
  friendsEnabled: z.boolean(),
  coinGiftsEnabled: z.boolean(),
  maxGiftCoins: z.number().int().min(1).max(10000),
  declinedInviteCooldownHours: z.number().int().min(0).max(720)
});
export type CommunityConfig = z.infer<typeof communityConfigSchema>;
export const DEFAULT_COMMUNITY_CONFIG: CommunityConfig = {
  friendsEnabled: true, coinGiftsEnabled: true, maxGiftCoins: 10000, declinedInviteCooldownHours: 24
};
type Friendship = {
  id: string; pairA: string; pairB: string; senderId: string; recipientId: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "REMOVED";
  createdAt: string; updatedAt: string;
};
const friendshipSelect = `SELECT id,pair_a AS pairA,pair_b AS pairB,sender_id AS senderId,
  recipient_id AS recipientId,status,created_at AS createdAt,updated_at AS updatedAt FROM friendships`;

/** Additive tables only. Existing users, mail, wallets and ledgers are untouched. */
export function ensureSocialSchema(db: AppDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_blocks (
      blocker_id TEXT NOT NULL REFERENCES users(id),blocked_id TEXT NOT NULL REFERENCES users(id),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      CHECK(blocker_id<>blocked_id),PRIMARY KEY(blocker_id,blocked_id)
    );
    CREATE INDEX IF NOT EXISTS idx_social_blocks_other ON social_blocks(blocked_id,active,blocker_id);
    CREATE TABLE IF NOT EXISTS direct_message_requests (
      id TEXT PRIMARY KEY,sender_id TEXT NOT NULL REFERENCES users(id),recipient_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL CHECK(status IN ('PENDING','ACCEPTED','DECLINED')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      CHECK(sender_id<>recipient_id),UNIQUE(sender_id,recipient_id)
    );
    CREATE TABLE IF NOT EXISTS community_config (
      id INTEGER PRIMARY KEY CHECK(id=1),config_json TEXT NOT NULL,updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS community_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id),accept_friend_requests INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY,pair_a TEXT NOT NULL REFERENCES users(id),pair_b TEXT NOT NULL REFERENCES users(id),
      sender_id TEXT NOT NULL REFERENCES users(id),recipient_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL CHECK(status IN ('PENDING','ACCEPTED','DECLINED','CANCELLED','REMOVED')),
      request_reference TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      CHECK(pair_a<pair_b),CHECK(sender_id<>recipient_id),
      CHECK((sender_id=pair_a AND recipient_id=pair_b) OR (sender_id=pair_b AND recipient_id=pair_a)),
      UNIQUE(sender_id,request_reference)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_friendship_active_pair
      ON friendships(pair_a,pair_b) WHERE status IN ('PENDING','ACCEPTED');
    CREATE INDEX IF NOT EXISTS idx_friendship_recipient ON friendships(recipient_id,status,created_at);
    CREATE TABLE IF NOT EXISTS community_notifications (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,
      actor_id TEXT REFERENCES users(id),reference_id TEXT NOT NULL,payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,read_at TEXT,UNIQUE(user_id,kind,reference_id)
    );
    CREATE INDEX IF NOT EXISTS idx_community_notifications_unread ON community_notifications(user_id,read_at,created_at);
    CREATE TABLE IF NOT EXISTS community_audit (
      id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,action TEXT NOT NULL,
      target_id TEXT,payload_json TEXT NOT NULL,created_at TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS community_audit_no_update BEFORE UPDATE ON community_audit
      BEGIN SELECT RAISE(ABORT,'Immutable community audit'); END;
    CREATE TRIGGER IF NOT EXISTS community_audit_no_delete BEFORE DELETE ON community_audit
      BEGIN SELECT RAISE(ABORT,'Immutable community audit'); END;
  `);
  db.prepare("INSERT OR IGNORE INTO community_config(id,config_json,updated_at) VALUES(1,?,?)")
    .run(JSON.stringify(DEFAULT_COMMUNITY_CONFIG),now());
}
export function communityConfig(db: AppDatabase): CommunityConfig {
  const row = db.prepare("SELECT config_json AS json FROM community_config WHERE id=1").get() as {json:string};
  return communityConfigSchema.parse(JSON.parse(row.json));
}
export function assertRootCommunityActor(db: AppDatabase, actorId: string, config?: Config) {
  // HTTP callers still require rootOwnerGuard: the subject is an identifier, never proof by itself.
  if (actorId.startsWith("owner:") && config) {
    const account=effectiveOwnerAccounts(db,config).find(owner=>"owner:"+owner.id===actorId);
    if(account?.role==="ROOT_OWNER" && account.phone && account.secret) return;
  }
  const accessId=actorId.startsWith("owner-access:")?actorId.slice("owner-access:".length):actorId;
  if (!db.prepare("SELECT 1 FROM owner_access oa JOIN users u ON u.id=oa.user_id WHERE oa.active=1 AND oa.role='ROOT_OWNER' AND u.deleted_at IS NULL AND (oa.id=? OR oa.user_id=? OR oa.id=?)").get(accessId,accessId,"root:"+accessId))
    fail(403,"Somente um Root Owner pode gerenciar esta configuração.","ROOT_REQUIRED");
}
function audit(db: AppDatabase, actorId: string, action: string, targetId: string | null, payload: unknown) {
  db.prepare("INSERT INTO community_audit(id,actor_id,action,target_id,payload_json,created_at) VALUES(?,?,?,?,?,?)")
    .run(randomUUID(),actorId,action,targetId,JSON.stringify(payload),now());
}
export function saveCommunityConfig(db: AppDatabase, raw: unknown, actorId: string, config?: Config) {
  assertRootCommunityActor(db,actorId,config);
  const value = communityConfigSchema.parse(raw);
  db.transaction(() => {
    db.prepare("UPDATE community_config SET config_json=?,updated_at=? WHERE id=1").run(JSON.stringify(value),now());
    audit(db,actorId,"CONFIG_UPDATED",null,value);
  })();
  return value;
}
function activeUser(db: AppDatabase, userId: string) {
  if (!db.prepare("SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL").get(userId))
    fail(404,"Participante não disponível.","PARTICIPANT_UNAVAILABLE");
}
function pair(a: string,b: string) { return [a,b].sort(); }
function currentFriendship(db: AppDatabase,a: string,b: string): Friendship | undefined {
  const [first,second]=pair(a,b);
  return db.prepare(friendshipSelect+" WHERE pair_a=? AND pair_b=? AND status IN ('PENDING','ACCEPTED')")
    .get(first,second) as Friendship | undefined;
}
export function socialPreferences(db: AppDatabase,userId: string) {
  activeUser(db,userId);
  const row=db.prepare("SELECT accept_friend_requests AS accept FROM community_preferences WHERE user_id=?").get(userId) as {accept:number}|undefined;
  return {acceptFriendRequests:row ? Boolean(row.accept) : true};
}
export function saveSocialPreferences(db: AppDatabase,userId: string,raw: unknown) {
  const value=z.object({acceptFriendRequests:z.boolean()}).parse(raw);
  activeUser(db,userId);
  db.prepare(`INSERT INTO community_preferences(user_id,accept_friend_requests,updated_at) VALUES(?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET accept_friend_requests=excluded.accept_friend_requests,updated_at=excluded.updated_at`)
    .run(userId,value.acceptFriendRequests?1:0,now());
  return value;
}
export function relationshipBetween(db: AppDatabase,userId: string,otherId: string) {
  if (userId===otherId) return {status:"SELF" as const};
  const blocked=socialBlockState(db,userId,otherId);
  if(blocked.interactionBlocked) return {status:"BLOCKED" as const,...blocked};
  const friendship=currentFriendship(db,userId,otherId);
  if (friendship) return {
    status:friendship.status==="ACCEPTED" ? "FRIEND" as const :
      friendship.senderId===userId ? "REQUEST_SENT" as const : "REQUEST_RECEIVED" as const,
    invitationId:friendship.id
  };
  return {status:communityConfig(db).friendsEnabled ? "NONE" as const : "DISABLED" as const};
}

/** Exact international number only; never returns another person's phone or a directory. */
export function findFriendByPhone(db: AppDatabase,userId: string,rawPhone: string) {
  activeUser(db,userId);
  if (!communityConfig(db).friendsEnabled) fail(409,"Os convites de amizade estão pausados no momento.","FRIENDS_DISABLED");
  const phone=rawPhone.trim().replace(/[\s().-]/g,"").replace(/^\+/,"");
  if (!/^[1-9]\d{7,14}$/.test(phone)) fail(400,"Informe o WhatsApp completo, com DDI e DDD.","INVALID_PHONE");
  const row=db.prepare("SELECT id FROM users WHERE phone=? AND deleted_at IS NULL").get(phone) as {id:string}|undefined;
  if (!row || isSocialBlocked(db,userId,row.id) || (row.id!==userId && !socialPreferences(db,row.id).acceptFriendRequests && !currentFriendship(db,userId,row.id)))
    fail(404,"Não encontramos uma pessoa disponível para este convite.","PARTICIPANT_UNAVAILABLE");
  return {user:identityOf(db,row.id),relationship:relationshipBetween(db,userId,row.id)};
}
export function notifyCommunity(db: AppDatabase,input: {
  userId:string; kind:string; actorId?:string; referenceId:string; payload:Record<string,unknown>;
}) {
  const id=randomUUID();
  const result=db.prepare(`INSERT OR IGNORE INTO community_notifications
    (id,user_id,kind,actor_id,reference_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?)`)
    .run(id,input.userId,input.kind,input.actorId??null,input.referenceId,JSON.stringify(input.payload),now());
  return result.changes ? id : undefined;
}
export function requestFriendship(db: AppDatabase,senderId: string,recipientId: string,referenceId: string): {status:string;invitationId:string;replayed:boolean} {
  z.string().uuid().parse(referenceId);
  activeUser(db,senderId);activeUser(db,recipientId);
  if (senderId===recipientId) fail(400,"Escolha outra pessoa para adicionar.","SELF_FRIEND");
  return db.transaction(() => {
    const previous=db.prepare(friendshipSelect+" WHERE sender_id=? AND request_reference=?").get(senderId,referenceId) as Friendship|undefined;
    if (previous) {
      if (previous.recipientId!==recipientId) fail(409,"Este convite já foi registrado para outra pessoa.","REFERENCE_CONFLICT");
      return {...relationshipBetween(db,senderId,recipientId),invitationId:previous.id,replayed:true};
    }
    assertSocialInteractionAllowed(db,senderId,recipientId);
    const config=communityConfig(db);
    if (!config.friendsEnabled) fail(409,"Os convites de amizade estão pausados no momento.","FRIENDS_DISABLED");
    const current=currentFriendship(db,senderId,recipientId);
    // Sending a reciprocal request never accepts on behalf of either person.
    if (current) return {...relationshipBetween(db,senderId,recipientId),invitationId:current.id,replayed:true};
    if (!socialPreferences(db,recipientId).acceptFriendRequests)
      fail(404,"Esta pessoa não está recebendo convites no momento.","PARTICIPANT_UNAVAILABLE");
    const [first,second]=pair(senderId,recipientId);
    const declined=db.prepare(friendshipSelect+" WHERE pair_a=? AND pair_b=? AND status='DECLINED' ORDER BY updated_at DESC LIMIT 1")
      .get(first,second) as Friendship|undefined;
    if (declined && Date.now()-Date.parse(declined.updatedAt)<config.declinedInviteCooldownHours*3600000)
      fail(429,"Aguarde antes de enviar outro convite a esta pessoa.","INVITE_COOLDOWN");
    const id=randomUUID(),stamp=now();
    // Sending costs one internal coin. Acceptance is free; retries never reach this debit.
    const wallet=db.prepare("SELECT promo_millis AS promo,reward_millis AS reward,purchased_millis AS purchased,payment_hold AS hold FROM wallets WHERE user_id=?")
      .get(senderId) as {promo:number;reward:number;purchased:number;hold:number}|undefined;
    if(!wallet || wallet.promo+wallet.reward+wallet.purchased<1000)
      fail(409,"Você precisa de 1 moeda para enviar este convite. Aceitar um convite é gratuito.","FRIENDSHIP_COINS_INSUFFICIENT");
    if(wallet.hold) fail(409,"Sua carteira está em revisão. Nenhuma moeda foi debitada.","PAYMENT_HOLD");
    const promo=Math.min(wallet.promo,1000),reward=Math.min(wallet.reward,1000-promo),purchased=1000-promo-reward;
    const debited=db.prepare(`UPDATE wallets SET promo_millis=promo_millis-?,reward_millis=reward_millis-?,
      purchased_millis=purchased_millis-?,updated_at=? WHERE user_id=? AND payment_hold=0
      AND promo_millis>=? AND reward_millis>=? AND purchased_millis>=?`).run(promo,reward,purchased,stamp,senderId,promo,reward,purchased);
    if(!debited.changes) fail(409,"Seu saldo foi atualizado. Confira a carteira antes de tentar de novo.","WALLET_CHANGED");
    db.prepare("INSERT INTO wallet_ledger(id,user_id,kind,amount_millis,reference_id,created_at) VALUES(?,?,'FRIEND_REQUEST',-1000,?,?)")
      .run(randomUUID(),senderId,id,stamp);
    db.prepare(`INSERT INTO friendships(id,pair_a,pair_b,sender_id,recipient_id,status,request_reference,created_at,updated_at)
      VALUES(?,?,?,?,?,'PENDING',?,?,?)`).run(id,first,second,senderId,recipientId,referenceId,stamp,stamp);
    notifyCommunity(db,{userId:recipientId,kind:"FRIEND_REQUEST",actorId:senderId,referenceId:id,payload:{invitationId:id}});
    audit(db,senderId,"FRIEND_REQUESTED",id,{recipientId,costMillis:1000});
    return {status:"REQUEST_SENT" as const,invitationId:id,replayed:false};
  })();
}
export type FriendshipAction = "ACCEPT" | "DECLINE" | "CANCEL" | "REMOVE";
export function respondFriendship(db: AppDatabase,userId: string,invitationId: string,action: FriendshipAction) {
  activeUser(db,userId);
  z.enum(["ACCEPT","DECLINE","CANCEL","REMOVE"]).parse(action);
  return db.transaction(() => {
    const row=db.prepare(friendshipSelect+" WHERE id=?").get(invitationId) as Friendship|undefined;
    if (!row || ![row.senderId,row.recipientId].includes(userId)) fail(404,"Convite não encontrado.","INVITE_UNAVAILABLE");
    const target = action==="ACCEPT" ? "ACCEPTED" : action==="DECLINE" ? "DECLINED" : action==="CANCEL" ? "CANCELLED" : "REMOVED";
    if (action==="ACCEPT" || action==="DECLINE") {
      if (row.recipientId!==userId) fail(403,"Só quem recebeu pode responder a este convite.","INVITE_RECIPIENT_REQUIRED");
      if (action==="ACCEPT" && !communityConfig(db).friendsEnabled) fail(409,"Os convites de amizade estão pausados no momento.","FRIENDS_DISABLED");
    }
    if (action==="CANCEL" && row.senderId!==userId) fail(403,"Só quem enviou pode cancelar o convite.","INVITE_SENDER_REQUIRED");
    if (row.status===target) return {status:target,replayed:true};
    if ((action==="REMOVE" && row.status!=="ACCEPTED") || (action!=="REMOVE" && row.status!=="PENDING"))
      fail(409,"Este convite já foi atualizado. Atualize a lista para continuar.","INVITE_STATE_CHANGED");
    if (action==="ACCEPT") {
      activeUser(db,row.senderId);
      assertSocialInteractionAllowed(db,row.senderId,row.recipientId);
    }
    const stamp=now();
    db.prepare("UPDATE friendships SET status=?,updated_at=? WHERE id=?").run(target,stamp,row.id);
    db.prepare("UPDATE community_notifications SET read_at=COALESCE(read_at,?) WHERE reference_id=? AND kind='FRIEND_REQUEST'")
      .run(stamp,row.id);
    if(action==="ACCEPT")db.prepare("INSERT INTO direct_message_requests(id,sender_id,recipient_id,status,created_at,updated_at) VALUES(?,?,?,'ACCEPTED',?,?) ON CONFLICT(sender_id,recipient_id) DO UPDATE SET status='ACCEPTED',updated_at=excluded.updated_at").run(randomUUID(),row.senderId,row.recipientId,stamp,stamp);
    if (action==="ACCEPT") notifyCommunity(db,{
      userId:row.senderId,kind:"FRIEND_ACCEPTED",actorId:userId,referenceId:row.id,payload:{invitationId:row.id}
    });
    audit(db,userId,"FRIEND_"+action,row.id,{otherUserId:userId===row.senderId?row.recipientId:row.senderId});
    return {status:target,replayed:false};
  })();
}
export function communityUnreadCount(db: AppDatabase,userId: string) {
  return (db.prepare(`SELECT COUNT(*) AS n FROM community_notifications cn WHERE user_id=? AND read_at IS NULL
    AND (kind NOT IN ('FRIEND_REQUEST','MESSAGE_REQUEST','MESSAGE_ACCEPTED') OR EXISTS (SELECT 1 FROM users actor WHERE actor.id=cn.actor_id AND actor.deleted_at IS NULL))
    AND ${socialVisibilitySql("cn.user_id","cn.actor_id")}`).get(userId) as {n:number}).n;
}
export function listCommunityNotifications(db: AppDatabase,userId: string) {
  activeUser(db,userId);
  const rows=db.prepare(`SELECT id,kind,actor_id AS actorId,reference_id AS referenceId,payload_json AS payload,
    created_at AS createdAt,read_at AS readAt FROM community_notifications cn WHERE user_id=?
    AND (kind NOT IN ('FRIEND_REQUEST','MESSAGE_REQUEST','MESSAGE_ACCEPTED') OR EXISTS (SELECT 1 FROM users actor WHERE actor.id=cn.actor_id AND actor.deleted_at IS NULL))
    AND ${socialVisibilitySql("cn.user_id","cn.actor_id")}
    ORDER BY created_at DESC,rowid DESC LIMIT 100`).all(userId) as Array<{
      id:string;kind:string;actorId:string|null;referenceId:string;payload:string;createdAt:string;readAt:string|null;
    }>;
  return {unread:communityUnreadCount(db,userId),notifications:rows.map(({actorId,payload,...row})=>({
    ...row,actor:actorId&&db.prepare("SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL").get(actorId)?identityOf(db,actorId)??null:null,payload:JSON.parse(payload) as Record<string,unknown>
  }))};
}
export function markCommunityNotificationsRead(db: AppDatabase,userId: string,ids: string[]) {
  activeUser(db,userId);
  const selected=z.array(z.string().uuid()).max(100).parse(ids);
  const stamp=now();
  const update=db.prepare("UPDATE community_notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL");
  let read=0;
  db.transaction(()=>{for (const id of selected) read+=update.run(stamp,id,userId).changes;})();
  return {read,unread:communityUnreadCount(db,userId)};
}
export function socialOverview(db: AppDatabase,userId: string) {
  activeUser(db,userId);
  const rows=db.prepare(friendshipSelect+" WHERE (sender_id=? OR recipient_id=?) AND status IN ('PENDING','ACCEPTED') ORDER BY updated_at DESC,rowid DESC")
    .all(userId,userId) as Friendship[];
  const withUser=(row:Friendship)=>identityOf(db,row.senderId===userId?row.recipientId:row.senderId);
  const active=rows.filter(row=>{
    const otherId=row.senderId===userId?row.recipientId:row.senderId;
    return !isSocialBlocked(db,userId,otherId)&&Boolean(db.prepare("SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL").get(otherId));
  });
  return {
    enabled:communityConfig(db).friendsEnabled,preferences:socialPreferences(db,userId),friendshipRequestCost:FRIENDSHIP_REQUEST_COST,
    blocked:(db.prepare("SELECT blocked_id AS userId,created_at AS createdAt FROM social_blocks WHERE blocker_id=? AND active=1 ORDER BY updated_at DESC").all(userId) as Array<{userId:string;createdAt:string}>)
      .filter(row=>Boolean(db.prepare("SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL").get(row.userId)))
      .map(row=>({...row,user:identityOf(db,row.userId)})),
    friends:active.filter(row=>row.status==="ACCEPTED").map(row=>({id:row.id,user:withUser(row),since:row.updatedAt})),
    incoming:active.filter(row=>row.status==="PENDING"&&row.recipientId===userId).map(row=>({id:row.id,user:withUser(row),createdAt:row.createdAt})),
    outgoing:active.filter(row=>row.status==="PENDING"&&row.senderId===userId).map(row=>({id:row.id,user:withUser(row),createdAt:row.createdAt})),
    unread:communityUnreadCount(db,userId)
  };
}
export function adminCommunityOverview(db: AppDatabase,actorId: string,config?: Config) {
  assertRootCommunityActor(db,actorId,config);
  const count=(sql:string)=>(db.prepare(sql).get() as {n:number}).n;
  return {
    config:communityConfig(db),
    stats:{
      friendships:count("SELECT COUNT(*) AS n FROM friendships WHERE status='ACCEPTED'"),
      pendingInvitations:count("SELECT COUNT(*) AS n FROM friendships WHERE status='PENDING'"),
      participantsReceivingInvites:count(`SELECT COUNT(*) AS n FROM users u LEFT JOIN community_preferences p ON p.user_id=u.id
        WHERE u.deleted_at IS NULL AND COALESCE(p.accept_friend_requests,1)=1`)
    },
    relationships:(db.prepare(friendshipSelect+" WHERE status IN ('PENDING','ACCEPTED') ORDER BY updated_at DESC LIMIT 100").all() as Friendship[])
      .map(row=>({...row,sender:identityOf(db,row.senderId),recipient:identityOf(db,row.recipientId)})),
    audit:db.prepare("SELECT id,actor_id AS actorId,action,target_id AS targetId,payload_json AS payload,created_at AS createdAt FROM community_audit ORDER BY created_at DESC,rowid DESC LIMIT 100")
      .all()
  };
}
/** Moderation can revoke, but can never manufacture another person's consent. */
export function adminRevokeFriendship(db: AppDatabase,actorId: string,invitationId: string,reason: string,config?: Config) {
  assertRootCommunityActor(db,actorId,config);
  const note=z.string().trim().min(5).max(240).parse(reason);
  return db.transaction(()=>{
    const row=db.prepare(friendshipSelect+" WHERE id=?").get(invitationId) as Friendship|undefined;
    if (!row) fail(404,"Vínculo não encontrado.","INVITE_UNAVAILABLE");
    if (!["PENDING","ACCEPTED"].includes(row.status)) return {ok:true,replayed:true};
    const stamp=now();
    db.prepare("UPDATE friendships SET status='REMOVED',updated_at=? WHERE id=?").run(stamp,row.id);
    db.prepare("UPDATE community_notifications SET read_at=COALESCE(read_at,?) WHERE reference_id=? AND kind='FRIEND_REQUEST'").run(stamp,row.id);
    audit(db,actorId,"ADMIN_FRIENDSHIP_REVOKED",row.id,{reason:note,previousStatus:row.status});
    return {ok:true,replayed:false};
  })();
}

/** Public community identity for profile popovers. No phone, wallet or private mail. */
export function socialProfile(db: AppDatabase,userId: string,otherId: string) {
  activeUser(db,userId);activeUser(db,otherId);
  const blocked=socialBlockState(db,userId,otherId);
  return {
    user:blocked.interactionBlocked?null:identityOf(db,otherId),
    ...blocked,
    relationship:relationshipBetween(db,userId,otherId),
    acceptsRequests:!blocked.interactionBlocked&&socialPreferences(db,otherId).acceptFriendRequests,
    enabled:communityConfig(db).friendsEnabled
  };
}

/** Blocking is a personal boundary. Even Root participant sessions cannot bypass it. */
export function blockSocialUser(db:AppDatabase,userId:string,targetId:string) {
  activeUser(db,userId);activeUser(db,targetId);
  if(userId===targetId) fail(400,"Escolha outra pessoa para bloquear.","SELF_BLOCK");
  return db.transaction(()=>{
    const previous=db.prepare("SELECT active FROM social_blocks WHERE blocker_id=? AND blocked_id=?").get(userId,targetId) as {active:number}|undefined;
    if(previous?.active) return {blocked:true,replayed:true};
    const stamp=now();
    db.prepare(`INSERT INTO social_blocks(blocker_id,blocked_id,active,created_at,updated_at) VALUES(?,?,1,?,?)
      ON CONFLICT(blocker_id,blocked_id) DO UPDATE SET active=1,created_at=excluded.created_at,updated_at=excluded.updated_at`)
      .run(userId,targetId,stamp,stamp);
    const [a,b]=pair(userId,targetId);
    db.prepare("UPDATE friendships SET status=CASE WHEN status='PENDING' THEN 'CANCELLED' ELSE 'REMOVED' END,updated_at=? WHERE pair_a=? AND pair_b=? AND status IN ('PENDING','ACCEPTED')")
      .run(stamp,a,b);
    db.prepare("UPDATE direct_message_requests SET status='DECLINED',updated_at=? WHERE (sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)").run(stamp,userId,targetId,targetId,userId);
    audit(db,userId,"SOCIAL_USER_BLOCKED",targetId,{});
    return {blocked:true,replayed:false};
  })();
}
export function unblockSocialUser(db:AppDatabase,userId:string,targetId:string) {
  activeUser(db,userId);
  return db.transaction(()=>{
    const updated=db.prepare("UPDATE social_blocks SET active=0,updated_at=? WHERE blocker_id=? AND blocked_id=? AND active=1").run(now(),userId,targetId);
    if(updated.changes) audit(db,userId,"SOCIAL_USER_UNBLOCKED",targetId,{});
    return {blocked:false,replayed:updated.changes===0};
  })();
}

/** Consent is explicit: friendship or an accepted conversation request, never an old DM. */
export function canDirectMessage(db:AppDatabase,a:string,b:string):boolean {
  if(isSocialBlocked(db,a,b)) return false;
  if(currentFriendship(db,a,b)?.status==="ACCEPTED")return true;
  return Boolean(db.prepare("SELECT 1 FROM direct_message_requests WHERE status='ACCEPTED' AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?))").get(a,b,b,a));
}
export function requestDirectConversation(db:AppDatabase,senderId:string,recipientId:string): {id?:string;status:string;replayed:boolean} {
  activeUser(db,senderId);activeUser(db,recipientId);
  if(senderId===recipientId)fail(400,"Escolha outra pessoa.","SELF_MESSAGE_REQUEST");
  assertSocialInteractionAllowed(db,senderId,recipientId);
  return db.transaction(()=>{
    if(canDirectMessage(db,senderId,recipientId))return {status:"ACCEPTED",replayed:true};
    const prior=db.prepare("SELECT id,status FROM direct_message_requests WHERE sender_id=? AND recipient_id=?").get(senderId,recipientId) as {id:string;status:string}|undefined;
    if(prior)return {...prior,replayed:true};
    const stamp=now(),id=randomUUID();
    db.prepare("INSERT INTO direct_message_requests(id,sender_id,recipient_id,status,created_at,updated_at) VALUES(?,?,?,'PENDING',?,?)").run(id,senderId,recipientId,stamp,stamp);
    notifyCommunity(db,{userId:recipientId,actorId:senderId,kind:"MESSAGE_REQUEST",referenceId:id,payload:{requestId:id}});
    audit(db,senderId,"MESSAGE_REQUESTED",id,{recipientId});
    return {id,status:"PENDING",replayed:false};
  })();
}
export function respondDirectConversation(db:AppDatabase,userId:string,id:string,accept:boolean) {
  activeUser(db,userId);
  return db.transaction(()=>{
    const row=db.prepare("SELECT sender_id AS senderId,recipient_id AS recipientId,status FROM direct_message_requests WHERE id=?").get(id) as {senderId:string;recipientId:string;status:string}|undefined;
    if(!row||row.recipientId!==userId)fail(404,"Solicitação não encontrada.","MESSAGE_REQUEST_UNAVAILABLE");
    assertSocialInteractionAllowed(db,userId,row.senderId);
    const status=accept?"ACCEPTED":"DECLINED";
    if(row.status===status)return {status,replayed:true};
    if(row.status!=="PENDING")fail(409,"Solicitação já respondida.","MESSAGE_REQUEST_CHANGED");
    const stamp=now();
    db.prepare("UPDATE direct_message_requests SET status=?,updated_at=? WHERE id=?").run(status,stamp,id);
    db.prepare("UPDATE community_notifications SET read_at=COALESCE(read_at,?) WHERE user_id=? AND kind='MESSAGE_REQUEST' AND reference_id=?").run(stamp,userId,id);
    if(accept)notifyCommunity(db,{userId:row.senderId,actorId:userId,kind:"MESSAGE_ACCEPTED",referenceId:id,payload:{requestId:id}});
    audit(db,userId,"MESSAGE_REQUEST_"+status,id,{senderId:row.senderId});
    return {status,replayed:false};
  })();
}
export function directConversationRequests(db:AppDatabase,userId:string) {
  activeUser(db,userId);
  return (db.prepare("SELECT id,sender_id AS senderId,recipient_id AS recipientId,status,created_at AS createdAt FROM direct_message_requests d WHERE (sender_id=? OR recipient_id=?) AND EXISTS(SELECT 1 FROM users u WHERE u.id=d.sender_id AND u.deleted_at IS NULL) AND EXISTS(SELECT 1 FROM users u WHERE u.id=d.recipient_id AND u.deleted_at IS NULL) AND "+socialVisibilitySql("?","CASE WHEN d.sender_id=? THEN d.recipient_id ELSE d.sender_id END")+" ORDER BY created_at DESC LIMIT 100").all(userId,userId,userId,userId,userId,userId) as Array<{id:string;senderId:string;recipientId:string;status:string;createdAt:string}>).map(r=>({...r,incoming:r.recipientId===userId,user:identityOf(db,r.senderId===userId?r.recipientId:r.senderId)}));
}
