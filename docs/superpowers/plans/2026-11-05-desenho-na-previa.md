# Desenho na pré-via — plano de implementação (Fase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Durante a transmissão, o painel do app Windows mostra a pré-via grande e aceita as ferramentas de apresentação sobre ela, com o resultado aparecendo na tela real e na TV.

**Architecture:** A lógica de entrada de caneta sai de `public/overlay.js` para `public/pen.js` (reutilizável). O painel ganha um `<canvas>` sobre `#preview`, renderizado por `SalaInk` (com tamanho do elemento, não da janela) e alimentado por `SalaPen`. Traços do painel vão à TV pelo WebSocket e à camada pelo processo principal (`panel-ink`); traços da camada continuam indo ao painel e agora também são desenhados na pré-via. `tools.js` deixa a camada passar cliques ao painel quando ele está em primeiro plano sob o cursor e o exclui da captura durante a transmissão.

**Tech Stack:** Electron 45, Node 20+, `node:test` + `node:vm`, koffi (Win32), JavaScript ES5 nos arquivos de `public/` que rodam na TV.

**Spec:** `docs/superpowers/specs/2026-11-05-segundo-monitor-e-desenho-na-previa-design.md` (seção "Fase 1")

## Global Constraints

- Sem dependências novas no `package.json`.
- `public/ink.js` roda também nas TVs (Tizen 5.5+, webOS, Android 5.1): manter ES5 (sem `=>`, `let`, `class`, `?.`).
- Textos de interface em português do Brasil.
- Preloads com `sandbox: true` e `contextIsolation: true`; toda IPC valida o remetente (`event.sender === getPanel()?.webContents`), como as existentes.
- Mensagens de desenho: mesmos formatos que já existem (`stroke-start`, `stroke-point`, `shape`, `erase`, `selection`, `zoom`, `cursor`, `tool`), coordenadas normalizadas 0..1 da área compartilhada.
- `npm test` passa ao fim de cada tarefa.

## Review Focus

1. **Compartilhar a tela principal inteira com o painel nela** — desenhar na pré-via deve funcionar (a camada não pode engolir os cliques) e a TV não pode mostrar o painel. → Tarefa 4 (teste de `passThrough`) + verificação manual da Tarefa 5.
2. **Pré-via com faixas pretas (janela estreita ou 4:3)** — clicar na faixa preta não desenha; o traço cai no mesmo ponto na TV. → Tarefa 2 (`SalaPen.fit` + ponto fora retorna `null`).
3. **Painel redimensionado durante o desenho** — o canvas acompanha o tamanho da pré-via sem distorcer traços. → Tarefa 1 (`options.box`).
4. **Apontador/lupa/holofote com o mouse na pré-via enquanto se compartilha a tela principal** — a TV não pode alternar entre a posição real do mouse e a da pré-via. → Tarefa 4 (`pollCursor` não emite durante `passThrough`).
5. **Traço que começa na pré-via e sai dela** — termina normalmente (sem traço "preso"). → Tarefa 2 (teste de `pointerup` fora / `pointerleave`).

---

### Task 1: `SalaInk` com tamanho do elemento

**Files:**
- Modify: `public/ink.js:21-27` (função `resize`)
- Test: `tests/ink.test.js`

**Interfaces:**
- Produces: `SalaInk(canvas, frame, options)` aceita `options.box: function () -> { width, height }` (px CSS). Sem `box`, usa `innerWidth/innerHeight` como hoje. `draw()` limpa/pinta o quadro usando o mesmo tamanho. Novo método no retorno: `resize()` (recalcula o tamanho; o painel chama ao redimensionar).

