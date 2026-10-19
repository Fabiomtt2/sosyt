import {describe,it,expect} from "vitest";
import {selectLevelEmblem} from "./level-emblems";
import {LEVEL_EMBLEMS} from "../../api/src/level-emblems";
const catalog=LEVEL_EMBLEMS.map(entry=>({...entry,url:"/level-emblems/"+entry.slug}));
describe("server emblem progression in the client",()=>{
 it("uses all twelve server tiers at their boundaries",()=>{
  expect(catalog).toHaveLength(12);
  for(const [index,entry] of catalog.entries()){
   expect(selectLevelEmblem(catalog,entry.fromLevel)?.tier).toBe(entry.tier);
   if(index>0)expect(selectLevelEmblem(catalog,entry.fromLevel-1)?.tier).toBe(catalog[index-1].tier);
  }
 });
 it("does not invent an administrative level or emblem",()=>{
  for(const level of [0,-1,NaN,Infinity])expect(selectLevelEmblem(catalog,level)).toBeUndefined();
  expect(selectLevelEmblem(catalog,1000000)?.tier).toBe(12);
 });
});
