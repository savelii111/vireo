/**
 * brand_kit.js — W16: Brand Kit System (10 classes)
 * Corporate branding: logos, fonts, colors, templates, style guides, client portals, versioning
 */

// ── Color Utilities ──────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return { r, g, b };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const [rs, gs, bs] = [r, g, b].map(c => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(hex1, hex2) {
  const l1 = luminance(hex1);
  const l2 = luminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Math.round((lighter + 0.05) / (darker + 0.05) * 100) / 100;
}

function generateShades(hex) {
  const { r, g, b } = hexToRgb(hex);
  return {
    900: rgbToHex(r * 0.2, g * 0.2, b * 0.2),
    800: rgbToHex(r * 0.3, g * 0.3, b * 0.3),
    700: rgbToHex(r * 0.45, g * 0.45, b * 0.45),
    600: rgbToHex(r * 0.6, g * 0.6, b * 0.6),
    500: hex,
    400: rgbToHex(r + (255 - r) * 0.25, g + (255 - g) * 0.25, b + (255 - b) * 0.25),
    300: rgbToHex(r + (255 - r) * 0.45, g + (255 - g) * 0.45, b + (255 - b) * 0.45),
    200: rgbToHex(r + (255 - r) * 0.7, g + (255 - g) * 0.7, b + (255 - b) * 0.7),
    100: rgbToHex(r + (255 - r) * 0.88, g + (255 - g) * 0.88, b + (255 - b) * 0.88),
    50: rgbToHex(r + (255 - r) * 0.95, g + (255 - g) * 0.95, b + (255 - b) * 0.95)
  };
}

function harmonize(hex, scheme) {
  const { r, g, b } = hexToRgb(hex);
  const hsl = rgbToHsl(r, g, b);
  const colors = [];
  const schemes = {
    complementary: [180],
    analogous: [-30, 30],
    triadic: [120, 240],
    'split-complementary': [150, 210]
  };
  const offsets = schemes[scheme] || [180];
  for (const offset of offsets) {
    const newH = (hsl.h + offset + 360) % 360;
    colors.push(hslToHex(newH, hsl.s, hsl.l));
  }
  return colors;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
  return rgbToHex(Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255));
}

// ── 1. BrandKit ──────────────────────────────────────────────────────────────

export class BrandKit {
  constructor() {
    this._brands = new Map();
    this._counter = 0;
  }

  createBrand({ name, owner_id, logo_url, colors = [], fonts = [], guidelines }) {
    if (!name) throw new Error('Brand name required');
    const id = `brand_${++this._counter}`;
    const brand = {
      id, name, owner_id, logo_url, colors, fonts, guidelines: guidelines || '',
      created_at: Date.now(), updated_at: Date.now()
    };
    this._brands.set(id, brand);
    return { ...brand };
  }

  getBrand(id) {
    const b = this._brands.get(id);
    if (!b) throw new Error(`Brand '${id}' not found`);
    return { ...b };
  }

  listBrands(ownerId) {
    const all = [...this._brands.values()];
    return ownerId ? all.filter(b => b.owner_id === ownerId) : all;
  }

  updateBrand(id, updates) {
    const b = this._brands.get(id);
    if (!b) throw new Error(`Brand '${id}' not found`);
    Object.assign(b, updates, { updated_at: Date.now() });
    return { ...b };
  }

  deleteBrand(id) {
    if (!this._brands.has(id)) throw new Error(`Brand '${id}' not found`);
    this._brands.delete(id);
    return { deleted: true };
  }

  duplicateBrand(id, newName) {
    const orig = this.getBrand(id);
    return this.createBrand({
      name: newName || `${orig.name} (Copy)`,
      owner_id: orig.owner_id,
      logo_url: orig.logo_url,
      colors: [...orig.colors],
      fonts: [...orig.fonts],
      guidelines: orig.guidelines
    });
  }
}

// ── 2. ColorPalette ──────────────────────────────────────────────────────────

export class ColorPalette {
  constructor() {
    this._palettes = new Map();
    this._counter = 0;
  }

  createPalette({ name, primary, secondary, accent, neutral, background }) {
    if (!name || !primary) throw new Error('Name and primary color required');
    const id = `palette_${++this._counter}`;
    const palette = { id, name, primary, secondary: secondary || '#000000', accent: accent || '#000000', neutral: neutral || '#808080', background: background || '#ffffff' };
    this._palettes.set(id, palette);
    return { ...palette };
  }

  getPalette(id) {
    const p = this._palettes.get(id);
    if (!p) throw new Error(`Palette '${id}' not found`);
    return { ...p };
  }

