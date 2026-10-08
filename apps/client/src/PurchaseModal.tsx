import { useModalLifecycle } from "./useModalLifecycle";
import { useEffect, useState, type FormEvent } from "react";
import { Check, Copy, Gift, ShieldCheck, Sparkles, Ticket, X } from "lucide-react";
import { api, type CommerceProduct, type PaymentProductCode, type Pix } from "./api";

const COPY:Record<PaymentProductCode,{eyebrow:string;title:(product:CommerceProduct)=>string;description:string;benefit:string;image:string;alt:string;success:(product:CommerceProduct)=>string}> = {
  COINS_LAUNCH:{
    eyebrow:"PROMOÇÃO DE LANÇAMENTO",
    title:(item)=>item.credits+" moedas + "+item.extraPasses+" passe bônus",
    description:"As moedas são créditos internos usados para salvar URLs na fila. Elas ficam registradas na sua carteira do SOS.",
    benefit:"O passe bônus libera uma contribuição extra em uma fila na qual você já participou. A URL extra continua usando 1 moeda.",
    image:"/assets/user/coins.webp",
    alt:"Ilustração do pacote de moedas SOS YouTuber",
    success:(item)=>"Pagamento confirmado: "+item.credits+" moedas e "+item.extraPasses+" passe bônus foram adicionados."
  },
  PASS_SINGLE:{
    eyebrow:"MAIS FLEXIBILIDADE NA FILA",
    title:(item)=>item.extraPasses+" passe",
    description:"O passe libera uma contribuição extra em uma fila na qual você já participou. O saldo de passes fica persistido na sua conta.",
    benefit:"O passe não substitui a moeda: ao usar a posição extra, salvar a nova URL ainda consome 1 moeda.",
    image:"/assets/user/pass.webp",
    alt:"Ilustração do passe SOS YouTuber",
    success:(item)=>"Pagamento confirmado: "+item.extraPasses+" passe foi adicionado à sua conta."
  }
};
const money=(cents:number)=>(cents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const providerName=(value?:string)=>value==="MERCADO_PAGO"?"Mercado Pago":value==="ASAAS"?"Asaas":value==="PAGBANK"?"PagBank":value==="DEMO"?"Simulação":"provedor Pix";

export function PurchaseModal({product,productInfo,onClose,onApproved}:{product:PaymentProductCode;productInfo:CommerceProduct;onClose:()=>void;onApproved:(message:string)=>void}) {
  const copy=COPY[product];
  const [form,setForm]=useState({email:"",cpf:""});
  const [pix,setPix]=useState<Pix>();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [copied,setCopied]=useState(false);

  const modalRef=useModalLifecycle(onClose);

  async function create(event:FormEvent) {
    event.preventDefault();setBusy(true);setError("");
    try {
      const result=await api.createPix(form.email,form.cpf,product);
      if(result.status==="APPROVED") onApproved(copy.success(productInfo)); else setPix(result);
    } catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível gerar o Pix.");}
    finally{setBusy(false);}
  }

  useEffect(()=>{
    if(!pix || pix.providerPaymentId.startsWith("demo_") || pix.status!=="PENDING") return;
    let cancelled=false;
    const poll=async()=>{
      try{
        const result=await api.paymentStatus(pix.id);
        if(cancelled) return;
        setError("");
        if(result.status==="APPROVED") onApproved(copy.success(productInfo));
        else if(result.status!=="PENDING") setPix((current)=>current?{...current,status:result.status}:current);
      }catch(cause){if(!cancelled)setError(cause instanceof Error?cause.message:"Não conseguimos consultar o pagamento agora.");}
    };
    void poll();
    const timer=window.setInterval(()=>void poll(),5000);
    return()=>{cancelled=true;window.clearInterval(timer);};
  },[pix?.id,pix?.status,pix?.providerPaymentId,onApproved,productInfo,copy]);

  async function demoApprove(){
    if(!pix)return;setBusy(true);setError("");
    try{await api.approveDemoPix(pix.id);onApproved(copy.success(productInfo));}
    catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível concluir a simulação.");}
    finally{setBusy(false);}
  }

  async function copyPix(){
    if(!pix?.qrCode)return;
    try{await navigator.clipboard.writeText(pix.qrCode);setCopied(true);window.setTimeout(()=>setCopied(false),1800);}
    catch{setError("Não conseguimos copiar automaticamente. Selecione o código abaixo e copie manualmente.");}
  }

  return <div className="modal-backdrop purchase-backdrop" onMouseDown={onClose}>
    <section ref={modalRef} className="modal purchase-modal" role="dialog" aria-modal="true" aria-label={product==="COINS_LAUNCH"?"Comprar moedas":"Comprar passe"} onMouseDown={(event)=>event.stopPropagation()}>
      <button className="close" aria-label="Fechar compra" onClick={onClose}><X size={20}/></button>
      <div className="purchase-hero">
        <img className="purchase-product-image" src={copy.image} alt={copy.alt}/>
        <div><p className="eyebrow dark">{copy.eyebrow}</p><h2>{copy.title(productInfo)}</h2><div className="purchase-price"><strong>{money(productInfo.amountCents)}</strong></div><small className="purchase-server-note">Preço e benefício confirmados pelo servidor</small></div>
      </div>
      <div className="purchase-explain">
        <p>{copy.description}</p>
        <p><Gift size={17}/><span>{copy.benefit}</span></p>
      </div>
      {!pix ? <form className="purchase-form" onSubmit={create}>
        <div className="purchase-data-note"><ShieldCheck size={20}/><div><strong>Pagamento identificado e conciliado</strong><span>O e-mail e CPF são enviados ao provedor ativo somente para gerar/conciliar esta cobrança. O SOS registra o pedido, produto, valor e estado do pagamento, mas não grava esses dois campos no histórico da compra.</span></div></div>
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
        {!pix.providerPaymentId.startsWith("demo_")&&<p role="status" className="purchase-wait">{pix.status==="PENDING"?"Aguardando confirmação do provedor. Esta tela consulta o servidor automaticamente a cada 5 segundos.":"Este Pix não foi aprovado. Nenhum crédito foi aplicado."}</p>}
        {["CANCELLED","REJECTED"].includes(pix.status)&&<button className="secondary" onClick={()=>setPix(undefined)}>Gerar outro Pix</button>}
        {pix.ticketUrl&&<a className="secondary" href={pix.ticketUrl} target="_blank" rel="noreferrer">Abrir página do pagamento</a>}
        {error&&<p className="error" role="alert">{error}</p>}
        {pix.status==="APPROVED"&&<div className="notice"><Check size={17}/>Pagamento confirmado pelo servidor.</div>}
      </div>}
      <small className="purchase-footnote"><Ticket size={14}/> A compra fica vinculada ao seu ID e aparece no histórico da sua conta e no painel Owner.</small>
    </section>
  </div>;
}
