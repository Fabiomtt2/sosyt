import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Sparkles, Clock3, Megaphone, Loader } from "lucide-react";
import { api, type SuperState, type SuperPin } from "./api";
import { UserAvatarView } from "./AvatarModal";

/** Selo SUPER: dinâmico, visível em qualquer lugar onde o usuário apareça. */
export function SuperBadge({ small }: { small?: boolean }) {
  return <b className={"super-badge" + (small ? " small" : "")} title="Assinante SUPER" aria-label="Assinante SUPER">SUPER</b>;
}

function remaining(seconds: number) {
  if (seconds <= 0) return "encerrada";
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} dia${d > 1 ? "s" : ""} e ${h}h`;
  if (h > 0) return `${h}h ${m}min`;
  return `${m} min`;
}
const countdown = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/**
 * AUDITORIA / SUPER no cliente: estado da assinatura (quanto falta e quando acaba)
 * e a vitrine de divulgação — 3 vagas no sistema, 1 hora cada, ao vivo para todos.
 * Quem não é SUPER vê a vitrine, mas não publica: o convite aparece no lugar.
 */
export function SuperPanel({ onOpenStore }: { onOpenStore?: () => void }) {
  const [state, setState] = useState<SuperState>();
  const [pins, setPins] = useState<SuperPin[]>([]);
  const [slotsFree, setSlotsFree] = useState(3);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [me, showcase] = await Promise.all([api.superMe(), api.superPins()]);
      setState(me); setPins(showcase.pins); setSlotsFree(showcase.slotsFree);
    } catch { setError("A vitrine não pôde ser atualizada. Seus dados continuam salvos."); }
  }, []);
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 15_000); return () => window.clearInterval(t); }, [load]);
  // Relógio local entre as sincronizações: a contagem anda sem esperar o servidor.
  useEffect(() => {
    const t = window.setInterval(() => setPins((list) => list.map((p) => ({ ...p, expiresInSeconds: Math.max(0, p.expiresInSeconds - 1) })).filter((p) => p.expiresInSeconds > 0)), 1000);
    return () => window.clearInterval(t);
  }, []);

  async function publish(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try { await api.createSuperPin(draft.trim()); setDraft(""); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível publicar."); }
    finally { setBusy(false); }
  }

  if (!state) return error?<section className="super-panel"><p role="status">{error}</p><button className="text-button" onClick={()=>void load()}>Tentar novamente</button></section>:null;
  const mine = state.myPins?.length ?? 0;

  return (
    <section className="super-panel premium-super" aria-label="Vitrine SUPER">
      <header className="super-head">
        <span className="super-head-title"><Sparkles size={16} /> Vitrine da comunidade</span>
        <span className="super-slots">{slotsFree} de 3 vagas livres</span>
      </header>

      {pins.length === 0 && <p className="super-empty">Nenhuma divulgação no ar. As vagas duram 1 hora cada.</p>}

      <div className="super-pins">
        {pins.map((pin) => (
          <article key={pin.id} className="super-pin">
            <div className="super-pin-who">
              <span className="super-pin-avatar">
                <UserAvatarView avatar={pin.author?.avatar} name={pin.author?.name ?? "Participante"} className="super-pin-avatar-img" />
                <SuperBadge small />
              </span>
              <div>
                <b>{pin.author?.name ?? "Participante"}</b>
                {pin.author?.channel?.title && <small>{pin.author.channel.title}</small>}
              </div>
              <time className="super-pin-time"><Clock3 size={12} /> {countdown(pin.expiresInSeconds)}</time>
            </div>
            <p className="super-pin-body">{pin.body}</p>
          </article>
        ))}
      </div>

      {state.active ? (
        <div className="super-mine">
          <div className="super-status">
            <SuperBadge />
            <span>
              {state.secondsRemaining > 1e15
                ? "Acesso permanente"
                : <>Sua assinatura acaba em <b>{remaining(state.secondsRemaining)}</b>{state.expiresAt && <> · {new Date(state.expiresAt).toLocaleDateString("pt-BR")}</>}</>}
            </span>
          </div>
          {mine === 0 ? (
            <form className="super-form" onSubmit={publish}>
              <input
                value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={180}
                placeholder="Divulgue seu canal: peça like, comentário e visualização (sem links)"
                aria-label="Mensagem de divulgação"
              />
              <button className="primary" disabled={busy || draft.trim().length < 10 || slotsFree === 0}>
                {busy ? <Loader size={15} className="spin" /> : <Megaphone size={15} />} Fixar 1h
              </button>
            </form>
          ) : (
            <p className="super-note">Sua divulgação está no ar. Quando ela expirar, você poderá publicar outra.</p>
          )}
          {slotsFree === 0 && mine === 0 && <p className="super-note">As três vagas estão ocupadas agora. Assim que uma expirar, ela abre para você.</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      ) : (
        <button type="button" className="super-cta" onClick={onOpenStore}>
          <SuperBadge />
          <span><b>Seja SUPER</b><small>Mais espaço para seu canal: chat sem espera, até 5 vídeos por fila e uma vitrine para divulgar com gentileza. Cada envio continua usando 1 moeda.</small></span>
        </button>
      )}
    </section>
  );
}