  generateShades(hex) { return generateShades(hex); }

  contrastRatio(c1, c2) { return contrastRatio(c1, c2); }

  isAccessible(c1, c2) { return contrastRatio(c1, c2) >= 4.5; }

  harmonize(baseColor, scheme) { return harmonize(baseColor, scheme); }

  importFromURL(url) {
    if (!url) throw new Error('URL required');
    // Simulate palette extraction from URL
    return this.createPalette({
      name: `Imported from ${new URL(url).hostname}`,
      primary: '#1a73e8',
      secondary: '#ea4335',
      accent: '#fbbc04',
      neutral: '#5f6368',
      background: '#ffffff'
    });
  }

  exportAs(id, format) {
    const p = this.getPalette(id);
    if (format === 'css') {
      return `:root {\n  --primary: ${p.primary};\n  --secondary: ${p.secondary};\n  --accent: ${p.accent};\n  --neutral: ${p.neutral};\n  --background: ${p.background};\n}`;
    }
    if (format === 'json') {
      return JSON.stringify(p);
    }
    if (format === 'scss') {
      return `$primary: ${p.primary};\n$secondary: ${p.secondary};\n$accent: ${p.accent};\n$neutral: ${p.neutral};\n$background: ${p.background};`;
    }
    if (format === 'tailwind') {
      return `colors: {\n  primary: '${p.primary}',\n  secondary: '${p.secondary}',\n  accent: '${p.accent}',\n  neutral: '${p.neutral}',\n  background: '${p.background}',\n}`;
    }
    throw new Error(`Unknown format: ${format}`);
  }
}

// ── 3. FontManager ───────────────────────────────────────────────────────────

export class FontManager {
  constructor() {
    this._fonts = new Map();
    this._counter = 0;
    this._pairings = [];
  }

  addFont({ name, family, weight = '400', style = 'normal', file_url }) {
    if (!name || !family) throw new Error('Name and family required');
    const id = `font_${++this._counter}`;
    const font = { id, name, family, weight, style, file_url: file_url || '', added_at: Date.now() };
    this._fonts.set(id, font);
    return { ...font };
  }

  getFont(id) {
    const f = this._fonts.get(id);
    if (!f) throw new Error(`Font '${id}' not found`);
    return { ...f };
  }

  listFonts() { return [...this._fonts.values()]; }

  pairFonts(primaryId, secondaryId) {
    const p = this.getFont(primaryId);
    const s = this.getFont(secondaryId);
    if (primaryId === secondaryId) throw new Error('Cannot pair font with itself');

    // Score compatibility: different families = better, heading+body = best
    let score = 0.5;
    if (p.family !== s.family) score += 0.2;
    if (parseInt(p.weight) >= 600 && parseInt(s.weight) < 600) score += 0.2; // heading + body
    score = Math.min(1, score);

    const pair = { primary: p, secondary: s, compatibility_score: Math.round(score * 100) / 100, suggestion: score > 0.7 ? 'Great pairing!' : 'Consider fonts with more contrast' };
    this._pairings.push(pair);
    return { ...pair };
  }

  getFontPairings() { return [...this._pairings]; }

  loadGoogleFont(fontName) {
    if (!fontName) throw new Error('Font name required');
    return this.addFont({
      name: fontName,
      family: fontName,
      weight: '400',
      style: 'normal',
      file_url: `https://fonts.gstatic.com/s/${fontName.toLowerCase().replace(/\s+/g, '')}/v1.woff2`
    });
  }

  previewFont(id, text) {
    const f = this.getFont(id);
    return { font_id: id, text, preview_url: `https://preview.vireo.studio/font/${id}?text=${encodeURIComponent(text || 'Sample')}`, family: f.family, weight: f.weight };
  }
}

// ── 4. LogoManager ───────────────────────────────────────────────────────────

export class LogoManager {
  constructor() {
    this._logos = new Map();
    this._counter = 0;
  }

  addLogo({ name, url, type = 'primary', variants = {} }) {
    if (!name || !url) throw new Error('Name and URL required');
    const id = `logo_${++this._counter}`;
    const logo = {
      id, name, url, type, variants: { dark: null, light: null, transparent: null, favicon: null, ...variants },
      added_at: Date.now()
    };
    this._logos.set(id, logo);
    return { ...logo };
  }

  getLogo(id) {
    const l = this._logos.get(id);
    if (!l) throw new Error(`Logo '${id}' not found`);
    return { ...l };
  }

  listLogos() { return [...this._logos.values()]; }

