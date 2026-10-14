const { contextBridge, ipcRenderer, webUtils } = require('electron');

// The renderer talks to the Python engine over ws://localhost:9001 directly.
// Only things that need Electron itself go through here.
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  // Electron 32+ removed File.path; this is the supported replacement.
  getPathForFile: (file) => webUtils.getPathForFile(file),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  // [{ accelerator: 'Shift+1', id: 'u1234' }] → global shortcuts that play sounds.
  setSoundHotkeys: (list) => ipcRenderer.invoke('set-sound-hotkeys', list),
  // Show a recording in Finder.
  revealRecording: (path) => ipcRenderer.invoke('reveal-recording', path),
});
