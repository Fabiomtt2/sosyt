import "./store-catalog.css";
import { ShoppingBag } from "lucide-react";
import { CommerceArtwork } from "./CommerceArtwork";
import type { Dashboard, SuperState } from "./api";

const number = (value?:number) => value === undefined ? "—" : value.toLocaleString("pt-BR", {maximumFractionDigits:3});
const date = (value:string) => new Date(value).toLocaleDateString("pt-BR", {day:"2-digit",month:"2-digit",year:"numeric"});

/** The same four benefits, using current server state, on every personal surface. */
export function InventoryOverview({wallet,skipsAvailable,passesAvailable,subscription,label="Meu inventário",purchaseAnchors=false}:{
  wallet?:Dashboard["wallet"];skipsAvailable?:number;passesAvailable?:number;subscription?:SuperState;label?:string;purchaseAnchors?:boolean;
}) {
  const administrative = subscription?.source === "ROOT_OWNER";
  const passes = passesAvailable ?? wallet?.extraPasses;
  return <section className="inventory-overview wallet-values" aria-label={label}>
    <div className="wallet-value coins-value" data-purchase-anchor={purchaseAnchors?"coins":undefined}><span className="wallet-value-icon wallet-benefit-art" aria-hidden="true"><CommerceArtwork kind="coins"/></span><div><strong>{number(wallet?.total)}</strong><span>Moedas</span>{wallet&&<small className="wallet-coin-sources">Compradas {number(wallet.purchased)} · Recompensas {number(wallet.reward)} · Iniciais {number(wallet.promo)}</small>}</div></div>
    <div className="wallet-value passes-value"><span className="wallet-value-icon wallet-benefit-art" aria-hidden="true"><CommerceArtwork kind="pass"/></span><div><strong>{administrative?"ADMIN":number(passes)}</strong><span>Passe</span><small>{administrative?"Acesso sem consumo":"Outra fila ou contribuição extra"}</small></div></div>
    <div className="wallet-value skips-value"><span className="wallet-value-icon wallet-benefit-art" aria-hidden="true"><CommerceArtwork kind="skip"/></span><div><strong>{administrative?"ADMIN":number(skipsAvailable)}</strong><span>Pular</span><small>{administrative?"Acesso sem consumo":"Outra fila, mantendo a atual"}</small></div></div>
    <div className={"wallet-value super-value"+(subscription?.active?" is-active":"")}><span className="wallet-value-icon wallet-benefit-art" aria-hidden="true"><CommerceArtwork kind="super"/></span><div><strong>{administrative?"ADMIN":subscription?subscription.active?"Ativo":"Inativo":"—"}</strong><span>SUPER</span><small>{administrative?"Privilégio administrativo":subscription?.expiresAt?(subscription.active?"Até ":"Validade registrada: ")+date(subscription.expiresAt):subscription?.active?"Ativo nesta conta":subscription?"Sem assinatura ativa":"Atualizando assinatura"}</small></div></div>
  </section>;
}

export function UserWallet({wallet,skipsAvailable,passesAvailable,subscription,onOpenStore,compact=false}:{wallet:Dashboard["wallet"];skipsAvailable?:number;passesAvailable?:number;subscription?:SuperState;onOpenStore:()=>void;compact?:boolean}) {
  return <aside className={compact?"user-wallet compact":"user-wallet"}>
    {!compact&&<div className="wallet-heading">
      <div><span>Minha conta</span><strong>Sua carteira</strong></div>
      <button className="wallet-store-link" onClick={onOpenStore}><ShoppingBag size={15}/>Abrir Loja</button>
    </div>}
    <InventoryOverview wallet={wallet} skipsAvailable={skipsAvailable} passesAvailable={passesAvailable} subscription={subscription} label="Benefícios da sua carteira" purchaseAnchors/>
    <button className={compact?"wallet-shop-button compact-action":"wallet-shop-button"} onClick={onOpenStore}><ShoppingBag size={17}/><strong>{compact?"Abrir Loja":"Explorar a loja"}</strong></button>
    {!compact&&<small className="wallet-shop-helper">Compras são opcionais. Suas recompensas por acompanhar a comunidade continuam funcionando normalmente.</small>}
    {wallet.paymentHold&&<small className="wallet-hold">Sua carteira está em revisão por atualização de um pagamento. Compras e novas contribuições ficam temporariamente pausadas.</small>}
  </aside>;
}
