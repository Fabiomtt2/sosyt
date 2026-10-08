import { useRef, useState, type ChangeEvent } from "react";
import { Camera, Image as ImageIcon, RefreshCcw } from "lucide-react";
import { api, type UserAvatar } from "./api";

type SaveAvatar=(avatar:UserAvatar)=>Promise<{avatar:UserAvatar}>;
type ClearAvatar=()=>Promise<unknown>;

async function imageFileToWebp(file:File):Promise<string>{
  if(!["image/jpeg","image/png","image/webp"].includes(file.type))throw new Error("Escolha uma foto JPG, PNG ou WebP.");
  if(file.size>12*1024*1024)throw new Error("Esta foto é muito grande. Escolha uma imagem menor que 12 MB.");
  const url=URL.createObjectURL(file);
  try{
    const image=await new Promise<HTMLImageElement>((resolve,reject)=>{
      const element=new Image();
      element.onload=()=>resolve(element);
      element.onerror=()=>reject(new Error("Não conseguimos abrir esta foto."));
      element.src=url;
    });
    const size=192;
    const canvas=document.createElement("canvas");
    canvas.width=size;canvas.height=size;
    const context=canvas.getContext("2d");
    if(!context)throw new Error("Seu navegador não conseguiu preparar a foto.");
    const scale=Math.max(size/image.naturalWidth,size/image.naturalHeight);
    const width=image.naturalWidth*scale,height=image.naturalHeight*scale;
    context.drawImage(image,(size-width)/2,(size-height)/2,width,height);
    return canvas.toDataURL("image/webp",0.8);
  }finally{URL.revokeObjectURL(url);}
}

export function ProfilePhotoActions({
  onChanged,saveAvatar=api.saveAvatar,clearAvatar=api.clearAvatar
}:{
  onChanged:(avatar?:UserAvatar)=>void;saveAvatar?:SaveAvatar;clearAvatar?:ClearAvatar;
}){
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const cameraRef=useRef<HTMLInputElement>(null);
  const galleryRef=useRef<HTMLInputElement>(null);

  async function chooseFile(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];
    event.target.value="";
    if(!file)return;
    setBusy(true);setError("");
    try{
      const dataUrl=await imageFileToWebp(file);
      const result=await saveAvatar({kind:"CUSTOM",dataUrl});
      onChanged(result.avatar);
    }catch(cause){setError(cause instanceof Error?cause.message:"Não conseguimos preparar essa foto.");}
    finally{setBusy(false);}
  }

  async function clear(){
    setBusy(true);setError("");
    try{await clearAvatar();onChanged(undefined);}
    catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível voltar às iniciais.");}
    finally{setBusy(false);}
  }

  return <div className="profile-photo-actions">
    <button type="button" disabled={busy} onClick={()=>cameraRef.current?.click()}><Camera size={16}/><span>Tirar foto</span></button>
    <button type="button" disabled={busy} onClick={()=>galleryRef.current?.click()}><ImageIcon size={16}/><span>Galeria</span></button>
    <button type="button" disabled={busy} onClick={()=>void clear()}><RefreshCcw size={16}/><span>Usar iniciais</span></button>
    <input ref={cameraRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="user" onChange={(event)=>void chooseFile(event)}/>
    <input ref={galleryRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event)=>void chooseFile(event)}/>
    {error&&<p className="error profile-photo-error" role="alert">{error}</p>}
  </div>;
}
