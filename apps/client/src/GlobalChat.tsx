import { LevelBadge } from "./GamificationPanel";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessagesSquare, Send, Pin, PinOff, Trash2, ShieldAlert, VolumeX, UserX, X, ChevronDown, ChevronUp, Mail, SlidersHorizontal, MoreHorizontal } from "lucide-react";
import { api, type ChatMessage, type ChatRole, type ChatSender } from "./api";
import { UserAvatarView, AvatarLightbox, AvatarModal } from "./AvatarModal";
import { SuperBadge } from "./SuperPanel";
import { useCommunityUnread } from "./CommunityLauncher";
import "./global-room.css";

const POLL_MS = 5000;
const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

// AUDITORIA / chat global: canal único translúcido, sempre visível. Texto é
// renderizado como TEXTO (React escapa); nunca dangerouslySetInnerHTML. Fontes
// distintas: nome em Manrope, mensagem em DM Sans. Admin/Owner ganham faixa dourada.
export function GlobalChat({ onOpenProfile,onOpenInbox,currentUserId,subscriptionActive }: { onOpenProfile?: (userId: string) => void; onOpenInbox:()=>void; currentUserId:string;subscriptionActive?:boolean }) {
  const [open, setOpen] = useState(()=>sessionStorage.getItem("sos-chat-open")!=="false");
  const {total:unread}=useCommunityUnread();
  const toggle=()=>setOpen(value=>{sessionStorage.setItem("sos-chat-open",String(!value));return !value;});
  const [connected,setConnected]=useState(false);
  const syncingRef=useRef(false);
  const [state, setState] = useState<{ messages: ChatMessage[]; pinned: ChatMessage[]; removed: boolean; viewerRole: ChatRole; cooldownSeconds: number }>(
    { messages: [], pinned: [], removed: false, viewerRole: "USER", cooldownSeconds: 30 }
  );
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [adminTools, setAdminTools] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [zoom, setZoom] = useState<ChatSender | null>(null);
  const [selfPicker,setSelfPicker]=useState<ChatSender>();   // avatar ampliado
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
  useEffect(()=>{const refresh=()=>void sync();window.addEventListener("sos-community-updated",refresh);return()=>window.removeEventListener("sos-community-updated",refresh);},[sync]);

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
        <div><span className="gc-title"><MessagesSquare size={20}/> Sala da comunidade</span><span className="gc-subtitle">Todos os grupos, uma comunidade.</span></div>
        <button className="gc-toggle" type="button" aria-label={open?"Recolher sala da comunidade":"Expandir sala da comunidade"} onClick={toggle} aria-expanded={open}>{open?<ChevronDown size={18}/>:<ChevronUp size={18}/>}</button>
      </div>
      {open&&<div className="gc-room-bar"><span className={"gc-live"+(connected?"":" offline")} role="status">{connected?"Conversa atualizada":"Reconectando…"}</span><button type="button" onClick={onOpenInbox}><Mail size={15}/> Correio e amigos{unread>0&&<b aria-label={unread+" mensagens não lidas"}>{unread>99?"99+":unread}</b>}</button></div>}

      {open && <>
        {isStaff && <div className="gc-admin-tools">
          <span><b>ADMIN</b> Mensagens sem espera</span>
          <button type="button" aria-expanded={adminTools} onClick={() => {setAdminTools(value => !value);setClearConfirm(false);}}><SlidersHorizontal size={16}/> Administrar sala</button>
        </div>}
        {isStaff && adminTools && <div className="gc-management" aria-label="Administração da sala">
          <p>Abra as ações de uma mensagem para fixar, apagar ou moderar o participante.</p>
          {state.viewerRole === "OWNER" && (!clearConfirm
            ? <button type="button" onClick={() => setClearConfirm(true)}><Trash2 size={16}/> Limpar mensagens da sala</button>
            : <div className="gc-clear-confirm" role="alert"><strong>Ocultar todas as mensagens atuais?</strong><span>Esta ação afeta a sala inteira.</span><div><button type="button" onClick={() => {setClearConfirm(false);void moderate(() => api.chatClear());}}>Confirmar limpeza</button><button type="button" onClick={() => setClearConfirm(false)}>Cancelar</button></div></div>)}
        </div>}
        {state.pinned.length > 0 && (
          <div className="gc-pinned" aria-label="Avisos fixados"><strong className="gc-pinned-heading"><Pin size={13}/> Avisos da comunidade</strong>
            {state.pinned.map((m) => (
              <div key={m.id} className="gc-pinned-item"><Pin size={12} /><button type="button" className="gc-name gc-name-button" onClick={()=>onOpenProfile?.(m.sender.id)}>{m.sender.name}</button><span className="gc-text">{m.body}</span></div>
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
                <div className={"gc-bubble"+((m.sender.presentation?.progress?.level??1)>=30?" gc-level-accent":"")}>
                  <div className="gc-meta">
                    {m.sender.presentation?.progress&&<LevelBadge progress={m.sender.presentation.progress} compact/>}
                    <button type="button" className="gc-name gc-name-button" onClick={()=>onOpenProfile?.(m.sender.id)}>{m.sender.name}</button>
                    {staff ? null
                      : isSuper ? <span className="gc-role-tag super">SUPER</span>
                      : m.sender.groupCode && m.sender.groupCode!=="#" ? <span className="gc-group">SOS {m.sender.groupCode}</span> : null}
                    <time className="gc-time">{time(m.createdAt)}</time>
                  </div>
                  <span className={staff ? "gc-text gc-text-admin" : isSuper ? "gc-super-text" : "gc-text"}>{m.body}</span>
                  {isStaff && adminTools && (
                    <details className="gc-mod">
                      <summary aria-label={"Ações da mensagem de " + m.sender.name}><MoreHorizontal size={18}/><span>Ações</span></summary>
                      <div className="gc-mod-actions">
                        <button type="button" onClick={() => void moderate(() => api.chatPin(m.id, !m.pinned))}>{m.pinned ? <PinOff size={15}/> : <Pin size={15}/>} {m.pinned ? "Desafixar" : "Fixar aviso"}</button>
                        <button type="button" onClick={() => void moderate(() => api.chatDelete(m.id))}><Trash2 size={15}/> Apagar mensagem</button>
                        {!staff && <>
                          <button type="button" onClick={() => void moderate(() => api.chatModerate(m.sender.id, "MUTE", { minutes: 10 }))}><VolumeX size={15}/> Silenciar por 10 min</button>
                          <button type="button" onClick={() => void moderate(() => api.chatModerate(m.sender.id, "REMOVE"))}><UserX size={15}/> Remover da sala</button>
                        </>}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <form className="gc-input" onSubmit={send}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={500}
            placeholder={isStaff ? "Mensagem da administração…" : "Escreva no chat (sem links)…"}
            disabled={busy}
            aria-label="Mensagem para o chat global"
          />
          <button className="gc-send" disabled={busy || cooldownLeft > 0 || !draft.trim()} aria-label="Enviar mensagem à comunidade"><Send size={18} /></button>
        </form>
        {error && <p className="gc-error" role="alert"><X size={13} /> {error}</p>}
        {!isStaff && <small className="gc-note" role="status">
          {cooldownLeft > 0 ? "Você pode enviar novamente em " + cooldownLeft + " s. Continue escrevendo." : state.cooldownSeconds === 0 ? "SUPER · mensagens sem espera" : "Uma mensagem a cada " + state.cooldownSeconds + " segundos"}
          <span>Compartilhe URLs de vídeos na fila.</span>
        </small>}
      </>}
      {zoom && createPortal(
        <AvatarLightbox
          avatar={zoom.avatar ?? undefined} presentation={zoom.presentation}
          name={zoom.name}
          onChooseHD={zoom.id===currentUserId?()=>{setSelfPicker(zoom);setZoom(null);}:undefined}
          subtitle={zoom.groupCode === "#" ? "Participação administrativa" : zoom.groupCode ? `SOS YOUTUBER ${zoom.groupCode}` : undefined}
          onClose={() => setZoom(null)}
          actions={onOpenProfile ? <button type="button" onClick={() => { const id = zoom.id; setZoom(null); onOpenProfile(id); }}>Ver perfil, amigos e mensagens</button> : undefined}
        />,document.body
      )}
      {selfPicker&&createPortal(<AvatarModal name={selfPicker.name} current={selfPicker.avatar??undefined} presentation={selfPicker.presentation} onClose={()=>setSelfPicker(undefined)} onChanged={()=>{setSelfPicker(undefined);void sync();window.dispatchEvent(new Event("sos-community-updated"));}}/>,document.body)}
    </aside>
  );
}
