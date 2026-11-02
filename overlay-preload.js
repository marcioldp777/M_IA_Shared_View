const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('salaOverlay', {
  send: msg => ipcRenderer.send('overlay-event', msg),
  on: callback => ipcRenderer.on('annotate', (_, msg) => callback(msg))
});
