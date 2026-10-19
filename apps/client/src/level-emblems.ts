import {useEffect,useState} from "react";
import {api,type LevelEmblem} from "./api";

let catalog:LevelEmblem[]|undefined;
let pending:Promise<LevelEmblem[]>|undefined;
export function selectLevelEmblem(entries:readonly LevelEmblem[],level:number):LevelEmblem|undefined{
 if(!Number.isFinite(level)||level<1)return;
 return entries.filter(entry=>entry.fromLevel<=Math.floor(level)).sort((a,b)=>b.fromLevel-a.fromLevel)[0];
}
function loadCatalog(){
 if(catalog)return Promise.resolve(catalog);
 if(!pending)pending=api.levelEmblems().then(result=>{
  catalog=result.emblems.filter(entry=>Number.isInteger(entry.tier)&&entry.tier>0&&Number.isInteger(entry.fromLevel)&&entry.fromLevel>0&&/^\/level-emblems\/level-\d{2}-[a-z-]+$/.test(entry.url));return catalog;
 }).catch(()=>{pending=undefined;return [];});
 return pending;
}
export function useLevelEmblem(level:number){
 const [entries,setEntries]=useState(catalog??[]);
 useEffect(()=>{let active=true;void loadCatalog().then(value=>{if(active)setEntries(value);});return()=>{active=false;};},[]);
 return selectLevelEmblem(entries,level);
}
