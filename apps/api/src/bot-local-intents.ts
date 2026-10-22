/** Local retrieval classifier. No remote model, generated answer, user history or side effect. */
export type LocalBotIntent = "MENU" | "QUEUE" | "PASSWORD_HELP" | "HELP" | "HUMAN" | "STORE" | "RANKING" | "WALLET";
export type LocalBotMatch = { intent: LocalBotIntent; score: number };

// Training examples are project vocabulary, not conversations collected from users.
const CORPUS: Readonly<Record<LocalBotIntent, readonly string[]>> = {
  MENU: ["mostre as opcoes do menu", "quais alternativas do menu tenho", "quero voltar ao inicio do menu", "onde encontro as opcoes", "quais sao as opcoes", "mande a lista de opcoes"],
  QUEUE: ["qual e a minha fila", "onde vejo os videos da fila", "posso montar playlist incompleta", "como montar uma playlist", "a playlist precisa de dez videos", "quantos videos tem na fila", "onde adiciono meu video", "onde colocar o link do video", "como assistir os videos da playlist"],
  PASSWORD_HELP: ["minha senha foi rejeitada", "a senha enviada falhou", "meu acesso nao esta funcionando", "o acesso esta dando erro", "a credencial nao esta funcionando", "a credencial foi rejeitada", "nao consigo acessar minha conta", "estou sem acesso a conta", "como recuperar acesso a conta"],
  HELP: ["pode me orientar", "preciso de orientacao", "estou perdido no aplicativo", "nao estou compreendendo o aplicativo", "quero entender o projeto", "explique o projeto para mim", "por onde devo iniciar", "pode explicar melhor"],
  HUMAN: ["posso conversar com uma pessoa responsavel", "preciso conversar com a equipe responsavel", "queria conversar com gente de verdade", "alguem da equipe pode responder", "preciso conversar com um administrador", "quero conversar com uma pessoa da equipe", "tem alguem da equipe para me atender"],
  STORE: ["onde fica a loja", "como comprar produtos", "onde vejo os produtos", "quero conhecer a loja", "como comprar um item", "onde encontro os precos dos produtos", "como adquirir moedas", "onde compro passe e pular"],
  WALLET: ["quantas moedinhas eu tenho", "quantos itens eu tenho no inventario", "qual e o meu saldo", "quais beneficios eu tenho", "como esta meu progresso de experiencia", "quantos pontos eu acumulei", "quanto xp eu tenho", "meu super esta ativo", "quantos passes eu tenho", "quantos pular eu tenho"],
  RANKING: ["quem esta no topo da classificacao", "quais sao os lideres da comunidade", "quem esta no podio", "quero ver os campeoes da comunidade", "como consultar a classificacao", "quem lidera a competicao", "quem esta no topo do ranking"],
};

const normalize = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z\d\s]/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set("a o as os de da do das dos e em no na nos nas um uma uns umas para por com ao eu meu minha meus minhas voce vcs que qual quais como onde esta estao tem tenho quero queria preciso pode posso sao foi me se na nesta esse essa isso muito".split(" "));
const anchors: Record<LocalBotIntent, readonly string[]> = {
  MENU: ["menu", "opcoes", "alternativas"],
  QUEUE: ["fila", "filas", "playlist", "playlists", "video", "videos"],
  PASSWORD_HELP: ["senha", "acesso", "credencial", "acessar", "conta"],
  HELP: ["orientar", "orientacao", "perdido", "compreendendo", "entender", "projeto", "explicar", "explique", "iniciar"],
  HUMAN: ["pessoa", "responsavel", "equipe", "gente", "administrador", "humano", "atendente"],
  STORE: ["loja", "comprar", "compro", "produtos", "produto", "item", "precos", "adquirir"],
  WALLET: ["carteira", "saldo", "inventario", "moedinhas", "itens", "beneficios", "experiencia", "pontos", "xp", "super", "passes", "pular"],
  RANKING: ["ranking", "classificacao", "lideres", "podio", "campeoes", "lidera", "competicao"],
};
const VOCABULARY = [...new Set(Object.values(CORPUS).flatMap(rows => rows.flatMap(row => normalize(row).split(" "))))];
function oneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length-b.length)>1) return false;
  let i=0,j=0,edits=0;
  while(i<a.length && j<b.length){
    if(a[i]===b[j]){i++;j++;continue;}
    if(++edits>1)return false;
    if(a.length>=b.length)i++;
    if(b.length>=a.length)j++;
  }
  return edits+(i<a.length||j<b.length?1:0)<=1;
}
function words(text: string): string[] {
  return normalize(text).split(" ").filter(Boolean).map(word => {
    if(word.length<4 || VOCABULARY.includes(word))return word;
    const matches=VOCABULARY.filter(candidate => candidate.length>=4 && oneEdit(word,candidate));
    return matches.length===1?matches[0]!:word;
  });
}
function features(tokens: readonly string[]): Map<string, number> {
  const vector=new Map<string,number>();
  for(const word of tokens.filter(token => !STOP.has(token))){
    vector.set("w:"+word,(vector.get("w:"+word)??0)+2);
    const padded="^"+word+"$";
    for(let i=0;i<padded.length-2;i++){
      const key="c:"+padded.slice(i,i+3);
      vector.set(key,(vector.get(key)??0)+0.35);
    }
  }
  return vector;
}
const documents=Object.entries(CORPUS).flatMap(([intent,examples]) => examples.map(example => ({intent:intent as LocalBotIntent,vector:features(words(example))})));
const idf=new Map<string,number>();
for(const key of new Set(documents.flatMap(document => [...document.vector.keys()]))){
  const count=documents.filter(document => document.vector.has(key)).length;
  idf.set(key,Math.log((documents.length+1)/(count+1))+1);
}
function cosine(left:Map<string,number>,right:Map<string,number>):number {
  let dot=0,leftNorm=0,rightNorm=0;
  for(const [key,value]of left){const weighted=value*(idf.get(key)??1);leftNorm+=weighted**2;dot+=weighted*(right.get(key)??0)*(idf.get(key)??1);}
  for(const [key,value]of right)rightNorm+=(value*(idf.get(key)??1))**2;
  return leftNorm&&rightNorm?dot/Math.sqrt(leftNorm*rightNorm):0;
}

