const { app, BrowserWindow, session, desktopCapturer } = require('electron');
const { createServer } = require('./server');
const { createTools } = require('./tools');
let service, window, lastChoice, tools;
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
  service = createServer({ log: line => require('node:fs').appendFile(logFile, `${new Date().toISOString()} ${line}\n`, () => {}) });
  tools = createTools(() => window);
  service.server.listen(8787, '0.0.0.0', () => {
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        // Sem áudio = nova tentativa do painel após falha do loopback: reaproveita a escolha recente.
        if (!request.audioRequested && lastChoice && Date.now() - lastChoice.time < 15000) { const { source } = lastChoice; lastChoice = null; tools.setSource(source); return callback({ video: source }); }
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
        const choice = await pick(sources);
        if (choice === null) return callback({});
        lastChoice = { source: sources[choice], time: Date.now() };
        tools.setSource(sources[choice]);
        callback(request.audioRequested ? { video: sources[choice], audio: 'loopback' } : { video: sources[choice] });
      } catch (_) { callback({}); }
    });
    window = new BrowserWindow({ width: 1100, height: 900, backgroundColor: '#0b101b', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: require('node:path').join(__dirname, 'desktop-preload.js') } });
    window.on('closed', () => app.quit()); // a camada de ferramentas também é uma janela
    window.loadURL('http://localhost:8787');
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('http://localhost:8787/')) event.preventDefault(); });
  });
  service.server.on('error', error => { require('electron').dialog.showErrorBox('Sala TV', error.message); app.quit(); });
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { tools?.dispose(); if (service) { service.wss.clients.forEach(client => client.terminate()); service.server.close(); } });
