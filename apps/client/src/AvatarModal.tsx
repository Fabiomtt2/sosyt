import { useModalLifecycle } from "./useModalLifecycle";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Lock, X } from "lucide-react";
import { api, catalogAvatarUrl, type UserAvatar, type UserPresentation, type CatalogAvatarItem } from "./api";

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

export function UserAvatarView({avatar,name,presentation,className=""}:{avatar?:UserAvatar;name:string;presentation?:UserPresentation;className?:string}) {
  const [presetReady,setPresetReady]=useState(false);
  useEffect(()=>{
    if(avatar?.kind!=="PRESET"){setPresetReady(false);return;}
    const sprite=new Image();
    sprite.onload=()=>setPresetReady(true);
    sprite.onerror=()=>setPresetReady(false);
    sprite.src="/assets/user/avatars.webp";
    return()=>{sprite.onload=null;sprite.onerror=null;};
  },[avatar?.kind,avatar?.kind==="PRESET"?avatar.presetId:undefined]);
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{
    const until=presentation?.superExpiresAt?Date.parse(presentation.superExpiresAt):0;
    if(!until||until<=Date.now()){setNow(Date.now());return;}
    const timer=window.setTimeout(()=>setNow(Date.now()),Math.min(2147483647,Math.max(0,until-Date.now()+50)));
    return()=>window.clearTimeout(timer);
  },[presentation?.superExpiresAt]);
  const superActive=presentation?.superActive && (!presentation.superExpiresAt || Date.parse(presentation.superExpiresAt)>Math.max(now,Date.now()));
  const badge=presentation?.badge==="ADMIN"?"ADMIN":superActive?"SUPER":undefined;
  const frame=badge==="ADMIN"?" avatar-tier-owner":badge==="SUPER"?" avatar-tier-super":"";
  const style=avatar?.kind==="PRESET"&&presetReady?avatarPresetStyle(avatar.presetId):undefined;
  return <span className={`user-avatar ${avatar?.kind==="CATALOG"?"catalog":avatar?.kind==="PRESET"&&presetReady?"preset":"initials"}${frame} ${className}`}
    style={style} data-badge={badge} aria-label={badge?`${name} · ${badge}`:undefined}>
    {avatar?.kind==="CUSTOM"?<img src={avatar.dataUrl} alt=""/>:avatar?.kind==="CATALOG"?<img src={catalogAvatarUrl(avatar.slug)} alt="" loading="lazy"/>:avatar?.kind==="PRESET"&&presetReady?null:initials(name)}
  </span>;
}

/**
 * AUDITORIA / avatar ampliado: clicar no avatar (chat, fila, correio) abre o
 * retrato em tamanho grande, sempre CIRCULAR e sem corte — o mesmo enquadramento
 * da tela de escolha. Fecha no Escape, no fundo ou no botao.
 */
export function AvatarLightbox({avatar,name,presentation,subtitle,onClose,actions}:{
  avatar?:UserAvatar;name:string;presentation?:UserPresentation;subtitle?:string;onClose:()=>void;actions?:React.ReactNode;
}) {
  const modalRef=useModalLifecycle(onClose);
  return <div className="avatar-lightbox-backdrop" onMouseDown={onClose} role="presentation">
    <section ref={modalRef} className="avatar-lightbox" role="dialog" aria-modal="true" aria-label={`Avatar de ${name}`} onMouseDown={(event)=>event.stopPropagation()}>
      <button type="button" className="avatar-lightbox-close" onClick={onClose} aria-label="Fechar">×</button>
      <UserAvatarView avatar={avatar} name={name} presentation={presentation} className="avatar-lightbox-image"/>
      <h3>{name}</h3>
      {subtitle && <p className="avatar-lightbox-sub">{subtitle}</p>}
      {actions && <div className="avatar-lightbox-actions">{actions}</div>}
    </section>
  </div>;
}

type SaveAvatar=(avatar:UserAvatar)=>Promise<{avatar:UserAvatar}>;

export function AvatarModal({
  name,current,presentation,onClose,onChanged,saveAvatar=api.saveAvatar,loadCatalog=api.avatarCatalog,title="Escolha seu avatar"
}:{
  name:string;current?:UserAvatar;presentation?:UserPresentation;onClose:()=>void;onChanged:(avatar?:UserAvatar)=>void;
  saveAvatar?:SaveAvatar;loadCatalog?:()=>Promise<{avatars:CatalogAvatarItem[]}>;title?:string;
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

  // AUDITORIA / catálogo: avatares gerenciados pelo painel (comum/SUPER/OWNER).
  const [catalog,setCatalog]=useState<CatalogAvatarItem[]>([]);
  useEffect(()=>{ let alive=true; loadCatalog().then((r)=>{ if(alive) setCatalog(r.avatars); }).catch(()=>undefined); return()=>{alive=false;}; },[loadCatalog]);
  const visibleCatalog=catalog.filter((item)=> category==="ALL" || item.category===category);
  async function chooseCatalog(item:CatalogAvatarItem){
    if(item.locked) return;
    setBusy(true);setError("");
    try{
      const result=await saveAvatar({kind:"CATALOG",slug:item.slug,tier:item.tier});
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
        <UserAvatarView avatar={selected} name={name} presentation={presentation} className="avatar-picker-current"/>
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
          {visibleCatalog.map((item)=>{
            const tierClass=item.tier==="OWNER"?"avatar-tier-owner":item.tier==="SUPER"?"avatar-tier-super":"";
            const sel=selected?.kind==="CATALOG"&&selected.slug===item.slug;
            return <button key={item.slug} className={"avatar-choice catalog"+(sel?" selected":"")+(item.locked?" locked":"")} disabled={busy||item.locked}
              title={item.locked?`${item.label} — exclusivo ${item.tier==="OWNER"?"de administradores":"de assinantes SUPER"}`:item.label}
              aria-label={item.locked?`${item.label}, exclusivo ${item.tier}`:`Escolher ${item.label}`} onClick={()=>void chooseCatalog(item)}>
              <span className={"avatar-choice-img "+tierClass} style={{backgroundImage:`url(${catalogAvatarUrl(item.slug)})`}}/>
              {item.locked&&<em className={"avatar-lock "+(item.tier==="OWNER"?"owner":"super")}><Lock size={11}/>{item.tier==="OWNER"?"ADMIN":"SUPER"}</em>}
              {sel&&<i><Check size={13}/></i>}
            </button>;
          })}
        </div>
        <button className="carousel-arrow avatar-arrow" type="button" onClick={()=>scrollPresets(1)} aria-label="Próximos avatares"><ChevronRight/></button>
      </div>:<div className="avatar-art-wait"><span>Carregando avatares…</span></div>}
      {error&&<p className="error avatar-picker-error" role="alert">{error}</p>}
      <small className="avatar-picker-hint">Deslize a faixa ou use as setas. Ao escolher, salvamos automaticamente.</small>
    </section>
  </div>;
}
