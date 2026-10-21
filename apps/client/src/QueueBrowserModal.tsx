import {useEffect,useRef,useState} from "react";
import type {MyQueue,Round} from "./api";
import {UserAvatarView} from "./AvatarModal";
import {useModalLifecycle} from "./useModalLifecycle";
import "./queue-browser.css";

export type QueueBrowserMode="VIEW"|"SKIP"|"PASS";
export type QueueBrowserEntry=MyQueue&{joined:boolean;canResume?:boolean;expiresAt?:string};
export type QueueBrowserModalProps={
 mode:QueueBrowserMode;queues:QueueBrowserEntry[];selectedQueueId?:string;
 preview?:Round;previewLoading?:boolean;previewError?:string;busy?:boolean;error?:string;
 skipsAvailable:number;passesAvailable:number;administrative?:boolean;
 onSelect:(roundId:string|undefined)=>void;onConfirm:(targetRoundId?:string)=>void|Promise<void>;onClose:()=>void;
 onModeChange?:(mode:QueueBrowserMode)=>void;onOpenJoined?:(roundId:string)=>void;onOpenStore?:()=>void;onOpenProfile?:(userId:string)=>void;
};
const expires=(stamp?:string)=>stamp&&Number.isFinite(Date.parse(stamp))?new Date(stamp).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):undefined;
/** Read-only previews and explicit item confirmation. The parent owns every HTTP operation. */
export function QueueBrowserModal({mode,queues,selectedQueueId,preview,previewLoading=false,previewError,busy=false,error,
 skipsAvailable,passesAvailable,administrative=false,onSelect,onConfirm,onClose,onModeChange,onOpenJoined,onOpenStore,onOpenProfile}:QueueBrowserModalProps){
 const [confirming,setConfirming]=useState(false),[working,setWorking]=useState(false),[localError,setLocalError]=useState("");
 const confirmationLock=useRef(false),blocked=busy||working;
 const modal=useModalLifecycle(onClose,true,!blocked);
 const selected=queues.find(queue=>queue.id===selectedQueueId),item=mode==="PASS"?"Passe":"Pular";
 const stock=mode==="PASS"?passesAvailable:skipsAvailable;
 const selectionExists=selectedQueueId===undefined||Boolean(selected);
 const expired=Boolean(selected?.expiresAt&&Date.parse(selected.expiresAt)<=Date.now());
 const destinationAvailable=selectionExists&&!expired&&(!selected||((selected.status==="OPEN"&&selected.vacancies>0||mode==="SKIP"&&selected.status==="READY")&&!selected.joined));
 const canConfirm=mode!=="VIEW"&&(administrative||stock>0)&&destinationAvailable;
 const shownPreview=preview?.id===selectedQueueId?preview:undefined;
 useEffect(()=>{setConfirming(false);setLocalError("");},[mode,selectedQueueId]);
 async function confirm(){
  if(!canConfirm||blocked||confirmationLock.current)return;
  confirmationLock.current=true;setWorking(true);setLocalError("");
  try{await onConfirm(selectedQueueId);}catch(cause){setLocalError(cause instanceof Error?cause.message:"Não foi possível liberar esta fila. Seu saldo será conferido antes de tentar novamente.");}
  finally{confirmationLock.current=false;setWorking(false);}
 }
 const destination=selected?"Fila "+selected.number:"próxima fila elegível";
 return <div className="modal-backdrop queue-browser-backdrop" onMouseDown={()=>{if(!blocked)onClose();}}>
  <section ref={modal} className="modal queue-browser-modal" role="dialog" aria-modal="true" aria-label="Explorar filas da comunidade" onMouseDown={event=>event.stopPropagation()}>
   <button className="close" type="button" aria-label="Fechar explorador de filas" disabled={blocked} onClick={onClose}>×</button>
   <header className="queue-browser-heading"><p className="eyebrow dark">FILAS DA COMUNIDADE</p><h2>{mode==="VIEW"?"Encontre sua próxima seleção.":"Escolha onde usar seu "+item+"."}</h2><p>Explore os vídeos sem consumir itens. Cada fila fica disponível por até 72 horas desde a abertura; os links e o histórico são preservados depois do encerramento.</p>
    <div className="queue-browser-stock"><span>Passe <b>{administrative?"ADMIN":passesAvailable}</b></span><span>Pular <b>{administrative?"ADMIN":skipsAvailable}</b></span></div>
   </header>
   <div className="queue-browser-body">
    <section className="queue-browser-directory" aria-label="Todas as filas da comunidade">
     {!queues.length&&<p className="queue-browser-empty">Nenhuma fila ativa para explorar agora. A próxima abertura aparecerá aqui.</p>}
     <div className="queue-browser-grid">{queues.map(queue=>{
      const occupied=Math.max(0,Math.min(10,10-queue.vacancies)),deadline=expires(queue.expiresAt);
      return <button type="button" key={queue.id} disabled={blocked} className={"queue-browser-card"+(queue.id===selectedQueueId?" is-selected":"")} aria-pressed={queue.id===selectedQueueId} onClick={()=>onSelect(queue.id)}>
       <span className="queue-browser-card-head"><strong>Fila {queue.number}</strong><b>{occupied}/10</b></span>
       <span className="queue-browser-meter" aria-hidden="true"><i style={{width:occupied*10+"%"}}/></span>
       <span className={"queue-browser-access"+(queue.joined?" is-joined":"")}>{queue.joined?"Seu acesso liberado":queue.status==="READY"?"Pronta para acompanhar":`${queue.vacancies} ${queue.vacancies===1?"vaga":"vagas"} · explorar`}</span>
       <small>{deadline?"Até "+deadline:"Validade de até 3 dias"}</small>
      </button>;
     })}</div>
     {mode!=="VIEW"&&<button type="button" className={"queue-browser-automatic"+(selectedQueueId===undefined?" is-selected":"")} aria-pressed={selectedQueueId===undefined} disabled={blocked} onClick={()=>onSelect(undefined)}><strong>Escolher a próxima fila com vaga</strong><span>O sistema usa a primeira fila elegível. Se não houver uma, abre a próxima.</span></button>}
    </section>
    <section className="queue-browser-preview" aria-label="Prévia da fila selecionada">
     <div className="queue-browser-preview-title"><h3>{selected?"Dentro da Fila "+selected.number:"Explore antes de escolher"}</h3><span>Somente leitura</span></div>
     {!selectedQueueId&&<p className="queue-browser-empty">Toque em uma fila para ver seus vídeos e criadores. Olhar não libera participação nem consome seu inventário.</p>}
     {previewLoading&&selectedQueueId&&<p role="status" className="queue-browser-empty">Buscando a seleção…</p>}
     {previewError&&<p role="alert" className="queue-browser-error">{previewError}</p>}
     {shownPreview&&!previewLoading&&<>
      {!shownPreview.slots.some(slot=>slot.videoId)&&<p className="queue-browser-empty">Os espaços desta fila ainda estão esperando os primeiros vídeos.</p>}
      <div className="queue-browser-videos">{shownPreview.slots.filter(slot=>slot.videoId).map(slot=><article className={"queue-browser-video"+(slot.videoThumbnailUrl?" has-thumbnail":"")} key={slot.slot}>
       {slot.videoThumbnailUrl&&<img className="queue-browser-thumbnail" src={slot.videoThumbnailUrl} alt="" loading="lazy"/>}
       <div><small>POSIÇÃO {slot.slot}</small><a href={slot.youtubeUrl} target="_blank" rel="noreferrer">{slot.videoTitle||"Vídeo da comunidade"}</a>
        {slot.userId&&onOpenProfile?<button type="button" className="queue-browser-author" onClick={()=>onOpenProfile(slot.userId!)}><UserAvatarView avatar={slot.avatar} name={slot.userName??"Criador"} presentation={slot.presentation}/><span>{slot.userName??"Criador"}</span></button>:<span className="queue-browser-author"><UserAvatarView avatar={slot.avatar} name={slot.userName??"Criador"} presentation={slot.presentation}/><span>{slot.userName??"Criador"}</span></span>}
       </div>
      </article>)}</div>
     </>}
    </section>
   </div>
   <footer className="queue-browser-footer">
    {selected?.joined&&<div className="queue-browser-decision"><p>Esta fila já está liberada para você. Nenhum item precisa ser consumido.</p>{onOpenJoined&&<button type="button" className="primary" disabled={blocked} onClick={()=>onOpenJoined(selected.id)}>Abrir minha Fila {selected.number}</button>}</div>}
    {!selected?.joined&&mode==="VIEW"&&<div className="queue-browser-decision"><p>Para participar de outra fila, escolha um item. Comprar adiciona ao inventário; só a confirmação de uso libera a fila.</p><div className="queue-browser-actions">
     {onModeChange&&<><button type="button" className="secondary" disabled={blocked} onClick={()=>onModeChange("PASS")}>Usar Passe</button><button type="button" className="primary" disabled={blocked} onClick={()=>onModeChange("SKIP")}>Usar Pular</button></>}
     {onOpenStore&&<button type="button" className="text-button" disabled={blocked} onClick={onOpenStore}>Conhecer os itens na loja</button>}
    </div></div>}
    {!selected?.joined&&mode!=="VIEW"&&<>
     {!destinationAvailable&&<p className="queue-browser-error" role="status">{mode==="PASS"&&selected?.status==="READY"?"Passe libera entrada em uma fila em montagem. Para acompanhar uma fila pronta de 10 vídeos, use Pular.":"Esta fila expirou ou não está disponível para este acesso. Escolha outra fila."}</p>}
     {!administrative&&stock<=0&&<div className="queue-browser-decision"><p>Você ainda não tem {item} disponível. Comprar entrega o item ao inventário; a compra não o consome automaticamente.</p>{onOpenStore&&<button type="button" className="primary" disabled={blocked} onClick={onOpenStore}>Ver {item} na loja</button>}</div>}
     {canConfirm&&!confirming&&<div className="queue-browser-decision"><p>{administrative?"Seu acesso administrativo não consome itens.":`Você usará 1 ${item} para ${selected?.status==="READY"?"acompanhar os 10 vídeos da fila pronta":"entrar na fila em montagem e poder enviar sua URL"}. As filas atuais, seus links e seu progresso continuam preservados.`}</p><button type="button" className="primary" disabled={blocked} onClick={()=>setConfirming(true)}>{administrative?"Liberar ":"Usar 1 "+item+" na "}{destination}</button></div>}
     {confirming&&canConfirm&&<section className="queue-browser-confirm" role="alertdialog" aria-modal="false" aria-label={"Confirmar uso de "+item}><strong>{administrative?"Liberar acesso à ":"Usar 1 "+item+" na "}{destination}?</strong><p>{administrative?"Nenhum item será debitado.":`A confirmação consome 1 ${item} e libera ${selected?.status==="READY"?"o acompanhamento dos 10 vídeos":"sua participação para enviar uma URL"} na ${destination}.`} As outras filas continuam disponíveis. O item não conclui vídeos nem gera recompensas por si só.</p><div className="queue-browser-actions"><button type="button" className="secondary" autoFocus disabled={blocked} onClick={()=>setConfirming(false)}>Voltar à escolha</button><button type="button" className="primary" disabled={blocked} onClick={()=>void confirm()}>{blocked?"Liberando acesso…":administrative?"Confirmar acesso":"Confirmar uso de 1 "+item}</button></div></section>}
    </>}
    {(localError||error)&&<p role="alert" className="queue-browser-error">{localError||error}</p>}
   </footer>
  </section>
 </div>;
}
