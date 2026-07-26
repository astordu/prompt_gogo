const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),

  // Shortcuts
  getShortcuts: () => ipcRenderer.invoke('get-shortcuts'),
  saveShortcut: (shortcut) => ipcRenderer.invoke('save-shortcut', shortcut),
  deleteShortcut: (id) => ipcRenderer.invoke('delete-shortcut', id),
  checkShortcutAvailability: (accelerator, excludeId) => ipcRenderer.invoke('check-shortcut-availability', accelerator, excludeId),
  recommendShortcut: (accelerator, excludeId, shortcutName) => ipcRenderer.invoke('recommend-shortcut', accelerator, excludeId, shortcutName),
  recheckShortcut: (id) => ipcRenderer.invoke('recheck-shortcut', id),

  // Providers
  saveProvider: (provider) => ipcRenderer.invoke('save-provider', provider),
  deleteProvider: (id) => ipcRenderer.invoke('delete-provider', id),
  validateProvider: (provider) => ipcRenderer.invoke('validate-provider', provider)
});
