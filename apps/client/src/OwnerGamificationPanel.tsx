import { JourneyBotSettings } from "./JourneyBotSettings";
import { useEffect, useState } from "react";
import { RefreshCw, Save, Trophy } from "lucide-react";
import { ownerApi, type GamificationSettings, type OwnerGamificationData } from "./api";
const labels:Record<string,string>={COINS_5:"5 moedas",COINS_10:"10 moedas",COINS_15:"15 moedas",COINS_20:"20 moedas",COINS_25:"25 moedas",SKIP:"Pular",PASS:"Passe",SUPER_TRIAL:"SUPER temporário"};
export function OwnerGamificationPanel(){
 const [data,setData]=useState<OwnerGamificationData>();
 const [draft,setDraft]=useState<GamificationSettings>();
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 async function load(){try{const value=await ownerApi.gamification();setData(value);setDraft(value.config);}catch(e){setError(e instanceof Error?e.message:"Não foi possível carregar.");}}
 useEffect(()=>{void load();},[]);
 async function save(){if(!draft)return;setBusy(true);setError("");setNotice("");try{const result=await ownerApi.saveGamification(draft);setDraft(result.config);setNotice("Regras salvas no servidor. Histórico e benefícios já concedidos foram preservados.");await load();}catch(e){setError(e instanceof Error?e.message:"Confira os campos e tente novamente.");}finally{setBusy(false);}}
 if(!draft||!data)return <section className="owner-panel"><p role="status">{error||"Carregando a jornada da comunidade…"}</p></section>;
 const flags:Array<[keyof Pick<GamificationSettings,"enabled"|"xpEnabled"|"boosterEnabled"|"redeemEnabled"|"monthlyEnabled">,string]>=[["enabled","Jornada ativa"],["xpEnabled","XP pelos vídeos"],["boosterEnabled","Booster de sexta"],["redeemEnabled","Troca de recompensas"],["monthlyEnabled","Premiação mensal"]];
 const numberField=(label:string,value:number,change:(v:number)=>void,min=0,max=10000)=><label>{label}<input type="number" min={min} max={max} step="1" value={value} onChange={e=>change(Number(e.target.value))}/></label>;
 return <section className="owner-panel owner-gamification">
  <div className="owner-panel-head"><div><h2><Trophy size={22}/> Jornada e recompensas</h2><p className="muted">Controle o progresso da comunidade. Moedas de recompensa são internas e ficam separadas da receita de compras.</p></div><button className="secondary" disabled={busy} onClick={()=>void load()}><RefreshCw size={16}/>Atualizar</button></div>
  <div className="journey-owner-flags">{flags.map(([key,label])=><label key={key}><input type="checkbox" checked={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.checked})}/>{label}</label>)}</div>
  <div className="journey-settings-grid">
   <fieldset><legend>XP e dificuldade</legend>
    {numberField("XP por vídeo completo",draft.xpPerVideo,v=>setDraft({...draft,xpPerVideo:v}),1)}
    {numberField("XP para sair do nível 1",draft.curve.firstStep,v=>setDraft({...draft,curve:{...draft.curve,firstStep:v}}),1,100000)}
    {numberField("Aumento de XP a cada nível",draft.curve.stepIncrease,v=>setDraft({...draft,curve:{...draft.curve,stepIncrease:v}}),0,100000)}
    <p>Somente trechos consolidados pelo servidor geram XP. Cada vídeo e perfil preserva a regra com que começou; alterações não reescrevem conquistas anteriores.</p>
   </fieldset>
   <fieldset><legend>Conquistas de nível</legend>
    {numberField("Moedas por nível conquistado",draft.levelCoins,v=>setDraft({...draft,levelCoins:v}),0,100)}
    {numberField("Bônus de moedas a cada quantos níveis",draft.milestoneEvery,v=>setDraft({...draft,milestoneEvery:v}),1,1000)}
    {numberField("Moedas extras no marco",draft.milestoneCoins,v=>setDraft({...draft,milestoneCoins:v}),0,1000)}
    {numberField("SUPER a cada quantos níveis",draft.trialEvery,v=>setDraft({...draft,trialEvery:v}),1,1000)}
    {numberField("Dias do SUPER de recompensa",draft.trialDays,v=>setDraft({...draft,trialDays:v}),1,30)}
    <p>O nível 1 é o começo; recompensas entram ao subir de nível. SUPER temporário expira pelo servidor, sem alterar uma assinatura paga.</p>
   </fieldset>
   <fieldset><legend>Moedas por Pular e Passe</legend>
    {numberField("Pular · preço em moedas de recompensa",draft.redeemPrices.SKIP,v=>setDraft({...draft,redeemPrices:{...draft.redeemPrices,SKIP:v}}),1)}
    {numberField("Passe · preço em moedas de recompensa",draft.redeemPrices.PASS,v=>setDraft({...draft,redeemPrices:{...draft.redeemPrices,PASS:v}}),1)}
    <p>Trocas e presentes usam apenas o saldo de recompensa. Não vendem moedas, não geram receita e não oferecem SUPER ou pacotes de moedas.</p>
   </fieldset>
   <fieldset><legend>TOP 3 mensal</legend>
    {draft.monthlyRewards.map((coins,index)=>numberField((index+1)+"º lugar · moedas",coins,v=>{const rewards=[...draft.monthlyRewards] as [number,number,number];rewards[index]=v;setDraft({...draft,monthlyRewards:rewards});},0,1000))}
    <p>O ranking mensal usa o calendário da Bahia e paga uma vez após fechar o mês. O ranking de níveis é permanente. Contas administrativas não disputam prêmios.</p>
   </fieldset>
  </div>
  <details className="journey-owner-odds"><summary>Booster · chances públicas de cada presente</summary><p>Sexta-feira, das 06:00 às 23:59, no horário da Bahia. Uma abertura por participante. As chances devem somar 100%.</p><div className="journey-settings-grid">
   {draft.boosterDrops.map((drop,index)=><label key={drop.code}>{labels[drop.code]??drop.code}<input type="number" min="0" max="100" step="0.01" value={drop.weight/100} onChange={e=>{const drops=draft.boosterDrops.map((d,i)=>i===index?{...d,weight:Math.round(Number(e.target.value)*100)}:d);setDraft({...draft,boosterDrops:drops});}}/><small>% de chance</small></label>)}
  </div><strong>Total: {draft.boosterDrops.reduce((sum,d)=>sum+d.weight,0)/100}%</strong></details>
  {error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <button className="primary" disabled={busy} onClick={()=>void save()}><Save size={16}/>{busy?"Salvando…":"Salvar regras da jornada"}</button>
  <details className="journey-owner-history"><summary>Histórico de recompensas e XP</summary><div>{data.events.slice(0,30).map(e=><article key={e.id}><strong>{e.name}</strong><span>{e.kind} {e.xpDelta? "· +"+e.xpDelta+" XP":""}</span><small>{new Date(e.createdAt).toLocaleString("pt-BR")}</small></article>)}</div></details>
  <JourneyBotSettings/>
  <details className="journey-owner-history"><summary>Eventos para o bot ({data.botEvents.length})</summary><p>Evento pendente é um registro salvo, não uma mensagem enviada. Entregas dependem da configuração do WhatsApp.</p><div>{data.botEvents.map(e=><article key={e.id}><strong>{e.event}</strong><span>{e.status}</span><small>{new Date(e.createdAt).toLocaleString("pt-BR")}</small></article>)}</div></details>
 </section>;
}
