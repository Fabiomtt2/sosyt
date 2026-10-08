import { CompanionPanel } from "./CompanionPanel";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Eye, Heart, MessageCircle, PauseCircle, ShieldCheck } from "lucide-react";
import { api, type Slot, type WatchProgressState, type WatchRewards } from "./api";
import { UserAvatarView } from "./AvatarModal";
import { useModalLifecycle } from "./useModalLifecycle";

type PlayerState = -1 | 0 | 1 | 2 | 3 | 5;

type YTPlayer = {
  destroy(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlaybackRate(): number;
  getPlayerState(): PlayerState;
  getPlaylistIndex(): number;
};

type YTNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      width: string | number;
      height: string | number;
      playerVars: Record<string, string | number>;
      events: {
        onReady?: () => void;
        onStateChange?: (event: { data: PlayerState }) => void;
      };
    }
  ) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

type SavedProgress = {
  watchedSeconds: number[];
  durations: number[];
};

let iframeApiPromise: Promise<YTNamespace> | undefined;
const watchSessionIds=new Map<string,string>();
function watchSessionIdFor(userId:string):string {
  const existing=watchSessionIds.get(userId);
  if(existing)return existing;
  const created=crypto.randomUUID();
  watchSessionIds.set(userId,created);
  return created;
}

function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (iframeApiPromise) return iframeApiPromise;
  iframeApiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return iframeApiPromise;
}

function readSaved(key: string): SavedProgress {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "{}") as Partial<SavedProgress>;
    return {
      watchedSeconds: Array.from({ length: 10 }, (_, index) => Math.max(0, Number(parsed.watchedSeconds?.[index] ?? 0))),
      durations: Array.from({ length: 10 }, (_, index) => Math.max(0, Number(parsed.durations?.[index] ?? 0)))
    };
  } catch {
    return { watchedSeconds: Array(10).fill(0), durations: Array(10).fill(0) };
  }
}

function mergeProgress(...sources: Array<Partial<SavedProgress> | undefined>): SavedProgress {
  const durations = Array.from({ length: 10 }, (_, index) => Math.max(...sources.map((source) => Number(source?.durations?.[index] ?? 0))));
  const watchedSeconds = Array.from({ length: 10 }, (_, index) => {
    const watched = Math.max(...sources.map((source) => Number(source?.watchedSeconds?.[index] ?? 0)));
    return durations[index] > 0 ? Math.min(durations[index], watched) : 0;
  });
  return { watchedSeconds, durations };
}

function progressPercent(progress: SavedProgress): number {
  return Math.min(
    100,
    Math.floor(
      progress.watchedSeconds.reduce((sum, watched, index) => {
        const duration = progress.durations[index];
        return sum + (duration > 0 ? Math.min(1, watched / duration) : 0);
      }, 0) * 10
    )
  );
}

export function readSavedWatchPercent(userId: string, roundId: string, playlistId: string): number {
  return progressPercent(readSaved(`conexao_watch_progress:${userId}:${roundId}:${playlistId}`));
}

