// AUDITORIA / blindagem — trilhas financeiras e de auditoria viram append-only DE VERDADE.
//
// O red team (Owner Sombra) apontou o calcanhar: só `gamification_events` tinha trigger
// de imutabilidade. `wallet_ledger`, `super_events`, `item_grants` e os `*_audit` eram
// append-only apenas POR CONVENÇÃO DE CÓDIGO — quem opera o arquivo SQLite no servidor
// podia dar UPDATE/DELETE e reescrever ou apagar a "prova" (inclusive o `actor_owner_name`
// que supostamente mantém um ajuste de carteira honesto). Toda a narrativa de "deixa
// rastro no ledger" caía por terra.
//
// Confirmado por varredura: NENHUM caminho do código atualiza ou apaga essas tabelas
// (são exclusivamente INSERT). Logo, travá-las por gatilho não quebra funcionalidade —
// só fecha a porta de adulteração. Mesmo padrão que `gamification_events` já usa.
import type { AppDatabase } from "./db.js";

/** Tabelas que, por design, só crescem — nunca mudam nem somem. */
export const APPEND_ONLY_TABLES = [
  "wallet_ledger",             // razão da carteira (moedas)
  "super_events",             // concessões/revogações de SUPER
  "item_grants",              // concessões de itens (Pular/Passe)
  "gamification_config_audit", // quem mudou a config da gamificação
  "bot_automation_audit",     // quem mudou as falas do bot
] as const;

/**
 * Instala gatilhos que abortam qualquer UPDATE/DELETE nas trilhas append-only.
 * Idempotente. Pula tabela que ainda não existe (algumas nascem sob demanda) — o
 * gatilho é recriado numa inicialização futura, quando a tabela já estiver lá.
 */
export function ensureLedgerIntegrity(db: AppDatabase): { protected: string[] } {
  const done: string[] = [];
  for (const table of APPEND_ONLY_TABLES) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!exists) continue;
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table}
      BEGIN SELECT RAISE(ABORT,'append-only: ${table} nao pode ser alterado'); END;`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table}
      BEGIN SELECT RAISE(ABORT,'append-only: ${table} nao pode ser apagado'); END;`);
    done.push(table);
  }
  return { protected: done };
}
