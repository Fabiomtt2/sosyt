import { ActionErrorDialog } from "./ActionErrorDialog";
import "./owner-credentials.css";
import { BotPasswordSettings } from "./BotPasswordSettings";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KeyRound, Phone, Sparkles, ShieldCheck, Wand2, Trash2, RefreshCw, Copy, Check, Gift, Ban } from "lucide-react";
import { ownerApi, type CredentialsState, type SuperAdminState, type OwnerOverview } from "./api";

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
export function OwnerAccessPanel({users=[]}:{users?:OwnerOverview["users"]}) {
  const [creds, setCreds] = useState<CredentialsState>();
  const [superState, setSuperState] = useState<SuperAdminState>();
  const [mine, setMine] = useState({ password: "", confirm: "" });
  const [credentialNotice,setCredentialNotice]=useState("");
  const [rootCredentialNotice,setRootCredentialNotice]=useState("");
  const [memberCredentialNotice,setMemberCredentialNotice]=useState("");
  const [otherRoot,setOtherRoot]=useState({ownerId:"",password:"",confirm:"",reason:""});
  const [memberCredential,setMemberCredential]=useState({userId:"",password:"",confirm:"",reason:""});
  const [memberSearch,setMemberSearch]=useState("");
  const member=users.find(user=>user.id===memberCredential.userId);
  const members=users.filter(user=>!user.revokedAt&&!creds?.owners?.some(owner=>owner.phone===user.phone)&&!creds?.admins.some(admin=>admin.phone===user.phone)&&[user.name,user.phone,user.id].some(value=>value.toLocaleLowerCase("pt-BR").includes(memberSearch.trim().toLocaleLowerCase("pt-BR")))).slice(0,30);
  const [phones, setPhones] = useState<Record<string, string>>({ fabio: "", rafael: "" });
  const [grant, setGrant] = useState({ userId: "", days: "30" });
  const [participantSearch,setParticipantSearch]=useState("");
  const grantUser=users.find(user=>user.id===grant.userId);
  const search=participantSearch.trim().toLocaleLowerCase("pt-BR");
  const matchingUsers=users.filter(user=>!user.revokedAt && (!search || [user.name,user.phone,user.id].some(value=>value.toLocaleLowerCase("pt-BR").includes(search)))).slice(0,30);
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
    if (mine.password.length < 10 || !/[a-zA-Z]/.test(mine.password) || !/[0-9]/.test(mine.password)) { setError("Use pelo menos 10 caracteres, incluindo letras e números."); return; }
    if (mine.password !== mine.confirm) { setError("As duas senhas precisam ser iguais."); return; }
    const saved = await run(() => ownerApi.saveCredential({ password: mine.password }), "Sua credencial do painel foi atualizada.");
    if (saved) {setMine({ password: "", confirm: "" });setCredentialNotice("Sua credencial foi salva. Use a nova credencial na próxima entrada; sua sessão atual continua aberta.");}
  }

  if (!creds) return <section className="owner-panel"><p className="muted">{error || "Carregando acesso…"}</p></section>;

  return (
    <section className="owner-panel owner-access-panel">
      <div className="owner-panel-head">
        <div><h2><ShieldCheck size={19} /> Acesso e assinaturas</h2><p className="muted">Cuide do acesso ao painel, dos contatos dos Owners e das assinaturas SUPER.</p></div>
        <button className="text-button" onClick={() => void load()} disabled={busy}><RefreshCw size={14} /> Atualizar</button>
      </div>

      {/* ---- minha credencial ---- */}
      <div className="comms-block">
        <div className="comms-block-head"><h3><KeyRound size={17} /> Minha credencial do painel</h3></div>
        <p className="muted">
          {creds.mine.configured
            ? <>Definida {creds.mine.updatedAt ? `em ${when(creds.mine.updatedAt)}` : ""}. A credencial de emergência também permite acessar o painel.</>
            : <>Você está usando a credencial de emergência. Crie abaixo uma senha para o painel.</>}
        </p>
        <form className="owner-access-form owner-credential-form" aria-label="Minha credencial do painel" onSubmit={saveMine}>
          <label>Nova credencial<input type="password" value={mine.password} onChange={(e) => setMine({ ...mine, password: e.target.value })} placeholder="mínimo 10, com letras e números" autoComplete="new-password" minLength={10} maxLength={128} required/></label>
          <label>Repetir<input type="password" value={mine.confirm} onChange={(e) => setMine({ ...mine, confirm: e.target.value })} autoComplete="new-password" minLength={10} maxLength={128} required/></label>
          <p className="muted">Use pelo menos 10 caracteres, com letras e números, e repita a mesma credencial.</p>
          <button type="submit" className="primary" disabled={busy}>{busy ? "Salvando…" : "Salvar minha credencial"}</button>{credentialNotice&&<p role="status" className="credential-success">{credentialNotice}</p>}
        </form>
      </div>

      <section className="comms-block">
        <div className="comms-block-head"><h3><ShieldCheck size={17}/> Credencial de outro Owner principal</h3></div>
        <p className="muted">Fábio e Rafael têm autoridade máxima. Você pode substituir a credencial do outro Owner; informe o motivo para manter o histórico da administração.</p>
        <form className="owner-access-form owner-credential-form" aria-label="Credencial de outro Owner" onSubmit={event=>{
          event.preventDefault();
          if(otherRoot.password!==otherRoot.confirm){setError("As duas credenciais precisam ser iguais.");return;}
          const payload={ownerId:otherRoot.ownerId,password:otherRoot.password,reason:otherRoot.reason};
          void run(()=>ownerApi.saveCredential(payload),"Credencial do Owner atualizada.").then(saved=>{if(saved){setOtherRoot({ownerId:"",password:"",confirm:"",reason:""});setRootCredentialNotice("A nova credencial do Owner foi salva. O registro da alteração inclui seu nome e o motivo.");}});
        }}>
          <label>Owner<select aria-label="Owner para alterar credencial" value={otherRoot.ownerId} onChange={event=>setOtherRoot({...otherRoot,ownerId:event.target.value})} required><option value="">Escolha o Owner</option>{creds.owners?.filter(owner=>owner.id!==creds.mine.ownerId).map(owner=><option key={owner.id} value={owner.id}>{owner.name} · {owner.phone}</option>)}{creds.admins.map(admin=><option key={admin.ownerId} value={admin.ownerId}>{admin.name} · Administrador · {admin.phone}</option>)}</select></label>
          <label>Nova credencial do Owner<input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={otherRoot.password} onChange={event=>setOtherRoot({...otherRoot,password:event.target.value})} required/></label>
          <label>Repita a credencial do Owner<input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={otherRoot.confirm} onChange={event=>setOtherRoot({...otherRoot,confirm:event.target.value})} required/></label>
          <label>Motivo da alteração<input minLength={5} maxLength={240} value={otherRoot.reason} onChange={event=>setOtherRoot({...otherRoot,reason:event.target.value})} placeholder="Ex.: recuperação de acesso solicitada" required/></label>
          <small>Use 10 a 128 caracteres, incluindo letras e números. A senha antiga do painel será substituída; o segredo de emergência continua protegido.</small>
          <button type="submit" className="primary" disabled={busy}>Salvar credencial do Owner</button>{rootCredentialNotice&&<p role="status" className="credential-success">{rootCredentialNotice}</p>}
        </form>
      </section>
      <section className="comms-block">
        <div className="comms-block-head"><h3><KeyRound size={17}/> Recuperar acesso de um participante</h3></div>
        <p className="muted">Defina uma senha provisória quando precisar intervir. A pessoa deverá trocá-la ao entrar. A senha fica protegida; o histórico guarda apenas quem alterou e o motivo.</p>
        <form className="owner-access-form owner-credential-form" aria-label="Senha provisória de participante" onSubmit={event=>{
          event.preventDefault();if(!member){setError("Escolha um participante cadastrado.");return;}
          if(memberCredential.password!==memberCredential.confirm){setError("As duas senhas provisórias precisam ser iguais.");return;}
          void run(()=>ownerApi.setParticipantPassword(member.phone,{password:memberCredential.password,reason:memberCredential.reason}),"Senha provisória salva. Repasse ao participante por um canal seguro.").then(saved=>{if(saved){setMemberCredential({userId:"",password:"",confirm:"",reason:""});setMemberCredentialNotice("Senha provisória salva. Repasse por um canal seguro; a pessoa deverá trocá-la ao entrar.");}});
        }}>
          <label>Buscar participante<input type="search" value={memberSearch} onChange={event=>{setMemberSearch(event.target.value);setMemberCredential({...memberCredential,userId:""});}} placeholder="Nome, WhatsApp ou ID"/></label>
          <label>Participante<select aria-label="Participante para senha provisória" value={memberCredential.userId} onChange={event=>setMemberCredential({...memberCredential,userId:event.target.value})} required><option value="">Escolha a pessoa</option>{members.map(user=><option key={user.id} value={user.id}>{user.name} · {user.phone}</option>)}</select></label>
          <label>Nova senha provisória<input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={memberCredential.password} onChange={event=>setMemberCredential({...memberCredential,password:event.target.value})} required/></label>
          <label>Repita a senha provisória<input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={memberCredential.confirm} onChange={event=>setMemberCredential({...memberCredential,confirm:event.target.value})} required/></label>
          <label>Motivo da recuperação<input minLength={5} maxLength={240} value={memberCredential.reason} onChange={event=>setMemberCredential({...memberCredential,reason:event.target.value})} required/></label>
          <button type="submit" className="primary" disabled={busy||!member}>Salvar senha provisória</button>{memberCredentialNotice&&<p role="status" className="credential-success">{memberCredentialNotice}</p>}
        </form>
      </section>

      {/* ---- telefone dos Owners ---- */}
      <div className="comms-block">
        <div className="comms-block-head"><h3><Phone size={17} /> WhatsApp dos Owners</h3></div>
        <p className="muted">O acesso usa nome e WhatsApp. Após salvar o novo número, use-o na próxima entrada.</p>
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
        <p className="muted">Cada administrador tem sua própria credencial. Gere uma senha provisória e repasse por um canal seguro.</p>
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
          if(!grantUser){setError("Escolha um participante cadastrado na lista.");return;}
          if(!Number.isInteger(days)||days<1||days>3650){setError("Escolha uma duração inteira de 1 a 3.650 dias.");return;}
          void run(() => ownerApi.grantSuper(grant.userId.trim(), days), `SUPER concedido por ${days} dias.`)
            .then((ok) => { if (ok) setGrant({ userId: "", days: String(superState?.defaultDays ?? 30) }); });
        }}>
          <label>Buscar por nome, WhatsApp ou ID<input type="search" value={participantSearch} onChange={e=>{setParticipantSearch(e.target.value);setGrant(current=>({...current,userId:""}));}} placeholder="Quem vai receber o SUPER?" disabled={busy}/></label><label>Participante<select aria-label="Participante para receber SUPER" value={grant.userId} onChange={e=>setGrant({...grant,userId:e.target.value})} disabled={busy}><option value="">Selecione um participante</option>{matchingUsers.map(user=><option key={user.id} value={user.id}>{user.name} · {user.phone}</option>)}</select></label>{grantUser&&<p className="muted">Selecionado: <strong>{grantUser.name}</strong> · {grantUser.phone}<br/>ID: <code>{grantUser.id}</code> <button type="button" className="text-button" onClick={()=>void navigator.clipboard.writeText(grantUser.id).then(()=>flash("ID copiado.")).catch(()=>setError("Não foi possível copiar. Selecione o ID exibido."))}>Copiar ID</button></p>}<small>O nome e o telefone identificam a pessoa. O ID é preenchido automaticamente; a doação não registra uma compra.</small>
          <label className="narrow">Dias<input type="number" min="1" max="3650" step="1" value={grant.days} onChange={(e) => setGrant({ ...grant, days: e.target.value })} inputMode="numeric" /></label>
          <button className="primary" disabled={busy || !grantUser}><Gift size={15} /> Doar SUPER</button>
        </form>
        {!superState?.subscribers.length ? <p className="muted">Nenhuma assinatura registrada.</p> : (
          <div className="table-scroll">
            <table><thead><tr><th>Participante</th><th>Validade</th><th>Origem</th><th>Renovação</th><th></th></tr></thead>
              <tbody>
                {superState.subscribers.map((s) => (
                  <tr key={s.userId} className={s.revokedAt ? "comms-mail-deleted" : ""}>
                    <td><strong>{s.name}</strong><small>{s.phone}</small><small>ID: <code>{s.userId}</code></small></td>
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

      {notice && <p className="bot-notice" role="status">{notice}</p>}
      {error && <ActionErrorDialog message={error} onClose={()=>setError("")}/>}
    <BotPasswordSettings/>
</section>
  );
}
