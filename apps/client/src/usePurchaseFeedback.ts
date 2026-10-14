import {useCallback,useEffect,useRef,useState} from "react";
import {api,ApiError,type Pix,type PaymentState,type PurchaseReceipt} from "./api";

const memory=new Map<string,string[]>();
const failedWrites=new Set<string>();
const key=(userId:string,kind:string)=>"sos_purchases_v1:"+userId+":"+kind;
function read(userId:string,kind:string):string[]{
 const k=key(userId,kind);
 if(failedWrites.has(k))return memory.get(k)??[];
 try{const value=JSON.parse(localStorage.getItem(k)??"[]");return Array.isArray(value)?value.filter((id:unknown)=>typeof id==="string"):[];}catch{return memory.get(k)??[];}
}
function write(userId:string,kind:string,ids:string[]){
 const k=key(userId,kind);memory.set(k,ids);
 try{localStorage.setItem(k,JSON.stringify(ids));failedWrites.delete(k);}catch{failedWrites.add(k);/* Quota/private mode: use the current in-memory history. */}
}
export function rememberPurchase(userId:string,paymentId:string){
 write(userId,"pending",[...new Set([...read(userId,"pending"),paymentId])].slice(-40));
}
export function claimPurchase(userId:string,paymentId:string):boolean{
 const seen=read(userId,"seen");
 write(userId,"pending",read(userId,"pending").filter(id=>id!==paymentId));
 if(seen.includes(paymentId))return false;
 write(userId,"seen",[...seen,paymentId]);return true;
}

/** Observe durable payment IDs, never infer a purchase from a balance change. */
export function usePurchaseFeedback(userId:string|undefined,onConfirmed:()=>Promise<void>){
 const [receipts,setReceipts]=useState<PurchaseReceipt[]>([]);
 const [states,setStates]=useState<Record<string,PaymentState>>({});
 const current=useRef(userId),refresh=useRef(onConfirmed);
 current.current=userId;refresh.current=onConfirmed;
 const confirm=useCallback(async(receipt:PurchaseReceipt)=>{
  const id=current.current;if(!id||receipt.userId!==id)return;
  const token=localStorage.getItem("conexao_token");
  const take=()=>current.current===id&&localStorage.getItem("conexao_token")===token&&claimPurchase(id,receipt.paymentId);
  const claimed=navigator.locks?await navigator.locks.request(key(id,"receipt-lock"),take):take();
  if(!claimed)return;
  await refresh.current();
  if(current.current===id&&localStorage.getItem("conexao_token")===token)
   setReceipts(previous=>[...previous,receipt]);
 },[]);
 const track=useCallback((pix:Pix)=>{
  const id=userId;if(!id||current.current!==id||(pix.userId&&pix.userId!==id))return;
  rememberPurchase(id,pix.id);
  setStates(previous=>({...previous,[pix.id]:{id:pix.id,status:pix.status,receipt:pix.receipt}}));
  if(pix.receipt)void confirm(pix.receipt);
 },[confirm,userId]);
 useEffect(()=>{
  setReceipts([]);setStates({});
  if(!userId)return;
  let active=true,running=false,cursor=0;
  const token=localStorage.getItem("conexao_token");
  const poll=async()=>{
   if(running||document.visibilityState==="hidden")return;
   running=true;
   const pending=read(userId,"pending");
   const selected=pending.length?Array.from({length:Math.min(3,pending.length)},(_,i)=>pending[(cursor+i)%pending.length]):[];
   cursor+=selected.length;
   for(const id of selected){
    if(!active)break;
    try{
     const state=await api.paymentStatus(id);
     if(!active||current.current!==userId||localStorage.getItem("conexao_token")!==token)break;
     setStates(previous=>({...previous,[id]:state}));
     if(state.status==="APPROVED"&&state.receipt)await confirm(state.receipt);
     else if(["CANCELLED","REJECTED"].includes(state.status))write(userId,"pending",read(userId,"pending").filter(value=>value!==id));
    }catch(cause){
     if(active&&cause instanceof ApiError&&cause.status===404)write(userId,"pending",read(userId,"pending").filter(value=>value!==id));
     // Network errors retain the pending ID for the next attempt.
    }
   }
   running=false;
  };
  void poll();
  const timer=window.setInterval(()=>void poll(),10000);
  const wake=()=>void poll();
  window.addEventListener("focus",wake);window.addEventListener("online",wake);
  return()=>{active=false;clearInterval(timer);window.removeEventListener("focus",wake);window.removeEventListener("online",wake);};
 },[userId,confirm]);
 const dismiss=useCallback(()=>setReceipts(previous=>previous.slice(1)),[]);
 return {receipt:receipts[0],states,track,confirm,dismiss};
}
