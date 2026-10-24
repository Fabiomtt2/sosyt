import { randomUUID } from "node:crypto";
import { afterEach,beforeEach,describe,expect,it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase,type AppDatabase } from "./db.js";
import { initializeGamificationBot,readGamificationBot,saveGamificationBot } from "./gamification-bot.js";

describe("comunidade HTTP: sessões reais, consentimento e auditoria Root",()=>{
  let db:AppDatabase,app:Awaited<ReturnType<typeof buildApp>>;
  const rootPhone="5571999990001",secret="community-synthetic-root-secret-32";
  const bearer=(token:string)=>({authorization:"Bearer "+token});
  beforeEach(async()=>{
    db=createDatabase(":memory:");
    app=await buildApp(loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",AUTH_DEV_MODE:"true",WHATSAPP_MODE:"DISABLED",
      REQUIRE_GROUP_MEMBERSHIP:"false",JWT_SECRET:"community-synthetic-jwt-secret-32",
      AUTH_CODE_PEPPER:"community-test-pepper",OWNER_FABIO_ID:"fabio",OWNER_FABIO_NAME:"Fabio0",
      OWNER_FABIO_WHATSAPP:rootPhone,OWNER_FABIO_SECRET:secret}),db);
  });
  afterEach(async()=>{await app.close();db.close();});
  async function owner(){
    const response=await app.inject({method:"POST",url:"/admin/login",payload:{name:"Fabio",identifier:rootPhone,secret,groupCode:"#"}});
    expect(response.statusCode,response.body).toBe(200);
    return response.json().token as string;
  }
  async function participant(index:number){
    const phone="557199900"+String(index).padStart(4,"0"),name="Pessoa Sintetica "+index,stamp=new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO groups(code,enabled,membership_mode) VALUES('12',1,'OWNER')").run();
    db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES(?,'12',?,'TEST')").run(phone,stamp);
    const request=await app.inject({method:"POST",url:"/auth/request-code",payload:{name,phone}});
    expect(request.statusCode,request.body).toBe(200);
    const verified=await app.inject({method:"POST",url:"/auth/verify",payload:{phone,code:request.json().devCode}});
    expect(verified.statusCode,verified.body).toBe(200);
    const body=verified.json();
    return {token:body.token as string,id:body.user.id as string,phone};
  }
  async function invite(from:{token:string},to:{id:string}){
    const response=await app.inject({method:"POST",url:"/social/requests",headers:bearer(from.token),payload:{targetUserId:to.id,referenceId:randomUUID()}});
    expect(response.statusCode,response.body).toBe(200);return response.json().invitationId as string;
  }

  it("refazer amizade nos dois sentidos não repete XP para nenhuma conta",async()=>{
    const a=await participant(41),b=await participant(42);
    const respond=async(actor:{token:string},id:string,action:string)=>{
      const result=await app.inject({method:"POST",url:"/social/requests/"+id,headers:bearer(actor.token),payload:{action}});
      expect(result.statusCode,result.body).toBe(200);
    };
    const first=await invite(a,b);await respond(b,first,"ACCEPT");
    const xp=()=>db.prepare("SELECT user_id,xp_delta FROM gamification_events WHERE kind='CONTRIBUTION_XP' ORDER BY user_id,id").all();
    const original=xp();expect(original).toHaveLength(2);
    await respond(a,first,"REMOVE");
    const again=await invite(b,a);expect(again).not.toBe(first);
    await respond(a,again,"ACCEPT");
    expect(xp()).toEqual(original);
  });

  it("Owner configurado gerencia antes de criar sessão participante",async()=>{
    const token=await owner();
    expect(db.prepare("SELECT id FROM users WHERE phone=?").get(rootPhone)).toBeUndefined();
    const before=await app.inject({url:"/admin/community",headers:bearer(token)});
    expect(before.statusCode,before.body).toBe(200);
    const config={...before.json().config,maxGiftCoins:37};
    const saved=await app.inject({method:"PUT",url:"/admin/community",headers:bearer(token),payload:config});
    expect(saved.statusCode,saved.body).toBe(200);expect(saved.json().config.maxGiftCoins).toBe(37);
    const after=(await app.inject({url:"/admin/community",headers:bearer(token)})).json();
    expect(after.audit[0]).toMatchObject({actorId:"owner:fabio",action:"CONFIG_UPDATED"});
    expect((await app.inject({url:"/admin/community"})).statusCode).toBe(401);
  });

  it("Root promovido mantém id antigo e ADMIN não recebe configuração nem origens",async()=>{
    const id=randomUUID(),accessId=randomUUID(),stamp=new Date().toISOString();
    db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,'Fabio',?,'12',?,?)").run(id,rootPhone,stamp,stamp);
    db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES(?,?)").run(id,stamp);
    db.prepare("INSERT INTO owner_access(id,user_id,phone,normalized_name,role,active,created_at,updated_at) VALUES(?,?,?,'fabio','ADMIN_OWNER',1,?,?)").run(accessId,id,rootPhone,stamp,stamp);
    const root=await owner();
    const view=await app.inject({method:"POST",url:"/admin/participant-session",headers:bearer(root)});
    expect(view.statusCode,view.body).toBe(200);
    expect(db.prepare("SELECT id,role FROM owner_access WHERE user_id=?").get(id)).toEqual({id:accessId,role:"ROOT_OWNER"});
    expect((await app.inject({url:"/admin/community",headers:bearer(root)})).statusCode).toBe(200);
    const admin=await participant(9);
    // Existing delegated ADMIN accounts remain supported; the creation endpoint
    // intentionally restricts new administrative authids to Fabio/Rafael.
    db.prepare("INSERT INTO owner_access(id,user_id,phone,normalized_name,role,active,created_at,updated_at) VALUES(?,?,?,'pessoa sintetica 9','ADMIN_OWNER',1,?,?)")
      .run(randomUUID(),admin.id,admin.phone,stamp,stamp);
    const elevated=await app.inject({method:"POST",url:"/admin/elevate",headers:bearer(admin.token)});
    expect(elevated.statusCode,elevated.body).toBe(200);
    for(const method of ["GET","PUT"] as const){
      const response=await app.inject({method,url:"/admin/community",headers:bearer(elevated.json().token),...(method==="PUT"?{payload:{}}:{})});
      expect(response.statusCode,response.body).toBe(403);
    }
    expect((await app.inject({url:"/admin/community",headers:bearer(admin.token)})).statusCode).toBe(401);
  });

  it("duas sessões buscam WhatsApp exato, convidam, aceitam e leem DM sem expor telefone",async()=>{
    const a=await participant(1),b=await participant(2);
    const found=await app.inject({method:"POST",url:"/social/find",headers:bearer(a.token),payload:{phone:"+55 (71) 99900-0002"}});
    expect(found.statusCode,found.body).toBe(200);expect(found.json().user.id).toBe(b.id);
    expect(found.body).not.toContain(b.phone);expect(found.body).not.toContain('"phone"');
    const id=await invite(a,b);
    expect((await app.inject({url:"/social/unread",headers:bearer(b.token)})).json()).toEqual({unread:1});
    const notification=(await app.inject({url:"/social/notifications",headers:bearer(b.token)})).json().notifications[0];
    expect((await app.inject({method:"POST",url:"/social/notifications/read",headers:bearer(a.token),payload:{ids:[notification.id]}})).json().read).toBe(0);
    expect((await app.inject({method:"POST",url:"/social/requests/"+id,headers:bearer(a.token),payload:{action:"ACCEPT"}})).statusCode).toBe(403);
    const accepted=await app.inject({method:"POST",url:"/social/requests/"+id,headers:bearer(b.token),payload:{action:"ACCEPT"}});
    expect(accepted.statusCode,accepted.body).toBe(200);
    for(const [self,other] of [[a,b],[b,a]]){
      const overview=(await app.inject({url:"/social",headers:bearer(self.token)})).json();
      expect(overview.friends[0].user.id).toBe(other.id);
    }
    expect((await app.inject({url:"/social/unread",headers:bearer(b.token)})).json().unread).toBe(0);
    expect((await app.inject({url:"/social/unread",headers:bearer(a.token)})).json().unread).toBe(1);
    const dm=await app.inject({method:"POST",url:"/mail/dm",headers:bearer(a.token),payload:{toUserId:b.id,body:"Olá, amizade de teste."}});
    expect(dm.statusCode,dm.body).toBe(200);
    expect((await app.inject({url:"/mail/unread-count",headers:bearer(b.token)})).json().unread).toBe(1);
    const thread=await app.inject({url:"/mail/thread/"+a.id,headers:bearer(b.token)});
    expect(thread.json().messages[0].body).toBe("Olá, amizade de teste.");
    expect((await app.inject({url:"/mail/unread-count",headers:bearer(b.token)})).json().unread).toBe(0);
  });

  it("recusa, preferências e moderação justificada respeitam consentimento",async()=>{
    const a=await participant(1),b=await participant(2),root=await owner();
    const id=await invite(a,b);
    expect((await app.inject({method:"POST",url:"/social/requests/"+id,headers:bearer(b.token),payload:{action:"DECLINE"}})).statusCode).toBe(200);
    expect((await app.inject({url:"/social/unread",headers:bearer(b.token)})).json().unread).toBe(0);
    expect((await app.inject({method:"POST",url:"/social/requests",headers:bearer(a.token),payload:{targetUserId:b.id,referenceId:randomUUID()}})).statusCode).toBe(429);
    const c=await participant(3);
    expect((await app.inject({method:"PUT",url:"/social/preferences",headers:bearer(c.token),payload:{acceptFriendRequests:false}})).statusCode).toBe(200);
    expect((await app.inject({method:"POST",url:"/social/find",headers:bearer(a.token),payload:{phone:c.phone}})).statusCode).toBe(404);
    await app.inject({method:"PUT",url:"/social/preferences",headers:bearer(c.token),payload:{acceptFriendRequests:true}});
    const second=await invite(a,c),url="/admin/community/relationships/"+second+"/revoke";
    expect((await app.inject({method:"POST",url,headers:bearer(root),payload:{reason:"x"}})).statusCode).toBe(400);
    expect((await app.inject({method:"POST",url,headers:bearer(root),payload:{reason:"Solicitação de moderação sintética"}})).statusCode).toBe(200);
    const report=(await app.inject({url:"/admin/community",headers:bearer(root)})).json();
    expect(report.audit[0].action).toBe("ADMIN_FRIENDSHIP_REVOKED");
    expect(report.audit[0].payload).toContain("Solicitação de moderação sintética");
  });

  it("presente único mistura origens sem nova receita, nem exposição ao participante, nem replay debitado",async()=>{
    const a=await participant(1),b=await participant(2),root=await owner();
    db.prepare("UPDATE wallets SET reward_millis=3000,purchased_millis=5000 WHERE user_id=?").run(a.id);
    const referenceId=randomUUID(),payload={toUserId:b.id,coins:6,referenceId};
    const before=db.prepare("SELECT COUNT(*) AS n,COALESCE(SUM(amount_cents),0) AS revenue FROM payments").get();
    const gift=await app.inject({method:"POST",url:"/gamification/gift-coins",headers:bearer(a.token),payload});
    expect(gift.statusCode,gift.body).toBe(200);expect(gift.json()).toMatchObject({coins:6,replayed:false});
    expect(gift.body).not.toMatch(/reward|purchased|revenue/);
    const retry=await app.inject({method:"POST",url:"/gamification/gift-coins",headers:bearer(a.token),payload});
    expect(retry.json().replayed).toBe(true);
    expect(db.prepare("SELECT reward_millis AS reward,purchased_millis AS purchased FROM wallets WHERE user_id=?").get(b.id)).toEqual({reward:3000,purchased:3000});
    expect(db.prepare("SELECT COUNT(*) AS n,COALESCE(SUM(amount_cents),0) AS revenue FROM payments").get()).toEqual(before);
    const report=(await app.inject({url:"/admin/community",headers:bearer(root)})).json();
    expect(report.coinTransfers.totals).toMatchObject({count:1,amountMillis:6000,rewardMillis:3000,purchasedMillis:3000,revenueCents:0});
    const notices=await app.inject({url:"/social/notifications",headers:bearer(b.token)});
    expect(notices.json().notifications.filter((n:{kind:string})=>n.kind==="COINS_RECEIVED")).toHaveLength(1);
    expect(notices.body).not.toMatch(/reward|purchased/);
    expect(db.prepare("SELECT body FROM mail_messages WHERE recipient_id=? AND sender_role='SYSTEM'").get(b.id)).toEqual({body:"Oi, Pessoa Sintetica 2! Você recebeu um presente de 6 moedas da comunidade. Elas já estão disponíveis na sua conta!"});
  });

  it("remoção real de conta invalida sessão e não deixa convite ou identidade pessoal nas notificações",async()=>{
    const a=await participant(1),b=await participant(2);
    await invite(a,b);
    const deleted=await app.inject({method:"DELETE",url:"/profile/account",headers:bearer(a.token),payload:{confirmation:"DELETE_MY_ACCOUNT"}});
    expect(deleted.statusCode,deleted.body).toBe(200);
    const overview=(await app.inject({url:"/social",headers:bearer(b.token)})).json();
    expect(overview.incoming).toEqual([]);expect(overview.unread).toBe(0);
    const notifications=await app.inject({url:"/social/notifications",headers:bearer(b.token)});
    expect(notifications.json().notifications).toEqual([]);
    expect((await app.inject({url:"/social/profile/"+a.id,headers:bearer(b.token)})).statusCode).toBe(404);
    expect((await app.inject({url:"/social",headers:bearer(a.token)})).statusCode).toBe(401);
  });

  it("migra só texto padrão antigo de presente e preserva personalização Owner",()=>{
    const current=readGamificationBot(db).settings;
    const old="Oi, {name}! Você recebeu um presente de {coins} moedas de recompensa da comunidade. Elas já estão disponíveis na sua conta!";
    const legacy=structuredClone(current);
    legacy.events.REWARD_COINS_GIFTED.text=old;legacy.events.REWARD_COINS_GIFTED.whatsappEnabled=false;
    saveGamificationBot(db,legacy,"synthetic-root");initializeGamificationBot(db);
    expect(readGamificationBot(db).settings.events.REWARD_COINS_GIFTED).toMatchObject({text:old.replace("moedas de recompensa","moedas"),whatsappEnabled:false});
    legacy.events.REWARD_COINS_GIFTED.text="Olá {name}, você recebeu {coins} moedas! Texto do Owner.";
    saveGamificationBot(db,legacy,"synthetic-root");initializeGamificationBot(db);
    expect(readGamificationBot(db).settings).toEqual(legacy);
  });
  it("DM desconhecida aguarda solicitação gratuita e aceite só do destinatário",async()=>{
    const a=await participant(21),b=await participant(22),c=await participant(23);
    const send=()=>app.inject({method:"POST",url:"/mail/dm",headers:bearer(a.token),payload:{toUserId:b.id,body:"Mensagem com consentimento"}});
    expect((await send()).statusCode).toBe(403);
    expect((await app.inject({url:"/mail/unread-count",headers:bearer(b.token)})).json().unread).toBe(0);
    const wallet=db.prepare("SELECT * FROM wallets WHERE user_id=?").get(a.id);
    const asked=await app.inject({method:"POST",url:"/social/message-requests",headers:bearer(a.token),payload:{targetUserId:b.id}});
    expect(asked.statusCode,asked.body).toBe(200);expect(asked.json().status).toBe("PENDING");
    const pending=await app.inject({url:"/social/message-requests",headers:bearer(b.token)});
    expect(pending.json().requests[0]).toMatchObject({incoming:true,status:"PENDING",user:{id:a.id}});
    const respond=(token:string)=>app.inject({method:"POST",url:"/social/message-requests/"+asked.json().id,headers:bearer(token),payload:{accept:true}});
    expect((await respond(c.token)).statusCode).toBe(404);expect((await respond(a.token)).statusCode).toBe(404);
    expect((await send()).statusCode).toBe(403);expect((await respond(b.token)).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    expect(db.prepare("SELECT * FROM wallets WHERE user_id=?").get(a.id)).toEqual(wallet);
    expect((await app.inject({url:"/mail/unread-count",headers:bearer(b.token)})).json().unread).toBe(1);
  });

});
