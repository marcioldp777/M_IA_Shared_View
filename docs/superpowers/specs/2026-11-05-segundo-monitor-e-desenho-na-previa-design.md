# TV como 2º monitor e desenho na pré-via — design

Data: 2026-11-05 · Status: aprovado em conversa, aguardando revisão do documento

## Objetivo

1. **Desenhar na pré-via**: durante a transmissão, o painel do app Windows mostra a transmissão grande e permite usar as ferramentas de apresentação diretamente sobre ela.
2. **TV como 2º monitor**: além de espelhar uma tela ou janela, o usuário pode transformar a TV numa tela estendida do Windows (como "Estender" do Win+P) e arrastar janelas para ela.

Público: qualquer usuário do app (instalador público), inclusive leigos. As ferramentas de apresentação devem funcionar nos dois modos já na primeira versão.

Ordem de entrega: **Fase 1** desenho na pré-via → **Fase 2** monitor virtual.

## Fase 1 — Desenho na pré-via

### Comportamento

- Durante a transmissão, a pré-via ocupa toda a largura do painel em 16:9. Abaixo dela, a linha de interruptores (Caixa de ferramentas, Preencher a tela da TV e, na Fase 2, o 2º monitor). "Parar transmissão" continua no topo.
- A ferramenta é escolhida na caixa flutuante (ou atalhos `Ctrl+Alt+…`), como hoje.
- Com uma ferramenta ativa, o usuário desenha **na pré-via ou na tela real**; o resultado aparece nos dois lugares e na TV.
- Caneta, marca-texto, laser, formas, borracha e zoom por seleção funcionam na pré-via. Apontador, lupa e holofote acompanham o mouse sobre a pré-via.
- O desenho respeita a área real do vídeo dentro da pré-via (descontando faixas pretas). O modo "Preencher a tela da TV" não altera as coordenadas (ele só muda a exibição na TV, que já usa `frame()`).

### Conflito com a camada de desenho

Ao compartilhar a tela principal inteira, a camada transparente (`overlay`) cobre o painel. Regra:

- Enquanto houver ferramenta ativa, o processo principal verifica (no mesmo ciclo de ~33 ms do cursor) se **o painel é a janela em primeiro plano e o cursor está dentro dos limites dele**. Nesse caso a camada passa a ignorar o mouse (`setIgnoreMouseEvents(true, { forward: true })`); fora disso, volta ao comportamento da ferramenta.
- O painel recebe `setContentProtection(true)` durante a transmissão, para não aparecer na TV (evita o efeito "espelho dentro do espelho").

### Componentes

- **`public/pen.js`** (novo): extrai de `public/overlay.js` a lógica de entrada (pointerdown/move/up → `stroke-start`, `stroke-point`, `shape`, `erase`, `selection`/`zoom`, ids únicos). Recebe um elemento-alvo e uma função que converte o evento em coordenadas normalizadas (0..1) da área compartilhada. Usado pela camada (`overlay.js`) e pelo painel.
- **Painel (`public/index.html`, `public/app.js`, `public/style.css`)**: um `<canvas>` sobre o `<video id="preview">` com `SalaInk` (render) + `pen.js` (entrada). A função de coordenadas desconta o letterbox do vídeo (`object-fit: contain`).
- **Fluxo das mensagens**:
  - Traço feito na pré-via → enviado à TV pelo WebSocket (como hoje, `type: 'annotate'`) e ao processo principal (nova IPC `panel-ink`), que repassa à camada para aparecer na tela real.
  - Traço feito na camada → como hoje (`overlay-event` → painel → TV); o painel passa a desenhá-lo também na pré-via.
  - Ferramenta/cor/espessura (`op: 'tool'`) e cursor (`op: 'cursor'`) já chegam ao painel por `onAnnotate`; o painel aplica no `SalaInk` da pré-via. Cursor sobre a pré-via é enviado pelo painel.
  - Zoom por seleção feito na pré-via → `{ op: 'zoom', rect }` segue o mesmo caminho do zoom da camada.
- **`tools.js`**: aceita `panel-ink` (validando o remetente como o painel), checagem de primeiro plano do painel via koffi (`GetForegroundWindow` comparado ao HWND do painel), e `setContentProtection` no painel enquanto compartilha.

## Fase 2 — TV como 2º monitor

### Driver

