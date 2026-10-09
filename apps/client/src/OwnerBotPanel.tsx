import { useCallback, useEffect, useState } from "react";
import { Bot, CheckCircle2, AlertTriangle, Lock, Loader, ShieldAlert, RefreshCw } from "lucide-react";
import { ownerApi, type BotStatus } from "./api";

/**
 * AUDITORIA / painel do bot: modos (isolado/híbrido) e cada função com liga-desliga.
 * Tudo salva no servidor e vale na hora — sem reiniciar nada. Quando uma função
 * está ligada mas o motor não está pronto, ela aparece BLOQUEADA com o motivo,
 * em vez de fingir que funciona.
 */
const MODES: Array<{ key: BotStatus["mode"]; title: string; detail: string; risk?: boolean }> = [
  { key: "DISABLED", title: "Desligado", detail: "O bot não envia nem recebe nada." },
  { key: "OFFICIAL", title: "Oficial (Meta)", detail: "Mensagens, códigos e conversa pela Cloud API. Seguro, sem risco de bloqueio. Não gerencia grupos." },
  { key: "EVOLUTION", title: "Evolution", detail: "Motor não-oficial: gerencia grupos reais e envia mensagens.", risk: true },
  { key: "HYBRID", title: "Híbrido (cobre tudo)", detail: "Oficial para mensagens + Evolution para grupos. Cobre todas as funções.", risk: true }
];

export function OwnerBotPanel() {
  const [status, setStatus] = useState<BotStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try { setStatus((await ownerApi.bot()).status); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar o bot."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(patch: { mode?: BotStatus["mode"]; features?: Record<string, boolean> }) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await ownerApi.saveBot(patch);
      setStatus(result.status);
      setNotice("Salvo — já está valendo.");
      window.setTimeout(() => setNotice(""), 2600);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }

  if (!status) return <section className="owner-panel"><p className="muted">{error || "Carregando configuração do bot…"}</p></section>;

  return (
    <section className="owner-panel bot-panel">
      <div className="owner-panel-head">
        <div><h2><Bot size={19} /> Bot da comunidade</h2><p className="muted">Escolha o motor e ligue cada função. Toda mudança vale imediatamente.</p></div>
        <button className="text-button" onClick={() => void load()} disabled={busy}><RefreshCw size={14} /> Atualizar</button>
      </div>

      <div className={status.fullyActive ? "bot-state ready" : "bot-state pending"}>
        {status.fullyActive ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
        <div>
          <strong>{status.fullyActive ? "Bot ativo" : "Bot ainda não está operando"}</strong>
          {status.missing.length > 0
            ? <ul className="bot-missing">{status.missing.map((m) => <li key={m}>{m}</li>)}</ul>
            : <span>Modo {status.mode} · motor de mensagens {status.engines.messaging.ready ? "pronto" : "pendente"} · grupos {status.engines.group.ready ? "prontos" : "indisponíveis"}</span>}
        </div>
      </div>

      <h3 className="bot-section-title">Modo de operação</h3>
      <div className="bot-modes">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            className={"bot-mode" + (status.mode === m.key ? " active" : "")}
            onClick={() => void save({ mode: m.key })}
            disabled={busy}
            aria-pressed={status.mode === m.key}
          >
            <b>{m.title}</b>
            <small>{m.detail}</small>
            {m.risk && <span className="bot-risk"><ShieldAlert size={12} /> risco de bloqueio do número</span>}
          </button>
        ))}
      </div>

      <h3 className="bot-section-title">Funções</h3>
      <div className="bot-features">
        {status.features.map((f) => (
          <div key={f.code} className={"bot-feature" + (f.active ? " on" : f.enabled ? " blocked" : "")}>
            <label>
              <input
                type="checkbox"
                checked={f.enabled}
                disabled={busy}
                onChange={(e) => void save({ features: { [f.code]: e.target.checked } })}
              />
              <span>
                <b>{f.label}</b>
                <small>
                  {f.active ? <em className="bot-tag on">ativa</em>
                    : f.enabled ? <em className="bot-tag blocked"><Lock size={11} /> bloqueada</em>
                      : <em className="bot-tag off">desligada</em>}
                  {f.engine === "group" && <em className="bot-tag risk">grupos · não-oficial</em>}
                </small>
              </span>
            </label>
            {f.blockedReason && <p className="bot-blocked-reason">{f.blockedReason}</p>}
            {f.riskNote && f.enabled && <p className="bot-risk-note"><ShieldAlert size={13} /> {f.riskNote}</p>}
          </div>
        ))}
      </div>

      <div className="bot-deps">
        <span className={status.dependencies.whatsappOfficialReady ? "ok" : "off"}>WhatsApp oficial</span>
        <span className={status.dependencies.youtubeReady ? "ok" : "off"}>YouTube</span>
        <span className={status.dependencies.paymentReady ? "ok" : "off"}>Pagamento</span>
        <code title="Webhook da Meta">{status.dependencies.webhookUrl}</code>
      </div>

      {busy && <p className="muted"><Loader size={14} className="spin" /> salvando…</p>}
      {notice && <p className="bot-notice">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
