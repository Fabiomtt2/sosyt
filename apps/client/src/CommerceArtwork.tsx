/** Editorial raster assets; product prices and grants stay in the store catalog. */
export function CommerceArtwork({kind}:{kind:"coins"|"skip"|"super"|"pass"|"item"}){
 const base=import.meta.env.BASE_URL+"assets/user/";
 if(kind==="skip"||kind==="item")return <div className="store-raster-skip" aria-hidden="true"><img src={base+"premium-commerce-atlas-v2.webp"} alt=""/></div>;
 const art=kind==="coins"?"coins-editorial-v2.webp":kind==="pass"?"pass-editorial-v2.webp":"super-medallion-v2.webp";
 return <img className="store-editorial-art" src={base+art} alt=""/>;
}
