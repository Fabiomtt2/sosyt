import type {AppDatabase} from "./db.js";
import {normalizeInbound} from "./bot-inbound.js";
import {gamificationData,gamificationRanks} from "./gamification-view.js";
import {resolveStoredPhone} from "./phone-identity.js";
import {effectiveSuper} from "./super.js";
import {verifiedGroupCodes} from "./group-verification.js";
import {itemQuantity} from "./inventory.js";

export function emojiProgress(percent:number){
  const value=Number.isFinite(percent)?Math.max(0,Math.min(100,percent)):0;
  const filled=Math.floor(value/10);
  return "🟪".repeat(filled)+"⬜".repeat(10-filled)+" "+Math.floor(value)+"%";
}

/** Read the same persisted engines as the dashboard. Never credits XP or joins a queue. */
export function botProgressReply(db:AppDatabase,phone:string,text:string):string|undefined {
  const command=normalizeInbound(text);
  const ranking=/\b(rank|ranking|classificacao)\b/.test(command);
  const queues=command==="2"||/\b(fila|filas)\b/.test(command);
  const progress=/^(5|moedas|pontos|niveis|recompensa)$/.test(command)||/\b(xp|nivel|carteira|saldo|inventario|gamificacao)\b/.test(command);
  if(!ranking&&!queues&&!progress)return undefined;
  const stored=resolveStoredPhone(db,phone);
  const user=db.prepare("SELECT id,name FROM users WHERE phone=? AND deleted_at IS NULL").get(stored) as {id:string;name:string}|undefined;
  if(!user)return "Vamos preparar seu acesso primeiro? 💛 Responda *1* e me diga como prefere ser chamado. Depois posso consultar suas filas, carteira, nível e ranking por aqui.";
  const data=gamificationData(db,user.id);
  const hello=user.name+", ";
  const groups=verifiedGroupCodes(db,stored);
  const groupLine=groups.length?"\n\n*Seus grupos confirmados*\n"+groups.map(code=>"SOS YOUTUBER "+code).join(" · "):"";
  if(ranking){
    const ranks=gamificationRanks(db);
    const list=(rows:typeof ranks.monthly)=>rows.length?rows.map(r=>r.position+"º "+r.name+" · "+r.xp+" XP").join("\n"):"Ainda não há XP verificado neste ranking.";
    return hello+"aqui está o TOP 3 real 🏅\n\n*Mês "+ranks.month+"*\n"+list(ranks.monthly)+"\n\n*Ranking global*\n"+list(ranks.allTime)+(data.administrative?"\n\nSua conta Root fica fora da competição.":"")+"\n\nO XP vem do progresso verificado pelo sistema; esta consulta não altera pontos.";
  }
  if(queues){
    const member=db.prepare("SELECT 1 FROM group_memberships m JOIN groups g ON g.code=m.group_code WHERE m.phone=? AND m.revoked_at IS NULL AND g.enabled=1").get(stored);
    if(!member&&!data.administrative)return hello+"sua conta está criada, mas a entrada no grupo ainda precisa ser confirmada. 💛 Não vou indicar uma fila liberada antes disso. Sua senha continua servindo para acessar a conta e acompanhar essa etapa.";
    const rows=db.prepare(`SELECT r.display_number AS number,r.status,COALESCE(p.percent,0) AS percent,
      (SELECT COUNT(*) FROM submissions s WHERE s.round_id=r.id) AS slots
      FROM round_participants rp JOIN rounds r ON r.id=rp.round_id
      LEFT JOIN playlist_watch_progress p ON p.round_id=r.id AND p.user_id=rp.user_id
      WHERE rp.user_id=? AND rp.left_at IS NULL AND r.closed_at IS NULL AND p.finalized_at IS NULL
      ORDER BY r.display_number LIMIT 10`).all(user.id) as Array<{number:number;status:string;percent:number;slots:number}>;
    const directory=db.prepare("SELECT r.display_number AS number,(SELECT COUNT(*) FROM submissions s WHERE s.round_id=r.id) AS slots FROM rounds r WHERE r.closed_at IS NULL ORDER BY r.display_number LIMIT 10").all() as {number:number;slots:number}[];
    const directoryText="\n\n*Filas da comunidade*\n"+directory.map(r=>"Fila "+r.number+": "+r.slots+"/10 links").join("\n");
    return hello+(rows.length?"suas filas em andamento 🎬\n"+rows.map(r=>"• Fila "+r.number+" · "+r.slots+"/10 links · "+(r.status==="READY"?"playlist pronta":"recebendo links")+" · "+Math.floor(r.percent)+"% assistido\n"+emojiProgress(r.percent)).join("\n"):"você ainda não entrou em uma fila ativa. 🎬 Abra o painel para escolher uma fila e enviar seu vídeo.")+groupLine+directoryText+"\n\n⏳ Cada fila dura 72 horas desde a abertura e sai das ativas quando esse prazo termina. Links e histórico ficam preservados. Cada fila reúne até 10 links. Passe libera mais uma URL na sua fila aberta; somente Pular permite escolher outra fila. Consultar aqui não consome itens nem muda sua participação. Para criar playlist parcial, leia e confirme no painel o aviso de menos XP e nenhuma moeda dessa seleção.";
  }
  if(data.administrative)return hello+"sua conta Root tem acesso administrativo e XP ilimitado, sem nível, emblema de participante ou posição no ranking. 👑 Os itens administrativos são ilimitados; não são saldo comprado e não geram receita.";
  const wallet=db.prepare("SELECT promo_millis AS promo,purchased_millis AS purchased,reward_millis AS reward,extra_slot_passes AS passes FROM wallets WHERE user_id=?").get(user.id) as {promo:number;purchased:number;reward:number;passes:number};
  const superAccess=effectiveSuper(db,user.id);
  const number=(n:number)=>(n/1000).toLocaleString("pt-BR",{maximumFractionDigits:3});
  return hello+"seu progresso real 🏅\n"+(!data.enabled?"A gamificação está desativada na configuração atual. Seu histórico está preservado.\n":"")+
    "Nível "+data.progress!.level+" · "+data.progress!.xp+" XP\nFaltam "+Math.max(0,data.progress!.xpForNextLevel-data.progress!.xpIntoLevel)+" XP para o próximo nível.\n"+emojiProgress(data.progress!.xpForNextLevel>0?data.progress!.xpIntoLevel/data.progress!.xpForNextLevel*100:0)+
    "\n\n*Carteira*\nMoedas: "+number(wallet.promo+wallet.purchased+wallet.reward)+"\nCompradas: "+number(wallet.purchased)+" · Recompensas: "+number(wallet.reward)+" · Promocionais: "+number(wallet.promo)+
    "\nPasse: "+wallet.passes+" · Pular: "+itemQuantity(db,user.id,"SKIP")+"\nSUPER: "+(superAccess.active?"ativo"+(superAccess.expiresAt?" até "+new Date(superAccess.expiresAt).toLocaleDateString("pt-BR",{timeZone:"America/Bahia"}):""):"inativo")+
    "\nBooster: "+(data.booster.available?"disponível para resgatar no painel":data.booster.claimed?"já resgatado nesta rodada":"fora da janela de resgate")+
    "\n\nEscreva *ranking* para o TOP 3 ou *minhas filas* para acompanhar suas filas. Os resgates e compras são confirmados no painel.";
}
