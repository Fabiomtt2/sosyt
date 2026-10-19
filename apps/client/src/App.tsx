import { ActionErrorDialog } from "./ActionErrorDialog";
import { LaunchFlash } from "./LaunchFlash";
import { GamificationPanel, LevelBadge } from "./GamificationPanel";
import { JourneyModal } from "./JourneyModal";
import { useCallback, useEffect, useState, useRef, type FormEvent } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { ArrowLeft, Check, Clock3, ExternalLink, HelpCircle, Link2, LoaderCircle, LockKeyhole, Menu, MessagesSquare, Plus, RefreshCw, ShieldCheck, Youtube } from "lucide-react";
import { ProjectWhatsAppContact } from "./ProjectWhatsAppContact";
import { GoogleAccess } from "./GoogleAccess";
import { OwnerDashboard } from "./OwnerDashboard";
import { WatchProgress, readSavedWatchPercent } from "./WatchProgress";
import { AvatarModal, UserAvatarView } from "./AvatarModal";
import {usePurchaseFeedback} from "./usePurchaseFeedback";
import {PurchaseCelebration} from "./PurchaseCelebration";
import { PurchaseModal } from "./PurchaseModal";
import { StoreModal } from "./StoreModal";
import { CommunityLauncher } from "./CommunityLauncher";
import { CommunityModal } from "./CommunityModal";
import { WelcomeLoading } from "./WelcomeLoading";
import { GlobalChat } from "./GlobalChat";
import { QueueSwitcher } from "./QueueSwitcher";
import { SuperPanel } from "./SuperPanel";
import { UserWelcomeCarousel } from "./UserWelcomeCarousel";
import { useModalLifecycle } from "./useModalLifecycle";
import { UserWallet } from "./UserWallet";
import { UserAccountMenu } from "./UserAccountMenu";
import { ParticipantAdminModal } from "./ParticipantAdminModal";
import { api, ownerApi, participationApi, ApiError, type Dashboard, type OwnerOverview, type ParticipationStatus, type PaymentProductCode, type Round } from "./api";
import { PhoneField, isCompletePhoneField } from "./PhoneField";

const COOLDOWN_KEY = "conexao_cooldown_until";
const PENDING_REQUEST_KEY = "conexao_participation_request";
const PENDING_REQUEST_SUPPRESS_KEY = "conexao_participation_request_suppressed";

type PendingRequestMemory = { token: string; phone?: string };

function readPendingRequestMemory(): PendingRequestMemory | undefined {
  const raw = localStorage.getItem(PENDING_REQUEST_KEY);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as PendingRequestMemory;
    if (parsed?.token) return parsed;
  } catch {
    // Legacy versions stored only the opaque token string.
  }
  return { token: raw };
}

function writePendingRequestMemory(state: ParticipationStatus) {
  localStorage.setItem(PENDING_REQUEST_KEY, JSON.stringify({ token: state.requestToken, phone: state.phone }));
}