  getLogoVariants(id) {
    const logo = this.getLogo(id);
    return Object.entries(logo.variants)
      .filter(([_, url]) => url)
      .map(([type, url]) => ({ type, url, logo_id: id }));
  }

  addVariant(logoId, { type, url }) {
    const logo = this.getLogo(logoId);
    if (!type || !url) throw new Error('Type and URL required');
    logo.variants[type] = url;
    return { type, url, logo_id: logoId };
  }

  removeVariant(logoId, variantType) {
    const logo = this.getLogo(logoId);
    if (!logo.variants[variantType]) throw new Error(`Variant '${variantType}' not found`);
    logo.variants[variantType] = null;
    return { removed: true };
  }
}

// ── 5. TemplateLibrary ───────────────────────────────────────────────────────

export class TemplateLibrary {
  constructor() {
    this._templates = new Map();
    this._counter = 0;
  }

  createTemplate({ name, brand_id, type, elements = {} }) {
    if (!name || !brand_id || !type) throw new Error('Name, brand_id, type required');
    const validTypes = ['intro', 'outro', 'lower_third', 'thumbnail', 'title_card', 'end_screen'];
    if (!validTypes.includes(type)) throw new Error(`Invalid type: ${type}. Use: ${validTypes.join(', ')}`);

    const id = `tpl_${++this._counter}`;
    const template = {
      id, name, brand_id, type, elements: {
        text_positions: elements.text_positions || [],
        logo_position: elements.logo_position || { x: 0, y: 0 },
        color_overlay: elements.color_overlay || null,
        font_family: elements.font_family || 'sans-serif'
      },
      created_at: Date.now()
    };
    this._templates.set(id, template);
    return { ...template };
  }

  getTemplate(id) {
    const t = this._templates.get(id);
    if (!t) throw new Error(`Template '${id}' not found`);
    return { ...t };
  }

  listTemplates(brandId) {
    return [...this._templates.values()].filter(t => !brandId || t.brand_id === brandId);
  }

  applyTemplate(templateId, video) {
    const t = this.getTemplate(templateId);
    if (!video) throw new Error('Video required');
    return {
      template_id: templateId,
      video_id: video.id || 'unknown',
      applied_elements: t.elements,
      applied_at: Date.now()
    };
  }

  previewTemplate(templateId) {
    const t = this.getTemplate(templateId);
    return {
      template_id: templateId,
      type: t.type,
      preview_url: `https://preview.vireo.studio/template/${templateId}`,
      elements: t.elements
    };
  }

  deleteTemplate(id) {
    if (!this._templates.has(id)) throw new Error(`Template '${id}' not found`);
    this._templates.delete(id);
    return { deleted: true };
  }
}

// ── 6. StyleGuide ────────────────────────────────────────────────────────────

export class StyleGuide {
  constructor() {
    this._guides = new Map();
  }

  createGuide(brandId, { rules = {} } = {}) {
    const guide = {
      brand_id: brandId,
      rules: {
        min_logo_clearspace: rules.min_logo_clearspace || 20,
        max_logo_scale: rules.max_logo_scale || 30,
        primary_font_only: rules.primary_font_only ?? true,
        color_usage: rules.color_usage || { primary: 'headers', secondary: 'accents', accent: 'CTAs' },
        tone_of_voice: rules.tone_of_voice || 'professional',
        image_style: rules.image_style || 'clean',
        do_and_dont: rules.do_and_dont || { do: ['Use brand colors', 'Maintain clearspace'], dont: ['Stretch logos', 'Use unauthorized fonts'] }
      },
      created_at: Date.now()
    };
    this._guides.set(brandId, guide);
    return { ...guide };
  }

  getGuide(brandId) {
    const g = this._guides.get(brandId);
    if (!g) throw new Error(`Guide for brand '${brandId}' not found`);
    return { ...g };
  }

  updateRules(brandId, rules) {
    const guide = this.getGuide(brandId);
    guide.rules = { ...guide.rules, ...rules };
    return { ...guide };
  }

  validate(video, brandId) {
    const guide = this.getGuide(brandId);
    const violations = [];
    const suggestions = [];

    if (video.logo_position && video.brand_colors) {
      // Check logo clearspace
      if (video.logo_position.x < guide.rules.min_logo_clearspace || video.logo_position.y < guide.rules.min_logo_clearspace) {
        violations.push('Logo violates minimum clearspace');
      }
    }

    if (video.font && guide.rules.primary_font_only) {
      suggestions.push(`Consider using the brand's primary font instead of ${video.font}`);
    }

    return {
      valid: violations.length === 0,
      violations,
      suggestions,
      score: violations.length === 0 ? 1 : Math.max(0, 1 - violations.length * 0.3)
    };
  }

