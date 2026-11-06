// Ferramentas de apresentação: camada transparente sobre a tela/janela compartilhada.
// Os eventos saem em coordenadas normalizadas da área capturada; o painel os repassa para a TV.
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, screen, globalShortcut, ipcMain } = require('electron');
const CAPTURE_TOOLS = ['pen', 'highlighter', 'laser', 'shape', 'eraser', 'select'];
const CURSOR_TOOLS = ['pointer', 'magnifier', 'spotlight'];
const COLOR_TOOLS = ['pen', 'highlighter', 'laser', 'shape'];
const TOOLS = [...CAPTURE_TOOLS, ...CURSOR_TOOLS];
const SHORTCUTS = { 1: 'pointer', 2: 'pen', 3: 'highlighter', 4: 'magnifier', 5: 'select', 6: 'laser', 7: 'shape', 8: 'eraser', 9: 'spotlight' };
const DEFAULT_SETTINGS = { color: { pen: '#ff3b30', highlighter: '#ffd60a', laser: '#ff3b30', shape: '#ff3b30' }, size: 'm', shape: 'arrow' };
const TOOLBAR_WIDTH = 880, TOOLBAR_HEIGHT = 52, TOOLBAR_OPTIONS_HEIGHT = 96;
const { topWindowAt, toOverlayFromPanel } = require('./pass-through');

// Retângulo de uma janela de outro app (desktopCapturer só dá o HWND). Em pixels físicos.
// Janelas de nível superior na ordem de empilhamento (a primeira está na frente), também em pixels físicos.
let windowRect = () => null, windowsInZOrder = function* () {};
try {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll'), dwmapi = koffi.load('dwmapi.dll');
  const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
  const GetTopWindow = user32.func('intptr __stdcall GetTopWindow(intptr hwnd)');
  const GetWindow = user32.func('intptr __stdcall GetWindow(intptr hwnd, uint32 cmd)');
  const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(intptr hwnd)');
  const GetWindowRect = user32.func('bool __stdcall GetWindowRect(intptr hwnd, _Out_ RECT *rect)');
  const DwmGetCloaked = dwmapi.func('DwmGetWindowAttribute', 'long', ['intptr', 'uint32', koffi.out(koffi.pointer('uint32')), 'uint32']);
  const GetWindowLongPtrW = user32.func('intptr __stdcall GetWindowLongPtrW(intptr hwnd, int index)');
  const GW_HWNDNEXT = 2, DWMWA_CLOAKED = 14, GWL_EXSTYLE = -20, WS_EX_TRANSPARENT = 0x20;
  windowsInZOrder = function* () {
    for (let hwnd = GetTopWindow(0), n = 0; hwnd && n < 2000; hwnd = GetWindow(hwnd, GW_HWNDNEXT), n++) {
      const visible = IsWindowVisible(hwnd), r = {}, cloaked = [0];
      if (!visible || !GetWindowRect(hwnd, r)) { yield { hwnd: Number(hwnd), visible: false }; continue; }
      DwmGetCloaked(hwnd, DWMWA_CLOAKED, cloaked, 4);
      yield { hwnd: Number(hwnd), visible, cloaked: cloaked[0] !== 0, clickThrough: (Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) & WS_EX_TRANSPARENT) !== 0, rect: { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top } };
    }
  };
  const IsWindow = user32.func('bool __stdcall IsWindow(intptr hwnd)');
  const IsIconic = user32.func('bool __stdcall IsIconic(intptr hwnd)');
  const DwmGetWindowAttribute = dwmapi.func('long __stdcall DwmGetWindowAttribute(intptr hwnd, uint32 attr, _Out_ RECT *rect, uint32 size)');
  const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
  windowRect = hwnd => {
    if (!IsWindow(hwnd) || IsIconic(hwnd)) return null;
    const r = {};
    if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, r, koffi.sizeof(RECT)) !== 0) return null;
    return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
  };
} catch (_) {}

