/**
 * desktop/securityPolicy.js — Desktop security policy and CSP.
 */

import { DEFAULT_DESKTOP_CONFIG } from './constants.js';

function hostOf(url) {
  try { return new URL(url).host; } catch { return ''; }
}

export class SecurityPolicy {
  constructor(config = DEFAULT_DESKTOP_CONFIG) {
    this.config = config;
  }

  getCsp({ dev = false } = {}) {
    const connect = [
      "'self'",
      this.config.apiBaseUrl,
      'https://*.vireo.studio',
      'https://api.openrouter.ai',
      'https://api.anthropic.com',
      'https://api.openai.com',
    ];
    if (dev) connect.push(this.config.devUrl.replace(/\/$/, ''));
    return [
      "default-src 'self'",
      `connect-src ${connect.join(' ')}`,
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: https:",
      "font-src 'self' https://fonts.gstatic.com data:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "script-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ');
  }

  validateUrl(url, allowedDomains = this.config.allowedExternalDomains || []) {
    try {
      const parsed = new URL(String(url));
      if (!['http:', 'https:'].includes(parsed.protocol)) return false;
      return allowedDomains.some((domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`));
    } catch {
      return false;
    }
  }

  isPermissionAllowed(permission, origin) {
    const allowed = this.config.permissions || {};
    if (allowed[permission] === false) return false;
    if (permission === 'geolocation' || permission === 'pointerLock') return false;
    if (origin && !this.validateUrl(origin)) return false;
    return true;
  }

  sanitizePermissionRequest(permission) {
    const name = String(permission?.name || '');
    const origin = String(permission?.origin || '');
    return {
      name,
      origin,
      allowed: this.isPermissionAllowed(name, origin),
    };
  }

  getSandboxOptions() {
    return {
      allowpopups: false,
      nodeIntegration: false,
      contextIsolation: true,
    };
  }

  getWebPreferences() {
    return {
      preload: this.config.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    };
  }

  validateIpcChannel(channel) {
    const allowed = this.config.allowedIpcChannels || [];
    return allowed.includes(channel);
  }

  createSessionRules() {
    return [
      { action: 'deny', resources: ['*'], location: { protocol: 'ftp:' } },
      { action: 'allow', resources: ['*'], location: { protocol: ['http:', 'https:'] } },
    ];
  }

  buildHeaders() {
    return {
      'Content-Security-Policy': this.getCsp({ dev: this.config.mode === 'dev' }),
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };
  }
}

export default SecurityPolicy;