- **Virtual Display Driver** (VirtualDrivers, licença MIT, assinado via SignPath; IddCx). Versão fixada e empacotada no app em `vdd/`, com a licença.
- **Controle pela configuração de vídeo do Windows, sem administrador** (o pipe não serve: ver "Teste de 2026-11-05"). O driver mantém sempre 1 monitor (`MONITOR\MTT1337`); o app o **conecta** à área de trabalho (estender, encostado na borda direita das telas conectadas, 1920×1080) e o **desconecta** com `ChangeDisplaySettingsExW` (`CDS_UPDATEREGISTRY`), localizando-o por `EnumDisplayDevicesW` (monitor cujo DeviceID contém `MTT1337`). Instalado = esse monitor existe.
- Configuração: `C:\VirtualDisplayDriver\vdd_settings.xml` com 1 resolução 1920×1080 @ 60 Hz, gravada por `vdd/install.ps1`; a instalação deve terminar com o monitor desconectado.
- Instalação **sob demanda**: o instalador do app não muda. No primeiro uso, o app executa o script de instalação silenciosa com elevação (UAC).

> **Teste de 2026-11-05 (PC do autor, Windows 11, driver 25.7.23):** a instalação com `vdd/install.ps1` (SetupAPI + `UpdateDriverForPlugAndPlayDevicesW`, sem ferramenta de terceiros) deu `OK`; o dispositivo `ROOT\DISPLAY\0000` "Virtual Display Driver" iniciou e o monitor virtual já apareceu **conectado**. Pipe: `PING` sem resposta; `SETDISPLAYCOUNT 0` grava 0 no XML, mas o driver recarrega com 1 monitor, ou seja, **não desliga**. `ChangeDisplaySettingsExW` desconecta e reconecta o monitor sem administrador; conectar leva menos de 2 s. A posição precisa encostar na borda direita (uma posição arbitrária deixou um vão de 1024 px).

### Fluxo do usuário

- Botão **"Usar a TV como 2º monitor"** (só no app Windows), junto ao "Compartilhar tela".
- **Driver ausente**: explicação curta ("Para a TV virar uma segunda tela, o Windows precisa de um monitor virtual (gratuito, código aberto). Vamos instalá-lo uma única vez; o Windows vai pedir permissão de administrador.") com "Instalar" / "Agora não" → UAC → "Instalando o monitor virtual…" → segue para o uso normal ou mostra o erro com opção de tentar de novo.
- **Uso normal**: liga o monitor virtual → transmite essa tela direto (sem seletor), com áudio → dica "Arraste janelas para a direita, além da borda da tela, ou use **Win+Shift+→**" → caixa de ferramentas na tela principal; camada de desenho na tela virtual. O botão grande vira "Parar transmissão"; parar desliga o monitor (o Windows devolve as janelas à tela principal).
- Fora desta versão: escolher a resolução do monitor virtual; mais de um monitor virtual.

### Componentes

- **`virtual-display.js`** (novo, processo principal): `isInstalled()`, `install()`, `on()`, `off()`.
  - `on()`: conecta o monitor virtual na borda direita, depois espera até 10 s por uma tela nova em `screen.getAllDisplays()`; devolve o `display_id`.
  - `off()`: desconecta o monitor virtual.
  - Chamadas Win32 via koffi (já usado em `tools.js`); a escolha da posição é uma função pura testável.
- **`desktop.js`**: IPC `virtual-display` (status/instalar/ligar/desligar); ao ligar, encontra em `desktopCapturer.getSources({ types: ['screen'] })` a fonte com esse `display_id` e a usa no `setDisplayMediaRequestHandler` sem abrir o seletor; `tools.setSource` com essa fonte (a camada já se posiciona sobre a tela compartilhada).
- **Painel**: botão, diálogo de instalação, dica de uso; reaproveita o fluxo de compartilhamento existente.
- **`vdd/`**: binários do driver, `LICENSE`, script de instalação silenciosa.

### Erros e segurança

| Situação | Comportamento |
|---|---|
| Monitor virtual não encontrado ou `ChangeDisplaySettingsExW` falha | "O monitor virtual não respondeu. Reinicie o computador ou reinstale." A transmissão normal continua disponível. |
| Tela nova não aparece em 10 s | Desconecta o monitor e avisa. |
| UAC recusado ou antivírus bloqueia a instalação | Mensagem clara; o botão continua oferecendo a instalação. |
| App abre com monitor virtual conectado (sessão anterior ou logo após instalar) | Desconecta na inicialização. |
| App fecha com monitor ligado | `off()` no `before-quit`. |

## Testes

Automáticos (`node --test`):

- Posição do monitor virtual (borda direita das telas conectadas, inclusive com telas em coordenadas negativas).
- `on()`: sucesso, tempo-limite e desligamento após falha (com `screen` falso).
- Conversão de coordenadas da pré-via com letterbox horizontal e vertical.
- `pen.js`: sequência de eventos → mensagens (`stroke-start`/`stroke-point`, `shape`, `erase`, `zoom`).

Manuais (no PC do autor, com o Kaspersky ativo): instalação do driver; ligar/desligar; arrastar janela para a TV; desenhar na pré-via e na tela da TV; compartilhar a tela principal e desenhar na pré-via; fechar o app com o monitor ligado.
