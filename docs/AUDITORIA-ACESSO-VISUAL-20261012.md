> Checkpoint histórico: gate e capturas finais atualizados em [AUDITORIA-PRODUTO-ASTRA-20261013.md](AUDITORIA-PRODUTO-ASTRA-20261013.md). As falhas intermediárias abaixo não representam o resultado final, que passou 249 API + 21 cliente + 5 E2E. Publicação coordenada segue pendente.

# Auditoria de acesso e conforto visual — 12/10/2026

## Estado desta rodada
- Base integrada: PR #2, main b684f236ebf50766b02aacabedc122c82c9111b1.
- Publicação confirmada por Fábio, porém accept-deploy cancelado novamente pelo conector. API/Web anteriores seguem online; patch d1be5c2e-d014-4ee2-bfab-9f295ea61286 ainda STAGED. Não tratar esta rodada como publicada.
- Login Owner real de Fábio confirmado na API pública (200), usando a credencial de emergência já configurada. Segredo e telefone privado não constam deste relatório nem do Git. `sosyout` é histórico de desenvolvimento.
- Revisão React aplicada: alterações pequenas, estado derivado preservado, erros explicativos, rótulos e foco de teclado. Autorização e regras de moedas/loja/Owners não foram modificadas.

## Achados e correções de código
1. Acesso: saveMine apagava os dois campos mesmo após rejeição do servidor. Agora limpa apenas após sucesso. E2E verifica rejeição por ausência de número, alerta e preservação dos dois valores.
2. Login: aviso de grupo tinha texto longo em 0,67rem. Texto encurtado, fonte 0,8rem e cor mais legível. Continua distinguindo vínculo aprovado e integração externa disponível.
3. Acesso: explicações de “ambiente” e “deploy” substituídas por instruções concretas. Geração de senha atribuída ao painel, sem prometer envio automático pelo bot.
4. Avatares: removida promessa de assistência de IA inexistente na tela. Upload agora possui nome acessível, participa do foco do teclado e indica foco no envelope.
5. Tipografia: DM Sans e Manrope empacotadas via Fontsource 5.3.0 (OFL-1.1), somente pesos/subconjunto latino usados. Sem pedido externo ao Google durante a abertura. Não adicionar fontes duplicadas.
6. Contraste dos botões principais: branco/vermelho #e72b3b = 4,37:1; #dc2435 = 4,83:1. Paleta navy/vermelho/creme preservada. Isto não constitui certificação de acessibilidade de toda a aplicação.
7. Cabeçalhos Owner: largura mínima flexível, ícones sem encolhimento, altura de linha e espaçamento de letras menos comprimidos.

## Evidência e validação
- Publicação atual inspecionada diretamente no navegador cloud, sem login nem alteração de dados.
- Evidências antigas de 14h45/14h46 foram identificadas pelos timestamps e não serão usadas como prova desta rodada.
- Primeira repetição E2E falhou antes de gerar capturas frescas: espera de load e estabilidade/visibilidade. Rodada com fontes locais também sofreu timeout. Portanto fontes externas não são causa única demonstrada.
- Execução paralela API/E2E causou três timeouts de beforeEach (234/237 API), sem falhas de asserção. Nova tentativa em sequência e com Chromium completo já instalado, sem ampliar timeouts/forçar cliques.
- Resultado final e capturas aceitas: atualizar após gate; nenhuma publicação desta correção visual autorizada como GREEN antes disso.

## Sugestões com utilidade concreta
- SUPER: selecionar participante por nome/WhatsApp, além do ID interno, para reduzir erros e cópia manual.
- Acesso: após entrar, orientar o Owner para definir sua própria senha na aba Acesso; a credencial de emergência continua recuperável na configuração privada.
- Bot: manter estados por motor (configurado, validado, funcionando) e última entrega real, usando a infraestrutura já criada. O teste temporário Meta confirmado pelo usuário permanece evidência histórica; não substitui integração definitiva.
- Navegação mobile: considerar atalho para o painel selecionado, evitando repetir a rolagem pelos indicadores. Validar com uso real antes de mudar a estrutura.

## Limites
A visualização local usa usuários sintéticos. Não foram feitas compras reais, envio WhatsApp ou alterações em credenciais de produção. Sem a publicação no Railway, a interface pública continua diferente da candidata local. O companion registra observação opt-in, não comprova atenção humana.
