import { RefreshCw,Youtube } from "lucide-react";
export function WelcomeLoading({error,onRetry}:{error?:string;onRetry:()=>void}){
 return <main className="welcome-loading" aria-busy={!error}>
  <img className="welcome-loading-art" src={import.meta.env.BASE_URL+"assets/user/community-editorial-v3.webp"} alt=""/>
  <div className="welcome-loading-orbit" aria-hidden="true"><span/><span/><span/><Youtube size={36}/></div>
  <p className="eyebrow dark">SOS YOUTUBER</p>
  <h1>{error?"Vamos retomar sua conexão?":"Seu espaço está chegando."}</h1>
  <p>{error?"Seus registros continuam salvos. Confira a conexão e tente novamente.":"Estamos reunindo suas filas, seus recados e seu progresso."}</p>
  {error?<><p className="error" role="alert">{error}</p><button className="primary" onClick={onRetry}><RefreshCw size={17}/>Tentar novamente</button></>:<span role="status">Preparando tudo para você…</span>}
 </main>;
}
