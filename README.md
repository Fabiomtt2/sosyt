# Conexão Youtube

Webapp/PWA para participantes aprovados dos grupos SOS YOUTUBER montarem Filas globais de 10 vídeos e criarem, voluntariamente, uma playlist privada na própria conta Google. Android/Capacitor está preservado; APK permanece fora desta consolidação.

## Fluxo implementado

- Uma única tela de login usa nome, WhatsApp com código do país e grupo SOS YOUTUBER de 1 a 99. O backend identifica automaticamente se o cadastro corresponde a participante ou Owner; `#` permanece apenas como detalhe interno da API e nunca é exibido na interface.
- `Quero participar` registra uma solicitação persistente e mantém uma tela de acompanhamento até a decisão. Reenvios do mesmo WhatsApp ficam protegidos por bloqueio temporário de 120 minutos; a aprovação aparece nessa mesma tela antes do retorno ao login. O contato público usa `OWNER_WHATSAPP` quando definido ou Rafael como fallback. A automação oficial usa Meta Cloud API quando conectada; WPPConnect é o complemento self-hosted planejado para grupos tradicionais, com ativação explícita no painel Owner.
- A associação ao grupo SOS YOUTUBER é automatizada quando a Groups API oficial expõe grupos elegíveis: o worker reconhece `SOS YOUTUBER N`, sincroniza participantes e webhooks de entrada/saída atualizam o acesso. Grupos que a Meta não expõe permanecem disponíveis para conferência Owner.
- Todos os grupos veem o mesmo quadro persistente, com URL, autor, grupo e horário de cada contribuição. Apenas o próximo espaço pode ser preenchido; URL e autoria histórica ficam permanentes em cada Fila. O mesmo vídeo não pode ser reutilizado em Fila posterior.
- Só URLs estruturais do YouTube são aceitas. Com `YOUTUBE_API_KEY`, o servidor também consulta a API para confirmar existência/acessibilidade.
- Cada usuário começa com 10 moedas internas. Salvar custa 1; a primeira contribuição de cada Fila usa o direito-base. Uma compra confirmada de R$20 concede 20 moedas compradas e 1 passe adicional. Moedas promocionais/recompensas não geram passes.
- Ao completar 10 links, a Fila fica pronta e uma nova Fila abre. Quem participou permanece na tarefa da Fila concluída até atingir 100% ou escolher `Concluir tarefa`; só depois do cooldown persistente de 30 minutos volta ao fluxo comum. Depois da criação da playlist, o acompanhamento consolida 1 moeda interna a cada 10% de progresso, até 10 por usuário/Fila, sem duplicar marcos já creditados.
- Antes do OAuth, um modal informa que o usuário será levado à autenticação oficial Google/YouTube e que a playlist será criada como privada. A criação é explícita e voluntária.
- Painel Owner: registra decisão com data/Owner responsável, gerencia grupos em carrossel, possui autorização manual excepcional auditada, popup administrativo de participante, saldos por origem, exportação CSV e configuração persistente do bot WhatsApp (Oficial/Híbrido/Desativado).

## Executar no computador

Requer Node 22 ou superior. Dentro desta pasta:

```sh
npm install --legacy-peer-deps --cache .npm-cache
node scripts/setup-local.mjs
npm run dev
```

Abra http://localhost:5173. Os nomes padrão de Owner são `Fabio0` e `Rafael0`, com aliases sem o sufixo zero. O telefone configurado para cada Owner faz parte da identificação; o marcador `#` existe apenas internamente na API e nunca é solicitado na interface. Dados reais de Owner permanecem somente no `.env` local. Nunca publique o `.env`.

Em desenvolvimento, `AUTH_DEV_MODE=true` habilita a credencial administrativa local definida para teste; o participante aprovado entra diretamente por nome + WhatsApp + grupo. O mecanismo OTP permanece apenas como compatibilidade/legado no backend. `PAYMENTS_DEV_MODE=true` permite Pix DEMO sem movimentação financeira. Em produção os modos de demonstração são recusados pelo carregador de configuração.

A API lê o `.env` da raiz e mantém o banco em `apps/api/data/conexao-youtube.db`. O cliente usa `VITE_API_URL=http://localhost:3333` por padrão.

## Verificação

```sh
npm test
npm run lint
npm run build
npm run test:e2e --workspace apps/client
```

Na consolidação corrente de 06/10/2026: 65 testes de API, 6 testes do cliente, TypeScript, build React/PWA e 1 cenário Playwright ponta a ponta passaram. As capturas fictícias ficam em `docs/evidencias`.

## Integrações e limites atuais

Google OAuth/YouTube Data API, Mercado Pago e WhatsApp Cloud API possuem adaptadores e testes controlados, mas ainda exigem credenciais e validação real. Sem `YOUTUBE_API_KEY`, a validação do link é estrutural. Sem credenciais Meta, não há entrega real de OTP/bot.

A automação de grupos está implementada para a Groups API oficial: descoberta por nome `SOS YOUTUBER N`, sincronização de participantes, webhook de entrada/saída e fallback manual. A ativação real depende de a conta Meta e os grupos existentes serem elegíveis e retornados pela API.

O acompanhamento de reprodução após a playlist ser criada usa a IFrame Player API: o percentual avança com reprodução natural e aba visível, ignora saltos grandes e é sincronizado por conta/ciclo. Cada 10% consolidado gera 1 moeda interna de capacidade de contribuição, até 10 por playlist/ciclo; o ledger impede duplicação. Essas moedas não têm saque ou conversão em dinheiro. O percentual exibido durante `Criar playlist` continua sendo apenas o progresso técnico de inclusão dos 10 itens.

Antes de produção ainda faltam: validação real dos provedores, reconciliação de pagamentos órfãos/estornos, migração de eventuais telefones legados para a forma canônica internacional, política de privacidade/termos e exclusão/retenção de dados, monitoramento e revisão operacional. **Comece sempre por `docs/ANCHOR-YOUTUBE-FINAL.md`**; depois consulte `PROJECT_STATUS.md`, `docs/ESPECIFICACAO-CANONICA-YOUTUBE-FINAL-20261005.md`, `docs/ARQUITETURA.md` e `docs/WHATSAPP-INTEGRACAO.md`.
