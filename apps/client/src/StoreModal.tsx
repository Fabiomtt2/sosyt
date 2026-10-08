import { Coins, History, ShieldCheck, Ticket, X } from "lucide-react";
import { useModalLifecycle } from "./useModalLifecycle";
import type { Dashboard, PaymentProductCode } from "./api";

const money=(cents:number)=>(cents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const provider=(value:Dashboard["commerce"]["provider"])=>value==="MERCADO_PAGO"?"Mercado Pago":value==="ASAAS"?"Asaas":value==="PAGBANK"?"PagBank":value==="DEMO"?"simulação de teste":"não configurado";
const status=(value:string)=>value==="APPROVED"?"Confirmado":value==="PENDING"?"Aguardando Pix":value==="CANCELLED"?"Cancelado":value==="REJECTED"?"Não aprovado":value;


export function StoreModal({data,onClose,onChoose}:{data:Dashboard;onClose:()=>void;onChoose:(product:PaymentProductCode)=>void}) {
  const modalRef=useModalLifecycle(onClose);
  const coinsProduct=data.commerce.products.COINS_LAUNCH;
  const passProduct=data.commerce.products.PASS_SINGLE;
  const history=data.profile?.purchases.history.slice(0,5) ?? [];
  const blocked=!data.commerce.pixAvailable||Boolean(data.wallet.paymentHold);
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
        <article className="store-product store-product-v2 coins-product">
          <div className="store-product-visual coins-visual">
            <img className="store-editorial-art" src={import.meta.env.BASE_URL+"assets/user/coins-editorial-v2.webp"} alt="Moedas com símbolo de vídeo e fita ameixa"/>
          </div>
          <div className="store-product-copy store-product-copy-v2">
            <span className="store-badge launch">Promoção de lançamento</span>
            <h3>{coinsProduct.credits} moedas <em>+ {coinsProduct.extraPasses} passe bônus</em></h3>
            <p>Use as moedas para salvar URLs na fila. O passe bônus libera uma contribuição extra na mesma fila; essa nova URL ainda usa 1 moeda.</p>
            <div className="store-buy-row"><strong className="store-price">{money(coinsProduct.amountCents)}</strong><button className="primary" disabled={blocked} onClick={()=>onChoose("COINS_LAUNCH")}>Quero este pacote</button></div>
          </div>
        </article>

        <article className="store-product store-product-v2 pass-product">
          <div className="store-product-visual pass-visual">
            <img className="store-editorial-art" src={import.meta.env.BASE_URL+"assets/user/pass-editorial-v2.webp"} alt="Passe em papel marfim com detalhe dourado"/>
          </div>
          <div className="store-product-copy store-product-copy-v2">
            <span className="store-badge">Mais flexibilidade</span>
            <h3>{passProduct.extraPasses} passe</h3>
            <p>O passe abre mais uma posição para você na mesma fila. Ele não substitui a moeda necessária para salvar a nova URL.</p>
            <div className="store-buy-row"><strong className="store-price">{money(passProduct.amountCents)}</strong><button className="primary" disabled={blocked} onClick={()=>onChoose("PASS_SINGLE")}>Quero 1 passe</button></div>
          </div>
        </article>
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
          {history.map((item)=><article key={item.id}><div><strong>{item.productCode==="COINS_LAUNCH"?"Pacote de moedas + passe":"Passe avulso"}</strong><span>{new Date(item.approvedAt ?? item.createdAt).toLocaleString("pt-BR")}</span></div><div><strong>{money(item.amountCents)}</strong><span>{status(item.status)}</span></div></article>)}
        </div>}
      </details>
    </section>
  </div>;
}
