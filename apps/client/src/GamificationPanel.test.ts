import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GamificationPanel, LevelBadge, type GamificationData } from "./GamificationPanel";

const base: GamificationData = {
 progress:null, ranks:{monthly:[],allTime:[]},
 booster:{available:false,claimed:false,odds:[]},redemption:{SKIP:100,PASS:100}
};
const render=(data:GamificationData)=>renderToStaticMarkup(createElement(GamificationPanel,{
 data,onClaimBooster:async()=>({code:"PASS",label:"Passe"}),onRedeem:async()=>undefined
}));
describe("jornada administrativa e participante",()=>{
 it("Root mostra acesso infinito e ranking sem nível, progresso ou ações de recompensa",()=>{
  const html=render({...base,administrative:true,unlimitedXp:true});
  expect(html).toContain("XP administrativo ∞");
  expect(html).toContain("fora da competição");
  expect(html).toContain("Criadores em movimento");
  expect(html).not.toContain("journey-level-badge");
  expect(html).not.toContain("progressbar");
  expect(html).not.toContain("Trocar");
  expect(html).not.toContain("Abrir meu presente");
 });
 it("participante mantém nível real, XP, progresso e recompensas",()=>{
  const html=render({...base,progress:{xp:150,level:2,xpIntoLevel:50,xpForNextLevel:150,progressPercent:33.3,rewardCoins:120,roadmap:[{level:3,coins:1,superDays:0}]}});
  expect(html).toContain("Nível 2");
  expect(html).toContain("150 XP acumulados");
  expect(html).toContain('role="progressbar"');
  expect(html).toContain("Trocar");
  expect(html).not.toContain("XP administrativo");
 });
 it("ausência de progresso nunca inventa um emblema de nível 1",()=>{
  expect(renderToStaticMarkup(createElement(LevelBadge,{progress:null}))).toBe("");
  expect(render(base)).not.toContain("journey-level-badge");
 });
});
