# TV como 2º monitor — plano de implementação (Fase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um botão "Usar a TV como 2º monitor" no app Windows que instala sob demanda o Virtual Display Driver, conecta um monitor virtual 1920×1080 à direita da área de trabalho e o transmite para a TV sem o seletor; parar desconecta o monitor.

**Architecture:** O driver (já empacotado em `vdd/driver/`, instalado por `vdd/install.ps1` com elevação) mantém sempre 1 monitor (`MTT1337`). O app o conecta/desconecta pela configuração de vídeo do Windows (`EnumDisplayDevicesW` / `EnumDisplaySettingsW` / `ChangeDisplaySettingsExW` via koffi), sem administrador. `virtual-display.js` orquestra (instalado? ligar e esperar a tela, desligar), com as chamadas Win32 isoladas em `win-display.js` e a posição calculada por uma função pura. `desktop.js` expõe IPC e, com um monitor virtual pedido, entrega essa tela ao `getDisplayMedia` sem abrir o seletor.

**Tech Stack:** Electron 45, Node 20+, koffi, PowerShell 5.1 (instalação), `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-05-segundo-monitor-e-desenho-na-previa-design.md` (seção "Fase 2", com o "Teste de 2026-11-05")

## Global Constraints

- Driver fixado: Virtual Display Driver **25.7.23** (`VirtualDisplayDriver-x86.Driver.Only.zip`, SHA-256 `e24210692b442b39af763536330ce78b423f19342b7a7792c26de3944e418b3a`), arquivos `MttVDD.inf`, `MttVDD.dll`, `mttvdd.cat` com assinatura válida da SignPath Foundation, mais a `LICENSE` MIT do projeto.
- ID de hardware `Root\MttVDD`; monitor identificado pelo DeviceID contendo `MTT1337`.
- Monitor virtual: **1920×1080**, conectado **encostado na borda direita** das telas conectadas.
- Sem dependências npm novas. Sem ferramentas de terceiros na instalação (nada de nefcon/devcon).
- Textos de interface em português; os do spec são literais:
  - Botão: `Usar a TV como 2º monitor`
  - Instalação: `Para a TV virar uma segunda tela, o Windows precisa de um monitor virtual (gratuito, código aberto). Vamos instalá-lo uma única vez; o Windows vai pedir permissão de administrador.` com `Instalar` / `Agora não`; durante: `Instalando o monitor virtual…`
  - Dica: `Arraste janelas para a direita, além da borda da tela, ou use Win+Shift+→`
  - Erro do monitor: `O monitor virtual não respondeu. Reinicie o computador ou reinstale.`
- Tempo-limite para a tela nova aparecer: **10 s**.
- Arquivos do driver e o script vão em `extraResources` (fora do `app.asar`), pois o PowerShell elevado não lê o asar.

## Review Focus

1. **Várias telas, inclusive à esquerda/acima da principal (coordenadas negativas)** — o monitor virtual encosta na borda direita da tela mais à direita, sem vão. → Tarefa 1 (`rightEdge` com telas negativas).
2. **App fechado à força com o monitor conectado** — ao abrir de novo, o monitor é desconectado antes de qualquer outra coisa. → Tarefa 2 (`disconnectAtStartup`) e Tarefa 4 (chamada na inicialização).
3. **UAC recusado ou antivírus bloqueando a instalação** — mensagem clara, botão continua oferecendo instalar, compartilhamento normal intacto. → Tarefa 3 (código de saída ≠ 0 vira `{ ok:false, message }`).
4. **Tela nova não aparece (driver travado)** — após 10 s, desconecta e avisa. → Tarefa 2 (teste de tempo-limite).
5. **Seletor pulado só no pedido do 2º monitor** — o próximo "Compartilhar tela" comum volta a abrir o seletor; o reaproveitamento de `lastChoice` (nova tentativa sem áudio) continua funcionando. → Tarefa 4 (estado `virtualSource` consumido uma vez).

---

### Task 1: Posição do monitor virtual (função pura)

**Files:**
- Create: `display-position.js`
- Test: `tests/display-position.test.js`

**Interfaces:**
- Produces: `rightEdge(attached) -> { x, y }` — `attached`: telas conectadas **exceto** a virtual, `{ x, y, width, height }` em pixels físicos. `x` = maior `x + width`; `y` = `y` da tela cuja borda direita é a maior (empate: a de menor `y`). Lista vazia → `{ x: 0, y: 0 }`.

