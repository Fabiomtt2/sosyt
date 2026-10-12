import { WatchTimeSummary } from "./WatchTimeSummary";
import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, CircleDollarSign, Clock3, LoaderCircle, ShieldCheck, UserRoundCog, WalletCards, Youtube } from "lucide-react";
import { ownerApi, type OwnerOverview, type ParticipantAdminDetail } from "./api";
import { formatInternationalPhoneInput } from "./phone";
import { UserAvatarView } from "./AvatarModal";
import { useModalLifecycle } from "./useModalLifecycle";

const when = (value?: string) => value ? new Date(value).toLocaleString("pt-BR") : "—";
const coins = (millis = 0) => (millis / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const money = (cents = 0) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const product = (code:string) => code==="COINS_LAUNCH" ? "10 moedas + 1 passe bônus" : code==="PASS_SINGLE" ? "1 passe" : "Compra anterior";

export function ParticipantAdminModal({ phone, groups, onClose, onChanged }: {
  phone: string;
  groups: OwnerOverview["groups"];
  onClose: () => void;
  onChanged: (nextPhone?: string) => void;
}) {
  const [detail,setDetail]=useState<ParticipantAdminDetail>();
  const [form,setForm]=useState({name:"",phone:"",groupCode:""});
  const [amount,setAmount]=useState("");
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const modalRef=useModalLifecycle(onClose);

  async function load(target=phone) {
    setBusy(true); setError("");
    try {
      const result=await ownerApi.participant(target);
      setDetail(result);
      setForm({name:result.profile.name,phone:formatInternationalPhoneInput(result.profile.phone),groupCode:result.profile.groupCode ?? ""});
    } catch(cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar o participante."); }
    finally { setBusy(false); }
  }
  useEffect(()=>{ void load(); },[phone]);
  useEffect(()=>{
    let alive=true;
    const timer=window.setInterval(()=>{
      void ownerApi.participant(phone).then(result=>{if(alive)setDetail(current=>current?{...current,watchRewards:result.watchRewards}:current);}).catch(()=>{});
    },10000);
    return()=>{alive=false;window.clearInterval(timer);};
  },[phone]);

  async function save(event:FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const result=await ownerApi.updateParticipant(phone,{name:form.name,phone:form.phone,groupCode:form.groupCode});
      setNotice("Cadastro atualizado com rastreabilidade administrativa.");
      onChanged(result.phone);
      await load(result.phone);
    } catch(cause) { setError(cause instanceof Error ? cause.message : "Não foi possível atualizar o cadastro."); }
    finally { setBusy(false); }
  }
  async function action(kind:"REVOKE"|"RESTORE"|"CLEAR_COOLDOWN"|"REVIEW_ON"|"REVIEW_OFF", message:string) {
    setBusy(true); setError(""); setNotice("");
    try { await ownerApi.participantAction(detail?.profile.phone ?? phone,kind); setNotice(message); onChanged(detail?.profile.phone); await load(detail?.profile.phone ?? phone); }
    catch(cause) { setError(cause instanceof Error ? cause.message : "A ação administrativa não pôde ser concluída."); }
    finally { setBusy(false); }
  }
  async function adjust(event:FormEvent) {
    event.preventDefault();
    const value=Number(amount.replace(",","."));
    if (!Number.isFinite(value) || value===0) { setError("Informe um ajuste diferente de zero."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await ownerApi.walletAdjustment(detail?.profile.phone ?? phone,value,reason);
      setAmount(""); setReason(""); setNotice("Ajuste registrado no ledger com motivo e autoria.");
      onChanged(detail?.profile.phone); await load(detail?.profile.phone ?? phone);
    } catch(cause) { setError(cause instanceof Error ? cause.message : "Não foi possível registrar o ajuste."); }
    finally { setBusy(false); }
  }

  return <div className="modal-backdrop participant-admin-backdrop" onMouseDown={onClose}>
    <section ref={modalRef} className="modal participant-admin-modal" role="dialog" aria-modal="true" aria-label="Administrar participante" onMouseDown={(e)=>e.stopPropagation()}>
      <button className="close" aria-label="Fechar participante" onClick={onClose}>×</button>
      {!detail ? <div className="admin-modal-loading"><LoaderCircle className="spin"/><span>Carregando cadastro…</span>{error && <p className="error">{error}</p>}</div> : <>
        <div className="participant-admin-heading">
          <UserAvatarView avatar={detail.profile.avatar} name={detail.profile.name} className="participant-admin-avatar participant-user-avatar"/>
          <div><p className="eyebrow dark">ÁREA RESTRITA · OWNER</p><h2>{detail.profile.name}</h2><p className="muted">{detail.profile.phone} · {detail.profile.groupCode==="#" ? "Participação administrativa" : `SOS YOUTUBER ${detail.profile.groupCode ?? "—"}`}</p>{detail.profile.youtubeChannel&&<div className="participant-channel-card">{detail.profile.youtubeChannel.thumbnailUrl?<img src={detail.profile.youtubeChannel.thumbnailUrl} alt=""/>:<span><Youtube size={17}/></span>}<div><small>Canal conectado</small><strong>{detail.profile.youtubeChannel.title}</strong></div></div>}</div>
        </div>

        <div className="participant-admin-status">
          <span className={detail.membership?.revokedAt ? "status-chip pending" : "status-chip ok"}>{detail.membership?.revokedAt ? "Acesso revogado" : "Acesso autorizado"}</span>
          {detail.wallet?.paymentHold ? <span className="status-chip pending"><AlertTriangle size={14}/>Carteira em revisão</span> : detail.wallet && <span className="status-chip ok"><ShieldCheck size={14}/>Carteira disponível</span>}
          {detail.verification?.required && <span className={detail.verification.accessReady ? "status-chip ok" : "status-chip pending"}>{detail.verification.accessReady ? "Grupo verificado" : "Verificação de grupo pendente"}</span>}
        </div>

        <section className="admin-detail-grid">
          <article><span>Aprovação</span><strong>{when(detail.membership?.approvedAt ?? detail.request?.approvedAt)}</strong><small>por {detail.membership?.approvedByOwnerName ?? detail.request?.approvedByOwnerName ?? "Owner não identificado (registro legado)"}</small></article>
          <article><span>Cadastro</span><strong>{when(detail.profile.createdAt)}</strong><small>Origem: {detail.request?.source ?? detail.membership?.source ?? "—"}</small></article>
          <article><span>Último acesso</span><strong>{when(detail.profile.lastSeenAt)}</strong><small>{detail.profile.userId ? "Conta de uso criada" : "Ainda não fez o primeiro login"}</small></article>
          <article><span>Contribuições</span><strong>{detail.activity.submissions} URLs</strong><small>em {detail.activity.rounds} fila{detail.activity.rounds===1?"":"s"}</small></article>
          <article><span>Jornada</span><strong>{detail.activity.playlists} playlists</strong><small>{detail.activity.completedTasks} tarefa{detail.activity.completedTasks===1?"":"s"} concluída{detail.activity.completedTasks===1?"":"s"}</small></article>
        </section>

        <WatchTimeSummary rewards={detail.watchRewards}/>

        <form className="participant-edit-form" onSubmit={save}>
          <div className="section-title admin-subtitle"><div><p className="eyebrow dark">DADOS CADASTRAIS</p><h3>Editar participante</h3></div><span>Alterações são exclusivas do Owner.</span></div>
          <div className="integration-grid">
            <label>Nome<input value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} required /></label>
            <label>WhatsApp<input inputMode="tel" value={form.phone} onChange={(e)=>setForm({...form,phone:formatInternationalPhoneInput(e.target.value)})} required /></label>
            <label>Grupo<select value={form.groupCode} onChange={(e)=>setForm({...form,groupCode:e.target.value})}>{groups.filter((g)=>g.enabled).map((g)=><option key={g.code} value={g.code}>SOS YOUTUBER {g.code}</option>)}</select></label>
          </div>
          <button className="primary compact" disabled={busy}>{busy ? <LoaderCircle className="spin"/> : "Salvar alterações"}</button>
        </form>

        <section className="participant-wallet-admin">
          <div className="section-title admin-subtitle"><div><p className="eyebrow dark">CARTEIRA E ACESSO</p><h3>Controles administrativos</h3></div></div>
          {detail.wallet ? <div className="wallet-breakdown">
            <div><CircleDollarSign/><span>Moedas atuais</span><strong>{coins(detail.wallet.promoMillis+detail.wallet.rewardMillis+detail.wallet.purchasedMillis)}</strong></div>
            <div><span>Passes atuais</span><strong>{detail.wallet.extraPasses}</strong></div>
            <div><span>Inicial/promocional</span><strong>{coins(detail.wallet.promoMillis)}</strong></div>
            <div><span>Bônus/recompensas</span><strong>{coins(detail.wallet.rewardMillis)}</strong></div>
            {detail.purchaseTotals&&<><div><span>Moedas compradas · histórico</span><strong>{coins(detail.purchaseTotals.coinsPurchasedMillis)}</strong></div><div><span>Passes comprados</span><strong>{detail.purchaseTotals.passesPurchased}</strong></div><div><span>Passes bônus</span><strong>{detail.purchaseTotals.bonusPasses}</strong></div><div><span>Compras aprovadas</span><strong>{money(detail.purchaseTotals.approvedSpendCents)}</strong></div></>}
          </div> : <p className="muted">A carteira será criada no primeiro login do participante.</p>}
          <div className="admin-action-row">
            <button className="secondary" disabled={busy} onClick={()=>void action(detail.membership?.revokedAt ? "RESTORE":"REVOKE",detail.membership?.revokedAt ? "Acesso restaurado.":"Acesso revogado; dados preservados.")}>{detail.membership?.revokedAt ? "Restaurar acesso":"Revogar acesso"}</button>
            {detail.profile.cooldownUntil && <button className="secondary" disabled={busy} onClick={()=>void action("CLEAR_COOLDOWN","Cooldown liberado pelo Owner.")}><Clock3 size={16}/>Liberar cooldown</button>}
            {detail.wallet && detail.permissions?.canReviewWallet && <button className="secondary" disabled={busy} onClick={()=>void action(detail.wallet?.paymentHold ? "REVIEW_OFF":"REVIEW_ON",detail.wallet?.paymentHold ? "Revisão da carteira encerrada.":"Carteira colocada em revisão.")}>{detail.wallet.paymentHold ? "Encerrar revisão":"Colocar em revisão"}</button>}
          </div>
          {detail.wallet && detail.permissions?.canAdjustWallet && <form className="admin-adjust-form" onSubmit={adjust}>
            <label>Ajuste de bônus/moedas<input inputMode="decimal" value={amount} onChange={(e)=>setAmount(e.target.value)} placeholder="+2 ou -1" /></label>
            <label>Motivo<input value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="Motivo obrigatório para auditoria" /></label>
            <button className="secondary" disabled={busy}><WalletCards size={16}/>Registrar ajuste</button>
          </form>}
        </section>

        {detail.permissions?.canViewSensitive && <>
          <section className="participant-purchases">
            <div className="section-title admin-subtitle"><div><p className="eyebrow dark">HISTÓRICO FINANCEIRO</p><h3>Compras</h3></div><span>Registros de provedor são somente leitura.</span></div>
            <div className="table-scroll"><table><thead><tr><th>Produto</th><th>Valor</th><th>Provedor</th><th>Status</th><th>Data</th></tr></thead><tbody>
              {detail.purchases.map((p)=><tr key={p.id}><td><strong>{product(p.productCode)}</strong><small>{p.creditsMillis/1000} moeda{p.creditsMillis===1000?"":"s"} · {p.extraPasses} passe{p.extraPasses===1?"":"s"}</small></td><td>{money(p.amountCents)}</td><td>{p.provider==="DEMO" ? "Simulação":p.provider}</td><td>{p.status}</td><td>{when(p.approvedAt ?? p.createdAt)}</td></tr>)}
            </tbody></table>{!detail.purchases.length && <p className="muted">Nenhuma compra registrada.</p>}</div>
          </section>

          <section className="participant-ledger">
            <details><summary>Ver ledger e ajustes recentes</summary><div className="ledger-list">{detail.ledger.map((entry)=><div key={entry.id}><span>{entry.kind}</span><strong>{entry.amountMillis>=0 ? "+":""}{coins(entry.amountMillis)} moedas</strong><small>{when(entry.createdAt)}{entry.actorOwnerName ? ` · ${entry.actorOwnerName}`:""}{entry.note ? ` · ${entry.note}`:""}</small></div>)}</div></details>
          </section>
        </>}

        {notice && <div className="notice" role="status"><CheckCircle2 size={18}/><span>{notice}</span></div>}
        {error && <p className="error banner" role="alert">{error}</p>}
      </>}
    </section>
  </div>;
}
