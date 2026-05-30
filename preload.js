const { contextBridge, ipcRenderer, shell } = require('electron')


contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  chooseFolder: () => ipcRenderer.invoke('choose-folder')
})