const { contextBridge, ipcRenderer } = require('electron');
// Ponte do painel com as ferramentas de apresentação do processo principal.
contextBridge.exposeInMainWorld('salaDesktop', {
  setTool: tool => ipcRenderer.send('set-tool', tool),
  clear: () => ipcRenderer.send('clear-ink'),
  undo: () => ipcRenderer.send('undo-ink'),
  tvState: action => ipcRenderer.send('tv-state', action),
  sharing: active => ipcRenderer.send('sharing', active),
  toolbar: visible => ipcRenderer.send('toolbar', visible),
  searchTvs: text => ipcRenderer.invoke('search-tvs', text),
  launchTv: ip => ipcRenderer.invoke('launch-tv', ip),
  onSearchProgress: callback => ipcRenderer.on('search-progress', (_, data) => callback(data)),
  ink: msg => ipcRenderer.send('panel-ink', msg),
  compact: on => ipcRenderer.send('compact', !!on),
  vdd: {
    status: () => ipcRenderer.invoke('vdd-status'),
    install: () => ipcRenderer.invoke('vdd-install'),
    on: () => ipcRenderer.invoke('vdd-on'),
    off: () => ipcRenderer.send('vdd-off')
  },
  onAnnotate: callback => ipcRenderer.on('annotate', (_, msg) => callback(msg))
});
