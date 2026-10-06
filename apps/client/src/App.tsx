import { useCallback, useEffect, useState, useRef, type FormEvent } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { ArrowLeft, Check, CircleDollarSign, Clock3, ExternalLink, Link2, LoaderCircle, LockKeyhole, LogOut, Plus, RefreshCw, ShieldCheck, Youtube } from "lucide-react";
import { OwnerDashboard } from "./OwnerDashboard";
import { WatchProgress, readSavedWatchPercent } from "./WatchProgress";
import { api, ownerApi, participationApi, ApiError, type Dashboard, type Pix, type Round } from "./api";
import { INTERNATIONAL_PHONE_PATTERN, formatInternationalPhoneInput, isCompleteInternationalPhone } from "./phone";

const COOLDOWN_KEY = "conexao_cooldown_until";

function storedCooldownUntil() {
  const value = Date.parse(localStorage.getItem(COOLDOWN_KEY) ?? "");
  return Number.isFinite(value) && value > Date.now() ? value : 0;
}

function countdownLabel(milliseconds: number) {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}`;
}

function Login({ onDone }: { onDone: (role: "user" | "owner") => void }) {
  const [step, setStep] = useState<"profile" | "credential">("profile");
  const [authRole, setAuthRole] = useState<"user" | "owner">();
  const [joinMode, setJoinMode] = useState(false);
  const [credential, setCredential] = useState("");
  const [consent, setConsent] = useState(false);
  const [joined, setJoined] = useState<{ message: string; whatsappUrl?: string }>();
  const [form, setForm] = useState({ name: "", phone: "", groupCode: "" });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState(storedCooldownUntil);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    if (!cooldownUntil) return;
    const tick = () => {
      const current = Date.now();
      setNowMs(current);
      if (current >= cooldownUntil) {
        localStorage.removeItem(COOLDOWN_KEY);
        setCooldownUntil(0);
      }
    };
    tick();
    const timer = window.setInterval(tick,1000);
    return () => window.clearInterval(timer);
  },[cooldownUntil]);

  function activateCooldown(value: unknown) {
    if (typeof value !== "string") return false;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || parsed <= Date.now()) return false;
    localStorage.setItem(COOLDOWN_KEY,value);
    setCooldownUntil(parsed);
    setNowMs(Date.now());
    return true;
  }

  function returnToProfile() {
    setStep("profile"); setAuthRole(undefined); setCredential(""); setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const name = form.name.trim();
      if (name.length < 2) throw new Error("Informe seu nome ou como prefere ser chamado.");
      if (!isCompleteInternationalPhone(form.phone)) throw new Error("Informe um WhatsApp válido com código do país.");

      if (joinMode) {
        if (!/^(?:[1-9]|[1-9][0-9])$/.test(form.groupCode)) throw new Error("Digite o número do seu grupo SOS YOUTUBER, de 1 a 99.");
        if (!consent) throw new Error("Autorize o uso do nome e número para enviar a solicitação.");
        const result = await participationApi.join({ name, phone: form.phone, groupCode: form.groupCode, consent: true });
        setJoined(result);
      } else if (step === "profile") {
        const role = await api.resolveRole({ name, phone: form.phone });
        setAuthRole(role.role);
        setCredential("");
        if (role.role === "owner") {
          setStep("credential");
        } else {
          if (!/^(?:[1-9]|[1-9][0-9])$/.test(form.groupCode)) throw new Error("Digite o número do seu grupo SOS YOUTUBER, de 1 a 99.");
          try {
            const result = await api.login({ name, phone: form.phone, groupCode: form.groupCode });
            localStorage.removeItem("conexao_owner_token");
            localStorage.setItem("conexao_token", result.token);
            onDone("user");
          } catch (cause) {
            if (cause instanceof ApiError && cause.status === 423 && activateCooldown(cause.data.cooldownUntil)) return;
            if (!(cause instanceof ApiError) || cause.status !== 403) throw cause;
            const pending = await participationApi.join({ name, phone: form.phone, groupCode: form.groupCode, consent: true });
            setJoinMode(true);
            setJoined(pending);
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
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir o acesso.");
    } finally {
      setBusy(false);
    }
  }

  const cooldownActive = cooldownUntil > nowMs;
  const cooldownRemaining = Math.max(0,cooldownUntil-nowMs);

  return <main className="login-shell">
    <section className="brand-panel">
      <div className="brand-lockup">
        <div className="brand-mark"><Youtube size={34} fill="currentColor" /></div>
        <p className="eyebrow">SOS YOUTUBER</p>
      </div>
      <h1>Uma playlist.<br />Dez vozes.</h1>
      <p className="lead">Organize a curadoria do seu grupo e leve a seleção para a sua própria conta do YouTube.<span className="lead-choice">Sempre por escolha sua.</span></p>
      <div className="participation-cluster">
        <button className="primary intro-join" type="button" onClick={() => { setJoinMode(true); returnToProfile(); }}>Quero participar</button>
        <div className="trust-note" aria-label="Compromissos de segurança">
          <span className="security-emblem" aria-hidden="true"><svg viewBox="0 0 48 54" role="presentation"><path className="shield-shadow" d="M24 2 43 9v15c0 13-7.9 23.5-19 28C12.9 47.5 5 37 5 24V9L24 2Z"/><path className="shield-face" d="M24 6.5 39 12v12c0 10.6-6 19.3-15 23.4C15 43.3 9 34.6 9 24V12l15-5.5Z"/><path className="shield-highlight" d="M24 9 36 13.4v3.3L24 12.3 12 16.7v-3.3L24 9Z"/><path className="shield-check" d="m17.2 26.4 4.5 4.5 9.4-10"/></svg></span>
          <div className="trust-copy"><span>Sem views automáticas.</span><span>Sem reprodução oculta.</span><strong>Você mantém o controle.</strong></div>
        </div>
      </div>
    </section>
    <section className="login-card">
      <div>
        <p className="eyebrow dark">ACESSO SOS YOUTUBER</p>
        <h2>{cooldownActive ? "Intervalo entre filas" : joined ? "Solicitação registrada" : step === "profile" ? joinMode ? "Participar do SOS YouTube" : "Entre na sua conexão" : "Credencial"}</h2>
        <p className={!cooldownActive && !joined && (step === "credential" || (step === "profile" && !joinMode)) ? "muted login-helper" : "muted"}>{cooldownActive ? "Sua última tarefa foi concluída. O próximo acesso será liberado automaticamente quando o relógio chegar a zero." : joined ? "Seu cadastro entrou na fila de validação da equipe." : step === "profile" ? joinMode ? "Informe seus dados. Sua solicitação será registrada e continuaremos pelo WhatsApp." : "Informe seus dados. Identificamos seu acesso pelo WhatsApp e grupo." : "Digite sua credencial para abrir o painel administrativo."}</p>
      </div>
      {cooldownActive ? <div className="cooldown-card" role="status"><Clock3 size={34} /><span>Você poderá entrar novamente em</span><strong>{countdownLabel(cooldownRemaining)}</strong><p className="muted">Seu cadastro, saldo, URLs, fila e progresso continuam salvos. Este intervalo evita que a mesma conta entre imediatamente em outra fila após concluir uma tarefa.</p></div> : joined ? <div className="join-success" role="status">
        <div className="join-success-heading"><ShieldCheck size={30} /><strong>{joined.message}</strong></div>
        <p><strong>{form.name.trim()}</strong>, agora só falta uma etapa para você participar do nosso sistema!</p>
        <p className="muted">Nós entraremos em contato com seu número WhatsApp informado em breve para seguirmos com o registro.</p>
        <button className="secondary back-to-login" onClick={() => { setJoined(undefined); setJoinMode(false); returnToProfile(); }}><ArrowLeft size={18} />Voltar para tela de login</button>
      </div> : <form className="access-form" noValidate onSubmit={submit}>
        <div className="access-fields">
          {step === "profile" ? <>
            <label>Seu nome ou como prefere ser chamado<input autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Como você será identificado" required /></label>
            <label>WhatsApp<input inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: formatInternationalPhoneInput(e.target.value) })} pattern={INTERNATIONAL_PHONE_PATTERN} placeholder="+ código do país + número" required /></label>
            <label>SOS YOUTUBER — Digite a qual grupo você pertence<input inputMode="numeric" maxLength={2} pattern="[1-9]|[1-9][0-9]" value={form.groupCode} onChange={(e) => setForm({ ...form, groupCode: e.target.value.replace(/[^0-9]/g, "").slice(0, 2) })} placeholder="1 a 99" required={joinMode} /></label>
            {joinMode && <label className="consent-row"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required /><span>Autorizo o SOS YouTube a usar meu nome e número para analisar esta solicitação e entrar em contato sobre o grupo.</span></label>}
          </> : <>
            <label>Credencial<input type="password" autoComplete="current-password" value={credential} onChange={(e) => setCredential(e.target.value)} placeholder="Digite sua credencial" /></label>
            <button type="button" className="text-button back-link" onClick={returnToProfile}><ArrowLeft size={16} />Voltar para tela de login</button>
          </>}
          {error && <p className="error">{error}</p>}
        </div>
        <div className="access-actions">
          <button className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : joinMode ? "Enviar dados e continuar" : step === "profile" ? "Continuar" : "Entrar"}</button>
        </div>
      </form>}
      {!cooldownActive && step === "profile" && !joined && joinMode && <button className="text-button" type="button" onClick={() => { setJoinMode(false); setError(""); }}>Já participo — voltar ao login</button>}
    </section>
  </main>;
}

function SlotCard({ slot, next, eligible, draft, onDraft, onSubmit, busy, own, completed, exported, connected, onExport, onConnect }: {
  slot: Round["slots"][number]; next: boolean; eligible: boolean; draft?: string; onDraft?: (value: string) => void; onSubmit?: (event: FormEvent) => void;
  busy?: boolean; own?: boolean; completed?: boolean; exported?: boolean; connected?: boolean; onExport?: () => void; onConnect?: () => void;
}) {
  if (slot.youtubeUrl) return <article className="slot filled">
    <div className="slot-number">{String(slot.slot).padStart(2, "0")}</div>
    <div className="slot-main"><div className="video-thumb"><Youtube size={28} fill="currentColor" /></div><div><strong>{slot.userName}{own ? " · você" : ""}</strong><span>SOS YOUTUBER {slot.groupCode}</span><small><Clock3 size={13} /> {new Date(slot.createdAt!).toLocaleString("pt-BR")}</small><a className="video-link" href={slot.youtubeUrl} target="_blank" rel="noreferrer">{slot.youtubeUrl}</a>{own && !completed && <small>Salvo. Ao completar 10 vídeos, você poderá compartilhar a playlist.</small>}{own && completed && !exported && <button className="primary compact" onClick={connected ? onExport : onConnect} disabled={busy}>{"Criar playlist"}</button>}</div></div>
    <a href={slot.youtubeUrl} target="_blank" rel="noreferrer" aria-label="Abrir vídeo"><ExternalLink size={18} /></a>
  </article>;
  if (next && eligible && onSubmit) return <article className="slot next entry-slot">
    <div className="slot-number">{String(slot.slot).padStart(2, "0")}</div><div className="slot-main"><Plus size={22} /><div><strong>Próxima contribuição</strong><span>Salvar este vídeo custa 1 moeda.</span></div></div>
    <form className="slot-entry-form" onSubmit={onSubmit}><label>URL do vídeo<input value={draft ?? ""} onChange={(e) => onDraft?.(e.target.value)} placeholder="Cole a URL do seu vídeo no YouTube" required /></label><button className="primary compact" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : `Salvar no espaço ${slot.slot}`}</button></form>
  </article>;
  return <article className="slot empty"><div className="slot-number">{String(slot.slot).padStart(2, "0")}</div><div className="slot-main"><LockKeyhole size={19} /><div><strong>Aguardando</strong><span>{next ? "É necessário um passe extra ou saldo disponível." : "Libera após o espaço anterior."}</span></div></div></article>;
}

function ReadyRound({ round, userId, connected, onConnect, onExport, onWatch, onFinalize, busy }: { round: Round; userId: string; connected: boolean; onConnect: () => void; onExport: () => void; onWatch: () => void; onFinalize: () => void; busy: boolean }) {
  const success = round.export?.status === "SUCCESS";
  const watchPercent = success && round.export?.playlistId
    ? Math.max(readSavedWatchPercent(userId, round.id, round.export.playlistId), round.export.watchProgress?.percent ?? 0)
    : 0;
  const watchCoins = round.export?.watchProgress?.rewardCoins ?? Math.floor(watchPercent / 10);
  return <article className="ready-card">
    <div className="ready-icon"><Check /></div>
    <div><p className="eyebrow dark">FILA {round.sequence} COMPLETA</p><h3>10 vídeos prontos para sua playlist</h3><p className="muted">Esta fila permanece vinculada à sua conta até você concluir a tarefa. Seu progresso, autores, URLs e saldo ficam preservados.</p></div>
    {round.export && <p className="creation-progress" role="status">{round.export.status === "SUCCESS" ? "Playlist criada · 10 de 10 vídeos incluídos" : `${round.export.addedCount ?? 0} de 10 vídeos incluídos · ${Math.min(100,(round.export.addedCount ?? 0)*10)}% da criação${round.export.status === "FAILED" ? " · tentativa interrompida; você pode retomar" : ""}`}</p>}
    <details className="cycle-details"><summary>Ver os 10 vídeos, autores e horários</summary><section className="board">{round.slots.map((slot) => <SlotCard key={slot.slot} slot={slot} next={false} eligible={false} own={slot.userId === userId} completed exported={success} connected={connected} onConnect={onConnect} onExport={onExport} busy={busy} />)}</section></details>
    {success ? <><div className="ready-actions"><a className="secondary" href={`https://www.youtube.com/playlist?list=${round.export?.playlistId}`} target="_blank" rel="noreferrer">Abrir no YouTube <ExternalLink size={16} /></a><button className="secondary" onClick={onWatch}>Acompanhar reprodução · {watchPercent}% · +{watchCoins} moedas</button><button className="secondary" onClick={onFinalize}>Concluir tarefa</button></div><small className="task-note">Concluir encerra sua participação nesta fila no percentual atual e inicia um intervalo de 30 minutos. Fechar o acompanhamento apenas pausa e mantém tudo salvo.</small></>
      : <button className="primary compact" onClick={connected ? onExport : onConnect} disabled={busy}>{busy ? <LoaderCircle className="spin" /> : "Criar playlist"}</button>}
  </article>;
}

