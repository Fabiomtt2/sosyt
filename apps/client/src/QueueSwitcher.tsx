import { useRef,useState } from "react";
import { Layers, Plus, Lock, LoaderCircle } from "lucide-react";
import { api, type QueuesState } from "./api";

/**
 * AUDITORIA / multi-fila: mostra em QUAIS filas o participante está e permite
 * transitar entre elas. Só aparece quando ele tem mais de uma — quem está em uma
 * fila só não vê seletor nenhum (e não fica sabendo que existem outras filas).
 * O botão "Pular" usa um item do inventário; se não houver fila livre, o servidor
 * cria uma — o item nunca é desperdiçado.
 */
export function QueueSwitcher({ queues, onSelect, onChanged, onNeedSkip }: {
  queues: QueuesState;
  onSelect: (roundId: string) => void;
  onChanged: () => void;
  onNeedSkip?: () => void;
}) {
  const skipReference=useRef<string|undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mine = queues.mine;
  const currentId = queues.current?.id;
  const canSkip = queues.skipsAvailable > 0;

  // Uma fila só e sem Pular disponível: nada a mostrar, nada a revelar.
  if (mine.length <= 1 && !canSkip) return null;

  async function useSkip() {
    setBusy(true); setError("");
    try {
      skipReference.current??=crypto.randomUUID();
      const result = await api.queueSkip(skipReference.current);
      skipReference.current=undefined;
      onSelect(result.queue.id);
      onChanged();
    } catch (cause) {
      const e = cause as { message?: string; code?: string };
      if (e.code === "SKIP_REQUIRED") onNeedSkip?.();
      setError(e.message ?? "Não foi possível entrar em outra fila.");
    } finally { setBusy(false); }
  }

  return (
    <section className="queue-switcher" aria-label="Minhas filas">
      <div className="qs-head">
        <Layers size={16} />
        <strong>{mine.length > 1 ? "Você está em " + mine.length + " filas" : "Sua fila"}</strong>
      </div>

      <div className="qs-tabs" role="tablist">
        {mine.map((q) => (
          <button
            key={q.id}
            role="tab"
            type="button"
            aria-selected={q.id === currentId}
            className={"qs-tab" + (q.id === currentId ? " active" : "")}
            onClick={() => onSelect(q.id)}
          >
            <b>Fila {q.number}</b>
            <small>{q.status === "OPEN" ? (q.vacancies > 0 ? q.vacancies + (q.vacancies === 1 ? " vaga" : " vagas") : "completa") : "em acompanhamento"}</small>
          </button>
        ))}
      </div>

      <div className="qs-actions">
        {canSkip ? (
          <button type="button" className="qs-skip" onClick={() => void useSkip()} disabled={busy}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}
            Entrar em outra fila
            <span className="qs-skip-count">{queues.skipsAvailable===Number.MAX_SAFE_INTEGER?"∞":queues.skipsAvailable} Pular</span>
          </button>
        ) : (
          <p className="qs-locked"><Lock size={14} /> Conclua 100% da sua fila para avançar — ou use um <b>Pular</b> da loja para participar de outra ao mesmo tempo.</p>
        )}
      </div>
      {error && <p className="qs-error" role="alert">{error}</p>}
    </section>
  );
}