- [ ] **Step 1: Write the failing tests** — `uma tela 4096x1152 em (0,0) → { x: 4096, y: 0 }`; `principal (0,0,1920,1080) + tela à esquerda (-1280,-200,1280,1024) → { x: 1920, y: 0 }`; `principal + tela à direita (1920,-100,2560,1440) → { x: 4480, y: -100 }`; `lista vazia → { x: 0, y: 0 }`.
- [ ] **Step 2: Run** `node --test tests/display-position.test.js` — Expected: FAIL (módulo inexistente).
- [ ] **Step 3: Implement** `rightEdge` em `display-position.js`.
- [ ] **Step 4: Run** `npm test` — Expected: todos passam.
- [ ] **Step 5: Commit** `git add display-position.js tests/display-position.test.js && git commit -m "Posição do monitor virtual na borda direita"`

### Task 2: `virtual-display.js` — ligar, esperar a tela, desligar

**Files:**
- Create: `win-display.js` (koffi; sem testes automáticos — é a fronteira com o Windows), `virtual-display.js`
- Test: `tests/virtual-display.test.js`

**Interfaces:**
- `win-display.js` produz (todas síncronas, pixels físicos):
  - `findVirtual() -> { deviceName: string, attached: boolean } | null` — percorre `EnumDisplayDevicesW(null, i)` e, para cada adaptador, `EnumDisplayDevicesW(deviceName, 0)`; acha o monitor com `DeviceID` contendo `MTT1337`.
  - `attachedBounds(exceptDeviceName) -> [{ x, y, width, height }]` — `EnumDisplaySettingsW(dev, ENUM_CURRENT_SETTINGS = -1)` dos adaptadores com `StateFlags & 1`.
  - `setVirtual(deviceName, bounds | null) -> number` — `ChangeDisplaySettingsExW(dev, DEVMODE{ dmFields: DM_POSITION|DM_PELSWIDTH|DM_PELSHEIGHT = 0x20|0x80000|0x100000 }, 0, CDS_UPDATEREGISTRY|CDS_NORESET = 1|0x10000000)` seguido de `ChangeDisplaySettingsExW(null, null, 0, 0)`; `null` = desconectar (largura/altura 0). Devolve o primeiro código ≠ 0, ou 0.
  - Sem koffi ou fora do Windows: `findVirtual` devolve `null` (o resto não é chamado).
  - O `DEVMODE`/`DISPLAY_DEVICE` seguem o layout validado no teste manual (`DISPLAY_DEVICE.cb = 840`; `DEVMODE` com `dmPositionX/Y` logo após `dmFields`).
- `virtual-display.js` produz `createVirtualDisplay({ win, screen, wait = ms => new Promise(r => setTimeout(r, ms)), timeoutMs = 10000 })` com:
  - `isInstalled() -> boolean` (`win.findVirtual() !== null`).
  - `on() -> Promise<number>` — conecta em `rightEdge(win.attachedBounds(dev))` com 1920×1080; consulta `screen.getAllDisplays()` a cada 250 ms até surgir um id que não existia antes; devolve esse `display.id`. Falha de `setVirtual` ≠ 0, monitor ausente ou tempo-limite → chama `off()` e rejeita com `Error('O monitor virtual não respondeu. Reinicie o computador ou reinstale.')`.
  - `off() -> boolean` — desconecta se estiver conectado; `true` se havia algo a desconectar.
  - `disconnectAtStartup()` — igual a `off()`, ignorando erros.

- [ ] **Step 1: Write the failing tests** (`win` e `screen` falsos):
  - `on: conecta na borda direita e devolve o id da tela nova` — `win.attachedBounds` → `[{x:0,y:0,width:4096,height:1152}]`; `setVirtual` recebe `{ x: 4096, y: 0, width: 1920, height: 1080 }`; `screen` passa a listar o id `99` na segunda consulta; resultado `99`.
  - `on: tela não aparece em 10 s → desconecta e rejeita com a mensagem do spec` (`wait` falso que avança um relógio; `timeoutMs` 10000); `setVirtual` chamado por último com `null`.
  - `on: setVirtual devolve -1 → rejeita e desconecta`.
  - `off: só desconecta se estiver conectado` (`attached:false` → `setVirtual` não é chamado, retorna `false`).
  - `isInstalled: false quando findVirtual devolve null`.
