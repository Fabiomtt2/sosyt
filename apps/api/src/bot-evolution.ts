// AUDITORIA / HYBRID+ — motor de GRUPOS (Evolution), com freios de segurança.
//
// A Cloud API oficial não gerencia grupo real: ler membros, adicionar e remover só
// existe no motor não-oficial. Em troca, ele roda sobre uma sessão de WhatsApp Web
// e **pode tomar ban** — e perder esse número significa perder o admin de TODOS os
// grupos, com recuperação manual (recriar grupo, reconvidar todo mundo).
//
// Por isso este arquivo não é só um cliente HTTP. Ele carrega os freios que a
// reauditoria exigiu antes de qualquer disparo em grupo:
//
//  1. CADÊNCIA COM JITTER — 40 grupos recebendo a MESMA mensagem em 20s é a
//     assinatura exata que o WhatsApp usa para classificar automação. Mandamos uma
//     a cada 8–20s, com intervalo aleatório.
//  2. FAN-OUT ESPALHADO — "todos os grupos" vira uma janela de 30–60 min, nunca
//     uma rajada.
//  3. WARM-UP — número novo começa com teto baixo e sobe ao longo de ~3 semanas.
//  4. TETO DIÁRIO — por grupo e no total.
//  5. ROTAÇÃO DE TEXTO — N variantes por evento, para não repetir corpo idêntico.
//  6. BREAKER — sessão caída congela a fila em vez de acumular e despejar tudo na
//     reconexão (que é justamente o padrão que derruba número).
//  7. SEPARAÇÃO DE NÚMERO — o número do Evolution NUNCA pode ser o do OTP. Isso é
//     asserção em código, não recomendação em documento: se cair o número dos
//     grupos, o login da base inteira tem de continuar de pé.
//
// O cliente recebe `fetchImpl` por injeção para ser testável sem rede.

export type EvolutionConfig = {
  url: string;
  instance: string;
  apiKey: string;
  /** número que roda a sessão não-oficial (só dígitos) */
  number?: string;
};

export class EvolutionSafetyError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "EvolutionSafetyError";
  }
}

/**
 * Telefone (so digitos) a partir de um JID do WhatsApp. Devolve "" quando o JID e um
 * LID (`<id>@lid`) — LID e identificador PRIVADO, nao telefone, e tratar um como o
 * outro quebra todo vinculo de conta/grupo (que e chaveado por telefone).
 */
export function jidToPhone(jid?: string | null): string {
  const raw = String(jid ?? "");
  if (!raw) return "";
  if (/@lid$/i.test(raw)) return "";
  const digits = raw.split("@")[0].split(":")[0].replace(/\D/g, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : "";
}

/**
 * Dois números são o MESMO WhatsApp? Trata o "nono dígito" brasileiro: o WhatsApp
 * frequentemente representa o ownerJid SEM o 9 (ex.: 557193951582), enquanto o número
 * salvo vem COM o 9 (5571993951582). São o mesmo número.
 */
export function sameWhatsAppNumber(a: string, b: string): boolean {
  const da = String(a).replace(/\D/g, ""), db = String(b).replace(/\D/g, "");
  if (da === db) return true;
  // Brasil: 55 + DDD(2) + [9] + 8 dígitos. Remove o 9 logo após o DDI+DDD (índice 4).
  const strip9 = (n: string) => (n.length === 13 && n.startsWith("55") && n[4] === "9" ? n.slice(0, 4) + n.slice(5) : n);
  return strip9(da) === strip9(db);
}

/**
 * O número dos grupos não pode ser o número do OTP. Se a sessão não-oficial tomar
 * ban e for o mesmo número da Cloud API, ninguém mais recebe código de acesso.
 */
export function assertDistinctFromOfficial(evolutionNumber?: string, officialBusinessPhone?: string) {
  const a = (evolutionNumber ?? "").replace(/\D/g, "");
  const b = (officialBusinessPhone ?? "").replace(/\D/g, "");
  if (a && b && a === b) {
    throw new EvolutionSafetyError("SAME_NUMBER_AS_OFFICIAL",
      "O número do motor de grupos não pode ser o mesmo da API oficial. " +
      "Se a sessão não-oficial for bloqueada, o código de acesso de todos pararia junto.");
  }
}

// ───────────────────────────── Cadência ─────────────────────────────

export type CadencePolicy = {
  /** menor intervalo entre dois envios de grupo (ms) */
  minGapMs: number;
  /** maior intervalo (o sorteio fica entre min e max) */
  maxGapMs: number;
  /** janela em que um fan-out de "todos os grupos" é espalhado (ms) */
  fanOutWindowMs: number;
  /** teto de mensagens por grupo por dia */
  dailyCapPerGroup: number;
  /** teto total por dia, somando todos os grupos */
  dailyCapTotal: number;
  /** dias de aquecimento até o teto cheio */
  warmupDays: number;
  /** teto total no primeiro dia de aquecimento */
  warmupStartCap: number;
};

export const DEFAULT_CADENCE: CadencePolicy = {
  minGapMs: 8_000,
  maxGapMs: 20_000,
  fanOutWindowMs: 45 * 60_000,
  dailyCapPerGroup: 6,
  dailyCapTotal: 120,
  warmupDays: 21,
  warmupStartCap: 10,
};

/** Intervalo até o próximo envio, com jitter. `rand` injetável para teste. */
export function nextSendDelayMs(policy: CadencePolicy = DEFAULT_CADENCE, rand: () => number = Math.random): number {
  const span = Math.max(0, policy.maxGapMs - policy.minGapMs);
  return Math.round(policy.minGapMs + rand() * span);
}

/**
 * Teto do dia durante o aquecimento. Número novo que dispara no teto cheio no
 * primeiro dia é exatamente o que o WhatsApp penaliza.
 */
export function warmupCapForDay(dayIndex: number, policy: CadencePolicy = DEFAULT_CADENCE): number {
  if (dayIndex >= policy.warmupDays) return policy.dailyCapTotal;
  const day = Math.max(0, dayIndex);
  const ratio = policy.warmupDays === 0 ? 1 : day / policy.warmupDays;
  const span = policy.dailyCapTotal - policy.warmupStartCap;
  return Math.round(policy.warmupStartCap + span * ratio);
}

/**
 * Espalha N envios dentro da janela de fan-out, em ordem crescente e sem duas
 * mensagens no mesmo instante. Devolve os atrasos (ms) a partir de agora.
 */
export function spreadFanOut(count: number, policy: CadencePolicy = DEFAULT_CADENCE, rand: () => number = Math.random): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const step = policy.fanOutWindowMs / count;
  return Array.from({ length: count }, (_, index) => Math.round(index * step + rand() * step * 0.8))
    .sort((a, b) => a - b);
}

