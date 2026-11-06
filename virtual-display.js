// TV como 2º monitor: conecta o monitor virtual (Virtual Display Driver) à direita da área de trabalho e o desconecta.
// O driver mantém sempre 1 monitor; ligar/desligar é pela configuração de vídeo do Windows (sem administrador).
const { rightEdge } = require('./display-position');
const SIZE = { width: 1920, height: 1080 }, POLL_MS = 250;
const FAILED = 'O monitor virtual não respondeu. Reinicie o computador ou reinstale.';

// win: win-display.js (ou um falso nos testes); screen: screen do Electron (getAllDisplays).
function createVirtualDisplay({ win, screen, wait = ms => new Promise(r => setTimeout(r, ms)), timeoutMs = 10000 }) {
  function off() {
    const virtual = win.findVirtual();
    if (!virtual || !virtual.attached) return false;
    win.setVirtual(virtual.deviceName, null);
    return true;
  }
  async function on() {
    const virtual = win.findVirtual();
    if (!virtual) throw new Error(FAILED);
    const before = new Set(screen.getAllDisplays().map(d => d.id));
    const spot = rightEdge(win.attachedBounds(virtual.deviceName));
    if (win.setVirtual(virtual.deviceName, { ...spot, ...SIZE }) !== 0) { off(); throw new Error(FAILED); }
    // Espera o Windows anunciar a tela nova (o id que não existia antes).
    for (let waited = 0; waited < timeoutMs; waited += POLL_MS) {
      const added = screen.getAllDisplays().find(d => !before.has(d.id));
      if (added) return added.id;
      await wait(POLL_MS);
    }
    off();
    throw new Error(FAILED);
  }
  return {
    isInstalled: () => win.findVirtual() !== null,
    on,
    off,
    // Sessão anterior fechada à força (ou instalação recém-feita) pode ter deixado a tela conectada.
    disconnectAtStartup() { try { off(); } catch (_) {} }
  };
}
module.exports = { createVirtualDisplay, FAILED };
