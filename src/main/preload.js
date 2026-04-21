const { contextBridge, ipcRenderer } = require('electron');

// Expone una API segura al renderer — nunca exponer ipcRenderer directamente
contextBridge.exposeInMainWorld('api', {
  invoke: (channel, data) => ipcRenderer.invoke(channel, data),
  on: (channel, callback) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
});
