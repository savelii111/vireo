/**
 * desktop/config.js — Desktop app configuration validation.
 */

import { DEFAULT_DESKTOP_CONFIG, PLATFORMS } from './constants.js';

function deepMerge(base, override) {
  const output = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      output[key] = deepMerge(base[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function assertString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`);
}

function assertNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
}

export class DesktopAppConfig {
  constructor(overrides = {}) {
    this.config = deepMerge(DEFAULT_DESKTOP_CONFIG, overrides);
    this.validate();
  }

  validate() {
    const c = this.config;
    assertString(c.appId, 'appId');
    assertString(c.productName, 'productName');
    assertString(c.protocol, 'protocol');
    assertString(c.devUrl, 'devUrl');
    assertString(c.distDir, 'distDir');
    assertString(c.indexHtml, 'indexHtml');
    assertString(c.apiBaseUrl, 'apiBaseUrl');
    assertNumber(c.window.width, 'window.width');
    assertNumber(c.window.height, 'window.height');
    assertNumber(c.window.minWidth, 'window.minWidth');
    assertNumber(c.window.minHeight, 'window.minHeight');
    if (c.window.width < c.window.minWidth) throw new Error('window.width must be >= window.minWidth');
    if (c.window.height < c.window.minHeight) throw new Error('window.height must be >= window.minHeight');
    if (!['dev', 'build', 'production'].includes(c.mode)) throw new Error('mode must be dev, build, or production');
    return true;
  }

  get(key, fallback) {
    return key.split('.').reduce((value, part) => (value && value[part] !== undefined ? value[part] : fallback), this.config) ?? fallback;
  }

  toObject() {
    return JSON.parse(JSON.stringify(this.config));
  }

  getBuildTargets(platform = process.platform) {
    const normalized = platform === 'darwin' ? PLATFORMS.MAC : platform === 'win32' ? PLATFORMS.WIN : PLATFORMS.LINUX;
    return this.config.packaging[normalized]?.target || [];
  }

  getRendererRoot() {
    return this.config.mode === 'dev' ? this.config.devUrl : this.config.distDir;
  }

  getStartUrl() {
    if (this.config.mode === 'dev') return this.config.devUrl;
    return `file://${this.config.distDir}/${this.config.indexHtml}`;
  }
}

export default DesktopAppConfig;
