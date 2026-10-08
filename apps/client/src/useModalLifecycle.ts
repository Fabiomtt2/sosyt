import { useEffect,useRef,type MouseEvent } from "react";

type Entry={node:()=>HTMLElement|null;close:()=>void;canClose:()=>boolean};
const entries=new Set<Entry>();
let bodyOverflow="";
const visible=(node:HTMLElement)=>node.getClientRects().length>0;
function topDialog(){
 return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter(visible).at(-1);
}
function ownerOf(dialog:HTMLElement){
 return [...entries].filter(entry=>entry.node()?.contains(dialog)).sort((a,b)=>{
  const left=a.node()!,right=b.node()!;
  return left===right?0:left.contains(right)?1:-1;
 })[0];
}
function keydown(event:KeyboardEvent){
 if(event.defaultPrevented)return;
 const dialog=topDialog();if(!dialog)return;
 const owner=ownerOf(dialog);if(!owner)return;
 if(event.key==="Escape"){
  event.preventDefault();event.stopImmediatePropagation();
  if(owner.canClose())owner.close();
 }else if(event.key==="Tab"){
  const focusable=Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex="-1"])')).filter(node=>visible(node)&&node.tabIndex>=0);
  const first=focusable[0],last=focusable.at(-1),active=document.activeElement;
  if(!first){event.preventDefault();dialog.tabIndex=-1;dialog.focus();return;}
  if(event.shiftKey&&(active===first||!dialog.contains(active))){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&(active===last||!dialog.contains(active))){event.preventDefault();first.focus();}
 }
}

/** One shared body lock and only the topmost dialog responds to Escape/Tab. */
export function useModalLifecycle(onClose:()=>void,enabled=true,dismissible=true){
 const element=useRef<HTMLElement|null>(null),close=useRef(onClose),allowed=useRef(dismissible);
 close.current=onClose;allowed.current=dismissible;
 useEffect(()=>{
  if(!enabled)return;
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const entry:Entry={node:()=>element.current,close:()=>close.current(),canClose:()=>allowed.current};
  if(entries.size===0){
   bodyOverflow=document.body.style.overflow;
   document.body.style.overflow="hidden";
   document.addEventListener("keydown",keydown);
  }
  entries.add(entry);
  const frame=requestAnimationFrame(()=>{
   const dialog=topDialog();
   if(dialog&&ownerOf(dialog)===entry&&!dialog.contains(document.activeElement)){
    dialog.tabIndex=-1;dialog.focus({preventScroll:true});
   }
  });
  return()=>{
   cancelAnimationFrame(frame);entries.delete(entry);
   if(entries.size===0){
    document.body.style.overflow=bodyOverflow;
    document.removeEventListener("keydown",keydown);
   }
   if(previous?.isConnected)previous.focus({preventScroll:true});
  };
 },[enabled]);
 return element;
}

export function closeFromBackdrop(event:MouseEvent<HTMLElement>,onClose:()=>void){
 if(event.target===event.currentTarget)onClose();
}
