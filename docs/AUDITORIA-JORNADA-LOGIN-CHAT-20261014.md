# Auditoria da Jornada, acesso e comunidade — 14/10/2026

## Parecer dos dois agentes

**Auditor de motores / experiência Owner:** a importação Claude 8a1962f está preservada como ancestral e os dois arquivos WIP de automação foram importados integralmente. O laudo Claude LAUDO-10 descrevia XP/níveis como proposta futura F3, não um runtime perdido. O motor existente de intervalos de vídeo, tempo acumulado entre sessões e 20 minutos por moeda continua presente. Revisão desta expansão inclui guards Root, idempotência, separação de saldos, configuração, expiração e estados reais do bot.

**Auditor visual / experiência participante:** login e sala global foram comparados em capturas novas antes/depois, desktop e mobile. A intro mobile passou de aproximadamente 617 para 309 px; a sala ganhou feed público legível, rascunho editável durante espera e moderação explícita. Jornada mobile, avatar/nível/XP e configurações Owner mostraram hierarquia legível. Apontou coluna vazia sem booster, fechamento invisível após rolar o direct e rótulos de intervalo sem unidade: corrigidos para layout cheio, cabeçalho de conversa fixo com X e “a cada quantos níveis”. As capturas finais serão reinspecionadas após o gate abaixo.

Nenhum parecer significa 100% dos estados possíveis. Os testes usam fixtures isoladas, sem alterar valores de produção. Provedores definitivos de bot/pagamento permanecem dependentes da configuração real.

## Regras implementadas e fonte de verdade

- XP vem de cobertura única persistida e consolidada pelo servidor, usando duração do vídeo validada. Percentual arbitrário do cliente não concede XP.
- Padrão: 100 XP por vídeo completo, nível 1 começa em zero; primeiro avanço exige 100 XP e cada avanço seguinte acrescenta 50 à dificuldade.
- Curva por perfil e taxa por fonte possuem snapshot: alterações Root não recalculam conquistas passadas. Recompensas novas seguem regras atuais, com histórico imutável.
- Cada nível conquistado concede +1 moeda; cada 10 concede +20 extras; cada 30 concede SUPER por 7 dias. Nível 1 inicial não duplica a carteira de boas-vindas.
- Trial é um benefício separado, expira pelo relógio do servidor e pode ser revogado pelo Root. Não estende nem substitui assinatura paga. Destaque visual do nível 30 não concede privilégio permanente.
- TOP 3 mensal por XP no calendário America/Bahia: 15/10/5 moedas uma vez após fechar cada mês. Liquidação automática recupera meses pendentes após reinício. Contas administrativas não disputam prêmios.
- Ranking permanente mantém níveis/XP, ordenado por nível, XP e desempate estável. Não concede premiação repetida a cada atualização.
- Moedas de recompensa permanecem internas, sem conversão em receita. Troca padrão de 100 moedas de recompensa por 1 Passe ou Pular; valores configuráveis. Não oferece SUPER nem pacote de moedas nessa troca.
- Presentes debitam/creditam o mesmo saldo de recompensa com referência idempotente, destinatário e quantidade vinculados. Moedas compradas e promocionais ficam separadas.
- Booster gratuito: sexta-feira das 06:00 até terminar o dia em America/Bahia, uma abertura por usuário/data. Não exige compra. Sorteio criptográfico no servidor; recarregar ou mudar relógio do navegador não concede outra abertura.
- Chances padrão: 5 moedas 45%; 10 moedas 25%; 15 moedas 13%; 20 moedas 8%; 25 moedas 5%; Pular 2%; Passe 1,5%; SUPER de 7 dias 0,5%. As oito chances precisam somar 100%.
- Perfil, filas, chat global, conversas privadas, consulta de avatar, rankings e inspeção individual Owner usam a mesma apresentação de nível. Avatar, ADMIN e SUPER preservados.
- Jornada mostra o bloco de níveis até o próximo marco de dez, XP necessário, saldo e recompensas. Root administra regras, chances e mensagens; configuração e eventos ficam auditados.

## Acesso, sala e bot

