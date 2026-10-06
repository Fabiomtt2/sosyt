# AUDITORIA — PARTICIPANTE E INFRAESTRUTURA PÚBLICA

Data: 06/10/2026
Base Git auditada: `9734380` antes das correções desta rodada.
Repositório remoto: `Fabiomtt2/sosyt`.

## 1. Reancoragem

- `main` local e `origin/main` estavam exatamente no mesmo commit `9734380`.
- GitHub Actions `Deploy SOS YouTube Pages` estava verde para esse commit.
- Árvore iniciou limpa.
- Fonte de verdade lida: `docs/ANCHOR-YOUTUBE-FINAL.md`, `AGENTS.md`, `PROJECT_STATUS.md`, `README.md`, skill de continuidade e checkpoint crítico Owner UI.

## 2. Auditoria visual real no Xubuntu

- O launcher antigo chamava apenas `xdg-open`; no Xubuntu atual isso não abriu navegador.
- O launcher foi corrigido para preferir Firefox explicitamente e agora está versionado em `scripts/launch-xubuntu.sh`.
- Uma nova janela Firefox com cache-bust foi aberta e renderizou a revisão atual.
- A evidência atual do modal Owner `Configurar integração` já corresponde à skin canônica branca/creme e não reproduz o estado antigo de caixas pretas/textos sobrepostos.
- O login atual está sem escudo verde e mantém o seletor internacional DDI/DDD e grupos 1–999.
- Se uma aba antiga divergir dessas evidências, testar sempre uma janela nova pelo launcher canônico antes de abrir novo RED.

## 3. Página do participante — estado comprovado

Gate antes da correção de CTA duplicado:
- backend: 65/65 testes;
- cliente: 9/9 testes;
- TypeScript: verde;
- build/PWA: verde;
- E2E: 1/1.

Invariantes cobertas por testes:
- URL YouTube válida é persistida;
- segunda contribuição sem passe é recusada;
- 10 contribuições fecham a Fila e abrem a próxima;
- autoria, grupo e horário permanecem;
- reload preserva o estado visível;
- progresso de reprodução é persistido por conta e não pode regredir;
- conclusão manual preserva percentual/recompensa e cria cooldown persistente de 30 min;
- vídeo duplicado global é recusado;
- passe comprado libera somente uma contribuição extra;
- Pix idempotente não duplica crédito;
- estorno suspende novos gastos sem apagar saldo;
- OAuth cancelado não cria playlist;
- playlist alterada manualmente pelo usuário não é sobrescrita.

## 4. RED encontrado e corrigido nesta auditoria

Na Fila completa, um usuário que havia salvo mais de uma URL via passe recebia vários botões `Criar playlist` dentro dos próprios slots, além do CTA principal.

Regra corrigida:
- existe somente um CTA `Criar playlist` por usuário/Fila, localizado no card principal da Fila;
- os slots mostram apenas autoria, URL, grupo, horário e a confirmação de que o vídeo está registrado;
- E2E deve exigir zero botões `Criar playlist` dentro de `.cycle-details`.

## 5. Banco local real — auditoria readonly

Estado observado em 06/10/2026:
- `PRAGMA integrity_check = ok`;
- 0 violações de foreign key;
- 1 Fila OPEN;
- 0 Filas READY;
- 0 submissions;
- 0 usuários e carteiras;
- 1 associação de grupo;
- 3 solicitações de participação;
- 0 pagamentos;
- 0 slots duplicados;
- 0 vídeos duplicados;
- 0 carteiras negativas;
- 0 progresso fora do intervalo 0–100.

Conclusão: o banco local está estruturalmente íntegro, mas pouco populado; a persistência do motor é comprovada principalmente pelos testes/E2E isolados.

## 6. O que GitHub Pages entrega e o que ainda falta

GitHub Pages entrega apenas o frontend/PWA estático. Para o sistema operar publicamente, ainda é necessário:

1. **Backend HTTPS público** executando Fastify/Node 22.
2. **Persistência server-side** para SQLite em volume permanente ou migração futura para banco gerenciado.
3. Definir `VITE_API_URL` no deploy do frontend para apontar para esse backend.
4. Configurar CORS/origens públicas e URLs de callback.
5. **Meta/WhatsApp**: WABA ID, Phone Number ID, System User Access Token, App Secret, Verify Token, templates e webhook HTTPS; validar na Graph API.
6. **WPPConnect opcional**: subir serviço separado, proteger com segredo, parear QR e validar leitura de grupos/membros/admins.
7. **Google/YouTube**: Client ID/Secret OAuth, redirect URI público e `YOUTUBE_API_KEY` para validação real de vídeos.
8. **Mercado Pago**: token/segredo webhook e conciliação real; manter modo DEMO desligado em produção.
9. Segredos fortes de produção para JWT/Owners/criptografia e desligar modos dev.
10. Backup/restore do banco, logs/monitoramento e estratégia de recuperação.
11. Política de privacidade, termos, retenção/exclusão e revisão dos requisitos dos provedores.

## 7. Opções de hospedagem

Para manter o SQLite atual sem reescrever o banco, o backend precisa de um host com volume persistente. Railway e Render suportam volumes/discos persistentes. Outra opção é migrar o banco para Postgres depois, mas isso não é requisito para o primeiro deploy funcional.

A prioridade recomendada é:
`backend HTTPS + volume persistente → VITE_API_URL → OAuth Google → Meta → WPPConnect complementar → Mercado Pago real`.

## 8. Gate final desta auditoria

Após a correção do CTA duplicado:
- `git diff --check`: aprovado;
- backend: 65/65 testes;
- cliente: 9/9 testes;
- TypeScript/lint: aprovado;
- build React/PWA: aprovado;
- E2E completo: 1/1 aprovado;
- evidência `ciclo-completo-mobile.png` revisada visualmente e contendo apenas um CTA `Criar playlist`.

## 9. Continuidade

- Não reescrever o motor de filas/moedas/progresso já validado.
- Toda mudança visual deve ser confrontada com screenshot real e E2E.
- Toda mudança funcional deve fechar o gate obrigatório antes de commit/push.
- Local e GitHub devem terminar no mesmo commit, com árvore limpa.
