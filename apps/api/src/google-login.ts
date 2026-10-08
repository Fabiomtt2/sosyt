import { createHash, randomBytes, randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "./config.js";
import type { AppDatabase } from "./db.js";
import { normalizePhone } from "./phone.js";
import { hasMembership, resolveGroupForPhone } from "./owner.js";
import { materializeApprovedMembership } from "./group-verification.js";
import { effectiveWhatsAppConfig } from "./integrations.js";
import { whatsappConfigured } from "./whatsapp.js";
import { queueOwnerAlerts } from "./whatsapp.js";

const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
const secret=()=>randomBytes(32).toString("hex");
type State={phone:string;name:string;nonce:string;verifier:string;browser_hash:string};
type Claim={id:string;phone:string;name:string;google_sub:string;email:string;status:string};
export function registerGoogleLogin(app:FastifyInstance,db:AppDatabase,config:Config,
  rootGuard:(request:FastifyRequest,reply:FastifyReply)=>Promise<unknown>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS google_login_states (
      state_hash TEXT PRIMARY KEY,phone TEXT NOT NULL,name TEXT NOT NULL,nonce TEXT NOT NULL,
      verifier TEXT NOT NULL,browser_hash TEXT NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS google_identity_claims (
      id TEXT PRIMARY KEY,phone TEXT NOT NULL,name TEXT NOT NULL,google_sub TEXT NOT NULL,email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',created_at TEXT NOT NULL,decided_at TEXT,decided_by TEXT,
      UNIQUE(phone,google_sub));
    CREATE TABLE IF NOT EXISTS google_identities (
      google_sub TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE REFERENCES users(id),email TEXT NOT NULL,linked_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS google_login_results (
      ticket_hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,google_sub TEXT NOT NULL,phone TEXT NOT NULL,
      claim_id TEXT,expires_at INTEGER NOT NULL);
  `);
  const redirectUri=new URL("/auth/google/callback",config.API_PUBLIC_URL).href;
  const client=new OAuth2Client(config.GOOGLE_CLIENT_ID,config.GOOGLE_CLIENT_SECRET,redirectUri);
  const claimToken=(id:string)=>app.jwt.sign({sub:id,purpose:"google-claim",aud:"conexao-google-claim"},{expiresIn:"30d"});
  const configured=()=>Boolean(config.GOOGLE_CLIENT_ID&&config.GOOGLE_CLIENT_SECRET);
  const publicResult=(claim:Claim)=>({status:claim.status,requestToken:claimToken(claim.id),name:claim.name,
    message:claim.status==="APPROVED" ? "Sua identidade Google foi aprovada. Entre novamente para continuar."
      :claim.status==="DECLINED" ? "A associação não foi aprovada. Fale com um Owner para conferir seus dados."
      :"Sua identidade Google foi confirmada. Um Owner vai conferir a associação com seu WhatsApp e grupo."});
  app.get("/auth/options",async()=>{
    const whatsapp=effectiveWhatsAppConfig(db,config);
    return {googleRequired:false,proofRequired:!config.AUTH_DEV_MODE,googleConfigured:configured(),whatsappConfigured:Boolean(whatsappConfigured(whatsapp)&&whatsapp.WHATSAPP_OTP_TEMPLATE)};
  });
  app.post("/auth/google/start",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request,reply)=>{
    const body=z.object({name:z.string().trim().min(2).max(80),phone:z.string().transform(normalizePhone).pipe(z.string().regex(/^[1-9]\d{7,14}$/)),
      browserVerifier:z.string().regex(/^[a-f0-9]{64}$/)}).parse(request.body);
    if(!configured())return reply.code(503).send({message:"O acesso Google está aguardando configuração pelos Owners. Use o código WhatsApp, se disponível, ou fale com um Owner."});
    const state=secret(),nonce=secret(),verifier=secret();
    db.prepare("DELETE FROM google_login_states WHERE expires_at<?").run(Date.now());
    db.prepare("INSERT INTO google_login_states VALUES (?,?,?,?,?,?,?)").run(hash(state),body.phone,body.name,nonce,verifier,hash(body.browserVerifier),Date.now()+600_000);
    const url=new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search=new URLSearchParams({client_id:config.GOOGLE_CLIENT_ID!,redirect_uri:redirectUri,response_type:"code",
      scope:"openid email",state,nonce,code_challenge:createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method:"S256",prompt:"select_account"}).toString();
    return {url:url.href};
  });
  app.get("/auth/google/callback",async(request,reply)=>{
    const q=z.object({state:z.string().max(256),code:z.string().max(4096).optional(),error:z.string().max(100).optional()}).parse(request.query);
    const state=db.prepare("SELECT * FROM google_login_states WHERE state_hash=? AND expires_at>?").get(hash(q.state),Date.now()) as State|undefined;
    if(!state)return reply.code(400).send({message:"Esta tentativa de acesso expirou ou já foi utilizada. Volte ao SOS e tente novamente."});
    db.prepare("DELETE FROM google_login_states WHERE state_hash=?").run(hash(q.state));
    const back=new URL(config.WEB_APP_URL);
    if(q.error||!q.code){back.hash="google_error=cancelled";return reply.redirect(back.href);}
    try{
      const {tokens}=await client.getToken({code:q.code,codeVerifier:state.verifier,redirect_uri:redirectUri});
      if(!tokens.id_token)throw new Error("Missing identity");
      const ticket=await client.verifyIdToken({idToken:tokens.id_token,audience:config.GOOGLE_CLIENT_ID});
      const identity=ticket.getPayload() as {sub?:string;email?:string;email_verified?:boolean;nonce?:string}|undefined;
      if(!identity?.sub||!identity.email||!identity.email_verified||identity.nonce!==state.nonce)throw new Error("Invalid identity");
      const linked=db.prepare("SELECT u.id FROM google_identities g JOIN users u ON u.id=g.user_id WHERE g.google_sub=? AND u.phone=? AND u.deleted_at IS NULL").get(identity.sub,state.phone);
      let claimId:string|null=null;
      if(!linked){
        const existing=db.prepare("SELECT * FROM google_identity_claims WHERE phone=? AND google_sub=?").get(state.phone,identity.sub) as Claim|undefined;
        claimId=existing?.id??randomUUID();
        db.prepare("INSERT OR IGNORE INTO google_identity_claims (id,phone,name,google_sub,email,created_at) VALUES (?,?,?,?,?,?)")
          .run(claimId,state.phone,state.name,identity.sub,identity.email,new Date().toISOString());
        if(!existing)queueOwnerAlerts(db,config,claimId,state.phone,state.name,"google:"+claimId);
      }
      const code=secret();
      db.prepare("DELETE FROM google_login_results WHERE expires_at<?").run(Date.now());
      db.prepare("INSERT INTO google_login_results VALUES (?,?,?,?,?,?)").run(hash(code),state.browser_hash,identity.sub,state.phone,claimId,Date.now()+120_000);
      back.hash="google_login="+code;
    }catch{back.hash="google_error=failed";}
    return reply.redirect(back.href);
  });
  app.post("/auth/google/complete",{config:{rateLimit:{max:20,timeWindow:"10 minutes"}}},async(request,reply)=>{
    const body=z.object({ticket:z.string().regex(/^[a-f0-9]{64}$/),browserVerifier:z.string().regex(/^[a-f0-9]{64}$/)}).parse(request.body);
    const row=db.prepare("SELECT * FROM google_login_results WHERE ticket_hash=? AND expires_at>? AND browser_hash=?")
      .get(hash(body.ticket),Date.now(),hash(body.browserVerifier)) as {google_sub:string;phone:string;claim_id?:string}|undefined;
    if(!row)return reply.code(401).send({message:"Retorno Google inválido ou aberto em outro navegador. Reinicie o acesso."});
    db.prepare("DELETE FROM google_login_results WHERE ticket_hash=?").run(hash(body.ticket));
    if(row.claim_id){
      const claim=db.prepare("SELECT * FROM google_identity_claims WHERE id=?").get(row.claim_id) as Claim;
      return {claim:publicResult(claim)};
    }
    const user=db.prepare("SELECT u.id,u.group_code AS groupCode,u.cooldown_until AS cooldownUntil FROM users u JOIN google_identities g ON g.user_id=u.id WHERE g.google_sub=? AND u.phone=? AND u.deleted_at IS NULL")
      .get(row.google_sub,row.phone) as {id:string;groupCode:string;cooldownUntil?:string}|undefined;
    if(!user||!hasMembership(db,row.phone,user.groupCode))return reply.code(403).send({message:"Sua identidade foi confirmada, mas o acesso ao grupo precisa da aprovação do Owner."});
    if(user.cooldownUntil&&Date.parse(user.cooldownUntil)>Date.now())return reply.code(423).send({code:"COOLDOWN_ACTIVE",cooldownUntil:user.cooldownUntil,message:"Seu intervalo após concluir a fila ainda está em andamento."});
    return {token:app.jwt.sign({sub:user.id,purpose:"session",aud:"conexao-session",authMethod:"google",authPhone:row.phone,googleSubject:row.google_sub})};
  });
  app.post("/auth/google/status",{config:{rateLimit:{max:60,timeWindow:"10 minutes"}}},async(request,reply)=>{
    const {token}=z.object({token:z.string().max(4096)}).parse(request.body);
    try{
      const payload=app.jwt.verify<{sub:string;purpose:string;aud:string}>(token);
      if(payload.purpose!=="google-claim"||payload.aud!=="conexao-google-claim")throw new Error("Wrong purpose");
      const claim=db.prepare("SELECT * FROM google_identity_claims WHERE id=?").get(payload.sub) as Claim|undefined;
      if(!claim)throw new Error("Missing claim");
      return publicResult(claim);
    }catch{return reply.code(401).send({message:"O acompanhamento expirou. Entre com Google novamente."});}
  });
  app.get("/admin/google-identities",{preHandler:rootGuard},async()=>({
    claims:db.prepare(`SELECT c.id,c.name,c.phone,c.email,c.status,c.created_at AS createdAt,
      m.group_code AS groupCode FROM google_identity_claims c LEFT JOIN group_memberships m ON m.phone=c.phone AND m.revoked_at IS NULL
      WHERE c.status='PENDING' ORDER BY c.created_at LIMIT 100`).all()
  }));
  app.post("/admin/google-identities/:id/decision",{preHandler:rootGuard},async(request,reply)=>{
    const id=z.string().uuid().parse((request.params as {id:string}).id);
    const body=z.object({approve:z.boolean(),groupCode:z.string().regex(/^[1-9]\d{0,2}$/).optional()}).parse(request.body);
    const claim=db.prepare("SELECT * FROM google_identity_claims WHERE id=? AND status='PENDING'").get(id) as Claim|undefined;
    if(!claim)return reply.code(409).send({message:"Esta associação já foi analisada."});
    const stamp=new Date().toISOString(),actor=request.user.sub;
    if(!body.approve){db.prepare("UPDATE google_identity_claims SET status='DECLINED',decided_at=?,decided_by=? WHERE id=?").run(stamp,actor,id);return {ok:true};}
    const group=body.groupCode??resolveGroupForPhone(db,claim.phone).groupCode;
    if(!group)return reply.code(400).send({message:"Informe o grupo conferido para este participante."});
    const conflicting=db.prepare(`SELECT 1 FROM google_identities g JOIN users u ON u.id=g.user_id
      WHERE (g.google_sub=? AND u.phone<>?) OR (u.phone=? AND g.google_sub<>?)`).get(claim.google_sub,claim.phone,claim.phone,claim.google_sub);
    if(conflicting)return reply.code(409).send({message:"Já existe outra identidade vinculada. Esta operação não substitui vínculos existentes."});
    const result=db.transaction(()=>{
      db.prepare("INSERT OR IGNORE INTO groups(code) VALUES (?)").run(group);
      db.prepare("UPDATE participation_requests SET status='APPROVED',preferred_group=?,approved_at=?,approved_by_owner_id=?,approved_by_owner_name=?,updated_at=? WHERE phone=?")
        .run(group,stamp,actor,request.user.displayName??"Owner",stamp,claim.phone);
      const membership=materializeApprovedMembership(db,claim.phone,group,stamp,{id:actor,name:request.user.displayName??"Owner"});
      if(!membership.accessGranted)return false;
      let user=db.prepare("SELECT id FROM users WHERE phone=? AND deleted_at IS NULL").get(claim.phone) as {id:string}|undefined;
      if(!user){
        user={id:randomUUID()};
        db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(user.id,claim.name,claim.phone,group,stamp,stamp);
        db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES(?,?)").run(user.id,stamp);
        db.prepare("INSERT INTO wallet_ledger(id,user_id,kind,amount_millis,created_at) VALUES(?,?,'WELCOME',10000,?)").run(randomUUID(),user.id,stamp);
      }
      db.prepare("UPDATE users SET group_code=?,updated_at=? WHERE id=?").run(group,stamp,user.id);
      db.prepare("INSERT OR IGNORE INTO google_identities VALUES(?,?,?,?)").run(claim.google_sub,user.id,claim.email,stamp);
      db.prepare("UPDATE google_identity_claims SET status='APPROVED',decided_at=?,decided_by=? WHERE id=?").run(stamp,actor,id);
      return true;
    })();
    return result?{ok:true}:reply.code(409).send({message:"Aguardando a prova externa de presença no grupo. A identidade ainda não foi liberada."});
  });
}
