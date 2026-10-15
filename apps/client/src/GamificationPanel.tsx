import { useEffect, useRef, useState } from "react";
import { Award, CalendarDays, Check, ChevronDown, Coins, Crown, Gift, Leaf, LoaderCircle, RefreshCw, ShieldCheck, SkipForward, Sparkles, Star, Ticket, Trophy } from "lucide-react";
import { UserAvatarView } from "./AvatarModal";
import type { UserAvatar, UserPresentation } from "./api";
import "./gamification.css";

export type JourneyProgress = {
  xp: number;
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  progressPercent: number;
  rewardCoins: number;
  roadmap: Array<{ level: number; coins: number; superDays: number }>;
};
export type JourneyRankEntry = {
  name: string;
  avatar?: UserAvatar;
  presentation?: UserPresentation;
  groupCode?: string;
  progress?: Pick<JourneyProgress, "level">;
  xp: number;
  position: number;
};
export type BoosterClaimResult = {
  code: string;
  label: string;
  coins?: number;
  quantity?: number;
  superDays?: number;
  alreadyClaimed?: boolean;
};
export type GamificationData = {
  milestones?:{every:number;coins:number;trialEvery:number;trialDays:number};
  redemptionEnabled?:boolean;
  progress: JourneyProgress;
  ranks: { monthly: JourneyRankEntry[]; allTime: JourneyRankEntry[] };
  booster: {
    available: boolean;
    claimed: boolean;
    windowEndsAt?: string;
    odds: Array<{ code: string; label: string; weight: number; probability: number }>;
  };
  redemption: { SKIP: number; PASS: number };
};
export type GamificationPanelProps = {
  data: GamificationData;
  onClaimBooster: () => Promise<BoosterClaimResult>;
  onRedeem: (code: "SKIP" | "PASS", referenceId: string) => Promise<unknown>;
  onRefresh?: () => Promise<unknown>;
};
const number = (value: number) => Math.max(0, Number.isFinite(value) ? value : 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const progressValue = (value: number) => Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
const tiers = [
  { from: 30, title: "Constelação", icon: Trophy, className: "constellation" },
  { from: 20, title: "Destaque", icon: Crown, className: "crown" },
  { from: 10, title: "Criador", icon: Award, className: "creator" },
  { from: 5, title: "Conexão", icon: Star, className: "connection" },
  { from: 1, title: "Começo", icon: Leaf, className: "beginning" }
];

export function LevelBadge({ progress, className = "", compact = false }: {
  progress: { level: number };
  className?: string;
  compact?: boolean;
}) {
  const level = Math.max(1, Math.floor(Number.isFinite(progress.level) ? progress.level : 1));
  const tier = tiers.find((item) => level >= item.from) ?? tiers[tiers.length - 1];
  const Emblem = tier.icon;
  return <span className={"journey-level-badge journey-tier-" + tier.className + (compact ? " is-compact" : "") + " " + className}
    title={"Nível " + level + " · " + tier.title} aria-label={"Nível " + level + " · " + tier.title}>
    <span className="journey-level-emblem" aria-hidden="true"><Emblem size={compact ? 15 : 28} strokeWidth={1.7}/></span>
    <span className="journey-level-label">{"Nível "}<b>{level}</b></span>
  </span>;
}

function Ranking({ entries, label }: { entries: JourneyRankEntry[]; label: string }) {
  const visible = [...entries].sort((a, b) => a.position - b.position).slice(0, 10);
  return <ol className="journey-ranking" aria-label={label}>
    {visible.length ? visible.map((entry) => <li key={entry.position + ":" + entry.name} className={entry.position <= 3 ? "is-podium" : ""}>
      <span className="journey-rank-position" aria-label={"Posição " + entry.position}>{entry.position <= 3 ? <Trophy size={16} aria-hidden="true"/> : null}<b>{entry.position}</b></span>
      <UserAvatarView avatar={entry.avatar} presentation={entry.presentation} name={entry.name} className="journey-rank-avatar"/>
      <span className="journey-rank-person"><strong>{entry.name}</strong><small>{entry.groupCode && entry.groupCode !== "#" ? "SOS YOUTUBER " + entry.groupCode : entry.presentation?.badge === "ADMIN" ? "Administração" : "Comunidade"}</small></span>
      {entry.progress && <LevelBadge progress={entry.progress} compact/>}
      <span className="journey-rank-xp"><b>{number(entry.xp)}</b><small>XP</small></span>
    </li>) : <li className="journey-ranking-empty"><Sparkles size={22} aria-hidden="true"/><span>As primeiras jornadas vão aparecer aqui.</span></li>}
  </ol>;
}

export function GamificationPanel({ data, onClaimBooster, onRedeem, onRefresh }: GamificationPanelProps) {
  const [rankingTab, setRankingTab] = useState<"monthly" | "allTime">("monthly");
  const [busy, setBusy] = useState<"booster" | "SKIP" | "PASS" | "refresh">();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reward, setReward] = useState<BoosterClaimResult>();
  const [now, setNow] = useState(Date.now());
  const mounted = useRef(true);
  const operation = useRef(false);
  const redemptionReferences = useRef<Partial<Record<"SKIP" | "PASS", string>>>({});
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const { progress } = data;
  const percent = progressValue(progress.progressPercent);
  const roadmap = progress.roadmap.filter((item) => item.level > progress.level).slice(0, 10);
  const windowEndsAt = data.booster.windowEndsAt ? Date.parse(data.booster.windowEndsAt) : undefined;
  const expired = windowEndsAt !== undefined && Number.isFinite(windowEndsAt) && now >= windowEndsAt;
  const canClaim = data.booster.available && !data.booster.claimed && !reward && !expired;
  const deadline = windowEndsAt !== undefined && Number.isFinite(windowEndsAt)
    ? new Date(windowEndsAt).toLocaleString("pt-BR", { timeZone: "America/Bahia", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : undefined;

  async function refreshAfterSuccess() {
    if (!onRefresh) return;
    try { await onRefresh(); }
    catch { if (mounted.current) setNotice((value) => value + " O painel será atualizado quando a conexão voltar."); }
  }
  async function claimBooster() {
    if (!canClaim || operation.current) return;
    operation.current = true;
    setBusy("booster"); setError(""); setNotice("");
    try {
      const confirmed = await onClaimBooster();
      if (!mounted.current) return;
      setReward(confirmed);
      setNotice(confirmed.alreadyClaimed ? "Este presente já foi recebido. Seu histórico foi preservado." : "Presente confirmado! A recompensa já foi registrada na sua conta.");
      await refreshAfterSuccess();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Não conseguimos abrir seu presente agora. Tente novamente.");
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(undefined);
    }
  }
  async function redeem(code: "SKIP" | "PASS") {
    if (operation.current || data.redemptionEnabled===false || progress.rewardCoins < data.redemption[code]) return;
    operation.current = true;
    setBusy(code); setError(""); setNotice("");
    try {
      const referenceId = redemptionReferences.current[code] ?? crypto.randomUUID();
      redemptionReferences.current[code] = referenceId;
      await onRedeem(code, referenceId);
      if (!mounted.current) return;
      delete redemptionReferences.current[code];
      setNotice((code === "SKIP" ? "Pular" : "Passe") + " confirmado no seu inventário. Use quando fizer sentido para você.");
      await refreshAfterSuccess();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Não conseguimos concluir a troca agora. Seu histórico continua salvo.");
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(undefined);
    }
  }
  async function refresh() {
    if (!onRefresh || operation.current) return;
    operation.current = true; setBusy("refresh"); setError("");
    try { await onRefresh(); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "Não conseguimos atualizar sua jornada agora."); }
    finally { operation.current = false; if (mounted.current) setBusy(undefined); }
  }

  return <section className="journey-panel" aria-labelledby="journey-heading">
    <div className="journey-heading">
      <div><p className="journey-eyebrow">SUA JORNADA NA COMUNIDADE</p><h2 id="journey-heading">Cada passo conta.</h2><p>Seu progresso acompanha você, entre vídeos e sessões.</p></div>
      {onRefresh && <button type="button" className="journey-icon-button" aria-label="Atualizar minha jornada" title="Atualizar minha jornada" disabled={Boolean(busy)} onClick={() => void refresh()}><RefreshCw size={18} className={busy === "refresh" ? "spin" : undefined}/></button>}
    </div>
    <div className="journey-progress-card">
      <LevelBadge progress={progress}/>
      <div className="journey-xp-copy"><div><strong>{number(progress.xp)} XP acumulados</strong><span>{number(progress.xpIntoLevel)} de {number(progress.xpForNextLevel)} XP para o próximo nível</span></div>
        <div className="journey-progress-track" role="progressbar" aria-label="Progresso até o próximo nível" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={number(percent) + "% para o próximo nível"}><span style={{ width: percent + "%" }}/></div>
        <small>XP registra sua evolução. Suas moedas de recompensa ficam separadas.</small>
      </div>
      <div className="journey-reward-wallet"><Coins size={23} aria-hidden="true"/><div><strong>{number(progress.rewardCoins)}</strong><span>moedas de recompensa</span></div></div>
    </div>

    <div className="journey-grid">
      <div className="journey-roadmap">
        <div className="journey-block-heading"><Sparkles size={20} aria-hidden="true"/><div><h3>Um passo de cada vez</h3><p>Os próximos dez níveis da sua jornada.</p></div></div>
        <ol className="journey-milestones">
          {roadmap.map((step) => <li key={step.level} className={step.superDays > 0 ? "is-super-milestone" : ""}>
            <span className="journey-milestone-level">Nível <strong>{step.level}</strong></span>
            <span>{step.coins > 0 ? <><Coins size={13} aria-hidden="true"/>+{number(step.coins)}</> : "Próximo passo"}</span>
            {step.superDays > 0 && <small><Crown size={13} aria-hidden="true"/>{step.superDays} dias SUPER</small>}
          </li>)}
        </ol>
        <p className="journey-milestone-note"><Award size={17} aria-hidden="true"/><span>A cada {data.milestones?.every??10} níveis, +{data.milestones?.coins??20} moedas de bônus. A cada {data.milestones?.trialEvery??30}, {data.milestones?.trialDays??7} dias de SUPER.</span></p>
        <details className="journey-how"><summary>Como minha jornada avança?<ChevronDown size={17} aria-hidden="true"/></summary><p>A experiência vem do progresso registrado nos vídeos. O servidor mantém o histórico da sua conta e considera somente o avanço novo. Fechar o acompanhamento pausa sua jornada; voltar permite continuar.</p><p>Um nível é uma conquista interna da comunidade. Ele não comprova atenção humana nem modifica os números do YouTube.</p></details>
      </div>

      {(canClaim||reward)&&<div className={"journey-booster" + (canClaim ? " is-available" : "") + (reward ? " is-revealed" : "")}>
        <div className="journey-block-heading"><CalendarDays size={20} aria-hidden="true"/><div><h3>Presente de sexta</h3><p>Um convite para celebrar sua jornada.</p></div></div>
        <div className="journey-booster-art" aria-hidden="true"><span className="journey-booster-aura"/><span className="journey-booster-star"><Star size={60} fill="currentColor" strokeWidth={1}/></span><span className="journey-booster-packet"><span className="journey-packet-seam"/><Gift size={34} strokeWidth={1.5}/><span className="journey-packet-label">SOS</span></span><Sparkles className="journey-booster-spark" size={24}/></div>
        {reward ? <div className="journey-booster-reveal" role="status"><Check size={24} aria-hidden="true"/><strong>{reward.label}</strong><span>{reward.alreadyClaimed ? "Já registrado na sua conta." : "Registrado na sua conta, com carinho."}</span></div>
          : <><p className="journey-booster-status">{data.booster.claimed ? "Seu presente desta semana já foi recebido." : canClaim ? "Seu presente está pronto. Quer abrir?" : "O próximo presente chega na sexta, às 6h."}</p>
          {canClaim && deadline && <small className="journey-booster-deadline">Disponível até {deadline}, horário de Brasília.</small>}
          <button type="button" className="journey-primary journey-open-booster" disabled={!canClaim || Boolean(busy)} onClick={() => void claimBooster()}>{busy === "booster" ? <><LoaderCircle size={18} className="spin"/>Abrindo seu presente…</> : <><Gift size={18}/>{data.booster.claimed ? "Presente recebido" : canClaim ? "Abrir meu presente" : "Até a próxima sexta"}</>}</button></>}
        <details className="journey-booster-odds"><summary>O que pode vir no presente?<ChevronDown size={17} aria-hidden="true"/></summary>
          <p>Um resultado por abertura. A confirmação acontece no servidor.</p>
          <ul>{data.booster.odds.map((chance) => <li key={chance.code}><span>{chance.label}</span><b>{Math.max(0, Math.min(1, chance.probability)).toLocaleString("pt-BR", { style: "percent", maximumFractionDigits: 2 })}</b></li>)}</ul>
          <small>Você não precisa comprar nada para abrir o presente disponível.</small>
        </details>
      </div>}
    </div>

    <div className="journey-redemptions">
      <div className="journey-block-heading"><Coins size={20} aria-hidden="true"/><div><h3>Escolha como usar suas recompensas</h3><p>Troque suas moedas de recompensa por uma ajuda na próxima fila.</p></div></div>
      <div className="journey-redemption-grid">{([
        { code: "SKIP", label: "Pular", icon: SkipForward, help: "Entre em outra fila sem encerrar a que acompanha." },
        { code: "PASS", label: "Passe", icon: Ticket, help: "Envie uma contribuição extra na mesma fila." }
      ] as const).map((item) => <div className="journey-redemption-card" key={item.code}><span className="journey-item-icon"><item.icon size={25} strokeWidth={1.5}/></span><div><h4>{item.label}</h4><p>{item.help}</p><small>{number(data.redemption[item.code])} moedas de recompensa</small></div><button type="button" className="journey-secondary" disabled={Boolean(busy) || data.redemptionEnabled===false || progress.rewardCoins < data.redemption[item.code]} onClick={() => void redeem(item.code)}>{busy === item.code ? <LoaderCircle size={17} className="spin"/> : "Trocar"}</button></div>)}</div>
      <p className="journey-redemption-note"><ShieldCheck size={16} aria-hidden="true"/><span>Moedas compradas ficam fora desta troca. Seus itens aparecem no inventário após a confirmação.</span></p>
    </div>

    <div className="journey-ranks">
      <div className="journey-ranking-heading"><div className="journey-block-heading"><Trophy size={20} aria-hidden="true"/><div><h3>Criadores em movimento</h3><p>Conheça as jornadas da comunidade.</p></div></div><div className="journey-ranking-tabs" role="group" aria-label="Período do ranking"><button type="button" aria-pressed={rankingTab === "monthly"} onClick={() => setRankingTab("monthly")}>Este mês</button><button type="button" aria-pressed={rankingTab === "allTime"} onClick={() => setRankingTab("allTime")}>Desde o início</button></div></div>
      <Ranking entries={data.ranks[rankingTab]} label={rankingTab === "monthly" ? "Ranking de experiência do mês" : "Ranking de experiência desde o início"}/>
      <p className="journey-rank-note">Um reconhecimento pelo caminho percorrido. Cada pessoa pode seguir no seu próprio ritmo.</p>
    </div>
    {notice && <p className="journey-feedback is-success" role="status"><Check size={18} aria-hidden="true"/>{notice}</p>}
    {error && <p className="journey-feedback is-error" role="alert">{error}</p>}
  </section>;
}
