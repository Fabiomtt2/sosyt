# SOS YouTuber — acompanhamento opcional no computador

Este é um programa Python real, novo, criado em 07/10/2026. Não é o runtime histórico IFtp: a auditoria não encontrou esse runtime materializado.

## Instalar e usar
1. Instale Python 3.10 ou superior, com Tkinter, Pillow e Tesseract (idioma inglês).
   - Pillow: python -m pip install Pillow
   - Ubuntu/Debian: pacotes python3-tk, python3-pil e tesseract-ocr.
   - Windows/macOS: instale Python e Tesseract para seu sistema; coloque Tesseract no PATH ou informe --tesseract /caminho/do/executavel.
2. Baixe sos-companion.py pelo webapp. Execute: python sos-companion.py
3. No acompanhamento de vídeos do webapp, abra “Acompanhamento opcional no computador”, aceite a conexão e gere o código.
4. Copie o endereço do servidor e o código para o programa. Confira o endereço antes de conectar. Código de uso único, válido por cinco minutos.
5. No programa, autorize a observação. Clique em “Selecionar região” e arraste SOMENTE sobre o contador do player (ex.: 0:12 / 2:00). Esc cancela a seleção.
6. Clique em Iniciar. Mantenha o player do webapp visível. Se mover a janela ou o contador desaparecer, pare e selecione novamente.
7. Parar ou fechar interrompe novas capturas. “Desconectar” no webapp, ou “Desconectar este computador” no programa parado, revoga a autorização no servidor imediatamente. Para reabrir o programa, gere outro código.

O token fica somente na memória do processo. Autorizações expiram em 30 dias e podem ser revogadas antes; há limite de cinco computadores. Fechar o programa não apaga o histórico mínimo de conexão no servidor.

## Privacidade e limites
- Só a região escolhida é processada; nenhuma imagem ou texto OCR bruto é enviado.
- Quadros são transitórios em memória. Não há arquivo de screenshot, histórico de tela ou gravação.
- O servidor guarda apenas o último estado, tempos, número sequencial e identificação da autorização.
- O programa não inicia automaticamente em computadores públicos, não controla reprodução, não clica, não curte e não comenta.
- OCR observa números na tela, não identidade do vídeo, presença humana ou atenção. Um contador pode estar oculto, não legível ou não corresponder ao player.
- As observações são complementares. Este programa NÃO escreve na carteira e NÃO contabiliza tempo independente. O motor web existente mantém os registros acumulados entre sessões/filas.
- Captura pode depender da autorização de gravação de tela do sistema; Wayland e múltiplos monitores podem impor limitações. A seleção atual cobre a tela principal.
- O usuário pode retirar consentimento e interromper a leitura a qualquer momento. Uma requisição que já estava em trânsito pode terminar, mas não envia imagens.

## Arquitetura
Código único: companion/sos_companion.py. O build copia o arquivo e estas instruções para downloads públicos, sem executar Python no servidor.
Autorização: POST /companion/pairings (sessão) -> POST /companion/pair (código) -> token opaco restrito a metadados.
GET /companion/devices e DELETE /companion/devices/:id são restritos à própria conta.
POST /companion/observations rejeita campos extras, replay, token expirado/revogado. Não escreve ledger.
HTTPS obrigatório, exceto loopback local. Redirecionamentos recusados para não encaminhar token.

## Testar
python -m unittest discover -s companion -v
SOS_TESSERACT e TESSDATA_PREFIX habilitam teste real de OCR.
SOS_GUI_TEST=1 habilita teste de janela/captura em display isolado. Não execute esse modo na sessão de desktop de outra pessoa.