function PixPanel({ onClose, onApproved }: { onClose: () => void; onApproved: () => void }) {
  const [form, setForm] = useState({ email: "", cpf: "" });
  const [pix, setPix] = useState<Pix>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await api.createPix(form.email, form.cpf); if (result.status === "APPROVED") onApproved(); else setPix(result); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao gerar o Pix."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!pix || pix.providerPaymentId.startsWith("demo_") || pix.status !== "PENDING") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await api.paymentStatus(pix.id);
        if (cancelled) return;
        setError("");
        if (result.status === "APPROVED") onApproved();
        else if (result.status !== "PENDING") setPix((current) => current ? { ...current, status: result.status } : current);
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "Não foi possível consultar o pagamento."); }
    };
    const timer = window.setInterval(() => void poll(), 5_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [pix?.id, pix?.status, pix?.providerPaymentId, onApproved]);
  async function demoApprove() { if (!pix) return; setBusy(true); try { await api.approveDemoPix(pix.id); onApproved(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha na aprovação."); } finally { setBusy(false); } }
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal" role="dialog" aria-modal="true" aria-label="Comprar créditos por Pix" onMouseDown={(e) => e.stopPropagation()}>
    <button className="close" aria-label="Fechar compra" onClick={onClose}>×</button>
    <p className="eyebrow dark">PACOTE ÚNICO</p><h2>20 moedas + 1 passe extra</h2><div className="price"><span>R$</span>20<small>,00</small></div>
    <p className="muted">1 moeda comprada custa R$ 1,00 neste pacote. O passe permite ocupar mais uma posição na mesma fila. Moedas iniciais ou recebidas como bônus nunca geram passes.</p>
    {!pix ? <form onSubmit={create}>
      <label>E-mail do pagador<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
      <label>CPF do pagador<input inputMode="numeric" value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value.replace(/\D/g, "").slice(0, 11) })} required /></label>
      {error && <p className="error">{error}</p>}<button className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : "Gerar Pix"}</button>
    </form> : <div className="pix-result">
      {pix.qrCodeBase64 && <img src={`data:image/png;base64,${pix.qrCodeBase64}`} alt="QR Code Pix" />}
      {pix.qrCode && <><p className="muted">Pix copia e cola</p><textarea readOnly value={pix.qrCode} /></>}
      {pix.providerPaymentId.startsWith("demo_") && <div className="demo-code"><CircleDollarSign /><strong>Pagamento de demonstração</strong><span>Nenhum dinheiro será movimentado.</span></div>}
      {pix.providerPaymentId.startsWith("demo_") && <button className="primary" onClick={demoApprove} disabled={busy}>Simular aprovação</button>}
      {!pix.providerPaymentId.startsWith("demo_") && <p role="status" className="muted">{pix.status === "PENDING" ? "Aguardando confirmação do Pix. Seu saldo será atualizado após a confirmação." : "Pagamento não aprovado ou cancelado. Você pode gerar um novo Pix."}</p>}
      {["CANCELLED", "REJECTED"].includes(pix.status) && <button className="secondary" onClick={() => setPix(undefined)}>Gerar outro Pix</button>}
      {pix.ticketUrl && <a className="secondary" href={pix.ticketUrl} target="_blank" rel="noreferrer">Abrir pagamento</a>}
      {error && <p className="error">{error}</p>}
    </div>}
  </section></div>;
}

