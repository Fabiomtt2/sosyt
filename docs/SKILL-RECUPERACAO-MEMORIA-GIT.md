# SKILL — Recuperação de memória por Git

Data-base: 05/10/2026.

## Quando esta skill é obrigatória

Acionar ANTES de editar quando o usuário disser ou implicar qualquer uma destas situações:
- “isso já foi corrigido/feito/validado”;
- “você se perdeu”;
- “continue exatamente de onde parou”;
- “confira os commits / o ASTRA / o Claude / o Sol”;
- “não reinvente”;
- houver contradição entre a memória da instância e o comportamento atual do projeto.

A regra central é: **Git, testes e handoffs são a memória operacional primária. A lembrança do agente é apenas hipótese até ser confirmada.**

## Protocolo de recuperação — nenhuma edição antes do passo 7

### 1. Congelar mudanças
Não editar, não formatar, não refatorar, não “melhorar” e não criar nova regra enquanto a divergência não for localizada.

### 2. Estado real
Executar e registrar:
```bash
git status --short
git branch --show-current
git log -12 --oneline --decorate
git worktree list
```

### 3. Procurar a decisão pelo símbolo/frase
Usar a palavra, rótulo, rota, função ou comportamento citado pelo usuário:
```bash
git log --all --oneline -S'TEXTO_EXATO' -- caminho/do/arquivo
git log --all --oneline -G'PADRAO' -- caminho/do/arquivo
```
Não concluir pelo nome do commit; abrir os candidatos.

### 4. Ler a evolução, não só o HEAD
Para cada commit relevante:
```bash
git show --stat COMMIT
git show COMMIT -- arquivos/relevantes
```
Identificar:
- commit que introduziu a regra;
- commit que corrigiu a regra;
- commit que eventualmente a reverteu/regrediu;
- testes e documentação adicionados junto.

### 5. Cruzar com fontes de governança
Ler:
- `AGENTS.md`;
- `PROJECT_STATUS.md`;
- `docs/SKILL-CONTINUIDADE-YOUTUBE-FINAL.md`;
- auditorias/handoffs citados no histórico;
- testes de regressão da área afetada.

Se documentação recente contradizer código/teste validado mais antigo, NÃO assumir que a documentação recente venceu: localizar quem a mudou e por quê.

### 6. Produzir diagnóstico antes de agir
Heartbeat obrigatório com quatro campos:
- **Recuperado:** comportamento validado anteriormente;
- **Regressão:** commit/alteração que divergiu;
- **Preservar:** partes que não serão tocadas;
- **Corrigir agora:** mudança mínima necessária.

Se houver duas decisões legítimas e incompatíveis, parar e pedir escolha ao usuário. RED objetivo pode ser corrigido.

### 7. Aplicar mudança mínima
Preferir restaurar a decisão validada por diff cirúrgico. Não reconstruir a feature inteira. Não tocar em backend/motor quando a divergência for apenas UI/documentação.

### 8. Criar regressão automática
Sempre que a perda de contexto causar uma regressão:
- adicionar/ajustar teste que prove a decisão recuperada;
- atualizar esta skill/continuidade se a causa foi ambiguidade documental.

### 9. Gate e evidência
Executar:
```bash
git diff --check
npm test
npm run lint
npm run build
npm run test:e2e -w @conexao/client
```
Mudança visual exige evidência desktop/mobile quando aplicável.

### 10. Checkpoint
Commit pequeno, temático, somente após verde. Registrar no `PROJECT_STATUS.md` qual decisão foi recuperada e de quais commits ela veio.

## Regras anti-amnésia específicas deste projeto

- Não inferir o fluxo de `Quero participar` pela aparência atual. Recuperar histórico de `App.tsx`, `owner.ts` e `whatsapp.ts`.
- Fluxo canônico em 06/10/2026: **CTA → tela intermediária → `/participation/request` → página persistente de pendência/dashboard → decisão Owner/verificações → mesma página mostra `Cadastro aprovado` → usuário volta ao acesso**. Não exigir segunda CTA/deep link como etapa obrigatória.
- `wa.me` não envia mensagem sozinho. Nunca descrever o deep link como envio automático.
- Bot já possui acolhimento, pergunta “Como gostaria de ser chamado?”, pendência, alerta administrativo e decisão. Participante não recebe Credencial/OTP no fluxo principal; após aprovação entra diretamente com nome + WhatsApp + grupo. Não reintroduzir a etapa de Credencial sem um novo requisito explícito.
- Owner/usuário já usam login único; `#` é interno. Não reintroduzir UI específica de Owner.
- Telefone é internacional e não recebe `+55` automático.
- Grupo é 1–999.
- Webapp/XFCE é a prioridade corrente; APK não deve desviar a rodada sem solicitação explícita.

## Heartbeat de recuperação
Durante a recuperação, atualizar o usuário em cada descoberta importante e nunca ultrapassar aproximadamente 5 minutos sem output.