- [ ] **Step 1: Write the failing test** — `test('ink com options.box usa o tamanho do elemento')`: `setup` com `options.box = () => ({ width: 640, height: 360 })` e `window.devicePixelRatio = 2`; após `ink.resize()`, `assert.equal(canvas.width, 1280); assert.equal(canvas.height, 720)`; e com `board` ativo, o `fillRect` registrado em `ctx` é `(0, 0, 640, 360)`.
- [ ] **Step 2: Run** `node --test tests/ink.test.js` — Expected: FAIL (`ink.resize is not a function` ou tamanho 1920).
- [ ] **Step 3: Implement** — `resize()` e `draw()` leem `var size = options.box ? options.box() : { width: root.innerWidth, height: root.innerHeight }`; exportar `resize` no objeto retornado. Manter o `addEventListener('resize')` existente do chamador.
- [ ] **Step 4: Run** `npm test` — Expected: todos passam.
- [ ] **Step 5: Commit** `git add public/ink.js tests/ink.test.js && git commit -m "SalaInk aceita tamanho do elemento (options.box)"`

### Task 2: `public/pen.js` — entrada de caneta reutilizável

**Files:**
- Create: `public/pen.js`
- Modify: `public/overlay.js` (passa a usar `SalaPen`), `public/overlay.html` (inclui `pen.js` antes de `overlay.js`)
- Test: `tests/pen.test.js`

**Interfaces:**
- Produces (global `SalaPen`, ES5):
  - `SalaPen(target, options) -> { setTool(msg) }`. `options.point(event) -> { x, y } | null` (null = fora da área; ignora o evento), `options.emit(msg)` (desenho que vai para os outros lados), `options.local(msg)` (só para quem desenha: `selection`), `options.zoom(rect)`.
  - Registra `pointerdown`/`pointermove`/`pointerup`/`pointerleave` em `target`. Comportamento idêntico ao `overlay.js` atual: caneta/marca-texto/laser → `stroke-start` + `stroke-point`; `shape` → `shape` com `kind/color/size` de `setTool`; borracha → `erase` (recebe `options.hit(x, y) -> id|null`); `select` → `local({op:'selection'})` e, ao soltar com `w > 0.02 && h > 0.02`, `zoom(rect)`. Ids: `Date.now() * 1000 + (++n % 1000)`.
  - `SalaPen.fit(boxW, boxH, contentW, contentH) -> { x, y, w, h }`: retângulo do conteúdo com `object-fit: contain` dentro da caixa (para a pré-via).

- [ ] **Step 1: Write the failing tests** (`tests/pen.test.js`, carregando `public/pen.js` via `vm` como em `ink.test.js`, com um `target` falso que guarda os listeners):
  - `caneta: down/move/up geram stroke-start e stroke-point com a cor e espessura da ferramenta` — `setTool({op:'tool', tool:'pen', color:'#ff3b30', size:'m'})`, eventos em (0.1,0.1)→(0.2,0.2); `emit` recebe `stroke-start` com `tool:'pen', color:'#ff3b30', size:'m', x:0.1, y:0.1` e depois `stroke-point` com o mesmo `id`.
  - `ponto fora da área (point devolve null) não começa traço`.
  - `pointerleave encerra o traço: move posterior não emite`.
  - `seleção: local recebe selection; soltar com 0.3x0.3 chama zoom; 0.01x0.01 não chama`.
  - `fit: caixa 640x360 com conteúdo 4:3 → { x: 80, y: 0, w: 480, h: 360 }`; `caixa 640x480 com conteúdo 16:9 → { x: 0, y: 60, w: 640, h: 360 }`.
- [ ] **Step 2: Run** `node --test tests/pen.test.js` — Expected: FAIL (`SalaPen is not defined`).
- [ ] **Step 3: Implement `public/pen.js`** movendo a lógica de `overlay.js:5-40`; `overlay.js` passa a `SalaPen(window, { point: e => ({ x: e.clientX / innerWidth, y: e.clientY / innerHeight }), emit, local: ink.handle, zoom: rect => salaOverlay.send({ op:'zoom', rect }), hit: ink.hit })` e a chamar `pen.setTool(msg)` em `op === 'tool'` (mantendo a troca de `body.className`).
- [ ] **Step 4: Run** `npm test` — Expected: todos passam.
- [ ] **Step 5: Commit** `git add public/pen.js public/overlay.js public/overlay.html tests/pen.test.js && git commit -m "Entrada de caneta extraída para pen.js"`

