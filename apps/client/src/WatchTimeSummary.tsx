import { Clock3 } from "lucide-react";
import type { WatchRewards } from "./api";
const elapsed=(seconds:number)=>{
 const total=Math.max(0,Math.floor(seconds)),hours=Math.floor(total/3600),minutes=Math.floor(total%3600/60),rest=total%60;
 return (hours?hours+" h ":"")+minutes+" min "+rest+" s";
};
export function WatchTimeSummary({rewards}:{rewards:WatchRewards}){
 return <section className="watch-time-summary" aria-label="Tempo acumulado de acompanhamento">
  <Clock3 size={22}/><div><span>Tempo acumulado de acompanhamento</span><strong>{elapsed(rewards.verifiedSeconds)}</strong>
  <small>{rewards.coins} moeda(s) registradas por tempo · próxima em {elapsed(rewards.secondsToNextReward)}</small>
  <progress max={1200} value={Math.max(0,1200-rewards.secondsToNextReward)} aria-label="Progresso até a próxima moeda"/>
  <p>O registro continua entre sessões e filas. Moedas antigas e compradas são contabilizadas separadamente.</p></div>
 </section>;
}