  exportGuide(brandId, format) {
    const guide = this.getGuide(brandId);
    const json = JSON.stringify(guide, null, 2);
    if (format === 'json') return json;
    if (format === 'html') {
      return `<!DOCTYPE html><html><head><title>Style Guide - ${brandId}</title></head><body><h1>Brand Style Guide</h1><pre>${json}</pre></body></html>`;
    }
    if (format === 'pdf') return `%PDF-1.4\n${json}`; // Simplified
    throw new Error(`Unknown format: ${format}`);
  }
}

// ── 7. AssetLibrary ──────────────────────────────────────────────────────────

export class AssetLibrary {
  constructor() {
    this._assets = new Map();
    this._counter = 0;
  }

  addAsset({ name, type, url, brand_id, tags = [] }) {
    if (!name || !type) throw new Error('Name and type required');
    const id = `asset_${++this._counter}`;
    const asset = { id, name, type, url: url || '', brand_id: brand_id || null, tags, size_kb: Math.round(Math.random() * 5000) + 100, added_at: Date.now() };
    this._assets.set(id, asset);
    return { ...asset };
  }

  getAsset(id) {
    const a = this._assets.get(id);
    if (!a) throw new Error(`Asset '${id}' not found`);
    return { ...a };
  }

  listAssets({ brand_id, type, tags } = {}) {
    return [...this._assets.values()].filter(a => {
      if (brand_id && a.brand_id !== brand_id) return false;
      if (type && a.type !== type) return false;
      if (tags && tags.length > 0 && !tags.some(t => a.tags.includes(t))) return false;
      return true;
    });
  }

  searchAssets(query) {
    if (!query) return [];
    const q = query.toLowerCase();
    return [...this._assets.values()].filter(a => a.name.toLowerCase().includes(q) || a.tags.some(t => t.toLowerCase().includes(q)));
  }

  deleteAsset(id) {
    if (!this._assets.has(id)) throw new Error(`Asset '${id}' not found`);
    this._assets.delete(id);
    return { deleted: true };
  }

  getAssetsByType(type) { return [...this._assets.values()].filter(a => a.type === type); }

  getStorageUsage(brandId) {
    const assets = brandId ? [...this._assets.values()].filter(a => a.brand_id === brandId) : [...this._assets.values()];
    const total_kb = assets.reduce((s, a) => s + (a.size_kb || 0), 0);
    return { total_assets: assets.length, total_kb, total_mb: Math.round(total_kb / 1024 * 10) / 10 };
  }
}

// ── 8. BrandAnalytics ────────────────────────────────────────────────────────

export class BrandAnalytics {
  constructor() {
    this._usage = new Map();
  }

  trackUsage(brandId, { asset_type, asset_id, user_id, project_id }) {
    const key = brandId;
    if (!this._usage.has(key)) this._usage.set(key, []);
    this._usage.get(key).push({ brand_id: brandId, asset_type, asset_id, user_id, project_id, timestamp: Date.now() });
  }

  getUsageStats(brandId, period = 'all') {
    const records = this._usage.get(brandId) || [];
    let filtered = records;
    if (period === 'day') {
      const cutoff = Date.now() - 86400000;
      filtered = records.filter(r => r.timestamp > cutoff);
    } else if (period === 'week') {
      const cutoff = Date.now() - 604800000;
      filtered = records.filter(r => r.timestamp > cutoff);
    } else if (period === 'month') {
      const cutoff = Date.now() - 2592000000;
      filtered = records.filter(r => r.timestamp > cutoff);
    }
    const byType = {};
    for (const r of filtered) { byType[r.asset_type] = (byType[r.asset_type] || 0) + 1; }
    return { brand_id: brandId, period, total_usage: filtered.length, by_type: byType };
  }

  getMostUsedAssets(brandId, limit = 5) {
    const records = this._usage.get(brandId) || [];
    const counts = {};
    for (const r of records) { counts[r.asset_id] = (counts[r.asset_id] || 0) + 1; }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, count]) => ({ asset_id: id, count }));
  }

  getBrandConsistency(brandId) {
    const records = this._usage.get(brandId) || [];
    const total = records.length;
    if (total === 0) return { score: 1, violations: [], suggestions: [] };
    // Simple consistency: fewer unique asset types = more consistent
    const types = new Set(records.map(r => r.asset_type));
    const score = Math.max(0, 1 - (types.size - 1) * 0.1);
    return { score: Math.round(score * 100) / 100, violations: [], suggestions: types.size > 3 ? ['Consider consolidating asset types'] : [] };
  }

  getComplianceRate(brandId) {
    const consistency = this.getBrandConsistency(brandId);
    return consistency.score;
  }
}

