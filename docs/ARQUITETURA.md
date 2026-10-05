# Arquitetura e regras de domínio

## Componentes

- apps/client: React 19 + Vite + PWA. Capacitor preservado; APK fora da etapa atual.
- apps/api: Fastify 5 + SQLite/better-sqlite3. Um servidor central mantém o quadro global compartilhado por todos os grupos. Não usar localStorage como banco de contribuições.
- Banco local com migrações aditivas e transações; implantação com múltiplas instâncias exige desenho de concorrência compartilhada e migração de banco.

## Ciclo de dez posições

Existe um ciclo OPEN; apenas a próxima posição sequencial aceita contribuição. Primeira contribuição de cada usuário no ciclo usa seu direito-base; as adicionais exigem passe comprado. O servidor ocupa posição, debita 1 moeda, consome passe quando necessário e registra lançamento na mesma transação. Restrições únicas impedem duas contribuições na mesma posição/vídeo.

A décima contribuição fecha READY, registra 1 moeda de curadoria para cada participante distinto e abre novo OPEN. Fechamento não gera recompensa duplicada. URL canônica, video ID, autor, grupo e horário ficam persistidos; nome/grupo do autor são fotografados no salvamento. Nos registros anteriores à migração, o backfill recupera o cadastro disponível naquele momento.

O participante vê seus ciclos prontos sem limite artificial de cinco ciclos. Conectar Google é individual; exportar é ação explícita. Uma trava com lease de dez minutos impede exportações concorrentes por usuário/ciclo. O marcador do ID da exportação na descrição permite recuperar playlist criada remotamente; os itens existentes são comparados antes de retomar inserções. Uma playlist modificada manualmente é recusada em vez de sobrescrita. Consistência eventual externa ainda pode exigir conciliação.

## Carteira e pagamentos

Valores em centavos e milimoedas inteiros. Carteira separa promo, purchased, reward e extra_slot_passes; débito usa promo, reward e purchased nessa ordem. Saldo natural nunca concede passe. Compra confirmada de R$20 credita 20 moedas compradas e um passe, uma única vez pelo lançamento PIX_PURCHASE/payment ID.

Pix é criado PENDING antes da liquidação local. Consulta servidor-servidor valida ID, referência interna, R$20, moeda BRL e método pix. Webhook exige assinatura HMAC, timestamp recente e identidade coerente, e consulta o provedor antes de liquidar. Consulta de status só é acessível ao dono do pagamento. Estorno de compra já creditada marca carteira em revisão e bloqueia novas contribuições; ainda falta interface de conciliação financeira e liberação segura pelo Owner.

## Login e administração

Uma tela para todos. Participante precisa de telefone e grupo presentes na lista autorizada; Owner usa grupo 0, nome/ID configurados e segredo exclusivo de servidor. Grupo 0 sozinho não dá privilégio. Tokens de sessão, Owner e OAuth têm propósito e audiência separados. Owner tem sessão de 1h; participante de 8h. Revogação/grupo desativado/troca de grupo invalidam acesso existente no servidor.

Solicitação pública exige consentimento, é deduplicada pelo telefone e aparece no painel. wa.me prepara mensagem; envio depende do usuário. Owner confere o grupo no WhatsApp e aprova manualmente. Sem provedor de OTP de produção, a API retorna 501 e não finge enviar mensagens.

Indicadores mensais usam America/Bahia; ativos significam acesso autenticado nos últimos 30 dias. Playlists criadas são exportações SUCCESS, não meramente ciclos completos. Simulações Pix não entram em receita real. Telas mostram os últimos 200 registros e CSV inclui todos os usuários; exportação exclusiva do Owner e células protegidas contra fórmulas.

## Segurança e limites

OTP hash, validade dez minutos, uso único, limite de tentativas e espera entre solicitações. OAuth state hash, uso único e expiração; tokens Google cifrados AES-256-GCM. API com cabeçalhos de segurança, CORS restrito, cache privado no-store e erros internos sem detalhes. Requisições externas têm timeout de 15s. CPF/e-mail do Pix seguem para PSP e não ficam persistidos localmente.

Segredos e modos de demonstração são recusados em produção. Ainda faltam renovação/revogação robusta de tokens, ciclo de privacidade/exclusão de dados, normalização de telefone com país sem ambiguidades, operação e testes reais de provedores.

Não há recompensa por watch time, reprodução em segundo plano ou promessa de views. A recompensa interna de curadoria difere da formulação original de remuneração por visualização; a decisão e a fonte oficial estão documentadas na auditoria e na pesquisa.
