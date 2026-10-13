import { ArrowUpRight,Play,Sparkles } from "lucide-react";
export function CommerceArtwork({kind}:{kind:"coins"|"skip"|"super"|"item"}){
 if(kind==="coins")return <img className="store-editorial-art" src={import.meta.env.BASE_URL+"assets/user/coins-editorial-v2.webp"} alt=""/>;
 if(kind==="super")return <div className="commerce-art super-art" aria-hidden="true"><i/><i/><span className="super-medallion"><Sparkles size={46}/><b>SUPER</b></span><span className="art-orbit"/></div>;
 return <div className={"commerce-art "+(kind==="skip"?"skip-art":"item-art")} aria-hidden="true"><span className="art-video-card rear"><Play size={30}/></span><span className="art-video-card front"><Play size={30}/><i/><i/></span><span className="art-route"><ArrowUpRight size={30}/></span></div>;
}
