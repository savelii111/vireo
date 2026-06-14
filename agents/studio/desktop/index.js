/**
 * desktop/index.js — Public exports for Vireo Studio desktop shell.
 */

export { DesktopAppConfig } from './config.js';
export { WindowStateManager } from './windowState.js';
export { NativeBridge } from './nativeBridge.js';
export { SecurityPolicy } from './securityPolicy.js';
export { VireoProtocol } from './protocol.js';
export { DesktopRoutes } from './routes.js';
export { IpcChannelRegistry } from './ipc.js';
export { UpdateManager } from './updateManager.js';
export { DesktopPackager } from './packageConfig.js';
export { DesktopShell, createDesktopShell, desktopExports } from './main.js';
export {
  DEFAULT_DESKTOP_CONFIG,
  DESKTOP_CHANNELS,
  DESKTOP_CLASSES,
  PLATFORMS,
  DESKTOP_MODES,
} from './constants.js';
