import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Eye, PauseCircle } from "lucide-react";

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

function progressPercent(progress: SavedProgress): number {
  return Math.min(
    100,
    Math.round(
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
  onClose
}: {
  playlistId: string;
  roundId: string;
  userId: string;
  onClose: () => void;
}) {
  const storageKey = useMemo(() => `conexao_watch_progress:${userId}:${roundId}:${playlistId}`, [playlistId, roundId, userId]);
  const [progress, setProgress] = useState<SavedProgress>(() => readSaved(storageKey));
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(false);
  const playerHost = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | undefined>(undefined);
  const lastSample = useRef<{ wallMs: number; playerSeconds: number; index: number } | undefined>(undefined);

  const percent = progressPercent(progress);

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
            if (data !== 1) lastSample.current = undefined;
          }
        }
      });
      playerRef.current = player;

      interval = window.setInterval(() => {
        const currentPlayer = playerRef.current;
        if (!currentPlayer || currentPlayer.getPlayerState() !== 1 || document.visibilityState !== "visible") {
          lastSample.current = undefined;
          setActive(false);
          return;
        }

        setActive(true);
        const index = currentPlayer.getPlaylistIndex();
        const playerSeconds = currentPlayer.getCurrentTime();
        const duration = currentPlayer.getDuration();
        const wallMs = performance.now();

        if (index < 0 || index > 9 || !Number.isFinite(playerSeconds) || !Number.isFinite(duration) || duration <= 0) {
          lastSample.current = { wallMs, playerSeconds, index };
          return;
        }

        const previous = lastSample.current;
        lastSample.current = { wallMs, playerSeconds, index };

        setProgress((current) => {
          const next: SavedProgress = {
            watchedSeconds: [...current.watchedSeconds],
            durations: [...current.durations]
          };
          next.durations[index] = Math.max(next.durations[index] ?? 0, duration);

          if (previous && previous.index === index) {
            const wallDelta = Math.max(0, (wallMs - previous.wallMs) / 1000);
            const videoDelta = playerSeconds - previous.playerSeconds;
            const playbackRate = Math.max(0.25, currentPlayer.getPlaybackRate() || 1);
            const allowedAdvance = wallDelta * playbackRate + 2;

            // Count only natural forward playback. Seeking/jumping forward is deliberately ignored.
            if (videoDelta >= 0 && videoDelta <= allowedAdvance) {
              next.watchedSeconds[index] = Math.min(duration, next.watchedSeconds[index] + videoDelta);
            }
          }

          localStorage.setItem(storageKey, JSON.stringify(next));
          return next;
        });
      }, 1000);
    });

    const visibility = () => {
      if (document.visibilityState !== "visible") {
        lastSample.current = undefined;
        setActive(false);
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
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal watch-modal" role="dialog" aria-modal="true" aria-label="Acompanhar reprodução" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close" aria-label="Fechar acompanhamento" onClick={onClose}>×</button>
        <p className="eyebrow dark">ACOMPANHAMENTO LOCAL</p>
        <h2>Progresso da playlist</h2>
        <p className="muted">
          O progresso avança somente enquanto o player oficial está reproduzindo e esta aba permanece visível.
          Saltos grandes na timeline não contam como tempo reproduzido.
        </p>
        <div className="watch-player-shell"><div ref={playerHost} className="watch-player" /></div>
        <div className="watch-progress-card" role="status">
          <div><strong>{percent}% concluído</strong><span>{active ? " reprodução ativa" : ready ? " pausado ou fora de foco" : " carregando player"}</span></div>
          <progress max={100} value={percent} />
          <small>{active ? <><Eye size={14} /> Verificação ativa</> : <><PauseCircle size={14} /> Verificação interrompida</>}</small>
        </div>
        {percent >= 100 && <div className="notice"><Check size={18} /><span>Os dez vídeos atingiram 100% de reprodução verificada neste navegador.</span></div>}
        <p className="muted">
          Este indicador é informativo e não altera o saldo de créditos. Fechar este popup interrompe a verificação e preserva o progresso já registrado neste dispositivo.
        </p>
      </section>
    </div>
  );
}
