const { app, BrowserWindow, session, desktopCapturer, ipcMain } = require('electron');
const { createServer, startBeacon } = require('./server');
const { createTools } = require('./tools');
const discovery = require('./discovery');
let service, window, lastChoice, tools, virtual, virtualSource = null;
// Candidatos ICE com IP real: a TV não resolve nomes mDNS (.local) e não há STUN/TURN.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
// Painel minimizado continua codificando vídeo em ritmo normal.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
const escape = text => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// Seletor com miniaturas; a escolha volta pela navegação para "sala-pick:<índice>".
function pick(sources) {
  const cards = sources.map((source, i) => `<a href="sala-pick:${i}"><img src="data:image/jpeg;base64,${source.thumbnail.toJPEG(70).toString('base64')}"><span>${source.id.startsWith('screen') ? '🖥 ' : ''}${escape(source.name)}</span></a>`).join('');
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:20px;background:#0b101b;color:#edf2fc;font:14px Segoe UI,Arial,sans-serif}h1{font-size:18px;margin:0 0 4px}p{color:#a4b1c7;margin:0 0 16px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}a{display:block;background:#141d2c;border:2px solid #29364b;border-radius:12px;padding:8px;color:inherit;text-decoration:none}a:hover,a:focus{border-color:#69e6be;outline:0}img{width:100%;aspect-ratio:16/9;object-fit:contain;background:#05080f;border-radius:8px}span{display:block;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style><h1>Escolha o que compartilhar</h1><p>Tela inteira ou uma janela (navegador, Excel, PowerPoint…). O áudio do sistema vai junto. Feche esta janela para cancelar.</p><div class="grid">${cards}</div>`;
  return new Promise(resolve => {
    const picker = new BrowserWindow({ parent: window, modal: true, width: 900, height: 640, title: 'Escolha o que compartilhar', autoHideMenuBar: true, backgroundColor: '#0b101b', webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
    let result = null;
    picker.webContents.on('will-navigate', (event, url) => {
      event.preventDefault();
      const match = /^sala-pick:(\d+)$/.exec(url);
      if (match) { result = Number(match[1]); picker.close(); }
    });
    picker.on('closed', () => resolve(result));
    picker.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  });
}
app.whenReady().then(() => {
  const logFile = require('node:path').join(app.getPath('userData'), 'sala-tv.log');
  service = createServer({ diagnostics: process.env.SALA_DIAGNOSTICO === '1', log: line => require('node:fs').appendFile(logFile, `${new Date().toISOString()} ${line}\n`, () => {}) });
  tools = createTools(() => window);
  // TV como 2º monitor: monitor virtual conectado à direita e transmitido sem o seletor.
  virtual = require('./virtual-display').createVirtualDisplay({ win: require('./win-display'), screen: require('electron').screen });
  virtual.disconnectAtStartup(); // sessão anterior fechada à força pode ter deixado a tela conectada
  const fromPanel = event => event.sender === window?.webContents;
  ipcMain.handle('vdd-status', event => (fromPanel(event) ? { installed: virtual.isInstalled() } : null));
  ipcMain.handle('vdd-install', async event => {
    if (!fromPanel(event)) return null;
    const result = await require('./vdd-install').install({ resources: app.isPackaged ? process.resourcesPath : __dirname });
    if (result.ok) virtual.disconnectAtStartup(); // a instalação deixa o monitor conectado
    return result;
  });
  ipcMain.handle('vdd-on', async event => {
    if (!fromPanel(event)) return null;
    try {
      const displayId = await virtual.on();
      // O capturador pode levar um instante para listar a tela nova.
      for (let attempt = 0; attempt < 6 && !virtualSource; attempt++) {
        if (attempt) await new Promise(resolve => setTimeout(resolve, 300));
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
        virtualSource = sources.find(source => String(source.display_id) === String(displayId)) || null;
      }
      if (!virtualSource) { virtual.off(); throw new Error(require('./virtual-display').FAILED); }
      return { ok: true };
    } catch (error) { return { ok: false, message: error.message }; }
  });
  ipcMain.on('vdd-off', event => { if (fromPanel(event)) { virtualSource = null; virtual.off(); } });
  // Busca por IP/faixa: lista as TVs Samsung; ao escolher uma, abre o receptor nela apontando para este PC.
  const launchTv = discovery.createLauncher(require('node:path').join(app.getPath('userData'), 'tv-tokens.json'), 8787);
  ipcMain.handle('search-tvs', (event, text) => {
    if (event.sender !== window?.webContents) return null;
    const progress = data => { if (!event.sender.isDestroyed()) event.sender.send('search-progress', data); };
    return discovery.search(text, { onFound: tv => progress({ found: tv }), onProgress: (done, total) => progress({ done, total }) })
      .then(found => ({ ok: true, found }), error => ({ ok: false, message: error.message }));
  });
  // Modo mini: durante a transmissão o painel vira uma janelinha no canto, por cima dos apps (fora da captura).
  const { screen } = require('electron'), { miniBounds } = require('./compact');
  const windowPrefsFile = require('node:path').join(app.getPath('userData'), 'window.json');
  let windowPrefs = {}, compact = null; // compact: { bounds, maximized } da janela normal enquanto estiver mini
  try { windowPrefs = JSON.parse(require('node:fs').readFileSync(windowPrefsFile, 'utf8')); } catch (_) {}
  ipcMain.on('compact', (event, on) => {
    if (!window || event.sender !== window.webContents) return;
    if (on && !compact) {
      compact = { bounds: window.getNormalBounds(), maximized: window.isMaximized() };
      if (window.isMinimized()) window.restore();
      if (compact.maximized) window.unmaximize();
      const home = screen.getDisplayMatching(compact.bounds).workArea;
      window.setMenuBarVisibility(false);
      window.setBounds(miniBounds(screen.getAllDisplays().map(d => d.workArea), home, windowPrefs.mini || null));
      window.setAlwaysOnTop(true, 'floating');
    } else if (!on && compact) {
      const saved = compact; compact = null;
      window.setAlwaysOnTop(false);
      window.setMenuBarVisibility(true);
      window.setBounds(saved.bounds);
      if (saved.maximized) window.maximize();
    }
  });
  ipcMain.handle('launch-tv', (event, ip) => (event.sender === window?.webContents && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? launchTv(ip) : null));
  service.server.listen(8787, '0.0.0.0', () => {
    startBeacon(8787);
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        // Sem áudio = nova tentativa do painel após falha do loopback: reaproveita a escolha recente.
        // Pedido do 2º monitor: essa tela vai direto, sem seletor (só uma vez; o próximo compartilhamento abre o seletor).
        if (virtualSource) {
          const source = virtualSource; virtualSource = null;
          lastChoice = { source, time: Date.now() }; tools.setSource(source);
          return callback(request.audioRequested ? { video: source, audio: 'loopback' } : { video: source });
        }
        if (!request.audioRequested && lastChoice && Date.now() - lastChoice.time < 15000) { const { source } = lastChoice; lastChoice = null; tools.setSource(source); return callback({ video: source }); }
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
        const choice = await pick(sources);
        if (choice === null) return callback({});
        lastChoice = { source: sources[choice], time: Date.now() };
        tools.setSource(sources[choice]);
        callback(request.audioRequested ? { video: sources[choice], audio: 'loopback' } : { video: sources[choice] });
      } catch (_) { callback({}); }
    });
    window = new BrowserWindow({ width: 1100, height: 900, backgroundColor: '#0b101b', title: 'M I.A. Shared View', icon: require('node:path').join(__dirname, 'assets', 'icon.png'), webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: require('node:path').join(__dirname, 'desktop-preload.js') } });
    window.on('closed', () => app.quit()); // a camada de ferramentas também é uma janela
    window.on('moved', () => {
      if (!compact) return;
      const [x, y] = window.getPosition(); windowPrefs.mini = { x, y };
      require('node:fs').writeFile(windowPrefsFile, JSON.stringify(windowPrefs), () => {});
    });
    window.loadURL('http://localhost:8787');
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('http://localhost:8787/')) event.preventDefault(); });
  });
  service.wss.on('error', () => {}); // o ws repassa o erro do servidor HTTP, já tratado abaixo
  service.server.on('error', error => {
    const message = error.code === 'EADDRINUSE' ? 'O M I.A. Shared View já está aberto neste computador (porta 8787 em uso). Feche a outra janela e abra de novo.' : error.message;
    require('electron').dialog.showErrorBox('M I.A. Shared View', message); app.quit();
  });
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { try { virtual?.off(); } catch (_) {} tools?.dispose(); if (service) { service.wss.clients.forEach(client => client.terminate()); service.server.close(); } });
