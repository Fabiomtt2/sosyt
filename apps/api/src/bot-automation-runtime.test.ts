import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { createDatabase,type AppDatabase } from "./db.js";
import { loadConfig,type Config } from "./config.js";
import { saveAutomationSettings } from "./bot-automation-store.js";
import { recordBotAutomationEvent,ensureBotAutomationRuntime,dispatchBotAutomations,scheduleBotAutomations,botAutomationRuntimeStatus } from "./bot-automation-runtime.js";
import { setOptOut } from "./bot-inbound.js";
import { queueBotNotification,queueGroupAutomation } from "./whatsapp.js";

describe("runtime de automações: fatos reais, privacidade e recibos",()=>{
  let db:AppDatabase,config:Config;
  const time="2026-10-16T15:00:00.000Z";
  beforeEach(()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date(time));
    vi.stubGlobal("fetch",vi.fn(()=>{throw new Error("Network forbidden in automation tests");}));
    db=createDatabase(":memory:");ensureBotAutomationRuntime(db);
    config=loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",JWT_SECRET:"automation-fixture-secret-32-long",AUTH_CODE_PEPPER:"automation-fixture-pepper"});
    db.prepare("INSERT OR IGNORE INTO groups(code,enabled,whatsapp_group_id) VALUES('1',1,'12345678901@g.us')").run();
    db.prepare("UPDATE groups SET whatsapp_group_id='12345678901@g.us',enabled=1 WHERE code='1'").run();
    db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES('ana','Ana','5571999990001','1',?,?)").run(time,time);
  });
  afterEach(()=>{db.close();vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
  const queueFixture=(recipient:string,body:string,key:string)=>{
    const id="fixture:"+key;
    db.prepare("INSERT OR IGNORE INTO whatsapp_outbox(id,dedupe_key,recipient,payload,available_at,created_at) VALUES(?,?,?,?,?,?)")
      .run(id,key,recipient,JSON.stringify({body}),new Date().toISOString(),new Date().toISOString());
    return {queued:true,outboxId:id};
  };
  const fake=()=>({
    dm:vi.fn<typeof queueBotNotification>((_db,_config,recipient,body,key)=>queueFixture(recipient,body,key)),
    group:vi.fn<typeof queueGroupAutomation>((_db,_config,recipient,body,key)=>queueFixture(recipient,body,key)),
  });
  const welcome=()=>recordBotAutomationEvent(db,{event:"WELCOME_DM",sourceId:"approval:fixture",userId:"ana",groupCode:"1",vars:{nome:"Ana",grupo:"1",link:config.WEB_APP_URL}});
  it("deduplica o fato, renderiza edição Owner e só recebe SENT do recibo",()=>{
    saveAutomationSettings(db,"WELCOME_DM",{text:"Bem-vinda, {nome}! Grupo {grupo}: {link}"},{id:"root",name:"Owner sintético"});
    expect(welcome()).toBe(welcome());const transport=fake();
    expect(dispatchBotAutomations(db,config,new Date(),transport).queued).toBe(1);
    expect(transport.dm).toHaveBeenCalledTimes(1);
    expect((transport.dm.mock.calls[0])[3]).toContain("Bem-vinda, Ana!");
    dispatchBotAutomations(db,config,new Date(),transport);
    expect(transport.dm).toHaveBeenCalledTimes(1);
    expect(botAutomationRuntimeStatus(db).deliveries[0]).toMatchObject({event:"WELCOME_DM",status:"QUEUED",sourceId:"approval:fixture"});
    db.prepare("UPDATE whatsapp_outbox SET status='SENT',provider_message_id='synthetic-confirmed-receipt'").run();
    dispatchBotAutomations(db,config,new Date(),transport);
    expect(botAutomationRuntimeStatus(db).deliveries[0]).toMatchObject({status:"SENT"});
    expect(fetch).not.toHaveBeenCalled();
  });
  it("respeita enabled, sem reviver evento antigo depois de ativar",()=>{
    saveAutomationSettings(db,"WELCOME_DM",{enabled:false});welcome();
    const transport=fake();dispatchBotAutomations(db,config,new Date(),transport);
    saveAutomationSettings(db,"WELCOME_DM",{enabled:true});dispatchBotAutomations(db,config,new Date(),transport);
    expect(transport.dm).not.toHaveBeenCalled();
    expect(botAutomationRuntimeStatus(db).events).toContainEqual({event:"WELCOME_DM",status:"SKIPPED",reason:"EVENT_DISABLED",total:1});
  });
  it("não inventa placeholder faltante ou sucesso sem conexão",()=>{
    recordBotAutomationEvent(db,{event:"UPLOAD_NOTICE",sourceId:"upload:1",groupCode:"1",vars:{nome:"Ana",fila:1}});
    dispatchBotAutomations(db,config);
    expect(botAutomationRuntimeStatus(db).events).toContainEqual({event:"UPLOAD_NOTICE",status:"FAILED",reason:"MISSING_EVENT_DATA",total:1});
    welcome();dispatchBotAutomations(db,config);
    expect(botAutomationRuntimeStatus(db).deliveries[0]).toMatchObject({status:"WAITING",reason:"PROVIDER_NOT_READY"});
    expect(fetch).not.toHaveBeenCalled();
  });
  it("perfil malicioso não publica telefone no grupo e não mistura grupos",()=>{
    recordBotAutomationEvent(db,{event:"UPLOAD_NOTICE",sourceId:"upload:2",groupCode:"1",vars:{nome:"Ana +55 (71) 99999-0001",sala:1,posicao:2,aba:"Links",fila:3}});
    const transport=fake();dispatchBotAutomations(db,config,new Date(),transport);
    expect(transport.group).toHaveBeenCalledTimes(1);
    expect(transport.group.mock.calls[0][2]).toBe("12345678901@g.us");
    expect(transport.group.mock.calls[0][3]).toContain("[dado privado]");
    expect(transport.group.mock.calls[0][3]).not.toContain("99999");
    expect(transport.dm).not.toHaveBeenCalled();
  });
  it("opt-out barra recompensa, mas conserva aviso transacional solicitado",()=>{
    saveAutomationSettings(db,"COINS_EARNED",{enabled:true});
    setOptOut(db,"5571999990001",true);
    recordBotAutomationEvent(db,{event:"COINS_EARNED",sourceId:"ledger:1",userId:"ana",vars:{nome:"Ana",moedas:1,total:5}});
    welcome();const transport=fake();dispatchBotAutomations(db,config,new Date(),transport);
    expect(transport.dm).toHaveBeenCalledTimes(1);
    expect(botAutomationRuntimeStatus(db).deliveries).toContainEqual(expect.objectContaining({event:"COINS_EARNED",status:"SKIPPED",reason:"OPTED_OUT"}));
  });
  it("remoção da conta ou desativação do grupo entre evento e envio impede saída",()=>{
    welcome();
    db.prepare("UPDATE users SET deleted_at=? WHERE id='ana'").run(time);
    recordBotAutomationEvent(db,{event:"UPLOAD_NOTICE",sourceId:"upload:3",groupCode:"1",vars:{nome:"Ana",sala:1,posicao:2,aba:"Links",fila:3}});
    db.prepare("UPDATE groups SET enabled=0").run();
    const transport=fake();dispatchBotAutomations(db,config,new Date(),transport);
    expect(transport.dm).not.toHaveBeenCalled();expect(transport.group).not.toHaveBeenCalled();
  });
  it("fanout fica persistido, reinício não refaz recipients e grupo novo não recebe recado antigo",()=>{
    vi.spyOn(Math,"random").mockReturnValue(0);
    db.prepare("INSERT INTO groups(code,enabled,whatsapp_group_id) VALUES('2',1,'12345678902@g.us')").run();
    recordBotAutomationEvent(db,{event:"QUEUE_OPEN",sourceId:"round:1",vars:{fila:1,link:config.WEB_APP_URL}});
    const transport=fake();dispatchBotAutomations(db,config,new Date(),transport);
    expect(transport.group).toHaveBeenCalledTimes(1);
    db.prepare("INSERT INTO groups(code,enabled,whatsapp_group_id) VALUES('3',1,'12345678903@g.us')").run();
    vi.setSystemTime(new Date(Date.parse(time)+3600_000));
    ensureBotAutomationRuntime(db);dispatchBotAutomations(db,config,new Date(),transport);
    expect(transport.group).toHaveBeenCalledTimes(2);
    expect(transport.group.mock.calls.map(c=>c[2])).not.toContain("12345678903@g.us");
    vi.restoreAllMocks();
  });
  it("o agendador diário continua dono exclusivo das saudações e status",()=>{
    scheduleBotAutomations(db,config);
    vi.setSystemTime(new Date(Date.parse(time)+8*86_400_000));
    scheduleBotAutomations(db,config);
    expect(db.prepare("SELECT event FROM bot_automation_events WHERE event IN ('GOOD_MORNING','GOOD_NIGHT','QUEUE_STATUS')").all()).toEqual([]);
  });
  it("enfileira sem consumir freios de envio ou fingir envio confirmado",()=>{
    const transport=fake();
    for(let i=0;i<8;i++)recordBotAutomationEvent(db,{event:"UPLOAD_NOTICE",sourceId:"upload:"+i,groupCode:"1",vars:{nome:"Ana",sala:1,posicao:i+1,aba:"Links",fila:1}});
    expect(dispatchBotAutomations(db,config,new Date(),transport).queued).toBe(8);
    expect(botAutomationRuntimeStatus(db).deliveries.every((d:any)=>d.status==="QUEUED")).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("chave geral de anúncios desliga enfileiramento apesar do template ligado",()=>{
    db.prepare("INSERT INTO integration_settings(key,value,updated_at) VALUES('bot.feature.QUEUE_ANNOUNCE','0',?)").run(time);
    recordBotAutomationEvent(db,{event:"UPLOAD_NOTICE",sourceId:"feature:1",groupCode:"1",vars:{nome:"Ana",sala:1,posicao:2,aba:"Links",fila:1}});
    const transport=fake();dispatchBotAutomations(db,config,new Date(),transport);
    expect(transport.group).not.toHaveBeenCalled();
    expect(botAutomationRuntimeStatus(db).events).toContainEqual({event:"UPLOAD_NOTICE",status:"SKIPPED",reason:"EVENT_DISABLED",total:1});
  });
  it("aviso de grupo noturno permanece no outbox com validade para o worker respeitar silêncio",()=>{
    vi.setSystemTime(new Date("2026-10-17T04:00:00.000Z"));
    recordBotAutomationEvent(db,{event:"UPLOAD_NOTICE",sourceId:"night:1",groupCode:"1",vars:{nome:"Ana",sala:1,posicao:2,aba:"Links",fila:1}});
    const transport=fake();expect(dispatchBotAutomations(db,config,new Date(),transport).queued).toBe(1);
    expect(transport.group.mock.calls[0][5]).toMatchObject({expiresAt:"2026-10-18T04:00:00.000Z"});
    expect(botAutomationRuntimeStatus(db).deliveries[0]).toMatchObject({status:"QUEUED"});
  });
  it("capacidade informa delegação e pendências reais",()=>{
    expect(botAutomationRuntimeStatus(db).capabilities).toEqual(expect.arrayContaining([
      {event:"INACTIVITY_NUDGE",status:"WIRED"},
      {event:"STREAK_MILESTONE",status:"WIRED"},
      {event:"PINNED_MESSAGE",status:"TEXT_ONLY_PIN_UNAVAILABLE"},
      {event:"GOOD_MORNING",status:"DELEGATED_DAILY_SCHEDULER"}
    ]));
  });
  const xp=(id:string,date:string,user="ana",amount=10,kind="VIDEO_XP")=>db.prepare("INSERT INTO gamification_events(id,user_id,kind,reference_id,xp_delta,payload_json,created_at) VALUES(?,?,?,?,?,'{}',?)").run(id,user,kind,id,amount,date);
  const enabledGamification=()=>{
    const row=db.prepare("SELECT config_json AS json FROM gamification_config WHERE id=1").get() as {json:string};
    db.prepare("UPDATE gamification_config SET config_json=? WHERE id=1").run(JSON.stringify({...JSON.parse(row.json),enabled:true}));
  };
  it("sequência usa dias Bahia de XP verificado e não repete após restart",()=>{
    enabledGamification();
    xp("watch1","2026-10-14T15:00:00.000Z");xp("watch2","2026-10-15T15:00:00.000Z");
    scheduleBotAutomations(db,config);
    vi.setSystemTime(new Date(Date.parse(time)+3600_000));
    xp("watch3",new Date().toISOString());xp("gift",new Date().toISOString(),"ana",900,"REWARD_GIFT_IN");
    scheduleBotAutomations(db,config);
    const rows=db.prepare("SELECT vars_json AS vars FROM bot_automation_events WHERE event='STREAK_MILESTONE'").all() as Array<{vars:string}>;
    expect(rows).toHaveLength(1);expect(JSON.parse(rows[0].vars)).toMatchObject({nome:"Ana",dias:3});
    vi.setSystemTime(new Date(Date.now()+3600_000));ensureBotAutomationRuntime(db);scheduleBotAutomations(db,config);
    expect(db.prepare("SELECT COUNT(*) AS n FROM bot_automation_events WHERE event='STREAK_MILESTONE'").get()).toEqual({n:1});
  });
  it("deploy observa inativos antes de avisar, uma vez por episódio, sem Root",()=>{
    enabledGamification();xp("old","2026-10-01T15:00:00.000Z");
    scheduleBotAutomations(db,config);
    expect(db.prepare("SELECT event FROM bot_automation_events WHERE event='INACTIVITY_NUDGE'").all()).toEqual([]);
    vi.setSystemTime(new Date(Date.parse(time)+8*86_400_000));scheduleBotAutomations(db,config);
    expect(db.prepare("SELECT COUNT(*) AS n FROM bot_automation_events WHERE event='INACTIVITY_NUDGE'").get()).toEqual({n:1});
    vi.setSystemTime(new Date(Date.now()+8*86_400_000));scheduleBotAutomations(db,config);
    expect(db.prepare("SELECT COUNT(*) AS n FROM bot_automation_events WHERE event='INACTIVITY_NUDGE'").get()).toEqual({n:1});
  });
  it("ranking usa apenas VIDEO_XP recente e respeita master BROADCAST",()=>{
    enabledGamification();
    db.prepare("INSERT INTO integration_settings(key,value,updated_at) VALUES('bot.feature.BROADCAST','1',?)").run(time);
    saveAutomationSettings(db,"WEEKLY_XP_RANK",{intervalMinutes:15});
    scheduleBotAutomations(db,config);
    vi.setSystemTime(new Date(Date.parse(time)+3600_000));
    xp("rank-watch",new Date().toISOString(),"ana",25);xp("fake-admin",new Date().toISOString(),"ana",999,"ADMIN");
    scheduleBotAutomations(db,config);
    const row=db.prepare("SELECT vars_json AS vars FROM bot_automation_events WHERE event='WEEKLY_XP_RANK'").get() as {vars:string};
    expect(JSON.parse(row.vars).ranking).toContain("25 XP");expect(row.vars).not.toContain("999");
  });
  it("SUPER avisa uma vez por expiração e preserva o texto Owner",()=>{
    saveAutomationSettings(db,"SUPER_EXPIRING",{intervalMinutes:15,text:"Olá {nome}, faltam {dias} dias. {link}"});
    db.prepare("INSERT INTO super_subscriptions(user_id,started_at,expires_at,updated_at) VALUES('ana',?,?,?)").run(time,"2026-10-18T15:00:00.000Z",time);
    scheduleBotAutomations(db,config);
    vi.setSystemTime(new Date(Date.parse(time)+3600_000));scheduleBotAutomations(db,config);
    vi.setSystemTime(new Date(Date.now()+3600_000));scheduleBotAutomations(db,config);
    expect(db.prepare("SELECT COUNT(*) AS n FROM bot_automation_events WHERE event='SUPER_EXPIRING'").get()).toEqual({n:1});
    const transport=fake();dispatchBotAutomations(db,config,new Date(),transport);
    expect(transport.dm.mock.calls.some(c=>c[3].startsWith("Olá Ana"))).toBe(true);
  });
  it("Root é excluído de rankings e sequência mesmo com fatos de XP antigos",()=>{
    enabledGamification();
    db.prepare("INSERT INTO owner_access(id,user_id,phone,normalized_name,role,created_at,updated_at) VALUES('root-fixture','ana','5571999990001','ana','ROOT_OWNER',?,?)").run(time,time);
    db.prepare("INSERT INTO integration_settings(key,value,updated_at) VALUES('bot.feature.BROADCAST','1',?)").run(time);
    saveAutomationSettings(db,"WEEKLY_XP_RANK",{intervalMinutes:15});
    scheduleBotAutomations(db,config);
    vi.setSystemTime(new Date(Date.parse(time)+3600_000));xp("root-xp",new Date().toISOString(),"ana",1000);
    scheduleBotAutomations(db,config);
    expect(db.prepare("SELECT event FROM bot_automation_events WHERE event IN ('WEEKLY_XP_RANK','STREAK_MILESTONE')").all()).toEqual([]);
  });
  it("mês anuncia somente prêmio fechado posterior à inicialização, sem repetir",()=>{
    enabledGamification();
    db.prepare("INSERT INTO integration_settings(key,value,updated_at) VALUES('bot.feature.BROADCAST','1',?)").run(time);
    // The catalog default is monthly, but a newly settled monthly prize is
    // observed in the next five-minute scan rather than delayed 30 days.
    scheduleBotAutomations(db,config);
    vi.setSystemTime(new Date(Date.parse(time)+3600_000));
    db.prepare("INSERT INTO gamification_months(month,snapshot_json,settled_at) VALUES('2026-09','{}',?)").run(new Date().toISOString());
    db.prepare("INSERT INTO gamification_month_prizes(month,user_id,place,xp,coins,event_id) VALUES('2026-09','ana',1,200,15,'settled-fixture')").run();
    scheduleBotAutomations(db,config);
    vi.setSystemTime(new Date(Date.now()+3600_000));scheduleBotAutomations(db,config);
    expect(db.prepare("SELECT COUNT(*) AS n FROM bot_automation_events WHERE event='MONTHLY_TOP'").get()).toEqual({n:1});
  });

});
