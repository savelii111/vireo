/**
 * desktop/routes.js — Resolve renderer and API URLs for dev/build/production.
 */

export class DesktopRoutes {
  constructor({ mode = 'dev', devUrl = 'http://localhost:5173', distDir = 'frontend/dist', apiBaseUrl = 'http://localhost:3000' } = {}) {
    this.mode = mode;
    this.devUrl = devUrl.replace(/\/$/, '');
    this.distDir = distDir.replace(/\/$/, '');
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, '');
  }

  isDevMode() {
    return this.mode === 'dev';
  }

  getRendererUrl() {
    return this.isDevMode() ? this.devUrl : `file://${this.distDir}/index.html`;
  }

  getDevServerUrl() {
    return this.devUrl;
  }

  getBuildIndexUrl() {
    return `file://${this.distDir}/index.html`;
  }

  getApiBaseUrl() {
    return this.apiBaseUrl;
  }

  buildEnv(extra = {}) {
    return {
      VIREO_DESKTOP: '1',
      VIREO_RENDERER_URL: this.getRendererUrl(),
      VIREO_API_BASE_URL: this.apiBaseUrl,
      VIREO_DESKTOP_MODE: this.mode,
      ...extra,
    };
  }

  resolveDeepLink(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'vireo:') return { valid: false, reason: 'unsupported_protocol' };
      const segments = [parsed.host, parsed.pathname.replace(/^\/+/, '')].filter(Boolean).join('/');
      return {
        valid: true,
        route: segments || 'home',
        params: Object.fromEntries(parsed.searchParams.entries()),
        raw: url,
      };
    } catch {
      return { valid: false, reason: 'invalid_url' };
    }
  }

  getLaunchArgs(argv = []) {
    return argv
      .filter((arg) => typeof arg === 'string' && (arg.startsWith('vireo://') || arg.startsWith('--route=')))
      .map((arg) => arg.startsWith('--route=') ? this.resolveDeepLink(`vireo://${arg.slice('--route='.length)}`) : this.resolveDeepLink(arg));
  }
}

export default DesktopRoutes;
