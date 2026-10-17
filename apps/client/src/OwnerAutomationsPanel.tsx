import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquareText, RefreshCw, RotateCcw, Save, History, Eye, Lock } from "lucide-react";
import {
  ownerApi,
  type AutomationAuditEntry, type AutomationCategory, type AutomationMeta,
  type AutomationSettings, type AutomationsState,
} from "./api";

/**
 * AUDITORIA / HYBRID+ — as ATITUDES do bot, editáveis pelo Owner.
 *
 * Aqui o dono escreve cada fala, liga e desliga cada evento, escolhe o alvo e a
 * frequência. O servidor valida antes de aceitar; esta tela mostra o motivo em
 * português quando recusa — identificação pessoal em grupo, campo inexistente,
 * acento num `{campo}`.
 *
 * A pré-visualização é deliberada: a reauditoria pediu "ver antes de ativar",
 * porque uma fala errada vai para a comunidade inteira e não volta.
 *
 * HIERARQUIA: a tela só existe para ROOT_OWNER (o servidor também exige).
 */

const CATEGORY_LABEL: Record<AutomationCategory, string> = {
  ONBOARDING: "Acolhimento",
  QUEUES: "Filas e atividade",
  REWARDS: "Recompensas",
  RETENTION: "Reengajamento e cuidado",
  SUPPORT: "Suporte",
  BROADCAST: "Recado global",
};

const TARGET_LABEL: Record<string, string> = {
  MEMBER: "No privado, para o participante",
  OWNERS: "No privado, para os Owners",
  GROUP: "No grupo do participante",
  ALL_GROUPS: "Em todos os grupos",
};

/** Valores de exemplo para a prévia — mesma ideia do render do servidor. */
const SAMPLE: Record<string, string> = {
  nome: "Ana", grupo: "7", sala: "7", posicao: "3", aba: "2", fila: "12",
  link: "https://sosyoutuber.app", abertas: "3", vagas: "5", moedas: "5", total: "42",
  nivel: "8", dias: "3", semana: "13/10 a 19/10", mes: "outubro",
  ranking: "🥇 Ana — 320 XP\n🥈 Bia — 210 XP\n🥉 Caio — 150 XP",
  mensagem: "Amanhã tem live da comunidade às 20h!",
};

function preview(text: string): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => SAMPLE[key] ?? match);
}