### Task 3: Painel — pré-via grande com desenho

**Files:**
- Modify: `public/index.html` (bloco `#live`), `public/style.css`, `public/app.js` (trecho do painel `desktop`), `desktop-preload.js`
- Test: verificação manual (o painel depende de Electron/getDisplayMedia)

**Interfaces:**
- Consumes: `SalaInk(..., { box, video })` e `resize()` (Task 1); `SalaPen`, `SalaPen.fit` (Task 2).
- Produces: `window.salaDesktop.ink(msg)` → `ipcRenderer.send('panel-ink', msg)` (usado pela Task 4).

- [ ] **Step 1: HTML/CSS** — `#live` vira coluna: `<div class="stage"><video id="preview" …></video><canvas id="previewInk"></canvas></div>` com largura 100% e `aspect-ratio: 16/9`; canvas `position:absolute; inset:0`; `cursor: crosshair` quando houver ferramenta de captura (classe `draw` no `.stage`), `cell` para borracha. Interruptores numa linha abaixo (`.live-actions` em `flex-direction: row`, quebrando em telas estreitas). `index.html` inclui `<script src="/ink.js"></script><script src="/pen.js"></script>` antes de `app.js`.
- [ ] **Step 2: app.js** — só quando `desktop` existe:
  - `frame` da pré-via: `SalaPen.fit(stage.clientWidth, stage.clientHeight, preview.videoWidth || 16, preview.videoHeight || 9)`.
  - `previewInk = SalaInk(canvas, frame, { box: () => ({ width: stage.clientWidth, height: stage.clientHeight }), video: preview, pointer: true })`; `resize()` em `ResizeObserver` do `.stage` e em `preview.onresize`.
  - `SalaPen(canvas, { point: e => normalizado por frame() ou null fora, emit: msg => { previewInk.handle(msg); send(Object.assign({ type: 'annotate' }, msg)); desktop.ink(msg); }, local: previewInk.handle, zoom: rect => { send({ type:'annotate', op:'zoom', rect }); desktop.ink({ op:'zoom', rect }); }, hit: previewInk.hit })`.
  - Em `desktop.onAnnotate`: toda mensagem de desenho/`tool`/`clear`/`undo`/`board`/`cursor` também vai para `previewInk.handle(msg)`; `op === 'tool'` também chama `pen.setTool(msg)` e ajusta a classe do `.stage`.
  - Ferramentas de cursor (`pointer`, `magnifier`, `spotlight`): `pointermove` no canvas envia `{ op:'cursor', x, y }` (TV + `previewInk`); `pointerleave` envia `{ op:'cursor', x:null, y:null }`.
  - `stop()` limpa a pré-via: `previewInk.handle({ op: 'reset' })`.
- [ ] **Step 3: preload** — adicionar `ink: msg => ipcRenderer.send('panel-ink', msg)` em `desktop-preload.js`.
- [ ] **Step 4: Run** `npm test` — Expected: todos passam (nada do receptor da TV muda).
- [ ] **Step 5: Commit** `git add public/index.html public/style.css public/app.js desktop-preload.js && git commit -m "Painel: pré-via grande com desenho"`

### Task 4: Processo principal — `panel-ink`, cliques para o painel e painel fora da captura

**Files:**
- Create: `pass-through.js`
- Modify: `tools.js` (o painel já chega por `getPanel`), `package.json` (`build.files`)
- Test: `tests/tools.test.js` (novo, só para a função pura)

**Interfaces:**
- Consumes: IPC `panel-ink` (Task 3).
- Produces: `passThrough(cursor, panelBounds, panelIsForeground) -> boolean` exportada de `tools.js` (`module.exports = { createTools, passThrough }`): `true` se `panelIsForeground` e `cursor` dentro de `panelBounds` (bordas inclusivas).

