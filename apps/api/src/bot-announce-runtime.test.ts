import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createDatabase,type AppDatabase} from "./db.js";
import {loadConfig,type Config} from "./config.js";
import {announceToGroups} from "./bot-announce.js";
import {saveAutomationSettings} from "./bot-automation-store.js";

describe("announcements respect live switches and persist fanout",()=>{
  let db:AppDatabase,config:Config;
  const now=new Date("2026-10-18T15:00:00.000Z");
  beforeEach(()=>{
    db=createDatabase(":memory:");
    vi.useFakeTimers();vi.setSystemTime(now);vi.spyOn(Math,"random").mockReturnValue(0.5);
    config=loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",JWT_SECRET:"ann-runtime-jwt-32-characters-long",AUTH_CODE_PEPPER:"ann-runtime-pepper-32-characters",
      EVOLUTION_URL:"https://evo.example.test",EVOLUTION_INSTANCE:"sos-primary",EVOLUTION_API_KEY:"ann-evolution-key-32-characters",
      EVOLUTION_PHONE:"5571993951582",EVOLUTION_WEBHOOK_SECRET:"ann-webhook-secret-32-characters"});
    db.prepare("INSERT OR REPLACE INTO groups(code,enabled,whatsapp_group_id) VALUES('1',1,'12345678901@g.us')").run();
    db.prepare("INSERT INTO groups(code,enabled,whatsapp_group_id) VALUES('2',1,'12345678902@g.us')").run();
  });
  afterEach(()=>{db.close();vi.restoreAllMocks();vi.useRealTimers();});
  it("queue master blocks an enabled announcement before any outbox work",()=>{
    db.prepare("INSERT INTO integration_settings(key,value,updated_at) VALUES('bot.feature.QUEUE_ANNOUNCE','0',?)").run(now.toISOString());
    expect(announceToGroups(db,config,"QUEUE_OPEN",{fila:1,link:"https://sos.app"},{dedupeKey:"round:1",now}))
      .toEqual({queued:0,skipped:"feature-disabled"});
    expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get()).toEqual({n:0});
  });
  it("all-groups keeps future send dates durable, deduped and inside expiration",()=>{
    const input={fila:1,link:"https://sos.app"},opts={dedupeKey:"round:1",now};
    expect(announceToGroups(db,config,"QUEUE_OPEN",input,opts).queued).toBe(2);
    announceToGroups(db,config,"QUEUE_OPEN",input,opts);
    const rows=db.prepare("SELECT available_at AS at,expires_at AS expiry FROM whatsapp_outbox ORDER BY available_at").all() as Array<{at:string;expiry:string}>;
    expect(rows).toHaveLength(2);
    expect(Date.parse(rows[1].at)).toBeGreaterThan(Date.parse(rows[0].at));
    expect(rows.every(row=>Date.parse(row.at)>=now.getTime() && Date.parse(row.at)<Date.parse(row.expiry))).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox WHERE status='SENT'").get()).toEqual({n:0});
  });
  it("Owner target and customized text keep priority over fanout",()=>{
    saveAutomationSettings(db,"QUEUE_OPEN",{target:"GROUP",text:"Fila {fila}: {link}"});
    expect(announceToGroups(db,config,"QUEUE_OPEN",{fila:9,link:"https://sos.app"},{dedupeKey:"round:9",ctx:{groupCode:"2"},now}).queued).toBe(1);
    const row=db.prepare("SELECT recipient,payload FROM whatsapp_outbox").get() as {recipient:string;payload:string};
    expect(row.recipient).toBe("12345678902@g.us");
    expect(JSON.parse(row.payload).text.body).toBe("Fila 9: https://sos.app");
  });
});
