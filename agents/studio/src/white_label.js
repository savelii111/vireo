/**
 * white_label.js — Enterprise white-label system for Vireo Studio.
 *
 * Provides custom-domain, branding, theme, portal, app-build, analytics,
 * licensing, and support managers for agencies/businesses running Vireo Studio
 * under their own brand.
 */

const DEFAULT_COLORS = Object.freeze({
  primary: '#6d5dfc',
  secondary: '#17c3b2',
  background: '#ffffff',
  surface: '#f8fafc',
  text: '#0f172a',
  muted: '#64748b',
  danger: '#ef4444',
  success: '#22c55e',
  warning: '#f59e0b',
});

const DEFAULT_FONTS = Object.freeze({
  heading: 'Inter',
  body: 'Inter',
  mono: 'JetBrains Mono',
});

const LICENSE_FEATURES = Object.freeze({
  trial: [
    'white_label_preview',
    'custom_branding_draft',
    'single_custom_domain',
  ],
  starter: [
    'custom_branding',
    'custom_domain_dns',
    'shared_ssl',
    'basic_portal',
    'analytics_summary',
  ],
  professional: [
    'custom_branding',
    'custom_domain_dns',
    'managed_ssl',
    'portal_users',
    'analytics_advanced',
    'theme_export_import',
    'custom_css',
  ],
  enterprise: [
    'custom_branding',
    'custom_domain_dns',
    'managed_ssl',
    'portal_users',
    'analytics_advanced',
    'theme_export_import',
    'custom_css',
    'custom_app_builder',
    'priority_support',
    'sla_support',
    'license_admin',
  ],
});

function now() {
  return Date.now();
}

function isoNow() {
  return new Date(now()).toISOString();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeClientId(clientId) {
  if (clientId == null) return '';
  return String(clientId).trim();
}

function normalizeDomain(domain) {
  if (domain == null) return '';
  return String(domain).trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
}

function ensureClientId(clientId, label = 'Client') {
  const id = normalizeClientId(clientId);
  if (!id) throw new Error(`${label} id required`);
  return id;
}

function ensureDomain(domain, label = 'Domain') {
  const value = normalizeDomain(domain);
  if (!value) throw new Error(`${label} required`);
  return value;
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function mergeDeep(target, source) {
  const output = Array.isArray(target) ? [...target] : { ...target };
  if (!isPlainObject(source)) return output;
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = mergeDeep(output[key], value);
    } else if (value !== undefined) {
      output[key] = clone(value);
    }
  }
  return output;
}

function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

