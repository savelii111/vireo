/**
 * desktop/main.js — Electron main process shell for Vireo Studio.
 */

import { DesktopAppConfig } from './config.js';
import { WindowStateManager } from './windowState.js';
import { NativeBridge } from './nativeBridge.js';
import { SecurityPolicy } from './securityPolicy.js';
import { VireoProtocol } from './protocol.js';
import { DesktopRoutes } from './routes.js';
import { IpcChannelRegistry } from './ipc.js';
import { UpdateManager } from './updateManager.js';
import { DesktopPackager } from './packageConfig.js';
import { DESKTOP_CHANNELS, DEFAULT_DESKTOP_CONFIG, DESKTOP_CLASSES } from './constants.js';

function modeFromArgs(argv = process.argv) {
  const modeArg = argv.find((arg) => arg.startsWith('--mode='));
  if (modeArg) return modeArg.split('=')[1];
  return argv.includes('--build') || process.env.VIREO_DESKTOP_MODE === 'build' ? 'build' : 'dev';
}

function createRendererLoadOptions(config) {
  const routes = new DesktopRoutes({
    mode: config.mode,
    devUrl: config.devUrl,
    distDir: config.distDir,
    apiBaseUrl: config.apiBaseUrl,
  });
  return {
    url: routes.getRendererUrl(),
    env: routes.buildEnv(),
  };
}

export class DesktopShell {
  constructor(overrides = {}) {
    this.config = new DesktopAppConfig({ ...DEFAULT_DESKTOP_CONFIG, mode: modeFromArgs(), ...overrides }).toObject();
    this.routes = new DesktopRoutes({
      mode: this.config.mode,
      devUrl: this.config.devUrl,
      distDir: this.config.distDir,
      apiBaseUrl: this.config.apiBaseUrl,
    });
    this.windowState = new WindowStateManager({ defaultWindow: this.config.window });
    this.nativeBridge = new NativeBridge(overrides.nativeBridge || {});
    this.security = new SecurityPolicy({
      ...this.config,
      allowedIpcChannels: Object.values(DESKTOP_CHANNELS),
      preloadPath: 'desktop/preload.js',
    });
    this.protocol = new VireoProtocol({
      protocol: this.config.protocol,
      baseDir: this.config.distDir,
      indexHtml: this.config.indexHtml,
    });
    this.ipc = new IpcChannelRegistry({ allowedChannels: Object.values(DESKTOP_CHANNELS) });
    this.updates = new UpdateManager({ autoUpdater: overrides.autoUpdater, config: overrides.updateConfig || {} });
    this.packager = new DesktopPackager(this.config);
    this.electron = null;
    this.windows = new Map();
    this.started = false;
    this.stopped = false;
  }

  validateBeforeStart() {
    this.config = new DesktopAppConfig(this.config).toObject();
    this.security.buildHeaders();
    this.routes.getRendererUrl();
    this.protocol.createUrl('index');
    return true;
  }

  async start() {
    if (this.started) return this.getStatus();
    this.validateBeforeStart();
    const electron = await this.importElectron();
    this.electron = electron;
    this.registerIpcHandlers();
    electron.app.setAsDefaultProtocolClient?.(this.config.protocol);
    await electron.app.whenReady();
    this.createAppMenu();
    await this.createMainWindow();
    this.started = true;
    return this.getStatus();
  }

  async importElectron() {
    return import('electron');
  }

  registerIpcHandlers() {
    this.ipc.register(DESKTOP_CHANNELS.NATIVE_OPEN_FILE, async (args) => this.nativeBridge.showOpenDialog(args), { requiredRole: 'editor' });
    this.ipc.register(DESKTOP_CHANNELS.NATIVE_SAVE_FILE, async (args) => this.nativeBridge.showSaveDialog(args), { requiredRole: 'editor' });
    this.ipc.register(DESKTOP_CHANNELS.NATIVE_OPEN_PATH, async (args) => this.nativeBridge.openPath(args.path), { requiredRole: 'viewer' });
    this.ipc.register(DESKTOP_CHANNELS.NATIVE_SHOW_ITEM, async (args) => this.nativeBridge.showItemInFolder(args.path), { requiredRole: 'editor' });
    this.ipc.register(DESKTOP_CHANNELS.CLIPBOARD_READ, () => this.nativeBridge.readClipboardText(), { requiredRole: 'viewer' });
    this.ipc.register(DESKTOP_CHANNELS.CLIPBOARD_WRITE, (args) => this.nativeBridge.writeClipboardText(args.text), { requiredRole: 'editor' });
    this.ipc.register(DESKTOP_CHANNELS.WINDOW_SAVE_BOUNDS, (args) => this.windowState.save(args.key, args.bounds), { requiredRole: 'viewer' });
    this.ipc.register(DESKTOP_CHANNELS.WINDOW_RESTORE, (args) => this.windowState.load(args.key), { requiredRole: 'viewer' });
    this.ipc.register(DESKTOP_CHANNELS.UPDATE_CHECK, () => this.updates.checkForUpdates(), { requiredRole: 'owner' });
    this.ipc.register(DESKTOP_CHANNELS.UPDATE_INSTALL, () => this.updates.installUpdate(), { requiredRole: 'owner' });
  }

  async createMainWindow() {
    if (!this.electron) throw new Error('DesktopShell.start() must be called before createMainWindow()');
    const { BrowserWindow } = this.electron;
    const savedBounds = this.windowState.load('main');
    const window = new BrowserWindow({
      ...savedBounds,
      minWidth: this.config.window.minWidth,
      minHeight: this.config.window.minHeight,
      title: this.config.window.title,
      show: false,
      webPreferences: this.security.getWebPreferences(),
    });
    const loadOptions = createRendererLoadOptions(this.config);
    window.once('ready-to-show', () => window.show());
    window.on('close', () => this.windowState.save('main', window.getBounds()));
    await window.loadURL(loadOptions.url);
    this.windows.set('main', window);
    return { id: 'main', url: loadOptions.url };
  }

  createAppMenu() {
    if (!this.electron?.Menu) return null;
    const { app, Menu } = this.electron;
    const template = [
      {
        label: this.config.productName,
        submenu: [
          { label: 'About Vireo Studio', role: 'about' },
          { type: 'separator' },
          { label: 'Quit', click: () => app.quit() },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
    return menu;
  }

  focusOrCreateMainWindow() {
    const existing = this.windows.get('main');
    if (existing && typeof existing.focus === 'function') {
      existing.focus();
      return { focused: true, id: 'main' };
    }
    return { focused: false, reason: 'window_not_created' };
  }

  stop() {
    this.stopped = true;
    this.windows.clear();
    return { stopped: true };
  }

  getStatus() {
    return {
      started: this.started,
      stopped: this.stopped,
      mode: this.config.mode,
      rendererUrl: this.routes.getRendererUrl(),
      apiBaseUrl: this.routes.getApiBaseUrl(),
      windows: this.windows.size,
      ipcChannels: this.ipc.listChannels().length,
      csp: this.security.getCsp({ dev: this.config.mode === 'dev' }),
    };
  }
}

export function createDesktopShell(options = {}) {
  return new DesktopShell(options);
}

export const desktopExports = {
  DesktopShell,
  DesktopAppConfig,
  WindowStateManager,
  NativeBridge,
  SecurityPolicy,
  VireoProtocol,
  DesktopRoutes,
  IpcChannelRegistry,
  UpdateManager,
  DesktopPackager,
  DESKTOP_CLASSES,
};

export default desktopExports;
