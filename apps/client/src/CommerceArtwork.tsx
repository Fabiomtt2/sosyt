import { ArrowUpRight,Play,Sparkles,Ticket } from "lucide-react";
export function CommerceArtwork({kind}:{kind:"coins"|"skip"|"super"|"pass"|"item"}){
 if(kind==="coins")return <img className="store-editorial-art" src={import.meta.env.BASE_URL+"assets/user/coins-editorial-v2.webp"} alt=""/>;
 if(kind==="pass")return <div className="commerce-art pass-art" aria-hidden="true"><span className="pass-ribbon"/><span className="pass-ticket"><Ticket size={48} strokeWidth={1.3}/><i/></span><span className="pass-spark"><Sparkles size={24}/></span></div>;
 if(kind==="super")return <div className="commerce-art super-art" aria-hidden="true"><i/><i/><span className="super-medallion"><Sparkles size={46}/><b>SUPER</b></span><span className="art-orbit"/></div>;
 return <div className={"commerce-art "+(kind==="skip"?"skip-art":"item-art")} aria-hidden="true"><span className="art-video-card rear"><Play size={30}/></span><span className="art-video-card front"><Play size={30}/><i/><i/></span><span className="art-route"><ArrowUpRight size={30}/></span></div>;
}
