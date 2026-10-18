import { z } from "zod";
import type { AppDatabase } from "./db.js";
const KEY="whatsapp.support.availability";
const schema=z.object({
 enabled:z.boolean(),days:z.array(z.number().int().min(0).max(6)).min(1).max(7),
 startHour:z.number().int().min(0).max(23),endHour:z.number().int().min(0).max(24)
}).superRefine((v,ctx)=>{
 if(new Set(v.days).size!==v.days.length)ctx.addIssue({code:"custom",message:"Escolha cada dia apenas uma vez."});
 if(v.enabled&&v.startHour===v.endHour)ctx.addIssue({code:"custom",message:"Informe horários diferentes de início e fim."});
});
export type SupportAvailability=z.infer<typeof schema>;
const DEFAULT:SupportAvailability={enabled:false,days:[0,1,2,3,4,5,6],startHour:0,endHour:24};
function stored(db:AppDatabase):SupportAvailability {
 const row=db.prepare("SELECT value FROM integration_settings WHERE key=?").get(KEY) as {value:string}|undefined;
 if(!row)return {...DEFAULT,days:[...DEFAULT.days]};
 try{return schema.parse(JSON.parse(row.value));}catch{return {...DEFAULT,days:[...DEFAULT.days]};}
}
function available(settings:SupportAvailability,at:Date) {
 if(!settings.enabled)return true;
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Bahia",weekday:"short",hour:"2-digit",hourCycle:"h23"}).formatToParts(at);
 const weekday=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(parts.find(p=>p.type==="weekday")!.value);
 const hour=Number(parts.find(p=>p.type==="hour")!.value);
 if(settings.startHour<settings.endHour)return settings.days.includes(weekday)&&hour>=settings.startHour&&hour<settings.endHour;
 return hour>=settings.startHour?settings.days.includes(weekday):hour<settings.endHour&&settings.days.includes((weekday+6)%7);
}
export function supportAvailableNow(db:AppDatabase,at=new Date()){return available(stored(db),at);}
export function readSupportAvailability(db:AppDatabase,at=new Date()){
 const settings=stored(db);return {...settings,timeZone:"America/Bahia" as const,availableNow:available(settings,at)};
}
export function saveSupportAvailability(db:AppDatabase,raw:unknown,actor:{id:string;name:string}){
 const settings=schema.parse(raw);
 if(!actor.id.trim())throw Object.assign(new Error("Informe quem alterou a disponibilidade."),{statusCode:400});
 db.transaction(()=>{
  const before=JSON.stringify(stored(db)),after=JSON.stringify(settings),at=new Date().toISOString();
  db.prepare("INSERT INTO integration_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(KEY,after,at);
  db.prepare("INSERT INTO bot_automation_audit(event,field,before_value,after_value,actor_owner_id,actor_owner_name,created_at) VALUES('SUPPORT_OFFHOURS','availability',?,?,?,?,?)").run(before,after,actor.id,actor.name,at);
 })();return readSupportAvailability(db);
}
