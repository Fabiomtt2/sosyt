// AUDITORIA / MEDIR QUEM ESTA SENDO BARRADO PELO GOOGLE.
//
// O dono relatou: "outras pessoas não conseguem criar playlist". Ele nao tinha como
// saber QUANTAS, QUEM nem POR QUE — cada caso chegava por relato solto no WhatsApp, e
// diagnostico por relato e adivinhacao. Enquanto a tela de permissao do Google estiver
// em modo Teste, todo e-mail fora da lista de testadores recebe access_denied: o
// participante ve um bloqueio e nos nao viamos nada.
//
// Guardamos o minimo para agir: quando, quem (id interno) e o motivo do Google. O
// e-mail do Google NAO passa por aqui — ele nem chega ao nosso servidor nessa recusa,
// porque o bloqueio acontece antes, na tela do proprio Google.
import type { AppDatabase } from "./db.js";

export function ensureYouTubeDenials(db: AppDatabase) {
  db.exec(`CREATE TABLE IF NOT EXISTS youtube_authorization_denials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_yt_denials_at ON youtube_authorization_denials(created_at);");
}

export function recordYouTubeDenial(db: AppDatabase, userId: string | undefined, reason: string) {
  ensureYouTubeDenials(db);
  db.prepare("INSERT INTO youtube_authorization_denials (user_id,reason,created_at) VALUES (?,?,?)")
    .run(userId ?? null, String(reason).slice(0, 60), new Date().toISOString());
}

/** Quadro para o Diagnostico: quantas recusas, de quantas pessoas, e o ultimo motivo. */
export function youTubeDenialSummary(db: AppDatabase) {
  ensureYouTubeDenials(db);
  const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const total = (db.prepare("SELECT COUNT(*) AS n FROM youtube_authorization_denials WHERE created_at>=?").get(desde) as { n: number }).n;
  const pessoas = (db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM youtube_authorization_denials WHERE created_at>=? AND user_id IS NOT NULL").get(desde) as { n: number }).n;
  const ultima = db.prepare("SELECT reason,created_at AS at FROM youtube_authorization_denials ORDER BY id DESC LIMIT 1").get() as { reason: string; at: string } | undefined;
  return {
    recusasNaSemana: total, pessoasAfetadas: pessoas,
    ultimoMotivo: ultima?.reason ?? null, ultimaEm: ultima?.at ?? null,
    // access_denied com o app em Teste tem causa unica e conhecida: e-mail fora da
    // lista de testadores. Dizer isso aqui economiza a caca ao bug.
    causaProvavel: ultima?.reason === "access_denied"
      ? "A tela de permissão do Google está em modo Teste: só e-mails na lista de testadores conseguem autorizar. Publique o app ou adicione a pessoa como testador."
      : null,
  };
}