function DashboardPage({ onLogout, onCooldown }: { onLogout: () => void; onCooldown: (until: string) => void }) {
  const [data, setData] = useState<Dashboard>();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPix, setShowPix] = useState(false);
  const [notice, setNotice] = useState("");
  const [creationRound, setCreationRound] = useState<Round>();
  const [watchRound, setWatchRound] = useState<Round>();
  const returnedIntentHandled = useRef(false);
  const load = useCallback(async () => { try { setData(await api.dashboard()); setError(""); } catch (cause) { if (cause instanceof ApiError && cause.status === 423 && typeof cause.data.cooldownUntil === "string") onCooldown(cause.data.cooldownUntil); else if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) onLogout(); else setError(cause instanceof Error ? cause.message : "Falha ao carregar."); } }, [onLogout,onCooldown]);
  useEffect(() => { void load(); const timer = window.setInterval(load, 20_000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => { if (!Capacitor.isNativePlatform()) return; const listener = CapacitorApp.addListener("appUrlOpen", async ({ url }) => { if (url.startsWith("conexaoyoutube://oauth")) { await Browser.close(); await load(); } }); return () => { void listener.then((handle) => handle.remove()); }; }, [load]);

  useEffect(() => {
    if (!data || returnedIntentHandled.current) return;
    const params = new URLSearchParams(location.search); const roundId = params.get("round");
    if (params.get("youtube") !== "connected" || !roundId) return;
    let intent: { userId?: string; roundId?: string; at?: number } = {};
    try { intent = JSON.parse(sessionStorage.getItem("conexao_creation_intent") ?? "{}"); } catch { /* Invalid local intent is ignored. */ }
    returnedIntentHandled.current = true;
    if (intent.userId !== data.user.id || intent.roundId !== roundId || !intent.at || Date.now()-intent.at>600_000 || !data.readyRounds.some((r) => r.id === roundId)) return;
    sessionStorage.removeItem("conexao_creation_intent"); history.replaceState(null,"",location.pathname);
    void exportRound(roundId);
  }, [data]);
  useEffect(() => { if (!busy) return; const timer = setInterval(() => void load(), 2_000); return () => clearInterval(timer); }, [busy,load]);

  if (!data) return <div className="loading"><LoaderCircle className="spin" /><span>Carregando o quadro…</span>{error && <p className="error">{error}</p>}</div>;
  const filled = data.openRound.slots.filter((slot) => slot.youtubeUrl).length;
  const nextSlot = filled + 1;
  const hasPendingTask = data.readyRounds.length > 0;
  const eligible = !hasPendingTask && !data.wallet.paymentHold && (data.viewer.contributionsInOpenRound === 0 || data.wallet.extraPasses > 0);

  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await api.submit(url); setUrl(""); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao salvar."); } finally { setBusy(false); } }
  async function connectYoutube(roundId: string) { setBusy(true); try { const native = Capacitor.isNativePlatform(); const result = await api.youtubeConnect(native ? "app" : "web", roundId); if (native) await Browser.open({ url: result.url }); else window.location.href = result.url; } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao conectar."); } finally { setBusy(false); } }
  async function exportRound(id: string) { setCreationRound(data?.readyRounds.find((r) => r.id === id)); setBusy(true); setError(""); try { await api.exportRound(id); setCreationRound(undefined); setNotice("Playlist criada na sua conta YouTube com os 10 vídeos da fila."); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao criar a playlist."); } finally { setBusy(false); } }

  const included = creationRound ? data.readyRounds.find((r) => r.id === creationRound.id)?.export?.addedCount ?? 0 : 0;
  return <div className="app-shell">
    <header><div className="logo"><span><Youtube size={21} fill="currentColor" /></span>Conexão <strong>Youtube</strong></div><div className="header-actions"><button className="icon-button" onClick={() => void load()} title="Atualizar"><RefreshCw size={18} /></button><button className="profile" onClick={onLogout} aria-label={`Sair da conta de ${data.user.name}`}><span>{data.user.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><strong>{data.user.name}</strong><small>SOS {data.user.groupCode}</small></div><LogOut size={16} /></button></div></header>
    <main className="dashboard">
      {!hasPendingTask ? <>
        <section className="hero-row">
          <div><p className="eyebrow dark">QUADRO COMPARTILHADO · FILA {data.openRound.sequence}</p><h1>Vamos montar a próxima seleção?</h1><p className="muted">Cada vídeo entra uma vez. Ao completar 10 URLs válidas, a fila é preservada e a próxima é aberta automaticamente.</p></div>
          <aside className="wallet"><div><CircleDollarSign /><span>Seu saldo</span></div><strong>{data.wallet.total.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 })}</strong><small>moedas · {data.wallet.extraPasses} passe{data.wallet.extraPasses === 1 ? "" : "s"}</small><button onClick={() => setShowPix(true)}>Comprar moedas</button></aside>
        </section>
        <section className="progress-card"><div className="progress-copy"><strong>{filled} de 10 vídeos</strong><span>{10 - filled} espaços restantes</span></div><div className="progress-track"><i style={{ width: `${filled * 10}%` }} /></div></section>
        {!eligible && !data.wallet.paymentHold && <div className="notice"><LockKeyhole size={19} /><span>Você já participou desta fila. Aguarde os demais ou use um passe comprado para contribuir novamente.</span></div>}
        {data.wallet.paymentHold && <div className="notice" role="status"><ShieldCheck size={19} /><span>Carteira em revisão por atualização de um pagamento. Novas contribuições ficam suspensas até a conciliação.</span></div>}
        {notice && <div className="notice" role="status"><Check size={19} /><span>{notice}</span></div>}
        {error && <p className="error banner">{error}</p>}
        <section className="board">{data.openRound.slots.map((slot) => <SlotCard key={slot.slot} slot={slot} next={slot.slot === nextSlot} eligible={eligible && data.wallet.total >= 1} draft={url} onDraft={setUrl} onSubmit={submit} busy={busy} own={slot.userId === data.user.id} />)}</section>
      </> : <>
        <section className="hero-row task-hero">
          <div><p className="eyebrow dark">SUA TAREFA · FILA {data.readyRounds[0]?.sequence}</p><h1>Finalize esta fila antes da próxima.</h1><p className="muted">Como você contribuiu para esta seleção, ela permanece aqui até atingir 100% ou até você escolher concluir. Fechar o acompanhamento apenas pausa o processo.</p></div>
          <aside className="wallet"><div><CircleDollarSign /><span>Seu saldo</span></div><strong>{data.wallet.total.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 })}</strong><small>{data.wallet.reward.toLocaleString("pt-BR")} bônus por tarefas · {data.wallet.purchased.toLocaleString("pt-BR")} compradas</small></aside>
        </section>
        {notice && <div className="notice" role="status"><Check size={19} /><span>{notice}</span></div>}
        {error && <p className="error banner">{error}</p>}
      </>}
      {data.readyRounds.length > 0 && <section className="completed"><div className="section-title"><div><p className="eyebrow dark">FILA EM ANDAMENTO</p><h2>Sua seleção concluída</h2></div><span>Progresso persistente por conta</span></div>{data.readyRounds.map((round) => <ReadyRound key={round.id} round={round} userId={data.user.id} connected={data.viewer.youtubeConnected} busy={busy} onConnect={() => setCreationRound(round)} onExport={() => setCreationRound(round)} onWatch={() => setWatchRound(round)} onFinalize={() => setWatchRound(round)} />)}</section>}
      <footer><ShieldCheck size={17} /><span>As moedas são créditos internos do SOS YouTube para controlar contribuições. O saldo pode vir de créditos iniciais, compras ou bônus por tarefas e não possui valor de saque.</span></footer>
    </main>
    {creationRound && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Criação de playlist"><button className="close" aria-label="Cancelar criação" disabled={busy} onClick={() => setCreationRound(undefined)}>×</button><p className="eyebrow dark">FILA {creationRound.sequence} · 10 VÍDEOS</p><h2>Criar playlist na sua conta</h2><p className="muted">{data.viewer.youtubeConnected ? "Você autorizou o acesso ao YouTube. Ao confirmar, os dez links salvos serão incluídos em uma playlist privada na sua conta." : "Você será direcionado à autenticação oficial do Google/YouTube. Após autorizar, criaremos uma playlist privada com os dez links permanentes desta fila."}</p><p className="muted">Você pode cancelar. Os registros de autoria e links da fila continuam preservados.</p>{busy && data.viewer.youtubeConnected && <div role="status"><progress max={10} value={included} /><p>{included} de 10 vídeos incluídos · {Math.min(100,included*10)}% da criação</p></div>}{error && <p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy} onClick={() => { setError(""); if (data.viewer.youtubeConnected) void exportRound(creationRound.id); else { sessionStorage.setItem("conexao_creation_intent",JSON.stringify({userId:data.user.id,roundId:creationRound.id,at:Date.now()})); void connectYoutube(creationRound.id); } }}>{busy ? data.viewer.youtubeConnected ? "Criando…" : "Abrindo autenticação…" : data.viewer.youtubeConnected ? "Confirmar criação" : "Continuar para Google/YouTube"}</button></section></div>}
    {showPix && <PixPanel onClose={() => setShowPix(false)} onApproved={() => { setShowPix(false); setNotice("Pagamento confirmado: 20 moedas e 1 passe extra adicionados."); void load(); }} />}
    {watchRound?.export?.playlistId && <WatchProgress playlistId={watchRound.export.playlistId} roundId={watchRound.id} userId={data.user.id} initialProgress={watchRound.export.watchProgress} initialBalance={data.wallet.total} onClose={() => { setWatchRound(undefined); void load(); }} onFinalized={onCooldown} />}
  </div>;
}

export function App() {
  const [role, setRole] = useState<"user" | "owner" | undefined>(localStorage.getItem("conexao_owner_token") ? "owner" : localStorage.getItem("conexao_token") ? "user" : undefined);
  const logout = useCallback(() => { localStorage.removeItem("conexao_token"); localStorage.removeItem("conexao_owner_token"); setRole(undefined); }, []);
  const enterCooldown = useCallback((until: string) => {
    localStorage.removeItem("conexao_token");
    localStorage.removeItem("conexao_owner_token");
    localStorage.setItem(COOLDOWN_KEY,until);
    setRole(undefined);
  },[]);
  return role === "owner" ? <OwnerDashboard onLogout={logout} /> : role === "user" ? <DashboardPage onLogout={logout} onCooldown={enterCooldown} /> : <Login onDone={setRole} />;
}
