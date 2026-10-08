import { useEffect,useState } from "react";
import { ChevronLeft,ChevronRight,Pause,Play } from "lucide-react";

const SLIDES=[
 {art:"hero.webp",kind:"community",eyebrow:"CRIADORES APOIAM CRIADORES",title:"10 vídeos. Uma playlist em comum.",copy:"Compartilhe uma URL do YouTube. Quando a fila completar dez vídeos, cada participante poderá criar a playlist na própria conta."},
 {art:"coins-editorial-v2.webp",kind:"time",eyebrow:"CONTINUIDADE ENTRE SESSÕES",title:"Seu tempo continua com você.",copy:"O tempo registrado no player se acumula entre filas e sessões. A cada 20 minutos, você recebe 1 moeda interna para novas contribuições."},
 {art:"pass-editorial-v2.webp",kind:"pass",eyebrow:"MOEDAS E PASSES",title:"Uma contribuição extra na mesma fila.",copy:"O passe libera mais uma posição para você. Salvar a nova URL também usa 1 moeda. Comprar é opcional; confira as condições na loja."}
] as const;

export function UserWelcomeCarousel(){
 const [index,setIndex]=useState(0),[paused,setPaused]=useState(false),[reduced,setReduced]=useState(false);
 const [hovered,setHovered]=useState(false),[focused,setFocused]=useState(false),[steps,setSteps]=useState(0);
 useEffect(()=>{
  const media=window.matchMedia("(prefers-reduced-motion: reduce)");
  const sync=()=>setReduced(media.matches);sync();media.addEventListener("change",sync);
  return()=>media.removeEventListener("change",sync);
 },[]);
 const automatic=!paused&&!reduced&&!hovered&&!focused&&steps<SLIDES.length;
 useEffect(()=>{
  if(!automatic)return;
  const timer=window.setTimeout(()=>{setIndex(value=>(value+1)%SLIDES.length);setSteps(value=>value+1);},7000);
  return()=>window.clearTimeout(timer);
 },[automatic,index,steps]);
 const select=(next:number)=>{setPaused(true);setIndex((next+SLIDES.length)%SLIDES.length);};
 const slide=SLIDES[index];
 return <section className={"user-welcome-hero welcome-carousel informative-banner banner-"+slide.kind} aria-label="Boas-vindas ao SOS YouTuber" aria-roledescription="carrossel"
  onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}
  onFocusCapture={()=>setFocused(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setFocused(false);}}>
  <div className="welcome-carousel-media" aria-hidden="true"><img key={slide.art} className="welcome-carousel-image" src={import.meta.env.BASE_URL+"assets/user/"+slide.art} alt=""/></div>
  <div className="user-welcome-copy" aria-live={paused||reduced?"polite":"off"}>
   <p className="eyebrow">{slide.eyebrow}</p><strong>{slide.title}</strong><span className="welcome-carousel-line">{slide.copy}</span>
   <div className="banner-controls" aria-label="Controles dos banners">
    <button type="button" aria-label="Banner anterior" onClick={()=>select(index-1)}><ChevronLeft size={18}/></button>
    <span>{index+1} de {SLIDES.length}</span>
    <button type="button" aria-label="Próximo banner" onClick={()=>select(index+1)}><ChevronRight size={18}/></button>
    {!reduced&&<button type="button" aria-label={paused||steps>=SLIDES.length?"Reproduzir banners":"Pausar banners"} onClick={()=>{if(paused||steps>=SLIDES.length){setPaused(false);setSteps(0);}else setPaused(true);}}>{paused||steps>=SLIDES.length?<Play size={15}/>:<Pause size={15}/>}</button>}
   </div>
  </div>
 </section>;
}