export function WatchProgress({
  playlistId,
  roundId,
  userId,
  slots,
  initialProgress,
  initialBalance,
  initialWatchRewards,
  onClose,
  onFinalized,
  onAbandoned
}: {
  playlistId: string;
  roundId: string;
  userId: string;
  slots: Slot[];
  initialProgress?: WatchProgressState;
  initialBalance: number;
  initialWatchRewards: WatchRewards;
  onClose: () => void;
  onFinalized: (cooldownUntil: string) => void;
  onAbandoned: (result:{percent:number;nextOpenRound?:{id:string;sequence:number}}) => void;
}) {
  const storageKey = useMemo(() => `conexao_watch_progress:${userId}:${roundId}:${playlistId}`, [playlistId, roundId, userId]);
  const [progress, setProgress] = useState<SavedProgress>(() => mergeProgress(initialProgress));
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(false);
  const [currentIndex,setCurrentIndex]=useState(0);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "saved" | "offline">("idle");
  const [confirmedCoins, setConfirmedCoins] = useState(initialWatchRewards.coins);
  const [verifiedSeconds,setVerifiedSeconds]=useState(initialWatchRewards.verifiedSeconds);
  const [secondsToNextReward,setSecondsToNextReward]=useState(initialWatchRewards.secondsToNextReward);
  const [walletTotal, setWalletTotal] = useState(initialBalance);
  const [confirmFinish,setConfirmFinish]=useState(false);
  const [confirmAbandon,setConfirmAbandon]=useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [actionError,setActionError]=useState("");
  const playerHost = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | undefined>(undefined);
  const lastSample = useRef<{ wallMs: number; playerSeconds: number; index: number } | undefined>(undefined);
  const latestProgress = useRef(progress);
  const watchSessionId=useMemo(()=>watchSessionIdFor(userId),[userId]);
  const lastObservationSentAt=useRef(Number.NEGATIVE_INFINITY);
  const observationInFlight=useRef(false);
  const finalizedHandled = useRef(false);
  const modalRef=useModalLifecycle(()=>{
    if(confirmFinish){setConfirmFinish(false);return;}
    if(confirmAbandon){setConfirmAbandon(false);return;}
    close();
  },true,!finalizing);

  const percent = progressPercent(progress);
  const perVideoPercent=progress.watchedSeconds.map((watched,index)=>{
    const duration=progress.durations[index] ?? 0;
    return duration>0 ? Math.min(100,Math.floor((watched/duration)*100)) : 0;
  });
  const currentSlot=slots[currentIndex] ?? slots[0];
  const currentVideoPercent=perVideoPercent[currentIndex] ?? 0;
  const formatTime=(seconds:number)=>{
    const total=Math.max(0,Math.floor(seconds||0));
    const minutes=Math.floor(total/60),rest=total%60;
    return `${minutes}:${String(rest).padStart(2,"0")}`;
  };

  useEffect(() => {
    latestProgress.current = progress;
  }, [progress]);

  function playerMethodsReady(currentPlayer:YTPlayer|undefined):currentPlayer is YTPlayer {
    return Boolean(currentPlayer && ["getPlaylistIndex","getCurrentTime","getDuration","getPlaybackRate","getPlayerState"].every(key=>typeof (currentPlayer as unknown as Record<string,unknown>)[key]==="function"));
  }
  async function sendObservation(currentPlayer=playerRef.current) {
    if (!playerMethodsReady(currentPlayer) || observationInFlight.current) return;
    const videoIndex=currentPlayer.getPlaylistIndex();
    const playerSeconds=currentPlayer.getCurrentTime();
    const duration=currentPlayer.getDuration();
    const playbackRate=Math.max(0.25,Math.min(2,currentPlayer.getPlaybackRate() || 1));
    if(videoIndex<0||videoIndex>9||!Number.isFinite(playerSeconds)||!Number.isFinite(duration)||duration<=0)return;
    observationInFlight.current=true;
    setSyncState("syncing");
    try {
      const saved=await api.observeWatchProgress(roundId,{
        sessionId:watchSessionId,videoIndex,playerSeconds,duration,playbackRate,playing:currentPlayer.getPlayerState()===1,visible:document.visibilityState==="visible"
      });
      const merged=mergeProgress(saved);
      const mergedSignature=JSON.stringify(merged);
      localStorage.setItem(storageKey,mergedSignature);
      latestProgress.current=merged;
      setProgress(merged);
      setConfirmedCoins(saved.coins);
      setVerifiedSeconds(saved.verifiedSeconds);
      setSecondsToNextReward(saved.secondsToNextReward);
      if(typeof saved.walletTotal==="number")setWalletTotal(saved.walletTotal);
      if(saved.sessionConflict) {
        setActionError("Este acompanhamento já está ativo em outra aba ou dispositivo. Feche a outra sessão ou aguarde alguns segundos antes de continuar aqui.");
        setActive(false);
      } else {
        setActionError((current)=>current.startsWith("Este acompanhamento já está ativo") ? "" : current);
        setSyncState("saved");
      }
      if(saved.cooldownUntil&&!finalizedHandled.current) {
        finalizedHandled.current=true;
        onFinalized(saved.cooldownUntil);
      }
    } catch {
      setSyncState("offline");
    } finally {
      observationInFlight.current=false;
    }
  }

  function close() {
    const snapshot=latestProgress.current;
    localStorage.setItem(storageKey,JSON.stringify(snapshot));
    void sendObservation();
    onClose();
  }

  async function finishTask() {
    setFinalizing(true);setActionError("");
    try {
      await sendObservation();
      const result=await api.finalizeWatchProgress(roundId);
      finalizedHandled.current=true;
      onFinalized(result.cooldownUntil);
    } catch(cause) {
      setActionError(cause instanceof Error?cause.message:"Não foi possível concluir a tarefa agora.");
    } finally {
      setFinalizing(false);
    }
  }

  async function abandonTask() {
    setFinalizing(true);setActionError("");
    try {
      await sendObservation();
      const result=await api.abandonWatchProgress(roundId);
      finalizedHandled.current=true;
      localStorage.setItem(storageKey,JSON.stringify(latestProgress.current));
      onAbandoned({percent:result.percent,nextOpenRound:result.nextOpenRound});
    } catch(cause) {
      setActionError(cause instanceof Error?cause.message:"Não foi possível abandonar a tarefa agora.");
    } finally {
      setFinalizing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let interval: number | undefined;
    let player: YTPlayer | undefined;

    void loadYouTubeIframeApi().then((YT) => {
      if (cancelled || !playerHost.current) return;
      player = new YT.Player(playerHost.current, {
        width: "100%",
        height: "100%",
        playerVars: {
          listType: "playlist",
          list: playlistId,
          autoplay: 0,
          playsinline: 1,
          rel: 0
        },
        events: {
          onReady: () => setReady(true),
          onStateChange: ({ data }) => {
            setActive(data === 1 && document.visibilityState === "visible");
            if(data===1) lastObservationSentAt.current=Number.NEGATIVE_INFINITY;
            else lastSample.current=undefined;
            void sendObservation();
          }
        }
      });
      playerRef.current = player;

      interval = window.setInterval(() => {
        const currentPlayer = playerRef.current;
        if (!playerMethodsReady(currentPlayer) || currentPlayer.getPlayerState() !== 1 || document.visibilityState !== "visible") {
          lastSample.current = undefined;
          setActive(false);
          return;
        }

        setActive(true);
        const index = currentPlayer.getPlaylistIndex();
        if(index>=0&&index<=9) setCurrentIndex(index);
        const playerSeconds = currentPlayer.getCurrentTime();
        const duration = currentPlayer.getDuration();
        const wallMs = performance.now();

        if (index < 0 || index > 9 || !Number.isFinite(playerSeconds) || !Number.isFinite(duration) || duration <= 0) {
          lastSample.current = { wallMs, playerSeconds, index };
          return;
        }

        // Persisted observations are authoritative; local replay never increments coverage.
        if(wallMs-lastObservationSentAt.current>=5000&&!observationInFlight.current) {
          lastObservationSentAt.current=wallMs;
          void sendObservation(currentPlayer);
        }
      }, 1000);
    });

    const visibility = () => {
      if (document.visibilityState !== "visible") {
        lastSample.current = undefined;
        setActive(false);
        void sendObservation();
      } else {
        lastObservationSentAt.current=Number.NEGATIVE_INFINITY;
        void sendObservation();
      }
    };
    document.addEventListener("visibilitychange", visibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", visibility);
      if (interval) window.clearInterval(interval);
      player?.destroy();
      playerRef.current = undefined;
    };
  }, [playlistId, storageKey]);

  return (
    <div className="modal-backdrop watch-backdrop" onMouseDown={close}>
      <section ref={modalRef} className="modal watch-modal premium-watch-modal" role="dialog" aria-modal="true" aria-label="Acompanhar vídeos da fila" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close" aria-label="Fechar acompanhamento" onClick={close}>×</button>

        <div className="watch-welcome">
          <div>
            <p className="eyebrow dark">ACOMPANHAMENTO SEGURO</p>
            <h2>Estamos acompanhando seu progresso com carinho 💜</h2>
            <p>Assista no seu ritmo. Seu progresso fica ligado à sua conta e volta de onde parou quando você retorna.</p>
          </div>
          <span className="watch-safe-pill"><ShieldCheck size={18}/> Ambiente acolhedor</span>
        </div>
        <div className="watch-art-reference" aria-hidden="true"><img src="/assets/user/watch.webp" alt=""/><span>Visual da jornada · os controles abaixo são os que registram seu progresso de verdade.</span></div>

        {currentSlot && <div className="watch-current-creator">
          <UserAvatarView avatar={currentSlot.avatar} name={currentSlot.userName ?? "Participante"} className="watch-avatar"/>
          <div className="watch-creator-copy">
            <span>Você está apoiando</span>
            <strong>{currentSlot.userName ?? "um criador da comunidade"}</strong>
            {currentSlot.userChannelTitle && <small>Canal do participante: {currentSlot.userChannelTitle}</small>}
          </div>
          <div className="watch-kind-actions" aria-label="Sugestão de apoio">
            <span><Heart size={16}/> Se gostar, deixe um joinha</span>
            <span><MessageCircle size={16}/> Um comentário gentil também faz diferença</span>
          </div>
        </div>}

        {currentSlot && <div className="watch-video-context">
          {currentSlot.videoThumbnailUrl && <img src={currentSlot.videoThumbnailUrl} alt="" />}
          <div>
            <span>Vídeo {currentIndex+1} de 10</span>
            <strong>{currentSlot.videoTitle ?? "Vídeo compartilhado nesta fila"}</strong>
            <small>{currentSlot.videoChannelTitle ? <>Publicado por {currentSlot.videoChannelTitle}</> : "Publicado no YouTube"}</small>
          </div>
        </div>}

        <div className="watch-player-shell"><div ref={playerHost} className="watch-player" /></div>

        <div className="watch-current-progress" role="status">
          <div className="watch-current-progress-head">
            <div><span>Progresso deste vídeo</span><strong>{currentVideoPercent}%</strong></div>
            <small>{formatTime(progress.watchedSeconds[currentIndex] ?? 0)} / {progress.durations[currentIndex] ? formatTime(progress.durations[currentIndex]) : "—"}</small>
          </div>
          <progress max={100} value={currentVideoPercent}/>
          <span className={active ? "watch-live active":"watch-live"}>{active ? <><Eye size={14}/> Acompanhamento em andamento</> : ready ? <><PauseCircle size={14}/> Pausado — retome quando quiser</> : "Preparando o player…"}</span>
        </div>

        <div className="watch-journey">
          <div className="watch-journey-head"><div><span>Seu progresso nesta fila</span><strong>{percent}% concluído</strong></div><small>10 vídeos</small></div>
          <div className="watch-video-grid">
            {slots.slice(0,10).map((slot,index)=><div key={slot.slot} className={"watch-video-step "+(index===currentIndex?"current":"")+(perVideoPercent[index]>=100?" complete":"")}>
              <div><span>{index+1}</span>{slot.avatar ? <UserAvatarView avatar={slot.avatar} name={slot.userName ?? "Participante"} className="watch-step-avatar"/> : null}</div>
              <progress max={100} value={perVideoPercent[index] ?? 0}/>
              <small>{perVideoPercent[index] ?? 0}%</small>
            </div>)}
          </div>
        </div>

        <div className="watch-sync-card">
          <Check size={17}/>
          <div>
            <strong>{syncState==="syncing" ? "Salvando seu progresso…" : syncState==="offline" ? "Guardado neste aparelho; vamos tentar sincronizar novamente" : "Seu progresso está salvo na sua conta"}</strong>
            <span>{formatTime(verifiedSeconds)} de tempo verificado acumulado · {confirmedCoins} moeda(s) por tempo · próxima em {formatTime(secondsToNextReward)} · saldo atual: {walletTotal}</span>
          </div>
        </div>

        {finalizedHandled.current && <div className="notice"><Check size={18}/><span>Você completou os dez vídeos desta fila. Suas recompensas foram preservadas e o intervalo de 30 minutos começará automaticamente.</span></div>}

        <CompanionPanel/>

        <details className="watch-how">
          <summary>Como o acompanhamento funciona?</summary>
          <p>O SOS considera a reprodução natural no player oficial enquanto esta aba está visível. O servidor limita cada atualização pelo próprio relógio: saltos na linha do tempo, trechos repetidos e duas sessões simultâneas não viram tempo novo.</p>
          <p>A cada 20 minutos de tempo real verificado, acumulados entre sessões e filas, 1 moeda interna é registrada uma única vez. O percentual da fila mostra seu progresso, mas não determina a recompensa.</p>
          <p><strong>Concluir</strong> preserva o percentual atual e inicia o intervalo de 30 minutos. <strong>Abandonar</strong> preserva os mesmos registros, mas libera imediatamente a Fila aberta atual.</p>
        </details>

        {actionError && <p className="error banner" role="alert">{actionError}</p>}

        {!confirmFinish && !confirmAbandon && <div className="watch-exit-actions">
          <button className="secondary watch-finish-button" disabled={finalizing} onClick={() => setConfirmFinish(true)}>Concluir por aqui</button>
          <button className="text-danger-button abandon-task-button" disabled={finalizing} onClick={() => setConfirmAbandon(true)}>Abandonar tarefa</button>
        </div>}

        {confirmFinish && <div className="completion-warning" role="alert">
          <strong>Concluir esta tarefa em {percent}%?</strong>
          <p>Seu progresso e todas as recompensas por tempo já registradas na carteira continuam salvos. Depois disso começa um intervalo de 30 minutos antes de uma nova entrada.</p>
          <div className="ready-actions"><button className="secondary" disabled={finalizing} onClick={() => setConfirmFinish(false)}>Continuar assistindo</button><button className="primary" disabled={finalizing} onClick={() => void finishTask()}>{finalizing ? "Concluindo…" : "Sim, concluir por aqui"}</button></div>
        </div>}

        {confirmAbandon && <div className="completion-warning abandon-warning" role="alert">
          <strong>Abandonar esta tarefa em {percent}%?</strong>
          <p>Seu progresso, sua playlist e as recompensas por tempo já registradas continuam salvos. A tarefa deixa de bloquear sua conta e você volta para a Fila aberta mais recente sem cooldown; as regras normais de moedas e passes continuam valendo.</p>
          <div className="ready-actions"><button className="secondary" disabled={finalizing} onClick={() => setConfirmAbandon(false)}>Continuar assistindo</button><button className="danger-button" disabled={finalizing} onClick={() => void abandonTask()}>{finalizing ? "Salvando e saindo…" : "Sim, abandonar tarefa"}</button></div>
        </div>}
      </section>
    </div>
  );
}
