import { useEffect,useState } from "react";
import "./welcome-cycle.css";
import { ChevronLeft,ChevronRight,Pause,Play } from "lucide-react";

const SLIDES=[
 {art:"community-editorial-v3.webp",kind:"community",eyebrow:"CRIADORES APOIAM CRIADORES",title:"10 vídeos. Uma playlist em comum.",copy:"Compartilhe uma URL do YouTube. Você pode iniciar com os vídeos disponíveis. Com dez vídeos, a playlist completa permite as recompensas; começar antes mantém XP, sem moedas."},
 {art:"time-continuity-v3.webp",kind:"time",eyebrow:"CONTINUIDADE ENTRE SESSÕES",title:"Seu tempo continua com você.",copy:"O player registra os trechos acompanhados e preserva seu progresso. Saltos não contam como tempo assistido. A playlist iniciada incompleta gera XP, sem moedas."},
 {art:"messages-editorial-v3.webp",kind:"pass",eyebrow:"SEU ESPAÇO NA COMUNIDADE",title:"Um recado pode aproximar criadores.",copy:"Abra o correio para pedir uma conversa, aceitar amizades e enviar presentes. Você escolhe quem pode falar com você."}
] as const;

export function UserWelcomeCarousel({onOpenStore,onOpenCommunity}:{onOpenStore:()=>void;onOpenCommunity:()=>void}){
 const [index,setIndex]=useState(0),[paused,setPaused]=useState(false),[reduced,setReduced]=useState(false);
 const [ending,setEnding]=useState(false),[hidden,setHidden]=useState(false);
 const [hovered,setHovered]=useState(false),[focused,setFocused]=useState(false),[steps,setSteps]=useState(0);
 useEffect(()=>{
  const media=window.matchMedia("(prefers-reduced-motion: reduce)");
  const sync=()=>setReduced(media.matches);sync();media.addEventListener("change",sync);
  return()=>media.removeEventListener("change",sync);
 },[]);
 const automatic=!paused&&!reduced&&!hovered&&!focused&&steps<SLIDES.length*3;
 useEffect(()=>{
  if(!automatic)return;
  const timer=window.setTimeout(()=>{setIndex(value=>(value+1)%SLIDES.length);setSteps(value=>value+1);},7000);
  return()=>window.clearTimeout(timer);
 },[automatic,index,steps]);
 useEffect(()=>{
  if(steps<SLIDES.length*3||paused||reduced||hovered||focused){setEnding(false);return;}
  setEnding(true);const timer=window.setTimeout(()=>setHidden(true),450);return()=>window.clearTimeout(timer);
 },[steps,paused,reduced,hovered,focused]);
 const select=(next:number)=>{setPaused(true);setIndex((next+SLIDES.length)%SLIDES.length);};
 const slide=SLIDES[index];
 if(hidden)return null;
 return <div className={"welcome-cycle-wrap"+(ending?" is-ending":"")}><div><section className={"user-welcome-hero welcome-carousel informative-banner banner-"+slide.kind} aria-label="Boas-vindas ao SOS YouTuber" aria-roledescription="carrossel"
  onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}
  onFocusCapture={()=>setFocused(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setFocused(false);}}>
  {slide.art&&<div className="welcome-carousel-media banner-art-surface" aria-hidden="true"><img key={slide.art} className="welcome-carousel-image" src={import.meta.env.BASE_URL+"assets/user/"+slide.art} alt=""/></div>}
  <div className="user-welcome-copy" aria-live={paused||reduced?"polite":"off"}>
   <p className="eyebrow">{slide.eyebrow}</p><strong>{slide.title}</strong><span className="welcome-carousel-line">{slide.copy}</span>
   <button className="banner-action" type="button" onClick={slide.kind==="pass"?onOpenCommunity:onOpenStore}>{slide.kind==="pass"?"Abrir meu espaço":"Conhecer os benefícios"}</button>
   <div className="banner-controls" aria-label="Controles dos banners">
    <button type="button" aria-label="Banner anterior" onClick={()=>select(index-1)}><ChevronLeft size={18}/></button>
    <span>{index+1} de {SLIDES.length}</span>
    <button type="button" aria-label="Próximo banner" onClick={()=>select(index+1)}><ChevronRight size={18}/></button>
    {!reduced&&<button type="button" aria-label={paused||steps>=SLIDES.length*3?"Reproduzir banners":"Pausar banners"} onClick={()=>{if(paused||steps>=SLIDES.length*3){setPaused(false);setSteps(0);}else setPaused(true);}}>{paused||steps>=SLIDES.length*3?<Play size={15}/>:<Pause size={15}/>}</button>}
   </div>
  </div>
 </section></div></div>;
}
