const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('salaInstaller', {
  init: () => ipcRenderer.invoke('installer:init'),
  scan: () => ipcRenderer.invoke('installer:scan'),
  probe: ip => ipcRenderer.invoke('installer:probe', ip),
  pickP12: () => ipcRenderer.invoke('installer:pick-p12'),
  forget: () => ipcRenderer.invoke('installer:forget'),
  install: request => ipcRenderer.invoke('installer:install', request),
  onLog: callback => ipcRenderer.on('installer:log', (_, entry) => callback(entry))
});
