import {randomUUID} from "node:crypto";
import {afterEach,beforeEach,describe,it,expect} from "vitest";
import {createDatabase,type AppDatabase} from "./db.js";
import {joinQueueWithSkip} from "./queue-skip.js";
import {activeRounds,openRound,joinRound,leaveRound,closeRound,myRounds} from "./queues.js";
import {hasActiveRoundTask} from "./active-access.js";
import {preparePlaylistSelection} from "./partial-playlist.js";
import {grantItem,itemQuantity,ITEM_SKIP} from "./inventory.js";
describe("Pular escolhido no inventário: acesso real sem tarefa por preview",()=>{
 let db:AppDatabase;const user="skip-person",author="skip-author";
 beforeEach(()=>{
  db=createDatabase(":memory:");const stamp=new Date().toISOString();
  for(const [id,phone] of [[user,"15550001234"],[author,"15550001235"]]){
   db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,?,?,'1',?,?)").run(id,id,phone,stamp,stamp);
   db.prepare("INSERT INTO wallets(user_id,extra_slot_passes,updated_at) VALUES(?,2,?)").run(id,stamp);
  }
  joinRound(db,activeRounds(db)[0].id,user);grantItem(db,{userId:user,itemCode:ITEM_SKIP,delta:3,kind:"OWNER_ADJUST",referenceId:randomUUID()});
 });
 afterEach(()=>db.close());
 function full(){
  const id=openRound(db),stamp=new Date().toISOString();
  for(let slot=1;slot<=10;slot++)db.prepare("INSERT INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,created_at,video_duration_seconds) VALUES(?,?,?,?,?,?,?,100)").run(randomUUID(),id,slot,author,"https://youtu.be/SKIPTEST"+String(slot).padStart(3,"0"),"SKIPTEST"+String(slot).padStart(3,"0"),stamp);
  db.prepare("UPDATE rounds SET status='READY' WHERE id=?").run(id);return id;
 }
 it("consultar todas as filas e ter Pular em estoque não cria inscrição ou acesso ao player",()=>{
  const ready=full();expect(activeRounds(db).some(round=>round.id===ready)).toBe(true);expect(itemQuantity(db,user,ITEM_SKIP)).toBe(3);expect(hasActiveRoundTask(db,user,ready)).toBe(false);
  expect(()=>preparePlaylistSelection(db,user,ready,false)).toThrow("use um Pular");expect(myRounds(db,user)).toHaveLength(1);
  joinRound(db,ready,user,"FREE");expect(hasActiveRoundTask(db,user,ready)).toBe(false);expect(()=>preparePlaylistSelection(db,user,ready,false)).toThrow();
 });
 it("Pular entra na READY escolhida e libera playlist sem URL própria uma única vez",()=>{
  const ready=full(),reference=randomUUID(),result=joinQueueWithSkip(db,user,reference,ready);
  expect(result.queue).toMatchObject({id:ready,status:"READY",vacancies:0});expect(result.skipsAvailable).toBe(2);expect(hasActiveRoundTask(db,user,ready)).toBe(true);
  expect(preparePlaylistSelection(db,user,ready,false)).toMatchObject({count:10,rewardEligible:true});
  expect(joinQueueWithSkip(db,user,reference,ready)).toMatchObject({replayed:true,skipsAvailable:2});
  expect(db.prepare("SELECT COUNT(*) AS n FROM item_grants WHERE user_id=? AND kind='CONSUME'").get(user)).toEqual({n:1});
  expect(db.prepare("SELECT COUNT(*) AS n FROM payments").get()).toEqual({n:0});
  leaveRound(db,ready,user);expect(hasActiveRoundTask(db,user,ready)).toBe(false);expect(()=>preparePlaylistSelection(db,user,ready,false)).toThrow();
  expect(joinQueueWithSkip(db,user,reference,ready).replayed).toBe(true);expect(hasActiveRoundTask(db,user,ready)).toBe(false);
 });
 it("seleciona outra OPEN existente em vez de escolher automaticamente a primeira",()=>{
  const two=openRound(db),three=openRound(db),count=activeRounds(db).length;
  const result=joinQueueWithSkip(db,user,randomUUID(),three);expect(result.queue.id).toBe(three);expect(activeRounds(db)).toHaveLength(count);expect(myRounds(db,user).some(round=>round.id===two)).toBe(false);
 });
 it("alvo inválido, encerrado ou já liberado não consome outro item",()=>{
  expect(()=>joinQueueWithSkip(db,user,randomUUID(),randomUUID())).toThrow();expect(itemQuantity(db,user,ITEM_SKIP)).toBe(3);
  const closed=openRound(db);closeRound(db,closed);expect(()=>joinQueueWithSkip(db,user,randomUUID(),closed)).toThrow();expect(itemQuantity(db,user,ITEM_SKIP)).toBe(3);
  const own=myRounds(db,user)[0].id;expect(()=>joinQueueWithSkip(db,user,randomUUID(),own)).toThrow("sem gastar outro item");expect(itemQuantity(db,user,ITEM_SKIP)).toBe(3);
 });
 it("o mesmo recibo não pode ser reaproveitado para outra fila",()=>{
  const one=full(),two=openRound(db),reference=randomUUID();joinQueueWithSkip(db,user,reference,one);
  expect(()=>joinQueueWithSkip(db,user,reference,two)).toThrow("Esta referência já foi usada em outra fila.");expect(itemQuantity(db,user,ITEM_SKIP)).toBe(2);expect(myRounds(db,user).some(round=>round.id===two)).toBe(false);
 });
 it("falha ao gravar recibo reverte consumo e entrada",()=>{
  const ready=full();db.exec("CREATE TRIGGER synthetic_skip_receipt BEFORE INSERT ON queue_skip_requests BEGIN SELECT RAISE(ABORT,'synthetic receipt failed'); END;");
  expect(()=>joinQueueWithSkip(db,user,randomUUID(),ready)).toThrow("synthetic receipt failed");expect(itemQuantity(db,user,ITEM_SKIP)).toBe(3);expect(hasActiveRoundTask(db,user,ready)).toBe(false);
 });
 it("carteira em revisão impede uso, mas Root não debita saldo persistido",()=>{
  const ready=full(),at=new Date().toISOString();db.prepare("UPDATE wallets SET payment_hold=1 WHERE user_id=?").run(user);
  expect(()=>joinQueueWithSkip(db,user,randomUUID(),ready)).toThrow("em análise");expect(itemQuantity(db,user,ITEM_SKIP)).toBe(3);
  db.prepare("INSERT INTO owner_access(id,user_id,phone,normalized_name,role,active,created_at,updated_at) VALUES('skip-root',?,'15550001234','root','ROOT_OWNER',1,?,?)").run(user,at,at);
  const result=joinQueueWithSkip(db,user,randomUUID(),ready);expect(result.skipsAvailable).toBe(Number.MAX_SAFE_INTEGER);
  expect(db.prepare("SELECT quantity FROM user_items WHERE user_id=? AND item_code=?").get(user,ITEM_SKIP)).toEqual({quantity:3});
 });
});
