/**
 * desktop/preload.js — Safe preload bridge exposed to Vireo Studio renderer.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const electron = (() => {
  try {
    return require('electron');
  } catch {
    return {
      contextBridge: { exposeInMainWorld: () => {} },
      ipcRenderer: {
        invoke: async () => null,
        on: () => {},
        removeListener: () => {},
      },
    };
  }
})();

const { contextBridge, ipcRenderer } = electron;

const channels = {
  openFile: 'desktop:native:openFile',
  saveFile: 'desktop:native:saveFile',
  openPath: 'desktop:native:openPath',
  showItemInFolder: 'desktop:native:showItemInFolder',
  readClipboard: 'desktop:clipboard:read',
  writeClipboard: 'desktop:clipboard:write',
  restoreWindow: 'desktop:window:restore',
  saveWindowBounds: 'desktop:window:saveBounds',
  checkUpdate: 'desktop:update:check',
  installUpdate: 'desktop:update:install',
};

const api = {
  openFile: (options) => ipcRenderer.invoke(channels.openFile, options || {}),
  saveFile: (options) => ipcRenderer.invoke(channels.saveFile, options || {}),
  openPath: (filePath) => ipcRenderer.invoke(channels.openPath, { path: filePath }),
  showItemInFolder: (filePath) => ipcRenderer.invoke(channels.showItemInFolder, { path: filePath }),
  readClipboard: () => ipcRenderer.invoke(channels.readClipboard),
  writeClipboard: (text) => ipcRenderer.invoke(channels.writeClipboard, { text }),
  restoreWindow: (key = 'main') => ipcRenderer.invoke(channels.restoreWindow, { key }),
  saveWindowBounds: (key, bounds) => ipcRenderer.invoke(channels.saveWindowBounds, { key, bounds }),
  checkUpdate: () => ipcRenderer.invoke(channels.checkUpdate),
  installUpdate: () => ipcRenderer.invoke(channels.installUpdate),
  platform: process.platform,
  isDesktop: true,
};

contextBridge.exposeInMainWorld('vireoDesktop', api);

export { api as vireoDesktopApi, channels as desktopChannels };
