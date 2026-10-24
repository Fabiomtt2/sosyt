import type { AppDatabase } from "./db.js";
import { gamificationConfig, gamificationView, leaderboards } from "./gamification.js";
import { identityOf } from "./mailbox.js";

export const dropLabel = (code: string,days=7) => code.startsWith("COINS_") ? code.slice(6) + " moedas" : code === "SKIP" ? "1 Pular" : code === "PASS" ? "1 Passe" : "SUPER por "+days+" dias";
export function gamificationRanks(db: AppDatabase, viewerId?: string) {
  const ranks = leaderboards(db);
  const decorate = (rows: Array<{userId:string;xp:number}>) => rows.slice(0,3).map((row,index) => {
    const who = identityOf(db,row.userId);
    return {userId:row.userId,name:who?.name ?? "Participante",avatar:who?.avatar ?? undefined,
      presentation:who?.presentation,groupCode:who?.groupCode,progress:who?.presentation.progress,
      xp:row.xp,position:index+1};
  });
  // AUDITORIA / "RANKING COM CAMINHO DE ACAO" — especificacao do proprio ASTRA que
  // nunca foi construida: cartao com "sua posicao / proximo marco / como e calculado".
  //
  // Sem isso o ranking so mostrava o TOP 3. Para quem ainda nao pontuou (quase todo
  // mundo no comeco) a tela dizia "as primeiras jornadas vao aparecer aqui" e nada
  // mais — e o dono concluiu, com razao, que ranking nao existia. Posicao propria e
  // distancia para a pessoa da frente existem SEMPRE, mesmo com o TOP vazio, e sao o
  // que transforma uma lista de terceiros em caminho proprio.
  //
  // `leaderboards` ja devolvia ate 100 colocados; a posicao estava disponivel e
  // simplesmente nao era calculada.
  const lugarDe = (rows: Array<{userId:string;xp:number}>) => {
    if (!viewerId) return undefined;
    const indice = rows.findIndex(row => row.userId === viewerId);
    if (indice < 0) return { ranked: false as const, total: rows.length };
    const aFrente = indice > 0 ? rows[indice-1]! : undefined;
    return {
      ranked: true as const, position: indice + 1, total: rows.length, xp: rows[indice]!.xp,
      // Quanto falta para alcancar quem esta imediatamente a frente. Zero quando lidera.
      xpParaSubir: aFrente ? Math.max(0, aFrente.xp - rows[indice]!.xp) : 0,
    };
  };
  return {
    month: ranks.month, monthly: decorate(ranks.monthly), allTime: decorate(ranks.permanent),
    viewer: viewerId ? { monthly: lugarDe(ranks.monthly), allTime: lugarDe(ranks.permanent) } : undefined,
    comoFunciona: "Sua posição vem do XP do mês. XP nasce de contribuir: enviar vídeo para a fila, acompanhar a playlist, trocar com a comunidade e usar a loja. Empate é desfeito por quem chegou primeiro.",
  };
}
export function gamificationData(db: AppDatabase,userId: string) {
  const view=gamificationView(db,userId),config=gamificationConfig(db);
  const progress=view.administrative?null:(()=>{
    const span=Math.max(1,view.nextLevelXp-view.levelStartXp);
    const start=Math.floor(view.level/10)*10+1;
    return {xp:view.xp,level:view.level,xpIntoLevel:Math.max(0,view.xp-view.levelStartXp),
      xpForNextLevel:span,progressPercent:Math.min(100,Math.max(0,(view.xp-view.levelStartXp)/span*100)),
      rewardCoins:view.rewardCoins,roadmap:Array.from({length:10},(_,i)=>{
        const level=start+i;
        return {level,coins:level===1?0:config.levelCoins+(level%config.milestoneEvery===0?config.milestoneCoins:0),
          superDays:level>1&&level%config.trialEvery===0?config.trialDays:0};
      })};
  })();
  return {enabled:config.enabled,administrative:view.administrative,unlimitedXp:view.unlimitedXp,progress,
    milestones:{every:config.milestoneEvery,coins:config.milestoneCoins,trialEvery:config.trialEvery,trialDays:config.trialDays},
    ranks:gamificationRanks(db,userId),
    booster:{...view.booster,odds:view.booster.odds.map(d=>({...d,label:dropLabel(d.code,config.trialDays),probability:d.probabilityPercent/100}))},
    redemption:view.redeemPrices,redemptionEnabled:!view.administrative&&config.enabled&&config.redeemEnabled,
    history:view.history};
}
