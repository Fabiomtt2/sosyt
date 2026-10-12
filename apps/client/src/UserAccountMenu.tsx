import { WatchTimeSummary } from "./WatchTimeSummary";
import { useModalLifecycle } from "./useModalLifecycle";
import { useState } from "react";
import { BarChart3, CheckCircle2, LogOut, ShieldCheck, Trash2, UserCog, WalletCards, X, Youtube } from "lucide-react";
import { api, type Dashboard, type UserAvatar } from "./api";
import { UserAvatarView } from "./AvatarModal";
import { ProfilePhotoActions } from "./ProfilePhotoActions";

const when=(value?:string)=>value?new Date(value).toLocaleString("pt-BR"):"—";
const money=(cents:number)=>(cents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const productName=(code:string)=>code==="COINS_LAUNCH"?"10 moedas + 1 passe bônus":code==="PASS_SINGLE"?"1 passe":"Compra anterior";
const paymentStatus=(status:string)=>status==="APPROVED"?"Aprovado":status==="PENDING"?"Aguardando pagamento":status==="CANCELLED"?"Cancelado":status==="REJECTED"?"Não aprovado":status;

export function UserAccountMenu({data,onClose,onLogout,onDeleted,onAvatarChanged,onOpenAdmin,onConnectYoutube}:{data:Dashboard;onClose:()=>void;onLogout:()=>void;onDeleted:()=>void;onAvatarChanged:(avatar?:UserAvatar)=>void;onOpenAdmin:()=>Promise<void>;onConnectYoutube:()=>void}) {
  const [confirmDelete,setConfirmDelete]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const profile=data.profile;
  const ownerSessionExists=Boolean(localStorage.getItem("conexao_owner_token"));
  const canOpenAdmin=ownerSessionExists || Boolean(profile?.adminAccess);

  const modalRef=useModalLifecycle(()=>{if(confirmDelete)setConfirmDelete(false);else onClose();});

  async function openAdmin(){
    setBusy(true);setError("");
    try{await onOpenAdmin();}
    catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível abrir o painel administrativo.");}
    finally{setBusy(false);}
  }

  async function removeAccount(){
    setBusy(true);setError("");
    try{await api.deleteAccount();localStorage.removeItem("conexao_token");onDeleted();}
    catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível excluir sua conta agora.");}
    finally{setBusy(false);}
  }

  const verification=profile?.access.verification;
  const administrative=Boolean(data.viewer.adminRole);
  const administrativeLabel=data.viewer.adminRole==="ROOT_OWNER"?"Owner principal":"Administrador";
  const accessTitle=administrative ? "Acesso administrativo ativo" : profile?.access.revoked?"Acesso revogado":verification?.required
    ? verification.accessReady ? "Presença no grupo confirmada" : "Verificação externa pendente"
    : "Acesso autorizado pelo Owner";
  const accessCopy=administrative
    ? `Você está participando da Fila ${data.openRound.sequence} com privilégios administrativos. Esse marcador não é um número de grupo e não altera a numeração real das filas.`
    : profile?.access.revoked
      ? "Seu acesso foi interrompido. Fale com um Owner se quiser entender ou solicitar uma nova autorização."
      : verification?.required
        ? verification.accessReady
          ? `A integração ${verification.provider ?? "externa"} confirmou que seu número está presente no grupo SOS YOUTUBER ${profile?.access.groupCode ?? data.user.groupCode}. A aprovação do Owner permanece registrada separadamente.`
          : "Este grupo usa conferência externa, mas a última verificação ainda não confirmou seu número como participante. O Owner consegue revisar ou solicitar uma nova sincronização."
        : "Seu acesso foi autorizado administrativamente pelo SOS. Este grupo ainda não possui uma prova externa ativa para confirmar presença no WhatsApp em tempo real.";

  return <div className="modal-backdrop account-menu-backdrop" onMouseDown={onClose}>
    <section ref={modalRef} className="modal user-account-menu" role="dialog" aria-modal="true" aria-label="Minha conta" onMouseDown={(event)=>event.stopPropagation()}>
      <button className="close" aria-label="Fechar minha conta" onClick={onClose}><X size={20}/></button>
      <div className="account-menu-head">
        <span className="account-avatar-shell"><UserAvatarView avatar={data.user.avatar} name={data.user.name} className="account-avatar"/>{data.viewer.adminRole&&<b className="admin-badge account-admin-badge">ADMIN</b>}</span>
        <div><p className="eyebrow dark">MINHA CONTA</p><h2>{data.user.name}</h2><p>{administrative ? `${administrativeLabel} · Fila atual ${data.openRound.sequence}` : `${data.user.youtubeChannel?.title ?? "Seu espaço no SOS YouTuber"} · Grupo SOS YOUTUBER ${data.user.groupCode}`}</p></div>
      </div>

      <section className="account-profile-tools">
        <div><strong>Foto do perfil</strong><span>Foto e galeria ficam aqui. Para trocar a ilustração, toque no avatar da barra superior.</span></div>
        <ProfilePhotoActions onChanged={onAvatarChanged}/>
      </section>

      <section className="account-youtube-card">
        {data.user.youtubeChannel?.thumbnailUrl?<img src={data.user.youtubeChannel.thumbnailUrl} alt=""/>:<span className="account-youtube-fallback"><Youtube size={22} fill="currentColor"/></span>}
        <div><small>IDENTIDADE NO YOUTUBE</small><strong>{data.user.youtubeChannel?.title ?? "Canal ainda não conectado"}</strong><span>{data.user.youtubeChannel ? "Seu nome e ícone de canal acompanham suas contribuições no SOS. O canal que publicou cada vídeo continua identificado separadamente." : "Conecte seu canal pela autenticação oficial para mostrar sua identidade nas contribuições e no painel administrativo."}</span></div>
        <button className="secondary compact" type="button" onClick={onConnectYoutube}>{data.user.youtubeChannel ? "Atualizar canal":"Conectar canal"}</button>
      </section>

      <div className="account-menu-actions">
        {canOpenAdmin&&<button className="primary" disabled={busy} onClick={()=>void openAdmin()}><UserCog size={17}/>{ownerSessionExists?"Voltar ao painel administrativo":"Abrir painel administrativo"}</button>}
        <button className="secondary" onClick={onLogout}><LogOut size={17}/>Sair da minha conta</button>
      </div>

      <WatchTimeSummary rewards={data.watchRewards}/>

      {profile&&<>
        <section className="account-metrics">
          <article><BarChart3/><span>URLs compartilhadas</span><strong>{profile.activity.submissions}</strong><small>em {profile.activity.rounds} fila{profile.activity.rounds===1?"":"s"}</small></article>
          <article><CheckCircle2/><span>Playlists criadas</span><strong>{profile.activity.playlists}</strong><small>{profile.activity.completedTasks} tarefa{profile.activity.completedTasks===1?"":"s"} concluída{profile.activity.completedTasks===1?"":"s"}</small></article>
          <article><WalletCards/><span>Moedas compradas</span><strong>{profile.purchases.coinsPurchased}</strong><small>{profile.purchases.bonusPasses} passe{profile.purchases.bonusPasses===1?"":"s"} bônus recebido{profile.purchases.bonusPasses===1?"":"s"}</small></article>
          <article><WalletCards/><span>Passes comprados</span><strong>{profile.purchases.passesPurchased}</strong><small>{money(profile.purchases.approvedSpendCents)} em compras aprovadas</small></article>
        </section>

        <section className="account-access-card">
          <div><ShieldCheck size={20}/><div><span>Seu acesso</span><strong>{accessTitle}</strong></div></div>
          <p>{accessCopy}</p>
          <div className="account-access-meta"><span>Fila atual: <strong>FILA {data.openRound.sequence}</strong></span>{administrative?<span>Perfil: <strong>{administrativeLabel}</strong></span>:<><span>Grupo: <strong>SOS YOUTUBER {profile.access.groupCode}</strong></span><span>Origem: <strong>{profile.access.source ?? "—"}</strong></span></>}{!administrative&&profile.access.lastSyncedAt&&<span>Última conferência: <strong>{when(profile.access.lastSyncedAt)}</strong></span>}</div>
        </section>

        <section className="account-history">
          <div className="section-title"><div><p className="eyebrow dark">HISTÓRICO</p><h3>Minhas compras</h3></div><span>{profile.purchases.history.length} registro{profile.purchases.history.length===1?"":"s"}</span></div>
          {!profile.purchases.history.length?<p className="muted">Você ainda não fez nenhuma compra.</p>:<div className="account-purchase-list">
            {profile.purchases.history.map((purchase)=><article key={purchase.id}>
              <div><strong>{productName(purchase.productCode)}</strong><span>{when(purchase.approvedAt ?? purchase.createdAt)}</span></div>
              <div><strong>{money(purchase.amountCents)}</strong><span>{paymentStatus(purchase.status)} · {purchase.provider==="DEMO"?"Simulação":purchase.provider}</span></div>
            </article>)}
          </div>}
        </section>
      </>}

      <section className="account-danger-zone">
        <div><strong>Quer remover sua conta?</strong><p>Você perde o acesso imediatamente. Avatar, conexão YouTube, progresso pessoal e vínculo com o grupo são removidos. O SOS mantém apenas registros financeiros necessários e um identificador anônimo informando ao Owner que este ID foi excluído.</p></div>
        <button className="danger-button" onClick={()=>setConfirmDelete(true)}><Trash2 size={16}/>Excluir minha conta</button>
      </section>

      {error&&<p className="error" role="alert">{error}</p>}
      {confirmDelete&&<div className="account-delete-confirm" role="alertdialog" aria-modal="true" aria-label="Confirmar exclusão da conta">
        <div><Trash2 size={24}/><h3>Tem certeza de que quer apagar sua conta?</h3><p>Esta ação remove seu cadastro operacional e não pode restaurar este mesmo ID. Se um dia quiser voltar, você fará um novo cadastro e passará novamente pela autorização do grupo.</p></div>
        <div className="ready-actions"><button className="secondary" disabled={busy} onClick={()=>setConfirmDelete(false)}>Quero continuar no SOS</button><button className="danger-button" disabled={busy} onClick={()=>void removeAccount()}>{busy?"Excluindo com segurança…":"Sim, excluir minha conta"}</button></div>
      </div>}
    </section>
  </div>;
}
