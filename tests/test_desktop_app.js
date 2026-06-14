import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  DEFAULT_DESKTOP_CONFIG,
  DESKTOP_CHANNELS,
  DesktopAppConfig,
  DesktopPackager,
  DesktopRoutes,
  DesktopShell,
  IpcChannelRegistry,
  NativeBridge,
  PLATFORMS,
  SecurityPolicy,
  UpdateManager,
  VireoProtocol,
  WindowStateManager,
} from '../agents/studio/desktop/index.js';

class MockBrowserWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.loadedUrl = null;
    this.bounds = { x: 10, y: 20, width: 1440, height: 900 };
    this.shown = false;
    this.focused = false;
  }

  async loadURL(url) {
    this.loadedUrl = url;
    this.emit('ready-to-show');
    return { url };
  }

  show() {
    this.shown = true;
  }

  focus() {
    this.focused = true;
  }

  getBounds() {
    return { ...this.bounds };
  }

  close() {
    this.emit('close');
  }
}

function createMockElectron() {
  const app = {
    ready: false,
    protocolClients: [],
    async whenReady() {
      app.ready = true;
      return app;
    },
    setAsDefaultProtocolClient(protocol) {
      this.protocolClients.push(protocol);
    },
    quit() {
      this.quitCalled = true;
    },
  };
  const Menu = {
    template: null,
    buildFromTemplate(template) {
      return template;
    },
    setApplicationMenu(template) {
      this.template = template;
    },
  };
  return {
    app,
    Menu,
    BrowserWindow: MockBrowserWindow,
  };
}

function createNativeBridge() {
  const opened = [];
  const clipboard = { text: '' };
  return {
    bridge: new NativeBridge({
      shell: {
        openExternal: async (url) => {
          opened.push({ type: 'external', url });
          return true;
        },
        openPath: async (filePath) => {
          opened.push({ type: 'path', filePath });
          return true;
        },
        showItemInFolder: (filePath) => {
          opened.push({ type: 'folder', filePath });
        },
      },
      dialog: {
        showOpenDialog: async (options) => ({ canceled: false, filePaths: [options.defaultPath || '/tmp/media.mp4'] }),
        showSaveDialog: async (options) => ({ canceled: false, filePath: options.defaultPath || '/tmp/project.vireo' }),
      },
      clipboard: {
        readText: () => clipboard.text,
        writeText: (text) => {
          clipboard.text = text;
        },
      },
    }),
    opened,
    clipboard,
  };
}

class TestDesktopShell extends DesktopShell {
  async importElectron() {
    return createMockElectron();
  }
}

test('desktop config, routes, packaging, and protocol resolve deterministic desktop settings', () => {
  const config = new DesktopAppConfig({
    mode: 'build',
    distDir: 'frontend/dist',
    apiBaseUrl: 'http://localhost:3000',
    window: { width: 1200, height: 800, minWidth: 1024, minHeight: 680 },
  });

  assert.equal(config.get('window.title'), 'Vireo Studio');
  assert.equal(config.getStartUrl(), 'file://frontend/dist/index.html');
  assert.deepEqual(config.getBuildTargets('win32'), ['nsis']);

  const routes = new DesktopRoutes({
    mode: 'build',
    devUrl: 'http://localhost:5173',
    distDir: 'frontend/dist',
    apiBaseUrl: 'http://localhost:3000',
  });
  assert.equal(routes.getRendererUrl(), 'file://frontend/dist/index.html');
  assert.deepEqual(routes.buildEnv({ VIREO_ROUTE: 'home' }), {
    VIREO_DESKTOP: '1',
    VIREO_RENDERER_URL: 'file://frontend/dist/index.html',
    VIREO_API_BASE_URL: 'http://localhost:3000',
    VIREO_DESKTOP_MODE: 'build',
    VIREO_ROUTE: 'home',
  });
  assert.deepEqual(routes.resolveDeepLink('vireo://project/p_1?tab=timeline'), {
    valid: true,
    route: 'project/p_1',
    params: { tab: 'timeline' },
    raw: 'vireo://project/p_1?tab=timeline',
  });
  assert.deepEqual(routes.getLaunchArgs(['vireo://home', '--route=project/p_1', 'not-a-deep-link']), [
    { valid: true, route: 'home', params: {}, raw: 'vireo://home' },
    { valid: true, route: 'project/p_1', params: {}, raw: 'vireo://project/p_1' },
  ]);

  const packager = new DesktopPackager(config.toObject());
  assert.deepEqual(packager.getTargetForPlatform('win32'), ['nsis']);
  assert.equal(packager.getWinConfig().requestedExecutionLevel, 'asInvoker');
  assert.equal(packager.getArtifactNames('1.2.3').win, 'Vireo-Studio-1.2.3-win-x64.exe');

  const protocol = new VireoProtocol({ protocol: 'vireo', baseDir: 'frontend/dist', indexHtml: 'index.html' });
  assert.equal(protocol.createUrl('assets/app.js'), 'vireo://assets/app.js');
  assert.equal(protocol.resolveAssetPath('assets/app.js'), path.resolve('frontend/dist/assets/app.js'));
  assert.equal(protocol.getMimeForPath('index.html'), 'text/html');
  assert.throws(() => protocol.resolveAssetPath('../server.js'), /Invalid asset path/);
  assert.throws(() => protocol.resolveAssetPath('/etc/passwd'), /Invalid asset path/);
});

