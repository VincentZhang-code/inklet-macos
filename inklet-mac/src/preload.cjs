'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('inkletNative', Object.freeze({
  platform: process.platform,
  invoke(command, args) { return ipcRenderer.invoke('inklet:call', { command, args }); },
  onEvent(callback) {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('inklet:event', listener);
    return () => ipcRenderer.removeListener('inklet:event', listener);
  },
}));