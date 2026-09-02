const { contextBridge, ipcRenderer, shell } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  API_BASE_URL: `http://127.0.0.1:${process.env.API_PORT}`,
  getAppleMusicPreloadPath: () => ipcRenderer.invoke('get-apple-music-preload-path'),
  getSelection: () => ipcRenderer.invoke('get-selection'),
  addSong: (song) => ipcRenderer.invoke('add-song', song),
  removeSong: (id) => ipcRenderer.invoke('remove-song', id),
})