- [ ] **Step 2: Run** `node --test tests/virtual-display.test.js` — Expected: FAIL (módulo inexistente).
- [ ] **Step 3: Implement** `virtual-display.js` (usa `rightEdge` da Tarefa 1) e `win-display.js`.
- [ ] **Step 4: Run** `npm test` — Expected: todos passam. **Verificação real** (Windows): `node -e "const v=require('./virtual-display').createVirtualDisplay({win:require('./win-display'),screen:{getAllDisplays:()=>[]}});console.log(v.isInstalled())"` → `true`; e um script de ida e volta `win.setVirtual(dev,{...rightEdge})` / `win.setVirtual(dev,null)` confirmando por `[System.Windows.Forms.Screen]::AllScreens` num processo novo que a tela aparece encostada e depois some.
- [ ] **Step 5: Commit** `git add win-display.js virtual-display.js tests/virtual-display.test.js && git commit -m "Monitor virtual: ligar, esperar a tela e desligar"`

### Task 3: Instalação sob demanda (driver empacotado + elevação)

**Files:**
- Create: `vdd/driver/MttVDD.inf`, `vdd/driver/MttVDD.dll`, `vdd/driver/mttvdd.cat` (do zip fixado), `vdd/driver/LICENSE` (MIT do projeto VirtualDrivers), `vdd-install.js`
- Modify: `package.json` (`build.extraResources: [{ "from": "vdd", "to": "vdd" }]`), `.gitignore` não muda
- Test: `tests/vdd-install.test.js`

**Interfaces:**
- Produces: `elevatedArgs(scriptPath, driverDir) -> string[]` — argumentos para `spawn('powershell.exe', args)` que executam `Start-Process powershell -Verb RunAs -Wait -PassThru` com `-ExecutionPolicy Bypass -File <script> -DriverDir <dir>` e terminam com `exit $p.ExitCode`. Caminhos com espaço e apóstrofo são citados com aspas simples dobradas (`'` → `''`).
- Produces: `install({ resources }) -> Promise<{ ok: boolean, message?: string }>` — `resources` = `app.isPackaged ? process.resourcesPath : __dirname`; script `vdd/install.ps1`, driver `vdd/driver`. Saída 0 → `{ ok: true }`; qualquer outra (inclusive UAC recusado, que faz o `Start-Process` falhar) → `{ ok: false, message: 'A instalação não foi concluída. Se o Windows pediu permissão, é preciso aceitar; se um antivírus bloqueou, libere o M I.A. Shared View e tente de novo.' }`.

