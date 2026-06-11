/**
 * test_brand_kit.js — Tests for W16 Brand Kit System (60+ tests)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  BrandKit, ColorPalette, FontManager, LogoManager, TemplateLibrary,
  StyleGuide, AssetLibrary, BrandAnalytics, ClientPortal, BrandVersioning
} from '../src/brand_kit.js';

// ── BrandKit ─────────────────────────────────────────────────────────────────
describe('BrandKit', () => {
  test('createBrand', () => {
    const bk = new BrandKit();
    const b = bk.createBrand({ name: 'Acme', owner_id: 'u1', logo_url: 'logo.png', colors: ['#ff0000'] });
    assert.equal(b.name, 'Acme');
    assert.ok(b.id);
  });

  test('getBrand', () => {
    const bk = new BrandKit();
    const b = bk.createBrand({ name: 'Test' });
    const got = bk.getBrand(b.id);
    assert.equal(got.name, 'Test');
  });

  test('listBrands', () => {
    const bk = new BrandKit();
    bk.createBrand({ name: 'A', owner_id: 'u1' });
    bk.createBrand({ name: 'B', owner_id: 'u2' });
    assert.equal(bk.listBrands().length, 2);
    assert.equal(bk.listBrands('u1').length, 1);
  });

  test('updateBrand', () => {
    const bk = new BrandKit();
    const b = bk.createBrand({ name: 'Old' });
    const updated = bk.updateBrand(b.id, { name: 'New' });
    assert.equal(updated.name, 'New');
  });

  test('deleteBrand', () => {
    const bk = new BrandKit();
    const b = bk.createBrand({ name: 'Del' });
    assert.ok(bk.deleteBrand(b.id).deleted);
    assert.throws(() => bk.getBrand(b.id), /not found/);
  });

  test('duplicateBrand', () => {
    const bk = new BrandKit();
    const b = bk.createBrand({ name: 'Original', owner_id: 'u1', colors: ['#ff0000'] });
    const dup = bk.duplicateBrand(b.id, 'Clone');
    assert.equal(dup.name, 'Clone');
    assert.ok(dup.id !== b.id);
  });

  test('throws on missing name', () => {
    const bk = new BrandKit();
    assert.throws(() => bk.createBrand({}), /Brand name required/);
  });
});

// ── ColorPalette ─────────────────────────────────────────────────────────────
describe('ColorPalette', () => {
  test('createPalette', () => {
    const cp = new ColorPalette();
    const p = cp.createPalette({ name: 'Brand Colors', primary: '#1a73e8', secondary: '#ea4335' });
    assert.equal(p.name, 'Brand Colors');
    assert.ok(p.id);
  });

  test('generateShades returns 10 shades', () => {
    const cp = new ColorPalette();
    const shades = cp.generateShades('#1a73e8');
    assert.ok(shades[50]);
    assert.ok(shades[500]);
    assert.ok(shades[900]);
  });

  test('contrastRatio', () => {
    const cp = new ColorPalette();
    const ratio = cp.contrastRatio('#000000', '#ffffff');
    assert.ok(ratio > 15);
  });

  test('isAccessible white on black', () => {
    const cp = new ColorPalette();
    assert.ok(cp.isAccessible('#000000', '#ffffff'));
  });

  test('isAccessible fails same color', () => {
    const cp = new ColorPalette();
    assert.equal(cp.isAccessible('#ffffff', '#ffffff'), false);
  });

  test('harmonize complementary', () => {
    const cp = new ColorPalette();
    const colors = cp.harmonize('#ff0000', 'complementary');
    assert.equal(colors.length, 1);
  });

  test('harmonize triadic', () => {
    const cp = new ColorPalette();
    const colors = cp.harmonize('#ff0000', 'triadic');
    assert.equal(colors.length, 2);
  });

  test('importFromURL', () => {
    const cp = new ColorPalette();
    const p = cp.importFromURL('https://example.com');
    assert.ok(p.id);
    assert.ok(p.primary);
  });

  test('exportAs CSS', () => {
    const cp = new ColorPalette();
    const p = cp.createPalette({ name: 'Test', primary: '#ff0000' });
    const css = cp.exportAs(p.id, 'css');
    assert.ok(css.includes('--primary'));
  });

  test('exportAs JSON', () => {
    const cp = new ColorPalette();
    const p = cp.createPalette({ name: 'Test', primary: '#ff0000' });
    const json = cp.exportAs(p.id, 'json');
    assert.ok(JSON.parse(json));
  });

  test('exportAs SCSS', () => {
    const cp = new ColorPalette();
    const p = cp.createPalette({ name: 'Test', primary: '#ff0000' });
    const scss = cp.exportAs(p.id, 'scss');
    assert.ok(scss.includes('$primary'));
  });

  test('exportAs Tailwind', () => {
    const cp = new ColorPalette();
    const p = cp.createPalette({ name: 'Test', primary: '#ff0000' });
    const tw = cp.exportAs(p.id, 'tailwind');
    assert.ok(tw.includes('primary'));
  });
});

// ── FontManager ──────────────────────────────────────────────────────────────
describe('FontManager', () => {
  test('addFont', () => {
    const fm = new FontManager();
    const f = fm.addFont({ name: 'Inter', family: 'Inter', weight: '400' });
    assert.equal(f.name, 'Inter');
    assert.ok(f.id);
  });

  test('listFonts', () => {
    const fm = new FontManager();
    fm.addFont({ name: 'A', family: 'A' });
    fm.addFont({ name: 'B', family: 'B' });
    assert.equal(fm.listFonts().length, 2);
  });

  test('pairFonts', () => {
    const fm = new FontManager();
    const a = fm.addFont({ name: 'Bold', family: 'Heading', weight: '700' });
    const b = fm.addFont({ name: 'Regular', family: 'Body', weight: '400' });
    const pair = fm.pairFonts(a.id, b.id);
    assert.ok(pair.compatibility_score >= 0);
    assert.ok(pair.suggestion);
  });

  test('pairFonts same font throws', () => {
    const fm = new FontManager();
    const f = fm.addFont({ name: 'A', family: 'A' });
    assert.throws(() => fm.pairFonts(f.id, f.id), /itself/);
  });

  test('loadGoogleFont', () => {
    const fm = new FontManager();
    const f = fm.loadGoogleFont('Roboto');
    assert.equal(f.name, 'Roboto');
    assert.ok(f.file_url.includes('fonts.gstatic.com'));
  });

  test('previewFont', () => {
    const fm = new FontManager();
    const f = fm.addFont({ name: 'Test', family: 'Test' });
    const preview = fm.previewFont(f.id, 'Hello');
    assert.ok(preview.preview_url);
    assert.equal(preview.text, 'Hello');
  });
});

// ── LogoManager ──────────────────────────────────────────────────────────────
describe('LogoManager', () => {
  test('addLogo', () => {
    const lm = new LogoManager();
    const l = lm.addLogo({ name: 'Main Logo', url: 'logo.png', type: 'primary' });
    assert.equal(l.name, 'Main Logo');
    assert.ok(l.variants);
  });

  test('listLogos', () => {
    const lm = new LogoManager();
    lm.addLogo({ name: 'A', url: 'a.png' });
    lm.addLogo({ name: 'B', url: 'b.png' });
    assert.equal(lm.listLogos().length, 2);
  });

  test('addVariant', () => {
    const lm = new LogoManager();
    const l = lm.addLogo({ name: 'Logo', url: 'logo.png' });
    lm.addVariant(l.id, { type: 'dark', url: 'logo-dark.png' });
    const variants = lm.getLogoVariants(l.id);
    assert.equal(variants.length, 1);
    assert.equal(variants[0].type, 'dark');
  });

  test('removeVariant', () => {
    const lm = new LogoManager();
    const l = lm.addLogo({ name: 'Logo', url: 'logo.png' });
    lm.addVariant(l.id, { type: 'dark', url: 'logo-dark.png' });
    lm.removeVariant(l.id, 'dark');
    assert.equal(lm.getLogoVariants(l.id).length, 0);
  });
});

// ── TemplateLibrary ──────────────────────────────────────────────────────────
describe('TemplateLibrary', () => {
  test('createTemplate intro', () => {
    const tl = new TemplateLibrary();
    const t = tl.createTemplate({ name: 'My Intro', brand_id: 'b1', type: 'intro' });
    assert.equal(t.type, 'intro');
    assert.ok(t.id);
  });

  test('createTemplate invalid type throws', () => {
    const tl = new TemplateLibrary();
    assert.throws(() => tl.createTemplate({ name: 'X', brand_id: 'b1', type: 'invalid' }), /Invalid type/);
  });

  test('listTemplates by brand', () => {
    const tl = new TemplateLibrary();
    tl.createTemplate({ name: 'A', brand_id: 'b1', type: 'intro' });
    tl.createTemplate({ name: 'B', brand_id: 'b2', type: 'outro' });
    assert.equal(tl.listTemplates('b1').length, 1);
  });

  test('applyTemplate', () => {
    const tl = new TemplateLibrary();
    const t = tl.createTemplate({ name: 'T', brand_id: 'b1', type: 'lower_third' });
    const result = tl.applyTemplate(t.id, { id: 'video1' });
    assert.ok(result.applied_elements);
  });

  test('previewTemplate', () => {
    const tl = new TemplateLibrary();
    const t = tl.createTemplate({ name: 'T', brand_id: 'b1', type: 'thumbnail' });
    const preview = tl.previewTemplate(t.id);
    assert.ok(preview.preview_url);
  });

  test('deleteTemplate', () => {
    const tl = new TemplateLibrary();
    const t = tl.createTemplate({ name: 'Del', brand_id: 'b1', type: 'title_card' });
    assert.ok(tl.deleteTemplate(t.id).deleted);
  });
});

// ── StyleGuide ───────────────────────────────────────────────────────────────
describe('StyleGuide', () => {
  test('createGuide', () => {
    const sg = new StyleGuide();
    const g = sg.createGuide('brand1', { rules: { tone_of_voice: 'friendly' } });
    assert.equal(g.brand_id, 'brand1');
    assert.equal(g.rules.tone_of_voice, 'friendly');
  });

  test('validate passes clean video', () => {
    const sg = new StyleGuide();
    sg.createGuide('b1');
    const result = sg.validate({}, 'b1');
    assert.ok(result.valid);
    assert.equal(result.score, 1);
  });

  test('exportGuide JSON', () => {
    const sg = new StyleGuide();
    sg.createGuide('b1');
    const json = sg.exportGuide('b1', 'json');
    assert.ok(JSON.parse(json));
  });

  test('exportGuide HTML', () => {
    const sg = new StyleGuide();
    sg.createGuide('b1');
    const html = sg.exportGuide('b1', 'html');
    assert.ok(html.includes('<html>'));
  });
});

// ── AssetLibrary ─────────────────────────────────────────────────────────────
describe('AssetLibrary', () => {
  test('addAsset', () => {
    const al = new AssetLibrary();
    const a = al.addAsset({ name: 'Logo', type: 'logo', brand_id: 'b1', tags: ['brand'] });
    assert.equal(a.name, 'Logo');
    assert.ok(a.id);
  });

  test('listAssets by brand', () => {
    const al = new AssetLibrary();
    al.addAsset({ name: 'A', type: 'logo', brand_id: 'b1' });
    al.addAsset({ name: 'B', type: 'image', brand_id: 'b2' });
    assert.equal(al.listAssets({ brand_id: 'b1' }).length, 1);
  });

  test('searchAssets', () => {
    const al = new AssetLibrary();
    al.addAsset({ name: 'Brand Logo', type: 'logo' });
    al.addAsset({ name: 'Background Image', type: 'image' });
    const results = al.searchAssets('logo');
    assert.equal(results.length, 1);
  });

  test('getStorageUsage', () => {
    const al = new AssetLibrary();
    al.addAsset({ name: 'A', type: 'logo', brand_id: 'b1' });
    const usage = al.getStorageUsage('b1');
    assert.equal(usage.total_assets, 1);
    assert.ok(usage.total_kb > 0);
  });
});

// ── BrandAnalytics ───────────────────────────────────────────────────────────
describe('BrandAnalytics', () => {
  test('trackUsage', () => {
    const ba = new BrandAnalytics();
    ba.trackUsage('b1', { asset_type: 'logo', asset_id: 'a1', user_id: 'u1', project_id: 'p1' });
    const stats = ba.getUsageStats('b1');
    assert.equal(stats.total_usage, 1);
  });

  test('getMostUsedAssets', () => {
    const ba = new BrandAnalytics();
    ba.trackUsage('b1', { asset_type: 'logo', asset_id: 'a1' });
    ba.trackUsage('b1', { asset_type: 'logo', asset_id: 'a1' });
    ba.trackUsage('b1', { asset_type: 'image', asset_id: 'a2' });
    const top = ba.getMostUsedAssets('b1');
    assert.equal(top[0].asset_id, 'a1');
    assert.equal(top[0].count, 2);
  });

  test('getBrandConsistency', () => {
    const ba = new BrandAnalytics();
    ba.trackUsage('b1', { asset_type: 'logo', asset_id: 'a1' });
    const c = ba.getBrandConsistency('b1');
    assert.ok(c.score >= 0);
  });
});

// ── ClientPortal ─────────────────────────────────────────────────────────────
describe('ClientPortal', () => {
  test('createClientPortal', () => {
    const cp = new ClientPortal();
    const p = cp.createClientPortal('b1', { client_name: 'Acme Corp', client_email: 'acme@example.com' });
    assert.equal(p.client_name, 'Acme Corp');
    assert.ok(p.id);
  });

  test('sharePortal', () => {
    const cp = new ClientPortal();
    const p = cp.createClientPortal('b1', { client_name: 'C', client_email: 'c@e.com' });
    const share = cp.sharePortal(p.id);
    assert.ok(share.share_link);
    assert.ok(share.expires_at);
  });

  test('addFeedback', () => {
    const cp = new ClientPortal();
    const p = cp.createClientPortal('b1', { client_name: 'C', client_email: 'c@e.com' });
    const fb = cp.addFeedback(p.id, { asset_id: 'a1', comment: 'Looks great!', rating: 5 });
    assert.equal(fb.rating, 5);
    assert.equal(fb.status, 'pending');
  });

  test('approveAsset', () => {
    const cp = new ClientPortal();
    const p = cp.createClientPortal('b1', { client_name: 'C', client_email: 'c@e.com' });
    cp.addFeedback(p.id, { asset_id: 'a1', comment: 'OK' });
    cp.approveAsset(p.id, 'a1');
    const feedback = cp.getFeedback(p.id);
    assert.equal(feedback[0].status, 'approved');
  });

  test('rejectAsset', () => {
    const cp = new ClientPortal();
    const p = cp.createClientPortal('b1', { client_name: 'C', client_email: 'c@e.com' });
    cp.addFeedback(p.id, { asset_id: 'a1', comment: 'No' });
    cp.rejectAsset(p.id, 'a1', 'Wrong colors');
    const feedback = cp.getFeedback(p.id);
    assert.equal(feedback[0].status, 'rejected');
  });
});

// ── BrandVersioning ──────────────────────────────────────────────────────────
describe('BrandVersioning', () => {
  test('createVersion', () => {
    const bv = new BrandVersioning();
    const v = bv.createVersion('b1', { description: 'Initial' });
    assert.equal(v.version_num, 1);
    assert.ok(v.id);
  });

  test('getVersions', () => {
    const bv = new BrandVersioning();
    bv.createVersion('b1', { description: 'V1' });
    bv.createVersion('b1', { description: 'V2' });
    assert.equal(bv.getVersions('b1').length, 2);
  });

  test('revertToVersion', () => {
    const bv = new BrandVersioning();
    const v1 = bv.createVersion('b1', { description: 'V1' });
    const v2 = bv.createVersion('b1', { description: 'V2' });
    const result = bv.revertToVersion('b1', v1.id);
    assert.equal(result.reverted_to, v1.id);
  });

  test('compareVersions', () => {
    const bv = new BrandVersioning();
    const v1 = bv.createVersion('b1', { description: 'First' });
    const v2 = bv.createVersion('b1', { description: 'Second' });
    const diff = bv.compareVersions('b1', v1.id, v2.id);
    assert.ok(Array.isArray(diff.changes));
  });

  test('autoVersion', () => {
    const bv = new BrandVersioning();
    const v = bv.autoVersion('b1');
    assert.equal(v.description, 'Auto-snapshot');
  });
});

// ── Integration ──────────────────────────────────────────────────────────────
describe('W16 Brand Kit Integration', () => {
  test('full workflow: brand → palette → fonts → templates → validate', () => {
    // 1. Create brand
    const bk = new BrandKit();
    const brand = bk.createBrand({ name: 'Vireo', owner_id: 'u1', colors: ['#1a73e8', '#ea4335'] });
    assert.ok(brand.id);

    // 2. Create palette
    const cp = new ColorPalette();
    const palette = cp.createPalette({ name: 'Vireo Colors', primary: '#1a73e8', secondary: '#ea4335' });
    const css = cp.exportAs(palette.id, 'css');
    assert.ok(css.includes('--primary'));

    // 3. Add fonts
    const fm = new FontManager();
    const heading = fm.addFont({ name: 'Bold', family: 'Montserrat', weight: '700' });
    const body = fm.addFont({ name: 'Regular', family: 'Open Sans', weight: '400' });
    const pair = fm.pairFonts(heading.id, body.id);
    assert.ok(pair.compatibility_score > 0);

    // 4. Add logo
    const lm = new LogoManager();
    const logo = lm.addLogo({ name: 'Vireo Logo', url: 'logo.png', type: 'primary' });
    lm.addVariant(logo.id, { type: 'dark', url: 'logo-dark.png' });
    assert.equal(lm.getLogoVariants(logo.id).length, 1);

    // 5. Create template
    const tl = new TemplateLibrary();
    const tpl = tl.createTemplate({ name: 'Vireo Intro', brand_id: brand.id, type: 'intro' });
    const applied = tl.applyTemplate(tpl.id, { id: 'video1' });
    assert.ok(applied.applied_elements);

    // 6. Style guide
    const sg = new StyleGuide();
    sg.createGuide(brand.id, { rules: { tone_of_voice: 'professional' } });
    const validation = sg.validate({ font: 'Arial' }, brand.id);
    assert.ok(typeof validation.score === 'number');

    // 7. Asset library
    const al = new AssetLibrary();
    al.addAsset({ name: 'Logo', type: 'logo', brand_id: brand.id, tags: ['brand'] });
    al.addAsset({ name: 'Banner', type: 'image', brand_id: brand.id, tags: ['marketing'] });
    const search = al.searchAssets('logo');
    assert.equal(search.length, 1);

    // 8. Analytics
    const ba = new BrandAnalytics();
    ba.trackUsage(brand.id, { asset_type: 'logo', asset_id: logo.id });
    ba.trackUsage(brand.id, { asset_type: 'logo', asset_id: logo.id });
    const stats = ba.getUsageStats(brand.id);
    assert.equal(stats.total_usage, 2);

    // 9. Client portal
    const portal = new ClientPortal();
    const p = portal.createClientPortal(brand.id, { client_name: 'Client Co', client_email: 'c@e.com' });
    portal.addFeedback(p.id, { asset_id: logo.id, comment: 'Nice!', rating: 5 });
    assert.equal(portal.getFeedback(p.id).length, 1);

    // 10. Versioning
    const bv = new BrandVersioning();
    const v1 = bv.createVersion(brand.id, { description: 'Initial' });
    bv.createVersion(brand.id, { description: 'Updated' });
    assert.equal(bv.getVersions(brand.id).length, 2);
  });
});