/**
 * Escolhe a variante do texto para este envio. Repetir corpo idêntico em dezenas
 * de grupos é sinal de automação; alternar reduz o padrão sem mudar o sentido.
 */
export function pickVariant(variants: readonly string[], seed: number): string {
  if (!variants.length) throw new EvolutionSafetyError("NO_VARIANT", "Nenhuma variante de texto fornecida.");
  return variants[Math.abs(Math.trunc(seed)) % variants.length];
}

// ───────────────────── Roteador de capacidade de grupo ─────────────────────

export type GroupSlot = { code: string; memberCount: number; capacity: number; enabled?: boolean };

/**
 * "Se o grupo 2 está cheio, entra no 3 ou no 1" — a regra que o dono pediu.
 *
 * Preferimos o grupo MAIS CHEIO que ainda tem vaga: assim os ciclos fecham antes,
 * em vez de espalhar pouca gente por muitos grupos pela metade. `preferred` tenta
 * primeiro o grupo desejado; se não couber, transborda para o melhor seguinte.
 */
export function pickGroupWithRoom(groups: readonly GroupSlot[], preferred?: string): GroupSlot | undefined {
  const withRoom = groups.filter((g) => g.enabled !== false && g.memberCount < g.capacity);
  if (!withRoom.length) return undefined;
  const wanted = preferred && withRoom.find((g) => g.code === preferred);
  if (wanted) return wanted;
  return [...withRoom].sort((a, b) => {
    const free = (a.capacity - a.memberCount) - (b.capacity - b.memberCount);
    return free !== 0 ? free : a.code.localeCompare(b.code, "pt-BR", { numeric: true });
  })[0];
}

// ───────────────────────────── Cliente ─────────────────────────────

export type EvolutionHealth = { connected: boolean; state?: string; detail?: string };
type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type EvolutionClient = ReturnType<typeof createEvolutionClient>;