function countdownLabel(milliseconds: number) {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}`;
}

function Login({ onDone }: { onDone: (role: "user" | "owner") => void }) {
  const [step, setStep] = useState<"profile" | "credential" | "phone-code">("profile");
  const [authRole, setAuthRole] = useState<"user" | "owner">();
  const [joinMode, setJoinMode] = useState(false);
  const [credential, setCredential] = useState("");
  const [passwordMode,setPasswordMode]=useState(true);
  const [authOptions,setAuthOptions]=useState<Awaited<ReturnType<typeof api.authOptions>>>();
  const authOptionsPromise=useRef<ReturnType<typeof api.authOptions>|undefined>(undefined);
  const [botRegistrationUrl,setBotRegistrationUrl]=useState("");
  const [phoneCode,setPhoneCode]=useState("");
  const [keyExpiresAt,setKeyExpiresAt]=useState(0);
  const [resendAt,setResendAt]=useState(0);
  const [consent, setConsent] = useState(false);
  const [joined, setJoined] = useState<ParticipationStatus>();
  const [form, setForm] = useState({ name: "", phone: "" });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now());
  const suppressPendingResume = useRef(false);

  const loadAuthOptions=useCallback(()=>{
    authOptionsPromise.current??=api.authOptions().then(options=>{setAuthOptions(options);return options;}).catch(cause=>{authOptionsPromise.current=undefined;throw cause;});
    return authOptionsPromise.current;
  },[]);
  useEffect(()=>{void loadAuthOptions().catch(()=>{});},[loadAuthOptions]);

  useEffect(() => {
    if (!cooldownUntil && !keyExpiresAt) return;
    const tick = () => {
      const current = Date.now();
      setNowMs(current);
      if (cooldownUntil && current >= cooldownUntil) {
        localStorage.removeItem(COOLDOWN_KEY);
        setCooldownUntil(0);
      }
    };
    tick();
    const timer = window.setInterval(tick,1000);
    return () => window.clearInterval(timer);
  },[cooldownUntil,keyExpiresAt]);

  useEffect(() => {
    if (sessionStorage.getItem(PENDING_REQUEST_SUPPRESS_KEY) === "1") {
      suppressPendingResume.current = true;
      return;
    }
    const memory = readPendingRequestMemory();
    if (!memory?.token) return;
    let cancelled = false;
    const sync = async () => {
      try {
        const state = await participationApi.status(memory.token);
        if (cancelled) return;
        writePendingRequestMemory(state);
        if (suppressPendingResume.current) return;
        setJoined(state);
        setJoinMode(true);
        setForm((current) => ({
          name: state.name ?? current.name,
          phone: state.phone ? `+${state.phone.replace(/\D/g,"")}` : current.phone
        }));
      } catch (cause) {
        if (!cancelled && cause instanceof ApiError && [401,404].includes(cause.status)) {
          localStorage.removeItem(PENDING_REQUEST_KEY);
          setJoined(undefined);
        }
      }
    };
    void sync();
    const timer = window.setInterval(() => void sync(),20_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  },[]);

  useEffect(() => {
    if (!joined?.blockedUntil) return;
    const until = Date.parse(joined.blockedUntil);
    if (!Number.isFinite(until) || until <= Date.now()) return;
    const timer = window.setInterval(() => setNowMs(Date.now()),1000);
    return () => window.clearInterval(timer);
  },[joined?.blockedUntil]);

  function activateCooldown(value: unknown) {
    if (typeof value !== "string") return false;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || parsed <= Date.now()) return false;
    localStorage.setItem(COOLDOWN_KEY,value);
    setCooldownUntil(parsed);
    setNowMs(Date.now());
    return true;
  }

  function keepParticipation(state: ParticipationStatus) {
    suppressPendingResume.current = false;
    sessionStorage.removeItem(PENDING_REQUEST_SUPPRESS_KEY);
    writePendingRequestMemory(state);
    setJoined(state);
    setJoinMode(true);
    setNowMs(Date.now());
  }

  function adoptParticipationError(cause: unknown) {
    if (!(cause instanceof ApiError)) return false;
    const requestToken = typeof cause.data.requestToken === "string" ? cause.data.requestToken : "";
    const status = cause.data.status;
    if (!requestToken || (status !== "PENDING" && status !== "DECLINED" && status !== "APPROVED")) return false;
    keepParticipation({
      status,
      requestToken,
      message: cause.message,
      blockedUntil: typeof cause.data.blockedUntil === "string" ? cause.data.blockedUntil : undefined
    });
    return true;
  }

  async function refreshParticipation() {
    const token = joined?.requestToken ?? readPendingRequestMemory()?.token;
    if (!token) return;
    setBusy(true); setError("");
    try { keepParticipation(await participationApi.status(token)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível verificar a solicitação agora."); }
    finally { setBusy(false); }
  }

  function leaveParticipationStatus() {
    localStorage.removeItem(PENDING_REQUEST_KEY);
    sessionStorage.removeItem(PENDING_REQUEST_SUPPRESS_KEY);
    suppressPendingResume.current = true;
    setJoined(undefined);
    setJoinMode(false);
    setConsent(false);
    returnToProfile();
  }

  function accessWithAnotherIdentity() {
    suppressPendingResume.current = true;
    sessionStorage.setItem(PENDING_REQUEST_SUPPRESS_KEY,"1");
    setJoined(undefined);
    setJoinMode(false);
    setConsent(false);
    localStorage.removeItem(COOLDOWN_KEY);
    setCooldownUntil(0);
    setNowMs(Date.now());
    setForm({ name: "", phone: "" });
    returnToProfile();
  }

  function returnToProfile() {
    setBotRegistrationUrl("");setPasswordMode(true);setStep("profile"); setAuthRole(undefined); setCredential(""); setPhoneCode(""); setKeyExpiresAt(0); setError("");
  }

  async function sendPhoneKey(registration:boolean) {
    const result=await api.requestCode({name:form.name.trim(),phone:form.phone,...(registration?{registration:true,consent:true as const}:{})});
    setStep("phone-code");setPhoneCode("");
    setKeyExpiresAt(Date.now()+result.expiresInSeconds*1000);setResendAt(Date.now()+60_000);
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const name = form.name.trim();
      if (name.length < 2) throw new Error("Informe seu nome ou como prefere ser chamado.");
      if (!isCompletePhoneField(form.phone)) throw new Error("Informe um WhatsApp válido escolhendo o país, o DDD quando necessário e o número.");

      if (step==="phone-code") {
        if(!/^\d{6}$/.test(phoneCode))throw new Error("Digite os seis números da chave enviada ao seu WhatsApp.");
        const result=await api.verifyCode({phone:form.phone,code:phoneCode});
        if(result.token){
          localStorage.removeItem("conexao_owner_token");localStorage.setItem("conexao_token",result.token);onDone("user");
        }else if(result.participation){setStep("profile");setKeyExpiresAt(0);keepParticipation(result.participation);}
        return;
      }
      if (joinMode) {
        if (!consent) throw new Error("Autorize o uso do nome e número para enviar a solicitação.");
        const options=await loadAuthOptions();
        if(options.botRegistrationUrl){setBotRegistrationUrl(options.botRegistrationUrl);return;}
        if(options.proofRequired){await sendPhoneKey(true);return;}
        try {
          const result = await participationApi.join({ name, phone: form.phone, consent: true });
          keepParticipation(result);
        } catch (cause) {
          if (adoptParticipationError(cause)) return;
          throw cause;
        }
      } else if (step === "profile") {
        const role = await api.resolveRole({ name, phone: form.phone });
        setAuthRole(role.role);
        if(!passwordMode)setCredential("");
        if (role.role === "owner") {
          suppressPendingResume.current = true;
          sessionStorage.setItem(PENDING_REQUEST_SUPPRESS_KEY,"1");
          setJoined(undefined);
          setJoinMode(false);
          setCooldownUntil(0);
          localStorage.removeItem(COOLDOWN_KEY);
          setStep("credential");
        } else {
          try {
            if(passwordMode && credential.trim()){
              const result=await api.passwordLogin(form.phone,credential);
              localStorage.removeItem("conexao_owner_token");localStorage.setItem("conexao_token",result.token);
              localStorage.setItem("sos-password-change-required",result.mustChangePassword?"true":"false");
              localStorage.removeItem(PENDING_REQUEST_KEY);sessionStorage.setItem(PENDING_REQUEST_SUPPRESS_KEY,"1");
              onDone("user");return;
            }
            if((await loadAuthOptions()).proofRequired){
              if(passwordMode)throw new Error("Digite a senha enviada pelo bot. Se ainda não recebeu, fale com o bot no WhatsApp e escolha participar ou trocar senha.");
              await sendPhoneKey(false);return;
            }
            const result = await api.login({ name, phone: form.phone });
            localStorage.removeItem("conexao_owner_token");
            localStorage.setItem("conexao_token", result.token);
            onDone("user");
          } catch (cause) {
            if (cause instanceof ApiError && cause.status === 423 && activateCooldown(cause.data.cooldownUntil)) return;
            // A rejected password must never create an unrelated approval request.
            if ((passwordMode && credential.trim()) || !(cause instanceof ApiError) || cause.status !== 403) throw cause;
            try {
              const pending = await participationApi.join({ name, phone: form.phone, consent: true });
              keepParticipation(pending);
            } catch (registrationCause) {
              if (adoptParticipationError(registrationCause)) return;
              throw registrationCause;
            }
          }
        }
      } else if (authRole === "owner") {
        if (!credential.trim()) throw new Error("Digite sua credencial.");
        const result = await ownerApi.login({ name, identifier: form.phone, groupCode: "#", secret: credential });
        localStorage.removeItem("conexao_token");
        localStorage.setItem("conexao_owner_token", result.token);
        onDone("owner");
      }
    } catch (cause) {
      if (authRole === "owner" && step === "credential" && cause instanceof ApiError && cause.status === 401) {
        setError("Credencial incorreta. Confira e tente novamente.");
      } else {
        setError(cause instanceof Error ? cause.message : "Não foi possível concluir o acesso.");
      }
    } finally {
      setBusy(false);
    }
  }

  const ownerCredentialMode = authRole === "owner" && step === "credential";
  const cooldownActive = cooldownUntil > nowMs;
  const cooldownRemaining = Math.max(0,cooldownUntil-nowMs);
  const requestBlockedUntil = joined?.blockedUntil ? Date.parse(joined.blockedUntil) : 0;
  const requestBlockActive = Number.isFinite(requestBlockedUntil) && requestBlockedUntil > nowMs;
  const requestBlockRemaining = Math.max(0,requestBlockedUntil-nowMs);

  return <main className="login-shell access-shell-premium">
    <section className="brand-panel">
      <div className="brand-lockup">
        <div className="brand-mark"><Youtube size={34} fill="currentColor" /></div>
        <p className="eyebrow">SOS YOUTUBER</p>
      </div>
      <h1>Uma playlist.<br />{" "}Dez vozes.</h1>
      <p className="lead">Um espaço para compartilhar vídeos, conhecer criadores e montar playlists juntos.<span className="lead-choice">Sua comunidade começa aqui.</span></p>
      <div className="participation-cluster">
        <button className="primary intro-join" type="button" onClick={() => { suppressPendingResume.current=false; setJoinMode(true); returnToProfile(); }}>Quero participar</button>
        <div className="trust-note" aria-label="Compromissos de segurança">
          <div className="trust-copy"><span>Sem views automáticas.</span><span>Sem reprodução oculta.</span><strong>Você mantém o controle.</strong></div>
        </div>
      </div>
    </section>
    <section className="login-card">
      <div>
        <p className="eyebrow dark">BOM TER VOCÊ POR AQUI</p>
        <h2>{step==="phone-code" ? "Confira seu WhatsApp" : ownerCredentialMode ? "Credencial" : cooldownActive ? "Intervalo após concluir uma Fila" : joined?.status === "APPROVED" ? "Cadastro aprovado" : joined?.status === "DECLINED" ? "Solicitação analisada" : joined ? "Solicitação em análise" : step === "profile" ? joinMode ? "Participar do SOS YouTube" : "Entre na sua conexão" : "Credencial"}</h2>
        <p className={ownerCredentialMode || (!cooldownActive && !joined && step === "profile" && !joinMode) ? "muted login-helper" : "muted"}>{step==="phone-code" ? "Use a chave de seis números enviada ao seu WhatsApp. Ela vale por 5 minutos e só pode ser usada uma vez." : ownerCredentialMode ? "Digite sua credencial para acessar o painel administrativo." : cooldownActive ? "Este intervalo de 30 minutos começa somente após concluir uma tarefa de Fila. Ele não é causado por erro de login ou credencial." : joined?.status === "APPROVED" ? "Sua aprovação já foi registrada no servidor. Você decide quando voltar ao acesso normal." : joined?.status === "DECLINED" ? "Seu pedido foi analisado. O histórico continua preservado para evitar cadastros repetidos." : joined ? "Seu pedido continua salvo e pode ser acompanhado neste aparelho." : step === "profile" ? joinMode ? "Comece pelo seu nome e WhatsApp. Você poderá acompanhar seu cadastro por aqui." : "Entre com o WhatsApp e a senha enviados pelo bot. Sua entrada no grupo é acompanhada separadamente." : "Digite sua credencial para abrir o painel administrativo."}</p>
      </div>
      {!ownerCredentialMode && cooldownActive ? <div className="cooldown-card" role="status"><Clock3 size={34} /><span>Seu acesso de participante será liberado em</span><strong>{countdownLabel(cooldownRemaining)}</strong><p className="muted">Este intervalo de 30 minutos existe somente após concluir uma tarefa de Fila. Seu cadastro, saldo, URLs e progresso continuam salvos.</p><button className="secondary" type="button" onClick={accessWithAnotherIdentity}>Acessar outra conta</button></div> : !ownerCredentialMode && joined ? <div className={`join-success request-status-card request-${joined.status.toLowerCase()}`} role="status">
        <div className="join-success-heading"><strong>{joined.message}</strong></div>
        {joined.status === "PENDING" && <>
          <p><strong>{joined.name ?? form.name.trim()}</strong>, seu pedido está protegido e continua aguardando os Owners.</p>
          {requestBlockActive && <><div className="request-block-clock"><Clock3 size={18} /><span>Proteção contra cadastro repetido</span><strong>{countdownLabel(requestBlockRemaining)}</strong></div><p className="muted request-block-explanation">Este prazo de 120 minutos existe porque este WhatsApp já enviou uma solicitação. Ele evita duplicações e nunca é acionado por senha ou credencial incorreta.</p></>}
          <p className="muted">Pode fechar esta página. Para reencontrar este acompanhamento automaticamente neste aparelho, evite apagar os dados do site. Mesmo se os dados locais forem apagados, seu pedido não desaparece do servidor.</p>
          <div className="ready-actions"><button className="primary" type="button" onClick={leaveParticipationStatus}>Já recebi a senha — entrar na minha conta</button><button className="secondary" disabled={busy} onClick={() => void refreshParticipation()}>{busy ? <LoaderCircle className="spin" /> : <RefreshCw size={17} />}Verificar situação</button><button className="text-button" type="button" onClick={accessWithAnotherIdentity}>Acessar com outro número</button></div>
        </>}
        {joined.status === "APPROVED" && <>
          <p><strong>{joined.name ?? form.name.trim()}</strong>, seu acesso foi liberado{joined.approvedGroup ? ` no SOS YOUTUBER ${joined.approvedGroup}` : ""}.</p>
          <p className="muted">Seu cadastro, histórico e aprovação continuam salvos. Ao voltar, entre com o mesmo WhatsApp; o grupo será reconhecido automaticamente.</p>
          <button className="primary" onClick={leaveParticipationStatus}>Voltar ao acesso</button>
        </>}
        {joined.status === "DECLINED" && <>
          {requestBlockActive && <div className="request-block-clock"><Clock3 size={18} /><span>Proteção contra novo cadastro</span><strong>{countdownLabel(requestBlockRemaining)}</strong></div>}
          <p className="muted">Se houver algum dado incorreto, aguarde o prazo indicado e tente novamente ou fale com um Owner. Nenhum saldo ou histórico prévio é apagado.</p>
          {!requestBlockActive && <button className="secondary" onClick={leaveParticipationStatus}><ArrowLeft size={18} />Voltar ao acesso</button>}
        </>}
        {error && <p className="error" role="alert">{error}</p>}
      </div> : <form className="access-form" noValidate onSubmit={submit}>
        <div className="access-fields">
          {step==="phone-code" ? <>
            <p className="muted">Chave enviada para <strong>{form.phone}</strong>.</p>
            <label>Chave recebida no WhatsApp<input inputMode="numeric" autoComplete="one-time-code" value={phoneCode} maxLength={6} autoFocus onChange={(event)=>setPhoneCode(event.target.value.replace(/\D/g,""))} placeholder="6 números"/></label>
            <p role="status">{keyExpiresAt>nowMs ? `Sua chave expira em ${countdownLabel(keyExpiresAt-nowMs)}` : "A chave expirou. Peça uma nova para continuar."}</p>
            <button className="text-button" type="button" disabled={busy||resendAt>nowMs} onClick={()=>{setBusy(true);setError("");void sendPhoneKey(joinMode).catch((cause)=>setError(cause instanceof Error?cause.message:"Não foi possível reenviar a chave.")).finally(()=>setBusy(false));}}>Enviar nova chave{resendAt>nowMs?` em ${countdownLabel(resendAt-nowMs)}`:""}</button>
            <button type="button" className="text-button" onClick={returnToProfile}>Corrigir número</button>
          </> : step === "profile" ? <>
            <label>Seu nome ou como prefere ser chamado<input autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Como você será identificado" required /></label>
            <div className="field-block"><label htmlFor="whatsapp">WhatsApp</label><PhoneField id="whatsapp" value={form.phone} onChange={(phone)=>setForm({...form,phone})} required /></div>
            <div className="group-auto-note"><ShieldCheck size={17}/><div><strong>Seu grupo será identificado pelo WhatsApp</strong><span>A senha recebida do bot permite entrar na sua conta. A entrada no grupo é acompanhada separadamente, sem precisar digitar o grupo.</span></div></div>
            {!joinMode&&passwordMode&&<label>Senha recebida ou criada por você<input type="password" autoComplete="current-password" value={credential} onChange={e=>setCredential(e.target.value)} placeholder="Digite sua senha"/></label>}
            {joinMode && <label className="consent-row"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required /><span>Autorizo o SOS YouTube a usar meu nome e número para analisar esta solicitação e entrar em contato sobre o grupo.</span></label>}
          </> : <>
            <label>Credencial<input type="password" autoComplete="current-password" value={credential} onChange={(e) => setCredential(e.target.value)} placeholder="Digite sua credencial" /></label>
            <button type="button" className="text-button back-link" onClick={returnToProfile}><ArrowLeft size={16} />Voltar para tela de login</button>
          </>}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
        <div className="access-actions">
          <button className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : step==="phone-code" ? "Confirmar chave e continuar" : joinMode ? "Enviar dados e continuar" : step === "profile" ? "Continuar" : "Entrar"}</button>
        </div>
      </form>}
      {botRegistrationUrl&&joinMode&&<section className="notice" style={{display:"block"}} role="status" aria-label="Cadastro com o bot"><strong>Continue seu cadastro com o bot</strong><p>O bot vai confirmar como você quer ser chamado e enviar sua senha nesta conversa.</p><a className="primary" href={botRegistrationUrl} target="_blank" rel="noreferrer">Abrir conversa para cadastro no WhatsApp</a><p className="muted">O link abre a conversa. Toque em enviar no WhatsApp para iniciar; nenhuma mensagem é enviada automaticamente.</p></section>}
      {!joinMode&&!joined&&step==="profile"&&!cooldownActive&&authOptions?.whatsappMode!=="EVOLUTION"&&<button type="button" className="text-button" onClick={()=>{setPasswordMode(value=>!value);setCredential("");setError("");}}>{passwordMode?"Prefiro a chave no WhatsApp":"Entrar com senha"}</button>}
      {joinMode&&<ProjectWhatsAppContact/>}
      {step==="profile" && !cooldownActive && <GoogleAccess name={form.name} phone={form.phone} loadOptions={loadAuthOptions} onDone={()=>onDone("user")}/>}
      {!cooldownActive && step === "profile" && !joined && joinMode && <button className="text-button" type="button" onClick={() => { setJoinMode(false); setError(""); }}>Já participo — voltar ao login</button>}
    </section>

  </main>;
}

function SlotCard({ slot, next, eligible, draft, onDraft, onSubmit, busy, own,onInspectParticipant,viewerChannel,onConnectChannel }: {
  slot: Round["slots"][number]; next: boolean; eligible: boolean; draft?: string; onDraft?: (value: string) => void; onSubmit?: (event: FormEvent) => void;
  busy?: boolean; own?: boolean;onInspectParticipant?:(phone:string)=>void;
  viewerChannel?:{title:string;thumbnailUrl?:string};onConnectChannel?:()=>void;
}) {
  if (slot.youtubeUrl) return <article className="slot filled rich-slot">
    <div className="slot-number">{String(slot.slot).padStart(2, "0")}</div>
    <div className="slot-rich-body">
      <div className="slot-contributor">
        {slot.participantPhone&&onInspectParticipant
          ? <button type="button" className="slot-avatar-admin-button" aria-label={`Administrar ${slot.userName ?? "participante"}`} onClick={()=>onInspectParticipant(slot.participantPhone!)}><span className={slot.adminRole?"slot-avatar-shell has-admin-badge":"slot-avatar-shell"}><UserAvatarView avatar={slot.avatar} presentation={slot.presentation} name={slot.userName ?? "Participante"} className="slot-avatar"/>{slot.adminRole&&<b className="admin-badge">ADMIN</b>}</span></button>
          : <span className={slot.adminRole?"slot-avatar-shell has-admin-badge":"slot-avatar-shell"}><UserAvatarView avatar={slot.avatar} presentation={slot.presentation} name={slot.userName ?? "Participante"} className="slot-avatar"/>{slot.adminRole&&<b className="admin-badge">ADMIN</b>}</span>}
        <div>{slot.presentation?.progress&&<LevelBadge progress={slot.presentation.progress} compact/>}<strong>{slot.userName}{own ? " · você" : ""}</strong>{slot.userChannelTitle&&<span>Canal do participante: {slot.userChannelTitle}</span>}<small>{slot.groupCode==="#" ? "Participação administrativa" : `SOS YOUTUBER ${slot.groupCode}`} · <Clock3 size={12}/> {new Date(slot.createdAt!).toLocaleString("pt-BR")}</small></div>
      </div>
      <div className="slot-video">
        <div className="slot-video-thumb-wrap">
          {slot.videoThumbnailUrl ? <img className="slot-video-thumb-image" src={slot.videoThumbnailUrl} alt="" loading="lazy"/> : <div className="video-thumb"><Youtube size={28} fill="currentColor"/></div>}
          {slot.userChannelThumbnailUrl&&<img className="slot-channel-badge-image" src={slot.userChannelThumbnailUrl} alt={slot.userChannelTitle ? "Canal "+slot.userChannelTitle : "Canal do participante"} loading="lazy"/>}
        </div>
        <div><strong>{slot.videoTitle ?? "Vídeo compartilhado no YouTube"}</strong><span className="video-channel-label">{slot.videoChannelTitle ? <>Canal que publicou este vídeo: <b>{slot.videoChannelTitle}</b></> : "Canal do vídeo aguardando sincronização"}</span><a href={slot.youtubeUrl} target="_blank" rel="noreferrer">Assistir no YouTube <ExternalLink size={13}/></a></div>
      </div>
      {own&&<small className="slot-own-note">Seu vídeo está guardado nesta fila e continuará ligado à sua conta.</small>}
    </div>
  </article>;
  if (next && eligible && onSubmit) return <article className="slot next entry-slot">
    <div className="slot-number">{String(slot.slot).padStart(2, "0")}</div><div className="slot-main"><Plus size={22} /><div><strong>Próxima contribuição</strong><span>Salvar este vídeo custa 1 moeda.</span></div></div>
    <div className={viewerChannel ? "submission-channel-context connected":"submission-channel-context"}>
      {viewerChannel?.thumbnailUrl?<img src={viewerChannel.thumbnailUrl} alt=""/>:<span className="submission-channel-icon"><Youtube size={18} fill="currentColor"/></span>}
      <div><small>{viewerChannel ? "CANAL CONECTADO":"IDENTIDADE NO YOUTUBE"}</small><strong>{viewerChannel?.title ?? "Conecte seu canal para exibir sua identidade"}</strong><span>{viewerChannel ? "Este é o canal associado à sua conta do SOS; o canal que publicou a URL continua identificado separadamente." : "A conexão é opcional para enviar a URL e usa a autenticação oficial Google/YouTube."}</span></div>
      {onConnectChannel&&<button type="button" className="secondary compact" disabled={busy} onClick={onConnectChannel}>{viewerChannel ? "Atualizar canal":"Conectar canal"}</button>}
    </div>
    <form className="slot-entry-form" onSubmit={onSubmit}><label>URL do vídeo<input value={draft ?? ""} onChange={(e) => onDraft?.(e.target.value)} placeholder="Cole a URL do seu vídeo no YouTube" required /></label><button className="primary compact" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : `Salvar no espaço ${slot.slot}`}</button></form>
  </article>;
  return <article className="slot empty"><div className="slot-number">{String(slot.slot).padStart(2, "0")}</div><div className="slot-main"><LockKeyhole size={19} /><div><strong>Aguardando</strong><span>{next ? "É necessário um passe extra ou saldo disponível." : "Libera após o espaço anterior."}</span></div></div></article>;
}

function ReadyRound({ round, userId, connected, onConnect, onExport, onWatch, busy,onInspectParticipant }: { round: Round; userId: string; connected: boolean; onConnect: () => void; onExport: () => void; onWatch: () => void; busy: boolean;onInspectParticipant?:(phone:string)=>void }) {
  const viewerContributed=round.viewerContributed!==false;
  const success = round.export?.status === "SUCCESS";
  const watchPercent = success && round.export?.playlistId
    ? Math.max(readSavedWatchPercent(userId, round.id, round.export.playlistId), round.export.watchProgress?.percent ?? 0)
    : 0;
  return <article className="ready-card">
    <div className="ready-icon"><Check /></div>
    <div><p className="eyebrow dark">FILA {round.number} · SUA SELEÇÃO</p><h3>{round.slots.filter(slot=>slot.videoId).length} vídeos na sua seleção</h3>{round.expiresAt&&<p className="task-note">Esta fila encerra em {new Date(round.expiresAt).toLocaleString("pt-BR")}. Validade: 3 dias desde a abertura.</p>}<p className="muted">Esta fila permanece vinculada à sua conta até você concluir a tarefa. Seu progresso, autores, URLs e saldo ficam preservados.</p></div>
    {round.export && <p className="creation-progress" role="status">{round.export.status === "SUCCESS" ? `Playlist criada · ${round.slots.filter(slot=>slot.videoId).length} vídeos incluídos` : `${round.export.addedCount ?? 0} de 10 vídeos incluídos · ${Math.min(100,(round.export.addedCount ?? 0)*10)}% da criação${round.export.status === "FAILED" ? " · tentativa interrompida; você pode retomar" : ""}`}</p>}
    <details className="cycle-details"><summary>Ver vídeos, autores e horários</summary><section className="board">{round.slots.map((slot) => <SlotCard key={slot.slot} slot={slot} next={false} eligible={false} own={slot.userId === userId} busy={busy} onInspectParticipant={onInspectParticipant}/>)}</section></details>
    {!viewerContributed ? <div className="admin-ready-view"><ShieldCheck size={18}/><div><strong>Visualização administrativa</strong><span>Você pode inspecionar os 10 participantes desta fila. Como não contribuiu nela, nenhuma playlist ou tarefa pessoal será criada.</span></div></div>
      : success ? <><div className="creator-kindness-note"><strong>Enquanto assiste, vale espalhar apoio 💜</strong><span>Se gostar de um vídeo, um joinha e um comentário gentil podem deixar o dia daquele criador mais especial.</span></div><div className="ready-actions"><a className="secondary" href={`https://www.youtube.com/playlist?list=${round.export?.playlistId}`} target="_blank" rel="noreferrer">Abrir playlist no YouTube <ExternalLink size={16} /></a><button className="primary compact" onClick={onWatch}>Acompanhar tarefa · {watchPercent}%</button></div><small className="task-note">Fechar o acompanhamento apenas pausa. Dentro dele você pode abandonar a tarefa preservando seu percentual e as moedas já confirmadas.</small></>
      : <button className="primary compact" onClick={connected ? onExport : onConnect} disabled={busy}>{busy ? <LoaderCircle className="spin" /> : "Criar playlist"}</button>}
  </article>;
}

