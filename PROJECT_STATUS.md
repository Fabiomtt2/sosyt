# Estado verificável — Astra, 2026-10-05

## Âncora e isolamento

Repositório autônomo em `/home/ubuntu-desktop-bootstrap-ubuntu-/Documents/Codex/2026-10-04/gostar/Conexão Youtube`, branch main, sem remote configurado. Apesar da descrição inicial como worktree, não está conectado a outro projeto. Não criar outra cópia/worktree nem alterar Clareia ou outros diretórios. Checkpoint do WIP herdado: 37f915c; base original: 07f85b5. Consultar `git log` e `git status` antes de qualquer continuação.

Commit da implementação web auditada: `14f584e` (feat: complete shared web playlist engine and Owner access controls). O commit documental seguinte é a âncora de encerramento; consultar HEAD com git log.

## Entregue nesta etapa

- Motor central global: dez URLs sequenciais, persistência SQLite, autoria/horário, moedas e passes de compra separados, débito e fechamento atômicos, novo ciclo automático.
- Webapp com formulário na próxima caixa, bloqueio das seguintes, histórico completo dos ciclos e ação Compartilhar em Playlist para participantes conectados ao Google.
- Login único com papéis separados. Owner: grupo 0, nome/ID/credencial exclusiva. Participantes: grupo sem algarismo zero e telefone previamente aprovado.
- Quero participar!, aprovação/revogação manual, grupos ativos, painel Owner com dados, indicadores mensais e CSV.
- Endurecimento de OTP, JWT, OAuth state único, Pix idempotente/verificado, estorno com suspensão da carteira, recuperação de exportações incompletas e trava de concorrência.
- Scripts de configuração local, desenvolvimento e navegador mantêm diretórios temporários/caches específicos dentro do projeto. API lê .env da raiz e ancora caminho relativo do banco nela.
- Pesquisa de repositórios oficiais registrada em docs/PESQUISA-INTEGRACOES.md; rate-limit e helmet incorporados. Não copiado código de bots WhatsApp não oficiais.

## Verificação executada

- npm test: 33 testes API + 3 testes cliente aprovados.
- npm run lint: TypeScript API e cliente aprovado; não há lint estilístico separado.
- npm run build: API + React/PWA aprovado.
- Playwright: 1 cenário completo aprovado, viewport celular 390x844 e desktop 1440x1000, sem erro JavaScript/overflow horizontal nas telas verificadas.
- Cenário: solicitação pública, Owner aprova, participante entra, salva, compra DEMO e usa passe, oito outros usuários de dois grupos veem os mesmos dados e completam dez URLs; ciclo seguinte abre e o histórico mantém dez autores/horários.
- Conectar/Compartilhar/Abrir playlist também verificados na UI com resposta Google/exportação explicitamente simulada. Não criada playlist real.
- Capturas com dados fictícios: docs/evidencias. Chromium instalado em .playwright-browsers. O Chromium pré-existente apresentou exclusão espontânea de localStorage no teste; o navegador compatível instalado no projeto preservou sessões. Não confundir essa investigação com bypass de autenticação.

## Estado de execução local

.env local criado com segredos aleatórios e permissão 0600, ignorado pelo Git. Nome provisório Owner, ID owner, grupo 0; a credencial está no próprio arquivo. Nome, identificação e número WhatsApp definitivos ainda precisam ser escolhidos/configurados. Modos OTP e Pix são de demonstração. O banco de testes do navegador é separado do banco da aplicação.

Execução local iniciada nesta sessão via Desktop Commander, PID 56013. Health, HTML, login Owner e overview retornaram HTTP 200 com a configuração local (segredos não exibidos).

Comando: npm run dev. Interface localhost:5173, API localhost:3333. O fato de a execução estar ativa nesta sessão não garante permanência após reinício; relançar o comando dentro do projeto. Não divulgar o segredo em logs/documentos/commits.

## Limites e próximos passos concretos

1. Configurar e testar Google OAuth/YouTube, Pix Mercado Pago e entrega WhatsApp. Adaptadores Google/Pix existem; OTP real ainda NÃO existe e retorna 501 fora de desenvolvimento.
2. Aprovação em SOS YOUTUBER é manual. O formulário ou grupo informado sozinho não comprovam vínculo. wa.me apenas prepara mensagem, não envia automaticamente nem adiciona ao grupo.
3. Com YOUTUBE_API_KEY ausente, URL tem validação estrutural, sem confirmação de vídeo existente. Exportação privada é voluntária; API externa pode falhar, inclusive por quota/consistência eventual.
4. Carteiras com estorno estão bloqueadas para contribuição e dependem de conciliação. Falta ferramenta administrativa segura de resolução. Criar Pix pode falhar depois da aceitação pelo provedor e antes de persistir ID local; falta reconciliação desses pagamentos órfãos.
5. Unificar telefone com país antes do uso real: hoje remove formatação mas aceita 10–15 dígitos, de modo que números com/sem DDI podem virar identidades distintas. Usar formato DDI+DDD+número consistentemente nesta demonstração.
6. Recompensa por watch time e player em segundo plano não implementados por restrições oficiais YouTube. Recompensa atual: 1 moeda de curadoria por participante distinto ao completar ciclo, não por playlist exportada ou tempo assistido. Não há resgate em reais; R$1 é taxa de compra. Não apresentar como implementação integral da monetização original.
7. Privacidade, exclusão/retenção de dados, operação/monitoramento, renovação/revogação completa de tokens e implantação permanecem pendentes. Não anunciar produção pronta.
8. APK explicitamente adiado pelo usuário. Android/SDK/WIP preservados. Não gastar a próxima etapa retomando builds Android; foco webapp/motor.

## Continuidade

Não reimplementar o motor, login Owner ou migrations em paralelo. Ler README, esta âncora, auditoria, arquitetura e pesquisa; examinar os testes; manter dados e WIP. A próxima evolução deve partir das pendências acima. Guardar novos checkpoints/commits e atualizar esta âncora com resultados reais, distinguindo simulação de integração confirmada.
