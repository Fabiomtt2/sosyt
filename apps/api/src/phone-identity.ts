import type {AppDatabase} from "./db.js";
import {normalizePhone} from "./phone.js";
/** WhatsApp may omit Brazil's ninth mobile digit. Never merge rows or infer foreign aliases. */
export function brazilMobileAliases(raw:string):string[]{
 const phone=normalizePhone(raw),values=[phone];
 if(/^55[1-9]\d[6-9]\d{7}$/.test(phone))values.push(phone.slice(0,4)+"9"+phone.slice(4));
 if(/^55[1-9]\d9[6-9]\d{7}$/.test(phone))values.push(phone.slice(0,4)+phone.slice(5));
 return [...new Set(values)];
}
export function resolveStoredPhone(db:AppDatabase,raw:string):string{
 const values=brazilMobileAliases(raw),exact=values[0];
 if(db.prepare("SELECT 1 FROM users WHERE phone=? AND deleted_at IS NULL").get(exact))return exact;
 const matches=values.slice(1).filter(phone=>db.prepare("SELECT 1 FROM users WHERE phone=? AND deleted_at IS NULL").get(phone));
 return matches.length===1?matches[0]:exact;
}
