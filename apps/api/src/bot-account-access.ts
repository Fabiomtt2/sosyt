import type {AppDatabase} from "./db.js";
import {resolveStoredPhone} from "./phone-identity.js";
import {isParticipantBlocked} from "./participant-access.js";
/** Only existing account identities are checked; a transport alias is never a new account. */
export function botPhoneAccessBlocked(db:AppDatabase,phone:string):boolean{
 const stored=resolveStoredPhone(db,phone);
 const user=db.prepare('SELECT id FROM users WHERE phone=? AND deleted_at IS NULL').get(stored) as {id:string}|undefined;
 return Boolean(user&&isParticipantBlocked(db,user.id));
}