function isValidHexColor(value) {
  return typeof value === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

function validateColors(colors) {
  const errors = [];
  if (!isPlainObject(colors)) return errors;
  for (const [key, value] of Object.entries(colors)) {
    if (!isValidHexColor(value)) {
      errors.push(`colors.${key} must be a valid hex color`);
    }
  }
  return errors;
}

function timestampFromDate(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

function dateInWindow(recordDate, startDate, endDate) {
  if (startDate == null && endDate == null) return true;
  const time = timestampFromDate(recordDate);
  if (time == null) return false;
  if (startDate != null && time < timestampFromDate(startDate)) return false;
  if (endDate != null && time > timestampFromDate(endDate)) return false;
  return true;
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function createDomainRecord(clientId, domain, recordType = 'primary', extra = {}) {
  const normalizedDomain = ensureDomain(domain);
  const verificationToken = `vireo-${hashString(`${clientId}:${normalizedDomain}:${Date.now()}`).toString(36)}`;
  return {
    client_id: ensureClientId(clientId),
    domain: normalizedDomain,
    type: recordType,
    status: 'pending',
    verification_token: verificationToken,
    verified: false,
    ssl_enabled: false,
    ssl_status: 'not_configured',
    redirect_target: null,
    created_at: isoNow(),
    updated_at: isoNow(),
    ...extra,
  };
}

function createDNSRecord(domain, type, name, value, priority = null, extra = {}) {
  return {
    type,
    name: name || normalizeDomain(domain),
    value,
    priority,
    ttl: 3600,
    ...extra,
  };
}

function recommendedDNSRecords(domain, config = {}) {
  const normalizedDomain = ensureDomain(domain);
  const apex = normalizedDomain;
  const appHost = config.app_host || `app.${normalizedDomain}`;
  const verificationToken = config.verification_token || `vireo-${hashString(normalizedDomain).toString(36)}`;
  return [
    createDNSRecord(apex, 'A', '@', '76.76.21.21'),
    createDNSRecord(apex, 'CNAME', 'www', apex),
    createDNSRecord(apex, 'CNAME', 'app', appHost),
    createDNSRecord(apex, 'TXT', '_vireo-verification', verificationToken),
    createDNSRecord(apex, 'TXT', '_dmarc', 'v=DMARC1; p=none'),
  ];
}

function createSSLRecord(clientId, domain, status = 'active', extra = {}) {
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  return {
    client_id: ensureClientId(clientId),
    domain: ensureDomain(domain),
    status,
    provider: 'vireo_managed',
    certificate_authority: 'Let\'s Encrypt',
    issued_at: isoNow(),
    expires_at: expiresAt.toISOString(),
    auto_renew: true,
    ...extra,
  };
}

// ── 1. WhiteLabelConfig ─────────────────────────────────────────────────────

export class WhiteLabelConfig {
  constructor() {
    this._configs = new Map();
  }

  createConfig({ client_id, clientId, brand_name, logo_url = '', colors = {}, domain = '', custom_domain = '' }) {
    const normalizedClientId = ensureClientId(client_id || clientId, 'client_id');
    if (!brand_name) throw new Error('brand_name required');
    const baseColors = { ...DEFAULT_COLORS, ...colors };
    const config = {
      client_id: normalizedClientId,
      brand_name,
      logo_url,
      colors: baseColors,
      domain: normalizeDomain(domain),
      custom_domain: normalizeDomain(custom_domain),
      status: 'draft',
      created_at: isoNow(),
      updated_at: isoNow(),
      version: 1,
    };
    const validation = this.validateConfig(config);
    if (!validation.valid) throw new Error(validation.errors.join('; '));
    this._configs.set(normalizedClientId, clone(config));
    return this.getConfig(normalizedClientId);
  }

  getConfig(clientId) {
    const id = ensureClientId(clientId);
    const config = this._configs.get(id);
    if (!config) throw new Error(`White-label config '${id}' not found`);
    return clone(config);
  }

  updateConfig(clientId, updates = {}) {
    const id = ensureClientId(clientId);
    const existing = this._configs.get(id);
    if (!existing) throw new Error(`White-label config '${id}' not found`);
    const next = mergeDeep(existing, updates);
    next.client_id = id;
    next.updated_at = isoNow();
    next.version = (next.version || 0) + 1;
    const validation = this.validateConfig(next);
    if (!validation.valid) throw new Error(validation.errors.join('; '));
    this._configs.set(id, clone(next));
    return this.getConfig(id);
  }

  deleteConfig(clientId) {
    const id = ensureClientId(clientId);
    return this._configs.delete(id);
  }

  listConfigs() {
    return [...this._configs.values()].map(clone);
  }

  validateConfig(config = {}) {
    const errors = [];
    const warnings = [];
    if (!config.client_id) errors.push('client_id required');
    if (!config.brand_name) errors.push('brand_name required');
    if (config.logo_url && typeof config.logo_url !== 'string') errors.push('logo_url must be a string');
    if (!isPlainObject(config.colors)) errors.push('colors must be an object');
    else errors.push(...validateColors(config.colors));
    if (config.domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(config.domain)) warnings.push('domain should be a valid domain name');
    if (config.custom_domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(config.custom_domain)) warnings.push('custom_domain should be a valid domain name');
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      checked_at: isoNow(),
    };
  }

  exportConfig(clientId) {
    const config = this.getConfig(clientId);
    return {
      format: 'vireo.white_label.config.v1',
      exported_at: isoNow(),
      config,
    };
  }

  importConfig(configData) {
    const config = configData?.config || configData;
    if (!isPlainObject(config)) throw new Error('configData must contain a config object');
    const imported = this.createConfig({
      client_id: config.client_id,
      brand_name: config.brand_name,
      logo_url: config.logo_url,
      colors: config.colors,
      domain: config.domain,
      custom_domain: config.custom_domain,
    });
    if (config.status) imported.status = config.status;
    this._configs.set(imported.client_id, clone(imported));
    return this.getConfig(imported.client_id);
  }

  cloneConfig(clientId, newClientId) {
    const original = this.getConfig(clientId);
    const nextClientId = ensureClientId(newClientId, 'newClientId');
    if (nextClientId === original.client_id) throw new Error('newClientId must differ from clientId');
    return this.createConfig({
      client_id: nextClientId,
      brand_name: original.brand_name,
      logo_url: original.logo_url,
      colors: original.colors,
      domain: original.domain,
      custom_domain: original.custom_domain,
    });
  }
}

// ── 2. DomainManager ────────────────────────────────────────────────────────

export class DomainManager {
  constructor() {
    this._domains = new Map();
    this._redirects = new Map();
  }

  _clientDomains(clientId) {
    const id = ensureClientId(clientId);
    if (!this._domains.has(id)) this._domains.set(id, new Map());
    return this._domains.get(id);
  }

  addDomain(clientId, domain, recordType = 'primary') {
    const id = ensureClientId(clientId);
    const normalizedDomain = ensureDomain(domain);
    const domains = this._clientDomains(id);
    if (domains.has(normalizedDomain)) return clone(domains.get(normalizedDomain));
    const record = createDomainRecord(id, normalizedDomain, recordType);
    domains.set(normalizedDomain, record);
    return clone(record);
  }

  removeDomain(clientId, domain) {
    const id = ensureClientId(clientId);
    const normalizedDomain = ensureDomain(domain);
    const domains = this._domains.get(id);
    if (!domains) return false;
    return domains.delete(normalizedDomain);
  }

  listDomains(clientId) {
    const id = ensureClientId(clientId);
    const domains = this._domains.get(id);
    if (!domains) return [];
    return [...domains.values()].map(clone);
  }

  _getDomainRecord(clientId, domain) {
    const id = ensureClientId(clientId);
    const normalizedDomain = ensureDomain(domain);
    const domains = this._domains.get(id);
    const record = domains?.get(normalizedDomain);
    if (!record) throw new Error(`Domain '${normalizedDomain}' not found for client '${id}'`);
    return record;
  }

  verifyDomain(clientId, domain) {
    const id = ensureClientId(clientId);
    const normalizedDomain = ensureDomain(domain);
    const record = this._getDomainRecord(id, normalizedDomain);
    const records = this.getDNSRecords(normalizedDomain);
    const hasVerification = records.some((dns) => dns.type === 'TXT' && String(dns.value).startsWith('vireo-'));
    const verified = hasVerification || Boolean(record.verification_token);
    record.status = verified ? 'verified' : 'pending';
    record.verified = verified;
    record.updated_at = isoNow();
    return {
      domain: normalizedDomain,
      client_id: id,
      verified,
      status: record.status,
      required_records: records,
      checked_at: isoNow(),
    };
  }

  getDNSRecords(domain) {
    const normalizedDomain = ensureDomain(domain);
    return recommendedDNSRecords(normalizedDomain);
  }

  setupSSL(clientId, domain) {
    const id = ensureClientId(clientId);
    const normalizedDomain = ensureDomain(domain);
    const record = this._getDomainRecord(id, normalizedDomain);
    const ssl = createSSLRecord(id, normalizedDomain);
    record.ssl_enabled = true;
    record.ssl_status = ssl.status;
    record.updated_at = isoNow();
    return clone(ssl);
  }

  getSSLStatus(clientId, domain) {
    const id = ensureClientId(clientId);
    const normalizedDomain = ensureDomain(domain);
    const record = this._getDomainRecord(id, normalizedDomain);
    return {
      client_id: id,
      domain: normalizedDomain,
      enabled: Boolean(record.ssl_enabled),
      status: record.ssl_status || 'not_configured',
      checked_at: isoNow(),
    };
  }

  renewSSL(clientId, domain) {
    const id = ensureClientId(clientId);
    const normalizedDomain = ensureDomain(domain);
    const record = this._getDomainRecord(id, normalizedDomain);
    const ssl = createSSLRecord(id, normalizedDomain, 'active', {
      renewed_from: record.ssl_status || 'not_configured',
    });
    record.ssl_enabled = true;
    record.ssl_status = 'active';
    record.updated_at = isoNow();
    return clone(ssl);
  }

  redirectDomain(clientId, from, to) {
    const id = ensureClientId(clientId);
    const fromDomain = ensureDomain(from);
    const toDomain = ensureDomain(to);
    this._getDomainRecord(id, fromDomain);
    const rule = {
      client_id: id,
      from: fromDomain,
      to: toDomain,
      type: '301',
      enabled: true,
      created_at: isoNow(),
      updated_at: isoNow(),
    };
    this._redirects.set(`${id}:${fromDomain}`, rule);
    const record = this._getDomainRecord(id, fromDomain);
    record.redirect_target = toDomain;
    record.updated_at = isoNow();
    return clone(rule);
  }
}

// ── 3. BrandingManager ──────────────────────────────────────────────────────

export class BrandingManager {
  constructor() {
    this._assets = new Map();
  }

  _clientAssets(clientId) {
    const id = ensureClientId(clientId);
    if (!this._assets.has(id)) this._assets.set(id, {});
    return this._assets.get(id);
  }

  setLogo(clientId, logoUrl, options = {}) {
    const id = ensureClientId(clientId);
    if (!logoUrl) throw new Error('logo_url required');
    const asset = {
      client_id: id,
      type: 'logo',
      url: logoUrl,
      options: { alt: `${id} logo`, ...options },
      created_at: isoNow(),
      updated_at: isoNow(),
    };
    this._clientAssets(id).logo = asset;
    return clone(asset);
  }

  getLogo(clientId) {
    const asset = this._clientAssets(clientId).logo;
    if (!asset) throw new Error(`Logo not found for client '${ensureClientId(clientId)}'`);
    return clone(asset);
  }

  setFavicon(clientId, faviconUrl) {
    const id = ensureClientId(clientId);
    if (!faviconUrl) throw new Error('favicon_url required');
    const asset = {
      client_id: id,
      type: 'favicon',
      url: faviconUrl,
      options: {},
      created_at: isoNow(),
      updated_at: isoNow(),
    };
    this._clientAssets(id).favicon = asset;
    return clone(asset);
  }

  getFavicon(clientId) {
    const asset = this._clientAssets(clientId).favicon;
    if (!asset) throw new Error(`Favicon not found for client '${ensureClientId(clientId)}'`);
    return clone(asset);
  }

  setColorPalette(clientId, colors = {}) {
    const id = ensureClientId(clientId);
    if (!isPlainObject(colors)) throw new Error('colors must be an object');
    const errors = validateColors(colors);
    if (errors.length) throw new Error(errors.join('; '));
    const palette = {
      client_id: id,
      colors: { ...DEFAULT_COLORS, ...colors },
      created_at: isoNow(),
      updated_at: isoNow(),
    };
    this._clientAssets(id).colors = palette;
    return clone(palette);
  }

  getColorPalette(clientId) {
    const palette = this._clientAssets(clientId).colors;
    if (!palette) throw new Error(`Color palette not found for client '${ensureClientId(clientId)}'`);
    return clone(palette);
  }

  setFonts(clientId, fonts = {}) {
    const id = ensureClientId(clientId);
    if (!isPlainObject(fonts)) throw new Error('fonts must be an object');
    const fontConfig = {
      client_id: id,
      fonts: { ...DEFAULT_FONTS, ...fonts },
      created_at: isoNow(),
      updated_at: isoNow(),
    };
    this._clientAssets(id).fonts = fontConfig;
    return clone(fontConfig);
  }

  getFonts(clientId) {
    const fonts = this._clientAssets(clientId).fonts;
    if (!fonts) throw new Error(`Fonts not found for client '${ensureClientId(clientId)}'`);
    return clone(fonts);
  }

  setCustomCSS(clientId, css = '') {
    const id = ensureClientId(clientId);
    const cssConfig = {
      client_id: id,
      css: String(css || ''),
      created_at: isoNow(),
      updated_at: isoNow(),
    };
    this._clientAssets(id).css = cssConfig;
    return clone(cssConfig);
  }

  getCustomCSS(clientId) {
    const css = this._clientAssets(clientId).css;
    if (!css) throw new Error(`Custom CSS not found for client '${ensureClientId(clientId)}'`);
    return clone(css);
  }

  previewBranding(clientId) {
    const assets = this._clientAssets(clientId);
    return {
      client_id: ensureClientId(clientId),
      logo: assets.logo ? clone(assets.logo) : null,
      favicon: assets.favicon ? clone(assets.favicon) : null,
      colors: assets.colors ? clone(assets.colors.colors) : { ...DEFAULT_COLORS },
      fonts: assets.fonts ? clone(assets.fonts.fonts) : { ...DEFAULT_FONTS },
      css: assets.css ? clone(assets.css.css) : '',
      preview_url: `https://preview.vireo.studio/white-label/${ensureClientId(clientId)}`,
      generated_at: isoNow(),
    };
  }
}

// ── 4. ThemeManager ─────────────────────────────────────────────────────────

export class ThemeManager {
  constructor() {
    this._themes = new Map();
    this.presets = [
      {
        id: 'vireo_modern',
        name: 'Vireo Modern',
        description: 'Clean, high-contrast default theme.',
        theme: {
          colors: { ...DEFAULT_COLORS, primary: '#6d5dfc' },
          fonts: { ...DEFAULT_FONTS },
          radius: 14,
          density: 'comfortable',
        },
      },
      {
        id: 'agency_dark',
        name: 'Agency Dark',
        description: 'Dark studio theme for media teams.',
        theme: {
          colors: { ...DEFAULT_COLORS, background: '#0f172a', surface: '#1e293b', text: '#f8fafc', muted: '#cbd5e1' },
          fonts: { ...DEFAULT_FONTS },
          radius: 10,
          density: 'compact',
        },
      },
      {
        id: 'editorial_light',
        name: 'Editorial Light',
        description: 'Warm, editorial theme for publishing teams.',
        theme: {
          colors: { ...DEFAULT_COLORS, primary: '#7c3aed', secondary: '#f97316', background: '#fffaf0', surface: '#fff7ed' },
          fonts: { heading: 'Georgia', body: 'Inter', mono: 'JetBrains Mono' },
          radius: 18,
          density: 'comfortable',
        },
      },
    ];
  }

  _clientThemes(clientId) {
    const id = ensureClientId(clientId);
    if (!this._themes.has(id)) this._themes.set(id, { themes: new Map(), active: null });
    return this._themes.get(id);
  }

  createTheme(clientId, theme = {}) {
    const id = ensureClientId(clientId);
    if (!isPlainObject(theme)) throw new Error('theme must be an object');
    const clientThemes = this._clientThemes(id);
    const themeId = theme.id || makeId('theme');
    const created = {
      id: themeId,
      client_id: id,
      name: theme.name || themeId,
      description: theme.description || '',
      colors: { ...DEFAULT_COLORS, ...(theme.colors || {}) },
      fonts: { ...DEFAULT_FONTS, ...(theme.fonts || {}) },
      radius: theme.radius ?? 12,
      density: theme.density || 'comfortable',
      custom_css: theme.custom_css || '',
      active: false,
      created_at: isoNow(),
      updated_at: isoNow(),
    };
    clientThemes.themes.set(themeId, created);
    if (!clientThemes.active) clientThemes.active = themeId;
    return this.getTheme(id, themeId);
  }

  getTheme(clientId, themeId) {
    const id = ensureClientId(clientId);
    const clientThemes = this._clientThemes(id);
    const selected = themeId || clientThemes.active;
    const theme = selected ? clientThemes.themes.get(selected) : null;
    if (!theme) throw new Error(`Theme '${selected || 'active'}' not found for client '${id}'`);
    return clone(theme);
  }

  updateTheme(clientId, themeId, updates = {}) {
    const id = ensureClientId(clientId);
    const clientThemes = this._clientThemes(id);
    const existing = clientThemes.themes.get(themeId);
    if (!existing) throw new Error(`Theme '${themeId}' not found for client '${id}'`);
    const next = mergeDeep(existing, updates);
    next.id = themeId;
    next.client_id = id;
    next.updated_at = isoNow();
    clientThemes.themes.set(themeId, next);
    return this.getTheme(id, themeId);
  }

  listThemes(clientId) {
    const id = ensureClientId(clientId);
    const clientThemes = this._clientThemes(id);
    return [...clientThemes.themes.values()].map(clone).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  activateTheme(clientId, themeId) {
    const id = ensureClientId(clientId);
    const clientThemes = this._clientThemes(id);
    if (!clientThemes.themes.has(themeId)) throw new Error(`Theme '${themeId}' not found for client '${id}'`);
    for (const theme of clientThemes.themes.values()) theme.active = false;
    const active = clientThemes.themes.get(themeId);
    active.active = true;
    active.updated_at = isoNow();
    clientThemes.active = themeId;
    return clone(active);
  }

  deactivateTheme(clientId, themeId) {
    const id = ensureClientId(clientId);
    const clientThemes = this._clientThemes(id);
    const theme = clientThemes.themes.get(themeId);
    if (!theme) throw new Error(`Theme '${themeId}' not found for client '${id}'`);
    theme.active = false;
    theme.updated_at = isoNow();
    if (clientThemes.active === themeId) clientThemes.active = null;
  }

  getThemePresets() {
    return clone(this.presets);
  }

  exportTheme(clientId) {
    const active = this.getTheme(clientId);
    return {
      format: 'vireo.white_label.theme.v1',
      exported_at: isoNow(),
      theme: active,
    };
  }

  importTheme(clientId, themeData) {
    const id = ensureClientId(clientId);
    const source = themeData?.theme || themeData;
    if (!isPlainObject(source)) throw new Error('themeData must contain a theme object');
    const imported = this.createTheme(id, {
      ...source,
      id: source.id || makeId('theme_import'),
    });
    if (source.active) this.activateTheme(id, imported.id);
    return this.getTheme(id, imported.id);
  }
}

// ── 5. CustomDomainDNS ──────────────────────────────────────────────────────

export class CustomDomainDNS {
  constructor() {
    this._updates = new Map();
  }

  generateDNSConfig(domain, config = {}) {
    const normalizedDomain = ensureDomain(domain);
    const records = recommendedDNSRecords(normalizedDomain, config);
    return {
      domain: normalizedDomain,
      records,
      cdn: this.getCDNConfig(normalizedDomain),
      ssl: {
        enabled: Boolean(config.ssl),
        provider: config.ssl_provider || 'vireo_managed',
      },
      verification_token: records.find((record) => record.type === 'TXT' && record.name === '_vireo-verification')?.value,
      generated_at: isoNow(),
    };
  }

  verifyDNS(domain, expectedRecords = []) {
    const normalizedDomain = ensureDomain(domain);
    const recommended = this.getRecommendedRecords(normalizedDomain);
    const errors = [];
    for (const expected of expectedRecords) {
      const match = recommended.some((record) => (
        record.type === expected.type &&
        record.name === (expected.name || normalizeDomain(normalizedDomain)) &&
        String(record.value) === String(expected.value)
      ));
      if (!match) errors.push(`Missing ${expected.type} record for ${expected.name || normalizedDomain}`);
    }
    return {
      domain: normalizedDomain,
      verified: errors.length === 0,
      records_checked: expectedRecords.length,
      errors,
      checked_at: isoNow(),
    };
  }

  getRecommendedRecords(domain) {
    return recommendedDNSRecords(domain);
  }

  checkPropagation(domain) {
    const normalizedDomain = ensureDomain(domain);
    const records = this.getRecommendedRecords(normalizedDomain);
    const propagated = records.every((record) => record.ttl <= 3600);
    return {
      domain: normalizedDomain,
      propagated,
      records,
      progress_percent: propagated ? 100 : 75,
      checked_at: isoNow(),
    };
  }

  getCDNConfig(domain) {
    const normalizedDomain = ensureDomain(domain);
    return {
      domain: normalizedDomain,
      enabled: true,
      provider: 'vireo_edge',
      cache_policy: 'aggressive',
      edge_locations: ['iad', 'sfo', 'ams', 'sin'],
      waf_enabled: true,
      compression: true,
    };
  }

  updateDNS(domain, records = []) {
    const normalizedDomain = ensureDomain(domain);
    if (!Array.isArray(records)) throw new Error('records must be an array');
    const existing = this.getRecommendedRecords(normalizedDomain);
    const byKey = (record) => `${record.type}:${record.name}`;
    const existingByKey = new Map(existing.map((record) => [byKey(record), record]));
    let changedCount = 0;
    for (const record of records) {
      const key = byKey(record);
      const old = existingByKey.get(key);
      if (!old || JSON.stringify(old) !== JSON.stringify(record)) changedCount += 1;
      existingByKey.set(key, record);
    }
    const updated = [...existingByKey.values()];
    const update = {
      domain: normalizedDomain,
      updated: true,
      changed_count: changedCount,
      records: updated,
      updated_at: isoNow(),
    };
    this._updates.set(normalizedDomain, clone(update));
    return clone(update);
  }
}

// ── 6. EnterprisePortal ─────────────────────────────────────────────────────

export class EnterprisePortal {
  constructor() {
    this._portals = new Map();
  }

  createPortal(clientId, portalConfig = {}) {
    const id = ensureClientId(clientId);
    if (!isPlainObject(portalConfig)) throw new Error('portalConfig must be an object');
    const portal = {
      id: portalConfig.id || makeId('portal'),
      client_id: id,
      name: portalConfig.name || `${id} Portal`,
      url: portalConfig.url || `https://${id}.portal.vireo.studio`,
      status: portalConfig.status || 'active',
      branding: clone(portalConfig.branding || {}),
      users: [],
      created_at: isoNow(),
      updated_at: isoNow(),
    };
    this._portals.set(id, portal);
    return this.getPortal(id);
  }

  getPortal(clientId) {
    const id = ensureClientId(clientId);
    const portal = this._portals.get(id);
    if (!portal) throw new Error(`Portal not found for client '${id}'`);
    return clone(portal);
  }

  updatePortal(clientId, updates = {}) {
    const id = ensureClientId(clientId);
    const portal = this._portals.get(id);
    if (!portal) throw new Error(`Portal not found for client '${id}'`);
    const next = mergeDeep(portal, updates);
    next.id = portal.id;
    next.client_id = id;
    next.updated_at = isoNow();
    this._portals.set(id, next);
    return this.getPortal(id);
  }

  getPortalStats(clientId) {
    const portal = this.getPortal(clientId);
    return {
      client_id: portal.client_id,
      users: portal.users.length,
      tickets: 0,
      status: portal.status,
      active_sessions: Math.max(1, Math.floor(portal.users.length / 2)),
      generated_at: isoNow(),
    };
  }

  getPortalUsers(clientId) {
    return clone(this.getPortal(clientId).users);
  }

  addPortalUser(clientId, user = {}) {
    const portal = this.getPortal(clientId);
    const userId = user.id || makeId('portal_user');
    const portalUser = {
      id: userId,
      client_id: portal.client_id,
      email: user.email || `${userId}@example.com`,
      name: user.name || userId,
      role: user.role || 'member',
      status: user.status || 'active',
      created_at: isoNow(),
      updated_at: isoNow(),
    };
    portal.users.push(portalUser);
    portal.updated_at = isoNow();
    return clone(portalUser);
  }

  removePortalUser(clientId, userId) {
    const portal = this.getPortal(clientId);
    const before = portal.users.length;
    portal.users = portal.users.filter((user) => user.id !== userId);
    portal.updated_at = isoNow();
    return portal.users.length !== before;
  }

  getPortalBranding(clientId) {
    return clone(this.getPortal(clientId).branding);
  }

  updatePortalBranding(clientId, branding = {}) {
    const portal = this.getPortal(clientId);
    portal.branding = mergeDeep(portal.branding || {}, branding);
    portal.updated_at = isoNow();
    return clone(portal.branding);
  }
}

// ── 7. CustomAppBuilder ─────────────────────────────────────────────────────

export class CustomAppBuilder {
  constructor() {
    this._builds = new Map();
    this._logs = new Map();
    this._appConfigs = new Map();
  }

  _clientBuilds(clientId) {
    const id = ensureClientId(clientId);
    if (!this._builds.has(id)) this._builds.set(id, new Map());
    return this._builds.get(id);
  }

  _clientLogs(clientId) {
    const id = ensureClientId(clientId);
    if (!this._logs.has(id)) this._logs.set(id, []);
    return this._logs.get(id);
  }

  buildApp(clientId, options = {}) {
    const id = ensureClientId(clientId);
    const buildId = options.build_id || makeId('build');
    const build = {
      id: buildId,
      client_id: id,
      status: 'built',
      target: options.target || 'web',
      version: options.version || '1.0.0',
      artifact_url: options.artifact_url || `https://cdn.vireo.studio/apps/${id}/${buildId}.zip`,
      checksum: options.checksum || `sha256_${hashString(`${id}:${buildId}`).toString(16)}`,
      size_bytes: options.size_bytes || 1024 * 1024,
      created_at: isoNow(),
      updated_at: isoNow(),
    };
    this._clientBuilds(id).set(buildId, build);
    this._clientLogs(id).push({
      client_id: id,
      build_id: buildId,
      level: 'info',
      message: `Build ${buildId} completed`,
      timestamp: isoNow(),
    });
    this._appConfigs.set(id, {
      client_id: id,
      build_id: buildId,
      options: clone(options),
      updated_at: isoNow(),
    });
    return clone(build);
  }

  getAppBuild(clientId, buildId) {
    const id = ensureClientId(clientId);
    const build = this._clientBuilds(id).get(buildId);
    if (!build) throw new Error(`Build '${buildId}' not found for client '${id}'`);
    return clone(build);
  }

  listBuilds(clientId) {
    const id = ensureClientId(clientId);
    return [...this._clientBuilds(id).values()].map(clone).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  deployApp(clientId, buildId, target = 'production') {
    const build = this.getAppBuild(clientId, buildId);
    build.status = 'deployed';
    build.target = target;
    build.deployed_at = isoNow();
    build.updated_at = isoNow();
    this._clientBuilds(ensureClientId(clientId)).set(buildId, build);
    this._clientLogs(ensureClientId(clientId)).push({
      client_id: ensureClientId(clientId),
      build_id: buildId,
      level: 'info',
      message: `Deployed ${buildId} to ${target}`,
      timestamp: isoNow(),
    });
    return {
      client_id: build.client_id,
      build_id: buildId,
      target,
      status: 'deployed',
      deployed_at: build.deployed_at,
      url: `https://${ensureClientId(clientId)}.app.vireo.studio`,
    };
  }

  getDeployStatus(clientId, buildId) {
    const build = this.getAppBuild(clientId, buildId);
    return {
      client_id: build.client_id,
      build_id: buildId,
      status: build.status,
      target: build.target,
      deployed_at: build.deployed_at || null,
      checked_at: isoNow(),
    };
  }

  rollbackApp(clientId, buildId) {
    const build = this.getAppBuild(clientId, buildId);
    build.status = 'rolled_back';
    build.updated_at = isoNow();
    this._clientBuilds(ensureClientId(clientId)).set(buildId, build);
    this._clientLogs(ensureClientId(clientId)).push({
      client_id: ensureClientId(clientId),
      build_id: buildId,
      level: 'warn',
      message: `Rolled back ${buildId}`,
      timestamp: isoNow(),
    });
    return {
      client_id: build.client_id,
      build_id: buildId,
      status: 'rolled_back',
      rolled_back_at: isoNow(),
    };
  }

  getBuildLogs(clientId, buildId) {
    const id = ensureClientId(clientId);
    return clone(this._clientLogs(id).filter((entry) => entry.build_id === buildId));
  }

  getAppConfig(clientId) {
    const id = ensureClientId(clientId);
    const config = this._appConfigs.get(id);
    if (!config) throw new Error(`App config not found for client '${id}'`);
    return clone(config);
  }
}

// ── 8. WhiteLabelAnalytics ──────────────────────────────────────────────────

export class WhiteLabelAnalytics {
  constructor() {
    this._pageViews = new Map();
    this._events = new Map();
  }

  _clientViews(clientId) {
    const id = ensureClientId(clientId);
    if (!this._pageViews.has(id)) this._pageViews.set(id, []);
    return this._pageViews.get(id);
  }

  _clientEvents(clientId) {
    const id = ensureClientId(clientId);
    if (!this._events.has(id)) this._events.set(id, []);
    return this._events.get(id);
  }

  trackPageView(clientId, page, userId = null) {
    const id = ensureClientId(clientId);
    this._clientViews(id).push({
      client_id: id,
      page: page || '/',
      user_id: userId || 'anonymous',
      timestamp: isoNow(),
    });
  }

  trackEvent(clientId, eventName, eventData = {}) {
    const id = ensureClientId(clientId);
    this._clientEvents(id).push({
      client_id: id,
      name: eventName,
      data: clone(eventData),
      timestamp: isoNow(),
    });
  }

  getAnalytics(clientId, startDate, endDate) {
    const id = ensureClientId(clientId);
    const views = this._clientViews(id).filter((view) => dateInWindow(view.timestamp, startDate, endDate));
    const events = this._clientEvents(id).filter((event) => dateInWindow(event.timestamp, startDate, endDate));
    const uniqueUsers = new Set([...views.map((view) => view.user_id), ...events.map((event) => event.data?.user_id).filter(Boolean)]);
    return {
      client_id: id,
      start_date: startDate || null,
      end_date: endDate || null,
      page_views: views.length,
      events: events.length,
      unique_users: uniqueUsers.size,
      top_pages: this.getTopPages(id),
      generated_at: isoNow(),
    };
  }

  getTopPages(clientId, limit = 10) {
    const id = ensureClientId(clientId);
    const counts = new Map();
    for (const view of this._clientViews(id)) {
      counts.set(view.page, (counts.get(view.page) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([page, views]) => ({ client_id: id, page, views }))
      .sort((a, b) => b.views - a.views || a.page.localeCompare(b.page))
      .slice(0, limit);
  }

  getUserStats(clientId) {
    const id = ensureClientId(clientId);
    const users = new Map();
    for (const view of this._clientViews(id)) {
      users.set(view.user_id, (users.get(view.user_id) || 0) + 1);
    }
    return {
      client_id: id,
      total_users: users.size,
      returning_users: [...users.values()].filter((count) => count > 1).length,
      generated_at: isoNow(),
    };
  }

  getConversionStats(clientId) {
    const id = ensureClientId(clientId);
    const events = this._clientEvents(id);
    const conversions = events.filter((event) => ['signup', 'purchase', 'subscribe'].includes(event.name)).length;
    const views = this._clientViews(id).length;
    return {
      client_id: id,
      conversions,
      conversion_rate: views ? Number((conversions / views).toFixed(4)) : 0,
      generated_at: isoNow(),
    };
  }

  getCustomEvents(clientId) {
    return clone(this._clientEvents(ensureClientId(clientId)));
  }

  exportAnalytics(clientId, startDate, endDate) {
    const report = this.getAnalytics(clientId, startDate, endDate);
    return {
      format: 'vireo.white_label.analytics.v1',
      exported_at: isoNow(),
      report,
    };
  }
}

// ── 9. LicensingManager ─────────────────────────────────────────────────────

export class LicensingManager {
  constructor() {
    this._licenses = new Map();
    this._history = new Map();
  }

  createLicense(clientId, licenseType = 'professional') {
    const id = ensureClientId(clientId);
    const type = LICENSE_FEATURES[licenseType] ? licenseType : 'professional';
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const license = {
      id: makeId('license'),
      client_id: id,
      type,
      status: 'active',
      features: [...LICENSE_FEATURES[type]],
      seats: type === 'enterprise' ? 100 : type === 'professional' ? 25 : type === 'starter' ? 5 : 1,
      created_at: isoNow(),
      updated_at: isoNow(),
      expires_at: expiresAt.toISOString(),
    };
    this._licenses.set(id, license);
    this._addHistory(id, 'created', type);
    return this.getLicense(id);
  }

  getLicense(clientId) {
    const id = ensureClientId(clientId);
    const license = this._licenses.get(id);
    if (!license) throw new Error(`License not found for client '${id}'`);
    return clone(license);
  }

  updateLicense(clientId, updates = {}) {
    const id = ensureClientId(clientId);
    const license = this._licenses.get(id);
    if (!license) throw new Error(`License not found for client '${id}'`);
    const next = mergeDeep(license, updates);
    next.id = license.id;
    next.client_id = id;
    next.updated_at = isoNow();
    this._licenses.set(id, next);
    return this.getLicense(id);
  }

  validateLicense(clientId) {
    const license = this.getLicense(clientId);
    const expired = new Date(license.expires_at).getTime() < Date.now();
    return {
      client_id: license.client_id,
      valid: license.status === 'active' && !expired,
      status: expired ? 'expired' : license.status,
      license_id: license.id,
      type: license.type,
      features: license.features,
      checked_at: isoNow(),
    };
  }

  getLicenseFeatures(licenseType = 'professional') {
    return [...(LICENSE_FEATURES[licenseType] || LICENSE_FEATURES.professional)];
  }

  getLicenseUsage(clientId) {
    const license = this.getLicense(clientId);
    return {
      client_id: license.client_id,
      seats_used: Math.min(license.seats, Math.max(1, Math.floor(license.seats * 0.4))),
      seats_total: license.seats,
      storage_gb_used: license.type === 'enterprise' ? 250 : 50,
      storage_gb_total: license.type === 'enterprise' ? 1000 : 200,
      generated_at: isoNow(),
    };
  }

  getLicenseHistory(clientId) {
    const id = ensureClientId(clientId);
    return clone(this._history.get(id) || []);
  }

  renewLicense(clientId, duration = '1y') {
    const license = this.getLicense(clientId);
    const multiplier = { '1m': 1, '3m': 3, '6m': 6, '1y': 12, '2y': 24 }[duration] || 12;
    const expiresAt = new Date(Date.now() + multiplier * 30 * 24 * 60 * 60 * 1000);
    license.status = 'active';
    license.expires_at = expiresAt.toISOString();
    license.updated_at = isoNow();
    this._licenses.set(license.client_id, license);
    this._addHistory(license.client_id, 'renewed', `${duration}:${license.type}`);
    return this.getLicense(license.client_id);
  }

  _addHistory(clientId, action, detail) {
    const id = ensureClientId(clientId);
    if (!this._history.has(id)) this._history.set(id, []);
    this._history.get(id).push({
      client_id: id,
      action,
      detail,
      timestamp: isoNow(),
    });
  }
}

// ── 10. SupportManager ──────────────────────────────────────────────────────

export class SupportManager {
  constructor() {
    this._tickets = new Map();
  }

  _clientTickets(clientId) {
    const id = ensureClientId(clientId);
    if (!this._tickets.has(id)) this._tickets.set(id, new Map());
    return this._tickets.get(id);
  }

  createTicket(clientId, ticket = {}) {
    const id = ensureClientId(clientId);
    if (!isPlainObject(ticket)) throw new Error('ticket must be an object');
    const ticketId = ticket.id || makeId('ticket');
    const supportTicket = {
      id: ticketId,
      client_id: id,
      subject: ticket.subject || 'White-label support request',
      description: ticket.description || '',
      priority: ticket.priority || 'normal',
      status: 'open',
      category: ticket.category || 'white_label',
      assigned_to: ticket.assigned_to || null,
      created_at: isoNow(),
      updated_at: isoNow(),
    };
    this._clientTickets(id).set(ticketId, supportTicket);
    return this.getTicket(id, ticketId);
  }

  getTicket(clientId, ticketId) {
    const id = ensureClientId(clientId);
    const supportTicket = this._clientTickets(id).get(ticketId);
    if (!supportTicket) throw new Error(`Ticket '${ticketId}' not found for client '${id}'`);
    return clone(supportTicket);
  }

  listTickets(clientId) {
    const id = ensureClientId(clientId);
    return [...this._clientTickets(id).values()].map(clone).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  updateTicket(clientId, ticketId, updates = {}) {
    const id = ensureClientId(clientId);
    const supportTicket = this._clientTickets(id).get(ticketId);
    if (!supportTicket) throw new Error(`Ticket '${ticketId}' not found for client '${id}'`);
    const next = mergeDeep(supportTicket, updates);
    next.id = ticketId;
    next.client_id = id;
    next.updated_at = isoNow();
    this._clientTickets(id).set(ticketId, next);
    return this.getTicket(id, ticketId);
  }

  closeTicket(clientId, ticketId) {
    return this.updateTicket(clientId, ticketId, { status: 'closed' });
  }

  getTicketStats(clientId) {
    const tickets = this.listTickets(clientId);
    return {
      client_id: ensureClientId(clientId),
      total: tickets.length,
      open: tickets.filter((ticket) => ticket.status === 'open').length,
      closed: tickets.filter((ticket) => ticket.status === 'closed').length,
      high_priority: tickets.filter((ticket) => ticket.priority === 'high').length,
      generated_at: isoNow(),
    };
  }

  getSLAStatus(clientId) {
    const stats = this.getTicketStats(clientId);
    const license = 'enterprise';
    return {
      client_id: stats.client_id,
      tier: license,
      sla_enabled: true,
      response_target_minutes: license === 'enterprise' ? 60 : 240,
      resolution_target_hours: license === 'enterprise' ? 8 : 48,
      compliant: stats.open <= 2,
      checked_at: isoNow(),
    };
  }

  assignTicket(clientId, ticketId, agentId) {
    return this.updateTicket(clientId, ticketId, { assigned_to: agentId });
  }
}

export const whiteLabelSystem = {
  WhiteLabelConfig,
  DomainManager,
  BrandingManager,
  ThemeManager,
  CustomDomainDNS,
  EnterprisePortal,
  CustomAppBuilder,
  WhiteLabelAnalytics,
  LicensingManager,
  SupportManager,
};

export default whiteLabelSystem;
