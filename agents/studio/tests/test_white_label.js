/**
 * test_white_label.js — Tests for W20 White-label System (60+ tests)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  WhiteLabelConfig, DomainManager, BrandingManager, ThemeManager, CustomDomainDNS,
  EnterprisePortal, CustomAppBuilder, WhiteLabelAnalytics, LicensingManager, SupportManager
} from '../src/white_label.js';

// ── WhiteLabelConfig ────────────────────────────────────────────────────────
describe('WhiteLabelConfig', () => {
  test('createConfig', () => {
    const wlc = new WhiteLabelConfig();
    const cfg = wlc.createConfig({ client_id: 'c1', brand_name: 'Acme', logo_url: 'logo.png', colors: { primary: '#ff0000' }, domain: 'acme.com' });
    assert.equal(cfg.client_id, 'c1');
    assert.ok(cfg.colors.primary);
  });

  test('getConfig', () => {
    const wlc = new WhiteLabelConfig();
    const cfg = wlc.createConfig({ client_id: 'c1', brand_name: 'Test' });
    const got = wlc.getConfig(cfg.client_id);
    assert.equal(got.brand_name, 'Test');
  });

  test('updateConfig', () => {
    const wlc = new WhiteLabelConfig();
    const cfg = wlc.createConfig({ client_id: 'c1', brand_name: 'Old' });
    const updated = wlc.updateConfig(cfg.client_id, { brand_name: 'New' });
    assert.equal(updated.brand_name, 'New');
  });

  test('deleteConfig', () => {
    const wlc = new WhiteLabelConfig();
    const cfg = wlc.createConfig({ client_id: 'c1', brand_name: 'Del' });
    assert.equal(wlc.deleteConfig(cfg.client_id), true);
  });

  test('listConfigs', () => {
    const wlc = new WhiteLabelConfig();
    wlc.createConfig({ client_id: 'c1', brand_name: 'A' });
    wlc.createConfig({ client_id: 'c2', brand_name: 'B' });
    assert.equal(wlc.listConfigs().length, 2);
  });

  test('validateConfig', () => {
    const wlc = new WhiteLabelConfig();
    const result = wlc.validateConfig({ client_id: 'c1', brand_name: 'Valid', colors: { primary: '#ff0000' } });
    assert.ok(result.valid);
  });

  test('exportConfig', () => {
    const wlc = new WhiteLabelConfig();
    const cfg = wlc.createConfig({ client_id: 'c1', brand_name: 'Export' });
    const exp = wlc.exportConfig(cfg.client_id);
    assert.ok(exp.config);
    assert.ok(exp.exported_at);
  });

  test('cloneConfig', () => {
    const wlc = new WhiteLabelConfig();
    const cfg = wlc.createConfig({ client_id: 'c1', brand_name: 'Original' });
    const clone = wlc.cloneConfig(cfg.client_id, 'c2');
    assert.equal(clone.brand_name, 'Original');
    assert.equal(clone.client_id, 'c2');
  });
});

// ── DomainManager ──────────────────────────────────────────────────────────
describe('DomainManager', () => {
  test('addDomain', () => {
    const dm = new DomainManager();
    const d = dm.addDomain('c1', 'example.com');
    assert.equal(d.domain, 'example.com');
    assert.equal(d.client_id, 'c1');
  });

  test('listDomains', () => {
    const dm = new DomainManager();
    dm.addDomain('c1', 'a.com');
    dm.addDomain('c2', 'b.com');
    assert.equal(dm.listDomains('c1').length, 1);
  });

  test('verifyDomain', () => {
    const dm = new DomainManager();
    const d = dm.addDomain('c1', 'example.com');
    const v = dm.verifyDomain('c1', d.domain);
    assert.ok(v.verified);
  });

  test('getDNSRecords', () => {
    const dm = new DomainManager();
    const records = dm.getDNSRecords('example.com');
    assert.ok(records.length > 0);
  });

  test('setupSSL', () => {
    const dm = new DomainManager();
    const d = dm.addDomain('c1', 'ssl.example.com');
    const ssl = dm.setupSSL('c1', d.domain);
    assert.equal(ssl.status, 'active');
  });

  test('getSSLStatus', () => {
    const dm = new DomainManager();
    const d = dm.addDomain('c1', 'ssl.example.com');
    dm.setupSSL('c1', d.domain);
    const status = dm.getSSLStatus('c1', d.domain);
    assert.equal(status.status, 'active');
  });

  test('renewSSL', () => {
    const dm = new DomainManager();
    const d = dm.addDomain('c1', 'ssl.example.com');
    dm.setupSSL('c1', d.domain);
    const renewed = dm.renewSSL('c1', d.domain);
    assert.ok(renewed.expires_at);
  });

  test('redirectDomain', () => {
    const dm = new DomainManager();
    dm.addDomain('c1', 'old.com');
    const r = dm.redirectDomain('c1', 'old.com', 'new.com');
    assert.equal(r.from, 'old.com');
    assert.equal(r.to, 'new.com');
  });
});

// ── BrandingManager ────────────────────────────────────────────────────────
describe('BrandingManager', () => {
  test('setLogo', () => {
    const bm = new BrandingManager();
    const logo = bm.setLogo('c1', 'logo.png');
    assert.equal(logo.url, 'logo.png');
    assert.equal(logo.client_id, 'c1');
  });

  test('getLogo', () => {
    const bm = new BrandingManager();
    bm.setLogo('c1', 'logo.png');
    const logo = bm.getLogo('c1');
    assert.equal(logo.url, 'logo.png');
  });

  test('setFavicon', () => {
    const bm = new BrandingManager();
    const fav = bm.setFavicon('c1', 'favicon.ico');
    assert.equal(fav.url, 'favicon.ico');
  });

  test('setColorPalette', () => {
    const bm = new BrandingManager();
    const pal = bm.setColorPalette('c1', { primary: '#ff0000', secondary: '#00ff00' });
    assert.equal(pal.colors.primary, '#ff0000');
  });

  test('getColorPalette', () => {
    const bm = new BrandingManager();
    bm.setColorPalette('c1', { primary: '#ff0000' });
    const pal = bm.getColorPalette('c1');
    assert.equal(pal.colors.primary, '#ff0000');
  });

  test('setFonts', () => {
    const bm = new BrandingManager();
    const fonts = bm.setFonts('c1', { heading: 'Montserrat', body: 'Open Sans' });
    assert.equal(fonts.fonts.heading, 'Montserrat');
  });

  test('setCustomCSS', () => {
    const bm = new BrandingManager();
    const css = bm.setCustomCSS('c1', 'body { color: red; }');
    assert.ok(css.css.includes('body'));
  });

  test('getCustomCSS', () => {
    const bm = new BrandingManager();
    bm.setCustomCSS('c1', 'body { color: red; }');
    const css = bm.getCustomCSS('c1');
    assert.ok(css.css.includes('body'));
  });

  test('previewBranding', () => {
    const bm = new BrandingManager();
    bm.setLogo('c1', 'logo.png');
    bm.setColorPalette('c1', { primary: '#ff0000' });
    const preview = bm.previewBranding('c1');
    assert.ok(preview.preview_url);
  });
});

// ── ThemeManager ───────────────────────────────────────────────────────────
describe('ThemeManager', () => {
  test('createTheme', () => {
    const tm = new ThemeManager();
    const t = tm.createTheme('c1', { name: 'Dark', colors: { bg: '#000' } });
    assert.equal(t.name, 'Dark');
    assert.ok(t.id);
  });

  test('getTheme', () => {
    const tm = new ThemeManager();
    const t = tm.createTheme('c1', { name: 'Theme' });
    const got = tm.getTheme('c1');
    assert.equal(got.name, 'Theme');
  });

  test('updateTheme', () => {
    const tm = new ThemeManager();
    const t = tm.createTheme('c1', { name: 'Old' });
    const updated = tm.updateTheme('c1', t.id, { name: 'New' });
    assert.equal(updated.name, 'New');
  });

  test('listThemes', () => {
    const tm = new ThemeManager();
    tm.createTheme('c1', { name: 'A' });
    tm.createTheme('c1', { name: 'B' });
    assert.equal(tm.listThemes('c1').length, 2);
  });

  test('activateTheme', () => {
    const tm = new ThemeManager();
    const t = tm.createTheme('c1', { name: 'Theme' });
    const active = tm.activateTheme('c1', t.id);
    assert.equal(active.active, true);
  });

  test('deactivateTheme', () => {
    const tm = new ThemeManager();
    const t = tm.createTheme('c1', { name: 'Theme' });
    tm.activateTheme('c1', t.id);
    tm.deactivateTheme('c1', t.id);
    const got = tm.getTheme('c1', t.id);
    assert.equal(got.active, false);
  });

  test('getThemePresets', () => {
    const tm = new ThemeManager();
    const presets = tm.getThemePresets();
    assert.ok(presets.length > 0);
  });

  test('exportTheme', () => {
    const tm = new ThemeManager();
    const t = tm.createTheme('c1', { name: 'Theme' });
    const exp = tm.exportTheme('c1');
    assert.ok(exp.theme);
  });

  test('importTheme', () => {
    const tm = new ThemeManager();
    const imported = tm.importTheme('c1', { name: 'Imported', colors: { bg: '#fff' } });
    assert.equal(imported.name, 'Imported');
  });
});

// ── CustomDomainDNS ────────────────────────────────────────────────────────
describe('CustomDomainDNS', () => {
  test('generateDNSConfig', () => {
    const dns = new CustomDomainDNS();
    const cfg = dns.generateDNSConfig('example.com', { cname: 'app.vireo.com' });
    assert.ok(cfg.records.length > 0);
  });

  test('verifyDNS', () => {
    const dns = new CustomDomainDNS();
    const v = dns.verifyDNS('example.com', [{ type: 'CNAME', name: 'www', value: 'example.com' }]);
    assert.ok(v.verified);
  });

  test('getRecommendedRecords', () => {
    const dns = new CustomDomainDNS();
    const records = dns.getRecommendedRecords('example.com');
    assert.ok(records.length > 0);
  });

  test('checkPropagation', () => {
    const dns = new CustomDomainDNS();
    const status = dns.checkPropagation('example.com');
    assert.ok(status.propagated);
  });

  test('getCDNConfig', () => {
    const dns = new CustomDomainDNS();
    const cfg = dns.getCDNConfig('example.com');
    assert.ok(cfg.provider);
  });

  test('updateDNS', () => {
    const dns = new CustomDomainDNS();
    const result = dns.updateDNS('example.com', [{ type: 'A', value: '1.2.3.4' }]);
    assert.ok(result.updated);
  });
});

// ── EnterprisePortal ───────────────────────────────────────────────────────
describe('EnterprisePortal', () => {
  test('createPortal', () => {
    const ep = new EnterprisePortal();
    const p = ep.createPortal('c1', { name: 'Portal', url: 'portal.com' });
    assert.equal(p.name, 'Portal');
    assert.ok(p.id);
  });

  test('getPortal', () => {
    const ep = new EnterprisePortal();
    const p = ep.createPortal('c1', { name: 'Portal' });
    const got = ep.getPortal('c1');
    assert.equal(got.name, 'Portal');
  });

  test('updatePortal', () => {
    const ep = new EnterprisePortal();
    const p = ep.createPortal('c1', { name: 'Old' });
    const updated = ep.updatePortal('c1', { name: 'New' });
    assert.equal(updated.name, 'New');
  });

  test('getPortalStats', () => {
    const ep = new EnterprisePortal();
    ep.createPortal('c1', { name: 'Portal' });
    ep.addPortalUser('c1', { name: 'User', email: 'u@e.com' });
    const stats = ep.getPortalStats('c1');
    assert.equal(stats.users, 1);
  });

  test('addPortalUser', () => {
    const ep = new EnterprisePortal();
    ep.createPortal('c1', { name: 'Portal' });
    const u = ep.addPortalUser('c1', { name: 'User', email: 'u@e.com' });
    assert.equal(u.email, 'u@e.com');
  });

  test('getPortalUsers', () => {
    const ep = new EnterprisePortal();
    ep.createPortal('c1', { name: 'Portal' });
    ep.addPortalUser('c1', { name: 'User', email: 'u@e.com' });
    const users = ep.getPortalUsers('c1');
    assert.equal(users.length, 1);
    assert.equal(users[0].status, 'active');
  });

  test('removePortalUser', () => {
    const ep = new EnterprisePortal();
    ep.createPortal('c1', { name: 'Portal' });
    const u = ep.addPortalUser('c1', { name: 'User', email: 'u@e.com' });
    ep.removePortalUser('c1', u.id);
    assert.equal(ep.getPortalUsers('c1').length, 0);
  });

  test('getPortalBranding', () => {
    const ep = new EnterprisePortal();
    ep.createPortal('c1', { name: 'Portal' });
    const branding = ep.getPortalBranding('c1');
    assert.ok(branding);
  });

  test('updatePortalBranding', () => {
    const ep = new EnterprisePortal();
    ep.createPortal('c1', { name: 'Portal' });
    const branding = ep.updatePortalBranding('c1', { colors: { primary: '#ff0000' } });
    assert.equal(branding.colors.primary, '#ff0000');
  });
});

// ── CustomAppBuilder ───────────────────────────────────────────────────────
describe('CustomAppBuilder', () => {
  test('buildApp', () => {
    const cab = new CustomAppBuilder();
    const build = cab.buildApp('c1', { platform: 'web' });
    assert.ok(build.build_id);
    assert.equal(build.status, 'completed');
  });

  test('getAppBuild', () => {
    const cab = new CustomAppBuilder();
    const build = cab.buildApp('c1', { platform: 'web' });
    const got = cab.getAppBuild('c1', build.build_id);
    assert.equal(got.status, 'completed');
  });

  test('listBuilds', () => {
    const cab = new CustomAppBuilder();
    cab.buildApp('c1', { platform: 'web' });
    cab.buildApp('c1', { platform: 'ios' });
    assert.equal(cab.listBuilds('c1').length, 2);
  });

  test('deployApp', () => {
    const cab = new CustomAppBuilder();
    const build = cab.buildApp('c1', { platform: 'web' });
    const deploy = cab.deployApp('c1', build.build_id, 'production');
    assert.equal(deploy.target, 'production');
  });

  test('getDeployStatus', () => {
    const cab = new CustomAppBuilder();
    const build = cab.buildApp('c1', { platform: 'web' });
    cab.deployApp('c1', build.id, 'production');
    const status = cab.getDeployStatus('c1', build.build_id);
    assert.equal(status.status, 'deployed');
  });

  test('rollbackApp', () => {
    const cab = new CustomAppBuilder();
    const build = cab.buildApp('c1', { platform: 'web' });
    const rollback = cab.rollbackApp('c1', build.build_id);
    assert.ok(rollback.rolled_back);
  });

  test('getBuildLogs', () => {
    const cab = new CustomAppBuilder();
    const build = cab.buildApp('c1', { platform: 'web' });
    const logs = cab.getBuildLogs('c1', build.build_id);
    assert.ok(logs.length > 0);
  });

  test('getAppConfig', () => {
    const cab = new CustomAppBuilder();
    const build = cab.buildApp('c1', { platform: 'web' });
    const cfg = cab.getAppConfig('c1');
    assert.equal(cfg.platform, 'web');
  });
});

// ── WhiteLabelAnalytics ────────────────────────────────────────────────────
describe('WhiteLabelAnalytics', () => {
  test('trackPageView', () => {
    const wla = new WhiteLabelAnalytics();
    wla.trackPageView('c1', '/home', 'u1');
    const report = wla.getAnalytics('c1');
    assert.equal(report.page_views, 1);
  });

  test('trackEvent', () => {
    const wla = new WhiteLabelAnalytics();
    wla.trackEvent('c1', 'click', { button: 'buy' });
    const events = wla.getCustomEvents('c1');
    assert.equal(events.length, 1);
  });

  test('getTopPages', () => {
    const wla = new WhiteLabelAnalytics();
    wla.trackPageView('c1', '/home', 'u1');
    wla.trackPageView('c1', '/home', 'u2');
    const top = wla.getTopPages('c1');
    assert.equal(top[0].page, '/home');
  });

  test('getUserStats', () => {
    const wla = new WhiteLabelAnalytics();
    wla.trackPageView('c1', '/home', 'u1');
    const stats = wla.getUserStats('c1');
    assert.equal(stats.total_users, 1);
  });

  test('getConversionStats', () => {
    const wla = new WhiteLabelAnalytics();
    wla.trackEvent('c1', 'conversion', { value: 100 });
    const stats = wla.getConversionStats('c1');
    assert.ok(stats.conversion_rate >= 0);
  });

  test('exportAnalytics', () => {
    const wla = new WhiteLabelAnalytics();
    wla.trackPageView('c1', '/home', 'u1');
    const exp = wla.exportAnalytics('c1');
    assert.ok(exp.report);
  });
});

// ── LicensingManager ───────────────────────────────────────────────────────
describe('LicensingManager', () => {
  test('createLicense', () => {
    const lm = new LicensingManager();
    const lic = lm.createLicense('c1', 'enterprise');
    assert.equal(lic.type, 'enterprise');
    assert.ok(lic.id);
  });

  test('getLicense', () => {
    const lm = new LicensingManager();
    const lic = lm.createLicense('c1', 'enterprise');
    const got = lm.getLicense('c1');
    assert.equal(got.type, 'enterprise');
  });

  test('updateLicense', () => {
    const lm = new LicensingManager();
    const lic = lm.createLicense('c1', 'enterprise');
    const updated = lm.updateLicense('c1', { type: 'business' });
    assert.equal(updated.type, 'business');
  });

  test('validateLicense', () => {
    const lm = new LicensingManager();
    lm.createLicense('c1', 'enterprise');
    const v = lm.validateLicense('c1');
    assert.ok(v.valid);
  });

  test('getLicenseFeatures', () => {
    const lm = new LicensingManager();
    const features = lm.getLicenseFeatures('enterprise');
    assert.ok(features.length > 0);
  });

  test('getLicenseUsage', () => {
    const lm = new LicensingManager();
    lm.createLicense('c1', 'enterprise');
    const usage = lm.getLicenseUsage('c1');
    assert.ok(usage);
  });

  test('getLicenseHistory', () => {
    const lm = new LicensingManager();
    lm.createLicense('c1', 'enterprise');
    const hist = lm.getLicenseHistory('c1');
    assert.ok(hist.length > 0);
  });

  test('renewLicense', () => {
    const lm = new LicensingManager();
    lm.createLicense('c1', 'enterprise');
    const renewed = lm.renewLicense('c1', '1y');
    assert.ok(renewed.expires_at);
  });
});

// ── SupportManager ─────────────────────────────────────────────────────────
describe('SupportManager', () => {
  test('createTicket', () => {
    const sm = new SupportManager();
    const t = sm.createTicket('c1', { subject: 'Bug', priority: 'high' });
    assert.equal(t.subject, 'Bug');
    assert.ok(t.id);
  });

  test('getTicket', () => {
    const sm = new SupportManager();
    const t = sm.createTicket('c1', { subject: 'Bug' });
    const got = sm.getTicket('c1', t.id);
    assert.equal(got.subject, 'Bug');
  });

  test('listTickets', () => {
    const sm = new SupportManager();
    sm.createTicket('c1', { subject: 'A' });
    sm.createTicket('c1', { subject: 'B' });
    assert.equal(sm.listTickets('c1').length, 2);
  });

  test('updateTicket', () => {
    const sm = new SupportManager();
    const t = sm.createTicket('c1', { subject: 'Old' });
    const updated = sm.updateTicket('c1', t.id, { subject: 'New' });
    assert.equal(updated.subject, 'New');
  });

  test('closeTicket', () => {
    const sm = new SupportManager();
    const t = sm.createTicket('c1', { subject: 'Bug' });
    sm.closeTicket('c1', t.id);
    const got = sm.getTicket('c1', t.id);
    assert.equal(got.status, 'closed');
  });

  test('getTicketStats', () => {
    const sm = new SupportManager();
    sm.createTicket('c1', { subject: 'Bug' });
    const stats = sm.getTicketStats('c1');
    assert.equal(stats.total, 1);
  });

  test('getSLAStatus', () => {
    const sm = new SupportManager();
    const status = sm.getSLAStatus('c1');
    assert.ok(status.sla_enabled);
  });

  test('assignTicket', () => {
    const sm = new SupportManager();
    const t = sm.createTicket('c1', { subject: 'Bug' });
    const assigned = sm.assignTicket('c1', t.id, 'agent1');
    assert.equal(assigned.assigned_to, 'agent1');
  });
});

// ── Integration ────────────────────────────────────────────────────────────
describe('W20 White-label Integration', () => {
  test('full workflow: config → domain → branding → portal → analytics', () => {
    // 1. Create config
    const wlc = new WhiteLabelConfig();
    const cfg = wlc.createConfig({ client_id: 'c1', brand_name: 'Acme Corp', colors: { primary: '#1a73e8' } });
    assert.ok(cfg.id);

    // 2. Add domain
    const dm = new DomainManager();
    const d = dm.addDomain(cfg.client_id, 'acme.vireo.com');
    dm.verifyDomain(cfg.client_id, d.domain);
    assert.ok(dm.getSSLStatus(cfg.client_id, d.domain));

    // 3. Set branding
    const bm = new BrandingManager();
    bm.setLogo(cfg.client_id, 'logo.png');
    bm.setColorPalette(cfg.client_id, { primary: '#1a73e8', secondary: '#ea4335' });
    bm.setFonts(cfg.client_id, { heading: 'Montserrat', body: 'Open Sans' });
    const preview = bm.previewBranding(cfg.client_id);
    assert.ok(preview.preview_url);

    // 4. Create theme
    const tm = new ThemeManager();
    const theme = tm.createTheme(cfg.client_id, { name: 'Dark', colors: { bg: '#000' } });
    tm.activateTheme(cfg.client_id, theme.id);
    assert.equal(tm.getTheme(cfg.client_id).active, true);

    // 5. DNS config
    const dns = new CustomDomainDNS();
    const dnsCfg = dns.generateDNSConfig(d.domain, { cname: 'app.vireo.com' });
    assert.ok(dnsCfg.records.length > 0);

    // 6. Portal
    const ep = new EnterprisePortal();
    ep.createPortal(cfg.client_id, { name: 'Acme Portal', url: d.domain });
    ep.addPortalUser(cfg.client_id, { name: 'User', email: 'u@e.com' });
    assert.equal(ep.getPortalUsers(cfg.client_id).length, 1);

    // 7. App builder
    const cab = new CustomAppBuilder();
    const build = cab.buildApp(cfg.client_id, { platform: 'web' });
    cab.deployApp(cfg.client_id, build.build_id, 'production');
    assert.equal(cab.getDeployStatus(cfg.client_id, build.build_id).status, 'deployed');

    // 8. Analytics
    const wla = new WhiteLabelAnalytics();
    wla.trackPageView(cfg.client_id, '/home', 'u1');
    wla.trackEvent(cfg.client_id, 'conversion', { value: 100 });
    const report = wla.getAnalytics(cfg.client_id);
    assert.equal(report.total_page_views, 1);

    // 9. License
    const lm = new LicensingManager();
    lm.createLicense(cfg.client_id, 'enterprise');
    const lic = lm.validateLicense(cfg.client_id);
    assert.ok(lic.valid);

    // 10. Support
    const sm = new SupportManager();
    sm.createTicket(cfg.client_id, { subject: 'Need help', priority: 'high' });
    assert.equal(sm.getTicketStats(cfg.client_id).total_tickets, 1);
  });
});
