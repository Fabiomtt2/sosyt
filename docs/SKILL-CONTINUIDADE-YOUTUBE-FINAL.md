# SKILL — Continuidade operacional do YouTube Final

Data-base: 05/10/2026.

## Objetivo
Impedir perda de contexto entre instâncias/agentes e preservar decisões já confirmadas no projeto `YouTube Final`.

## Preflight obrigatório
Antes de editar:
1. `git status --short`
2. `git log -5 --oneline --decorate`
3. ler `AGENTS.md`, `PROJECT_STATUS.md` e este arquivo;
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
- Campo de grupo: **SOS YOUTUBER — Digite a qual grupo você pertence**; somente 1 a 99, sem zero inicial.
- `#` é detalhe interno da API Owner. Nunca exibir `#` como valor, placeholder, palavra-chave ou instrução.
- Campo secreto chama-se apenas **Credencial**.
- Roteamento automático: backend identifica participante vs Owner; a UI não pergunta o papel.
- Owners aceitam nome configurado com sufixo 0 e alias equivalente sem 0/acento; privilégio só existe quando o WhatsApp também corresponde à conta configurada no `.env`.
- Telefones reais, credenciais e número administrativo ficam somente no `.env` ignorado pelo Git.

## Participação e WhatsApp
- Há uma única CTA principal **Quero participar** na intro.
- Se o WhatsApp oficial estiver configurado, a CTA abre a mensagem pré-preenchida para iniciar o bot; formulário web é fallback.
- O bot acolhe, explica o projeto, pergunta “Como gostaria de ser chamado?” e registra solicitação pendente.
- Nova solicitação aparece no dashboard e gera alerta administrativo pela Cloud API quando configurada.
- Aprovação acontece pelo dashboard; Credencial temporária usa o mesmo mecanismo OTP seguro já existente.
- Não duplicar CTAs de participação no login por apelo visual.

## Linguagem visual ASTRA
- Preservar paleta base navy/vermelho/creme, Manrope + DM Sans, cartões arredondados e hierarquia limpa.
- Premium significa refinamento, profundidade, consistência e legibilidade — não trocar identidade nem adicionar ruído.
- Intro: logo vermelha + “SOS YOUTUBER” em lockup horizontal; evitar empilhamento vertical não solicitado.
- CTA de participação e mensagem de segurança devem formar um único bloco visual.
- Sem cadeado decorativo grande. Segurança usa check verde discreto/padrão integrado ao bloco.
- Texto auxiliar do login deve ficar em uma linha no desktop; mobile pode quebrar para evitar overflow.
- Uma ideia por bloco, sem parede de texto, sem duplicação de chamadas.

## Motor já validado — não reescrever sem divergência explícita
- quadro global de 10 slots permanentes;
- validação de URL YouTube;
- OAuth explícito e criação de playlist privada;
- autoria/grupo/horário persistentes;
- WhatsApp bot/outbox/webhooks e decisões;
- moedas internas e acompanhamento de reprodução conforme regras já documentadas;
- dashboards participante e Owner;
- telefone internacional;
- grupos 1–99.

## Gate antes de checkpoint
```
git diff --check
npm test
npm run lint
npm run build
npm run test:e2e -w @conexao/client
```

Para mudança visual, regenerar e revisar evidências em `docs/evidencias/`. Webapp/XFCE é prioridade corrente; APK somente quando solicitado/priorizado.