function DashboardPage({ onLogout,onOpenAdmin }: { onLogout:()=>void;onOpenAdmin:()=>Promise<void> }) {
  const [data, setData] = useState<Dashboard>();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [purchaseProduct,setPurchaseProduct]=useState<PaymentProductCode>();
  const [showStore,setShowStore]=useState(false);
  const [showJourney,setShowJourney]=useState(false);
  const [showCommunity,setShowCommunity]=useState(false);
  const [communityTarget,setCommunityTarget]=useState<string>();
  const [showAvatar,setShowAvatar]=useState(false);
  const [showAccountMenu,setShowAccountMenu]=useState(false);
  const [notice, setNotice] = useState("");
  const [creationRound, setCreationRound] = useState<Round>();
  const [watchRound, setWatchRound] = useState<Round>();
  const [adminParticipantPhone,setAdminParticipantPhone]=useState<string>();
  const [adminGroups,setAdminGroups]=useState<OwnerOverview["groups"]>([]);
  const returnedIntentHandled = useRef(false);
  const creationModalRef=useModalLifecycle(()=>setCreationRound(undefined),Boolean(creationRound),!busy);
  const [selectedQueue,setSelectedQueue]=useState<string|undefined>();   // AUDITORIA: fila escolhida no seletor
  const loadEpoch=useRef(0);
  const load = useCallback(async () => {
    const epoch=++loadEpoch.current;
    try {const fresh=await api.dashboard(selectedQueue);if(epoch===loadEpoch.current){setData(fresh);setError("");}}
    catch(cause){
      if(epoch!==loadEpoch.current)return;
      if(cause instanceof ApiError&&(cause.status===401))onLogout();
      else setError(cause instanceof Error?cause.message:"Falha ao carregar.");
    }
  },[onLogout,selectedQueue]);
  const purchaseFeedback=usePurchaseFeedback(data?.user.id,load);
  useEffect(() => { void load(); const refresh=()=>{if(document.visibilityState==="visible")void load();};const timer=window.setInterval(refresh,5_000);window.addEventListener("focus",refresh);return()=>{window.clearInterval(timer);window.removeEventListener("focus",refresh);};},[load]);
  useEffect(() => { if (!Capacitor.isNativePlatform()) return; const listener = CapacitorApp.addListener("appUrlOpen", async ({ url }) => { if (url.startsWith("conexaoyoutube://oauth")) { await Browser.close(); await load(); } }); return () => { void listener.then((handle) => handle.remove()); }; }, [load]);

  useEffect(() => {
    if (!data || returnedIntentHandled.current) return;
    const params = new URLSearchParams(location.search); const roundId = params.get("round");
    if (params.get("youtube") !== "connected") return;
    returnedIntentHandled.current = true;
    if (!roundId) {
      history.replaceState(null,"",location.pathname);
      setNotice("Canal do YouTube conectado. Seu nome e ícone passam a acompanhar sua identidade no SOS YouTuber.");
      void load();
      return;
    }
    let intent: { userId?: string; roundId?: string; at?: number } = {};
    try { intent = JSON.parse(sessionStorage.getItem("conexao_creation_intent") ?? "{}"); } catch { /* Invalid local intent is ignored. */ }
    if (intent.userId !== data.user.id || intent.roundId !== roundId || !intent.at || Date.now()-intent.at>600_000 || !data.readyRounds.some((r) => r.id === roundId)) return;
    sessionStorage.removeItem("conexao_creation_intent"); history.replaceState(null,"",location.pathname);
    void exportRound(roundId);
  }, [data]);
  useEffect(() => { if (!busy) return; const timer = setInterval(() => void load(), 2_000); return () => clearInterval(timer); }, [busy,load]);
  useEffect(()=>{
    if(!data?.viewer.adminRole){setAdminGroups([]);return;}
    const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Bahia",year:"numeric",month:"2-digit"}).formatToParts(new Date());
    const month=`${parts.find((part)=>part.type==="year")?.value}-${parts.find((part)=>part.type==="month")?.value}`;
    void ownerApi.overview(month).then((overview)=>setAdminGroups(overview.groups)).catch(()=>setAdminGroups([]));
  },[data?.viewer.adminRole]);

  if (!data) return <WelcomeLoading error={error} onRetry={()=>void load()}/>;
  const openRoundId=data.openRound.id;
  const filled = data.openRound.slots.filter((slot) => slot.youtubeUrl).length;
  const nextSlot = filled + 1;
  const hasPendingTask = data.readyRounds.length > 0 && data.viewer.contributionBlockedByPendingTask!==false;
  const administrativeParticipant=Boolean(data.viewer.adminRole);
  const eligible = data.groupAccess?.ready!==false && (!hasPendingTask || administrativeParticipant) && !data.wallet.paymentHold && (administrativeParticipant || data.viewer.contributionsInOpenRound < (data.viewer.contributionAllowance??1) || data.wallet.extraPasses > 0) && data.wallet.total>=1;

  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await api.submit(url,openRoundId); setUrl(""); await load(); } catch (cause) { if(cause instanceof ApiError && cause.status===409 && cause.data.code==="QUEUE_CHANGED"){await load();setError(cause.message+" Nenhuma moeda foi cobrada. Confira a nova fila e envie novamente.");} else setError(cause instanceof Error ? cause.message : "Falha ao salvar."); } finally { setBusy(false); } }
  async function connectYoutube(roundId?: string) { setBusy(true); try { const native = Capacitor.isNativePlatform(); const result = await api.youtubeConnect(native ? "app" : "web", roundId); if (native) await Browser.open({ url: result.url }); else window.location.href = result.url; } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao conectar."); } finally { setBusy(false); } }
  async function exportRound(id:string) {
    setCreationRound(previous=>previous??data?.readyRounds.find((r)=>r.id===id));
    setBusy(true);setError("");
    try {
      await api.exportRound(id);
      const fresh=await api.dashboard();
      setData(fresh);
      setCreationRound(undefined);
      setNotice("Playlist criada. Seu acompanhamento está disponível com a seleção salva.");
      const ready=fresh.readyRounds.find((round)=>round.id===id && round.export?.status==="SUCCESS" && round.export.playlistId);
      if (ready) setWatchRound(ready);
    } catch(cause) {
      setError(cause instanceof Error?cause.message:"Falha ao criar a playlist.");
    } finally { setBusy(false); }
  }

  const included = creationRound ? data.readyRounds.find((r) => r.id === creationRound.id)?.export?.addedCount ?? 0 : 0;
  return <div className="app-shell">
    <header><div className="logo"><span><Youtube size={21} fill="currentColor" /></span>SOS <strong>YouTuber</strong></div><div className="header-actions"><button className="icon-button" onClick={() => void load()} title="Atualizar"><RefreshCw size={18} /></button><CommunityLauncher onOpen={()=>{setCommunityTarget(undefined);setShowCommunity(true);}} /><button className="icon-button" onClick={()=>setShowAccountMenu(true)} aria-label="Abrir menu da minha conta" title="Menu"><Menu size={18}/></button><button className="avatar-header-button" onClick={()=>setShowAvatar(true)} aria-label={`Trocar avatar de ${data.user.name}`} title="Trocar avatar"><UserAvatarView avatar={data.user.avatar} presentation={data.user.presentation} name={data.user.name} className="header-avatar"/>{data.viewer.adminRole&&<span className="header-admin-badge">ADMIN</span>}</button><button className="profile profile-text-only" onClick={()=>setShowAccountMenu(true)} aria-label={`Abrir menu da conta de ${data.user.name}`}><div><strong>{data.user.name}</strong><small>{data.user.youtubeChannel?.title ?? (data.viewer.adminRole ? "Acesso administrativo" : data.groupAccess?.ready===false?"Entrada no grupo em andamento":data.user.groupCodes?.length?`Grupos SOS ${data.user.groupCodes.join(", ")}`:`Grupo SOS YOUTUBER ${data.user.groupCode}`)}</small></div></button></div></header>
    <main className="dashboard">
      {data.groupAccess?.ready===false&&<section className="notice group-access-status" style={{display:"block"}} role="status" aria-label="Entrada no grupo">
        <strong>{data.groupAccess.state==="INVITED"?"Confira seu convite no WhatsApp":data.groupAccess.state==="NEEDS_SUPPORT"?"Sua entrada no grupo precisa de atenção":"Estamos preparando sua entrada no grupo"}</strong>
        <p>{data.groupAccess.state==="INVITED"?"Sua conta já está acessível. Aceite o convite enviado pelo WhatsApp; a confirmação de presença será atualizada automaticamente.":data.groupAccess.state==="NEEDS_SUPPORT"?"Sua conta e senha continuam funcionando. A entrada automática no grupo encontrou uma dificuldade; fale com o atendimento para a equipe responsável conferir.":"Sua conta e senha já funcionam. A entrada automática no grupo está em andamento; esta página acompanha a confirmação. As filas ficam disponíveis quando sua presença no grupo for confirmada."}</p>
        {data.groupAccess.state==="NEEDS_SUPPORT"&&<ProjectWhatsAppContact/>}
      </section>}
      {data.groupAccess?.ready!==false&&<QueueSwitcher queues={data.queues} administrative={data.viewer.adminRole==="ROOT_OWNER"} onSelect={setSelectedQueue} onChanged={load} onLeft={(id)=>{if(id===selectedQueue||id===data.queues.current?.id)setSelectedQueue(undefined);}} onNeedSkip={()=>setShowStore(true)} onNeedPass={()=>setShowStore(true)}/>}
      {(!hasPendingTask || administrativeParticipant) ? <>
        <UserWelcomeCarousel onOpenStore={()=>setShowStore(true)} onOpenCommunity={()=>{setCommunityTarget(undefined);setShowCommunity(true);}}/>
        {data.gamification?.enabled&&<button type="button" className="journey-launcher" onClick={()=>setShowJourney(true)}>
          {data.gamification.progress&&<LevelBadge progress={data.gamification.progress}/>}<span><strong>{data.gamification.administrative?"Comunidade":"Minha jornada"}</strong><small>{data.gamification.administrative?"XP administrativo ∞ · fora da competição":data.gamification.progress?data.gamification.progress.xp+" XP · veja seu próximo nível":"Acompanhe sua jornada"}</small></span>
          {data.gamification.booster.available&&<b className="journey-booster-nudge">Você tem um Booster! ✨</b>}
        </button>}
        <SuperPanel snapshot={data.subscription} onOpenStore={()=>setShowStore(true)}/>
        <section className="hero-row queue-hero">
          <div><p className="eyebrow dark">QUADRO COMPARTILHADO · FILA {data.openRound.number}</p><h1>Vamos montar a próxima seleção?</h1><p className="muted">Cada vídeo entra uma vez. Ao completar 10 URLs válidas, a fila é preservada e a próxima é aberta automaticamente.</p></div>
          <UserWallet wallet={data.wallet} skipsAvailable={data.queues.skipsAvailable} passesAvailable={data.queues.passesAvailable} subscription={data.subscription} onOpenStore={()=>setShowStore(true)}/>
        </section>
        <p className="queue-lifetime-note">Cada fila dura 3 dias desde a abertura. Ao expirar ou quando todos concluírem, sai das filas ativas; seus links e histórico ficam preservados.{data.openRound.expiresAt&&<> Esta fila encerra em {new Date(data.openRound.expiresAt).toLocaleString("pt-BR")}.</>}</p>
        <section className="progress-card"><div className="progress-copy"><strong>{filled} de 10 vídeos</strong><span>{10 - filled} espaços restantes</span></div><div className="progress-track"><i style={{ width: `${filled * 10}%` }} /></div></section>
        {data.openRound.number > 1 && <div className="queue-context" role="status"><div className="queue-pill">FILA {data.openRound.number}</div><div><strong>Você está na Fila {data.openRound.number}.</strong><span>Contribua quando houver espaço. Se participar de outras filas, use o seletor para alternar: cada uma mantém seus vídeos, autores e progresso.</span></div></div>}
        {!eligible && data.groupAccess?.ready!==false && !data.wallet.paymentHold && <div className="notice"><LockKeyhole size={19} /><span>{data.wallet.total<1 ? "Você precisa de pelo menos 1 moeda para salvar uma URL." : "Você usou suas contribuições nesta fila. Acompanhe a seleção ou confira outra fila pelo seletor."}</span></div>}
        {administrativeParticipant && <div className="admin-participant-note"><ShieldCheck size={18}/><div><strong>Modo ADMIN ativo</strong><span>Você pode contribuir novamente nesta fila sem consumir passe. Cada URL continua usando 1 moeda e vídeos duplicados continuam bloqueados.</span></div></div>}
        {data.wallet.paymentHold && <div className="notice" role="status"><ShieldCheck size={19} /><span>Carteira em revisão por atualização de um pagamento. Novas contribuições ficam suspensas até a conciliação.</span></div>}
        {notice && <div className="notice" role="status"><Check size={19} /><span>{notice}</span></div>}
        {error && <p className="error banner">{error}</p>}
        {filled>0&&filled<10&&data.openRound.slots.some(slot=>slot.userId===data.user.id)&&<section className="partial-playlist-choice"><h3>Já quer começar a assistir?</h3><p>Você pode criar sua playlist com os {filled} vídeos atuais. Receberá XP pelo acompanhamento válido, sem moedas nesta seleção. Esperar os 10 permite ganhar mais XP e recompensas de moedas.</p><button type="button" className="secondary" disabled={busy} onClick={()=>setCreationRound({...data.openRound,viewerContributed:true})}>Criar playlist com {filled} vídeos</button></section>}
        <section className="board">{data.openRound.slots.map((slot) => <SlotCard key={slot.slot} slot={slot} next={slot.slot === nextSlot} eligible={eligible && data.wallet.total >= 1} draft={url} onDraft={setUrl} onSubmit={submit} busy={busy} own={slot.userId === data.user.id} onInspectParticipant={administrativeParticipant?setAdminParticipantPhone:undefined} viewerChannel={data.user.youtubeChannel} onConnectChannel={()=>void connectYoutube()}/>)}</section>
      </> : <>
        <section className="hero-row task-hero">
          <div><p className="eyebrow dark">SUA TAREFA · FILA {data.readyRounds[0]?.number}</p><h1>Esta fila já foi preenchida.</h1><p className="muted">Como você participou da Fila {data.readyRounds[0]?.number}, acompanhe os vídeos pelo player oficial. A cada 20 minutos registrados no player, acumulados entre sessões e filas, você recebe 1 moeda interna. O percentual mostra sua jornada, mas não determina a recompensa.</p></div>
          <UserWallet wallet={data.wallet} onOpenStore={()=>setShowStore(true)} compact/>
        </section>
        <div className="queue-context task-context" role="status"><div className="queue-pill">FILA {data.readyRounds[0]?.number}</div><div><strong>A próxima fila já pode estar sendo montada por outros participantes.</strong><span>Fechar o acompanhamento apenas pausa. Abandonar preserva o percentual e aplica 60 minutos antes de novo ingresso gratuito. Suas outras filas liberadas continuam acessíveis; Passe/Pular permite outro acesso.</span></div></div>
        {notice && <div className="notice" role="status"><Check size={19} /><span>{notice}</span></div>}
        {error && <p className="error banner">{error}</p>}
      </>}
      {data.readyRounds.length > 0 && <section className="completed"><div className="section-title"><div><p className="eyebrow dark">{administrativeParticipant?"SUPERVISÃO DE FILAS":"FILA EM ANDAMENTO"}</p><h2>{administrativeParticipant?"Filas completas recentes":"Sua seleção concluída"}</h2></div><span>{administrativeParticipant?"Clique em um avatar para administrar o participante":"Seu progresso fica salvo na conta"}</span></div>{data.readyRounds.map((round) => <ReadyRound key={round.id} round={round} userId={data.user.id} connected={data.viewer.youtubeConnected} busy={busy} onConnect={() => setCreationRound(round)} onExport={() => setCreationRound(round)} onWatch={() => setWatchRound(round)} onInspectParticipant={administrativeParticipant?setAdminParticipantPhone:undefined}/>)}</section>}
      <footer><ShieldCheck size={17} /><span>Moedas são créditos internos do SOS YouTuber usados nas contribuições. Elas podem vir do crédito inicial, de compras ou das recompensas da sua jornada e não possuem valor de saque.</span></footer>
    </main>
    {creationRound && <div className="modal-backdrop" onMouseDown={()=>{if(!busy)setCreationRound(undefined);}}><section ref={creationModalRef} className="modal" onMouseDown={(event)=>event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Criação de playlist"><button className="close" aria-label="Cancelar criação" disabled={busy} onClick={() => setCreationRound(undefined)}>×</button><p className="eyebrow dark">FILA {creationRound.number} · {creationRound.slots.filter(slot=>slot.videoId).length} VÍDEOS</p><h2>Criar playlist na sua conta</h2><p className="muted">{data.viewer.youtubeConnected ? "Você autorizou o acesso ao YouTube. Ao confirmar, os links da sua seleção salva serão incluídos em uma playlist privada na sua conta." : "Você será direcionado à autenticação oficial do Google/YouTube. Após autorizar, criaremos uma playlist privada com os links permanentes da sua seleção."}</p><p className="muted">Você pode cancelar. Os registros de autoria e links da fila continuam preservados.</p>{creationRound.slots.filter(slot=>slot.videoId).length<10&&<p role="note" className="notice">Seleção parcial: XP proporcional aos vídeos observados, sem moedas neste acompanhamento. A seleção fica fixa; esperar 10 vídeos permite mais XP e moedas.</p>}{busy && data.viewer.youtubeConnected && <div role="status"><progress max={10} value={included} /><p>{included} de 10 vídeos incluídos · {Math.min(100,included*10)}% da criação</p></div>}{error && <p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy} onClick={() => { setError(""); setBusy(true); void api.preparePlaylist(creationRound.id,creationRound.slots.filter(slot=>slot.videoId).length<10).then(()=>{if(data.viewer.youtubeConnected)void exportRound(creationRound.id);else{sessionStorage.setItem("conexao_creation_intent",JSON.stringify({userId:data.user.id,roundId:creationRound.id,at:Date.now()}));void connectYoutube(creationRound.id);}}).catch(cause=>{setError(cause instanceof Error?cause.message:"Não foi possível preparar sua seleção.");setBusy(false);}); }}>{busy ? data.viewer.youtubeConnected ? "Criando…" : "Abrindo autenticação…" : data.viewer.youtubeConnected ? "Confirmar criação" : "Continuar para Google/YouTube"}</button></section></div>}
    <GlobalChat subscriptionActive={data.subscription?.active} currentUserId={data.user.id} onOpenInbox={()=>{setCommunityTarget(undefined);setShowCommunity(true);}} onOpenProfile={(id)=>{setCommunityTarget(id);setShowCommunity(true);}}/>
    {error&&!creationRound&&<ActionErrorDialog message={error} onClose={()=>setError("")}/>}
    {showCommunity&&<CommunityModal wallet={data.wallet} currentUserId={data.user.id} targetId={communityTarget} onClose={()=>setShowCommunity(false)}/>}
    {showJourney&&data.gamification&&<JourneyModal onClose={()=>setShowJourney(false)}>
      <GamificationPanel data={data.gamification} onClaimBooster={async()=>{const result=await api.claimBooster();await load();return result;}} onRedeem={async(code,reference)=>{const result=await api.redeemReward(code,reference);await load();return result;}} onRefresh={load}/>
    </JourneyModal>}
    {showStore && <StoreModal onChanged={load} data={data} onClose={()=>setShowStore(false)} onChoose={(product)=>{setShowStore(false);setPurchaseProduct(product);}}/>}
    {purchaseProduct && <PurchaseModal product={purchaseProduct} productInfo={data.commerce.products.find((item)=>item.code===purchaseProduct)} onClose={()=>setPurchaseProduct(undefined)} paymentStates={purchaseFeedback.states} onTracked={purchaseFeedback.track} onApproved={(receipt)=>{setPurchaseProduct(undefined);void purchaseFeedback.confirm(receipt);}}/>}
    {purchaseFeedback.receipt&&<PurchaseCelebration key={purchaseFeedback.receipt.paymentId} receipt={purchaseFeedback.receipt} onClose={purchaseFeedback.dismiss} onInventory={()=>{setCommunityTarget(undefined);setShowCommunity(true);}}/>}
    {showAccountMenu && <UserAccountMenu data={data} onClose={()=>setShowAccountMenu(false)} onLogout={onLogout} onDeleted={onLogout} onOpenAdmin={onOpenAdmin} onConnectYoutube={()=>{setShowAccountMenu(false);void connectYoutube();}} onAvatarChanged={(avatar)=>{setData((current)=>current?{...current,user:{...current.user,avatar}}:current);void load();}}/>}
    {showAvatar && <AvatarModal name={data.user.name} current={data.user.avatar} presentation={data.user.presentation} onClose={()=>setShowAvatar(false)} onChanged={(avatar)=>{setData((current)=>current?{...current,user:{...current.user,avatar}}:current);void load();}}/>}
    {watchRound?.export?.playlistId && <WatchProgress onProgress={()=>void load()} playlistId={watchRound.export.playlistId} roundId={watchRound.id} userId={data.user.id} slots={watchRound.slots} initialProgress={watchRound.export.watchProgress} initialBalance={data.wallet.total} initialWatchRewards={data.watchRewards} onClose={() => { setWatchRound(undefined); void load(); }} onFinalized={()=>{setWatchRound(undefined);setSelectedQueue(undefined);setNotice("Tarefa concluída. Suas outras filas continuam disponíveis; o intervalo protege somente um novo ingresso gratuito.");void load();}} onAbandoned={({percent,nextOpenRound})=>{setWatchRound(undefined);setNotice(nextOpenRound ? `Tarefa encerrada em ${percent}%. Seu progresso e moedas foram preservados. Você voltou para a Fila ${nextOpenRound.sequence}.` : `Tarefa encerrada em ${percent}%. Seu progresso e moedas foram preservados.`);void load();}} />}
    {adminParticipantPhone && administrativeParticipant && <ParticipantAdminModal phone={adminParticipantPhone} groups={adminGroups} onClose={()=>setAdminParticipantPhone(undefined)} onChanged={(next)=>{if(next)setAdminParticipantPhone(next);void load();}}/>}
  </div>;
}

export function App() {
  const initialRole=(()=>{
    const preferred=localStorage.getItem("conexao_active_role");
    if(preferred==="user"&&localStorage.getItem("conexao_token")) return "user" as const;
    if(preferred==="owner"&&localStorage.getItem("conexao_owner_token")) return "owner" as const;
    if(localStorage.getItem("conexao_owner_token")) return "owner" as const;
    if(localStorage.getItem("conexao_token")) return "user" as const;
    return undefined;
  })();
  const [role,setRole]=useState<"user"|"owner"|undefined>(initialRole);

  const setActiveRole=useCallback((next:"user"|"owner"|undefined)=>{
    if(next)localStorage.setItem("conexao_active_role",next);else localStorage.removeItem("conexao_active_role");
    setRole(next);
  },[]);

  const logoutUser=useCallback(()=>{
    localStorage.removeItem("conexao_token");
    if(localStorage.getItem("conexao_owner_token")) setActiveRole("owner");
    else setActiveRole(undefined);
  },[setActiveRole]);

  const logoutOwner=useCallback(()=>{
    localStorage.removeItem("conexao_owner_token");
    if(localStorage.getItem("conexao_token")) setActiveRole("user");
    else setActiveRole(undefined);
  },[setActiveRole]);

  const participateAsOwner=useCallback(async()=>{
    const result=await ownerApi.participantSession();
    localStorage.setItem("conexao_token",result.token);
    setActiveRole("user");
  },[setActiveRole]);

  const openAdminPanel=useCallback(async()=>{
    const result=await api.elevateAdmin();
    localStorage.setItem("conexao_owner_token",result.token);
    setActiveRole("owner");
  },[setActiveRole]);

  const doneLogin=useCallback((next:"user"|"owner")=>setActiveRole(next),[setActiveRole]);

  return role==="owner"
    ? <OwnerDashboard onLogout={logoutOwner} onParticipate={participateAsOwner}/>
    : role==="user"
      ? <DashboardPage onLogout={logoutUser} onOpenAdmin={openAdminPanel}/>
      : <><LaunchFlash/><Login onDone={doneLogin}/></>;
}
