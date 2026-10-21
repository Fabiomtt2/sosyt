import {randomUUID} from "node:crypto";
import type {AppDatabase} from "./db.js";
import {grantItem} from "./inventory.js";
import {grantSuper} from "./super.js";
import {notifyCommunity} from "./social.js";
export type OwnerBenefit="COINS"|"PASS"|"SKIP"|"SUPER";
export function grantOwnerBenefit(db:AppDatabase,input:{userId:string;benefit:OwnerBenefit;quantity:number;referenceId:string;reason:string;actorId:string;actorName:string}){
 return db.transaction(()=>{
  const prior=db.prepare("SELECT user_id AS userId,note FROM wallet_ledger WHERE kind='OWNER_BENEFIT' AND reference_id=?").get(input.referenceId) as {userId:string;note:string}|undefined;
  if(prior){const note=JSON.parse(prior.note);if(prior.userId!==input.userId||note.benefit!==input.benefit||note.quantity!==input.quantity||note.actorId!==input.actorId||note.reason!==input.reason)throw Object.assign(new Error("Este presente já foi registrado com outros dados."),{statusCode:409});return {ok:true,replayed:true,benefit:input.benefit,quantity:input.quantity};}
  if(!db.prepare("SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL").get(input.userId))throw Object.assign(new Error("Participante não encontrado."),{statusCode:404});
  if(!db.prepare("SELECT 1 FROM wallets WHERE user_id=?").get(input.userId))throw Object.assign(new Error("A conta ainda não possui carteira. Aguarde o primeiro acesso."),{statusCode:409});
  const stamp=new Date().toISOString();
  if(input.benefit==="COINS")db.prepare("UPDATE wallets SET reward_millis=reward_millis+?,updated_at=? WHERE user_id=?").run(input.quantity*1000,stamp,input.userId);
  else if(input.benefit==="PASS")db.prepare("UPDATE wallets SET extra_slot_passes=extra_slot_passes+?,updated_at=? WHERE user_id=?").run(input.quantity,stamp,input.userId);
  else if(input.benefit==="SKIP")grantItem(db,{userId:input.userId,itemCode:"SKIP",delta:input.quantity,kind:"OWNER_ADJUST",referenceId:input.referenceId,note:"Presente de "+input.actorName+": "+input.reason});
  else grantSuper(db,input.userId,{days:input.quantity,source:"GIFT",referenceId:"owner-benefit:"+input.referenceId,note:"Concedido por "+input.actorName+": "+input.reason});
  db.prepare("INSERT INTO wallet_ledger(id,user_id,kind,amount_millis,reference_id,note,actor_owner_id,actor_owner_name,created_at) VALUES(?,?,'OWNER_BENEFIT',?,?,?,?,?,?)")
   .run(randomUUID(),input.userId,input.benefit==="COINS"?input.quantity*1000:0,input.referenceId,JSON.stringify({source:"OWNER_GIFT",benefit:input.benefit,quantity:input.quantity,actorId:input.actorId,reason:input.reason}),input.actorId,input.actorName,stamp);
  const name=input.benefit==="COINS"?"moedas":input.benefit==="PASS"?"Passe":input.benefit==="SKIP"?"Pular":"dias de SUPER";
  notifyCommunity(db,{userId:input.userId,kind:input.benefit==="COINS"?"COINS_RECEIVED":"ITEM_RECEIVED",referenceId:input.referenceId,payload:{benefit:input.benefit,quantity:input.quantity,message:input.actorName+" concedeu "+input.quantity+" "+name+" para você."}});
  return {ok:true,replayed:false,benefit:input.benefit,quantity:input.quantity};
 })();
}
