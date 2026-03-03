const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveImage: (dataUrl, suggestedName) =>
    ipcRenderer.invoke('save-image', { dataUrl, suggestedName }),
  saveZip: (buffer, suggestedName) =>
    ipcRenderer.invoke('save-zip', { buffer, suggestedName }),
  isElectron: () => ipcRenderer.invoke('is-electron'),
});
