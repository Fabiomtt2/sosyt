// AUDITORIA / HYBRID+ — "ninguém nunca fala sozinho".
//
// A reauditoria encontrou CINCO portas por onde uma pessoa escreve para o bot e
// leva vácuo: só "quero participar" era entendido; nome com link ou longo demais
// caía fora; mensagem acima de 500 caracteres era descartada; a recusa PROMETIA
// "responda por aqui" sem handler; e o suporte mandava escrever "humano" sem que
// nenhuma linha de código lesse "humano". Áudio e foto sumiam calados.
//
// Este módulo classifica QUALQUER entrada e garante que sempre haja uma resposta.
// É puro (sem banco, sem rede) na classificação, para ser testável de verdade.
//
// Também implementa o OPT-OUT, que é dignidade e defesa ao mesmo tempo: quem pede
// para parar e continua recebendo acaba BLOQUEANDO o número — e bloqueio derruba a
// nota de qualidade da Meta, que por sua vez derruba a entrega do código de acesso.
// Respeitar o "pare" protege o login de todo mundo.
//
// REGRA DURA: opt-out NUNCA bloqueia mensagem transacional (código de acesso e
// decisão de cadastro). Quem pediu silêncio pediu silêncio de divulgação, não de
// segurança — e sem o código ele não entra na própria conta.
import type { AppDatabase } from "./db.js";

export type InboundIntent =
  | "PARTICIPATE"   // "quero participar"
  | "HUMAN"         // quer uma pessoa de verdade
  | "OPT_OUT"       // pare de me mandar mensagem
  | "OPT_IN"        // quero voltar a receber
  | "QUEUE_INFO"    // "2" / como funcionam as filas
  | "STATUS"        // "e aí, saiu?"
  | "RESEND_CODE"   // "não chegou meu código"
  | "GREETING"      // oi, bom dia
  | "HELP"          // ajuda, socorro, não entendi
  | "GROUP_ACCESS"  // "como entro no grupo", "me adiciona"
  | "PAYMENT"       // "e pago?", "tem mensalidade?", "como pago o pix"
  | "AVATAR"        // "como troco meu avatar", "emblemas"
  | "UPLOAD_HELP"   // "onde coloco o link do meu canal"
  | "THANKS"        // "obrigado", "valeu" — merece carinho, nao um menu
  | "NAME_CANDIDATE"// pode ser o nome, quando estamos perguntando
  | "UNKNOWN";      // nada acima — AINDA ASSIM responde

