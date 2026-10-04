import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Check, CircleDollarSign, Clock3, ExternalLink, Link2, LoaderCircle, LockKeyhole, LogOut, Plus, RefreshCw, ShieldCheck, Youtube } from "lucide-react";
import { api, ApiError, type Dashboard, type Pix, type Round } from "./api";

function Login({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<"profile" | "code">("profile");
  const [form, setForm] = useState({ name: "", phone: "", groupCode: "" });
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (step === "profile") {
        const result = await api.requestCode(form);
        setDevCode(result.devCode); setStep("code");
      } else {
        const result = await api.verifyCode({ phone: form.phone, code });
        localStorage.setItem("conexao_token", result.token); onDone();
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
        <h2>{step === "profile" ? "Entre na sua conexão" : "Confirme seu número"}</h2>
        <p className="muted">{step === "profile" ? "Os dados identificam sua contribuição no quadro compartilhado." : `Digite o código enviado para ${form.phone}.`}</p>
      </div>
      <form onSubmit={submit}>
        {step === "profile" ? <>
          <label>Nome completo<input autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Como você será identificado" required /></label>
          <label>Número do WhatsApp<input inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="DDD + número" required /></label>
          <label>Grupo SOS YOUTUBER<input inputMode="numeric" pattern="[1-9]+" value={form.groupCode} onChange={(e) => setForm({ ...form, groupCode: e.target.value.replace(/[^1-9]/g, "") })} placeholder="Somente números de 1 a 9" required /></label>
        </> : <>
          {devCode && <div className="dev-code">Código de desenvolvimento: <strong>{devCode}</strong></div>}
          <label>Código de 6 dígitos<input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" required /></label>
        </>}
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : step === "profile" ? "Receber código" : "Entrar no quadro"}</button>
      </form>
    </section>
  </main>;
}

function SlotCard({ slot, next, eligible }: { slot: Round["slots"][number]; next: boolean; eligible: boolean }) {
  if (slot.youtubeUrl) return <article className="slot filled">
    <div className="slot-number">{String(slot.slot).padStart(2, "0")}</div>
    <div className="slot-main">
      <div className="video-thumb"><Youtube size={28} fill="currentColor" /></div>
      <div><strong>{slot.userName}</strong><span>SOS YOUTUBER {slot.groupCode}</span><small><Clock3 size={13} /> {new Date(slot.createdAt!).toLocaleString("pt-BR")}</small></div>
    </div>
    <a href={slot.youtubeUrl} target="_blank" rel="noreferrer" aria-label="Abrir vídeo"><ExternalLink size={18} /></a>
  </article>;
  return <article className={`slot ${next && eligible ? "next" : "empty"}`}>
    <div className="slot-number">{String(slot.slot).padStart(2, "0")}</div>
    <div className="slot-main">{next && eligible ? <><Plus size={22} /><div><strong>Próxima contribuição</strong><span>Este espaço está disponível agora.</span></div></> : <><LockKeyhole size={19} /><div><strong>Aguardando</strong><span>{next ? "É necessário um passe extra." : "Libera após o espaço anterior."}</span></div></>}</div>
  </article>;
}

function ReadyRound({ round, connected, onConnect, onExport, busy }: { round: Round; connected: boolean; onConnect: () => void; onExport: () => void; busy: boolean }) {
  const success = round.export?.status === "SUCCESS";
  return <article className="ready-card">
    <div className="ready-icon"><Check /></div>
    <div><p className="eyebrow dark">CICLO {round.sequence} COMPLETO</p><h3>10 vídeos prontos para sua playlist</h3><p className="muted">A playlist será criada como privada. Você decide no YouTube se e quando deseja alterar a visibilidade.</p></div>
    {success ? <a className="secondary" href={`https://www.youtube.com/playlist?list=${round.export?.playlistId}`} target="_blank" rel="noreferrer">Abrir no YouTube <ExternalLink size={16} /></a>
      : <button className="primary compact" onClick={connected ? onExport : onConnect} disabled={busy}>{busy ? <LoaderCircle className="spin" /> : connected ? "Criar minha playlist" : "Conectar YouTube"}</button>}
  </article>;
}

function PixPanel({ onClose, onApproved }: { onClose: () => void; onApproved: () => void }) {
  const [form, setForm] = useState({ email: "", cpf: "" });
  const [pix, setPix] = useState<Pix>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { setPix(await api.createPix(form.email, form.cpf)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao gerar o Pix."); }
    finally { setBusy(false); }
  }
  async function demoApprove() { if (!pix) return; setBusy(true); try { await api.approveDemoPix(pix.id); onApproved(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha na aprovação."); } finally { setBusy(false); } }
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal" onMouseDown={(e) => e.stopPropagation()}>
    <button className="close" onClick={onClose}>×</button>
    <p className="eyebrow dark">PACOTE ÚNICO</p><h2>20 créditos + 1 passe extra</h2><div className="price"><span>R$</span>20<small>,00</small></div>
    <p className="muted">O passe permite ocupar mais uma posição no mesmo ciclo. Créditos ganhos naturalmente nunca geram passes.</p>
    {!pix ? <form onSubmit={create}>
      <label>E-mail do pagador<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
      <label>CPF do pagador<input inputMode="numeric" value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value.replace(/\D/g, "").slice(0, 11) })} required /></label>
      {error && <p className="error">{error}</p>}<button className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : "Gerar Pix"}</button>
    </form> : <div className="pix-result">
      {pix.qrCodeBase64 && <img src={`data:image/png;base64,${pix.qrCodeBase64}`} alt="QR Code Pix" />}
      {pix.qrCode && <><p className="muted">Pix copia e cola</p><textarea readOnly value={pix.qrCode} /></>}
      {!pix.qrCode && <div className="demo-code"><CircleDollarSign /><strong>Pagamento de demonstração</strong><span>Nenhum dinheiro será movimentado.</span></div>}
      {!pix.qrCode && <button className="primary" onClick={demoApprove} disabled={busy}>Simular aprovação</button>}
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
  const load = useCallback(async () => { try { setData(await api.dashboard()); setError(""); } catch (cause) { if (cause instanceof ApiError && cause.message.includes("Sessão")) onLogout(); else setError(cause instanceof Error ? cause.message : "Falha ao carregar."); } }, [onLogout]);
  useEffect(() => { void load(); const timer = window.setInterval(load, 20_000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => { if (!Capacitor.isNativePlatform()) return; const listener = CapacitorApp.addListener("appUrlOpen", async ({ url }) => { if (url.startsWith("conexaoyoutube://oauth")) { await Browser.close(); await load(); } }); return () => { void listener.then((handle) => handle.remove()); }; }, [load]);

  if (!data) return <div className="loading"><LoaderCircle className="spin" /><span>Carregando o quadro…</span>{error && <p className="error">{error}</p>}</div>;
  const filled = data.openRound.slots.filter((slot) => slot.youtubeUrl).length;
  const nextSlot = filled + 1;
  const eligible = data.viewer.contributionsInOpenRound === 0 || data.wallet.extraPasses > 0;

  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await api.submit(url); setUrl(""); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao salvar."); } finally { setBusy(false); } }
  async function connectYoutube() { setBusy(true); try { const native = Capacitor.isNativePlatform(); const result = await api.youtubeConnect(native ? "app" : "web"); if (native) await Browser.open({ url: result.url }); else window.location.href = result.url; } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao conectar."); } finally { setBusy(false); } }
  async function exportRound(id: string) { setBusy(true); setError(""); try { await api.exportRound(id); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao criar a playlist."); } finally { setBusy(false); } }

  return <div className="app-shell">
    <header><div className="logo"><span><Youtube size={21} fill="currentColor" /></span>Conexão <strong>Youtube</strong></div><div className="header-actions"><button className="icon-button" onClick={() => void load()} title="Atualizar"><RefreshCw size={18} /></button><button className="profile" onClick={onLogout}><span>{data.user.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><strong>{data.user.name}</strong><small>SOS {data.user.groupCode}</small></div><LogOut size={16} /></button></div></header>
    <main className="dashboard">
      <section className="hero-row">
        <div><p className="eyebrow dark">QUADRO COMPARTILHADO · CICLO {data.openRound.sequence}</p><h1>Vamos montar a próxima seleção?</h1><p className="muted">Cada vídeo entra uma vez. Quando chegarmos a 10, os participantes poderão criar a seleção na própria conta.</p></div>
        <aside className="wallet"><div><CircleDollarSign /><span>Seu saldo</span></div><strong>{data.wallet.total.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 })}</strong><small>créditos · {data.wallet.extraPasses} passe{data.wallet.extraPasses === 1 ? "" : "s"}</small><button onClick={() => setShowPix(true)}>Comprar créditos</button></aside>
      </section>
      <section className="progress-card"><div className="progress-copy"><strong>{filled} de 10 vídeos</strong><span>{10 - filled} espaços restantes</span></div><div className="progress-track"><i style={{ width: `${filled * 10}%` }} /></div></section>
      {eligible && nextSlot <= 10 && <form className="submit-bar" onSubmit={submit}><div><Link2 size={20} /><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Cole a URL do seu vídeo no YouTube" required /></div><button className="primary compact" disabled={busy || data.wallet.total < 1}>{busy ? <LoaderCircle className="spin" /> : `Salvar no espaço ${nextSlot}`}</button></form>}
      {!eligible && <div className="notice"><LockKeyhole size={19} /><span>Você já participou deste ciclo. Aguarde os demais ou use um passe comprado para contribuir novamente.</span></div>}
      {error && <p className="error banner">{error}</p>}
      <section className="board">{data.openRound.slots.map((slot) => <SlotCard key={slot.slot} slot={slot} next={slot.slot === nextSlot} eligible={eligible} />)}</section>
      {data.readyRounds.length > 0 && <section className="completed"><div className="section-title"><div><p className="eyebrow dark">SUAS SELEÇÕES</p><h2>Ciclos prontos</h2></div><span>Exportação voluntária e privada</span></div>{data.readyRounds.map((round) => <ReadyRound key={round.id} round={round} connected={data.viewer.youtubeConnected} busy={busy} onConnect={connectYoutube} onExport={() => void exportRound(round.id)} />)}</section>}
      <footer><ShieldCheck size={17} /><span>O Conexão Youtube não compra, troca ou recompensa visualizações. A reprodução acontece sob controle do usuário no YouTube.</span></footer>
    </main>
    {showPix && <PixPanel onClose={() => setShowPix(false)} onApproved={() => { setShowPix(false); void load(); }} />}
  </div>;
}

export function App() {
  const [authenticated, setAuthenticated] = useState(Boolean(localStorage.getItem("conexao_token")));
  const logout = useCallback(() => { localStorage.removeItem("conexao_token"); setAuthenticated(false); }, []);
  return authenticated ? <DashboardPage onLogout={logout} /> : <Login onDone={() => setAuthenticated(true)} />;
}

