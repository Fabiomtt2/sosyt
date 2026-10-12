import { Coins, History, Package, ShieldCheck, Sparkles, Ticket, X } from "lucide-react";
import { useModalLifecycle } from "./useModalLifecycle";
import type { Dashboard } from "./api";

const money=(cents:number)=>(cents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const provider=(value:Dashboard["commerce"]["provider"])=>value==="MERCADO_PAGO"?"Mercado Pago":value==="ASAAS"?"Asaas":value==="PAGBANK"?"PagBank":value==="DEMO"?"simulação de teste":"não configurado";
const status=(value:string)=>value==="APPROVED"?"Confirmado":value==="PENDING"?"Aguardando Pix":value==="CANCELLED"?"Cancelado":value==="REJECTED"?"Não aprovado":value;

// AUDITORIA / loja configurável: os produtos vêm do servidor (editáveis no painel),
// então a loja renderiza uma lista dinâmica em vez de dois cards fixos.
export function StoreModal({data,onClose,onChoose}:{data:Dashboard;onClose:()=>void;onChoose:(product:string)=>void}) {
  const modalRef=useModalLifecycle(onClose);
  const products=data.commerce.products;
  const history=data.profile?.purchases.history.slice(0,5) ?? [];
  const blocked=!data.commerce.pixAvailable||Boolean(data.wallet.paymentHold);
  const titleFor=(code:string)=>products.find((item)=>item.code===code)?.title ?? (code==="LEGACY"?"Compra anterior":code);
  const paymentCopy=data.commerce.pixAvailable
    ? "Pagamento por Pix via "+provider(data.commerce.provider)+". O benefício entra na sua conta somente depois da confirmação do servidor."
    : "As compras ficam disponíveis quando o Owner concluir a configuração do Pix. Suas moedas e recompensas atuais continuam normais.";

  return <div className="modal-backdrop store-backdrop" onMouseDown={onClose}>
    <section ref={modalRef} className="modal store-modal store-modal-v2 store-editorial" role="dialog" aria-modal="true" aria-label="Loja SOS YouTuber" onMouseDown={(event)=>event.stopPropagation()}>
      <button className="close" aria-label="Fechar loja" onClick={onClose}><X size={20}/></button>

      <div className="store-head store-head-v2">
        <div className="store-title-copy">
          <p className="eyebrow dark">LOJA SOS YOUTUBER</p>
          <h2>Escolha o que ajuda na sua jornada</h2>
          <p>Comprar é opcional. Você continua ganhando moedas ao acompanhar as tarefas da comunidade.</p>
        </div>
        <div className="store-balance" aria-label="Saldo atual">
          <span>Você tem agora</span>
          <div><strong><Coins size={18}/>{data.wallet.total.toLocaleString("pt-BR",{maximumFractionDigits:3})}<small>moedas</small></strong><strong><Ticket size={18}/>{data.wallet.extraPasses}<small>passes</small></strong></div>
        </div>
      </div>

      <div className="store-products store-products-v2">
        {products.length===0 && <p className="muted">Nenhum item disponível na loja no momento.</p>}
        {products.map((item)=>(
          <article key={item.code} className="store-product store-product-v2 coins-product">
            <div className="store-product-visual coins-visual">
              {/* AUDITORIA: a ilustracao vem do painel. Sem imagem definida, um
                  marcador neutro mantem o layout inteiro enquanto o Owner decide. */}
              {item.imageDataUrl
                ? <img className="store-editorial-art" src={item.imageDataUrl} alt={item.title}/>
                : <div className={`store-art-placeholder ${item.credits>0?"coins":item.extraPasses>0?"pass":item.subscriptionDays?"super":"item"}`} aria-hidden="true">
                    {item.credits>0?<Coins size={48}/>:item.extraPasses>0?<Ticket size={48}/>:item.subscriptionDays?<Sparkles size={48}/>:<Package size={48}/>}
                  </div>}
            </div>
            <div className="store-product-copy store-product-copy-v2">
              <h3>{item.title}</h3>
              <p>{item.description || (item.credits>0?`${item.credits} moedas para salvar URLs na fila.`:`${item.extraPasses} passe para uma contribuição extra.`)}</p>
              <ul className="store-product-benefits">
                {item.credits>0 && <li><Coins size={15}/> {item.credits} moedas</li>}
                {item.extraPasses>0 && <li><Ticket size={15}/> {item.extraPasses} passe{item.extraPasses>1?"s":""}</li>}
                {item.grantsItem && (item.grantsItemQty ?? 0)>0 && <li><Package size={15}/> {item.grantsItemQty} {item.grantsItem==="SKIP"?"Pular":item.grantsItem}</li>}
                {(item.subscriptionDays ?? 0)>0 && <li><Sparkles size={15}/> {item.subscriptionDays} dias de assinatura</li>}
              </ul>
              <div className="store-buy-row"><strong className="store-price">{money(item.amountCents)}</strong><button className="primary" disabled={blocked} onClick={()=>onChoose(item.code)}>Quero este item</button></div>
            </div>
          </article>
        ))}
      </div>

      <div className="store-meaning-row" aria-label="Como funcionam moedas e passes">
        <span><Coins size={16}/><b>1 moeda</b> salva 1 URL</span>
        <span><Ticket size={16}/><b>1 passe</b> libera uma posição extra</span>
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
