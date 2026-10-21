import {useState,type FormEvent} from "react";
import {ownerApi} from "./api";
import {ActionErrorDialog} from "./ActionErrorDialog";
import "./owner-credentials.css";

/** Self-service for ADMIN_OWNER; never loads Root/team/billing settings. */
export function OwnerSelfCredentialPanel(){
  const [form,setForm]=useState({currentPassword:"",password:"",confirm:""});
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  async function save(event:FormEvent){
    event.preventDefault();setError("");setNotice("");
    if(form.password!==form.confirm){setError("As duas novas credenciais precisam ser iguais.");return;}
    if(form.password.length<10||!/[A-Za-z]/.test(form.password)||!/[0-9]/.test(form.password)){setError("Use pelo menos 10 caracteres, incluindo letras e números.");return;}
    setBusy(true);
    try{const result=await ownerApi.saveOwnCredential({currentPassword:form.currentPassword,password:form.password});setForm({currentPassword:"",password:"",confirm:""});setNotice(result.message);}
    catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível salvar sua credencial.");}
    finally{setBusy(false);}
  }
  return <section className="owner-panel owner-access-panel">
    <h2>Minha credencial administrativa</h2>
    <p>Troque a credencial provisória recebida por uma senha pessoal. Esta alteração mantém seu nível de acesso ao painel.</p>
    <form className="owner-access-form owner-credential-form" aria-label="Minha credencial administrativa" onSubmit={event=>void save(event)}>
      <label>Credencial atual<input type="password" autoComplete="current-password" value={form.currentPassword} onChange={event=>setForm({...form,currentPassword:event.target.value})} required/></label>
      <label>Nova credencial<input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={form.password} onChange={event=>setForm({...form,password:event.target.value})} required/></label>
      <label>Repita a nova credencial<input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={form.confirm} onChange={event=>setForm({...form,confirm:event.target.value})} required/></label>
      <button type="submit" className="primary" disabled={busy}>{busy?"Salvando…":"Salvar minha credencial"}</button>
      {notice&&<p className="credential-success" role="status">{notice}</p>}
    </form>
    {error&&<ActionErrorDialog message={error} onClose={()=>setError("")}/>}
  </section>;
}
