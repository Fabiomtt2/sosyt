import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "./db.js";
import { loadConfig, type Config } from "./config.js";
import { effectiveYouTubeConfig, readYouTubeIntegration, saveYouTubeIntegration } from "./integrations.js";
import { googleAuthorizationUrl } from "./youtube.js";
import { buildApp } from "./app.js";

describe("OAuth administrável sem expor o segredo",()=>{
  let db:AppDatabase, config:Config;
  beforeEach(()=>{
    db=createDatabase(":memory:");
    config=loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",AUTH_DEV_MODE:"true",REQUIRE_GROUP_MEMBERSHIP:"false",WHATSAPP_MODE:"DISABLED",
      JWT_SECRET:"synthetic-oauth-settings-secret-32",AUTH_CODE_PEPPER:"synthetic-pepper",
      GOOGLE_CLIENT_ID:"env.apps.googleusercontent.com",GOOGLE_CLIENT_SECRET:"synthetic-env-secret",
      OWNER_FABIO_ID:"fabio",OWNER_FABIO_NAME:"Fabio",OWNER_FABIO_WHATSAPP:"5571999990001",OWNER_FABIO_SECRET:"synthetic-owner-secret-32"});
  });
  afterEach(()=>db.close());
  const pair={clientId:"panel.apps.googleusercontent.com",clientSecret:"synthetic-panel-secret"};
  it("salva par cifrado, não devolve segredo e atualiza novas autorizações sem reiniciar",()=>{
    const saved=saveYouTubeIntegration(db,config,pair);
    expect(saved).toMatchObject({oauthConfigured:true,oauthSource:"PANEL",clientId:pair.clientId});
    expect(JSON.stringify(saved)).not.toContain(pair.clientSecret);
    expect(JSON.stringify(db.prepare("SELECT * FROM integration_settings").all())).not.toContain(pair.clientSecret);
    expect(effectiveYouTubeConfig(db,config).GOOGLE_CLIENT_SECRET).toBe(pair.clientSecret);
    expect(new URL(googleAuthorizationUrl(effectiveYouTubeConfig(db,config),"synthetic-state")).searchParams.get("client_id")).toBe(pair.clientId);
  });
  it("recusa par incompleto e preserva configuração anterior",()=>{
    saveYouTubeIntegration(db,config,pair);
    expect(()=>saveYouTubeIntegration(db,config,{clientId:"other.apps.googleusercontent.com"})).toThrow(/juntos/);
    expect(()=>saveYouTubeIntegration(db,config,{clientSecret:"new-secret"})).toThrow(/juntos/);
    expect(effectiveYouTubeConfig(db,config).GOOGLE_CLIENT_SECRET).toBe(pair.clientSecret);
  });
  it("retorna ao par do ambiente sem alterar a chave de validação de vídeos",()=>{
    saveYouTubeIntegration(db,config,{...pair,apiKey:"synthetic-youtube-api-key-for-test"});
    saveYouTubeIntegration(db,config,{clearOAuth:true});
    expect(readYouTubeIntegration(db,config)).toMatchObject({source:"PANEL",oauthSource:"ENVIRONMENT",oauthConfigured:true});
    expect(effectiveYouTubeConfig(db,config).GOOGLE_CLIENT_ID).toBe(config.GOOGLE_CLIENT_ID);
  });
  it("rota exige autenticação Root e nunca devolve Client Secret",async()=>{
    const app=await buildApp(config,db);
    try {
      expect((await app.inject({method:"POST",url:"/admin/integrations/youtube",payload:pair})).statusCode).toBe(401);
      const login=await app.inject({method:"POST",url:"/admin/login",payload:{name:"Fabio",identifier:"5571999990001",secret:"synthetic-owner-secret-32",groupCode:"#"}});
      expect(login.statusCode,login.body).toBe(200);
      const headers={authorization:"Bearer "+login.json().token};
      const saved=await app.inject({method:"POST",url:"/admin/integrations/youtube",headers,payload:pair});
      expect(saved.statusCode,saved.body).toBe(200);
      expect(saved.body).not.toContain(pair.clientSecret);
      expect((await app.inject({url:"/admin/integrations/youtube",headers})).json().oauthConfigured).toBe(true);
    } finally {await app.close();}
  });
});