function createTools(getPanel) {
  let source = null, tool = null, zoomed = false, area = null, overlay = null, toolbar = null, cursorTimer = null, areaTimer = null, lastCursor = '';
  let sharingSince = null, board = null, frozen = false, black = false, muted = false;
  // Preferências da caixa (posição, cores, espessura, forma) lembradas neste computador.
  const prefsFile = path.join(app.getPath('userData'), 'toolbar.json');
  let prefs = {};
  try { prefs = JSON.parse(fs.readFileSync(prefsFile, 'utf8')); } catch (_) {}
  const settings = { ...DEFAULT_SETTINGS, ...prefs.settings, color: { ...DEFAULT_SETTINGS.color, ...prefs.settings?.color } };
  const savePrefs = () => fs.writeFile(prefsFile, JSON.stringify(prefs), () => {});

  const toPanel = msg => getPanel()?.webContents.send('annotate', msg);
  const toOverlay = msg => { if (overlay && !overlay.isDestroyed()) overlay.webContents.send('annotate', msg); };
  const emit = msg => { toPanel(msg); toOverlay(msg); };
  const toolMessage = () => ({ op: 'tool', tool, color: settings.color[tool], size: settings.size, shape: settings.shape });
  const hasOptions = () => COLOR_TOOLS.includes(tool);
  function toolbarState() {
    if (!toolbar || toolbar.isDestroyed()) return;
    toolbar.setContentSize(TOOLBAR_WIDTH, hasOptions() ? TOOLBAR_OPTIONS_HEIGHT : TOOLBAR_HEIGHT);
    toolbar.webContents.send('toolbar-state', { tool, sharing: !!source, sharingSince, settings, board, frozen, black, muted });
  }

  // Caixa flutuante: fica acima de tudo (inclusive da camada de desenho), fora da captura e sem roubar o foco do app.
  function showToolbar(visible) {
    if (!visible) { if (toolbar && !toolbar.isDestroyed()) toolbar.destroy(); toolbar = null; return; }
    if (toolbar && !toolbar.isDestroyed()) return toolbar.showInactive();
    const saved = prefs.position, work = screen.getPrimaryDisplay().workArea;
    const onScreen = saved && screen.getAllDisplays().some(d => saved.x >= d.workArea.x && saved.y >= d.workArea.y && saved.x + 40 <= d.workArea.x + d.workArea.width && saved.y + 40 <= d.workArea.y + d.workArea.height);
    toolbar = new BrowserWindow({
      width: TOOLBAR_WIDTH, height: TOOLBAR_HEIGHT, x: onScreen ? saved.x : Math.round(work.x + (work.width - TOOLBAR_WIDTH) / 2), y: onScreen ? saved.y : work.y + 16,
      useContentSize: true, transparent: true, frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, focusable: false, hasShadow: false, show: false, alwaysOnTop: true,
      webPreferences: { preload: path.join(__dirname, 'toolbar-preload.js'), sandbox: true, contextIsolation: true }
    });
    toolbar.setAlwaysOnTop(true, 'screen-saver', 1);
    toolbar.setContentProtection(true);
    toolbar.on('moved', () => { const [x, y] = toolbar.getPosition(); prefs.position = { x, y }; savePrefs(); });
    toolbar.webContents.on('did-finish-load', () => { toolbarState(); toolbar.showInactive(); });
    toolbar.loadFile(path.join(__dirname, 'public', 'toolbar.html'));
  }

  function ensureOverlay() {
    if (overlay && !overlay.isDestroyed()) return overlay;
    overlay = new BrowserWindow({
      transparent: true, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
      skipTaskbar: true, focusable: false, hasShadow: false, show: false, alwaysOnTop: true,
      webPreferences: { preload: path.join(__dirname, 'overlay-preload.js'), sandbox: true, contextIsolation: true }
    });
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setContentProtection(true); // fora da captura: a TV desenha as anotações por cima do vídeo
    overlay.webContents.on('did-finish-load', () => { toOverlay(toolMessage()); if (board) toOverlay({ op: 'board', mode: board }); });
    overlay.loadFile(path.join(__dirname, 'public', 'overlay.html'));
    return overlay;
  }
  function updateArea() {
    if (!source || !overlay || overlay.isDestroyed()) return;
    let next = null;
    if (source.id.startsWith('screen:')) {
      next = (screen.getAllDisplays().find(d => String(d.id) === String(source.display_id)) || screen.getPrimaryDisplay()).bounds;
    } else {
      const rect = windowRect(Number(source.id.split(':')[1]));
      if (rect) next = screen.screenToDipRect(null, rect);
    }
    area = next;
    if (!area) return overlay.hide();
    overlay.setBounds(area);
    if (!overlay.isVisible()) { overlay.showInactive(); if (toolbar && !toolbar.isDestroyed()) toolbar.moveTop(); }
  }
  // Painel visível sob o cursor: a camada deixa os cliques passarem (desenho na pré-via) e o cursor real não vai à TV.
  let passing = false, passTimer = null;
  const hwndOf = win => { if (!win || win.isDestroyed()) return -1; const h = win.getNativeWindowHandle(); return Number(h.length >= 8 ? h.readBigUInt64LE(0) : h.readUInt32LE(0)); };
  function applyMouse() { if (overlay && !overlay.isDestroyed()) overlay.setIgnoreMouseEvents(passing || !CAPTURE_TOOLS.includes(tool), { forward: true }); }
  function checkPass() {
    const panel = getPanel();
    const ours = [hwndOf(overlay), hwndOf(toolbar)], point = screen.dipToScreenPoint(screen.getCursorScreenPoint());
    const next = !!panel && !panel.isDestroyed() && !panel.isMinimized() && topWindowAt(point, windowsInZOrder(), ours) === hwndOf(panel);
    if (next !== passing) { passing = next; applyMouse(); }
  }
  function pollCursor() {
    checkPass(); // mesma leitura do painel antes de mandar o cursor real à TV
    if (!area || passing) return;
    const p = screen.getCursorScreenPoint();
    const x = (p.x - area.x) / area.width, y = (p.y - area.y) / area.height;
    const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
    const key = inside ? `${x.toFixed(4)},${y.toFixed(4)}` : 'out';
    if (key === lastCursor) return;
    lastCursor = key;
    emit(inside ? { op: 'cursor', x, y } : { op: 'cursor', x: null, y: null });
  }
  function setEscape(active) {
    if (active && !globalShortcut.isRegistered('Escape')) globalShortcut.register('Escape', reset);
    if (!active && globalShortcut.isRegistered('Escape')) globalShortcut.unregister('Escape');
  }
  // A camada fica visível enquanto houver ferramenta ou quadro (o quadro também aparece no PC).
  function refreshOverlay() {
    clearInterval(areaTimer); areaTimer = null;
    if (tool || board) {
      ensureOverlay();
      applyMouse();
      updateArea();
      areaTimer = setInterval(updateArea, 500); // acompanha a janela se ela for movida
    } else if (overlay && !overlay.isDestroyed()) overlay.hide();
  }
  function setTool(next) {
    if (next && next === tool) next = null; // mesmo atalho desliga
    if (next && !TOOLS.includes(next)) return;
    if (next && !source) return toPanel({ op: 'notice', message: 'Comece a compartilhar uma tela ou janela para usar as ferramentas.' });
    tool = next || null;
    clearInterval(cursorTimer); cursorTimer = null; lastCursor = '';
    clearInterval(passTimer); passTimer = null; passing = false;
    if (tool) passTimer = setInterval(checkPass, 33);
    refreshOverlay();
    if (CURSOR_TOOLS.includes(tool)) cursorTimer = setInterval(pollCursor, 33);
    emit(toolMessage());
    toolbarState();
    setEscape(!!tool || zoomed || !!board);
  }
  function setBoard(mode) {
    board = mode === 'white' || mode === 'black' ? mode : null;
    emit({ op: 'board', mode: board });
    refreshOverlay(); toolbarState();
    setEscape(!!tool || zoomed || !!board);
  }
  function reset() {
    zoomed = false;
    if (board) setBoard(null);
    setTool(null);
    emit({ op: 'clear' }); toPanel({ op: 'zoom', rect: null });
    setEscape(false);
  }
  function tvCommand(action) { toPanel({ op: 'tv-command', action }); }
  // Estado da TV a partir de um comando (vindo da caixa ou dos botões do painel).
  function trackCommand(action) {
    if (action === 'black' || action === 'show') black = action === 'black';
    if (action === 'mute' || action === 'unmute') muted = action === 'mute';
    if (action === 'freeze' || action === 'unfreeze') frozen = action === 'freeze';
    toolbarState();
  }
  function updateSettings(msg) {
    if (msg.action === 'color' && COLOR_TOOLS.includes(msg.tool) && /^#[0-9a-f]{6}$/i.test(msg.color)) settings.color[msg.tool] = msg.color;
    if (msg.action === 'size' && ['s', 'm', 'l'].includes(msg.size)) settings.size = msg.size;
    if (msg.action === 'shape' && ['arrow', 'rect', 'ellipse', 'line'].includes(msg.shape)) settings.shape = msg.shape;
    prefs.settings = settings; savePrefs();
    toOverlay(toolMessage()); toolbarState();
  }

  ipcMain.on('overlay-event', (event, msg) => {
    if (!overlay || event.sender !== overlay.webContents || !msg || typeof msg.op !== 'string') return;
    if (msg.op === 'zoom') { toPanel(msg); zoomed = true; return setTool(null); }
    if (['stroke-start', 'stroke-point', 'shape', 'erase'].includes(msg.op)) toPanel(msg);
  });
  // Desenho feito na pré-via do painel: aparece também na camada sobre a tela real (a TV o recebe do painel).
  ipcMain.on('panel-ink', (event, msg) => {
    if (event.sender !== getPanel()?.webContents || !msg || typeof msg.op !== 'string') return;
    if (msg.op === 'zoom') { zoomed = true; return setTool(null); }
    if (toOverlayFromPanel(msg.op)) toOverlay(msg);
  });
  ipcMain.on('set-tool', (event, next) => { if (event.sender === getPanel()?.webContents) setTool(typeof next === 'string' && next ? next : null); });
  ipcMain.on('clear-ink', event => { if (event.sender === getPanel()?.webContents) emit({ op: 'clear' }); });
  ipcMain.on('undo-ink', event => { if (event.sender === getPanel()?.webContents) emit({ op: 'undo' }); });
  ipcMain.on('tv-state', (event, action) => { if (event.sender === getPanel()?.webContents) trackCommand(action); });
  ipcMain.on('sharing', (event, active) => {
    if (event.sender !== getPanel()?.webContents || active) return;
    reset(); source = null; sharingSince = null; frozen = false; black = false; // a TV volta para a tela de espera
    getPanel()?.setContentProtection(false);
    toolbarState();
  });
  ipcMain.on('toolbar', (event, visible) => { if (event.sender === getPanel()?.webContents) showToolbar(!!visible); });
  ipcMain.on('toolbar-action', (event, msg) => {
    if (!toolbar || event.sender !== toolbar.webContents || !msg) return;
    if (msg.action === 'tool' && typeof msg.tool === 'string') setTool(msg.tool);
    if (['color', 'size', 'shape'].includes(msg.action)) updateSettings(msg);
    if (msg.action === 'undo') emit({ op: 'undo' });
    if (msg.action === 'clear') emit({ op: 'clear' });
    if (msg.action === 'off') reset();
    if (msg.action === 'board' && source) setBoard(board === null ? 'white' : board === 'white' ? 'black' : null);
    if (msg.action === 'freeze' && source) { tvCommand(frozen ? 'unfreeze' : 'freeze'); trackCommand(frozen ? 'unfreeze' : 'freeze'); }
    if (msg.action === 'black' && source) { tvCommand(black ? 'show' : 'black'); trackCommand(black ? 'show' : 'black'); }
    if (msg.action === 'mute') { tvCommand(muted ? 'unmute' : 'mute'); trackCommand(muted ? 'unmute' : 'mute'); }
    // Clique simulado com gesto do usuário: getDisplayMedia exige ativação.
    if (msg.action === 'share') getPanel()?.webContents.executeJavaScript("document.getElementById('share').click()", true);
    if (msg.action === 'stop') toPanel({ op: 'stop-share' }); // o painel encerra a captura e avisa a TV
    if (msg.action === 'hide') { showToolbar(false); toPanel({ op: 'toolbar', visible: false }); }
  });
  for (const [key, name] of Object.entries(SHORTCUTS)) globalShortcut.register(`CommandOrControl+Alt+${key}`, () => setTool(name));
  globalShortcut.register('CommandOrControl+Alt+0', () => emit({ op: 'clear' }));
  globalShortcut.register('CommandOrControl+Alt+Z', () => emit({ op: 'undo' }));
  return {
    // Painel fora da captura enquanto transmite: a TV não mostra o painel (nem o "espelho dentro do espelho").
    setSource(next) { reset(); source = next; sharingSince = Date.now(); getPanel()?.setContentProtection(true); toolbarState(); },
    dispose() { clearInterval(passTimer); globalShortcut.unregisterAll(); if (overlay && !overlay.isDestroyed()) overlay.destroy(); showToolbar(false); }
  };
}
module.exports = { createTools };
