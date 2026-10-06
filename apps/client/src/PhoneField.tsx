import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Search, X } from "lucide-react";
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

const displayNames = new Intl.DisplayNames(["pt-BR"], { type: "region" });

const BRAZIL_DDDS = [
  ["11","SP"],["12","SP"],["13","SP"],["14","SP"],["15","SP"],["16","SP"],["17","SP"],["18","SP"],["19","SP"],
  ["21","RJ"],["22","RJ"],["24","RJ"],["27","ES"],["28","ES"],
  ["31","MG"],["32","MG"],["33","MG"],["34","MG"],["35","MG"],["37","MG"],["38","MG"],
  ["41","PR"],["42","PR"],["43","PR"],["44","PR"],["45","PR"],["46","PR"],
  ["47","SC"],["48","SC"],["49","SC"],["51","RS"],["53","RS"],["54","RS"],["55","RS"],
  ["61","DF/GO"],["62","GO"],["63","TO"],["64","GO"],["65","MT"],["66","MT"],["67","MS"],["68","AC"],["69","RO"],
  ["71","BA"],["73","BA"],["74","BA"],["75","BA"],["77","BA"],["79","SE"],
  ["81","PE"],["82","AL"],["83","PB"],["84","RN"],["85","CE"],["86","PI"],["87","PE"],["88","CE"],["89","PI"],
  ["91","PA"],["92","AM"],["93","PA"],["94","PA"],["95","RR"],["96","AP"],["97","AM"],["98","MA"],["99","MA"]
] as const;

const BRAZIL_DDD_SET = new Set<string>(BRAZIL_DDDS.map(([code]) => code));

function flag(country: CountryCode) {
  return String.fromCodePoint(...country.split("").map((char) => 127397 + char.charCodeAt(0)));
}

type CountryItem = { country: CountryCode; name: string; callingCode: string; flag: string };
const COUNTRIES: CountryItem[] = getCountries()
  .map((country) => ({
    country,
    name: displayNames.of(country) ?? country,
    callingCode: getCountryCallingCode(country),
    flag: flag(country)
  }))
  .sort((a,b) => a.name.localeCompare(b.name,"pt-BR"));

function inferCountry(value: string): CountryCode | undefined {
  const digits=value.replace(/\D/g,"");
  if (!digits) return undefined;
  const parsed=parsePhoneNumberFromString(value.startsWith("+") ? value : `+${digits}`);
  return parsed?.country;
}

function parseInitial(value: string) {
  if (!value) return { country: undefined as CountryCode|undefined, ddd:"", subscriber:"" };
  const digits=value.replace(/\D/g,"");
  const country=inferCountry(value);
  if (!country) return { country: undefined as CountryCode|undefined, ddd:"", subscriber:digits };
  const calling=getCountryCallingCode(country);
  const national=digits.startsWith(calling) ? digits.slice(calling.length) : digits;
  if (country==="BR") return { country, ddd:national.slice(0,2), subscriber:national.slice(2,11) };
  return { country, ddd:"", subscriber:national };
}

