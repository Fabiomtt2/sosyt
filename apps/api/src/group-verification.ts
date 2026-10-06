import type { AppDatabase } from "./db.js";

export type GroupVerificationState = {
  required: boolean;
  accessReady: boolean;
  memberVerified: boolean;
  ownerAdminVerified: boolean;
  provider?: string;
};

export function groupVerificationState(db: AppDatabase, phone: string, groupCode: string): GroupVerificationState {
  const proofs = db.prepare(`SELECT provider,owner_admin_count AS ownerAdminCount
    FROM whatsapp_group_verifications WHERE group_code=? ORDER BY verified_at DESC`)
    .all(groupCode) as Array<{ provider: string; ownerAdminCount: number }>;
  if (!proofs.length) return { required:false,accessReady:true,memberVerified:false,ownerAdminVerified:false };

  let anyMember=false, anyAdmin=false;
  for (const proof of proofs) {
    const member=Boolean(db.prepare(`SELECT 1 FROM whatsapp_member_verifications
      WHERE provider=? AND group_code=? AND phone=? AND revoked_at IS NULL`)
      .get(proof.provider,groupCode,phone));
    const admin=proof.ownerAdminCount>0;
    anyMember ||= member; anyAdmin ||= admin;
    if (member && admin) return { required:true,accessReady:true,memberVerified:true,ownerAdminVerified:true,provider:proof.provider };
  }
  return { required:true,accessReady:false,memberVerified:anyMember,ownerAdminVerified:anyAdmin,provider:proofs[0]?.provider };
}

export function materializeApprovedMembership(db: AppDatabase, phone: string, groupCode: string, stamp = new Date().toISOString(), approvedBy?: { id: string; name: string }) {
  const request=db.prepare("SELECT id,status,approved_by_owner_id AS ownerId,approved_by_owner_name AS ownerName FROM participation_requests WHERE phone=?").get(phone) as
    | { id:string; status:string; ownerId?: string; ownerName?: string }
    | undefined;
  const state=groupVerificationState(db,phone,groupCode);
  if (request && request.status!=="APPROVED") return { accessGranted:false,state };
  if (!state.accessReady) return { accessGranted:false,state };

  const ownerId=approvedBy?.id ?? request?.ownerId ?? null;
  const ownerName=approvedBy?.name ?? request?.ownerName ?? null;
  const source=state.required ? `VERIFIED_${state.provider ?? "EXTERNAL"}` : "OWNER";
  db.prepare(`INSERT INTO group_memberships (phone,group_code,approved_at,revoked_at,source,approved_by_owner_id,approved_by_owner_name)
    VALUES (?,?,?,NULL,?,?,?)
    ON CONFLICT(phone) DO UPDATE SET group_code=excluded.group_code,approved_at=excluded.approved_at,revoked_at=NULL,
      source=excluded.source,approved_by_owner_id=excluded.approved_by_owner_id,approved_by_owner_name=excluded.approved_by_owner_name`)
    .run(phone,groupCode,stamp,source,ownerId,ownerName);
  return { accessGranted:true,state };
}

export function recordGroupVerification(db: AppDatabase, provider: string, groupCode: string, externalGroupId: string, subject: string, ownerAdminCount: number, stamp = new Date().toISOString()) {
  db.prepare(`INSERT INTO whatsapp_group_verifications (provider,group_code,external_group_id,subject,owner_admin_count,verified_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(provider,group_code) DO UPDATE SET external_group_id=excluded.external_group_id,subject=excluded.subject,
      owner_admin_count=excluded.owner_admin_count,verified_at=excluded.verified_at`)
    .run(provider,groupCode,externalGroupId,subject,Math.max(0,ownerAdminCount),stamp);
}

export function recordMemberVerification(db: AppDatabase, provider: string, groupCode: string, phone: string, externalGroupId: string, present: boolean, stamp = new Date().toISOString()) {
  db.prepare(`INSERT INTO whatsapp_member_verifications (provider,group_code,phone,external_group_id,verified_at,revoked_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(provider,group_code,phone) DO UPDATE SET external_group_id=excluded.external_group_id,
      verified_at=excluded.verified_at,revoked_at=excluded.revoked_at`)
    .run(provider,groupCode,phone,externalGroupId,stamp,present ? null : stamp);
}