export function createEvolutionClient(opts: {
  config: EvolutionConfig;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}) {
  const { config } = opts;
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const base = config.url.replace(/\/+$/, "");
  const timeout = opts.timeoutMs ?? 15_000;

  async function call(path: string, init: { method?: string; body?: unknown } = {}) {
    const response = await fetchImpl(`${base}${path}`, {
      method: init.method ?? "GET",
      headers: { apikey: config.apiKey, "content-type": "application/json" },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(timeout),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new EvolutionSafetyError(`EVOLUTION_${response.status}`,
        `O motor de grupos respondeu ${response.status}.`);
    }
    return payload as Record<string, unknown>;
  }

  return {
    /** A sessão está de pé? O breaker consulta isto antes de drenar a fila. */
    async health(): Promise<EvolutionHealth> {
      try {
        const data = await call(`/instance/connectionState/${encodeURIComponent(config.instance)}`);
        const state = String(
          (data as { instance?: { state?: string }; state?: string }).instance?.state
          ?? (data as { state?: string }).state ?? "",
        );
        // AUDITORIA / identidade: a sessão aberta tem que ser o MESMO número salvo —
        // senão um pareamento trocado mandaria em nome de outra conta.
        if (state === "open" && config.number) {
          const listing = await call(`/instance/fetchInstances?instanceName=${encodeURIComponent(config.instance)}`);
          const list = Array.isArray(listing) ? listing : [listing];
          const entry = list.find((item: Record<string, unknown>) => String(item.name ?? (item.instance as { instanceName?: string } | undefined)?.instanceName ?? "") === config.instance);
          const ownerRaw = String(entry?.ownerJid ?? (entry?.instance as { owner?: string; ownerJid?: string } | undefined)?.ownerJid ?? (entry?.instance as { owner?: string } | undefined)?.owner ?? "");
          // JID real pode vir como numero:device@server ou formato LID; compara só os
          // dígitos do número (antes de ':' e '@') para não congelar sessão legítima.
          const owner = ownerRaw.split("@")[0].split(":")[0].replace(/\D/g, "");
          const expected = String(config.number).replace(/\D/g, "");
          if (owner && expected && !sameWhatsAppNumber(owner, expected)) return { connected: false, state: "identity_unverified", detail: "A sessão conectada não confirmou o telefone salvo. Reconecte a instância correta." };
        }
        return { connected: state === "open", state: state || undefined };
      } catch (cause) {
        return { connected: false, detail: cause instanceof Error ? cause.message : "falha" };
      }
    },

    /** Gera o QR/pairing-code para parear o número à instância. */
    async connect(phone: string) {
      return call(`/instance/connect/${encodeURIComponent(config.instance)}?number=${encodeURIComponent(phone)}`);
    },
    /** Aponta o webhook da instância para o backend do SOS, com segredo e eventos mínimos. */
    async configureWebhook(url: string, secret: string) {
      return call(`/webhook/set/${encodeURIComponent(config.instance)}`, { method: "POST", body: { webhook: { enabled: true, url, webhookByEvents: false, webhookBase64: false, headers: { "x-sos-webhook-secret": secret }, events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"] } } });
    },
    /** Lista todos os grupos com participantes (para o sync de membership). */
    async groups(): Promise<Array<{ id: string; subject: string; participants: Array<{ id?: string; admin?: string }>; size?: number }>> {
      const data = await call(`/group/fetchAllGroups/${encodeURIComponent(config.instance)}?getParticipants=true`);
      if (!Array.isArray(data)) throw new EvolutionSafetyError("INVALID_GROUP_LIST", "O motor não retornou uma lista completa de grupos.");
      return data as Array<{ id: string; subject: string; participants: Array<{ id?: string; admin?: string }>; size?: number }>;
    },
    /** DM individual (boas-vindas, senha, suporte) com confirmação de recibo. */
    async sendText(recipient: string, text: string) {
      const data = await call(`/message/sendText/${encodeURIComponent(config.instance)}`, { method: "POST", body: { number: recipient, text } });
      const id = (data.key as { id?: unknown } | undefined)?.id;
      if (typeof id !== "string" || !id) throw new EvolutionSafetyError("INVALID_SEND_RECEIPT", "O motor não confirmou o envio.");
      return id;
    },

    async sendGroupText(groupId: string, text: string) {
      return call(`/message/sendText/${encodeURIComponent(config.instance)}`, {
        method: "POST",
        body: { number: groupId, text },
      });
    },

    async groupParticipants(groupId: string): Promise<string[]> {
      const data = await call(
        `/group/participants/${encodeURIComponent(config.instance)}?groupJid=${encodeURIComponent(groupId)}`,
      );
      const list = (data as { participants?: Array<{ id?: string; phoneNumber?: string }> }).participants ?? [];
      // AUDITORIA / LID: o WhatsApp novo entrega `id` como LID (identificador privado,
      // NAO telefone) e o telefone real em `phoneNumber`. Ler o `id` cru faria a
      // sincronizacao de membros comparar LIDs com telefones e nao casar NINGUEM.
      return list.map((p) => jidToPhone(p.phoneNumber) || jidToPhone(p.id)).filter(Boolean);
    },

    async addParticipant(groupId: string, phone: string) {
      return call(`/group/updateParticipant/${encodeURIComponent(config.instance)}?groupJid=${encodeURIComponent(groupId)}`, {
        method: "POST",
        body: { action: "add", participants: [phone.replace(/\D/g, "")] },
      });
    },

    async removeParticipant(groupId: string, phone: string) {
      return call(`/group/updateParticipant/${encodeURIComponent(config.instance)}?groupJid=${encodeURIComponent(groupId)}`, {
        method: "POST",
        body: { action: "remove", participants: [phone.replace(/\D/g, "")] },
      });
    },
  };
}
