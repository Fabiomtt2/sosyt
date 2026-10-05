import { useCallback, useEffect, useState, useRef, type FormEvent } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Check, CircleDollarSign, Clock3, ExternalLink, Link2, LoaderCircle, LockKeyhole, LogOut, Plus, RefreshCw, ShieldCheck, Youtube } from "lucide-react";
import { OwnerDashboard } from "./OwnerDashboard";
import { api, ownerApi, participationApi, ApiError, type Dashboard, type Pix, type Round } from "./api";

function Login({ onDone }: { onDone: (role: "user" | "owner") => void }) {
  const [step, setStep] = useState<"profile" | "code">("profile");
  const [joinMode, setJoinMode] = useState(false);
  const [ownerSecret, setOwnerSecret] = useState("");
  const [consent, setConsent] = useState(false);
  const [joined, setJoined] = useState<{ message: string; whatsappUrl?: string }>();
  const [form, setForm] = useState({ name: "", phone: "", groupCode: "" });
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string>();
  const [whatsappJoinUrl,setWhatsAppJoinUrl] = useState<string>();
  useEffect(() => { void participationApi.groups().then((result) => setWhatsAppJoinUrl(result.whatsappJoinUrl)).catch(() => {}); },[]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (joinMode) {
        const result = await participationApi.join({ name: form.name, phone: form.phone, groupCode: form.groupCode || undefined, consent });
        setJoined(result);
      } else if (form.groupCode === "#") {
        const result = await ownerApi.login({ name: form.name, identifier: form.phone, groupCode: "#", secret: ownerSecret });
        localStorage.removeItem("conexao_token"); localStorage.setItem("conexao_owner_token", result.token); onDone("owner");
      } else if (step === "profile") {
        const result = await api.requestCode(form);
        setDevCode(result.devCode); setStep("code");
      } else {
        const result = await api.verifyCode({ phone: form.phone, code });
        localStorage.removeItem("conexao_owner_token"); localStorage.setItem("conexao_token", result.token); onDone("user");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha no login."); }
    finally { setBusy(false); }
  }

  return <main className="login-shell">
    <section className="brand-panel">
      <div className="brand-mark"><Youtube size={34} fill="currentColor" /></div>
      <p className="eyebrow">SOS YOUTUBER</p>
      <h1>Uma playlist.<br />Dez vozes.</h1>
      <p className="lead">Organize a curadoria do seu grupo e leve a seleção para a sua própria conta do YouTube — sempre por escolha sua.</p>
      <div className="trust"><ShieldCheck size={20} /><span>Sem views automáticas. Sem reprodução oculta. Você mantém o controle.</span></div>
    </section>
    <section className="login-card">
      <div>
        <p className="eyebrow dark">ACESSO DO PARTICIPANTE</p>
        <h2>{step === "profile" ? joinMode ? "Quero participar!" : "Entre na sua conexão" : "Confirme seu número"}</h2>
        <p className="muted">{step === "profile" ? joinMode ? "Peça ao Owner sua entrada em um grupo SOS YOUTUBER e a liberação do aplicativo." : "Participantes entram com o grupo aprovado. Fábio e Rafael entram com # e sua credencial exclusiva." : devCode ? "Use o código de demonstração exibido abaixo. Não houve envio pelo WhatsApp." : `Digite o código enviado para ${form.phone}.`}</p>
      </div>
      {joined ? <div className="join-success" role="status"><ShieldCheck size={30} /><p>{joined.message}</p>{joined.whatsappUrl && <a className="primary" href={joined.whatsappUrl} target="_blank" rel="noreferrer">Abrir WhatsApp do Owner</a>}<p className="muted">A solicitação já está no painel. No WhatsApp, confirme o envio da mensagem.</p><button className="secondary" onClick={() => { setJoined(undefined); setJoinMode(false); }}>Voltar ao login</button></div> : <form onSubmit={submit}>
        {step === "profile" ? <>
          <label>Seu nome ou como prefere ser chamado<input autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Como você será identificado" required /></label>
          <label>{!joinMode && form.groupCode === "#" ? "WhatsApp ou ID do Owner" : "Número do WhatsApp"}<input inputMode={!joinMode && form.groupCode === "#" ? "text" : "tel"} autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="DDI + DDD + número" required /></label>
          <label>Grupo SOS YOUTUBER<input inputMode="text" maxLength={8} pattern={joinMode ? "[1-9][0-9]*" : "#|[1-9][0-9]*"} value={form.groupCode} onChange={(e) => setForm({ ...form, groupCode: e.target.value.replace(joinMode ? /[^0-9]/g : /[^0-9#]/g, "") })} placeholder={joinMode ? "Opcional: grupo desejado" : "Número do grupo; # para Owner"} required={!joinMode} /></label>
          {!joinMode && form.groupCode === "#" && <label>Credencial do Owner<input type="password" autoComplete="current-password" value={ownerSecret} onChange={(e) => setOwnerSecret(e.target.value)} required /></label>}
          {joinMode && <label className="consent-row"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required /><span>Autorizo o Owner a usar meu nome e número para analisar esta solicitação e entrar em contato sobre o grupo.</span></label>}
        </> : <>
          {devCode && <div className="dev-code">Código de desenvolvimento: <strong>{devCode}</strong></div>}
          <label>Código de 6 dígitos<input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" required /></label>
        </>}
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : joinMode ? "Solicitar participação" : step === "profile" ? form.groupCode === "#" ? "Entrar como Owner" : "Receber código" : "Entrar no quadro"}</button>
      </form>}
      {step === "profile" && !joined && whatsappJoinUrl && <a className="secondary" href={whatsappJoinUrl} target="_blank" rel="noreferrer">Quero participar pelo WhatsApp</a>}
      {step === "profile" && !joined && <button className="text-button" onClick={() => { setJoinMode(!joinMode); setError(""); setForm({ ...form, groupCode: form.groupCode === "#" ? "" : form.groupCode }); }}>{joinMode ? "Já participo — voltar ao login" : "Quero participar!"}</button>}
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

function ReadyRound({ round, userId, connected, onConnect, onExport, busy }: { round: Round; userId: string; connected: boolean; onConnect: () => void; onExport: () => void; busy: boolean }) {
  const success = round.export?.status === "SUCCESS";
  return <article className="ready-card">
    <div className="ready-icon"><Check /></div>
    <div><p className="eyebrow dark">CICLO {round.sequence} COMPLETO</p><h3>10 vídeos prontos para sua playlist</h3><p className="muted">A playlist será criada como privada. Você decide no YouTube se e quando deseja alterar a visibilidade.</p></div>
    {round.export && <p className="creation-progress" role="status">{round.export.status === "SUCCESS" ? "Playlist criada · 10 de 10 vídeos incluídos" : `${round.export.addedCount ?? 0} de 10 vídeos incluídos · ${Math.min(100,(round.export.addedCount ?? 0)*10)}% da criação${round.export.status === "FAILED" ? " · tentativa interrompida; você pode retomar" : ""}`}</p>}
    <details className="cycle-details"><summary>Ver os 10 vídeos, autores e horários</summary><section className="board">{round.slots.map((slot) => <SlotCard key={slot.slot} slot={slot} next={false} eligible={false} own={slot.userId === userId} completed exported={success} connected={connected} onConnect={onConnect} onExport={onExport} busy={busy} />)}</section></details>
    {success ? <a className="secondary" href={`https://www.youtube.com/playlist?list=${round.export?.playlistId}`} target="_blank" rel="noreferrer">Abrir no YouTube <ExternalLink size={16} /></a>
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
    <p className="eyebrow dark">PACOTE ÚNICO</p><h2>20 créditos + 1 passe extra</h2><div className="price"><span>R$</span>20<small>,00</small></div>
    <p className="muted">1 crédito custa R$ 1,00 na compra. O passe permite ocupar mais uma posição no mesmo ciclo. Créditos ganhos naturalmente nunca geram passes.</p>
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

function DashboardPage({ onLogout }: { onLogout: () => void }) {
  const [data, setData] = useState<Dashboard>();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPix, setShowPix] = useState(false);
  const [notice, setNotice] = useState("");
  const [creationRound, setCreationRound] = useState<Round>();
  const returnedIntentHandled = useRef(false);
  const load = useCallback(async () => { try { setData(await api.dashboard()); setError(""); } catch (cause) { if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) onLogout(); else setError(cause instanceof Error ? cause.message : "Falha ao carregar."); } }, [onLogout]);
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
  const eligible = !data.wallet.paymentHold && (data.viewer.contributionsInOpenRound === 0 || data.wallet.extraPasses > 0);

  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await api.submit(url); setUrl(""); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao salvar."); } finally { setBusy(false); } }
  async function connectYoutube(roundId: string) { setBusy(true); try { const native = Capacitor.isNativePlatform(); const result = await api.youtubeConnect(native ? "app" : "web", roundId); if (native) await Browser.open({ url: result.url }); else window.location.href = result.url; } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao conectar."); } finally { setBusy(false); } }
  async function exportRound(id: string) { setCreationRound(data?.readyRounds.find((r) => r.id === id)); setBusy(true); setError(""); try { await api.exportRound(id); setCreationRound(undefined); setNotice("Playlist criada na sua conta YouTube com os 10 vídeos do ciclo."); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao criar a playlist."); } finally { setBusy(false); } }

  const included = creationRound ? data.readyRounds.find((r) => r.id === creationRound.id)?.export?.addedCount ?? 0 : 0;
  return <div className="app-shell">
    <header><div className="logo"><span><Youtube size={21} fill="currentColor" /></span>Conexão <strong>Youtube</strong></div><div className="header-actions"><button className="icon-button" onClick={() => void load()} title="Atualizar"><RefreshCw size={18} /></button><button className="profile" onClick={onLogout} aria-label={`Sair da conta de ${data.user.name}`}><span>{data.user.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><strong>{data.user.name}</strong><small>SOS {data.user.groupCode}</small></div><LogOut size={16} /></button></div></header>
    <main className="dashboard">
      <section className="hero-row">
        <div><p className="eyebrow dark">QUADRO COMPARTILHADO · CICLO {data.openRound.sequence}</p><h1>Vamos montar a próxima seleção?</h1><p className="muted">Cada vídeo entra uma vez. Quando chegarmos a 10, os participantes poderão criar a seleção na própria conta.</p></div>
        <aside className="wallet"><div><CircleDollarSign /><span>Seu saldo</span></div><strong>{data.wallet.total.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 })}</strong><small>créditos · {data.wallet.extraPasses} passe{data.wallet.extraPasses === 1 ? "" : "s"}</small><button onClick={() => setShowPix(true)}>Comprar créditos</button></aside>
      </section>
      <section className="progress-card"><div className="progress-copy"><strong>{filled} de 10 vídeos</strong><span>{10 - filled} espaços restantes</span></div><div className="progress-track"><i style={{ width: `${filled * 10}%` }} /></div></section>

      {!eligible && !data.wallet.paymentHold && <div className="notice"><LockKeyhole size={19} /><span>Você já participou deste ciclo. Aguarde os demais ou use um passe comprado para contribuir novamente.</span></div>}
      {data.wallet.paymentHold && <div className="notice" role="status"><ShieldCheck size={19} /><span>Carteira em revisão por atualização de um pagamento. Novas contribuições ficam suspensas até a conciliação.</span></div>}
      {notice && <div className="notice" role="status"><Check size={19} /><span>{notice}</span></div>}
      {error && <p className="error banner">{error}</p>}
      <section className="board">{data.openRound.slots.map((slot) => <SlotCard key={slot.slot} slot={slot} next={slot.slot === nextSlot} eligible={eligible && data.wallet.total >= 1} draft={url} onDraft={setUrl} onSubmit={submit} busy={busy} own={slot.userId === data.user.id} />)}</section>
      {data.readyRounds.length > 0 && <section className="completed"><div className="section-title"><div><p className="eyebrow dark">SUAS SELEÇÕES</p><h2>Ciclos prontos</h2></div><span>Exportação voluntária e privada</span></div>{data.readyRounds.map((round) => <ReadyRound key={round.id} round={round} userId={data.user.id} connected={data.viewer.youtubeConnected} busy={busy} onConnect={() => setCreationRound(round)} onExport={() => setCreationRound(round)} />)}</section>}
      <footer><ShieldCheck size={17} /><span>O Conexão Youtube não compra, troca ou recompensa visualizações. A reprodução acontece sob controle do usuário no YouTube.</span></footer>
    </main>
    {creationRound && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Criação de playlist"><button className="close" aria-label="Cancelar criação" disabled={busy} onClick={() => setCreationRound(undefined)}>×</button><p className="eyebrow dark">CICLO {creationRound.sequence} · 10 VÍDEOS</p><h2>Criar playlist na sua conta</h2><p className="muted">{data.viewer.youtubeConnected ? "Você autorizou o acesso ao YouTube. Ao confirmar, os dez links salvos serão incluídos em uma playlist privada na sua conta." : "Você será direcionado à autenticação oficial do Google/YouTube. Após autorizar, criaremos uma playlist privada com os dez links permanentes deste ciclo."}</p><p className="muted">Você pode cancelar. Os registros de autoria e links do ciclo continuam preservados.</p>{busy && data.viewer.youtubeConnected && <div role="status"><progress max={10} value={included} /><p>{included} de 10 vídeos incluídos · {Math.min(100,included*10)}% da criação</p></div>}{error && <p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy} onClick={() => { setError(""); if (data.viewer.youtubeConnected) void exportRound(creationRound.id); else { sessionStorage.setItem("conexao_creation_intent",JSON.stringify({userId:data.user.id,roundId:creationRound.id,at:Date.now()})); void connectYoutube(creationRound.id); } }}>{busy ? data.viewer.youtubeConnected ? "Criando…" : "Abrindo autenticação…" : data.viewer.youtubeConnected ? "Confirmar criação" : "Continuar para Google/YouTube"}</button></section></div>}
    {showPix && <PixPanel onClose={() => setShowPix(false)} onApproved={() => { setShowPix(false); setNotice("Pagamento confirmado: 20 créditos e 1 passe extra adicionados."); void load(); }} />}
  </div>;
}

export function App() {
  const [role, setRole] = useState<"user" | "owner" | undefined>(localStorage.getItem("conexao_owner_token") ? "owner" : localStorage.getItem("conexao_token") ? "user" : undefined);
  const logout = useCallback(() => { localStorage.removeItem("conexao_token"); localStorage.removeItem("conexao_owner_token"); setRole(undefined); }, []);
  return role === "owner" ? <OwnerDashboard onLogout={logout} /> : role === "user" ? <DashboardPage onLogout={logout} /> : <Login onDone={setRole} />;
}