// ── 9. ClientPortal ──────────────────────────────────────────────────────────

export class ClientPortal {
  constructor() {
    this._portals = new Map();
    this._counter = 0;
  }

  createClientPortal(brandId, { client_name, client_email }) {
    if (!client_name || !client_email) throw new Error('Client name and email required');
    const id = `portal_${++this._counter}`;
    const portal = { id, brand_id: brandId, client_name, client_email, assets: [], feedback: [], status: 'active', created_at: Date.now() };
    this._portals.set(id, portal);
    return { ...portal };
  }

  sharePortal(portalId, { permissions = ['view'] } = {}) {
    const p = this._portals.get(portalId);
    if (!p) throw new Error(`Portal '${portalId}' not found`);
    return { portal_id: portalId, share_link: `https://portal.vireo.studio/${portalId}`, permissions, expires_at: Date.now() + 7 * 86400000 };
  }

  getPortalAssets(portalId) {
    const p = this._portals.get(portalId);
    if (!p) throw new Error(`Portal '${portalId}' not found`);
    return p.assets;
  }

  addFeedback(portalId, { asset_id, comment, rating = 5 }) {
    const p = this._portals.get(portalId);
    if (!p) throw new Error(`Portal '${portalId}' not found`);
    const fb = { id: `fb_${Date.now()}`, asset_id, comment, rating, status: 'pending', created_at: Date.now() };
    p.feedback.push(fb);
    return { ...fb };
  }

  getFeedback(portalId) {
    const p = this._portals.get(portalId);
    if (!p) throw new Error(`Portal '${portalId}' not found`);
    return [...p.feedback];
  }

  approveAsset(portalId, assetId) {
    const p = this._portals.get(portalId);
    if (!p) throw new Error(`Portal '${portalId}' not found`);
    const fb = p.feedback.find(f => f.asset_id === assetId);
    if (fb) fb.status = 'approved';
    return { approved: true, asset_id: assetId };
  }

  rejectAsset(portalId, assetId, reason) {
    const p = this._portals.get(portalId);
    if (!p) throw new Error(`Portal '${portalId}' not found`);
    const fb = p.feedback.find(f => f.asset_id === assetId);
    if (fb) { fb.status = 'rejected'; fb.reason = reason; }
    return { rejected: true, asset_id: assetId, reason };
  }
}

// ── 10. BrandVersioning ──────────────────────────────────────────────────────

export class BrandVersioning {
  constructor() {
    this._versions = new Map(); // brandId → Version[]
  }

  _getVersions(brandId) {
    if (!this._versions.has(brandId)) this._versions.set(brandId, []);
    return this._versions.get(brandId);
  }

  createVersion(brandId, { description = '' } = {}) {
    const versions = this._getVersions(brandId);
    const version = {
      id: `ver_${versions.length + 1}`,
      brand_id: brandId,
      version_num: versions.length + 1,
      description,
      snapshot: { timestamp: Date.now() },
      created_at: Date.now()
    };
    versions.push(version);
    return { ...version };
  }

  getVersion(brandId, versionId) {
    const versions = this._getVersions(brandId);
    const v = versions.find(v => v.id === versionId);
    if (!v) throw new Error(`Version '${versionId}' not found`);
    return { ...v };
  }

  getVersions(brandId) { return [...this._getVersions(brandId)]; }

  revertToVersion(brandId, versionId) {
    const version = this.getVersion(brandId, versionId);
    return { brand_id: brandId, reverted_to: versionId, version_num: version.version_num, restored_at: Date.now() };
  }

  compareVersions(brandId, v1Id, v2Id) {
    const v1 = this.getVersion(brandId, v1Id);
    const v2 = this.getVersion(brandId, v2Id);
    const changes = [];
    if (v1.description !== v2.description) changes.push({ field: 'description', old: v1.description, new: v2.description });
    if (v1.snapshot.timestamp !== v2.snapshot.timestamp) changes.push({ field: 'timestamp', old: v1.snapshot.timestamp, new: v2.snapshot.timestamp });
    return { version_1: v1Id, version_2: v2Id, changes, identical: changes.length === 0 };
  }

  autoVersion(brandId) {
    return this.createVersion(brandId, { description: 'Auto-snapshot' });
  }
}
