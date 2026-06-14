/**
 * desktop/packageConfig.js — Electron Builder packaging configuration.
 */

import { DEFAULT_DESKTOP_CONFIG, PLATFORMS } from './constants.js';

export class DesktopPackager {
  constructor(config = DEFAULT_DESKTOP_CONFIG) {
    this.config = config;
  }

  validateConfig() {
    if (!this.config.appId) throw new Error('appId is required');
    if (!this.config.productName) throw new Error('productName is required');
    return true;
  }

  buildConfig() {
    this.validateConfig();
    const packaging = this.config.packaging || {};
    return {
      appId: this.config.appId,
      productName: this.config.productName,
      directories: { output: 'desktop-dist' },
      files: ['dist/**', 'desktop/**', 'frontend/dist/**', 'package.json'],
      extraMetadata: { main: 'desktop/main.js' },
      mac: {
        target: packaging.mac?.target || ['dmg'],
        category: packaging.mac?.category || 'public.app-category.video',
        hardenedRuntime: true,
        gatekeeperAssess: false,
      },
      win: {
        target: packaging.win?.target || ['nsis'],
        requestedExecutionLevel: packaging.win?.requestedExecutionLevel || 'asInvoker',
      },
      linux: {
        target: packaging.linux?.target || ['AppImage'],
        category: packaging.linux?.category || 'Video',
      },
      publish: null,
    };
  }

  getTargetForPlatform(platform = process.platform) {
    const normalized = platform === 'darwin' ? PLATFORMS.MAC : platform === 'win32' ? PLATFORMS.WIN : PLATFORMS.LINUX;
    return this.buildConfig()[normalized]?.target || [];
  }

  getEntitlements(platform = PLATFORMS.MAC) {
    if (platform !== PLATFORMS.MAC) return {};
    return {
      'com.apple.security.cs.allow-jit': true,
      'com.apple.security.cs.allow-unsigned-executable-memory': true,
      'com.apple.security.device.camera': true,
      'com.apple.security.device.microphone': true,
    };
  }

  getInstallerOptions(platform = process.platform) {
    const normalized = platform === 'darwin' ? PLATFORMS.MAC : platform === 'win32' ? PLATFORMS.WIN : PLATFORMS.LINUX;
    if (normalized === PLATFORMS.WIN) {
      return { oneClick: false, perMachine: true, allowToChangeInstallationDirectory: true };
    }
    if (normalized === PLATFORMS.LINUX) {
      return { maintainer: 'Vireo Labs', synopsis: 'AI video editor', description: 'Vireo Studio desktop app' };
    }
    return { identity: null };
  }

  getMacConfig() {
    return this.buildConfig().mac;
  }

  getWinConfig() {
    return this.buildConfig().win;
  }

  getLinuxConfig() {
    return this.buildConfig().linux;
  }

  renderPackageJson(version = '0.1.0') {
    return JSON.stringify({
      name: this.config.appId,
      version,
      productName: this.config.productName,
      main: 'desktop/main.js',
      scripts: {
        start: 'electron .',
        dist: 'electron-builder',
      },
      build: this.buildConfig(),
    }, null, 2);
  }

  getArtifactNames(version = '0.1.0') {
    const artifact = this.config.packaging?.artifactName || 'Vireo-Studio-${version}-${os}-${arch}.${ext}';
    return {
      mac: artifact.replace('${os}', 'mac').replace('${arch}', 'x64').replace('${version}', version).replace('${ext}', 'dmg'),
      win: artifact.replace('${os}', 'win').replace('${arch}', 'x64').replace('${version}', version).replace('${ext}', 'exe'),
      linux: artifact.replace('${os}', 'linux').replace('${arch}', 'x64').replace('${version}', version).replace('${ext}', 'AppImage'),
    };
  }
}

export default DesktopPackager;