test('desktop security policy denies risky origins, permissions, and IPC channels', () => {
  const security = new SecurityPolicy({
    ...DEFAULT_DESKTOP_CONFIG,
    allowedIpcChannels: [DESKTOP_CHANNELS.CLIPBOARD_READ],
    mode: 'dev',
  });

  assert.match(security.getCsp({ dev: true }), /script-src 'self'/);
  assert.match(security.getCsp({ dev: true }), /object-src 'none'/);
  assert.equal(security.validateUrl('https://help.vireo.studio/guide'), true);
  assert.equal(security.validateUrl('https://evil.example/help.vireo.studio'), false);
  assert.equal(security.isPermissionAllowed('geolocation', 'https://vireo.studio'), false);
  assert.equal(security.isPermissionAllowed('media', 'https://help.vireo.studio'), true);
  assert.equal(security.isPermissionAllowed('media', 'https://evil.example'), false);
  assert.equal(security.validateIpcChannel(DESKTOP_CHANNELS.CLIPBOARD_READ), true);
  assert.equal(security.validateIpcChannel(DESKTOP_CHANNELS.UPDATE_INSTALL), false);
  assert.deepEqual(security.buildHeaders()['X-Frame-Options'], 'DENY');
});

test('window state, native bridge, IPC registry, and updater keep safe boundaries', async () => {
  const windowState = new WindowStateManager({ defaultWindow: DEFAULT_DESKTOP_CONFIG.window });
  assert.deepEqual(windowState.save('main', { x: 1, y: 2, width: 400, height: 300 }), {
    x: 1,
    y: 2,
    width: 400,
    height: 300,
  });
  assert.deepEqual(windowState.load('main'), {
    x: 1,
    y: 2,
    width: 400,
    height: 300,
    minWidth: 1024,
    minHeight: 680,
    title: 'Vireo Studio',
  });

  const native = createNativeBridge();
  await assert.rejects(() => native.bridge.openExternal('file:///etc/passwd'), /http\(s\)/);
  assert.deepEqual(await native.bridge.openPath('C:\\temp\\movie.mp4'), { opened: true, path: 'C:\\temp\\movie.mp4' });
  assert.deepEqual(await native.bridge.showOpenDialog({ defaultPath: '/tmp/open.mp4' }), {
    canceled: false,
    filePaths: ['/tmp/open.mp4'],
  });
  assert.deepEqual(await native.bridge.showSaveDialog({ defaultPath: '/tmp/save.vireo' }), {
    canceled: false,
    filePath: '/tmp/save.vireo',
  });
  assert.deepEqual(native.bridge.writeClipboardText('hello'), { written: true, length: 5 });
  assert.equal(native.bridge.readClipboardText(), 'hello');

  const registry = new IpcChannelRegistry({ allowedChannels: [DESKTOP_CHANNELS.CLIPBOARD_READ, DESKTOP_CHANNELS.NATIVE_SAVE_FILE] });
  registry.register(DESKTOP_CHANNELS.CLIPBOARD_READ, () => 'clip', { requiredRole: 'viewer' });
  registry.register(DESKTOP_CHANNELS.NATIVE_SAVE_FILE, () => ({ saved: true }), { requiredRole: 'editor' });
  assert.equal(await registry.invoke(DESKTOP_CHANNELS.CLIPBOARD_READ, {}, { userId: 'u_1', role: 'viewer' }), 'clip');
  await assert.rejects(() => registry.invoke(DESKTOP_CHANNELS.NATIVE_SAVE_FILE, {}, { userId: 'u_1', role: 'viewer' }), /role_denied/);
  const history = registry.getHistory(DESKTOP_CHANNELS.CLIPBOARD_READ)[0];
  assert.equal(history.channel, DESKTOP_CHANNELS.CLIPBOARD_READ);
  assert.deepEqual(history.args, {});
  assert.equal(history.context.userId, 'u_1');
  assert.equal(history.context.role, 'viewer');
  assert.equal(typeof history.context.requestId, 'string');
  assert.equal(history.ok, true);
  assert.equal(typeof history.at, 'string');

  const updates = new UpdateManager({
    autoUpdater: {
      setFeedURL: (url) => { updates.feedUrl = url; },
      checkForUpdates: async () => ({ updateInfo: { version: '1.0.0' } }),
      downloadUpdate: async () => ['update'],
      quitAndInstall: () => { updates.installed = true; },
    },
    config: { allowUpdates: true },
  });
  assert.deepEqual(updates.setFeedUrl('https://updates.vireo.studio'), { feedUrl: 'https://updates.vireo.studio' });
  assert.equal((await updates.checkForUpdates()).updateInfo.version, '1.0.0');
  assert.equal((await updates.installUpdate()).status, 'ready_to_install');
  assert.equal(updates.quitAndInstall().status, 'installing');
  assert.equal(updates.scheduleCheck(1000).intervalMs, 1000);
  assert.equal(updates.clearSchedule().scheduled, false);
});