/** A match is only a routing suggestion. The caller still owns authorization and confirmation. */
export function classifyLocalBotIntent(raw:string):LocalBotMatch|undefined {
  if(!raw.trim() || raw.length>500 || /[\r\n]|https?:\/\/|www\.|@|#[a-z\d]|\d{6,}|[a-z\d][!$%&*+=][a-z\d]/i.test(raw))return undefined;
  const tokens=words(raw);
  if(tokens.length<2)return undefined;
  const text=tokens.join(" ");
  // Negated requests and mixed topics must not cause handoff, reset or other inferred actions.
  if(/\b(nao|nem|nunca|sem)\b.{0,35}\b(quero|preciso|chame|chamar|conversar|pessoa|equipe|humano|atendente|comprar|loja|ranking|fila)\b/.test(text))return undefined;
  const matched=(Object.keys(anchors)as LocalBotIntent[]).filter(intent => anchors[intent].some(anchor=>tokens.includes(anchor)));
  const specific=matched.filter(intent=>intent!=="HELP");
  if(specific.length>1 || (!specific.length && !matched.includes("HELP")))return undefined;
  const candidate=specific[0]??"HELP";
  // A person's name can contain "Pessoa" or "Equipe". Handoff requires a
  // request verb as well as the topic; a topic word alone is never consent.
  if(candidate==="HUMAN"&&!tokens.some(token=>["conversar","responder","atender","falar","ajudar"].includes(token)))return undefined;
  const vector=features(tokens);
  const scores=(Object.keys(CORPUS)as LocalBotIntent[]).map(intent=>({intent,score:Math.max(...documents.filter(document=>document.intent===intent).map(document=>cosine(vector,document.vector)))})).sort((a,b)=>b.score-a.score);
  const first=scores[0]!,second=scores[1]!;
  if(first.intent!==candidate || first.score<0.45 || first.score-second.score<0.12)return undefined;
  return {intent:first.intent,score:Math.round(first.score*1000)/1000};
}

/** Static policy mapping; password guesses can only explain, never reset credentials. */
export function localBotRouting(match:LocalBotMatch|undefined):{intent:"GREETING"|"QUEUE_INFO"|"HELP"|"HUMAN";progressCommand?:string;explanation?:string}|undefined {
  if(!match)return undefined;
  switch(match.intent){
    case "MENU":return {intent:"GREETING"};
    case "QUEUE":return {intent:"QUEUE_INFO",progressCommand:"minhas filas"};
    case "HUMAN":return {intent:"HUMAN"};
    case "WALLET":return {intent:"HELP",progressCommand:"carteira"};
    case "RANKING":return {intent:"HELP",progressCommand:"ranking"};
    case "PASSWORD_HELP":return {intent:"HELP",explanation:"Vamos resolver seu acesso. Para solicitar uma nova senha de participante, responda 3. Se sua conta é de Owner, use a credencial administrativa. Se precisar de uma pessoa, escreva Tenho dúvidas. Não alterei sua senha com esta mensagem."};
    case "STORE":return {intent:"HELP",explanation:"A loja fica no painel do SOS YOUTUBER. Abra Loja para consultar os produtos, os preços atuais e os benefícios antes de confirmar. Comprar guarda os itens no inventário; o uso é confirmado separadamente. Se precisar de uma pessoa, escreva Tenho dúvidas."};
    case "HELP":return {intent:"HELP"};
  }
}

/** Deterministic commands and name capture always win, even when a sentence resembles the corpus. */
export function localBotFallback(raw:string,explicitIntent:string,awaitingName=false){
  return explicitIntent==="UNKNOWN"&&!awaitingName?localBotRouting(classifyLocalBotIntent(raw)):undefined;
}

/** A substring such as "senha" must not turn an explicit refusal into a reset. */
export function declinesBotSensitiveAction(raw:string):boolean {
  const clauses=raw.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().split(/[,.!?;:\r\n]|\b(?:mas|porem|so que)\b/);
  return clauses.some(clause=>/\b(?:nao|nem|nunca)\s+(?:quero|preciso|desejo|necessito|pedi|estou pedindo)\b.{0,65}\b(?:senha|credencial|humano|humana|atendente|pessoa|equipe|administrador|suporte)\b/.test(clause));
}

