const { contextBridge, ipcRenderer } = require('electron');
// Ponte do painel com as ferramentas de apresentação do processo principal.
contextBridge.exposeInMainWorld('salaDesktop', {
  setTool: tool => ipcRenderer.send('set-tool', tool),
  clear: () => ipcRenderer.send('clear-ink'),
  undo: () => ipcRenderer.send('undo-ink'),
  tvState: action => ipcRenderer.send('tv-state', action),
  sharing: active => ipcRenderer.send('sharing', active),
  toolbar: visible => ipcRenderer.send('toolbar', visible),
  onAnnotate: callback => ipcRenderer.on('annotate', (_, msg) => callback(msg))
});
