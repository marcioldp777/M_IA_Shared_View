const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('salaToolbar', {
  send: msg => ipcRenderer.send('toolbar-action', msg),
  on: callback => ipcRenderer.on('toolbar-state', (_, state) => callback(state))
});
