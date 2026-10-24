// AUDITORIA / O "TERCEIRO OLHO" DO DONO SOBRE O PROPRIO SISTEMA.
//
// Frase do dono que originou este arquivo: "Se não consigo ver o que está tudo
// ativo, não tenho como observar bugs." Ele estava certo — e o problema era real:
// o painel mostrava telas de configuracao, mas nada dizia o que estava de fato
// LIGADO e FUNCIONANDO agora. Sem isso, toda conversa sobre bug virava adivinhacao
// (inclusive a minha: afirmei que a IA estava no ar quando o deploy dela falhara).
//
// Este diagnostico responde a uma unica pergunta, sem rodeios: o que esta ativo
// neste instante? Nenhum segredo e devolvido — apenas se cada credencial existe.
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";
import { gamificationConfig } from "./gamification.js";
import { readBotAiSettings, botAiUsageToday } from "./bot-ai-intent.js";
import { botMode, BOT_FEATURES, featureEnabled } from "./bot.js";
import { effectiveWhatsAppConfig, effectiveYouTubeConfig } from "./integrations.js";
import { activeRounds, vacanciesIn, QUEUE_LIFETIME_MS } from "./queues.js";
import { youTubeDenialSummary } from "./youtube-denials.js";

export function adminDiagnostics(db: AppDatabase, config: Config) {
  config = effectiveYouTubeConfig(db,config);
  const gam = gamificationConfig(db);
  const ai = readBotAiSettings(db);
  const wa = effectiveWhatsAppConfig(db, config);
  const agora = Date.now();

  const filas = activeRounds(db).map((r) => {
    const participantes = (db.prepare(
      "SELECT COUNT(*) AS n FROM round_participants WHERE round_id=? AND left_at IS NULL",
    ).get(r.id) as { n: number }).n;
    const videos = (db.prepare(
      "SELECT COUNT(*) AS n FROM submissions WHERE round_id=?",
    ).get(r.id) as { n: number } | undefined)?.n ?? 0;
    const expiraEm = Date.parse(r.createdAt) + QUEUE_LIFETIME_MS - agora;
    return {
      id: r.id, numero: r.displayNumber, status: r.status,
      participantes, videos, vagas: vacanciesIn(db, r.id),
      // "vazia" = ninguem dentro e nenhum video: e a fila que so polui a tela.
      vazia: participantes === 0 && videos === 0,
      expiraEmHoras: Math.max(0, Math.round(expiraEm / 3_600_000)),
    };
  });

  const entradaGrupo = db.prepare(
    "SELECT status, COUNT(*) AS n FROM group_join_requests GROUP BY status",
  ).all() as Array<{ status: string; n: number }>;

  return {
    release: "recusas-visiveis-20261024",
    gamificacao: {
      // Esta flag esconde o botao da Jornada inteiro (ranking, niveis, booster).
      // E a primeira coisa a olhar quando "sumiu a gamificacao".
      ativa: gam.enabled, xp: gam.xpEnabled, boosterSexta: gam.boosterEnabled,
      trocas: gam.redeemEnabled, rankingMensal: gam.monthlyEnabled,
    },
    ia: {
      ativa: ai.enabled, modelo: ai.model || null, provedor: ai.baseUrl || null,
      chaveConfigurada: ai.apiKeyConfigured, tetoDiario: ai.dailyCap,
      hoje: botAiUsageToday(db),
      // A IA so e consultada quando os gatilhos gratuitos nao entendem. Zero
      // chamadas significa "ninguem escreveu nada fora do esperado", nao defeito.
      observacao: "A IA só é chamada quando o classificador gratuito não entende a mensagem.",
    },
    bot: {
      modo: botMode(db),
      motorPronto: Boolean(wa.EVOLUTION_URL && wa.EVOLUTION_INSTANCE),
      funcoes: BOT_FEATURES.map((f) => ({ codigo: f.code, ligada: featureEnabled(db, f.code) })),
    },
    // AUDITORIA / O BLOQUEIO MAIS CARO DO PRODUTO FICAVA INVISIVEL.
    // Criar playlist exige o CLIENTE OAuth do Google (client id + secret). A
    // YOUTUBE_API_KEY nao substitui: ela le dados publicos, nao autoriza escrever na
    // conta de ninguem. Sem as duas, a rota de exportacao lanca antes de comecar e
    // NENHUM participante consegue criar playlist — mas nada na tela dizia isso, e o
    // dono passou dias achando que era defeito de codigo.
    youtube: {
      chaveDeLeitura: Boolean(config.YOUTUBE_API_KEY),
      clienteOAuth: Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
      podeCriarPlaylist: Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
      // Quantas pessoas o Google barrou nos ultimos 7 dias. Sem isso o dono so sabia
      // de bloqueio por relato no WhatsApp, caso a caso.
      recusas: youTubeDenialSummary(db),
      consequencia: config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
        ? "Participantes conseguem conectar o canal e criar playlists."
        : "Sem GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET nenhum participante consegue criar playlist. A YOUTUBE_API_KEY não substitui o cliente OAuth.",
    },
    filas: { total: filas.length, vazias: filas.filter((f) => f.vazia).length, lista: filas },
    entradaEmGrupo: Object.fromEntries(entradaGrupo.map((r) => [r.status, r.n])),
  };
}