function AutomationCard({ meta, settings, onSaved }: {
  meta: AutomationMeta; settings: AutomationSettings; onSaved: (next: AutomationSettings) => void;
}) {
  const [text, setText] = useState(settings.text);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [interval, setIntervalMinutes] = useState(settings.intervalMinutes ?? meta.defaultIntervalMinutes ?? 360);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    setText(settings.text); setEnabled(settings.enabled);
    setIntervalMinutes(settings.intervalMinutes ?? meta.defaultIntervalMinutes ?? 360);
  }, [settings.text, settings.enabled, settings.intervalMinutes, meta.defaultIntervalMinutes]);

  const dirty = text !== settings.text || enabled !== settings.enabled
    || (meta.periodic && interval !== (settings.intervalMinutes ?? meta.defaultIntervalMinutes));

  function flash(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 2500); }

  async function save() {
    setBusy(true); setError("");
    try {
      const result = await ownerApi.saveBotAutomation(meta.event, {
        text, enabled, ...(meta.periodic ? { intervalMinutes: interval } : {}),
      });
      onSaved(result.automation);
      flash("Salvo.");
    } catch (cause) {
      // O servidor devolve o motivo em português — mostramos como veio.
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar.");
    } finally { setBusy(false); }
  }

  async function reset() {
    setBusy(true); setError("");
    try { onSaved((await ownerApi.resetBotAutomation(meta.event)).automation); flash("Voltou ao padrão."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível restaurar."); }
    finally { setBusy(false); }
  }

  const blocked = (meta.requires ?? []).length > 0;

  return (
    <article className={`automation-card${enabled ? " on" : ""}`}>
      <header>
        <label className="automation-toggle">
          <input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => setEnabled(e.target.checked)} />
          <span><strong>{meta.label}</strong><small>{meta.description}</small></span>
        </label>
        {settings.customized && <em className="automation-tag">editada</em>}
        {blocked && <em className="automation-tag locked"><Lock size={11} /> precisa da gamificação</em>}
      </header>

      <p className="automation-route">
        {TARGET_LABEL[settings.target] ?? settings.target}
        {meta.periodic && <> · a cada <input type="number" min={15} step={15} value={interval} disabled={busy}
          onChange={(e) => setIntervalMinutes(Number(e.target.value))} className="automation-interval" /> min</>}
      </p>

      <textarea value={text} disabled={busy} rows={3} onChange={(e) => setText(e.target.value)}
        aria-label={`Mensagem de ${meta.label}`} />

      <p className="automation-fields">
        Campos: {meta.placeholders.map((k) => (
          <button type="button" key={k} className="automation-chip" disabled={busy}
            onClick={() => setText((t) => `${t}{${k}}`)}>{`{${k}}`}</button>
        ))}
        <small>sem acento</small>
      </p>

      {showPreview && <div className="automation-preview"><span>Como a pessoa vê</span><p>{preview(text)}</p></div>}

      <footer>
        <button type="button" className="text-button" onClick={() => setShowPreview((v) => !v)}>
          <Eye size={14} /> {showPreview ? "Ocultar prévia" : "Ver prévia"}
        </button>
        {settings.customized && <button type="button" className="text-button" onClick={() => void reset()} disabled={busy}>
          <RotateCcw size={14} /> Voltar ao padrão
        </button>}
        <button type="button" className="primary" onClick={() => void save()} disabled={busy || !dirty}>
          <Save size={15} /> Salvar
        </button>
      </footer>

      {notice && <p className="bot-notice">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </article>
  );
}

export function OwnerAutomationsPanel() {
  const [state, setState] = useState<AutomationsState>();
  const [audit, setAudit] = useState<AutomationAuditEntry[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setState(await ownerApi.botAutomations()); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar as atitudes do bot."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function loadAudit() {
    try { setAudit((await ownerApi.botAutomationAudit()).entries); setShowAudit(true); }
    catch { /* a trilha é um extra; a tela continua útil sem ela */ }
  }

  const byEvent = useMemo(
    () => new Map((state?.automations ?? []).map((a) => [a.event, a])),
    [state?.automations],
  );
  const metaByEvent = useMemo(
    () => new Map((state?.catalog ?? []).map((m) => [m.event, m])),
    [state?.catalog],
  );

  function onSaved(next: AutomationSettings) {
    setState((prev) => prev && {
      ...prev,
      automations: prev.automations.map((a) => (a.event === next.event ? next : a)),
    });
  }

  if (error) return <section className="owner-panel"><p className="error" role="alert">{error}</p></section>;
  if (!state) return <section className="owner-panel"><p className="muted">Carregando as atitudes do bot…</p></section>;

  const active = state.automations.filter((a) => a.enabled).length;

  return (
    <section className="owner-panel automations-panel">
      <div className="owner-panel-head">
        <div>
          <h2><MessageSquareText size={19} /> Atitudes do bot</h2>
          <p className="muted">
            Cada fala do bot é editável aqui. {active} de {state.automations.length} ligadas.
            O que você escreve chega à comunidade — use a prévia antes de salvar.
          </p>
        </div>
        <div className="owner-panel-actions">
          <button className="text-button" onClick={() => void loadAudit()}><History size={14} /> Histórico</button>
          <button className="text-button" onClick={() => void load()}><RefreshCw size={14} /> Atualizar</button>
        </div>
      </div>

      {showAudit && (
        <div className="comms-block automation-audit">
          <div className="comms-block-head"><h3>Quem mudou o quê</h3>
            <button className="text-button" onClick={() => setShowAudit(false)}>fechar</button></div>
          {audit.length === 0 ? <p className="muted">Nenhuma alteração registrada ainda.</p> : (
            <ul>{audit.map((entry, index) => (
              <li key={index}>
                <strong>{metaByEvent.get(entry.event)?.label ?? entry.event}</strong>
                <small>{entry.field} · {entry.actorName ?? "—"} · {new Date(entry.createdAt).toLocaleString("pt-BR")}</small>
                {entry.field === "text" && <p className="automation-audit-diff">{entry.after}</p>}
              </li>
            ))}</ul>
          )}
        </div>
      )}

      {state.groups.map(({ category, events }) => events.length > 0 && (
        <div className="comms-block" key={category}>
          <div className="comms-block-head"><h3>{CATEGORY_LABEL[category] ?? category}</h3></div>
          <div className="automation-grid">
            {events.map((event) => {
              const meta = metaByEvent.get(event), settings = byEvent.get(event);
              if (!meta || !settings) return null;
              return <AutomationCard key={event} meta={meta} settings={settings} onSaved={onSaved} />;
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
