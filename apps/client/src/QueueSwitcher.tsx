import { useRef, useState } from "react";
import { Layers, Plus, LoaderCircle, LogOut, Ticket } from "lucide-react";
import { api, type MyQueue, type QueuesState } from "./api";

/** Active memberships remain selectable when another queue is opened or completed. */
export function QueueSwitcher({ queues, onSelect, onChanged, onNeedSkip, onNeedPass, onLeft, administrative = false, onBrowse }: {
  queues: QueuesState;
  onSelect: (roundId: string) => void;
  onChanged: () => void | Promise<void>;
  onNeedSkip?: () => void;
  onNeedPass?: () => void;
  onLeft?: (roundId: string) => void;
  administrative?: boolean;
  onBrowse?: (mode:"VIEW"|"PASS"|"SKIP")=>void;
}) {
  const references = useRef<Partial<Record<"PASS" | "SKIP", string>>>({});
  const [busy, setBusy] = useState<"PASS" | "SKIP" | "LEAVE" | null>(null);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState<MyQueue | null>(null);
  const mine = queues.mine;
  const currentId = queues.current?.id;
  const current = mine.find(queue => queue.id === currentId);
  const canSkip = !administrative && queues.skipsAvailable > 0;
  const canPass = !administrative && queues.passesAvailable > 0;

  if (!mine.length && !queues.available?.length && !canSkip && !canPass && !administrative && !onBrowse) return null;

  async function enterWith(item: "PASS" | "SKIP") {
    if (busy) return;
    setBusy(item);
    setError("");
    try {
      const reference = references.current[item] ??= crypto.randomUUID();
      const result = item === "PASS" ? await api.queuePass(reference) : await api.queueSkip(reference);
      onSelect(result.queue.id);
      await onChanged();
      delete references.current[item];
    } catch (cause) {
      const failure = cause as {message?: string; data?: {code?: string}};
      if (failure.data?.code === "SKIP_REQUIRED") onNeedSkip?.();
      if (failure.data?.code === "PASS_REQUIRED") onNeedPass?.();
      setError(failure.message ?? "Não foi possível abrir outra fila. Tente novamente; a mesma solicitação será reutilizada.");
    } finally {
      setBusy(null);
    }
  }

  async function resumeQueue(id:string){
    if(busy)return;setBusy("LEAVE");setError("");
    try{await api.queueResume(id);onSelect(id);await onChanged();}catch(cause){setError((cause as Error).message);}finally{setBusy(null);}
  }
  async function leaveQueue() {
    if (!leaving || busy) return;
    const target = leaving;
    setBusy("LEAVE");
    setError("");
    try {
      await api.queueLeave(target.id);
      setLeaving(null);
      onLeft?.(target.id);
      await onChanged();
    } catch (cause) {
      setError((cause as Error).message ?? "Não foi possível sair desta fila. Tente novamente.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="queue-switcher" aria-label="Minhas filas">
      <div className="qs-head">
        <Layers size={16} />
        <strong>{administrative ? "Filas em acompanhamento administrativo" : mine.length > 1 ? `Você está em ${mine.length} filas` : "Suas filas"}</strong>
        {onBrowse&&<button type="button" className="text-button qs-browse" disabled={!!busy} onClick={()=>onBrowse("VIEW")}>Explorar todas as filas</button>}
      </div>
      <div className="qs-tabs" role="tablist" aria-label="Escolha uma fila">
        {mine.map(queue => (
          <button key={queue.id} role="tab" type="button" aria-selected={queue.id === currentId}
            className={"qs-tab" + (queue.id === currentId ? " active" : "")}
            onClick={() => onSelect(queue.id)}
            onKeyDown={event => {
              const index = mine.findIndex(item => item.id === queue.id);
              const next = event.key === "ArrowRight" ? (index + 1) % mine.length
                : event.key === "ArrowLeft" ? (index + mine.length - 1) % mine.length
                : event.key === "Home" ? 0 : event.key === "End" ? mine.length - 1 : -1;
              if (next < 0) return;
              event.preventDefault();
              onSelect(mine[next].id);
              (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus();
            }}>
            <b>Fila {queue.number}</b>
            <small>{queue.status === "OPEN" ? queue.vacancies > 0 ? `${queue.vacancies} ${queue.vacancies === 1 ? "vaga" : "vagas"}` : "completa" : "em acompanhamento"}</small>
          </button>
        ))}
      </div>
      {!onBrowse&&Boolean(queues.available?.length) && <div className="qs-directory" aria-label="Todas as filas disponíveis">
        <strong>Filas da comunidade</strong>
        {queues.available?.map(queue=><p key={queue.id}>Fila {queue.number} · {10-queue.vacancies}/10 vídeos · {queue.joined?"seu acesso liberado":queue.status==="READY"?"completa":"visualização livre · use Pular para participar"}{queue.canResume&&<button type="button" className="text-button" disabled={!!busy} onClick={()=>void resumeQueue(queue.id)}>Retomar minha Fila {queue.number}</button>}</p>)}
      </div>}
      <div className="qs-actions">
        {administrative && <>
          <button type="button" className="qs-skip" onClick={() => onBrowse?onBrowse("SKIP"):void enterWith("SKIP")} disabled={!!busy}>
            {busy === "SKIP" ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}
            Abrir outra fila como administrador
          </button>
          <p className="qs-locked">Acesso administrativo, fora de competição. Esta ação não consome itens.</p>
        </>}
        {canPass && <button type="button" className="qs-skip" onClick={() => onBrowse?onBrowse("PASS"):void enterWith("PASS")} disabled={!!busy}>
          {busy === "PASS" ? <LoaderCircle size={15} className="spin" /> : <Ticket size={15} />}
          Usar 1 Passe <span className="qs-skip-count">{queues.passesAvailable} disponíveis</span>
        </button>}
        {canSkip && <button type="button" className="qs-skip" onClick={() => onBrowse?onBrowse("SKIP"):void enterWith("SKIP")} disabled={!!busy}>
          {busy === "SKIP" ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}
          Usar 1 Pular <span className="qs-skip-count">{queues.skipsAvailable} disponíveis</span>
        </button>}
        {!administrative && <p className="qs-locked">Pular abre acesso a outra fila sem encerrar as suas filas atuais. Concluir uma tarefa mantém as outras filas já liberadas disponíveis.</p>}
        {!administrative && queues.cooldownUntil && <p className="qs-locked">O intervalo indicado protege um novo ingresso gratuito. Após abandono voluntário, são 60 minutos. Você pode continuar nas filas já liberadas ou usar Pular.</p>}
        {current && <button type="button" className="secondary" disabled={!!busy} onClick={() => { setError(""); setLeaving(current); }}>
          <LogOut size={15} /> Sair da Fila {current.number}
        </button>}
      </div>
      {leaving && <div role="alertdialog" aria-modal="false" aria-labelledby="queue-leave-title" aria-describedby="queue-leave-description">
        <strong id="queue-leave-title">Sair da Fila {leaving.number}?</strong>
        <p id="queue-leave-description">{administrative ? "Seus links, histórico e progresso serão preservados. Sair encerra sua participação nesta fila; você mantém o acesso administrativo às outras filas, sem consumo de itens e fora de competição." : "Seus links, histórico e progresso serão preservados. Sair encerra o acesso atual e não devolve moedas, Passe ou Pular. Abandonar aplica 60 minutos de intervalo para novo ingresso gratuito. Pular permite outro acesso e suas demais filas liberadas continuam disponíveis; o mesmo progresso não gera recompensa duplicada."}</p>
        <button type="button" className="secondary" autoFocus disabled={!!busy} onClick={() => setLeaving(null)}>Continuar nesta fila</button>
        <button type="button" disabled={!!busy} onClick={() => void leaveQueue()}>{busy === "LEAVE" ? "Saindo…" : "Confirmar saída"}</button>
      </div>}
      {error && <p className="qs-error" role="alert">{error}</p>}
    </section>
  );
}
