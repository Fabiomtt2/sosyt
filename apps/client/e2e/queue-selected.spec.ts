import {test,expect} from "@playwright/test";
import Database from "better-sqlite3";
import {randomUUID} from "node:crypto";
import {resolve} from "node:path";
import {mkdirSync} from "node:fs";
import {ownerSession} from "./helpers/owner-session";
test("taskbar Pular escolhe fila pronta e prévia não consome nem concede acesso",async({page,request})=>{
 test.setTimeout(120000);
 const server="http://127.0.0.1:17333",owner=await ownerSession(request),oh={authorization:"Bearer "+owner};
 async function member(phone:string,name:string){
  expect((await request.post(server+"/admin/members",{headers:oh,data:{phone,name,groupCode:"1"}})).ok()).toBe(true);
  const code=(await (await request.post(server+"/auth/request-code",{data:{phone,name}})).json()).devCode;
  const response=await request.post(server+"/auth/verify",{data:{phone,code}});expect(response.ok()).toBe(true);return response.json();
 }
 const person=await member("5571999990883","Luna Escolha"),author=await member("5571999990884","Davi Autor"),db=new Database(resolve("../../.local-tmp/browser-test.db")),round=randomUUID(),now=new Date().toISOString(),headers={authorization:"Bearer "+person.token};
 try{
  const seq=(db.prepare("SELECT MAX(sequence)+1 AS n FROM rounds").get() as {n:number}).n,number=(db.prepare("SELECT MAX(display_number)+1 AS n FROM rounds WHERE closed_at IS NULL").get() as {n:number}).n;
  db.prepare("INSERT INTO rounds(id,sequence,display_number,status,created_at,completed_at) VALUES(?,?,?,'READY',?,?)").run(round,seq,number,now,now);
  for(let slot=1;slot<=10;slot++)db.prepare("INSERT INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,video_title,video_duration_seconds,created_at) VALUES(?,?,?,?,?,?,?,100,?)").run(randomUUID(),round,slot,author.user.id,"https://youtu.be/SELECTQ"+String(slot).padStart(4,"0"),"SELECTQ"+String(slot).padStart(4,"0"),"Vídeo da seleção "+slot,now);
  db.prepare("INSERT INTO user_items(user_id,item_code,quantity,updated_at) VALUES(?,'SKIP',2,?) ON CONFLICT(user_id,item_code) DO UPDATE SET quantity=2").run(person.user.id,now);
  await page.goto("/?audit=selected-queue");await page.evaluate(token=>{localStorage.setItem("conexao_token",token);localStorage.setItem("conexao_active_role","user");},person.token);await page.reload();
  const statusbar=page.getByRole("region",{name:"Inventário da conta"});
  await statusbar.getByRole("button",{name:"Pular: 2",exact:true}).click();
  const browser=page.getByRole("dialog",{name:"Explorar filas da comunidade"});await expect(browser).toBeVisible();
  await browser.getByRole("button").filter({has:page.locator("strong",{hasText:new RegExp("^Fila "+number+"$")})}).click();
  await expect(browser.getByRole("region",{name:"Prévia da fila selecionada"})).toContainText("Davi Autor");
  expect(db.prepare("SELECT 1 FROM round_participants WHERE round_id=? AND user_id=?").get(round,person.user.id)).toBeUndefined();
  expect((await (await request.get(server+"/queues/mine",{headers})).json()).skipsAvailable).toBe(2);
  const evidence=resolve("../../.local-tmp/benefit-halo-evidence");mkdirSync(evidence,{recursive:true});
  for(const width of [1440,390]){await page.setViewportSize({width,height:960});await browser.locator(".queue-browser-footer").scrollIntoViewIfNeeded();expect(await browser.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:resolve(evidence,"selected-queue-"+width+".png"),animations:"disabled"});}
  await browser.getByRole("button",{name:"Usar 1 Pular na Fila "+number,exact:true}).click();
  const confirmation=browser.getByRole("alertdialog",{name:"Confirmar uso de Pular"});await expect(confirmation).toContainText("acompanhamento dos 10 vídeos");
  expect((await (await request.get(server+"/queues/mine",{headers})).json()).skipsAvailable).toBe(2);
  const used=page.waitForResponse(r=>r.url()===server+"/queues/skip"&&r.request().method()==="POST");
  await confirmation.getByRole("button",{name:"Confirmar uso de 1 Pular",exact:true}).click();const response=await used;expect(response.status()).toBe(200);expect(response.request().postDataJSON().targetRoundId).toBe(round);
  await expect(browser).toHaveCount(0);await expect(statusbar.getByRole("button",{name:"Pular: 1",exact:true})).toBeVisible();
  const ready=page.locator(".ready-card").filter({hasText:new RegExp("FILA "+number+" ·")});await expect(ready.getByRole("button",{name:"Criar playlist",exact:true})).toBeVisible();
  expect((db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE user_id=?").get(person.user.id) as {n:number}).n).toBe(0);
  const retry=await request.post(server+"/queues/skip",{headers,data:response.request().postDataJSON()});expect(retry.status()).toBe(200);expect((await retry.json()).skipsAvailable).toBe(1);
 }finally{db.close();}
});