/** Mesma normalização já usada no webhook: sem acento, minúsculo. */
export function normalizeInbound(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

// Cada intenção tem frases de gatilho. Comparação por inclusão no texto normalizado,
// então "quero falar com humano" e "HUMANO" caem no mesmo lugar.
const TRIGGERS: Array<{ intent: InboundIntent; phrases: string[] }> = [
  { intent: "OPT_OUT", phrases: [
    "pare", "parar", "sair", "cancelar inscricao", "descadastrar", "nao quero mais receber",
    "nao quero receber", "me tira", "me tire", "remover meu numero", "stop",
  ] },
  { intent: "OPT_IN", phrases: ["voltar a receber", "quero receber", "reativar avisos", "voltei"] },
  { intent: "HUMAN", phrases: [
    // AUDITORIA / gatilho principal divulgado no grupo: 'Tenho dúvidas' (acento é
    // removido por normalizeInbound, entao com ou sem acento cai aqui). "tenho duvida"
    // no singular casa tambem o plural via includes. Vem antes de HELP na ordem, entao
    // "tenho duvidas" chama uma pessoa em vez de cair na ajuda automatica.
    "tenho duvida", "tenho uma duvida", "tenho duvidas", "estou com duvida",
    "preciso de suporte", "quero suporte", "falar com o suporte", "falar com a equipe", "falar com um admin", "falar com o admin", "falar com um owner", "falar com rafael", "falar com fabio", "atendimento humano", "atendimento pessoal", "uma pessoa me ajuda", "tenho 1 duvida", "humano", "atendente", "pessoa de verdade", "falar com alguem", "falar com uma pessoa", "suporte humano",
  ] },
  // AUDITORIA / TOPICOS QUE A COMUNIDADE PERGUNTA E O BOT IGNORAVA.
  // Medido com sonda de 31 mensagens reais: 13 caiam no menu genérico. Nao era falha
  // do classificador — eram assuntos inteiros fora do vocabulario. "grupo" era o pior:
  // existe automacao de entrada em grupo e nao havia como pedi-la falando.
  { intent: "GROUP_ACCESS", phrases: [
    "entrar no grupo", "entro no grupo", "entrar nos grupos", "link do grupo", "link dos grupos",
    "me adiciona", "me adicione", "me coloca no grupo", "me bota no grupo", "grupo do whatsapp",
    "nao estou no grupo", "nao estou em nenhum grupo", "qual grupo", "quero o grupo", "convite do grupo",
  ] },
  { intent: "UPLOAD_HELP", phrases: [
    "mandar meu video", "enviar meu video", "mandar o video", "enviar o video", "subir meu video",
    "link do meu canal", "link do meu video", "onde coloco o link", "onde coloco meu link",
    "meu video nao aparece", "nao consigo mandar o video", "como mando o video",
  ] },
  { intent: "PAYMENT", phrases: [
    "e pago", "é pago", "tem mensalidade", "mensalidade", "quanto custa", "qual o valor", "qual valor",
    "como pago", "como pagar", "fazer o pix", "pagar com pix", "chave pix", "forma de pagamento", "pix", "pago o pix", "pagar o pix",
    "assinatura super", "como assino", "quero assinar", "e gratis", "é gratis", "e de graca",
  ] },
  { intent: "AVATAR", phrases: [
    "meu avatar", "trocar avatar", "trocar de avatar", "mudar avatar", "mudar meu avatar",
    "emblema", "emblemas", "foto de perfil", "personagem",
  ] },
  // AUDITORIA / menu numerado: a pessoa pode responder "1".."5" como atalho.
  { intent: "PARTICIPATE", phrases: ["1"] },
  { intent: "HELP", phrases: ["ranking", "rank", "classificacao", "meu nivel", "nivel", "xp", "carteira", "saldo", "inventario", "gamificacao", "quem ta ganhando", "quem esta ganhando", "quem ta na frente", "quem ganhou", "quem lidera", "quem ta no topo"] },
  { intent: "QUEUE_INFO", phrases: ["2", "fila", "filas", "como funciona a fila", "como funcionam as filas"] },
  { intent: "RESEND_CODE", phrases: ["3", "trocar senha", "nova senha", "mudar senha", "resetar senha", "senha", "nao consigo entrar", "esqueci a senha", "perdi a senha", "nao entro"] },
  { intent: "STATUS", phrases: ["4"] },
  { intent: "HELP", phrases: ["5", "moedas", "pontos", "niveis", "recompensa"] },
  { intent: "RESEND_CODE", phrases: [
    "nao chegou", "nao recebi", "reenviar codigo", "reenvia o codigo", "codigo nao", "sem codigo",
  ] },
  { intent: "STATUS", phrases: ["status", "e ai saiu", "ja saiu", "foi aprovado", "minha solicitacao", "novidade"] },
  // AUDITORIA / CADASTRO NAO PODE COMECAR POR ACIDENTE.
  // "continuar", "comecar" e "participar" soltos casavam por INCLUSAO: quem escrevia
  // "vou continuar depois" ou "ja comecei a participar" era jogado em WAITING_NAME, e
  // a mensagem SEGUINTE virava o nome — gerando conta e SENHA para quem nunca pediu.
  // Era a "senha solta depois de uma mensagem" relatada pelo dono. Agora so frases
  // que declaram a intencao, e o atalho "1" (que ja casa por igualdade exata).
  { intent: "PARTICIPATE", phrases: [
    "quero participar", "quero entrar", "quero me cadastrar", "quero fazer parte",
    "como participo", "como me cadastro", "fazer cadastro", "fazer meu cadastro",
    "me cadastrar", "criar conta", "criar minha conta", "quero criar conta",
  ] },
  { intent: "HELP", phrases: ["ajuda", "socorro", "nao entendi", "me ajuda", "duvida", "como funciona"] },
  { intent: "THANKS", phrases: ["obrigado", "obrigada", "obrigado!", "valeu", "vlw", "muito obrigado", "muito obrigada", "gratidao", "agradecido", "brigado", "brigada"] },
  { intent: "GREETING", phrases: ["oi", "ola", "bom dia", "boa tarde", "boa noite", "e ai", "opa", "menu"] },
];

/** Frase curta é saudação só quando é a mensagem inteira (evita casar "oi" dentro de "coisa"). */
const SHORT_EXACT: InboundIntent[] = ["GREETING", "OPT_OUT", "OPT_IN", "HUMAN", "STATUS", "THANKS"];

/**
 * Classifica a entrada. `awaitingName` muda o desfecho: durante a pergunta do nome,
 * um texto que não é comando provavelmente É o nome.
 */
export function classifyInbound(raw: string, opts: { awaitingName?: boolean } = {}): InboundIntent {
  const text = normalizeInbound(raw);
  if (!text) return "UNKNOWN";
  for (const { intent, phrases } of TRIGGERS) {
    for (const phrase of phrases) {
      // OPT_OUT casa por PALAVRA INTEIRA: "pare/parar/sair" nunca pega "preparar",
      // "comparar", "sairei". As demais curtas seguem exato (<=4) ou substring.
      const wholeWord = (needle: string) =>
        new RegExp(`(^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(text);
      // AUDITORIA / NUMERO DO MENU SO CONTA SE FOR A MENSAGEM INTEIRA. Antes o gatilho
      // usava `includes`, entao QUALQUER texto com o digito ("tenho 1 duvida", um
      // telefone, "dia 15") disparava a opcao — foi o que cadastrava gente sem ela ter
      // escolhido nada. Digito isolado agora exige igualdade exata.
      const hit = /^\d$/.test(phrase)
        ? text === phrase
        : intent === "OPT_OUT" || (intent === "HELP" && (phrase === "rank" || phrase === "xp"))
          ? wholeWord(phrase)
          : SHORT_EXACT.includes(intent) && phrase.length <= 4
            ? text === phrase
            : text.includes(phrase);
      if (hit) {
        if(intent==="PARTICIPATE" && opts.awaitingName
          && /^(?:(?:oi|olá|ola)[,!]?\s+)?(?:meu nome|me chamo|eu me chamo|pode me chamar de|eu sou)\b/iu.test(raw.trim())
          && extractPreferredName(raw))return "NAME_CANDIDATE";
        return intent;
      }
    }
  }
  if (opts.awaitingName && looksLikeName(raw)) return "NAME_CANDIDATE";
  return "UNKNOWN";
}

/**
 * O nome é aceitável? Antes, nome com link/quebra/longo demais caía num `else if`
 * que não enviava NADA. Agora separamos "é nome" de "não é" para sempre responder.
 */
/**
 * A frase inteira nunca deve virar o nome de cadastro.
 * Reconhece apresentações comuns sem usar modelo remoto ou confiar em texto inventado.
 * O motor local de intenções continua responsável por dúvidas e comandos.
 */
export function extractPreferredName(raw: string): string | undefined {
  const message=raw.trim().replace(/\s+/gu," ");
  const bare=/^(?:(?:oi|olá|ola|bom dia|boa tarde|boa noite)[,!.]?\s+)?(?:meu nome(?:\s+é|\s+e|\s*:)|eu me chamo|me chamo|chamo-me|pode me chamar de|me chama de|eu sou|sou o|sou a)\s*$/iu;
  if(bare.test(message))return undefined;
  const match=/^(?:(?:oi|olá|ola|bom dia|boa tarde|boa noite)[,!.]?\s+)?(?:o?\s*meu nome\s*(?:é|e|:)|eu me chamo|me chamo|chamo-me|pode me chamar de|me chama de|eu sou|sou o|sou a)\s+(.+)$/iu.exec(message);
  let candidate=match?.[1]??message;
  if(match)candidate=candidate.replace(/\s+(?:e\s+)?(?:quero|gostaria|preciso|tenho|estou|vou)\s+.+$/iu,"");
  candidate=candidate.replace(/[.!?;,]+$/u,"").trim();
  if(nameRejectionReason(candidate))return undefined;
  return candidate;
}

export function looksLikeName(raw: string): boolean {
  const name = raw.trim();
  return nameRejectionReason(name) === undefined;
}

/** Por que o nome não serve — usado para explicar com gentileza, em vez de calar. */
export function nameRejectionReason(raw: string): string | undefined {
  const name = raw.trim();
  if (!/\p{L}/u.test(name) || /^(continuar|cadastrar|entrar|sim|ok|okay|menu|voltar|obrigad[oa]|meu nome (?:e|é)|me chamo|eu sou|sou o|sou a)$/i.test(normalizeInbound(name))) return "Ainda preciso saber seu nome. Como prefere ser chamado?";
  if (name.length < 2) return "Esse nome ficou curtinho — me manda com pelo menos duas letras?";
  if (name.length > 80) return "Esse nome ficou bem comprido! Pode mandar só como prefere ser chamado?";
  if (/https?:\/\//i.test(name)) return "Por segurança não consigo guardar links aqui. Me manda só o seu nome?";
  if (/[\r\n]/.test(name)) return "Me manda só o nome numa linha só, por favor?";
  return undefined;
}

// ───────────────────────────── OPT-OUT ─────────────────────────────

export function ensureBotOptOut(db: AppDatabase) {
  db.exec(`CREATE TABLE IF NOT EXISTS bot_opt_out (
    phone TEXT PRIMARY KEY,
    opted_out_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'WHATSAPP'
  );`);
}

export function isOptedOut(db: AppDatabase, phone: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM bot_opt_out WHERE phone=?").get(phone));
}

export function setOptOut(db: AppDatabase, phone: string, optedOut: boolean, source = "WHATSAPP") {
  if (optedOut) {
    db.prepare("INSERT INTO bot_opt_out (phone,opted_out_at,source) VALUES (?,?,?) ON CONFLICT(phone) DO NOTHING")
      .run(phone, new Date().toISOString(), source);
  } else {
    db.prepare("DELETE FROM bot_opt_out WHERE phone=?").run(phone);
  }
}

/** Mensagens que o opt-out NUNCA bloqueia: sem elas a pessoa perde a própria conta. */
export const TRANSACTIONAL_KINDS = ["LOGIN_CODE", "DECISION_NOTICE", "SUPPORT_REPLY"] as const;
export type MessageKind = (typeof TRANSACTIONAL_KINDS)[number] | "ENGAGEMENT";

export function mayReceive(db: AppDatabase, phone: string, kind: MessageKind): boolean {
  if (kind !== "ENGAGEMENT") return true;       // transacional sempre passa
  return !isOptedOut(db, phone);
}

// ───────────────────────── Respostas de fallback ─────────────────────────
//
// Voz: acolhedora e objetiva. Nunca culpa a pessoa, sempre oferece a saída.

export const INBOUND_REPLIES: Record<Exclude<InboundIntent, "NAME_CANDIDATE" | "PARTICIPATE">, string> = {
  HUMAN: "Combinado! 🙋 Já estou chamando uma pessoa da equipe para falar com você por aqui. Pode aguardar só um pouquinho — obrigado pela paciência. 💛",
  OPT_OUT: "Tudo bem, respeitamos sua escolha. 🤝 Não vou mais te mandar avisos e novidades. Você vai continuar recebendo só o essencial, como o código de acesso à sua conta. Se mudar de ideia, é só escrever VOLTAR.",
  OPT_IN: "Que bom te ver de volta! 🎉 Voltei a te avisar sobre filas e novidades. Se quiser parar de novo, é só escrever PARE.",
  STATUS: "Deixa eu conferir pra você! 🔎 Já já te respondo com a situação do seu cadastro por aqui mesmo.",
  RESEND_CODE: "Sem problema! 📲 Vou providenciar o reenvio do seu código de acesso. Se não chegar em alguns minutos, me escreva 'Tenho dúvidas' que uma pessoa te ajuda.",
  GREETING: "Oi! 👋 Que bom te ver por aqui! Eu sou o bot do SOS YOUTUBER e tô aqui pra te ajudar no que precisar. 💛\n\nMe diz o que você quer (pode escrever com suas palavras ou mandar o número):\n\n1. ENTRAR — quero participar do projeto\n2. FILA — como funcionam as filas de 10 links\n3. SENHA — não consigo entrar na minha conta\n4. STATUS — quero saber como está meu cadastro\n5. MOEDAS — pontos, níveis e recompensas\n\nE se preferir falar com uma pessoa de verdade, é só escrever *Tenho dúvidas* que eu chamo alguém da equipe. 🙋",
  QUEUE_INFO: "Te explico! 🎬 Cada fila reúne até *10 links* e fica ativa por 72 horas desde a abertura. Você pode ver todas as filas; participa das que estão liberadas para sua conta. 💛\n\nPode criar a playlist com menos de 10 vídeos após ler e confirmar o aviso: terá menos XP de progresso e essa seleção parcial não gera moedas. Se a fila completar depois, pode criar outra playlist com os 10, sem duplicar recompensas.\n\n*Passe* libera mais um campo de URL na sua fila aberta. *Pular* permite escolher outra fila. Compre para guardar no inventário e confirme o uso quando quiser.\n\nAbra o painel para criar sua playlist e acompanhar o progresso verificado. Para consultar suas filas por aqui, escreva *minhas filas*. Se precisar de uma pessoa, escreva *Tenho dúvidas*.",
  HELP: "Claro, tô aqui pra isso! 💛 Me diz o que você precisa (palavra ou número):\n\n1. ENTRAR — participar do projeto\n2. FILA — como funcionam as filas\n3. SENHA — problema para acessar a conta\n4. STATUS — situação do seu cadastro\n5. MOEDAS — pontos, níveis e recompensas\n\nSe nada disso resolver, escreve *Tenho dúvidas* que uma pessoa da equipe te atende. 🙋",
  // AUDITORIA / respostas dos topicos novos. Nenhum numero inventado: participar e
  // gratuito (o bot cadastra sem cobrar), o SUPER e assinatura OPCIONAL e os precos
  // atuais vivem no painel — citar valor aqui envelheceria e viraria mentira.
  GROUP_ACCESS: "Eu cuido disso pra você! 🤝 Vou te encaminhar para um grupo SOS YOUTUBER com vaga e te aviso aqui quando entrar.\n\nSe a privacidade do seu WhatsApp bloquear a inclusão automática, eu te mando o convite por aqui — aí basta um toque. 💛",
  PAYMENT: "Boa pergunta! 💛 *Participar do SOS YOUTUBER é gratuito* — eu faço seu cadastro sem cobrar nada e você entra nas filas normalmente.\n\nO que é pago é opcional: o *SUPER* (assinatura com vantagens) e alguns itens da loja, como *Passe* e *Pular*. Os valores atuais ficam no painel, em Loja — assim você vê o preço certo antes de confirmar qualquer coisa.\n\nPagamento por *Pix*. Se tiver dúvida na hora de pagar, escreve *Tenho dúvidas* que uma pessoa te acompanha. 🙋",
  AVATAR: "Seu avatar e seus emblemas ficam no painel! ✨ Entre em sua conta e abra o seu perfil para escolher.\n\nOs *emblemas de nível* são desbloqueados conforme você sobe de nível participando das filas — eles aparecem sozinhos quando você conquista. 🏅\n\nAlguns avatares são de *eventos e temporadas*: aparecem só enquanto a campanha está no ar. 💛",
  UPLOAD_HELP: "Te explico! 🎬 O link do vídeo é colado *na fila*, dentro do painel — não aqui no WhatsApp.\n\nEntre em sua conta, abra a fila liberada para você e cole a URL do seu vídeo no campo da sua posição. Assim que você envia, eu anuncio no grupo para a galera assistir e apoiar. 🙌\n\nSe o seu vídeo não aparecer depois de enviar, escreve *minhas filas* que eu te mostro a situação. 💛",
  THANKS: "Eu que agradeço! 💛 Tamo junto nessa. Se precisar de qualquer coisa, é só me chamar — tô por aqui. 🚀",
  UNKNOWN: "Recebi sua mensagem! 💛 Não entendi direito dessa vez, mas não vou te deixar sem resposta.\n\nPode tentar de um jeito mais simples? Escolha uma opção (palavra ou número):\n\n1. ENTRAR — participar do projeto\n2. FILA — como funciona\n3. SENHA — recuperar acesso\n4. STATUS — meu cadastro\n5. MOEDAS — níveis e recompensas\n\nOu escreve *Tenho dúvidas* que eu chamo uma pessoa da equipe pra te ajudar com calma. 🙋",
};

/** Mídia (áudio, foto, vídeo) nunca mais cai no silêncio. */
export const MEDIA_REPLY =
  "Recebi seu arquivo! 🎧 Ainda não consigo ouvir áudio nem abrir imagem por aqui, mas já avisei a equipe. " +
  "Se puder escrever em uma frase o que você precisa, eu te ajudo agora mesmo, ou escreve 'Tenho dúvidas' que uma pessoa te responde.";

/** Mensagem muito longa também era descartada em silêncio. */
export const TOO_LONG_REPLY =
  "Recebi sua mensagem, mas ela ficou um pouco longa pro meu limite aqui. 💛 " +
  "Pode me mandar o essencial em poucas linhas? Se preferir desabafar com uma pessoa, escreve 'Tenho dúvidas'.";

/** Resposta para quem responde a uma recusa — a promessa que o texto fazia e ninguém cumpria. */
export const DECLINED_FOLLOWUP_REPLY =
  "Recebi sua mensagem e ela não vai se perder. 💛 Encaminhei para os Owners revisarem seu caso com calma. " +
  "Assim que houver uma resposta, eu te aviso por aqui.";

/** A resposta do bot para uma intenção, já pronta para enfileirar. */
export function replyFor(intent: InboundIntent): string | undefined {
  if (intent === "NAME_CANDIDATE" || intent === "PARTICIPATE") return undefined; // fluxo próprio
  return INBOUND_REPLIES[intent];
}
