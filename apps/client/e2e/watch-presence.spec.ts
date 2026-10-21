import {test,expect} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {resolve} from "node:path";
import {mkdirSync} from "node:fs";
import Database from "better-sqlite3";
import {ownerSession} from "./helpers/owner-session";

test("confirmação de presença pausa reprodução e retoma sem crédito pelo intervalo",async({page,request})=>{
 test.setTimeout(120000);
 const server="http://127.0.0.1:17333",owner=await ownerSession(request),phone="5571999990882",name="Bia Presença";
 expect((await request.post(server+"/admin/members",{headers:{authorization:"Bearer "+owner},data:{phone,name,groupCode:"1"}})).ok()).toBe(true);
 const code=(await (await request.post(server+"/auth/request-code",{data:{phone,name}})).json()).devCode;
 const verified=await request.post(server+"/auth/verify",{data:{phone,code}});expect(verified.ok()).toBe(true);
 const person=await verified.json(),db=new Database(resolve("../../.local-tmp/browser-test.db")),round=randomUUID(),now=new Date().toISOString();
 try{
  const seq=(db.prepare("SELECT COALESCE(MAX(sequence),0)+1 AS n FROM rounds").get() as {n:number}).n;
  const number=(db.prepare("SELECT COALESCE(MAX(display_number),0)+1 AS n FROM rounds WHERE closed_at IS NULL").get() as {n:number}).n;
  db.prepare("INSERT INTO rounds(id,sequence,display_number,status,created_at,completed_at) VALUES(?,?,?,'READY',?,?)").run(round,seq,number,now,now);
  db.prepare("INSERT INTO round_participants(round_id,user_id,source,joined_at) VALUES(?,?,'FREE',?)").run(round,person.user.id,now);
  for(let slot=1;slot<=10;slot++)db.prepare("INSERT INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,video_duration_seconds,created_at) VALUES(?,?,?,?,?,?,100,?)").run(randomUUID(),round,slot,person.user.id,"https://youtu.be/WATCHPR"+String(slot).padStart(4,"0"),"WATCHPR"+String(slot).padStart(4,"0"),now);
  db.prepare("INSERT INTO playlist_exports(id,round_id,user_id,youtube_playlist_id,status,added_count,created_at,updated_at) VALUES(?,?,?,'presence-fixture','SUCCESS',10,?,?)").run(randomUUID(),round,person.user.id,now,now);
  db.prepare("INSERT INTO watch_presence(user_id,next_check_at) VALUES(?,?)").run(person.user.id,Date.now()-1);
  // A deterministic official-player adapter fixture. Credit and nonce validation still use real HTTP.
  await page.addInitScript(`window.YT={Player:class{
   constructor(el,options){this.options=options;this.state=1;el.textContent="Player sintético para testar a pausa";queueMicrotask(()=>{options.events.onReady?.();options.events.onStateChange?.({data:1});});}
   getPlaylistIndex(){return 0;}getCurrentTime(){return 5;}getDuration(){return 100;}getPlaybackRate(){return 1;}getPlayerState(){return this.state;}
   pauseVideo(){this.state=2;this.options.events.onStateChange?.({data:2});}
   playVideo(){this.state=1;this.options.events.onStateChange?.({data:1});}
   destroy(){}
  }};`);
  await page.goto("/?audit=presence");
  await page.evaluate(token=>{localStorage.setItem("conexao_token",token);localStorage.setItem("conexao_active_role","user");},person.token);
  await page.reload();
  await page.getByRole("button",{name:/Acompanhar tarefa/}).click();
  const prompt=page.getByRole("dialog",{name:"Você continua por aqui?"});
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText("este intervalo não gera XP nem moedas");
  const evidence=resolve("../../.local-tmp/benefit-halo-evidence");mkdirSync(evidence,{recursive:true});
  for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await prompt.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:resolve(evidence,"watch-presence-"+width+".png"),animations:"disabled"});}
  const confirmation=page.waitForResponse(r=>r.url()===server+"/rounds/"+round+"/watch-presence/confirm"&&r.request().method()==="POST");
  await prompt.getByRole("button",{name:"Estou aqui, continuar",exact:true}).click();
  expect((await confirmation).status()).toBe(200);await expect(prompt).toHaveCount(0);
  expect((db.prepare("SELECT challenge_id FROM watch_presence WHERE user_id=?").get(person.user.id) as {challenge_id:string|null}).challenge_id).toBeNull();
  expect(db.prepare("SELECT COUNT(*) AS n FROM gamification_events WHERE user_id=? AND xp_delta>0").get(person.user.id)).toEqual({n:0});
 }finally{db.close();}
});
