import {z} from "zod";
import type {AppDatabase} from "./db.js";
import {consumeItem,itemQuantity,ITEM_SKIP,ROOT_ITEM_QUANTITY} from "./inventory.js";
import {isRootOwner} from "./super.js";
import {joinRound,skipTargetFor,vacanciesIn} from "./queues.js";
export type SkippedQueue={id:string;number:number;status:string;vacancies:number};
const fail=(message:string,code:string):never=>{throw Object.assign(new Error(message),{statusCode:409,code});};
/** Purchase only stocks inventory. A use grants one selected membership and consumes once. */
export function joinQueueWithSkip(db:AppDatabase,userId:string,referenceId:string,targetRoundId?:string){
 z.string().uuid().parse(referenceId);if(targetRoundId)z.string().uuid().parse(targetRoundId);
 if(!db.prepare("SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL").get(userId))throw Object.assign(new Error("Participante não encontrado."),{statusCode:404,code:"USER_NOT_FOUND"});
 return db.transaction(()=>{
  const root=isRootOwner(db,userId),balance=()=>root?ROOT_ITEM_QUANTITY:itemQuantity(db,userId,ITEM_SKIP);
  const previous=db.prepare("SELECT result_json AS result FROM queue_skip_requests WHERE user_id=? AND reference_id=?").get(userId,referenceId) as {result:string}|undefined;
  if(previous){const queue=JSON.parse(previous.result) as SkippedQueue;if(targetRoundId&&queue.id!==targetRoundId)fail("Esta referência já foi usada em outra fila.","QUEUE_REFERENCE_CONFLICT");return {queue,skipsAvailable:balance(),replayed:true};}
  const wallet=db.prepare("SELECT payment_hold AS hold FROM wallets WHERE user_id=?").get(userId) as {hold:number}|undefined;
  if(!root&&wallet?.hold)fail("Seu acesso a itens está em análise pela equipe. Fale com o suporte.","PAYMENT_HOLD");
  if(balance()<1)fail("Você precisa de um item Pular para entrar em outra fila.","SKIP_REQUIRED");
  const target=skipTargetFor(db,userId,targetRoundId,true);
  if(!root)consumeItem(db,userId,ITEM_SKIP,"skip:"+referenceId+":"+userId);
  joinRound(db,target.id,userId,"SKIP");
  const queue={id:target.id,number:target.displayNumber,status:target.status,vacancies:vacanciesIn(db,target.id)};
  db.prepare("INSERT INTO queue_skip_requests(user_id,reference_id,result_json,created_at) VALUES(?,?,?,?)").run(userId,referenceId,JSON.stringify(queue),new Date().toISOString());
  return {queue,skipsAvailable:balance(),replayed:false};
 })();
}
