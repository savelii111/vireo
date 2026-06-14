/**
 * desktop/constants.js — Desktop app constants for Vireo Studio.
 */

export const DEFAULT_DESKTOP_CONFIG = Object.freeze({
  appId: 'com.vireo.studio',
  productName: 'Vireo Studio',
  protocol: 'vireo',
  mode: 'dev',
  devUrl: 'http://localhost:5173',
  distDir: 'frontend/dist',
  indexHtml: 'index.html',
  apiBaseUrl: 'http://localhost:3000',
  window: {
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'Vireo Studio',
  },
  allowedExternalDomains: ['youtube.com', 'youtu.be', 'vimeo.com', 'help.vireo.studio'],
  permissions: {
    media: true,
    notifications: true,
    fullscreen: true,
    geolocation: false,
    pointerLock: false,
  },
  packaging: {
    artifactName: 'Vireo-Studio-${version}-${os}-${arch}.${ext}',
    mac: { target: ['dmg', 'zip'], category: 'public.app-category.video' },
    win: { target: ['nsis'], requestedExecutionLevel: 'asInvoker' },
    linux: { target: ['AppImage', 'deb'], category: 'Video' },
  },
});

export const DESKTOP_CHANNELS = Object.freeze({
  NATIVE_OPEN_FILE: 'desktop:native:openFile',
  NATIVE_SAVE_FILE: 'desktop:native:saveFile',
  NATIVE_OPEN_PATH: 'desktop:native:openPath',
  NATIVE_SHOW_ITEM: 'desktop:native:showItemInFolder',
  CLIPBOARD_READ: 'desktop:clipboard:read',
  CLIPBOARD_WRITE: 'desktop:clipboard:write',
  WINDOW_RESTORE: 'desktop:window:restore',
  WINDOW_SAVE_BOUNDS: 'desktop:window:saveBounds',
  UPDATE_CHECK: 'desktop:update:check',
  UPDATE_INSTALL: 'desktop:update:install',
});

export const DESKTOP_CLASSES = Object.freeze([
  'DesktopAppConfig',
  'WindowStateManager',
  'NativeBridge',
  'SecurityPolicy',
  'VireoProtocol',
  'DesktopRoutes',
  'IpcChannelRegistry',
  'UpdateManager',
  'DesktopPackager',
  'DesktopShell',
]);

export const PLATFORMS = Object.freeze({
  MAC: 'mac',
  WIN: 'win',
  LINUX: 'linux',
});

export const DESKTOP_MODES = Object.freeze({
  DEV: 'dev',
  BUILD: 'build',
  PRODUCTION: 'production',
});
