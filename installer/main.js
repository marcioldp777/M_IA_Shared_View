// Assistente "Instalar na TV Samsung" (processo principal): janela, IPC e etapas da instalação.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron');
const tizen = require('./tizen');
const { loadP12, signWidget, CertificateError } = require('./signer');
const { createZip } = require('./zip');
const { receiverFiles, appIds } = require('./package');

const SERVER_PORT = 8787;

function createInstaller(getParent) {
  let win = null;
  const settingsFile = () => path.join(app.getPath('userData'), 'installer.json');
  const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (_) { return {}; } };
  const writeSettings = s => fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
  const seal = text => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text).toString('base64') : null);
  const unseal = b64 => { try { return safeStorage.decryptString(Buffer.from(b64, 'base64')); } catch (_) { return ''; } };
  const fromWin = event => win && !win.isDestroyed() && event.sender === win.webContents;

  function open() {
    if (win && !win.isDestroyed()) return win.focus();
    win = new BrowserWindow({
      parent: getParent() || undefined, width: 820, height: 900, title: 'Instalar na TV Samsung', autoHideMenuBar: true, backgroundColor: '#0b101b',
      icon: path.join(__dirname, '..', 'assets', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, '..', 'installer-preload.js'), sandbox: true, contextIsolation: true }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.loadFile(path.join(__dirname, '..', 'public', 'installer.html'));
  }

  ipcMain.handle('installer:init', event => {
    if (!fromWin(event)) return null;
    const s = readSettings();
    return { ips: tizen.localIPv4(), sdb: tizen.findSdb(), profiles: tizen.profiles(), saved: { profile: s.profile || '', author: s.author || '', distributor: s.distributor || '', remembered: !!s.authorPassword } };
  });
  ipcMain.handle('installer:scan', event => (fromWin(event) ? tizen.scan() : []));
  ipcMain.handle('installer:probe', (event, ip) => (fromWin(event) && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? tizen.probe(ip, 2500) : null));
  ipcMain.handle('installer:pick-p12', async event => {
    if (!fromWin(event)) return null;
    const result = await dialog.showOpenDialog(win, { title: 'Escolha o certificado (.p12)', filters: [{ name: 'Certificado', extensions: ['p12'] }], properties: ['openFile'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('installer:forget', event => {
    if (!fromWin(event)) return false;
    const s = readSettings(); delete s.authorPassword; delete s.distributorPassword; writeSettings(s);
    return true;
  });

  ipcMain.handle('installer:install', async (event, req) => {
    if (!fromWin(event)) return { ok: false };
    const log = (step, status, text) => { if (!win.isDestroyed()) win.webContents.send('installer:log', { step, status, text }); };
    let step = 'sdb';
    try {
      const sdb = tizen.findSdb();
      if (!sdb) throw new Error('Ferramenta "sdb" não encontrada. Instale o Tizen Studio (ele traz o sdb) e abra o assistente de novo.');
      log(step, 'ok', `sdb: ${sdb}`);

      step = 'connect'; log(step, 'run', `Conectando à TV ${req.ip}…`);
      await tizen.connect(sdb, req.ip);
      log(step, 'ok', 'Conectado.');

      step = 'duid'; log(step, 'run', 'Lendo o identificador da TV (DUID)…');
      const duid = await tizen.getDuid(sdb, req.ip);
      const known = tizen.deviceProfile(path.dirname(req.distributor)).duids;
      if (known && !known.includes(duid)) {
        throw new Error(`Esta TV (DUID ${duid}) não está no seu certificado de distribuidor (contém: ${known.join(', ') || 'nenhuma'}). `
          + 'No Tizen Studio › Certificate Manager, gere o certificado de distribuidor incluindo este DUID e tente de novo.');
      }
      log(step, 'ok', `DUID ${duid}${known ? ' — autorizado no certificado' : ''}.`);

      step = 'cert'; log(step, 'run', 'Abrindo os certificados…');
      const s = readSettings();
      const authorPassword = req.authorPassword || (s.authorPassword ? unseal(s.authorPassword) : '');
      const distributorPassword = req.distributorPassword || (s.distributorPassword ? unseal(s.distributorPassword) : '') || authorPassword;
      const author = loadP12(fs.readFileSync(req.author), authorPassword);
      let distributor;
      try { distributor = loadP12(fs.readFileSync(req.distributor), distributorPassword); }
      catch (error) { if (error instanceof CertificateError) error.message = `Distribuidor: ${error.message}`; throw error; }
      const next = { profile: req.profile || '', author: req.author, distributor: req.distributor };
      if (req.remember) { next.authorPassword = seal(authorPassword); next.distributorPassword = seal(distributorPassword); }
      writeSettings(next);
      log(step, 'ok', `Autor: ${author.subject} · distribuidor: ${distributor.subject}.`);

      step = 'sign'; log(step, 'run', 'Montando e assinando o app…');
      const tv = await tizen.probe(req.ip, 2500);
      const ips = tizen.localIPv4();
      const serverIp = tv && ips.includes(tv.developerIP) ? tv.developerIP : ips.find(ip => ip.split('.').slice(0, 3).join('.') === req.ip.split('.').slice(0, 3).join('.')) || ips[0];
      const files = signWidget(receiverFiles(`http://${serverIp}:${SERVER_PORT}`), author, distributor);
      const ids = appIds();
      const wgt = path.join(os.tmpdir(), `${ids.packageId}-${Date.now()}.wgt`);
      fs.writeFileSync(wgt, createZip(files));
      log(step, 'ok', `Pacote assinado (${Math.round(fs.statSync(wgt).size / 1024)} KB), apontando para http://${serverIp}:${SERVER_PORT}.`);

      step = 'install'; log(step, 'run', 'Instalando na TV…');
      await tizen.install(sdb, req.ip, wgt, ids.packageId);
      fs.rm(wgt, () => {});
      log(step, 'ok', 'Instalado.');

      step = 'launch'; log(step, 'run', 'Abrindo o app na TV…');
      await tizen.launch(sdb, req.ip, ids.appId);
      log(step, 'ok', 'Pronto! O M I.A. Shared View está aberto na TV.');
      return { ok: true };
    } catch (error) {
      log(step, 'error', error.message);
      return { ok: false, error: error.message };
    }
  });

  return { open };
}

module.exports = { createInstaller };
