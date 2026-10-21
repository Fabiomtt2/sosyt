import { RedemptionCelebration, type ConfirmedRedemption } from "./RedemptionCelebration";
import { useRef, useState } from "react";
import {productKind,productExplanation} from "./commerce";
import { InventoryOverview } from "./UserWallet";
import { CommerceArtwork } from "./CommerceArtwork";
import { History, ShieldCheck, Sparkles, X } from "lucide-react";
import { useModalLifecycle } from "./useModalLifecycle";
import { api, type Dashboard } from "./api";

const money=(cents:number)=>(cents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const provider=(value:Dashboard["commerce"]["provider"])=>value==="MERCADO_PAGO"?"Mercado Pago":value==="ASAAS"?"Asaas":value==="PAGBANK"?"PagBank":value==="DEMO"?"simulação de teste":"não configurado";
const status=(value:string)=>value==="APPROVED"?"Confirmado":value==="PENDING"?"Aguardando Pix":value==="CANCELLED"?"Cancelado":value==="REJECTED"?"Não aprovado":value;

// AUDITORIA / loja configurável: os produtos vêm do servidor (editáveis no painel),
// então a loja renderiza uma lista dinâmica em vez de dois cards fixos.
export function StoreModal({data,onClose,onChoose,onChanged}:{data:Dashboard;onClose:()=>void;onChoose:(product:string)=>void;onChanged?:()=>Promise<void>}) {
  const [trading,setTrading]=useState<string>();
  const [notice,setNotice]=useState("");
  const [redemptionReceipt,setRedemptionReceipt]=useState<ConfirmedRedemption>();
  const tradingLock=useRef(false);
  const references=useRef<Partial<Record<"SKIP"|"PASS",string>>>({});
  async function trade(code:"SKIP"|"PASS"){
    if(tradingLock.current)return;tradingLock.current=true;setTrading(code);setNotice("");
    const reference=references.current[code]??crypto.randomUUID();references.current[code]=reference;
    try{const result=await api.redeemReward(code,reference);delete references.current[code];setRedemptionReceipt({code,price:result.price,replayed:result.replayed});setNotice((code==="SKIP"?"Pular":"Passe")+" chegou ao seu inventário.");try{await onChanged?.();}catch{setNotice("Troca confirmada. O saldo será atualizado quando a conexão voltar.");}}
    catch(e){setNotice(e instanceof Error?e.message:"Não foi possível concluir a troca.");}
    finally{tradingLock.current=false;setTrading(undefined);}
  }
  const modalRef=useModalLifecycle(()=>{if(!tradingLock.current)onClose();},true,!trading);
  const products=data.commerce.products.map((item,index)=>({item,index})).sort((a,b)=>Number((b.item.subscriptionDays??0)>0)-Number((a.item.subscriptionDays??0)>0)||a.index-b.index).map(({item})=>item);
  const history=data.profile?.purchases.history.slice(0,5) ?? [];
  const blocked=!data.commerce.pixAvailable||Boolean(data.wallet.paymentHold);
  const titleFor=(code:string)=>products.find((item)=>item.code===code)?.title ?? (code==="LEGACY"?"Compra anterior":code);
  const paymentCopy=data.commerce.pixAvailable
    ? "Pagamento por Pix via "+provider(data.commerce.provider)+". O benefício entra na sua conta somente depois da confirmação do servidor."
    : "As compras ficam disponíveis quando o Owner concluir a configuração do Pix. Suas moedas e recompensas atuais continuam normais.";

  return <div className="modal-backdrop store-backdrop premium-store-backdrop" onMouseDown={()=>{if(!tradingLock.current)onClose();}}>
    <section ref={modalRef} className="modal store-modal store-modal-v2 store-editorial premium-store store-catalog" role="dialog" aria-modal="true" aria-label="Loja SOS YouTuber" onMouseDown={(event)=>event.stopPropagation()}>
      <button className="close" aria-label="Fechar loja" disabled={Boolean(trading)} onClick={onClose}><X size={20}/></button>

      <div className="store-head store-head-v2">
        <div className="store-title-copy">
          <p className="eyebrow dark">LOJA SOS YOUTUBER</p>
          <h2>Escolha seu próximo impulso.</h2>
          <p>Mais possibilidades para criar e colaborar. Conheça cada benefício e escolha no seu tempo.</p>
        </div>
        <div className="store-balance" aria-label="Saldo atual">
          <span>Você tem agora</span>
          <InventoryOverview wallet={data.wallet} skipsAvailable={data.queues.skipsAvailable} passesAvailable={data.queues.passesAvailable} subscription={data.subscription} label="Benefícios disponíveis"/>

        </div>
      </div>

      {data.subscription?.active&&<p className="store-super-status"><Sparkles size={16}/> {data.subscription.source==="ROOT_OWNER"?"Privilégios SUPER incluídos no seu acesso ADMIN":"SUPER ativo"+(data.subscription.expiresAt?" até "+new Date(data.subscription.expiresAt).toLocaleDateString("pt-BR"):"")}</p>}
      <div className="store-products store-products-v2" aria-label="Vitrine de benefícios">
        {products.length===0 && <p className="muted">Nenhum item disponível na loja no momento.</p>}
        {products.map((item)=>(
          <article key={item.code} className={"store-product store-product-v2 store-kind-"+productKind(item)+((item.subscriptionDays??0)>0?" store-product--super":"")} data-product-code={item.code}>
            <div className="store-product-visual coins-visual">
              {/* Custom catalog art takes precedence; each built-in benefit has its own raster illustration. */}
              {item.imageDataUrl
                ? <img className="store-editorial-art" src={item.imageDataUrl} alt={item.title}/>
                : <CommerceArtwork kind={productKind(item)}/>}
            </div>
            <div className="store-product-copy store-product-copy-v2">
              {(item.subscriptionDays??0)>0&&<span className="store-super-highlight"><Sparkles size={14}/> Experiência SUPER</span>}
              <h3>{item.title}</h3>
              <p>{item.description || (item.credits>0?item.credits+" moedas para suas contribuições.":item.subscriptionDays?"Assinatura por "+item.subscriptionDays+" dias, com benefícios SUPER.":item.grantsItem==="SKIP"?"Participe de outra fila sem perder sua participação na atual.":item.extraPasses>0?item.extraPasses+" passe para liberar +1 URL na mesma fila.":"Confira os benefícios deste item antes de comprar.")}</p>
              {productExplanation(item)&&<details className="store-product-how"><summary>Como usar este benefício</summary><p>{productExplanation(item)}</p></details>}
              <ul className="store-product-benefits">
                {item.credits>0 && <li>{item.credits} moedas</li>}
                {item.extraPasses>0 && <li>{item.extraPasses} passe{item.extraPasses>1?"s":""}</li>}
                {!item.subscriptionDays && item.grantsItem && (item.grantsItemQty ?? 0)>0 && <li>{item.grantsItemQty} {item.grantsItem==="SKIP"?"Pular":item.grantsItem}</li>}
                {(item.subscriptionDays ?? 0)>0 && <li>{item.subscriptionDays} dias de assinatura</li>}
              </ul>
              <div className="store-buy-row"><strong className="store-price">{money(item.amountCents)}</strong><button className="primary" disabled={blocked||Boolean(trading)} onClick={()=>onChoose(item.code)}>Quero este item</button></div>
              {data.gamification?.redemptionEnabled&&item.credits===0&&!item.subscriptionDays&&(item.grantsItem==="SKIP"||item.extraPasses===1)&&<div className="store-reward-trade">
                <span>Ou use {item.grantsItem==="SKIP"?data.gamification.redemption.SKIP:data.gamification.redemption.PASS} moedas de recompensa</span>
                <button type="button" className="secondary" disabled={Boolean(trading)||data.wallet.reward<(item.grantsItem==="SKIP"?data.gamification.redemption.SKIP:data.gamification.redemption.PASS)} onClick={()=>void trade(item.grantsItem==="SKIP"?"SKIP":"PASS")}>Trocar recompensas</button>
              </div>}
            </div>
          </article>
        ))}
      </div>

      {redemptionReceipt&&<RedemptionCelebration receipt={redemptionReceipt} onClose={()=>setRedemptionReceipt(undefined)}/>}
      {notice&&<p role="status">{notice}</p>}
      <div className="store-meaning-row" aria-label="Como funcionam os benefícios">
        <span><b>1 moeda</b> salva 1 URL</span>
        <span><b>Passe</b> libera +1 URL na mesma fila</span><span><b>Pular</b> abre outra fila e mantém a atual</span><span><b>SUPER</b> tem duração e privilégios próprios</span>
      </div>

      <div className={data.commerce.pixAvailable?"store-payment-state ready":"store-payment-state pending"}>
        <ShieldCheck size={18}/><div><strong>{data.commerce.pixAvailable?"Compra protegida por confirmação do Pix":"Loja aguardando configuração do Pix"}</strong><span>{paymentCopy}</span></div>
      </div>

      <details className="store-history store-history-collapsed">
        <summary><History size={17}/><span><strong>Compras recentes</strong><small>{history.length ? history.length+" registro"+(history.length===1?"":"s")+" recente"+(history.length===1?"":"s") : "Nenhuma compra ainda"}</small></span></summary>
        {!history.length?<p className="muted">Quando você fizer uma compra, ela aparecerá aqui e também em Minha conta.</p>:<div className="store-history-list">
          {history.map((item)=><article key={item.id}><div><strong>{titleFor(item.productCode)}</strong><span>{new Date(item.approvedAt ?? item.createdAt).toLocaleString("pt-BR")}</span></div><div><strong>{money(item.amountCents)}</strong><span>{status(item.status)}</span></div></article>)}
        </div>}
      </details>
    </section>
  </div>;
}
