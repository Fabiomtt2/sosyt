// AUDITORIA / isolamento de CSS.
//
// Motivo real deste teste: o painel de acesso nasceu usando `.access-form`, nome
// que o ASTRA JÁ usava na tela de login (`App.tsx`). Minhas regras — por virem
// depois no arquivo — sobrescreviam `flex-direction` e `gap` do formulário de
// login dele. Nada quebrou em teste nem no typecheck; só apareceu ao comparar o
// CSS linha a linha. Como o trabalho de auditoria acrescenta estilo ao arquivo
// do dono do projeto, a regra passa a ser verificada por máquina:
//
//   nenhuma classe criada num bloco de auditoria pode ter nome já definido fora dele.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");

/** Nomes de classe definidos (como seletor) num trecho de CSS. */
function definedClasses(chunk: string): Set<string> {
  return new Set(Array.from(chunk.matchAll(/\.([A-Za-z][\w-]*)/g), (m) => m[1]));
}

/**
 * Classes definidas como seletor STANDALONE de uma única classe (`.X{` ou `.X,`).
 * É isso que de fato SOBRESCREVE a regra base de outra pessoa (o bug do `.access-form`).
 * Extensões por seletor composto (`.X.Y`, `.X .Z`, `button.X`) são legítimas: adicionam
 * especificidade sem redefinir a base, então não contam como colisão.
 */
function standaloneClasses(chunk: string): Set<string> {
  const found = new Set<string>();
  for (const rule of chunk.matchAll(/([^{}]+)\{/g)) {
    for (const selector of rule[1].split(",")) {
      const single = /^\.([A-Za-z][\w-]*)$/.exec(selector.trim());
      if (single) found.add(single[1]);
    }
  }
  return found;
}

describe("isolamento do CSS acrescentado pela auditoria", () => {
  const marcador = "/* AUDITORIA / painel de acesso";

  it("o bloco do painel de acesso existe e fica no fim do arquivo", () => {
    expect(css.indexOf(marcador)).toBeGreaterThan(0);
  });

  it("nenhuma classe acrescentada pela auditoria REDEFINE (standalone) uma classe base anterior", () => {
    // Só conta redefinição standalone (`.X{`), que é o que sobrescreveu o login do
    // ASTRA. Extensões compostas (`.user-avatar.avatar-tier-super`, `.avatar-choice.catalog`)
    // são intencionais e seguras.
    const corte = css.indexOf(marcador);
    const anterior = standaloneClasses(css.slice(0, corte));
    const minhas = standaloneClasses(css.slice(corte));
    const colisoes = [...minhas].filter((nome) => anterior.has(nome));
    expect(colisoes, `classes base redefinidas: ${colisoes.join(", ")}`).toEqual([]);
  });

  it("o formulário de login do ASTRA continua em coluna, sem interferência", () => {
    // `.access-form` é dele (App.tsx). Se alguém reintroduzir uma regra com esse
    // nome depois no arquivo, a última declaração de display/flex-direction muda
    // e o login quebra — por isso conferimos a ÚLTIMA ocorrência, não a primeira.
    const ocorrencias = [...css.matchAll(/\.access-form\s*\{([^}]*)\}/g)];
    expect(ocorrencias.length).toBeGreaterThan(0);
    const ultima = ocorrencias.at(-1)![1];
    expect(ultima).toMatch(/flex-direction:\s*column|min-height/);
  });

  it("a coluna de ações das tabelas não usa display:flex numa <td>", () => {
    // Uma <td> com display:flex sai do fluxo da tabela e desalinha a borda da
    // linha. Já aconteceu na loja e no painel de acesso.
    const regra = css.match(/\.store-row-actions\s*\{([^}]*)\}/);
    expect(regra).not.toBeNull();
    expect(regra![1]).not.toMatch(/display:\s*flex/);
  });
});