- [ ] **Step 1: Write the failing tests** — `elevatedArgs` com `C:\Program Files\M I.A. Shared View\resources\vdd\install.ps1` e um caminho com `O'Brien` produz um comando que contém `-Verb RunAs`, `-Wait`, `exit $p.ExitCode` e `'C:\Users\O''Brien\…'`; `install` com `spawn` falso que sai com 1 → `ok:false` e a mensagem acima; com 0 → `ok:true`.
- [ ] **Step 2: Run** `node --test tests/vdd-install.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `vdd-install.js` (injetar `spawn` para o teste); copiar os 3 arquivos do driver do zip verificado (conferir SHA-256 do zip e `Get-AuthenticodeSignature` = `Valid` antes de copiar) e a `LICENSE`; `extraResources` no `package.json`.
- [ ] **Step 4: Run** `npm test` — Expected: todos passam.
- [ ] **Step 5: Commit** `git add vdd vdd-install.js tests/vdd-install.test.js package.json && git commit -m "Instalação sob demanda do monitor virtual"`

### Task 4: `desktop.js` — IPC, compartilhar sem seletor, desligar na saída

**Files:**
- Modify: `desktop.js`, `desktop-preload.js`

**Interfaces:**
- Consumes: `createVirtualDisplay` (Tarefa 2) com `win: require('./win-display')`, `screen` do Electron; `install` (Tarefa 3).
- Produces (preload `window.salaDesktop.vdd`): `status() -> Promise<{ installed }>`, `install() -> Promise<{ ok, message? }>`, `on() -> Promise<{ ok, message? }>`, `off() -> void`. IPC: `vdd-status`, `vdd-install`, `vdd-on` (handle, validam `event.sender === window.webContents`), `vdd-off` (send).

- [ ] **Step 1:** Na inicialização (`app.whenReady`), `virtual.disconnectAtStartup()`; em `before-quit`, `virtual.off()`.
- [ ] **Step 2:** `vdd-on`: `displayId = await virtual.on()`; procurar em `desktopCapturer.getSources({ types: ['screen'] })` a fonte com `String(display_id) === String(displayId)`; guardar em `virtualSource` e responder `{ ok:true }`; erro → `{ ok:false, message: error.message }`.
- [ ] **Step 3:** No `setDisplayMediaRequestHandler`, antes do seletor: se houver `virtualSource`, consumi-lo (zerar), `tools.setSource(source)` e `callback({ video: source, audio: 'loopback' })` (ou só vídeo quando `!request.audioRequested`); manter `lastChoice = { source, time }` para a nova tentativa sem áudio.
- [ ] **Step 4:** `vdd-off`: `virtual.off()`.
- [ ] **Step 5: Run** `npm test` e `node --check desktop.js` — Expected: passam.
- [ ] **Step 6: Commit** `git add desktop.js desktop-preload.js && git commit -m "Monitor virtual: IPC, compartilhar sem seletor e desligar ao sair"`

### Task 5: Painel — botão, instalação, dica e parada

**Files:**
- Modify: `public/index.html`, `public/style.css`, `public/app.js` (bloco do painel, só com `desktop`)

**Interfaces:**
- Consumes: `window.salaDesktop.vdd` (Tarefa 4).

- [ ] **Step 1: HTML** — abaixo de `#share`: `<button id="extend" class="secondary extend" hidden>Usar a TV como 2º monitor</button>`; um bloco `#vddSetup` (oculto) com o texto de instalação do spec e os botões `#vddInstall` "Instalar" / `#vddLater` "Agora não"; em `#live`, `<p id="extendTip" hidden>` com a dica do spec (o `→` em `<b>Win+Shift+→</b>`).
- [ ] **Step 2: app.js** — extrair o corpo de `$('share').onclick` para `startShare()` (o botão continua: com `stream` → `stopShare()`, senão `startShare()`). `#extend`: `status = await vdd.status()`; não instalado → mostra `#vddSetup`; `Instalar` → status `Instalando o monitor virtual…`, `await vdd.install()`, erro → mensagem e mantém o bloco; ok → segue. Depois `await vdd.on()`; erro → mensagem do spec; ok → `virtualMode = true`, `#extendTip` visível, `await startShare()`. `stop()` (já chamado em toda parada): se `virtualMode`, `vdd.off()`, `virtualMode = false`, esconde a dica. `#extend` só aparece com `desktop` e fica oculto durante a transmissão.
- [ ] **Step 3: CSS** — `.extend` largura total abaixo do botão principal; `#vddSetup` como cartão (`#141d2c`, borda `#29364b`); no modo mini, `#extendTip` oculto.
- [ ] **Step 4: Run** `npm test` — Expected: todos passam.
- [ ] **Step 5: Commit** `git add public/index.html public/style.css public/app.js && git commit -m "Painel: botão Usar a TV como 2º monitor"`

### Task 6: Build, reinstalação e verificação manual

- [ ] **Step 1:** `npm test`; fechar o app; `npm run build:installer`; conferir que `dist/win-unpacked/resources/vdd/install.ps1` e `resources/vdd/driver/MttVDD.inf` existem; instalar com `/S` e abrir (sem `ELECTRON_RUN_AS_NODE`).
- [ ] **Step 2: Verificação manual** (driver já instalado neste PC):
  1. "Usar a TV como 2º monitor" → TV mostra uma área de trabalho vazia; Configurações de Vídeo mostram 2 telas, a nova encostada à direita.
  2. Arrastar o navegador para a direita → aparece na TV; som vai junto.
  3. Caneta e holofote na tela da TV (mouse à direita) e na pré-via.
  4. Parar → a tela some; as janelas voltam para a principal.
  5. Abrir o app, ligar o 2º monitor e fechar o app pelo Gerenciador de Tarefas → ao abrir de novo, a tela some sozinha.
  6. "Compartilhar tela" comum → o seletor abre normalmente.
- [ ] **Step 3:** relatar o resultado de cada item.
