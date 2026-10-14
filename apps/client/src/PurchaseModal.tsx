import { useModalLifecycle } from "./useModalLifecycle";
import { useEffect, useState, type FormEvent } from "react";
import { Check, Copy, Gift, ShieldCheck, Sparkles, Ticket, X } from "lucide-react";
import {CommerceArtwork} from "./CommerceArtwork";
import {benefitLabels,productKind,productExplanation} from "./commerce";
import { api, type CommerceProduct, type Pix, type PaymentState, type PurchaseReceipt } from "./api";

// AUDITORIA / loja configurável: a cópia é derivada do produto que o servidor
// informou (título, moedas, passes), com imagem conforme o benefício.
function describe(item:CommerceProduct){
 return {title:item.title,description:item.description,benefit:productExplanation(item),
  eyebrow:item.subscriptionDays?"SEU MOMENTO SUPER":"LOJA SOS YOUTUBER",
  success:"Pagamento confirmado: "+benefitLabels(item).join(" + ")+".",
  kind:productKind(item)};
}
const money=(cents:number)=>(cents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const providerName=(value?:string)=>value==="MERCADO_PAGO"?"Mercado Pago":value==="ASAAS"?"Asaas":value==="PAGBANK"?"PagBank":value==="DEMO"?"Simulação":"provedor Pix";

export function PurchaseModal({product,productInfo,onClose,onApproved,onTracked,paymentStates}:{product:string;productInfo?:CommerceProduct;onClose:()=>void;onApproved:(receipt:PurchaseReceipt)=>void;onTracked:(pix:Pix)=>void;paymentStates:Record<string,PaymentState>}) {

  const copy=productInfo?describe(productInfo):undefined;
  const [form,setForm]=useState({email:"",cpf:""});
  const [createdPix,setPix]=useState<Pix>();
  const observed=createdPix?paymentStates[createdPix.id]:undefined;
  const pix=createdPix?{...createdPix,...observed}:undefined;
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [copied,setCopied]=useState(false);

  const modalRef=useModalLifecycle(onClose);

  async function create(event:FormEvent) {
    event.preventDefault();setBusy(true);setError("");
    try {
      const result=await api.createPix(form.email,form.cpf,product);
      onTracked(result);
      if(result.status==="APPROVED"&&result.receipt)onApproved(result.receipt);else setPix(result);
    } catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível gerar o Pix.");}
    finally{setBusy(false);}
  }

  useEffect(()=>{
    if(observed?.status==="APPROVED"&&observed.receipt)onApproved(observed.receipt);
  },[observed,onApproved]);

  async function demoApprove(){
    if(!pix)return;setBusy(true);setError("");
    try{await api.approveDemoPix(pix.id);const confirmed=await api.paymentStatus(pix.id);
      if(confirmed.receipt)onApproved(confirmed.receipt);
      else setError("O pagamento ainda está sendo confirmado. Seu pedido permanece salvo.");}
    catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível concluir a simulação.");}
    finally{setBusy(false);}
  }

  async function copyPix(){
    if(!pix?.qrCode)return;
    try{await navigator.clipboard.writeText(pix.qrCode);setCopied(true);window.setTimeout(()=>setCopied(false),1800);}
    catch{setError("Não conseguimos copiar automaticamente. Selecione o código abaixo e copie manualmente.");}
  }

  if(!productInfo||!copy) return <div className="modal-backdrop purchase-backdrop" onMouseDown={onClose}><section className="modal purchase-modal" role="dialog" aria-modal="true"><button className="close" aria-label="Fechar" onClick={onClose}><X size={20}/></button><p className="muted" style={{padding:"2rem"}}>Este item não está mais disponível. Atualize a loja.</p></section></div>;

  return <div className="modal-backdrop purchase-backdrop" onMouseDown={onClose}>
    <section ref={modalRef} className="modal purchase-modal" role="dialog" aria-modal="true" aria-label={"Comprar "+copy.title} onMouseDown={(event)=>event.stopPropagation()}>
      <button className="close" aria-label="Fechar compra" onClick={onClose}><X size={20}/></button>
      <div className="purchase-hero">
        <div className="purchase-product-art">{productInfo.imageDataUrl?<img className="purchase-product-image" src={productInfo.imageDataUrl} alt=""/>:<CommerceArtwork kind={copy.kind}/>}</div>
        <div><p className="eyebrow dark">{copy.eyebrow}</p><h2>{copy.title}</h2><div className="purchase-price"><strong>{money(productInfo.amountCents)}</strong></div><small className="purchase-server-note">Preço e benefício confirmados pelo servidor</small></div>
      </div>
      <div className="purchase-explain">
        <p>{copy.description}</p>
        <p><Gift size={17}/><span>{copy.benefit}</span></p>
      </div>
      {!pix ? <form className="purchase-form" onSubmit={create}>
        <div className="purchase-data-note"><ShieldCheck size={20}/><div><strong>Pagamento identificado e conciliado</strong><span>Seu e-mail e CPF identificam o pagamento no provedor Pix. Esses dois campos não ficam no histórico de compras do SOS.</span></div></div>
        <label>E-mail do pagador<input type="email" autoComplete="email" value={form.email} onChange={(event)=>setForm({...form,email:event.target.value})} placeholder="Seu e-mail para o pagamento" required/></label>
        <label>CPF do pagador<input inputMode="numeric" autoComplete="off" value={form.cpf} onChange={(event)=>setForm({...form,cpf:event.target.value.replace(/\D/g,"").slice(0,11)})} placeholder="11 números" minLength={11} required/></label>
        {error&&<p className="error" role="alert">{error}</p>}
        <button className="primary purchase-submit" disabled={busy||form.cpf.length!==11}>{busy?"Gerando seu Pix…":"Gerar Pix de "+money(productInfo.amountCents)}</button>
      </form> : <div className="pix-result purchase-result">
        <div className="pix-state-head"><ShieldCheck size={19}/><div><strong>Cobrança criada</strong><span>{providerName(pix.provider)} · o crédito só acontece após confirmação</span></div></div>
        {pix.qrCodeBase64&&<img className="pix-qr" src={"data:image/png;base64,"+pix.qrCodeBase64} alt="QR Code Pix"/>}
        {pix.qrCode&&<><div className="pix-copy-head"><p>Pix copia e cola</p><button className="text-button" onClick={()=>void copyPix()}><Copy size={15}/>{copied?"Copiado":"Copiar"}</button></div><textarea readOnly value={pix.qrCode}/></>}
        {pix.providerPaymentId.startsWith("demo_")&&<div className="demo-code"><Sparkles size={20}/><strong>Simulação segura</strong><span>Nenhum dinheiro será movimentado neste ambiente de teste.</span></div>}
        {pix.providerPaymentId.startsWith("demo_")&&<button className="primary" onClick={()=>void demoApprove()} disabled={busy}>Simular confirmação</button>}
        {!pix.providerPaymentId.startsWith("demo_")&&<p role="status" className="purchase-wait">{pix.status==="PENDING"?"Aguardando confirmação do provedor. Esta tela consulta o servidor automaticamente a cada 10 segundos. Você pode fechar esta janela; o pedido fica salvo.":"Este Pix não foi aprovado. Nenhum crédito foi aplicado."}</p>}
        {["CANCELLED","REJECTED"].includes(pix.status)&&<button className="secondary" onClick={()=>setPix(undefined)}>Gerar outro Pix</button>}
        {pix.ticketUrl&&<a className="secondary" href={pix.ticketUrl} target="_blank" rel="noreferrer">Abrir página do pagamento</a>}
        {error&&<p className="error" role="alert">{error}</p>}
        {pix.status==="APPROVED"&&<div className="notice"><Check size={17}/>Pagamento confirmado pelo servidor.</div>}
      </div>}
      <small className="purchase-footnote"><Ticket size={14}/> A compra fica vinculada ao seu ID e aparece no histórico da sua conta e no painel Owner.</small>
    </section>
  </div>;
}
