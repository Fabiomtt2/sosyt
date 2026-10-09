import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KeyRound, Phone, Sparkles, ShieldCheck, Wand2, Trash2, RefreshCw, Copy, Check, Gift, Ban } from "lucide-react";
import { ownerApi, type CredentialsState, type SuperAdminState } from "./api";

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("pt-BR") : "—");
const days = (iso?: string) => {
  if (!iso) return "—";
  const left = Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
  return left > 0 ? `${left} dia${left > 1 ? "s" : ""}` : "expirada";
};

/**
 * AUDITORIA / painel de acesso (exclusivo ROOT_OWNER): credencial do painel,
 * telefone dos Owners, credencial de cada ADMIN e gestão da assinatura SUPER.
 * Reúne num lugar só o que antes exigia mexer em variável de ambiente e deploy.
 */
export function OwnerAccessPanel() {
  const [creds, setCreds] = useState<CredentialsState>();
  const [superState, setSuperState] = useState<SuperAdminState>();
  const [mine, setMine] = useState({ password: "", confirm: "" });
  const [phones, setPhones] = useState<Record<string, string>>({ fabio: "", rafael: "" });
  const [grant, setGrant] = useState({ userId: "", days: "30" });
  const [generated, setGenerated] = useState<{ ownerId: string; password: string }>();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([ownerApi.credentials(), ownerApi.superAdmin()]);
      setCreds(c); setSuperState(s); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function flash(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3000); }
  /** Retorna se a ação concluiu — quem chama só limpa o formulário em caso de êxito. */
  async function run(work: () => Promise<unknown>, message: string): Promise<boolean> {
    setBusy(true); setError("");
    try { await work(); flash(message); await load(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir."); return false; }
    finally { setBusy(false); }
  }

  async function saveMine(event: FormEvent) {
    event.preventDefault();
    if (mine.password !== mine.confirm) { setError("As duas senhas precisam ser iguais."); return; }
    await run(() => ownerApi.saveCredential({ password: mine.password }), "Sua credencial do painel foi atualizada.");
    setMine({ password: "", confirm: "" });
  }

  if (!creds) return <section className="owner-panel"><p className="muted">{error || "Carregando acesso…"}</p></section>;

  return (
    <section className="owner-panel owner-access-panel">
      <div className="owner-panel-head">
        <div><h2><ShieldCheck size={19} /> Acesso e assinaturas</h2><p className="muted">Credenciais do painel, telefone dos Owners e gestão do SUPER. Exclusivo do Owner principal.</p></div>
        <button className="text-button" onClick={() => void load()} disabled={busy}><RefreshCw size={14} /> Atualizar</button>
      </div>

      {/* ---- minha credencial ---- */}
      <div className="comms-block">
        <div className="comms-block-head"><h3><KeyRound size={17} /> Minha credencial do painel</h3></div>
        <p className="muted">
          {creds.mine.configured
            ? <>Definida {creds.mine.updatedAt ? `em ${when(creds.mine.updatedAt)}` : ""}. A credencial longa do ambiente continua valendo como entrada de emergência.</>
            : <>Ainda não definida. Hoje só a credencial longa do ambiente abre o painel — defina uma senha sua abaixo.</>}
        </p>
        <form className="owner-access-form" onSubmit={saveMine}>
          <label>Nova credencial<input type="password" value={mine.password} onChange={(e) => setMine({ ...mine, password: e.target.value })} placeholder="mínimo 10, com letras e números" autoComplete="new-password" /></label>
          <label>Repetir<input type="password" value={mine.confirm} onChange={(e) => setMine({ ...mine, confirm: e.target.value })} autoComplete="new-password" /></label>
          <button className="primary" disabled={busy || mine.password.length < 10}>Salvar</button>
        </form>
      </div>

      {/* ---- telefone dos Owners ---- */}
      <div className="comms-block">
        <div className="comms-block-head"><h3><Phone size={17} /> WhatsApp dos Owners</h3></div>
        <p className="muted">A identidade do Owner é nome + telefone. Trocar o chip aqui passa a valer no login imediatamente, sem deploy.</p>
        <div className="owner-access-owners">
          {(["fabio", "rafael"] as const).map((id) => (
            <div key={id} className="owner-access-row">
              <strong>{id === "fabio" ? "Fábio" : "Rafael"}</strong>
              <code>{creds.owners?.find((o) => o.id === id)?.phone ?? "—"}</code>
              <input
                value={phones[id]} onChange={(e) => setPhones({ ...phones, [id]: e.target.value.replace(/\D/g, "").slice(0, 15) })}
                placeholder="novo número com DDI+DDD" inputMode="numeric" aria-label={`Novo WhatsApp de ${id}`}
              />
              <button className="text-button" disabled={busy || phones[id].length < 10}
                onClick={() => void run(() => ownerApi.saveOwnerPhone(id, phones[id]), "Telefone atualizado.")
                  .then((ok) => { if (ok) setPhones((current) => ({ ...current, [id]: "" })); })}>
                Trocar
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ---- credencial dos admins ---- */}
      <div className="comms-block">
        <div className="comms-block-head"><h3><Wand2 size={17} /> Administradores</h3></div>
        <p className="muted">O ADMIN nunca compartilha sua credencial. O bot gera uma senha própria, mostrada uma única vez para você repassar.</p>
        {!creds.admins.length ? <p className="muted">Nenhum administrador ativo.</p> : (
          <div className="table-scroll">
            <table><thead><tr><th>Administrador</th><th>Credencial</th><th></th></tr></thead>
              <tbody>
                {creds.admins.map((a) => (
                  <tr key={a.ownerId}>
                    <td><strong>{a.name}</strong><small>{a.phone}</small></td>
                    <td>
                      {a.configured
                        ? <span className="table-status on">Definida{a.mustChange ? " · troca pendente" : ""}</span>
                        : <span className="table-status off">Sem credencial · não acessa</span>}
                      {a.lockedUntil && <small>bloqueada até {when(a.lockedUntil)}</small>}
                    </td>
                    <td className="store-row-actions">
                      <button className="text-button" disabled={busy}
                        onClick={() => void (async () => {
                          setBusy(true); setError("");
                          try { const r = await ownerApi.generateCredential(a.ownerId); setGenerated({ ownerId: a.ownerId, password: r.password }); setCopied(false); await load(); }
                          catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao gerar."); }
                          finally { setBusy(false); }
                        })()}>
                        <Wand2 size={13} /> Gerar senha
                      </button>
                      {a.configured && <button className="text-button" disabled={busy}
                        onClick={() => void run(() => ownerApi.clearCredential(a.ownerId), "Credencial removida — o admin perde o acesso ao painel.")}>
                        <Trash2 size={13} /> Remover
                      </button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {generated && (
          <div className="owner-access-generated" role="status">
            <strong>Senha gerada — copie agora, ela não será mostrada de novo</strong>
            <div><code>{generated.password}</code>
              <button type="button" className="text-button" onClick={() => { void navigator.clipboard.writeText(generated.password).then(() => setCopied(true)); }}>
                {copied ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar</>}
              </button>
            </div>
            <small>Repasse por um canal seguro. O administrador deverá trocá-la no primeiro acesso.</small>
          </div>
        )}
      </div>

      {/* ---- SUPER ---- */}
      <div className="comms-block">
        <div className="comms-block-head"><h3><Sparkles size={17} /> Assinaturas SUPER</h3></div>
        <form className="owner-access-form" onSubmit={(e) => {
          e.preventDefault();
          const days = Number(grant.days || superState?.defaultDays || 30);
          void run(() => ownerApi.grantSuper(grant.userId.trim(), days), `SUPER concedido por ${days} dias.`)
            .then((ok) => { if (ok) setGrant({ userId: "", days: String(superState?.defaultDays ?? 30) }); });
        }}>
          <label>ID do participante<input value={grant.userId} onChange={(e) => setGrant({ ...grant, userId: e.target.value })} placeholder="cole o ID do participante" /></label>
          <label className="narrow">Dias<input value={grant.days} onChange={(e) => setGrant({ ...grant, days: e.target.value })} inputMode="numeric" /></label>
          <button className="primary" disabled={busy || grant.userId.trim().length < 8}><Gift size={15} /> Doar SUPER</button>
        </form>
        {!superState?.subscribers.length ? <p className="muted">Nenhuma assinatura registrada.</p> : (
          <div className="table-scroll">
            <table><thead><tr><th>Participante</th><th>Validade</th><th>Origem</th><th>Renovação</th><th></th></tr></thead>
              <tbody>
                {superState.subscribers.map((s) => (
                  <tr key={s.userId} className={s.revokedAt ? "comms-mail-deleted" : ""}>
                    <td><strong>{s.name}</strong><small>{s.phone}</small></td>
                    <td><strong>{days(s.expiresAt)}</strong><small>{when(s.expiresAt)}</small></td>
                    <td>{s.source === "GIFT" ? "Doação do Owner" : s.source === "PURCHASE" ? "Compra" : s.source}</td>
                    <td>{s.autoRenew ? <span className="table-status on">Automática</span> : <span className="table-status off">Manual</span>}</td>
                    <td className="store-row-actions">
                      {!s.revokedAt && <>
                        <button className="text-button" disabled={busy} onClick={() => void run(() => ownerApi.superAutoRenew(s.userId, !s.autoRenew), "Renovação atualizada.")}>
                          {s.autoRenew ? "Desligar renovação" : "Ligar renovação"}
                        </button>
                        <button className="text-button" disabled={busy} onClick={() => void run(() => ownerApi.revokeSuper(s.userId), "SUPER revogado — privilégios caíram na hora.")}>
                          <Ban size={13} /> Revogar
                        </button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {notice && <p className="bot-notice">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
