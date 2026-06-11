/**
 * test_template_marketplace.js — Tests for Template Marketplace (65+ tests)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MarketplaceStore, TemplateListing, PricingEngine, ReviewSystem,
  PurchaseManager, LicenseManager, CreatorProgram, CouponSystem,
  RecommendationEngine, ContentDelivery,
} from '../src/template_marketplace.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStore() {
  const store = new MarketplaceStore();
  const products = [
    { id: 'p1', name: 'Epic Intro', description: 'Cinematic intro', price: 12, category: 'intro', rating: 4.8, sales: 200, tags: ['cinematic'], created_at: '2025-01-01T00:00:00Z' },
    { id: 'p2', name: 'Social Reel', description: 'Short form reel', price: 5, category: 'social', rating: 4.2, sales: 500, tags: ['social', 'trendy'], created_at: '2025-02-01T00:00:00Z' },
    { id: 'p3', name: 'Corporate Promo', description: 'Business promo', price: 25, category: 'promo', rating: 4.9, sales: 100, tags: ['business'], created_at: '2025-03-01T00:00:00Z' },
    { id: 'p4', name: 'Music Video', description: 'VFX music video', price: 50, category: 'music', rating: 4.5, sales: 75, tags: ['music', 'vfx'], created_at: '2025-04-01T00:00:00Z' },
    { id: 'p5', name: 'Tutorial Opener', description: 'YouTube opener', price: 0, category: 'tutorial', rating: 4.0, sales: 1000, tags: ['youtube'], created_at: '2025-05-01T00:00:00Z' },
  ];
  for (const p of products) store.addProduct(p);
  return store;
}

// ── MarketplaceStore ─────────────────────────────────────────────────────────

describe('MarketplaceStore', () => {
  test('listProducts returns all products', () => {
    const store = makeStore();
    assert.equal(store.listProducts().length, 5);
  });

  test('listProducts filters by category', () => {
    const store = makeStore();
    assert.equal(store.listProducts({ category: 'intro' }).length, 1);
    assert.equal(store.listProducts({ category: 'nonexistent' }).length, 0);
  });

  test('listProducts filters by price range', () => {
    const store = makeStore();
    assert.equal(store.listProducts({ min_price: 10, max_price: 30 }).length, 2); // p1 ($12) & p3 ($25)
  });

  test('listProducts filters by tags', () => {
    const store = makeStore();
    assert.equal(store.listProducts({ tags: ['vfx'] }).length, 1); // p4
    assert.equal(store.listProducts({ tags: ['social'] }).length, 1); // p2
  });

  test('listProducts sorts by price_asc', () => {
    const store = makeStore();
    const sorted = store.listProducts({ sort_by: 'price_asc' });
    assert.ok(sorted[0].price <= sorted[1].price);
  });

  test('listProducts sorts by rating', () => {
    const store = makeStore();
    const sorted = store.listProducts({ sort_by: 'rating' });
    assert.ok(sorted[0].rating >= sorted[1].rating);
  });

  test('getProduct returns product by id', () => {
    const store = makeStore();
    assert.equal(store.getProduct('p1').name, 'Epic Intro');
  });

  test('getProduct throws for missing product', () => {
    const store = makeStore();
    assert.throws(() => store.getProduct('nonexistent'), /not found/);
  });

  test('searchProducts finds by name', () => {
    const store = makeStore();
    const results = store.searchProducts('epic');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'p1');
  });

  test('searchProducts finds by tag', () => {
    const store = makeStore();
    const results = store.searchProducts('trendy');
    assert.equal(results.length, 1);
  });

  test('searchProducts is case-insensitive', () => {
    const store = makeStore();
    const results = store.searchProducts('EPIC');
    assert.equal(results.length, 1);
  });

  test('getFeatured returns top products by rating', () => {
    const store = makeStore();
    const featured = store.getFeatured();
    assert.ok(featured.length <= 10);
    assert.ok(featured[0].rating >= featured[1].rating);
  });

  test('getNewArrivals returns products sorted by date', () => {
    const store = makeStore();
    const arrivals = store.getNewArrivals(3);
    assert.equal(arrivals.length, 3);
    assert.ok(arrivals[0].created_at >= arrivals[1].created_at);
  });

  test('getBestSellers returns products sorted by sales', () => {
    const store = makeStore();
    const best = store.getBestSellers(2);
    assert.equal(best.length, 2);
    assert.ok(best[0].sales >= best[1].sales);
  });

  test('getCategories returns registered categories', () => {
    const store = new MarketplaceStore();
    store.addCategory({ id: 'cat1', name: 'Intros' });
    store.addCategory({ id: 'cat2', name: 'Social' });
    assert.equal(store.getCategories().length, 2);
  });
});

// ── TemplateListing ──────────────────────────────────────────────────────────

describe('TemplateListing', () => {
  test('createListing creates listing with correct fields', () => {
    const tl = new TemplateListing();
    const l = tl.createListing({ name: 'My Template', price: 10, category: 'intro', seller_id: 's1' });
    assert.equal(l.name, 'My Template');
    assert.equal(l.price, 10);
    assert.equal(l.seller_id, 's1');
    assert.equal(l.license, 'standard');
    assert.ok(l.id);
    assert.ok(l.created_at);
  });

  test('getListing returns listing by id', () => {
    const tl = new TemplateListing();
    const l = tl.createListing({ name: 'T1', price: 5, category: 'x', seller_id: 's1' });
    const got = tl.getListing(l.id);
    assert.equal(got.name, 'T1');
  });

  test('getListing throws for missing listing', () => {
    const tl = new TemplateListing();
    assert.throws(() => tl.getListing('nonexistent'), /not found/);
  });

  test('updateListing updates fields', () => {
    const tl = new TemplateListing();
    const l = tl.createListing({ name: 'Old', price: 5, category: 'x', seller_id: 's1' });
    const updated = tl.updateListing(l.id, { name: 'New', price: 15 });
    assert.equal(updated.name, 'New');
    assert.equal(updated.price, 15);
  });

  test('deleteListing removes listing', () => {
    const tl = new TemplateListing();
    const l = tl.createListing({ name: 'Del', price: 5, category: 'x', seller_id: 's1' });
    assert.ok(tl.deleteListing(l.id).deleted);
    assert.throws(() => tl.getListing(l.id), /not found/);
  });

  test('listBySeller returns only that seller\'s listings', () => {
    const tl = new TemplateListing();
    tl.createListing({ name: 'A', price: 1, category: 'x', seller_id: 's1' });
    tl.createListing({ name: 'B', price: 2, category: 'x', seller_id: 's2' });
    tl.createListing({ name: 'C', price: 3, category: 'x', seller_id: 's1' });
    assert.equal(tl.listBySeller('s1').length, 2);
    assert.equal(tl.listBySeller('s2').length, 1);
  });

  test('duplicateListing creates copy with new price', () => {
    const tl = new TemplateListing();
    const l = tl.createListing({ name: 'Original', price: 10, category: 'x', seller_id: 's1' });
    const dup = tl.duplicateListing(l.id, 20);
    assert.notEqual(dup.id, l.id);
    assert.equal(dup.price, 20);
    assert.ok(dup.name.includes('copy'));
  });
});

// ── PricingEngine ────────────────────────────────────────────────────────────

describe('PricingEngine', () => {
  test('setPrice stores pricing info', () => {
    const pe = new PricingEngine();
    const result = pe.setPrice('l1', { amount: 25, currency: 'USD' });
    assert.equal(result.amount, 25);
    assert.equal(result.currency, 'USD');
  });

  test('setPrice supports sale_price', () => {
    const pe = new PricingEngine();
    const result = pe.setPrice('l1', { amount: 25, sale_price: 15, sale_ends: '2025-12-31' });
    assert.equal(result.sale_price, 15);
  });

  test('calculateDiscount with no coupon returns zero discount', () => {
    const pe = new PricingEngine();
    const d = pe.calculateDiscount(100);
    assert.equal(d.original, 100);
    assert.equal(d.discount, 0);
    assert.equal(d.final, 100);
  });

  test('calculateDiscount with valid coupon', () => {
    const pe = new PricingEngine();
    const d = pe.calculateDiscount(100, 'HALF2025');
    assert.equal(d.discount, 50);
    assert.equal(d.final, 50);
  });

  test('getRevenueStats returns correct stats', () => {
    const pe = new PricingEngine();
    pe.recordSale('s1', 'l1', 20);
    pe.recordSale('s1', 'l2', 30);
    const stats = pe.getRevenueStats('s1');
    assert.equal(stats.total_revenue, 50);
    assert.equal(stats.total_sales, 2);
    assert.equal(stats.avg_price, 25);
    assert.ok(stats.top_templates.length > 0);
  });

  test('getRevenueStats for unknown seller returns zeros', () => {
    const pe = new PricingEngine();
    const stats = pe.getRevenueStats('unknown');
    assert.equal(stats.total_revenue, 0);
    assert.equal(stats.total_sales, 0);
  });

  test('getPricingTiers returns 6 tiers', () => {
    const pe = new PricingEngine();
    const tiers = pe.getPricingTiers();
    assert.equal(tiers.length, 6);
    assert.equal(tiers[0].name, 'Free');
    assert.equal(tiers[5].name, 'Elite');
  });

  test('estimateRoyalty calculates commission correctly', () => {
    const pe = new PricingEngine();
    pe.setPrice('l1', { amount: 10 });
    const est = pe.estimateRoyalty('l1', 100);
    assert.equal(est.gross, 1000);
    assert.equal(est.commission, 150);
    assert.equal(est.royalty, 850);
  });
});

// ── ReviewSystem ─────────────────────────────────────────────────────────────

describe('ReviewSystem', () => {
  test('addReview creates review with valid rating', () => {
    const rs = new ReviewSystem();
    const r = rs.addReview('p1', { user_id: 'u1', rating: 5, comment: 'Great!' });
    assert.equal(r.rating, 5);
    assert.equal(r.comment, 'Great!');
    assert.ok(r.id);
  });

  test('addReview clamps rating to 1-5', () => {
    const rs = new ReviewSystem();
    const r1 = rs.addReview('p1', { user_id: 'u1', rating: 0 });
    assert.equal(r1.rating, 1);
    const r2 = rs.addReview('p1', { user_id: 'u2', rating: 10 });
    assert.equal(r2.rating, 5);
  });

  test('addReview throws for missing rating', () => {
    const rs = new ReviewSystem();
    assert.throws(() => rs.addReview('p1', { user_id: 'u1', rating: null }), /must be a number/);
  });

  test('getReviews returns reviews for product', () => {
    const rs = new ReviewSystem();
    rs.addReview('p1', { user_id: 'u1', rating: 4 });
    rs.addReview('p1', { user_id: 'u2', rating: 5 });
    rs.addReview('p2', { user_id: 'u1', rating: 3 });
    assert.equal(rs.getReviews('p1').length, 2);
    assert.equal(rs.getReviews('p2').length, 1);
  });

  test('getAverageRating calculates correctly', () => {
    const rs = new ReviewSystem();
    rs.addReview('p1', { user_id: 'u1', rating: 4 });
    rs.addReview('p1', { user_id: 'u2', rating: 2 });
    assert.equal(rs.getAverageRating('p1'), 3);
  });

  test('getAverageRating returns 0 for no reviews', () => {
    const rs = new ReviewSystem();
    assert.equal(rs.getAverageRating('unknown'), 0);
  });

  test('getReviewsByUser returns reviews by user', () => {
    const rs = new ReviewSystem();
    rs.addReview('p1', { user_id: 'u1', rating: 5 });
    rs.addReview('p2', { user_id: 'u1', rating: 3 });
    rs.addReview('p3', { user_id: 'u2', rating: 4 });
    assert.equal(rs.getReviewsByUser('u1').length, 2);
  });

  test('reportReview creates report', () => {
    const rs = new ReviewSystem();
    const r = rs.addReview('p1', { user_id: 'u1', rating: 1 });
    const report = rs.reportReview(r.id, 'spam');
    assert.equal(report.reason, 'spam');
    assert.ok(report.id);
  });

  test('reportReview throws for missing review', () => {
    const rs = new ReviewSystem();
    assert.throws(() => rs.reportReview('nope', 'spam'), /not found/);
  });

  test('deleteReview removes review', () => {
    const rs = new ReviewSystem();
    const r = rs.addReview('p1', { user_id: 'u1', rating: 1 });
    assert.ok(rs.deleteReview(r.id).deleted);
    assert.equal(rs.getReviews('p1').length, 0);
  });

  test('getProductRating returns distribution', () => {
    const rs = new ReviewSystem();
    rs.addReview('p1', { user_id: 'u1', rating: 5 });
    rs.addReview('p1', { user_id: 'u2', rating: 5 });
    rs.addReview('p1', { user_id: 'u3', rating: 3 });
    const rating = rs.getProductRating('p1');
    assert.equal(rating.count, 3);
    assert.equal(rating.distribution[5], 2);
    assert.equal(rating.distribution[3], 1);
  });
});

// ── PurchaseManager ──────────────────────────────────────────────────────────

describe('PurchaseManager', () => {
  test('purchase creates a purchase record', () => {
    const pm = new PurchaseManager();
    const p = pm.purchase('u1', 'l1', { payment_method: 'credits' });
    assert.ok(p.purchase_id);
    assert.equal(p.user_id, 'u1');
    assert.equal(p.status, 'completed');
    assert.ok(p.receipt_url);
  });

  test('purchase defaults to credits payment', () => {
    const pm = new PurchaseManager();
    const p = pm.purchase('u1', 'l1');
    assert.equal(p.payment_method, 'credits');
  });

  test('getPurchases returns user purchases', () => {
    const pm = new PurchaseManager();
    pm.purchase('u1', 'l1');
    pm.purchase('u1', 'l2');
    pm.purchase('u2', 'l1');
    assert.equal(pm.getPurchases('u1').length, 2);
    assert.equal(pm.getPurchases('u2').length, 1);
  });

  test('getPurchase returns purchase by id', () => {
    const pm = new PurchaseManager();
    const p = pm.purchase('u1', 'l1');
    const got = pm.getPurchase(p.purchase_id);
    assert.equal(got.user_id, 'u1');
  });

  test('getPurchase throws for missing', () => {
    const pm = new PurchaseManager();
    assert.throws(() => pm.getPurchase('nope'), /not found/);
  });

  test('refund marks purchase as refunded', () => {
    const pm = new PurchaseManager();
    const p = pm.purchase('u1', 'l1');
    const ref = pm.refund(p.purchase_id, 'changed mind');
    assert.equal(ref.status, 'refunded');
    assert.equal(pm.getPurchase(p.purchase_id).status, 'refunded');
  });

  test('getReceipt returns receipt info', () => {
    const pm = new PurchaseManager();
    const p = pm.purchase('u1', 'l1');
    const receipt = pm.getReceipt(p.purchase_id);
    assert.ok(receipt.receipt_url);
    assert.equal(receipt.user_id, 'u1');
  });

  test('checkLicense returns valid for active purchase', () => {
    const pm = new PurchaseManager();
    pm.purchase('u1', 'l1');
    const status = pm.checkLicense('u1', 'l1');
    assert.equal(status.valid, true);
  });

  test('checkLicense returns invalid for no purchase', () => {
    const pm = new PurchaseManager();
    const status = pm.checkLicense('u1', 'l1');
    assert.equal(status.valid, false);
  });
});

// ── LicenseManager ───────────────────────────────────────────────────────────

describe('LicenseManager', () => {
  test('issueLicense creates license with features', () => {
    const lm = new LicenseManager();
    const lic = lm.issueLicense('p1', 'standard');
    assert.ok(lic.license_id);
    assert.equal(lic.type, 'standard');
    assert.ok(lic.features.includes('basic_export'));
  });

  test('issueLicense defaults to standard', () => {
    const lm = new LicenseManager();
    const lic = lm.issueLicense('p1');
    assert.equal(lic.type, 'standard');
  });

  test('validateLicense returns valid for existing license', () => {
    const lm = new LicenseManager();
    const lic = lm.issueLicense('p1');
    const v = lm.validateLicense(lic.license_id);
    assert.equal(v.valid, true);
    assert.equal(v.max_usage, 1);
  });

  test('validateLicense returns invalid for unknown license', () => {
    const lm = new LicenseManager();
    const v = lm.validateLicense('unknown');
    assert.equal(v.valid, false);
  });

  test('upgradeLicense changes type and features', () => {
    const lm = new LicenseManager();
    const lic = lm.issueLicense('p1', 'standard');
    const upgraded = lm.upgradeLicense(lic.license_id, 'enterprise');
    assert.equal(upgraded.type, 'enterprise');
    assert.ok(upgraded.features.includes('white_label'));
  });

  test('revokeLicense removes license', () => {
    const lm = new LicenseManager();
    const lic = lm.issueLicense('p1');
    assert.ok(lm.revokeLicense(lic.license_id).revoked);
    const v = lm.validateLicense(lic.license_id);
    assert.equal(v.valid, false);
  });

  test('getLicenseFeatures returns correct features per type', () => {
    const lm = new LicenseManager();
    const std = lm.getLicenseFeatures('standard');
    assert.ok(std.includes('basic_export'));
    const ext = lm.getLicenseFeatures('extended');
    assert.ok(ext.includes('commercial_use'));
    const ent = lm.getLicenseFeatures('enterprise');
    assert.ok(ent.includes('white_label'));
    assert.ok(ent.includes('unlimited'));
  });
});

// ── CreatorProgram ───────────────────────────────────────────────────────────

describe('CreatorProgram', () => {
  test('enrollCreator creates profile', () => {
    const cp = new CreatorProgram();
    const profile = cp.enrollCreator('u1', { portfolio_url: 'https://example.com', specialty: 'intro' });
    assert.equal(profile.user_id, 'u1');
    assert.equal(profile.specialty, 'intro');
    assert.equal(profile.commission_rate, 0.85);
  });

  test('getCreatorProfile returns profile', () => {
    const cp = new CreatorProgram();
    cp.enrollCreator('u1');
    const p = cp.getCreatorProfile('u1');
    assert.equal(p.user_id, 'u1');
  });

  test('getCreatorProfile throws for unenrolled user', () => {
    const cp = new CreatorProgram();
    assert.throws(() => cp.getCreatorProfile('nope'), /not enrolled/);
  });

  test('getCreatorEarnings returns earnings', () => {
    const cp = new CreatorProgram();
    cp.enrollCreator('u1');
    cp.recordEarning('u1', 100);
    cp.recordEarning('u1', 50);
    const e = cp.getCreatorEarnings('u1');
    assert.equal(e.total_earned, 150);
    assert.equal(e.pending_payout, 150);
    assert.equal(e.commission_rate, 0.85);
  });

  test('submitForReview creates submission', () => {
    const cp = new CreatorProgram();
    const sub = cp.submitForReview('l1');
    assert.ok(sub.submission_id);
    assert.equal(sub.status, 'pending');
  });

  test('getReviewStatus returns submission', () => {
    const cp = new CreatorProgram();
    const sub = cp.submitForReview('l1');
    const status = cp.getReviewStatus(sub.submission_id);
    assert.equal(status.status, 'pending');
  });

  test('approveSubmission changes status to approved', () => {
    const cp = new CreatorProgram();
    const sub = cp.submitForReview('l1');
    const approved = cp.approveSubmission(sub.submission_id);
    assert.equal(approved.status, 'approved');
    assert.ok(approved.approved_at);
  });

  test('rejectSubmission changes status to rejected', () => {
    const cp = new CreatorProgram();
    const sub = cp.submitForReview('l1');
    const rejected = cp.rejectSubmission(sub.submission_id);
    assert.equal(rejected.status, 'rejected');
  });

  test('getCreatorStats returns stats object', () => {
    const cp = new CreatorProgram();
    cp.enrollCreator('u1');
    const stats = cp.getCreatorStats('u1');
    assert.equal(typeof stats.total_sales, 'number');
    assert.equal(typeof stats.conversion_rate, 'number');
  });
});

// ── CouponSystem ─────────────────────────────────────────────────────────────

describe('CouponSystem', () => {
  test('createCoupon creates percentage coupon', () => {
    const cs = new CouponSystem();
    const c = cs.createCoupon({ code: 'SAVE20', discount_type: 'percentage', discount_value: 20, max_uses: 100 });
    assert.equal(c.code, 'SAVE20');
    assert.equal(c.discount_type, 'percentage');
    assert.equal(c.discount_value, 20);
    assert.equal(c.active, true);
  });

  test('createCoupon creates fixed coupon', () => {
    const cs = new CouponSystem();
    const c = cs.createCoupon({ code: 'FLAT5', discount_type: 'fixed', discount_value: 5 });
    assert.equal(c.discount_type, 'fixed');
  });

  test('createCoupon rejects invalid discount_type', () => {
    const cs = new CouponSystem();
    assert.throws(() => cs.createCoupon({ code: 'X', discount_type: 'bogus' }), /percentage or fixed/);
  });

  test('validateCoupon returns valid for good coupon', () => {
    const cs = new CouponSystem();
    cs.createCoupon({ code: 'SAVE20', discount_type: 'percentage', discount_value: 20, max_uses: 10 });
    const v = cs.validateCoupon('SAVE20', 100);
    assert.equal(v.valid, true);
    assert.equal(v.discount, 20);
    assert.equal(v.final_price, 80);
  });

  test('validateCoupon rejects expired coupon', () => {
    const cs = new CouponSystem();
    cs.createCoupon({ code: 'OLD', discount_type: 'fixed', discount_value: 5, expires_at: '2020-01-01T00:00:00Z' });
    const v = cs.validateCoupon('OLD', 100);
    assert.equal(v.valid, false);
  });

  test('validateCoupon rejects max uses reached', () => {
    const cs = new CouponSystem();
    cs.createCoupon({ code: 'LIM', discount_type: 'fixed', discount_value: 5, max_uses: 1 });
    cs.applyCoupon('LIM', 'purchase1');
    const v = cs.validateCoupon('LIM', 100);
    assert.equal(v.valid, false);
  });

  test('validateCoupon rejects invalid code', () => {
    const cs = new CouponSystem();
    const v = cs.validateCoupon('NOPE', 100);
    assert.equal(v.valid, false);
  });

  test('applyCoupon records application and increments count', () => {
    const cs = new CouponSystem();
    cs.createCoupon({ code: 'HALF', discount_type: 'percentage', discount_value: 50, max_uses: 5 });
    const applied = cs.applyCoupon('HALF', 'purchase1');
    assert.ok(applied.id);
    assert.equal(applied.code, 'HALF');
  });

  test('getCoupons returns coupons list', () => {
    const cs = new CouponSystem();
    cs.createCoupon({ code: 'A', discount_type: 'fixed', discount_value: 1 });
    cs.createCoupon({ code: 'B', discount_type: 'fixed', discount_value: 2 });
    assert.equal(cs.getCoupons().length, 2);
  });

  test('getCouponStats returns stats', () => {
    const cs = new CouponSystem();
    const c = cs.createCoupon({ code: 'STAT', discount_type: 'fixed', discount_value: 10, max_uses: 100 });
    cs.applyCoupon('STAT', 'p1');
    cs.applyCoupon('STAT', 'p2');
    const stats = cs.getCouponStats(c.id);
    assert.equal(stats.total_uses, 2);
  });

  test('deactivateCoupon sets active to false', () => {
    const cs = new CouponSystem();
    const c = cs.createCoupon({ code: 'OFF', discount_type: 'fixed', discount_value: 5 });
    assert.ok(cs.deactivateCoupon(c.id).deactivated);
    const v = cs.validateCoupon('OFF', 100);
    assert.equal(v.valid, false);
  });
});

// ── RecommendationEngine ─────────────────────────────────────────────────────

describe('RecommendationEngine', () => {
  test('trackView records view', () => {
    const store = makeStore();
    const re = new RecommendationEngine(store);
    re.trackView('u1', 'p1');
    assert.equal(re.getBrowseHistory('u1').length, 1);
  });

  test('trackView avoids consecutive duplicates', () => {
    const store = makeStore();
    const re = new RecommendationEngine(store);
    re.trackView('u1', 'p1');
    re.trackView('u1', 'p1');
    assert.equal(re.getBrowseHistory('u1').length, 1);
  });

  test('getRecommendations returns products', () => {
    const store = makeStore();
    const re = new RecommendationEngine(store);
    const recs = re.getRecommendations('u1', 5);
    assert.ok(recs.length <= 5);
  });

  test('getSimilar returns products in same category', () => {
    const store = makeStore();
    const re = new RecommendationEngine(store);
    const similar = re.getSimilar('p1', 5);
    for (const p of similar) {
      assert.equal(p.category, 'intro');
    }
  });

  test('getSimilar returns empty for unknown product', () => {
    const store = makeStore();
    const re = new RecommendationEngine(store);
    assert.equal(re.getSimilar('nope').length, 0);
  });

  test('getTrending returns products sorted by sales', () => {
    const store = makeStore();
    const re = new RecommendationEngine(store);
    const trending = re.getTrending(3);
    assert.equal(trending.length, 3);
    assert.ok(trending[0].sales >= trending[1].sales);
  });

  test('getForYou returns same as getRecommendations', () => {
    const store = makeStore();
    const re = new RecommendationEngine(store);
    const fy = re.getForYou('u1', 3);
    const recs = re.getRecommendations('u1', 3);
    assert.equal(fy.length, recs.length);
  });

  test('getBrowseHistory returns viewed products', () => {
    const store = makeStore();
    const re = new RecommendationEngine(store);
    re.trackView('u1', 'p1');
    re.trackView('u1', 'p3');
    const history = re.getBrowseHistory('u1');
    assert.equal(history.length, 2);
    assert.equal(history[0].id, 'p1');
    assert.equal(history[1].id, 'p3');
  });
});

// ── ContentDelivery ──────────────────────────────────────────────────────────

describe('ContentDelivery', () => {
  test('deliverProduct returns download info', () => {
    const cd = new ContentDelivery();
    const result = cd.deliverProduct('purchase1', { name: 'template' });
    assert.ok(result.download_url);
    assert.ok(result.expires_at);
    assert.equal(result.format, 'zip');
  });

  test('recordDownload stores download', () => {
    const cd = new ContentDelivery();
    cd.recordDownload('u1', { file: 'template.zip' });
    assert.equal(cd.getDownloadHistory('u1').length, 1);
  });

  test('getDownloadHistory returns empty for new user', () => {
    const cd = new ContentDelivery();
    assert.equal(cd.getDownloadHistory('newuser').length, 0);
  });

  test('checkQuota returns quota info', () => {
    const cd = new ContentDelivery();
    const q = cd.checkQuota('u1');
    assert.equal(q.downloads_today, 0);
    assert.equal(q.max_daily, 50);
    assert.ok(q.storage_limit > 0);
  });

  test('checkQuota counts today\'s downloads', () => {
    const cd = new ContentDelivery();
    cd.recordDownload('u1', { file: 'a.zip' });
    cd.recordDownload('u1', { file: 'b.zip' });
    const q = cd.checkQuota('u1');
    assert.equal(q.downloads_today, 2);
  });

  test('generateThumbnail returns thumbnail info', () => {
    const cd = new ContentDelivery();
    const thumb = cd.generateThumbnail('t1');
    assert.ok(thumb.thumbnail_url);
    assert.equal(thumb.width, 320);
    assert.equal(thumb.height, 180);
  });

  test('generatePreview returns video preview by default', () => {
    const cd = new ContentDelivery();
    const prev = cd.generatePreview('t1');
    assert.ok(prev.preview_url.includes('.mp4'));
    assert.equal(prev.format, 'video');
  });

  test('generatePreview returns gif format', () => {
    const cd = new ContentDelivery();
    const prev = cd.generatePreview('t1', 'gif');
    assert.ok(prev.preview_url.includes('.gif'));
  });

  test('generatePreview returns image format', () => {
    const cd = new ContentDelivery();
    const prev = cd.generatePreview('t1', 'image');
    assert.ok(prev.preview_url.includes('.jpg'));
  });
});

// ── Integration / Cross-class ────────────────────────────────────────────────

describe('Integration: Full marketplace flow', () => {
  test('creator enrolls, lists template, user purchases and gets license', () => {
    // Setup
    const cp = new CreatorProgram();
    const tl = new TemplateListing();
    const pe = new PricingEngine();
    const pm = new PurchaseManager();
    const lm = new LicenseManager();

    // Creator enrolls
    const profile = cp.enrollCreator('creator1', { specialty: 'intro' });
    assert.equal(profile.user_id, 'creator1');

    // Creator creates listing
    const listing = tl.createListing({
      name: 'Epic Intro Template', price: 25, category: 'intro',
      seller_id: 'creator1', license: 'extended',
    });
    assert.equal(listing.seller_id, 'creator1');

    // Set pricing
    pe.setPrice(listing.id, { amount: 25, sale_price: 20, sale_ends: '2025-12-31' });

    // User purchases
    const purchase = pm.purchase('buyer1', listing.id, { payment_method: 'credits' });
    assert.equal(purchase.status, 'completed');

    // Issue license
    const license = lm.issueLicense(purchase.purchase_id, listing.license);
    assert.equal(license.type, 'extended');
    assert.ok(license.features.includes('commercial_use'));

    // Validate license
    const validation = lm.validateLicense(license.license_id);
    assert.equal(validation.valid, true);
    assert.equal(validation.max_usage, 10);

    // Record revenue
    pe.recordSale('creator1', listing.id, 20);
    const stats = pe.getRevenueStats('creator1');
    assert.equal(stats.total_revenue, 20);
    assert.equal(stats.total_sales, 1);

    // Creator earnings
    cp.recordEarning('creator1', 20);
    const earnings = cp.getCreatorEarnings('creator1');
    assert.equal(earnings.total_earned, 20);
  });

  test('coupon applied to purchase reduces price', () => {
    const cs = new CouponSystem();
    const pe = new PricingEngine();

    cs.createCoupon({ code: 'SAVE10', discount_type: 'percentage', discount_value: 10, max_uses: 50 });
    pe.setPrice('l1', { amount: 100 });

    const validation = cs.validateCoupon('SAVE10', 100);
    assert.equal(validation.valid, true);
    assert.equal(validation.discount, 10);
    assert.equal(validation.final_price, 90);
  });

  test('review system tracks product ratings', () => {
    const rs = new ReviewSystem();
    rs.addReview('p1', { user_id: 'u1', rating: 5, comment: 'Amazing!' });
    rs.addReview('p1', { user_id: 'u2', rating: 4, comment: 'Good' });
    rs.addReview('p1', { user_id: 'u3', rating: 3, comment: 'OK' });

    const rating = rs.getProductRating('p1');
    assert.equal(rating.count, 3);
    assert.ok(rating.average > 3 && rating.average < 5);
    assert.equal(rating.distribution[5], 1);
    assert.equal(rating.distribution[4], 1);
    assert.equal(rating.distribution[3], 1);
  });
});
