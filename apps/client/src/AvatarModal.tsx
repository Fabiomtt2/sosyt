import { useModalLifecycle } from "./useModalLifecycle";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { api, type UserAvatar } from "./api";

const PRESET_COUNT=34;
const COLS=8;
const ROWS=5;
type AvatarCategory="ALL"|"PEOPLE"|"ANIMALS"|"CREATURES"|"OBJECTS";
const AVATAR_CATEGORIES:Array<{id:AvatarCategory;label:string;start:number;end:number}>=[
  {id:"ALL",label:"Todos",start:1,end:34},
  {id:"PEOPLE",label:"Pessoas",start:1,end:12},
  {id:"ANIMALS",label:"Animais",start:13,end:20},
  {id:"CREATURES",label:"Criaturas",start:21,end:26},
  {id:"OBJECTS",label:"Objetos",start:27,end:34}
];

function initials(name:string) {
  return name.split(/\s+/).filter(Boolean).map((part)=>part[0]).slice(0,2).join("").toUpperCase();
}

export function avatarPresetStyle(presetId:string): React.CSSProperties {
  const number=Number(presetId.replace("avatar-",""));
  const index=Math.max(0,Math.min(PRESET_COUNT-1,number-1));
  const col=index%COLS,row=Math.floor(index/COLS);
  return {
    backgroundImage:"url('/assets/user/avatars.webp')",
    backgroundSize:`${COLS*100}% ${ROWS*100}%`,
    backgroundPosition:`${(col/(COLS-1))*100}% ${(row/(ROWS-1))*100}%`
  };
}

export function UserAvatarView({avatar,name,className=""}:{avatar?:UserAvatar;name:string;className?:string}) {
  const [presetReady,setPresetReady]=useState(false);
  useEffect(()=>{
    if(avatar?.kind!=="PRESET"){setPresetReady(false);return;}
    const sprite=new Image();
    sprite.onload=()=>setPresetReady(true);
    sprite.onerror=()=>setPresetReady(false);
    sprite.src="/assets/user/avatars.webp";
    return()=>{sprite.onload=null;sprite.onerror=null;};
  },[avatar?.kind,avatar?.kind==="PRESET"?avatar.presetId:undefined]);
  if(avatar?.kind==="CUSTOM") return <span className={`user-avatar ${className}`}><img src={avatar.dataUrl} alt=""/></span>;
  if(avatar?.kind==="PRESET"&&presetReady) return <span className={`user-avatar preset ${className}`} style={avatarPresetStyle(avatar.presetId)} aria-hidden="true"/>;
  return <span className={`user-avatar initials ${className}`} aria-hidden="true">{initials(name)}</span>;
}

type SaveAvatar=(avatar:UserAvatar)=>Promise<{avatar:UserAvatar}>;

export function AvatarModal({
  name,current,onClose,onChanged,saveAvatar=api.saveAvatar,title="Escolha seu avatar"
}:{
  name:string;current?:UserAvatar;onClose:()=>void;onChanged:(avatar?:UserAvatar)=>void;
  saveAvatar?:SaveAvatar;title?:string;
}) {
  const [selected,setSelected]=useState<UserAvatar|undefined>(current);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [presetArtReady,setPresetArtReady]=useState(false);
  const [category,setCategory]=useState<AvatarCategory>("ALL");
  const railRef=useRef<HTMLDivElement>(null);
  const presets=useMemo(()=>Array.from({length:PRESET_COUNT},(_,index)=>`avatar-${String(index+1).padStart(2,"0")}`),[]);
  const activeCategory=AVATAR_CATEGORIES.find((item)=>item.id===category)??AVATAR_CATEGORIES[0];
  const visiblePresets=presets.filter((presetId)=>{
    const number=Number(presetId.slice(-2));
    return number>=activeCategory.start&&number<=activeCategory.end;
  });

  function scrollPresets(direction:number){
    const rail=railRef.current;
    if(!rail)return;
    rail.scrollBy({left:direction*Math.max(rail.clientWidth-24,220),behavior:"smooth"});
  }

  useEffect(()=>{
    const sprite=new Image();
    sprite.onload=()=>setPresetArtReady(true);
    sprite.onerror=()=>setPresetArtReady(false);
    sprite.src="/assets/user/avatars.webp";
    return()=>{sprite.onload=null;sprite.onerror=null;};
  },[]);

  const modalRef=useModalLifecycle(onClose);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(event.key==="ArrowLeft")scrollPresets(-1);
      if(event.key==="ArrowRight")scrollPresets(1);
    };
    document.addEventListener("keydown",key);
    return()=>{document.removeEventListener("keydown",key);};
  },[onClose]);

  async function choose(presetId:string){
    setBusy(true);setError("");
    try{
      const result=await saveAvatar({kind:"PRESET",presetId});
      setSelected(result.avatar);
      onChanged(result.avatar);
      onClose();
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Não foi possível mudar seu avatar.");
    }finally{setBusy(false);}
  }

  return <div className="modal-backdrop avatar-backdrop" onMouseDown={onClose}>
    <section ref={modalRef} className="modal avatar-modal avatar-modal-compact" role="dialog" aria-modal="true" aria-label="Escolher avatar" onMouseDown={(event)=>event.stopPropagation()}>
      <button className="close" aria-label="Fechar escolha de avatar" onClick={onClose}><X size={20}/></button>
      <div className="avatar-picker-head">
        <div><p className="eyebrow dark">AVATAR</p><h2>{title}</h2></div>
        <UserAvatarView avatar={selected} name={name} className="avatar-picker-current"/>
      </div>
      <div className="avatar-category-tabs" role="tablist" aria-label="Categorias de avatar">
        {AVATAR_CATEGORIES.map((item)=><button key={item.id} type="button" role="tab" aria-selected={category===item.id} className={category===item.id?"active":""} onClick={()=>{setCategory(item.id);railRef.current?.scrollTo({left:0,behavior:"smooth"});}}>{item.label}</button>)}
      </div>
      {presetArtReady?<div className="avatar-carousel-shell">
        <button className="carousel-arrow avatar-arrow" type="button" onClick={()=>scrollPresets(-1)} aria-label="Avatares anteriores"><ChevronLeft/></button>
        <div className="avatar-rail" ref={railRef} aria-label="Avatares disponíveis">
          {visiblePresets.map((presetId)=><button key={presetId} className={selected?.kind==="PRESET"&&selected.presetId===presetId?"avatar-choice selected":"avatar-choice"} disabled={busy} aria-label={`Escolher avatar ${Number(presetId.slice(-2))}`} onClick={()=>void choose(presetId)}>
            <span style={avatarPresetStyle(presetId)}/>{selected?.kind==="PRESET"&&selected.presetId===presetId&&<i><Check size={13}/></i>}
          </button>)}
        </div>
        <button className="carousel-arrow avatar-arrow" type="button" onClick={()=>scrollPresets(1)} aria-label="Próximos avatares"><ChevronRight/></button>
      </div>:<div className="avatar-art-wait"><span>Carregando avatares…</span></div>}
      {error&&<p className="error avatar-picker-error" role="alert">{error}</p>}
      <small className="avatar-picker-hint">Deslize a faixa ou use as setas. Ao escolher, salvamos automaticamente.</small>
    </section>
  </div>;
}
