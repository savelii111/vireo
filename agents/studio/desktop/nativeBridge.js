/**
 * desktop/nativeBridge.js — Safe native OS bridge for Electron.
 */

import path from 'node:path';

export class NativeBridge {
  constructor({ shell, dialog, clipboard, platform = process.platform } = {}) {
    this.shell = shell || { openExternal: async () => true, openPath: async () => true, showItemInFolder: () => {} };
    this.dialog = dialog || {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
    };
    this.clipboard = clipboard || { readText: () => '', writeText: () => {} };
    this.platform = platform;
  }

  async openExternal(url) {
    if (!this.isHttpUrl(url)) throw new Error('openExternal only supports http(s) URLs');
    await this.shell.openExternal(url);
    return { opened: true, url };
  }

  async openPath(filePath) {
    this.assertSafePath(filePath);
    await this.shell.openPath(filePath);
    return { opened: true, path: filePath };
  }

  showItemInFolder(filePath) {
    this.assertSafePath(filePath);
    this.shell.showItemInFolder(filePath);
    return { shown: true, path: filePath };
  }

  async showOpenDialog(options = {}) {
    const result = await this.dialog.showOpenDialog({
      title: options.title || 'Open media',
      properties: options.properties || ['openFile'],
      filters: options.filters || [{ name: 'Media', extensions: ['mp4', 'mov', 'wav', 'mp3', 'png', 'jpg'] }],
      ...options,
    });
    return {
      canceled: Boolean(result.canceled),
      filePaths: Array.isArray(result.filePaths) ? result.filePaths : [],
    };
  }

  async showSaveDialog(options = {}) {
    const result = await this.dialog.showSaveDialog({
      title: options.title || 'Save project',
      defaultPath: options.defaultPath,
      filters: options.filters || [{ name: 'Vireo Project', extensions: ['vireo'] }],
      ...options,
    });
    return {
      canceled: Boolean(result.canceled),
      filePath: result.filePath || null,
    };
  }

  readClipboardText() {
    return String(this.clipboard.readText());
  }

  writeClipboardText(text) {
    this.clipboard.writeText(String(text ?? ''));
    return { written: true, length: String(text ?? '').length };
  }

  normalizePath(filePath) {
    return path.normalize(String(filePath || ''));
  }

  isHttpUrl(url) {
    try {
      const parsed = new URL(String(url));
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  assertSafePath(filePath) {
    const normalized = this.normalizePath(filePath);
    if (!normalized || normalized.includes('\0')) throw new Error('Invalid file path');
    return normalized;
  }
}

export default NativeBridge;
