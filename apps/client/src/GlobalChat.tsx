import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessagesSquare, Send, Pin, PinOff, Trash2, ShieldAlert, VolumeX, UserX, X, ChevronDown, ChevronUp, Mail } from "lucide-react";
import { api, type ChatMessage, type ChatRole, type ChatSender } from "./api";
import { UserAvatarView, AvatarLightbox } from "./AvatarModal";
import { SuperBadge } from "./SuperPanel";

const POLL_MS = 5000;
const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

// AUDITORIA / chat global: canal único translúcido, sempre visível. Texto é
// renderizado como TEXTO (React escapa); nunca dangerouslySetInnerHTML. Fontes
// distintas: nome em Manrope, mensagem em DM Sans. Admin/Owner ganham faixa dourada.
export function GlobalChat({ onOpenProfile,onOpenInbox,currentUserId,subscriptionActive }: { onOpenProfile?: (userId: string) => void; onOpenInbox:()=>void; currentUserId:string;subscriptionActive?:boolean }) {
  const [open, setOpen] = useState(()=>sessionStorage.getItem("sos-chat-open")!=="false");
  const [unread,setUnread]=useState(0);
  const toggle=()=>setOpen(value=>{sessionStorage.setItem("sos-chat-open",String(!value));return !value;});
  const [connected,setConnected]=useState(false);
  const syncingRef=useRef(false);
  const [state, setState] = useState<{ messages: ChatMessage[]; pinned: ChatMessage[]; removed: boolean; viewerRole: ChatRole; cooldownSeconds: number }>(
    { messages: [], pinned: [], removed: false, viewerRole: "USER", cooldownSeconds: 180 }
  );
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [zoom, setZoom] = useState<ChatSender | null>(null);   // avatar ampliado
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const isStaff = state.viewerRole === "ADMIN" || state.viewerRole === "OWNER";

  const sync = useCallback(async () => {
    if(syncingRef.current)return;
    syncingRef.current=true;
    try {
      // Snapshot limitado: reconcilia avatar, assinatura, edição e moderação.
      const data = await api.chatList();
      setConnected(true);
      if(data.cooldownSeconds===0||data.viewerRole==="ADMIN"||data.viewerRole==="OWNER")setCooldownLeft(0);
      setState((prev) => {
        if (data.removed) return { ...prev, removed: true, messages: [], pinned: [], viewerRole: data.viewerRole };
        const merged = data.messages;
        const trimmed = merged.slice(-200);
        return { messages: trimmed, pinned: data.pinned, removed: false, viewerRole: data.viewerRole, cooldownSeconds: data.cooldownSeconds };
      });
    } catch { setConnected(false); }
    finally { syncingRef.current=false; }
  }, []);

  useEffect(()=>{void sync();},[subscriptionActive,sync]);
  useEffect(()=>{let active=true;const update=()=>void api.mailUnread().then(data=>{if(active)setUnread(data.unread);}).catch(()=>{});update();const timer=setInterval(update,10000);return()=>{active=false;clearInterval(timer);};},[]);
  useEffect(() => { void sync(); const t = window.setInterval(() => void sync(), POLL_MS); return () => window.clearInterval(t); }, [sync]);
  useEffect(() => { if (cooldownLeft <= 0) return; const t = window.setInterval(() => setCooldownLeft((s) => Math.max(0, s - 1)), 1000); return () => window.clearInterval(t); }, [cooldownLeft]);
  useEffect(() => { if (atBottomRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [state.messages, open]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true); setError("");
    try {
      const sent=await api.chatSend(body);
      setDraft("");
      setCooldownLeft(sent.role==="USER"?state.cooldownSeconds:0);
      await sync();
    } catch (cause) {
      const e = cause as { message?: string; code?: string; retryAfterSeconds?: number };
      if (e.code === "CHAT_COOLDOWN" && e.retryAfterSeconds) setCooldownLeft(e.retryAfterSeconds);
      setError(e.message ?? "Não foi possível enviar.");
    } finally { setBusy(false); }
  }

  async function moderate(fn: () => Promise<unknown>) { try { await fn(); setError(""); await sync(); } catch(cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir a moderação."); } }

  if (state.removed) {
    return (
      <aside className="global-chat removed" aria-label="Chat da comunidade">
        <div className="gc-removed"><ShieldAlert size={18} /><span>Você não está no chat da comunidade no momento.</span></div>
      </aside>
    );
  }

  return (
    <aside className={"global-chat" + (open ? " open" : " closed")} aria-label="Chat global da comunidade">
      <div className="gc-head">
        <div><span className="gc-title"><MessagesSquare size={20}/> Sala da comunidade</span><span className="gc-subtitle">Uma conversa entre todos os grupos</span></div>
        <button className="gc-toggle" type="button" aria-label={open?"Recolher sala da comunidade":"Expandir sala da comunidade"} onClick={toggle} aria-expanded={open}>{open?<ChevronDown size={18}/>:<ChevronUp size={18}/>}</button>
      </div>
      {open&&<div className="gc-room-bar"><span className={"gc-live"+(connected?"":" offline")} role="status">{connected?"Conversa atualizada":"Reconectando…"}</span><button type="button" onClick={onOpenInbox}><Mail size={15}/> Privadas{unread>0&&<b aria-label={unread+" mensagens não lidas"}>{unread>99?"99+":unread}</b>}</button></div>}

      {open && <>
        {state.pinned.length > 0 && (
          <div className="gc-pinned">
            {state.pinned.map((m) => (
              <div key={m.id} className="gc-pinned-item"><Pin size={12} /><b className="gc-name">{m.sender.name}</b><span className="gc-text">{m.body}</span></div>
            ))}
          </div>
        )}

        <div className="gc-stream" role="log" aria-label="Mensagens da comunidade" aria-live="polite" aria-relevant="additions text" ref={scrollRef} onScroll={(e) => { const el = e.currentTarget; atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
          {state.messages.length === 0 && <div className="gc-empty"><img src={import.meta.env.BASE_URL+"assets/user/messages-editorial-v3.webp"} alt=""/><strong>Uma boa conversa começa com um olá.</strong><p>Apresente seu projeto e conheça quem cria com você.</p></div>}
          {state.messages.map((m) => {
            const staff = m.role === "ADMIN" || m.role === "OWNER";
            const isSuper = m.role === "SUPER" && (!m.sender.presentation?.superExpiresAt || Date.parse(m.sender.presentation.superExpiresAt)>Date.now());
            return (
              <div key={m.id} className={"gc-msg" + (staff ? " gc-msg-staff" : isSuper ? " gc-msg-super" : "") + (m.pinned ? " gc-msg-pinned" : "")+(m.sender.id===currentUserId?" gc-msg-mine":"")}>
                <button type="button" className={"gc-avatar-btn" + (staff ? " has-admin-badge" : isSuper ? " has-super-ring" : "")} onClick={() => setZoom(m.sender)} aria-label={"Ver " + m.sender.name} title={"Ver " + m.sender.name}>
                  <UserAvatarView avatar={m.sender.avatar ?? undefined} name={m.sender.name} presentation={m.sender.presentation} className="gc-avatar" />
                  {staff && <b className="admin-badge gc-admin-badge">ADMIN</b>}
                  {isSuper && <span className="gc-admin-badge"><SuperBadge small /></span>}
                </button>
                <div className="gc-bubble">
                  <div className="gc-meta">
                    <b className="gc-name">{m.sender.name}</b>
                    {staff ? <span className="gc-role-tag">ADMIN</span>
                      : isSuper ? <span className="gc-role-tag super">SUPER</span>
                      : m.sender.groupCode && m.sender.groupCode!=="#" ? <span className="gc-group">SOS {m.sender.groupCode}</span> : null}
                    <time className="gc-time">{time(m.createdAt)}</time>
                  </div>
                  {staff
                    ? <div className="gc-admin-banner"><span className="gc-text gc-text-admin">{m.body}</span></div>
                    : isSuper ? <span className="gc-super-text">{m.body}</span>
                    : <span className="gc-text">{m.body}</span>}
                  {isStaff && (
                    <div className="gc-mod">
                      <button type="button" title={m.pinned ? "Desafixar" : "Fixar"} onClick={() => void moderate(() => api.chatPin(m.id, !m.pinned))}>{m.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
                      <button type="button" title="Apagar" onClick={() => void moderate(() => api.chatDelete(m.id))}><Trash2 size={13} /></button>
                      {m.role === "USER" && <>
                        <button type="button" title="Silenciar 10 min" onClick={() => void moderate(() => api.chatModerate(m.sender.id, "MUTE", { minutes: 10 }))}><VolumeX size={13} /></button>
                        <button type="button" title="Remover da sala" onClick={() => void moderate(() => api.chatModerate(m.sender.id, "REMOVE"))}><UserX size={13} /></button>
                      </>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {isStaff && (
          <div className="gc-admin-tools">
            <button type="button" onClick={() => { if (confirm("Limpar TODO o chat global? Isso oculta todas as mensagens atuais.")) void moderate(() => api.chatClear()); }}><Trash2 size={13} /> Limpar chat</button>
          </div>
        )}

        <form className="gc-input" onSubmit={send}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={500}
            placeholder={cooldownLeft > 0 ? `Aguarde ${cooldownLeft}s…` : isStaff ? "Mensagem da administração…" : "Escreva no chat (sem links)…"}
            disabled={busy || cooldownLeft > 0}
            aria-label="Mensagem para o chat global"
          />
          <button className="gc-send" disabled={busy || cooldownLeft > 0 || !draft.trim()} aria-label="Enviar mensagem à comunidade"><Send size={18} /></button>
        </form>
        {error && <p className="gc-error" role="alert"><X size={13} /> {error}</p>}
        {!isStaff && <small className="gc-note">Respeito sempre · sem links · {state.cooldownSeconds===0?"SUPER: mensagens sem espera":"1 mensagem a cada "+Math.ceil(state.cooldownSeconds/60)+" min"}</small>}
      </>}
      {zoom && createPortal(
        <AvatarLightbox
          avatar={zoom.avatar ?? undefined} presentation={zoom.presentation}
          name={zoom.name}
          subtitle={zoom.groupCode === "#" ? "Participação administrativa" : zoom.groupCode ? `SOS YOUTUBER ${zoom.groupCode}` : undefined}
          onClose={() => setZoom(null)}
          actions={onOpenProfile ? <button type="button" onClick={() => { const id = zoom.id; setZoom(null); onOpenProfile(id); }}>Abrir conversa</button> : undefined}
        />,document.body
      )}
    </aside>
  );
}
