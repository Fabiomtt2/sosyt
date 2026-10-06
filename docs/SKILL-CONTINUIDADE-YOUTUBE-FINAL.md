# SKILL — Continuidade operacional do YouTube Final

Data-base: 05/10/2026.

## Objetivo
Impedir perda de contexto entre instâncias/agentes e preservar decisões já confirmadas no projeto `YouTube Final`.

## Preflight obrigatório
Se houver qualquer sinal de perda de contexto, executar primeiro `docs/SKILL-RECUPERACAO-MEMORIA-GIT.md`.

Antes de editar:
1. `git status --short`
2. `git log -5 --oneline --decorate`
3. ler `AGENTS.md`, **`docs/ANCHOR-YOUTUBE-FINAL.md`**, `PROJECT_STATUS.md` e este arquivo;
4. preservar WIP; nunca reset/clean/stash sem autorização explícita;
5. tratar `Conexão Youtube` como origem histórica ASTRA somente leitura durante auditorias.

## Heartbeat
- Atualizar o usuário a cada marco importante.
- Em execução prolongada, não ultrapassar aproximadamente 5 minutos sem output.
- Cada heartbeat informa: estado atual, o que acabou de ser validado/corrigido, REDs objetivos e próximo passo.

## Invariantes de produto e login
- Uma única tela de acesso: nome + WhatsApp internacional + grupo SOS YOUTUBER quando aplicável.
- O campo se chama apenas **WhatsApp**. Nunca `WhatsApp do Owner`.
- Nunca inserir `+55` automaticamente. País é livre; normalização/validação ocorre no backend.
- Campo de grupo: **Digite o número correspondente ao seu grupo**; somente 1 a 999, sem zero inicial, com ajuda `?` explicando a validação.
- `#` é detalhe interno da API Owner. Nunca exibir `#` como valor, placeholder, palavra-chave ou instrução.
- Participante não possui campo secreto no fluxo principal. Após validação de telefone + grupo em `group_memberships`, entra diretamente.
- Somente Owner recebe o campo **Credencial** depois de nome + WhatsApp identificarem uma conta Owner; em desenvolvimento o valor é `sosyout`, enquanto produção exige segredo forte do servidor.
- Roteamento automático: backend identifica participante vs Owner; a UI não pergunta o papel.
- Owners aceitam nome configurado com sufixo 0 e alias equivalente sem 0/acento; privilégio só existe quando o WhatsApp também corresponde à conta configurada no `.env`.
- Telefones reais, credenciais e número administrativo ficam somente no `.env` ignorado pelo Git.

## Participação e WhatsApp
- Há uma única CTA principal **Quero participar** na intro.
- A CTA abre primeiro a tela intermediária de participação. Ao enviar, os dados são registrados no backend/dashboard e a interface confirma de forma amigável que a equipe entrará em contato pelo WhatsApp. O bot/transportador continua o fluxo quando configurado; não exigir que o candidato abra manualmente um segundo CTA.
- O bot acolhe, explica o projeto, pergunta “Como gostaria de ser chamado?” e registra solicitação pendente.
- Nova solicitação aparece no dashboard e gera alerta administrativo pela Cloud API quando configurada.
- Aprovação acontece pelo dashboard ou pela sincronização oficial de grupo quando disponível. Participante não aprovado recebe confirmação de cadastro pendente, não erro de login; aprovado entra diretamente sem Credencial/OTP.
- Não duplicar CTAs de participação no login por apelo visual.

## Linguagem visual ASTRA
- Preservar paleta base navy/vermelho/creme, Manrope + DM Sans, cartões arredondados e hierarquia limpa.
- Premium significa refinamento, profundidade, consistência e legibilidade — não trocar identidade nem adicionar ruído.
- Intro: logo vermelha + “SOS YOUTUBER” em lockup horizontal; evitar empilhamento vertical não solicitado.
- CTA de participação é um botão isolado, sem retângulo/card externo; deve ter a mesma altura/padding do botão `Continuar`.
- A mensagem de segurança fica abaixo com respiro maior; duas primeiras linhas em peso normal e apenas `Você mantém o controle.` em negrito.
- Segurança usa escudo verde ilustrado em SVG, ancorado à base do bloco para acompanhar variações de altura do texto; não usar cadeado decorativo nem check circular genérico.
- Texto auxiliar do login deve ficar em uma linha no desktop; mobile pode quebrar para evitar overflow.
- Uma ideia por bloco, sem parede de texto, sem duplicação de chamadas.

## Motor já validado — não reescrever sem divergência explícita
- Filas globais sequenciais de 10 slots permanentes; ao fechar uma Fila, a seguinte abre sem apagar histórico;
- validação de URL YouTube;
- OAuth explícito e criação de playlist privada;
- autoria/grupo/horário persistentes;
- WhatsApp bot/outbox/webhooks e decisões;
- moedas internas e acompanhamento de reprodução conforme regras já documentadas;
- conclusão manual/100%, cooldown persistente de 30 minutos e bloqueio de nova Fila enquanto tarefa anterior estiver pendente;
- rejeição de `video_id` já usado em qualquer Fila;
- dashboards participante e Owner;
- telefone internacional;
- grupos 1–999.

## Gate antes de checkpoint
```
git diff --check
npm test
npm run lint
npm run build
npm run test:e2e -w @conexao/client
```

Para mudança visual, regenerar e revisar evidências em `docs/evidencias/`. Webapp/XFCE é prioridade corrente; APK somente quando solicitado/priorizado.
