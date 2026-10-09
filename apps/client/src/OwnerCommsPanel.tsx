import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Megaphone, HeartPulse, Youtube, Trash2, RefreshCw, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { ownerApi, type NumberHealth, type YouTubeIntegrationState, type AdminMailMessage } from "./api";

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("pt-BR") : "—");

/**
 * AUDITORIA / painel de comunicação: saúde do número Business (com sugestão de
 * troca quando ele morre), chave do YouTube e correio interno (aviso global +
 * moderação). Tudo cruzado numa tela só, aplicado em tempo real.
 */
/**
 * HIERARQUIA: `canEdit` (canConfigure) libera editar; `canViewSensitive` libera o
 * CORREIO — correspondência privada e disparo global são exclusivos do ROOT_OWNER.
 * ADMIN_OWNER vê apenas o operacional (saúde do número e estado do YouTube).
 */
export function OwnerCommsPanel({ canEdit, canViewSensitive }: { canEdit: boolean; canViewSensitive: boolean }) {
  const [health, setHealth] = useState<NumberHealth | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [youtube, setYoutube] = useState<YouTubeIntegrationState>();
  const [ytKey, setYtKey] = useState("");
  const [broadcast, setBroadcast] = useState("");
  const [mail, setMail] = useState<AdminMailMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [h, y] = await Promise.all([ownerApi.numberHealth(), ownerApi.youtubeIntegration()]);
      setHealth(h.health); setSteps(h.replacementSteps); setYoutube(y);
      // Correio só é carregado por quem pode vê-lo — ADMIN nem recebe os dados.
      if (canViewSensitive) setMail((await ownerApi.mailRecent(60)).messages);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar."); }
  }, [canViewSensitive]);
  useEffect(() => { void load(); }, [load]);

  function flash(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 2600); }

  async function run(work: () => Promise<unknown>, message: string) {
    setBusy(true); setError("");
    try { await work(); flash(message); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir."); }
    finally { setBusy(false); }
  }

  const statusTone = health?.status === "HEALTHY" ? "ready" : health?.status === "UNKNOWN" ? "pending" : "danger";

  return (
    <section className="owner-panel comms-panel">
      <div className="owner-panel-head">
        <div><h2><Megaphone size={19} /> Comunicação</h2><p className="muted">Saúde do número, chave do YouTube e correio interno.</p></div>
        <button className="text-button" onClick={() => void load()} disabled={busy}><RefreshCw size={14} /> Atualizar</button>
      </div>

      {/* ---- saúde do número ---- */}
      <div className={"comms-block health-" + statusTone}>
        <div className="comms-block-head">
          <h3><HeartPulse size={17} /> Número Business</h3>
          {canEdit && <button className="text-button" onClick={() => void run(() => ownerApi.checkNumberHealth(), "Diagnóstico atualizado.")} disabled={busy}>Verificar agora</button>}
        </div>
        {!health ? <p className="muted">Ainda não há diagnóstico. Clique em “Verificar agora”.</p> : <>
          <div className="health-line">
            {health.status === "HEALTHY" ? <CheckCircle2 size={17} /> : health.status === "UNKNOWN" ? <AlertTriangle size={17} /> : <ShieldAlert size={17} />}
            <div>
              <strong>{health.status === "HEALTHY" ? "Ativo e saudável" : health.status === "DEGRADED" ? "Degradado" : health.status === "UNUSABLE" ? "Inutilizável" : "Indeterminado"}</strong>
              <span>{health.detail}</span>
              <small>{health.phone ? "+" + health.phone : "sem telefone salvo"} · conferido em {when(health.checkedAt)}{health.qualityRating ? " · qualidade " + health.qualityRating : ""}</small>
            </div>
          </div>
          <p className="health-reco">{health.recommendation}</p>
          {health.shouldReplaceNumber && (
            <div className="health-replace">
              <strong><ShieldAlert size={15} /> Troque o número Business</strong>
              <ol>{steps.map((s) => <li key={s}>{s}</li>)}</ol>
            </div>
          )}
        </>}
      </div>

      {/* ---- YouTube ---- */}
      <div className="comms-block">
        <div className="comms-block-head"><h3><Youtube size={17} /> Chave do YouTube</h3></div>
        <p className="muted">
          {youtube?.apiKeyConfigured
            ? `Configurada (${youtube.source === "PANEL" ? "pelo painel" : "pelo ambiente"}) · verificação ${youtube.verification === "VERIFIED" ? "completa" : "apenas estrutural"}.`
            : "Sem chave: o servidor não confirma duração, existência nem incorporação dos vídeos."}
        </p>
        {canEdit && <form className="comms-inline-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => ownerApi.saveYouTubeIntegration({ apiKey: ytKey.trim() }), "Chave salva — já está valendo."); setYtKey(""); }}>
          <input value={ytKey} onChange={(e) => setYtKey(e.target.value)} placeholder="Colar nova chave da YouTube Data API" />
          <button className="primary" disabled={busy || ytKey.trim().length < 20}>Salvar</button>
          {youtube?.source === "PANEL" && <button type="button" className="secondary" onClick={() => void run(() => ownerApi.saveYouTubeIntegration({ clear: true }), "Chave do painel removida.")} disabled={busy}>Usar a do ambiente</button>}
        </form>}
      </div>

      {/* ---- correio interno: exclusivo do ROOT_OWNER ---- */}
      {canViewSensitive && <div className="comms-block">
        <div className="comms-block-head"><h3><Megaphone size={17} /> Aviso para todos</h3></div>
        <form className="comms-inline-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => ownerApi.mailBroadcast(broadcast.trim()), "Aviso entregue nos correios."); setBroadcast(""); }}>
          <input value={broadcast} onChange={(e) => setBroadcast(e.target.value)} placeholder="Mensagem que chega no correio de todos os participantes" maxLength={2000} />
          <button className="primary" disabled={busy || broadcast.trim().length < 2}>Enviar</button>
        </form>

        <h4 className="comms-sub">Correio recente (todos os participantes)</h4>
        <div className="table-scroll comms-mail">
          <table><thead><tr><th>Quando</th><th>De</th><th>Mensagem</th><th></th></tr></thead>
            <tbody>
              {mail.map((m) => (
                <tr key={m.id} className={m.deletedAt ? "comms-mail-deleted" : ""}>
                  <td><small>{when(m.createdAt)}</small></td>
                  <td><small>{m.senderRole === "OWNER" ? "Owner" : m.senderId ?? "—"}</small></td>
                  <td><span className="comms-mail-body">{m.body}</span></td>
                  <td>{!m.deletedAt && <button className="text-button" onClick={() => void run(() => ownerApi.mailDelete(m.id), "Mensagem removida.")} disabled={busy}><Trash2 size={13} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!mail.length && <p className="muted">Nenhuma mensagem ainda.</p>}
        </div>
      </div>}

      {notice && <p className="bot-notice">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
