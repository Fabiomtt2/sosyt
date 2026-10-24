// AUDITORIA / ACHADO 4 DO ASTRA — e ele estava certo: eu entreguei pela metade.
//
// O Fábio pediu "um botão de like e deslike nas filas para os vídeos, interferindo
// apenas no próprio sistema", e poder ver quem reagiu. Eu construí as rotas, os testes
// e as regras — e nenhuma tela. Endpoint sem botão não é funcionalidade entregue.
//
// Nada daqui sai para o YouTube: o projeto promete "sem views automáticas, sem
// reprodução oculta", e mandar reação para fora quebraria essa promessa.
//
// A autoria é aberta de propósito (pedido do dono). Em comunidade pequena, reação
// anônima vira ferramenta de sabotagem; assumir o que se curte mantém o ambiente
// responsável. Por isso os nomes aparecem ao tocar na contagem.
import { useCallback, useEffect, useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { api, type SubmissionReactions as Resumo } from "./api";

export function SubmissionReactions({ submissionId, authorId, viewerId }: { submissionId: string; authorId?: string; viewerId: string }) {
  const [resumo, setResumo] = useState<Resumo>();
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);
  const [mostrarQuem, setMostrarQuem] = useState(false);
  const proprio = authorId === viewerId;

  const carregar = useCallback(async () => {
    try { setResumo(await api.reactions(submissionId)); } catch { /* a fila funciona mesmo sem as reações */ }
  }, [submissionId]);
  useEffect(() => { void carregar(); }, [carregar]);

  const reagir = async (kind: "LIKE" | "DISLIKE") => {
    if (proprio || busy) return;
    setBusy(true); setErro("");
    try { setResumo(await api.react(submissionId, kind)); }
    catch (cause) { setErro(cause instanceof Error ? cause.message : "Não foi possível registrar sua reação."); }
    finally { setBusy(false); }
  };

  if (!resumo) return null;
  const minha = resumo.minhaReacao ?? null;
  const total = resumo.likes + resumo.dislikes;

  return (
    <div className="submission-reactions">
      <button type="button" className={"reaction" + (minha === "LIKE" ? " on" : "")} disabled={proprio || busy}
        aria-pressed={minha === "LIKE"} aria-label={`Gostei · ${resumo.likes}`}
        title={proprio ? "Você não reage ao próprio vídeo" : "Gostei"}
        onClick={() => void reagir("LIKE")}>
        <ThumbsUp size={15} aria-hidden="true"/><span>{resumo.likes}</span>
      </button>
      <button type="button" className={"reaction" + (minha === "DISLIKE" ? " on" : "")} disabled={proprio || busy}
        aria-pressed={minha === "DISLIKE"} aria-label={`Não gostei · ${resumo.dislikes}`}
        title={proprio ? "Você não reage ao próprio vídeo" : "Não gostei"}
        onClick={() => void reagir("DISLIKE")}>
        <ThumbsDown size={15} aria-hidden="true"/><span>{resumo.dislikes}</span>
      </button>

      {total > 0 && (
        <button type="button" className="text-button compact" aria-expanded={mostrarQuem}
          onClick={() => setMostrarQuem(valor => !valor)}>
          {mostrarQuem ? "ocultar quem reagiu" : "quem reagiu"}
        </button>
      )}
      {mostrarQuem && total > 0 && (
        <dl className="reaction-authors">
          {resumo.quemGostou.length > 0 && <><dt>Gostaram</dt><dd>{resumo.quemGostou.map(p => p.name).join(", ")}</dd></>}
          {resumo.quemNaoGostou.length > 0 && <><dt>Não gostaram</dt><dd>{resumo.quemNaoGostou.map(p => p.name).join(", ")}</dd></>}
        </dl>
      )}
      {proprio && <small className="muted">seu vídeo</small>}
      {erro && <small className="error" role="alert">{erro}</small>}
    </div>
  );
}
