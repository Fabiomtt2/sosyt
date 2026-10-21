import {test,expect as browserExpect} from "@playwright/test";
import {ownerSession} from "./helpers/owner-session";
import Database from "better-sqlite3";
import {randomUUID} from "node:crypto";
import {mkdirSync} from "node:fs";
import {resolve} from "node:path";
const expect=browserExpect.configure({timeout:15000});
test.use({actionTimeout:30000});
test("Owner concede os quatro benefícios sem receita e halos da fila ficam circulares",async({page,request})=>{
 test.setTimeout(180000);const api='http://127.0.0.1:17333',owner=await ownerSession(request),oh={authorization:'Bearer '+owner};
 const phone='5571999990951',name='Nara Benefícios';
 expect((await request.post(api+'/admin/members',{headers:oh,data:{phone,name,groupCode:'1'}})).ok()).toBe(true);
 const code=(await(await request.post(api+'/auth/request-code',{data:{phone,name}})).json()).devCode;
 const member=await(await request.post(api+'/auth/verify',{data:{phone,code}})).json(),mh={authorization:'Bearer '+member.token};
 const db=new Database(resolve('../../.local-tmp/browser-test.db'));const out=resolve('../../.local-tmp/benefit-halo-evidence');mkdirSync(out,{recursive:true});
 try{
  const revenue=()=>db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS n FROM payments WHERE provider<>'DEMO' AND status='APPROVED'").get();const before=revenue();
  await page.goto('/?audit=owner-benefits');await page.evaluate(token=>{localStorage.setItem('conexao_owner_token',token);localStorage.setItem('conexao_active_role','owner');},owner);await page.reload();
  await page.getByRole('button',{name:'Participantes',exact:true}).click();await page.getByRole('button',{name,exact:true}).click();
  const modal=page.getByRole('dialog',{name:'Administrar participante'}),form=modal.getByRole('form',{name:'Conceder presente ao participante'});
  await expect(modal.locator('.participant-account-id')).toContainText(member.user.id);
  for(const [benefit,quantity] of [['COINS',4],['PASS',2],['SKIP',3],['SUPER',30]] as const){
   await form.getByLabel('Benefício',{exact:true}).selectOption(benefit);
   await form.getByLabel(benefit==='SUPER'?'Dias de SUPER':'Quantidade do presente',{exact:true}).fill(String(quantity));
   await form.getByLabel('Motivo do presente',{exact:true}).fill('Agradecimento sintético pela participação');
   const sent=page.waitForResponse(r=>r.url().endsWith('/benefits')&&r.request().method()==='POST');await form.getByRole('button',{name:'Entregar presente',exact:true}).click();expect((await sent).status()).toBe(200);
   await expect(form.getByRole('status')).toContainText('Presente entregue');
  }
  for(const width of [1440,390]){await page.setViewportSize({width,height:960});await form.scrollIntoViewIfNeeded();expect(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:resolve(out,'owner-benefits-'+width+'.png'),animations:'disabled'});}
  expect(revenue()).toEqual(before);
  expect(db.prepare('SELECT reward_millis,extra_slot_passes FROM wallets WHERE user_id=?').get(member.user.id)).toMatchObject({reward_millis:4000,extra_slot_passes:2});
  expect((await(await request.get(api+'/queues/mine',{headers:mh})).json()).skipsAvailable).toBe(3);
  expect((await(await request.get(api+'/super/me',{headers:mh})).json()).source).toBe('GIFT');
  const admin=await(await request.post(api+'/admin/participant-session',{headers:oh})).json();
  await request.put(api+'/profile/avatar',{headers:{authorization:'Bearer '+admin.token},data:{kind:'PRESET',presetId:'avatar-01'}});
  await request.put(api+'/profile/avatar',{headers:mh,data:{kind:'PRESET',presetId:'avatar-17'}});
  // Synthetic queue fixture only; identities and presentations are rendered by the real API.
  const id=randomUUID(),stamp=new Date().toISOString(),sequence=(db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM rounds').get() as {n:number}).n;
  db.prepare("INSERT INTO rounds(id,sequence,display_number,status,created_at) VALUES(?,?,901,'OPEN',?)").run(id,sequence,stamp);
  for(const [index,userId,role] of [[1,admin.user.id,'ROOT_OWNER'],[2,member.user.id,null]] as const){
   db.prepare("INSERT INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,admin_role,created_at,video_title) VALUES(?,?,?,?,?,?,?,?,?)").run(randomUUID(),id,index,userId,'https://youtu.be/HALO000000'+index,'HALO000000'+index,role,stamp,'Retrato e presença na comunidade');
   db.prepare("INSERT INTO round_participants(round_id,user_id,source,joined_at) VALUES(?,?,'FREE',?)").run(id,userId,stamp);
  }
  await page.evaluate(token=>{localStorage.setItem('conexao_token',token);localStorage.setItem('conexao_active_role','user');sessionStorage.setItem('sos-chat-open','false');},admin.token);await page.reload();
  await page.getByRole('region',{name:'Minhas filas'}).getByRole('tab').filter({has:page.locator('b',{hasText:/^Fila 901$/})}).click();
  for(const tier of ['owner','super']){
   const avatar=page.locator('.board .user-avatar.avatar-tier-'+tier).first();await expect(avatar).toBeVisible();
   expect(await avatar.evaluate(el=>({radius:getComputedStyle(el).borderRadius,shadow:getComputedStyle(el).boxShadow,overflow:getComputedStyle(el.parentElement!).overflow}))).toMatchObject({radius:'50%',overflow:'visible'});
   expect(await avatar.evaluate(el=>getComputedStyle(el).boxShadow)).not.toBe('none');
  }
  for(const width of [1440,390]){await page.setViewportSize({width,height:960});const board=page.locator('.board').first();await board.scrollIntoViewIfNeeded();await board.screenshot({path:resolve(out,'queue-halos-'+width+'.png'),animations:'disabled'});}
 }finally{db.close();}
});
