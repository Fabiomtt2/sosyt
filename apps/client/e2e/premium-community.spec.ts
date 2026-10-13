import {test,expect} from "@playwright/test";
import {resolve} from "node:path";
import {readFileSync,existsSync} from "node:fs";
test("Híbrido+, avatar Owner, loja lateral, conversa e presente convergem no navegador",async({page,request})=>{
 test.setTimeout(180000);
 const server="http://127.0.0.1:17333",evidence=resolve("../../docs/evidencias");
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const sessionFile=resolve("../../.local-tmp/browser-owner-session.json");
 let owner:string;
 if(existsSync(sessionFile))owner=JSON.parse(readFileSync(sessionFile,"utf8")).token;
 else {const login=await request.post(server+"/admin/login",{data:{name:"Fabio0",identifier:"5571999990001",groupCode:"#",secret:"e2e-owner-secret-32-characters-long"}});expect(login.ok(),await login.text()).toBe(true);owner=(await login.json()).token;}
 const ownerHeaders={authorization:"Bearer "+owner};
 const webp="data:image/webp;base64,"+readFileSync(resolve("public/assets/user/coins-editorial-v2.webp")).toString("base64");
 const cat=await request.post(server+"/admin/avatars",{headers:ownerHeaders,data:{tier:"OWNER",category:"OBJECTS",label:"Avatar Premium E2E",dataUrl:webp}});
 expect(cat.ok(),await cat.text()).toBe(true);const slug=(await cat.json()).slug;
 await page.goto("/?audit=premium-community");
 await page.evaluate(token=>{localStorage.setItem("conexao_owner_token",token);localStorage.setItem("conexao_active_role","owner");},owner);await page.reload();
 await page.getByRole("button",{name:"Integrações",exact:true}).click();
 await page.getByRole("button",{name:"Configurar integração",exact:true}).click();
 const integration=page.getByRole("dialog",{name:"Configurar integração WhatsApp"});
 await integration.getByRole("radio",{name:/Híbrido\+/}).click();
 await expect(integration.getByText("Evolution · motor de grupos",{exact:true})).toBeVisible();
 await integration.getByRole("button",{name:"Salvar configuração",exact:true}).click();
 await expect(integration.getByRole("status")).toBeVisible();
 expect((await (await request.get(server+"/admin/bot",{headers:ownerHeaders})).json()).status.mode).toBe("HYBRID_PLUS");
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});await integration.getByRole("radio",{name:/Híbrido\+/}).scrollIntoViewIfNeeded();
  expect(await integration.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({animations:"disabled",path:resolve(evidence,"premium-hybrid-"+width+".png"),fullPage:false});
 }
 await page.keyboard.press("Escape");await page.setViewportSize({width:1440,height:960});
 await page.getByRole("button",{name:/Trocar avatar/}).click();
 await page.getByRole("button",{name:"Escolher Avatar Premium E2E",exact:true}).click();
 await expect(page.getByRole("dialog",{name:"Escolher avatar"})).toHaveCount(0);
 const adminSession=await request.post(server+"/admin/participant-session",{headers:ownerHeaders});
 expect(adminSession.ok()).toBe(true);const rootParticipant=(await adminSession.json()).token;
 expect((await (await request.get(server+"/dashboard",{headers:{authorization:"Bearer "+rootParticipant}})).json()).user.avatar).toMatchObject({kind:"CATALOG",slug});
 async function member(phone:string,name:string){
  expect((await request.post(server+"/admin/members",{headers:ownerHeaders,data:{phone,name,groupCode:"1"}})).ok()).toBe(true);
  const req=await request.post(server+"/auth/request-code",{data:{phone,name}});
  const verify=await request.post(server+"/auth/verify",{data:{phone,code:(await req.json()).devCode}});
  expect(verify.ok()).toBe(true);return await verify.json();
 }
 const alice=await member("5571999990201","Alice Premium"),bruno=await member("5571999990202","Bruno Premium");
 expect((await request.post(server+"/chat/global",{headers:{authorization:"Bearer "+rootParticipant},data:{body:"Bem-vindos! Este é nosso espaço de conversa."}})).ok()).toBe(true);
 const ah={authorization:"Bearer "+alice.token},bh={authorization:"Bearer "+bruno.token};
 await request.post(server+"/chat/global",{headers:bh,data:{body:"Olá, Alice! Vamos criar juntos."}});
 const pix=await request.post(server+"/payments/pix",{headers:ah,data:{product:"SKIP_1",email:"alice@example.test",cpf:"52998224725"}});
 expect(pix.ok(),await pix.text()).toBe(true);
 const payment=await pix.json();
 expect((await request.post(server+"/payments/"+payment.id+"/demo-approve",{headers:ah})).ok()).toBe(true);
 await page.evaluate(token=>{localStorage.setItem("conexao_token",token);localStorage.setItem("conexao_active_role","user");},alice.token);
 let resumeDashboard!:()=>void;
 const loadingGate=new Promise<void>(resolve=>{resumeDashboard=resolve;});
 await page.route(/\/dashboard(?:\?.*)?$/,async route=>{await loadingGate;await route.continue();});
 await page.reload({waitUntil:"domcontentloaded"});
 await expect(page.getByRole("heading",{name:"Seu espaço está chegando."})).toBeVisible();
 await page.screenshot({animations:"disabled",path:resolve(evidence,"community-loading-1440.png"),fullPage:false});
 resumeDashboard();
 await expect(page.getByRole("heading",{name:"Vamos montar a próxima seleção?"})).toBeVisible();
 await expect(page.locator(".global-chat")).toHaveClass(/open/);
 const room=page.getByRole("complementary",{name:"Chat global da comunidade"});
 await expect(room.getByText("Bem-vindos! Este é nosso espaço de conversa.",{exact:true})).toBeVisible();
 await expect(room.locator(".gc-msg-staff .user-avatar.catalog")).toHaveCount(1);
 await expect.poll(()=>room.locator(".gc-msg-staff .user-avatar.catalog img").evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
 await room.getByLabel("Mensagem para o chat global").fill("Bom dia, comunidade! Vamos criar juntos.");
 await room.getByRole("button",{name:"Enviar mensagem à comunidade"}).click();
 await expect(room.locator(".gc-msg-mine")).toContainText("Bom dia, comunidade!");
 expect((await (await request.get(server+"/chat/global",{headers:bh})).json()).messages.some((m:any)=>m.body==="Bom dia, comunidade! Vamos criar juntos.")).toBe(true);

 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});

  const chatBounds=await room.boundingBox();expect(chatBounds).not.toBeNull();
  expect(chatBounds!.height).toBeGreaterThan(250);
  expect(chatBounds!.x).toBeGreaterThanOrEqual(0);
  expect(chatBounds!.x+chatBounds!.width).toBeLessThanOrEqual(width);
  const dashboard=await page.locator("main.dashboard").boundingBox();
  if(width===1440){expect(chatBounds!.height).toBeGreaterThan(650);expect(dashboard!.x+dashboard!.width).toBeLessThanOrEqual(chatBounds!.x);}
  else expect(dashboard!.y+dashboard!.height).toBeLessThanOrEqual(chatBounds!.y);
  await page.screenshot({animations:"disabled",path:resolve(evidence,"premium-participant-"+width+".png"),fullPage:false});
 }
 await page.getByRole("button",{name:"Conhecer os benefícios",exact:true}).click();
 const store=page.getByRole("dialog",{name:"Loja SOS YouTuber"});
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  expect(await store.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await expect.poll(async()=>{const box=await store.boundingBox();return box?Math.abs(box.x+box.width-width):Infinity;}).toBeLessThanOrEqual(1);
  expect(await page.evaluate(()=>getComputedStyle(document.body).overflow)).toBe("hidden");
  for(const code of ["SKIP_1","SUPER_30"]){
   const card=store.locator('[data-product-code="'+code+'"]');
   const bounds=await card.boundingBox();
   for(const art of await card.locator(".art-video-card,.super-medallion,.art-orbit").all()){
    const box=await art.boundingBox();expect(bounds).not.toBeNull();expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(bounds!.x+1);
    expect(box!.x+box!.width).toBeLessThanOrEqual(bounds!.x+bounds!.width-1);
   }
  }
  await store.locator('[data-product-code="SUPER_30"]').scrollIntoViewIfNeeded();
  await page.screenshot({animations:"disabled",path:resolve(evidence,"premium-store-super-"+width+".png"),fullPage:false});
  await store.evaluate(el=>el.scrollTop=0);
  await page.screenshot({animations:"disabled",path:resolve(evidence,"premium-store-"+width+".png"),fullPage:false});
 }
 await page.keyboard.press("Escape");await expect(store).toHaveCount(0);
 await page.setViewportSize({width:1440,height:900});
 await expect(page.getByRole("log",{name:"Mensagens da comunidade"})).toBeVisible();
 await page.getByRole("button",{name:"Ver Bruno Premium",exact:true}).click();
 await page.getByRole("button",{name:"Abrir conversa",exact:true}).click();
 const community=page.getByRole("dialog",{name:"Mensagens e inventário"});
 await expect(community.getByText("Bruno Premium",{exact:true}).first()).toBeVisible();
 await community.getByLabel("Seu recado").fill("Oi Bruno, este recado fica salvo para você.");
 await community.getByRole("button",{name:"Enviar",exact:true}).click();
 await expect(community.locator(".community-messages").getByText("Oi Bruno, este recado fica salvo para você.",{exact:true})).toBeVisible();
 const inbox=await request.get(server+"/mail/inbox",{headers:bh});expect((await inbox.json()).threads.some((t:any)=>t.with?.name==="Alice Premium")).toBe(true);
 await community.getByRole("button",{name:"1 Pular",exact:true}).click();
 await expect(community.locator(".gift-confirm")).toContainText("Bruno Premium");
 await expect(community.locator(".community-threads button").first()).toBeDisabled();
 await community.getByRole("button",{name:"Confirmar presente",exact:true}).click();
 await expect(community.getByRole("status")).toContainText("Presente entregue");
 expect((await (await request.get(server+"/queues/mine",{headers:bh})).json()).skipsAvailable).toBe(1);
 expect((await (await request.get(server+"/queues/mine",{headers:ah})).json()).skipsAvailable).toBe(0);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  expect(await community.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({animations:"disabled",path:resolve(evidence,"premium-messages-"+width+".png"),fullPage:false});
 }
 await page.keyboard.press("Escape");await expect(community).toHaveCount(0);
 expect(await page.evaluate(()=>getComputedStyle(document.body).overflow)).not.toBe("hidden");
 const before=(await (await request.get(server+"/dashboard",{headers:bh})).json()).openRound.id;
 const skipped=await request.post(server+"/queues/skip",{headers:bh});expect(skipped.ok(),await skipped.text()).toBe(true);
 const next=(await skipped.json()).queue.id;expect(next).not.toBe(before);
 expect((await (await request.get(server+"/queues/mine",{headers:bh})).json()).queues).toHaveLength(2);
 const contribution=await request.post(server+"/rounds/current/submissions",{headers:bh,data:{url:"https://youtu.be/E2EPRE00001",expectedRoundId:next}});
 expect(contribution.ok(),await contribution.text()).toBe(true);
 const board=(await (await request.get(server+"/dashboard?roundId="+next,{headers:bh})).json());
 expect(board.openRound.slots.find((slot:any)=>slot.videoId==="E2EPRE00001")?.userId).toBe(bruno.user.id);
 expect(errors).toEqual([]);
});
