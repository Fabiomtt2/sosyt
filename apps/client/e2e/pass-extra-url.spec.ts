import {test,expect} from "@playwright/test";
import Database from "better-sqlite3";
import {resolve} from "node:path";
import {ownerSession} from "./helpers/owner-session";
test("Passe libera mais uma URL na mesma fila sem transição ou débito duplicado",async({page,request})=>{
 test.setTimeout(120000);
 const server="http://127.0.0.1:17333",owner=await ownerSession(request),phone="5571999990885",name="Iara Passe";
 expect((await request.post(server+"/admin/members",{headers:{authorization:"Bearer "+owner},data:{phone,name,groupCode:"1"}})).ok()).toBe(true);
 const code=(await (await request.post(server+"/auth/request-code",{data:{phone,name}})).json()).devCode;
 const person=await (await request.post(server+"/auth/verify",{data:{phone,code}})).json(),headers={authorization:"Bearer "+person.token};
 const db=new Database(resolve("../../.local-tmp/browser-test.db"));
 try{
  db.prepare("UPDATE wallets SET extra_slot_passes=1 WHERE user_id=?").run(person.user.id);
  const first=await request.post(server+"/rounds/current/submissions",{headers,data:{url:"https://youtu.be/PASSTEST001"}});expect(first.status()).toBe(201);
  const own=db.prepare("SELECT round_id FROM submissions WHERE user_id=? AND video_id='PASSTEST001'").get(person.user.id) as {round_id:string};
  const before=await request.post(server+"/rounds/current/submissions",{headers,data:{url:"https://youtu.be/PASSTEST002",expectedRoundId:own.round_id}});expect(before.status()).toBe(409);
  await page.goto("/?audit=pass-extra-url");await page.evaluate(token=>{localStorage.setItem("conexao_token",token);localStorage.setItem("conexao_active_role","user");},person.token);await page.reload();
  const inventory=page.getByRole("region",{name:"Inventário da conta"});await inventory.getByRole("button",{name:"Passe: 1",exact:true}).click();
  const modal=page.getByRole("dialog",{name:"Explorar filas da comunidade"});await expect(modal).toContainText("+1 campo de URL");
  await modal.getByRole("button",{name:/Liberar \+1 URL na /}).click();
  const confirmation=modal.getByRole("alertdialog",{name:"Confirmar uso de Passe"});await expect(confirmation).toContainText("mesma fila");
  const used=page.waitForResponse(r=>r.url()===server+"/queues/pass"&&r.request().method()==="POST");
  await confirmation.getByRole("button",{name:"Confirmar uso de 1 Passe",exact:true}).click();expect((await used).status()).toBe(200);await expect(modal).toHaveCount(0);
  await expect(inventory.getByRole("button",{name:"Passe: 0",exact:true})).toBeVisible();
  expect(db.prepare("SELECT COUNT(*) AS n FROM round_participants WHERE user_id=?").get(person.user.id)).toEqual({n:1});
  await page.getByPlaceholder("Cole a URL do seu vídeo no YouTube").fill("https://youtu.be/PASSTEST002");
  const submitted=page.waitForResponse(r=>r.url()===server+"/rounds/current/submissions"&&r.request().method()==="POST");
  await page.getByRole("button",{name:/^Salvar no espaço /}).first().click();expect((await submitted).status()).toBe(201);
  expect(db.prepare("SELECT extra_slot_passes FROM wallets WHERE user_id=?").get(person.user.id)).toEqual({extra_slot_passes:0});
  expect(db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE user_id=? AND round_id=?").get(person.user.id,own.round_id)).toEqual({n:2});
 }finally{db.close();}
});
