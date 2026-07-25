const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),

  // Shortcuts
  getShortcuts: () => ipcRenderer.invoke('get-shortcuts'),
  saveShortcut: (shortcut) => ipcRenderer.invoke('save-shortcut', shortcut),
  deleteShortcut: (id) => ipcRenderer.invoke('delete-shortcut', id)
});
