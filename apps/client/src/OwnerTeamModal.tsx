import { useEffect, useState } from "react";
import { ShieldCheck, UserPlus, Users, X } from "lucide-react";
import { ownerApi, type OwnerTeamCandidate, type OwnerTeamEntry } from "./api";
import { useModalLifecycle } from "./useModalLifecycle";

export function OwnerTeamModal({onClose}:{onClose:()=>void}) {
  const [owners,setOwners]=useState<OwnerTeamEntry[]>([]);
  const [candidates,setCandidates]=useState<OwnerTeamCandidate[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const modalRef=useModalLifecycle(onClose);

  async function load(){
    try{
      const result=await ownerApi.team();
      setOwners(result.owners);setCandidates(result.candidates);setError("");
    }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível carregar a equipe.");}
  }
  useEffect(()=>{void load();},[]);

  async function promote(userId:string){
    setBusy(true);setError("");setNotice("");
    try{const result=await ownerApi.promoteOwner(userId);setNotice(result.name+" agora possui acesso de Administrador.");await load();}
    catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível adicionar este administrador.");}
    finally{setBusy(false);}
  }
  async function revoke(id:string){
    setBusy(true);setError("");setNotice("");
    try{await ownerApi.revokeOwner(id);setNotice("Acesso administrativo revogado. O perfil de participante foi preservado.");await load();}
    catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível revogar este administrador.");}
    finally{setBusy(false);}
  }

  return <div className="modal-backdrop owner-team-backdrop" onMouseDown={onClose}>
    <section ref={modalRef} className="modal owner-team-modal" role="dialog" aria-modal="true" aria-label="Equipe administrativa" onMouseDown={(event)=>event.stopPropagation()}>
      <button className="close" aria-label="Fechar equipe administrativa" onClick={onClose}><X size={19}/></button>
      <div className="owner-team-head"><span><ShieldCheck size={24}/></span><div><p className="eyebrow dark">OWNER PRINCIPAL</p><h2>Equipe administrativa</h2><p>Administradores podem operar a comunidade, filas e participantes, mas não recebem acesso às configurações sensíveis nem podem promover outros Owners.</p></div></div>

      {notice&&<div className="notice" role="status">{notice}</div>}
      {error&&<p className="error banner" role="alert">{error}</p>}

      <section className="owner-team-section">
        <div className="owner-team-title"><Users size={17}/><div><strong>Acessos atuais</strong><span>Perfis administrativos reconhecidos pelo servidor</span></div></div>
        <div className="owner-team-list">
          {owners.map((item)=><article key={item.id} className={!item.active?"disabled":""}>
            <div className="owner-team-person"><span>{item.name.slice(0,1).toUpperCase()}</span><div><strong>{item.name}</strong><small>{item.phone}</small></div></div>
            <div className="owner-team-role"><b>{item.role==="ROOT_OWNER"?"Owner principal":"Administrador"}</b><small>{item.static?"Acesso principal configurado":"Vinculado a usuário verificado"}</small></div>
            {!item.static&&item.active&&<button className="secondary compact" disabled={busy} onClick={()=>void revoke(item.id)}>Revogar admin</button>}
            {!item.active&&<span className="table-status off">Revogado</span>}
          </article>)}
        </div>
      </section>

      <section className="owner-team-section">
        <div className="owner-team-title"><UserPlus size={17}/><div><strong>Adicionar Administrador</strong><span>Escolha um authid nome + número que já esteja autenticado e aprovado como participante. Somente Owners principais podem promover ou revogar.</span></div></div>
        {!candidates.length ? <div className="owner-team-empty">Nenhum usuário elegível aguardando promoção.</div> : <div className="owner-candidate-list">
          {candidates.map((item)=><article key={item.id}><div><strong>{item.name}</strong><small>{item.phone} · SOS YOUTUBER {item.groupCode}</small></div><button className="primary compact" disabled={busy} onClick={()=>void promote(item.id)}>Adicionar como Admin</button></article>)}
        </div>}
      </section>
      <p className="owner-team-footnote">A promoção usa o mesmo usuário já autenticado e aprovado. Nenhuma senha administrativa nova é criada ou exibida.</p>
    </section>
  </div>;
}