- [ ] **Step 1: Write the failing test** — `tests/tools.test.js` não pode carregar Electron: mover `passThrough` para `pass-through.js` (CommonJS, sem Electron) e `tools.js` importa de lá. Casos: dentro + primeiro plano → `true`; dentro + não primeiro plano → `false`; fora + primeiro plano → `false`; na borda `x === bounds.x + bounds.width` → `true`.
- [ ] **Step 2: Run** `node --test tests/tools.test.js` — Expected: FAIL (módulo inexistente).
- [ ] **Step 3: Implement**
  - `pass-through.js` com `passThrough`.
  - `tools.js`: `GetForegroundWindow` via koffi (mesmo bloco de `windowRect`; sem koffi → `() => 0`). HWND do painel: `getPanel().getNativeWindowHandle()` lido como inteiro (`readBigUInt64LE(0)` → `Number`).
  - No `pollCursor` (já roda a cada 33 ms para ferramentas de cursor) **e** num timer de 33 ms enquanto houver ferramenta de captura: calcular `inside = passThrough(cursor, panel.getBounds(), foreground === panelHwnd)`; se `inside`, `overlay.setIgnoreMouseEvents(true, { forward: true })` e `pollCursor` não emite; ao sair, restaurar `setIgnoreMouseEvents(!CAPTURE_TOOLS.includes(tool), { forward: true })` (só quando o estado muda).
  - `ipcMain.on('panel-ink', …)`: valida remetente e `typeof msg.op === 'string'`; `zoom` → mesmo caminho do `overlay-event` (`toPanel` não; marca `zoomed = true` e `setTool(null)`); demais (`stroke-start`, `stroke-point`, `shape`, `erase`, `cursor`) → `toOverlay(msg)`.
  - `setSource(next)` chama `getPanel()?.setContentProtection(true)`; `ipcMain.on('sharing', … active false)` chama `setContentProtection(false)`.
- [ ] **Step 4: Run** `npm test` — Expected: todos passam.
- [ ] **Step 5: Commit** `git add pass-through.js tools.js desktop.js tests/tools.test.js package.json && git commit -m "Camada deixa cliques passarem ao painel; painel fora da captura"` (incluir `pass-through.js` em `build.files` do `package.json`).

### Task 5: Build, reinstalação e verificação manual

**Files:** nenhum novo.

- [ ] **Step 1:** `npm test` — todos passam.
- [ ] **Step 2:** fechar o app, `npm run build:installer`, instalar `dist/M I.A. Shared View Setup 1.2.0.exe /S`, abrir `%LOCALAPPDATA%\Programs\Sala TV\Sala TV.exe` (sem `ELECTRON_RUN_AS_NODE`). A TV não muda nesta fase (só `ink.js`, compatível); atualizar o `.wgt` apenas se `public/ink.js` mudou de forma que afete a TV — mudou (Task 1), então reinstalar o receptor como na sessão anterior (`prepare:tv`, `data-server` temporário, `sdb push` + `vd_appinstall`, reverter `tv/index.html`).
- [ ] **Step 3: Verificação manual** (anotar o resultado de cada uma):
  1. Compartilhar uma **janela**; caneta na pré-via → traço na TV e sobre a janela real, no mesmo ponto.
  2. Compartilhar a **tela principal inteira** (painel nela); clicar no painel e desenhar na pré-via → funciona; a TV não mostra o painel.
  3. Janela estreita (faixas pretas na pré-via): clicar na faixa não desenha.
  4. Apontador e lupa sobre a pré-via → aparecem na TV sem "pular".
  5. Zoom por seleção na pré-via → TV dá zoom; `Esc` desfaz.
  6. Redimensionar o painel com traços → traços acompanham.
- [ ] **Step 4: Commit** (só se houve ajuste) e relatar os resultados.
