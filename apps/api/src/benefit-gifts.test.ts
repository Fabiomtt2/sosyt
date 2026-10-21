import {afterEach,beforeEach,describe,it,expect} from "vitest";
import {randomUUID} from "node:crypto";
import {createDatabase,type AppDatabase} from "./db.js";
import {giftItem,grantItem} from "./inventory.js";
import {superState} from "./super.js";
describe("presentes usam os saldos reais e nunca criam receita",()=>{
 let db:AppDatabase;const a=randomUUID(),b=randomUUID(),at=new Date().toISOString();
 beforeEach(()=>{db=createDatabase(':memory:');for(const [id,phone] of [[a,'5571999990901'],[b,'5571999990902']]){db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,?,?,'1',?,?)").run(id,'Pessoa Sintética',phone,at,at);db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES(?,?)").run(id,at);}});
 afterEach(()=>db.close());
 it('Passe sai da carteira do remetente e chega uma vez ao destinatário',()=>{
  db.prepare('UPDATE wallets SET extra_slot_passes=2 WHERE user_id=?').run(a);const ref=randomUUID();
  for(let n=0;n<2;n++)giftItem(db,a,b,'PASS',1,false,ref);
  for(const id of [a,b])expect(db.prepare('SELECT extra_slot_passes AS n FROM wallets WHERE user_id=?').get(id)).toEqual({n:1});
  expect(db.prepare("SELECT COUNT(*) AS n FROM item_grants WHERE item_code='PASS' AND reference_id=?").get(ref)).toEqual({n:2});
  expect(db.prepare("SELECT COUNT(*) AS n FROM community_notifications WHERE user_id=?").get(b)).toEqual({n:1});
  expect(db.prepare('SELECT COUNT(*) AS n FROM payments').get()).toEqual({n:0});
  expect(()=>giftItem(db,a,b,'PASS',2,false,randomUUID())).toThrow(/Passe/);
  expect(db.prepare('SELECT extra_slot_passes AS n FROM wallets WHERE user_id=?').get(a)).toEqual({n:1});
 });
 it('Pular preserva compra original e registra transferência separada',()=>{
  grantItem(db,{userId:a,itemCode:'SKIP',delta:2,kind:'PURCHASE',referenceId:'synthetic-payment'});
  const ref=randomUUID();for(let n=0;n<2;n++)giftItem(db,a,b,'SKIP',1,false,ref);
  expect(db.prepare("SELECT kind,delta FROM item_grants ORDER BY rowid").all()).toEqual([{kind:'PURCHASE',delta:2},{kind:'GIFT_OUT',delta:-1},{kind:'GIFT_IN',delta:1}]);
  expect(db.prepare('SELECT COUNT(*) AS n FROM payments').get()).toEqual({n:0});
 });
 it('SUPER só pode ser concedido gratuitamente pelo Root, com fonte GIFT e sem duplicar dias',()=>{
  const ref=randomUUID();expect(()=>giftItem(db,a,b,'SUPER',1,false,ref)).toThrow(/Root/);
  for(let n=0;n<2;n++)giftItem(db,a,b,'SUPER',1,true,ref);
  expect(superState(db,b)).toMatchObject({active:true,source:'GIFT',autoRenew:false});
  expect(db.prepare('SELECT COUNT(*) AS n FROM super_events WHERE user_id=?').get(b)).toEqual({n:1});
  expect(db.prepare('SELECT COUNT(*) AS n FROM payments').get()).toEqual({n:0});
  expect(db.prepare('SELECT note FROM super_events WHERE user_id=?').get(b)).toMatchObject({note:expect.stringContaining('GIFT')});
 });
});
