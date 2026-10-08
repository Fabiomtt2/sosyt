import { Coins, ShoppingBag, Ticket } from "lucide-react";
import type { Dashboard } from "./api";

export function UserWallet({wallet,onOpenStore,compact=false}:{wallet:Dashboard["wallet"];onOpenStore:()=>void;compact?:boolean}) {
  return <aside className={compact?"user-wallet compact":"user-wallet"}>
    {!compact&&<div className="wallet-heading">
      <div><span>Minha conta</span><strong>Moedas e passes</strong></div>
      <button className="wallet-store-link" onClick={onOpenStore}><ShoppingBag size={15}/>Abrir Loja</button>
    </div>}
    <div className="wallet-values">
      <div className="wallet-value coins-value"><span className="wallet-value-icon"><Coins size={19}/></span><div><strong>{wallet.total.toLocaleString("pt-BR",{maximumFractionDigits:3})}</strong><span>Moedas</span></div></div>
      <div className="wallet-value passes-value"><span className="wallet-value-icon"><Ticket size={19}/></span><div><strong>{wallet.extraPasses}</strong><span>{wallet.extraPasses===1?"Passe":"Passes"}</span></div></div>
    </div>
    <button className={compact?"wallet-shop-button compact-action":"wallet-shop-button"} onClick={onOpenStore}><ShoppingBag size={17}/><strong>{compact?"Abrir Loja":"Ver moedas e passes"}</strong></button>
    {!compact&&<small className="wallet-shop-helper">Compras são opcionais. Suas recompensas por acompanhar a comunidade continuam funcionando normalmente.</small>}
    {wallet.paymentHold&&<small className="wallet-hold">Sua carteira está em revisão por atualização de um pagamento. Compras e novas contribuições ficam temporariamente pausadas.</small>}
  </aside>;
}