- Login único continua com identificação por DDI/DDD/número separados e grupo resolvido no servidor. Google permanece opcional; conexão para criar playlists é consentimento separado.
- Chave WhatsApp dura 5 minutos, com tentativas e janela de reenvio. Aprovação Owner e verificação externa real são informações distintas.
- Senha alternativa entra pelo mesmo número/conta/grupo/carteira. O participante pode definir/trocar senha; sessão por senha exige confirmação da senha atual.
- Senha inicial automática só nasce após prova de acesso, aprovação e possibilidade real de enfileirar envio Meta em OFFICIAL/HYBRID_PLUS: janela comprovada de atendimento ou template configurado. Sem isso não cria senha inacessível.
- Senhas existentes e credenciais administrativas são preservadas. Hash e mensagem enfileirada são atômicos; payload sensível é cifrado antes da gravação. Segredos não vão para correio interno nem respostas públicas.
- Bot da Jornada conecta cinco eventos reais: nível, booster, prêmio mensal, troca e presente de moedas. Correio interno idempotente; WhatsApp fica aguardando quando falta configuração.
- QUEUED exige outbox real; SENT/FAILED acompanha seu registro. Aceitação pelo provedor não equivale a leitura da mensagem. Não declarar os 19 eventos históricos Claude todos ativos.
- Chat comum tem 30 segundos por padrão, mantendo exceções configuradas pelo Owner. ADMIN/ROOT e SUPER elegível não aguardam. API de moderação usa credencial administrativa real; limpeza Root exige confirmação.

## Evidências e verificação

Capturas em docs/evidencias:
- access-before/after-1440 e 390; registro, chave e pendência.
- room-admin-before/after-1440 e 390; moderação e cooldown.
- journey-1440/390; direct e Owner.
- journey-booster-preview-1440/390 é **fixture visual**, sem mudar relógio real do servidor. A API rejeita abertura fora da janela e o saldo permanece intacto.
- Evidências de loja, inventário, Passe/Pular, SUPER e celebração de compra foram renovadas nos testes de navegador.

Gate final em 15/10/2026: **292/292 API, 25/25 cliente, 8/8 Chromium**, lint/TypeScript, build e diff check GREEN. Logs locais journey-accepted-gate.log, journey-final-types.log, journey-final-build.log e journey-final-browser.log. A proteção de publicação bloqueou uma API antiga e permitiu uma API compatível em teste HTTP isolado.

Últimos REDs resolvidos: rótulo acessível da senha atual, senha bot obsoleta enfileirada, Root configurado sem vínculo persistido e fechamento invisível durante scroll. Reinspeção das sete capturas da Jornada/sala confirmou os ajustes; duas capturas mobile finais também abertas pelo integrador. Boilerplate de teste não foi aceito como prova visual.

Os dois pareceres convergem: motor pronto para publicação após gate; experiência visual aprovada no escopo amostrado. Limites permanecem: APIs externas definitivas, pagamentos reais, outros navegadores e todos os estados possíveis não foram certificados.


## Publicação e limites

PR #3 MERGED em 15/10/2026. Main local/remoto 9e1d8bca8f81b9e51ddb0b7cc43049e094961973. Branch original de revisão astra/convergencia-20261012; base bad6c07. Seis commits desta expansão publicados até 0296bf240017bf136cd332b2e29c0a78863272e2; ainda não é produção.
API e Web públicos continuam online com artefatos de 10/10. Patch staged agora inclui espera da Web por capacidades da API antes de expor a nova tela. Pages recebe o mesmo gate e permanece pausado enquanto VITE_API_URL não estiver configurada; a URL principal é Railway Web. Volume /data preservado; backup SQLite consistente antes de migrações aditivas.
Acesso de ambas as contas Root foi validado por requisições autenticadas públicas nesta rodada. Nenhuma credencial é registrada neste relatório.
Publicação coordenada exige gate, commits revisáveis, push e confirmação de SUCCESS para ambos os serviços. Aprovação do conector não deve ser contornada.
A medição registra progresso no player; não comprova atenção humana ou visualizações reconhecidas pelo YouTube. O runtime histórico IFtp não foi localizado. O companion atual é uma implementação posterior opt-in e apenas corrobora observações: não concede recompensas por conta própria.

Merge confirmou árvore idêntica à ponta testada 7edea71. Próximo passo: Railway, ainda sem deploy desta expansão.

## Resultado operacional final — 15/10/2026

PR #3 MERGED; main publicado e sincronizado. A operação accept-deploy foi cancelada pela camada de aprovação, apesar da autorização explícita, com a mensagem “the user did not approve this action”. Releitura confirmou patch7campos STAGED e nenhum novo deploy. Web/API antigos SUCCESS1/1; volume /data500MB intacto. Rafael e Fábio reautenticaram HTTP200. Novas funções estão em main, ainda não em produção. Ação restante: aplicar o patch pelo painel Railway e validar os dois serviços, health com capacidades e migração/backup. Não contornar o bloqueio com CLI/browser.
