import { useEffect, useMemo, useState } from "react";

const CANDIDATES=[
  {src:"/assets/user/hero-community.webp",position:"center 48%"},
  {src:"/assets/user/hero-growth.webp",position:"center 50%"},
  {src:"/assets/user/hero.webp",position:"center 50%"}
] as const;

type Slide=(typeof CANDIDATES)[number];

export function IntroVisualCarousel(){
  const [available,setAvailable]=useState<Slide[]>([CANDIDATES[2]]);
  const [index,setIndex]=useState(0);
  const [reducedMotion,setReducedMotion]=useState(false);

  useEffect(()=>{
    const media=window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync=()=>setReducedMotion(media.matches);
    sync();
    media.addEventListener?.("change",sync);
    return()=>media.removeEventListener?.("change",sync);
  },[]);

  useEffect(()=>{
    let alive=true;
    Promise.all(CANDIDATES.map((slide)=>new Promise<Slide|null>((resolve)=>{
      const img=new Image();
      img.onload=()=>resolve(slide);
      img.onerror=()=>resolve(null);
      img.src=slide.src;
    }))).then((items)=>{
      if(!alive)return;
      const found=items.filter((item):item is Slide=>Boolean(item));
      setAvailable(found.length?found:[CANDIDATES[2]]);
      setIndex(0);
    });
    return()=>{alive=false;};
  },[]);

  const finalIndex=useMemo(()=>{
    const found=available.findIndex((slide)=>slide.src==="/assets/user/hero.webp");
    return found>=0?found:Math.max(0,available.length-1);
  },[available]);

  useEffect(()=>{
    if(reducedMotion||available.length<=1){
      setIndex(finalIndex);
      return;
    }
    const timer=window.setInterval(()=>setIndex((current)=>(current+1)%available.length),5400);
    return()=>window.clearInterval(timer);
  },[available.length,finalIndex,reducedMotion]);

  const active=available[index]??available[finalIndex]??CANDIDATES[2];
  return <div className="intro-visual-carousel" aria-hidden="true">
    <img key={active.src} src={active.src} alt="" style={{objectPosition:active.position}}/>
    <span/>
  </div>;
}
