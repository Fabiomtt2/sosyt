// AUDITORIA / O PAINEL MOSTRAVA CONFIGURACAO, NAO REALIDADE.
//
// Frase do dono: "Se não consigo ver o que está tudo ativo, não tenho como observar
// bugs." Era verdade — e custou caro: passamos horas discutindo se a gamificacao
// estava ligada, se a IA respondia, por que havia filas sobrando. Nada disso era
// visivel em lugar nenhum, nem para ele nem para mim.
//
// Esta secao responde de uma vez, em portugues, e em dois casos faz mais que
// informar: aponta a causa provavel ("a Jornada some quando isto esta desligado") e
// deixa encerrar fila vazia, que antes so sumia sozinha depois de 72h.
import { useCallback, useEffect, useState } from "react";
import { ownerApi, type OwnerDiagnostics } from "./api";

const Luz = ({ on, children }: { on: boolean; children: React.ReactNode }) => (
  <li className={on ? "diag-on" : "diag-off"}><b aria-hidden="true">{on ? "●" : "○"}</b>
    <span>{children}</span><em>{on ? "ligado" : "desligado"}</em></li>
);

export function OwnerDiagnosticsPanel() {
  const [data, setData] = useState<OwnerDiagnostics>();
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    try { setData(await ownerApi.diagnostics()); setErro(""); }
    catch (cause) { setErro(cause instanceof Error ? cause.message : "Não foi possível ler o diagnóstico."); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const fechar = async (id: string, numero: number) => {
    setBusy(true);
    try { await ownerApi.closeRound(id); await carregar(); setErro(`Fila ${numero} encerrada.`); }
    catch (cause) { setErro(cause instanceof Error ? cause.message : "Não foi possível encerrar a fila."); }
    finally { setBusy(false); }
  };

  if (erro && !data) return <section className="card"><h2>Diagnóstico</h2><p className="error" role="alert">{erro}</p></section>;
  if (!data) return <section className="card"><h2>Diagnóstico</h2><p className="muted">Lendo o estado do sistema…</p></section>;

  return (
    <section className="card owner-diagnostics">
      <h2>Diagnóstico do sistema</h2>
      <p className="muted">O que está ativo agora, nesta versão <code>{data.release}</code>.</p>
      {erro && <p className="notice" role="status">{erro}</p>}

      <h3>Gamificação</h3>
      <ul className="diag-list">
        <Luz on={data.gamificacao.ativa}>Gamificação (XP, níveis, ranking, booster)</Luz>
        <Luz on={data.gamificacao.boosterSexta}>Presente de sexta</Luz>
        <Luz on={data.gamificacao.rankingMensal}>Ranking mensal</Luz>
        <Luz on={data.gamificacao.trocas}>Trocas por moedas</Luz>
      </ul>
      {!data.gamificacao.ativa && <p className="notice">É isto que faz a <strong>Jornada</strong> sumir da tela do participante — com a gamificação desligada, o botão de ranking, níveis e booster não aparece para ninguém.</p>}

      <h3>Inteligência artificial do bot</h3>
      <ul className="diag-list">
        <Luz on={data.ia.ativa}>IA de interpretação</Luz>
        <Luz on={data.ia.chaveConfigurada}>Chave do provedor</Luz>
      </ul>
      <p className="muted">Modelo: <code>{data.ia.modelo ?? "—"}</code> · teto diário {data.ia.tetoDiario}.</p>
      <p className="muted">Hoje: <strong>{data.ia.hoje.calls}</strong> consulta(s) — <strong>{data.ia.hoje.hits}</strong> entendida(s), {data.ia.hoje.nenhuma} em que a IA disse que não sabia, {data.ia.hoje.failures} com falha técnica.</p>
      {data.ia.hoje.nenhuma > 0 && data.ia.hoje.failures === 0 && <p className="notice">Dizer <em>&quot;não sei&quot;</em> é a IA funcionando: ela recusa em vez de inventar. Só o número de <strong>falha técnica</strong> indica defeito.</p>}
      {data.ia.hoje.failures > 0 && <p className="error">Última falha técnica: <code>{data.ia.hoje.lastReason ?? "motivo não registrado"}</code></p>}
      <p className="muted">{data.ia.observacao}</p>

      <h3>Bot</h3>
      <p className="muted">Modo <code>{data.bot.modo}</code> · motor {data.bot.motorPronto ? "pronto" : "não configurado"}.</p>
      <ul className="diag-list">{data.bot.funcoes.map((f) => <Luz key={f.codigo} on={f.ligada}>{f.codigo}</Luz>)}</ul>

      <h3>YouTube e criação de playlist</h3>
      <ul className="diag-list">
        <Luz on={data.youtube.clienteOAuth}>Cliente OAuth do Google (criar playlist)</Luz>
        <Luz on={data.youtube.chaveDeLeitura}>Chave de leitura do YouTube</Luz>
      </ul>
      <p className={data.youtube.podeCriarPlaylist ? "muted" : "error"}>{data.youtube.consequencia}</p>

      <h3>Filas ativas ({data.filas.total}{data.filas.vazias > 0 ? `, ${data.filas.vazias} vazia(s)` : ""})</h3>
      <ul className="diag-queues">
        {data.filas.lista.map((f) => (
          <li key={f.id}>
            <span><strong>Fila {f.numero}</strong> · {f.videos} vídeo(s) · {f.participantes} participante(s) · {f.vagas} vaga(s) · expira em {f.expiraEmHoras}h</span>
            {f.vazia
              ? <button type="button" className="secondary compact" disabled={busy} onClick={() => void fechar(f.id, f.numero)}>Encerrar fila vazia</button>
              : <em className="muted">em uso</em>}
          </li>
        ))}
      </ul>

      <h3>Entradas em grupo</h3>
      <p className="muted">{Object.entries(data.entradaEmGrupo).map(([estado, n]) => `${estado}: ${n}`).join(" · ") || "nenhuma pendência"}</p>

      <button type="button" className="secondary" disabled={busy} onClick={() => void carregar()}>Atualizar diagnóstico</button>
    </section>
  );
}