test('desktop shell starts with safe renderer options and registered IPC handlers', async () => {
  const native = createNativeBridge();
  const shell = new TestDesktopShell({
    nativeBridge: native.bridge,
    updateConfig: { allowUpdates: true },
  });

  assert.equal(shell.validateBeforeStart(), true);
  assert.deepEqual(await shell.start(), {
    started: true,
    stopped: false,
    mode: 'dev',
    rendererUrl: 'http://localhost:5173',
    apiBaseUrl: 'http://localhost:3000',
    windows: 1,
    ipcChannels: 10,
    csp: shell.security.getCsp({ dev: true }),
  });

  const electron = shell.electron;
  assert.equal(electron.app.ready, true);
  assert.deepEqual(electron.app.protocolClients, [shell.config.protocol]);
  assert.equal(electron.Menu.template[0].label, 'Vireo Studio');

  const mainWindow = shell.windows.get('main');
  assert.equal(mainWindow.loadedUrl, 'http://localhost:5173');
  assert.deepEqual(mainWindow.options.webPreferences, {
    preload: 'desktop/preload.js',
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
  });
  assert.equal(mainWindow.options.minWidth, 1024);
  assert.equal(mainWindow.options.minHeight, 680);

  assert.equal(await shell.ipc.invoke(DESKTOP_CHANNELS.CLIPBOARD_READ, {}, { userId: 'u_1', role: 'viewer' }), '');
  assert.deepEqual(await shell.ipc.invoke(DESKTOP_CHANNELS.WINDOW_SAVE_BOUNDS, { key: 'main', bounds: { width: 1280, height: 720 } }, { userId: 'u_1', role: 'viewer' }), {
    width: 1280,
    height: 720,
  });
  assert.deepEqual(shell.focusOrCreateMainWindow(), { focused: true, id: 'main' });
  assert.deepEqual(shell.stop(), { stopped: true });
  assert.deepEqual(shell.getStatus(), {
    started: true,
    stopped: true,
    mode: 'dev',
    rendererUrl: 'http://localhost:5173',
    apiBaseUrl: 'http://localhost:3000',
    windows: 0,
    ipcChannels: 10,
    csp: shell.security.getCsp({ dev: true }),
  });
});

test('desktop package config can be rendered for npm metadata', () => {
  const packager = new DesktopPackager(DEFAULT_DESKTOP_CONFIG);
  const rendered = JSON.parse(packager.renderPackageJson('0.2.0'));
  assert.equal(rendered.name, 'com.vireo.studio');
  assert.equal(rendered.main, 'desktop/main.js');
  assert.equal(rendered.scripts.start, 'electron .');
  assert.equal(rendered.build.appId, 'com.vireo.studio');
  assert.equal(rendered.build.win.target[0], 'nsis');
  assert.equal(rendered.build.mac.target[0], 'dmg');
  assert.equal(rendered.build.linux.target[0], 'AppImage');
});

test('desktop exports expose the expected class registry', async () => {
  const desktop = await import('../agents/studio/desktop/index.js');
  assert.deepEqual(desktop.DESKTOP_CLASSES, [
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
  assert.equal(typeof desktop.createDesktopShell, 'function');
  assert.equal(typeof desktop.desktopExports.DesktopShell, 'function');
});