export function PhoneField({ value, onChange, required=false, id="whatsapp" }: {
  value:string;
  onChange:(value:string)=>void;
  required?:boolean;
  id?:string;
}) {
  const initial=useMemo(()=>parseInitial(value),[]);
  const [country,setCountry]=useState<CountryCode|undefined>(initial.country);
  const [ddd,setDdd]=useState(initial.ddd);
  const [subscriber,setSubscriber]=useState(initial.subscriber);
  const [countryOpen,setCountryOpen]=useState(false);
  const [dddOpen,setDddOpen]=useState(false);
  const [search,setSearch]=useState("");
  const [dddSearch,setDddSearch]=useState("");
  const root=useRef<HTMLDivElement>(null);
  const countryListRef=useRef<HTMLDivElement>(null);
  const dddRailRef=useRef<HTMLDivElement>(null);
  const dddSearchTimer=useRef<number | undefined>(undefined);

  useEffect(()=>{
    if (!value) return;
    const current=compose(country,ddd,subscriber);
    if (current.replace(/\D/g,"")===value.replace(/\D/g,"")) return;
    const next=parseInitial(value);
    setCountry(next.country);
    setDdd(next.ddd);
    setSubscriber(next.subscriber);
  },[value]);

  useEffect(()=>{
    const close=(event:MouseEvent)=>{
      if (!root.current?.contains(event.target as Node)) {
        setCountryOpen(false);
        setDddOpen(false);
      }
    };
    const escape=(event:KeyboardEvent)=>{
      if (event.key==="Escape") {
        setCountryOpen(false);
        setDddOpen(false);
      }
    };
    document.addEventListener("mousedown",close);
    document.addEventListener("keydown",escape);
    return ()=>{ document.removeEventListener("mousedown",close); document.removeEventListener("keydown",escape); };
  },[]);

  useEffect(()=>{
    if (!dddOpen) {
      setDddSearch("");
      if (dddSearchTimer.current) window.clearTimeout(dddSearchTimer.current);
      return;
    }
    const incremental=(event:KeyboardEvent)=>{
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        setDddSearch((current)=>{
          const next=(current+event.key).slice(-2);
          if (dddSearchTimer.current) window.clearTimeout(dddSearchTimer.current);
          dddSearchTimer.current=window.setTimeout(()=>setDddSearch(""),1200);
          return next;
        });
      } else if (event.key==="Backspace" && dddSearch) {
        event.preventDefault();
        setDddSearch((current)=>current.slice(0,-1));
      }
    };
    document.addEventListener("keydown",incremental);
    return ()=>document.removeEventListener("keydown",incremental);
  },[dddOpen,dddSearch]);

  function compose(nextCountry=country,nextDdd=ddd,nextSubscriber=subscriber) {
    if (!nextCountry || !nextSubscriber) return "";
    const calling=getCountryCallingCode(nextCountry);
    if (nextCountry==="BR") {
      if (!nextDdd) return "";
      return `+${calling}${nextDdd}${nextSubscriber}`;
    }
    return `+${calling}${nextSubscriber}`;
  }

  function emit(nextCountry=country,nextDdd=ddd,nextSubscriber=subscriber) {
    onChange(compose(nextCountry,nextDdd,nextSubscriber));
  }

  function chooseCountry(next:CountryCode) {
    const keepSubscriber=country===next ? subscriber : "";
    setCountry(next);
    setDdd("");
    setSubscriber(keepSubscriber);
    setCountryOpen(false);
    setDddOpen(false);
    setSearch("");
    emit(next,"",keepSubscriber);
  }

  function chooseDdd(next:string) {
    setDdd(next);
    setDddSearch("");
    setDddOpen(false);
    emit(country,next,subscriber);
  }

  function scrollCountries(direction:number) {
    countryListRef.current?.scrollBy({ top:direction*190, behavior:"smooth" });
  }

  function scrollDdds(direction:number) {
    const rail=dddRailRef.current;
    if (!rail) return;
    rail.scrollBy({ left:direction*Math.max(rail.clientWidth-12,120), behavior:"smooth" });
  }

  function changeSubscriber(raw:string) {
    const digits=raw.replace(/\D/g,"").slice(0,country==="BR" ? 9 : 14);
    setSubscriber(digits);
    emit(country,ddd,digits);
  }

  const item=country ? COUNTRIES.find((entry)=>entry.country===country) : undefined;
  const filtered=COUNTRIES.filter((entry)=>{
    const q=search.trim().toLocaleLowerCase("pt-BR");
    return !q || entry.name.toLocaleLowerCase("pt-BR").includes(q) || entry.callingCode.includes(q.replace(/\D/g,"")) || entry.country.toLowerCase().includes(q);
  });
  const filteredDdds=dddSearch ? BRAZIL_DDDS.filter(([code])=>code.startsWith(dddSearch)) : BRAZIL_DDDS;
  const dddInfo=BRAZIL_DDDS.find(([code])=>code===ddd);
  const complete=country==="BR"
    ? Boolean(ddd && BRAZIL_DDD_SET.has(ddd) && /^9\d{8}$/.test(subscriber))
    : Boolean(country && subscriber && parsePhoneNumberFromString(compose())?.isValid());

  return <div className="phone-field-wrap" ref={root}>
    <div className={`phone-field ${complete ? "valid" : ""}`}>
      <button type="button" className="phone-country-trigger" onClick={()=>{setCountryOpen(!countryOpen);setDddOpen(false);}} aria-expanded={countryOpen} aria-label="Selecionar país e DDI">
        <span className="phone-flag">{item?.flag ?? "🌐"}</span>
        <span>{item ? `+${item.callingCode}` : "DDI"}</span>
        <ChevronDown size={14}/>
      </button>
      {country==="BR" && <button type="button" className="phone-ddd-trigger" onClick={()=>{setDddOpen(!dddOpen);setCountryOpen(false);}} aria-expanded={dddOpen} aria-label="Selecionar DDD do Brasil">
        <span>{ddd || "DDD"}</span><ChevronDown size={14}/>
      </button>}
      <input
        id={id}
        className="phone-number-input"
        inputMode="numeric"
        autoComplete="tel-national"
        value={subscriber}
        onChange={(event)=>changeSubscriber(event.target.value)}
        placeholder={country==="BR" ? "9XXXXXXXX" : country ? "Número do WhatsApp" : "Escolha o país"}
        maxLength={country==="BR" ? 9 : 14}
        required={required}
        aria-label="WhatsApp"
      />
    </div>
    <div className="phone-field-hint">
      {item ? <span>{item.flag} {item.name} · +{item.callingCode}{country==="BR" && dddInfo ? ` · DDD ${dddInfo[0]} (${dddInfo[1]})` : ""}</span> : <span>Escolha o país para identificar o DDI.</span>}
      {country==="BR" && subscriber && !/^9\d{0,8}$/.test(subscriber) && <span className="phone-hint-error">No Brasil, o WhatsApp móvel deve começar com 9.</span>}
    </div>

    {countryOpen && <div className="phone-popover country-popover" role="dialog" aria-label="País e DDI">
      <div className="phone-popover-head"><strong>País e DDI</strong><button type="button" onClick={()=>setCountryOpen(false)} aria-label="Fechar lista de países"><X size={17}/></button></div>
      <label className="phone-search"><Search size={16}/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Buscar país ou DDI"/></label>
      <div className="country-scroll-shell">
        <button type="button" className="popover-scroll-arrow vertical" aria-label="Países anteriores" onClick={()=>scrollCountries(-1)}><ChevronUp size={17}/></button>
        <div className="phone-option-list" ref={countryListRef}>{filtered.map((entry)=><button type="button" key={entry.country} aria-label={`${entry.name} +${entry.callingCode}`} className={entry.country===country ? "selected" : ""} onClick={()=>chooseCountry(entry.country)}>
          <span className="phone-flag">{entry.flag}</span><span className="phone-option-name">{entry.name}</span><strong>+{entry.callingCode}</strong>
        </button>)}</div>
        <button type="button" className="popover-scroll-arrow vertical" aria-label="Próximos países" onClick={()=>scrollCountries(1)}><ChevronDown size={17}/></button>
      </div>
    </div>}

    {dddOpen && country==="BR" && <div className="phone-popover ddd-popover" role="dialog" aria-label="DDD do Brasil">
      <div className="phone-popover-head"><strong>DDD do Brasil</strong><button type="button" onClick={()=>setDddOpen(false)} aria-label="Fechar lista de DDD"><X size={17}/></button></div>
      <p className="phone-popover-copy">Escolha o DDD do número cadastrado no WhatsApp.</p>
      <div className="ddd-carousel-shell">
        <button type="button" className="popover-scroll-arrow horizontal" aria-label="DDDs anteriores" onClick={()=>scrollDdds(-1)}><ChevronLeft size={17}/></button>
        <div className="ddd-rail" ref={dddRailRef} aria-live="polite">{filteredDdds.map(([code,state])=><button type="button" key={code} aria-label={`DDD ${code} ${state}`} className={code===ddd ? "selected" : ""} onClick={()=>chooseDdd(code)}><strong>{code}</strong><span>{state}</span></button>)}</div>
        <button type="button" className="popover-scroll-arrow horizontal" aria-label="Próximos DDDs" onClick={()=>scrollDdds(1)}><ChevronRight size={17}/></button>
      </div>
    </div>}
  </div>;
}

export function isCompletePhoneField(value:string) {
  const parsed=parsePhoneNumberFromString(value);
  if (!parsed?.country) return false;
  if (parsed.country==="BR") {
    const national=parsed.nationalNumber;
    return BRAZIL_DDD_SET.has(national.slice(0,2)) && /^9\d{8}$/.test(national.slice(2));
  }
  return parsed.isValid();
}
