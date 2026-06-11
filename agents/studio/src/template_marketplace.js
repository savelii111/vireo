/**
 * Template Marketplace for Vireo Studio
 * Revenue engine + lock-in: users buy/sell video templates.
 * 10 classes: MarketplaceStore, TemplateListing, PricingEngine, ReviewSystem,
 *   PurchaseManager, LicenseManager, CreatorProgram, CouponSystem,
 *   RecommendationEngine, ContentDelivery
 */

let _nextId = 1;
function id(prefix = 'id') { return `${prefix}_${_nextId++}`; }
function now() { return new Date().toISOString(); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── MarketplaceStore ─────────────────────────────────────────────────────────

class MarketplaceStore {
  constructor() {
    this.products = new Map();
    this.categories = new Map();
  }

  /** Register a product so it appears in listings. */
  addProduct(product) {
    this.products.set(product.id, product);
  }

  listProducts({ category, sort_by, min_price, max_price, tags } = {}) {
    let results = [...this.products.values()];
    if (category) results = results.filter(p => p.category === category);
    if (tags && tags.length) results = results.filter(p => tags.some(t => (p.tags || []).includes(t)));
    if (min_price != null) results = results.filter(p => p.price >= min_price);
    if (max_price != null) results = results.filter(p => p.price <= max_price);
    if (sort_by === 'price_asc') results.sort((a, b) => a.price - b.price);
    else if (sort_by === 'price_desc') results.sort((a, b) => b.price - a.price);
    else if (sort_by === 'rating') results.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    else if (sort_by === 'newest') results.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return results;
  }

  getProduct(productId) {
    const p = this.products.get(productId);
    if (!p) throw new Error('product not found');
    return p;
  }

  searchProducts(query) {
    const q = query.toLowerCase();
    return [...this.products.values()].filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }

  getCategories() { return [...this.categories.values()]; }

  addCategory(cat) { this.categories.set(cat.id, cat); }

  getFeatured() {
    return [...this.products.values()]
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 10);
  }

  getNewArrivals(limit = 10) {
    return [...this.products.values()]
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, limit);
  }

  getBestSellers(limit = 10) {
    return [...this.products.values()]
      .sort((a, b) => (b.sales || 0) - (a.sales || 0))
      .slice(0, limit);
  }
}

// ── TemplateListing ──────────────────────────────────────────────────────────

class TemplateListing {
  constructor() { this.listings = new Map(); }

  createListing({ name, description, price, category, preview_url, template_data, seller_id, tags, license }) {
    const listing = {
      id: id('listing'),
      name, description, price, category, preview_url,
      template_data, seller_id,
      tags: tags || [],
      license: license || 'standard',
      created_at: now(),
      updated_at: now(),
    };
    this.listings.set(listing.id, listing);
    return listing;
  }

  getListing(listingId) {
    const l = this.listings.get(listingId);
    if (!l) throw new Error('listing not found');
    return l;
  }

  updateListing(listingId, updates) {
    const l = this.getListing(listingId);
    Object.assign(l, updates, { updated_at: now() });
    return l;
  }

  deleteListing(listingId) {
    this.getListing(listingId);
    this.listings.delete(listingId);
    return { deleted: true };
  }

  listBySeller(sellerId) {
    return [...this.listings.values()].filter(l => l.seller_id === sellerId);
  }

  duplicateListing(listingId, newPrice) {
    const orig = this.getListing(listingId);
    const dup = {
      ...orig,
      id: id('listing'),
      price: newPrice != null ? newPrice : orig.price,
      name: orig.name + ' (copy)',
      created_at: now(),
      updated_at: now(),
    };
    this.listings.set(dup.id, dup);
    return dup;
  }
}

// ── PricingEngine ────────────────────────────────────────────────────────────

class PricingEngine {
  constructor() { this.prices = new Map(); this.revenue = new Map(); }

  setPrice(listingId, { amount, currency = 'USD', sale_price, sale_ends }) {
    const result = {
      listing_id: listingId,
      amount, currency,
      sale_price: sale_price || null,
      sale_ends: sale_ends || null,
    };
    this.prices.set(listingId, result);
    return result;
  }

  calculateDiscount(amount, couponCode) {
    let discount = 0;
    // couponCode is informational here; real discount logic is in CouponSystem
    if (couponCode && couponCode.startsWith('HALF')) discount = amount * 0.5;
    else if (couponCode && couponCode.startsWith('SAVE')) discount = amount * 0.1;
    return {
      original: amount,
      discount,
      final: amount - discount,
      savings: discount,
    };
  }

  recordSale(sellerId, listingId, amount) {
    if (!this.revenue.has(sellerId)) this.revenue.set(sellerId, { total_revenue: 0, total_sales: 0, sales: [] });
    const r = this.revenue.get(sellerId);
    r.total_revenue += amount;
    r.total_sales += 1;
    r.sales.push({ listing_id: listingId, amount, date: now() });
  }

  getRevenueStats(sellerId) {
    const r = this.revenue.get(sellerId) || { total_revenue: 0, total_sales: 0, sales: [] };
    const topTemplates = {};
    for (const s of r.sales) {
      topTemplates[s.listing_id] = (topTemplates[s.listing_id] || 0) + s.amount;
    }
    const top = Object.entries(topTemplates)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([listing_id, revenue]) => ({ listing_id, revenue }));
    return {
      total_revenue: r.total_revenue,
      total_sales: r.total_sales,
      avg_price: r.total_sales ? r.total_revenue / r.total_sales : 0,
      top_templates: top,
      monthly_revenue: [{ month: now().slice(0, 7), revenue: r.total_revenue }],
    };
  }

  getPricingTiers() {
    return [
      { name: 'Free', min: 0, max: 0 },
      { name: 'Budget', min: 1, max: 5 },
      { name: 'Starter', min: 5, max: 10 },
      { name: 'Standard', min: 10, max: 20 },
      { name: 'Premium', min: 20, max: 50 },
      { name: 'Elite', min: 50, max: 100 },
    ];
  }

  estimateRoyalty(listingId, sales) {
    const price = this.prices.get(listingId);
    const perSale = price ? price.amount : 10;
    const commissionRate = 0.15;
    return {
      listing_id: listingId,
      estimated_sales: sales,
      per_sale: perSale,
      gross: perSale * sales,
      commission: perSale * sales * commissionRate,
      royalty: perSale * sales * (1 - commissionRate),
    };
  }
}

// ── ReviewSystem ─────────────────────────────────────────────────────────────

class ReviewSystem {
  constructor() { this.reviews = new Map(); this.reports = new Map(); }

  addReview(productId, { user_id, rating, comment, video_url }) {
    if (rating == null || typeof rating !== 'number') throw new Error('rating must be a number');
    const review = {
      id: id('review'),
      product_id: productId,
      user_id,
      rating: clamp(Math.round(rating), 1, 5),
      comment: comment || '',
      video_url: video_url || null,
      created_at: now(),
    };
    this.reviews.set(review.id, review);
    return review;
  }

  getReviews(productId) {
    return [...this.reviews.values()].filter(r => r.product_id === productId);
  }

  getAverageRating(productId) {
    const reviews = this.getReviews(productId);
    if (!reviews.length) return 0;
    return reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
  }

  getReviewsByUser(userId) {
    return [...this.reviews.values()].filter(r => r.user_id === userId);
  }

  reportReview(reviewId, reason) {
    const r = this.reviews.get(reviewId);
    if (!r) throw new Error('review not found');
    const report = { id: id('report'), review_id: reviewId, reason, created_at: now() };
    this.reports.set(report.id, report);
    return report;
  }

  deleteReview(reviewId) {
    if (!this.reviews.has(reviewId)) throw new Error('review not found');
    this.reviews.delete(reviewId);
    return { deleted: true };
  }

  getProductRating(productId) {
    const reviews = this.getReviews(productId);
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of reviews) dist[r.rating]++;
    return {
      average: reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0,
      count: reviews.length,
      distribution: dist,
    };
  }
}

// ── PurchaseManager ──────────────────────────────────────────────────────────

class PurchaseManager {
  constructor() { this.purchases = new Map(); }

  purchase(userId, listingId, { payment_method } = {}) {
    const purchase = {
      purchase_id: id('purchase'),
      user_id: userId,
      listing_id: listingId,
      payment_method: payment_method || 'credits',
      status: 'completed',
      license_granted: true,
      receipt_url: `/receipts/${id('receipt')}`,
      created_at: now(),
    };
    this.purchases.set(purchase.purchase_id, purchase);
    return purchase;
  }

  getPurchases(userId) {
    return [...this.purchases.values()].filter(p => p.user_id === userId);
  }

  getPurchase(purchaseId) {
    const p = this.purchases.get(purchaseId);
    if (!p) throw new Error('purchase not found');
    return p;
  }

  refund(purchaseId, reason) {
    const p = this.getPurchase(purchaseId);
    p.status = 'refunded';
    p.refund_reason = reason;
    p.refunded_at = now();
    return { purchase_id: purchaseId, status: 'refunded', reason };
  }

  getReceipt(purchaseId) {
    const p = this.getPurchase(purchaseId);
    return {
      purchase_id: p.purchase_id,
      receipt_url: p.receipt_url,
      user_id: p.user_id,
      listing_id: p.listing_id,
      date: p.created_at,
    };
  }

  checkLicense(userId, listingId) {
    const purchase = [...this.purchases.values()].find(
      p => p.user_id === userId && p.listing_id === listingId && p.status === 'completed'
    );
    if (!purchase) return { valid: false, reason: 'no active purchase' };
    return { valid: true, license_granted: true, purchase_id: purchase.purchase_id };
  }
}

// ── LicenseManager ───────────────────────────────────────────────────────────

const LICENSE_FEATURES = {
  standard: ['basic_export', 'low_res', 'single_use'],
  extended: ['commercial_use', 'resell', 'high_res', 'multi_use'],
  enterprise: ['unlimited', 'white_label', 'api_access', 'support_priority', 'custom_branding'],
};

class LicenseManager {
  constructor() { this.licenses = new Map(); }

  issueLicense(purchaseId, type = 'standard') {
    const license = {
      license_id: id('license'),
      purchase_id: purchaseId,
      type,
      features: LICENSE_FEATURES[type] || [],
      restrictions: type === 'standard' ? ['personal_use_only', 'no_resale'] : type === 'extended' ? ['no_white_label'] : [],
      issued_at: now(),
      expires_at: null, // no expiry by default
    };
    this.licenses.set(license.license_id, license);
    return license;
  }

  validateLicense(licenseId) {
    const l = this.licenses.get(licenseId);
    if (!l) return { valid: false, license: null, restrictions: [], usage_count: 0, max_usage: 0 };
    return {
      valid: true,
      license: l,
      restrictions: l.restrictions,
      usage_count: 0,
      max_usage: l.type === 'standard' ? 1 : l.type === 'extended' ? 10 : Infinity,
    };
  }

  upgradeLicense(licenseId, newType) {
    const l = this.licenses.get(licenseId);
    if (!l) throw new Error('license not found');
    l.type = newType;
    l.features = LICENSE_FEATURES[newType] || [];
    l.restrictions = newType === 'standard' ? ['personal_use_only'] : newType === 'extended' ? ['no_white_label'] : [];
    return l;
  }

  revokeLicense(licenseId) {
    this.licenses.delete(licenseId);
    return { revoked: true };
  }

  getLicensesByUser(userId) {
    // In a real system we'd link to users; here we iterate all licenses
    return [...this.licenses.values()].filter(l => l.user_id === userId || true);
  }

  getLicenseFeatures(type) {
    return LICENSE_FEATURES[type] || [];
  }
}

// ── CreatorProgram ───────────────────────────────────────────────────────────

class CreatorProgram {
  constructor() { this.creators = new Map(); this.earnings = new Map(); this.submissions = new Map(); }

  enrollCreator(userId, { portfolio_url, specialty } = {}) {
    const profile = {
      user_id: userId,
      portfolio_url: portfolio_url || '',
      specialty: specialty || 'general',
      enrolled_at: now(),
      commission_rate: 0.85, // creators keep 85%
    };
    this.creators.set(userId, profile);
    return profile;
  }

  getCreatorProfile(userId) {
    const p = this.creators.get(userId);
    if (!p) throw new Error('creator not enrolled');
    return p;
  }

  getCreatorEarnings(userId) {
    const e = this.earnings.get(userId) || { total_earned: 0, pending_payout: 0, paid_out: 0 };
    const creator = this.creators.get(userId);
    return {
      ...e,
      commission_rate: creator ? creator.commission_rate : 0.85,
    };
  }

  recordEarning(userId, amount) {
    if (!this.earnings.has(userId)) this.earnings.set(userId, { total_earned: 0, pending_payout: 0, paid_out: 0 });
    const e = this.earnings.get(userId);
    e.total_earned += amount;
    e.pending_payout += amount;
  }

  submitForReview(listingId) {
    const sub = {
      submission_id: id('submission'),
      listing_id: listingId,
      status: 'pending',
      submitted_at: now(),
    };
    this.submissions.set(sub.submission_id, sub);
    return sub;
  }

  getReviewStatus(submissionId) {
    const s = this.submissions.get(submissionId);
    if (!s) throw new Error('submission not found');
    return s;
  }

  approveSubmission(submissionId) {
    const s = this.getReviewStatus(submissionId);
    s.status = 'approved';
    s.approved_at = now();
    return s;
  }

  rejectSubmission(submissionId) {
    const s = this.getReviewStatus(submissionId);
    s.status = 'rejected';
    return s;
  }

  getTopCreators(limit = 10) {
    return [...this.creators.values()]
      .sort((a, b) => (b.total_sales || 0) - (a.total_sales || 0))
      .slice(0, limit);
  }

  getCreatorStats(userId) {
    return {
      total_sales: 0,
      avg_rating: 0,
      total_templates: [...this.submissions.values()].filter(s => s.listing_id && this.creators.has(userId)).length,
      conversion_rate: 0,
    };
  }
}

// ── CouponSystem ─────────────────────────────────────────────────────────────

class CouponSystem {
  constructor() { this.coupons = new Map(); this.applied = new Map(); }

  createCoupon({ code, discount_type, discount_value, max_uses, expires_at, min_purchase }) {
    if (!['percentage', 'fixed'].includes(discount_type)) throw new Error('discount_type must be percentage or fixed');
    const coupon = {
      id: id('coupon'),
      code: code.toUpperCase(),
      discount_type,
      discount_value,
      max_uses: max_uses || Infinity,
      expires_at: expires_at || null,
      min_purchase: min_purchase || 0,
      used_count: 0,
      created_at: now(),
      active: true,
    };
    this.coupons.set(coupon.id, coupon);
    return coupon;
  }

  validateCoupon(code, purchaseAmount) {
    const coupon = [...this.coupons.values()].find(c => c.code === code.toUpperCase() && c.active);
    if (!coupon) return { valid: false, reason: 'invalid coupon' };
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return { valid: false, reason: 'expired' };
    if (coupon.used_count >= coupon.max_uses) return { valid: false, reason: 'max uses reached' };
    if (purchaseAmount < coupon.min_purchase) return { valid: false, reason: 'min purchase not met' };
    let discount = coupon.discount_type === 'percentage'
      ? purchaseAmount * (coupon.discount_value / 100)
      : coupon.discount_value;
    discount = Math.min(discount, purchaseAmount);
    return {
      valid: true,
      discount,
      final_price: purchaseAmount - discount,
      remaining_uses: coupon.max_uses === Infinity ? Infinity : coupon.max_uses - coupon.used_count,
    };
  }

  applyCoupon(code, purchaseId) {
    const coupon = [...this.coupons.values()].find(c => c.code === code.toUpperCase() && c.active);
    if (!coupon) throw new Error('invalid coupon');
    coupon.used_count++;
    const applied = {
      id: id('applied_coupon'),
      coupon_id: coupon.id,
      code: coupon.code,
      purchase_id: purchaseId,
      applied_at: now(),
    };
    this.applied.set(applied.id, applied);
    return applied;
  }

  getCoupons(sellerId) {
    return [...this.coupons.values()].filter(c => !sellerId || c.seller_id === sellerId);
  }

  getCouponStats(couponId) {
    const coupon = this.coupons.get(couponId);
    if (!coupon) throw new Error('coupon not found');
    return {
      total_uses: coupon.used_count,
      total_savings: coupon.used_count * (coupon.discount_type === 'percentage' ? coupon.discount_value : coupon.discount_value),
      revenue_impact: 0,
    };
  }

  deactivateCoupon(couponId) {
    const coupon = this.coupons.get(couponId);
    if (!coupon) throw new Error('coupon not found');
    coupon.active = false;
    return { deactivated: true };
  }
}

// ── RecommendationEngine ─────────────────────────────────────────────────────

class RecommendationEngine {
  constructor(store) {
    this.store = store;
    this.views = new Map();   // userId → [productId, …]
    this.purchases = new Map(); // userId → [productId, …]
  }

  recordPurchase(userId, productId) {
    if (!this.purchases.has(userId)) this.purchases.set(userId, []);
    this.purchases.get(userId).push(productId);
  }

  trackView(userId, productId) {
    if (!this.views.has(userId)) this.views.set(userId, []);
    const arr = this.views.get(userId);
    // avoid consecutive duplicates
    if (arr[arr.length - 1] !== productId) arr.push(productId);
  }

  getRecommendations(userId, limit = 10) {
    const viewed = new Set(this.views.get(userId) || []);
    const purchased = new Set(this.purchases.get(userId) || []);
    const all = [...this.store.products.values()];
    // Prioritise: high rating, not purchased, viewed-but-not-purchased first
    return all
      .sort((a, b) => {
        const aScore = (a.rating || 0) + (viewed.has(a.id) && !purchased.has(a.id) ? 2 : 0) + (purchased.has(a.id) ? -1 : 0);
        const bScore = (b.rating || 0) + (viewed.has(b.id) && !purchased.has(b.id) ? 2 : 0) + (purchased.has(b.id) ? -1 : 0);
        return bScore - aScore;
      })
      .slice(0, limit);
  }

  getSimilar(productId, limit = 5) {
    const target = this.store.products.get(productId);
    if (!target) return [];
    return [...this.store.products.values()]
      .filter(p => p.id !== productId && p.category === target.category)
      .slice(0, limit);
  }

  getTrending(limit = 10) {
    return [...this.store.products.values()]
      .sort((a, b) => (b.sales || 0) - (a.sales || 0))
      .slice(0, limit);
  }

  getForYou(userId, limit = 10) {
    return this.getRecommendations(userId, limit);
  }

  getBrowseHistory(userId) {
    return (this.views.get(userId) || []).map(id => this.store.products.get(id)).filter(Boolean);
  }
}

// ── ContentDelivery ──────────────────────────────────────────────────────────

class ContentDelivery {
  constructor() {
    this.downloads = new Map();  // userId → [Download, …]
    this.quotas = new Map();
  }

  deliverProduct(purchaseId, templateData) {
    const result = {
      purchase_id: purchaseId,
      download_url: `https://cdn.vireo.studio/dl/${id('dl')}`,
      file_size: templateData ? JSON.stringify(templateData).length : 1024,
      format: 'zip',
      expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    };
    return result;
  }

  recordDownload(userId, downloadInfo) {
    if (!this.downloads.has(userId)) this.downloads.set(userId, []);
    this.downloads.get(userId).push({
      id: id('dl'),
      ...downloadInfo,
      downloaded_at: now(),
    });
  }

  getDownloadHistory(userId) {
    return this.downloads.get(userId) || [];
  }

  checkQuota(userId) {
    const downloads = this.downloads.get(userId) || [];
    const today = now().slice(0, 10);
    const todayCount = downloads.filter(d => (d.downloaded_at || '').startsWith(today)).length;
    const q = this.quotas.get(userId) || { storage_used: 0, storage_limit: 1024 * 1024 * 100 };
    return {
      downloads_today: todayCount,
      max_daily: 50,
      storage_used: q.storage_used,
      storage_limit: q.storage_limit,
    };
  }

  generateThumbnail(templateId) {
    return {
      template_id: templateId,
      thumbnail_url: `https://cdn.vireo.studio/thumbs/${templateId}.jpg`,
      width: 320,
      height: 180,
      generated_at: now(),
    };
  }

  generatePreview(templateId, format = 'video') {
    return {
      template_id: templateId,
      format,
      preview_url: `https://cdn.vireo.studio/preview/${templateId}.${format === 'gif' ? 'gif' : format === 'image' ? 'jpg' : 'mp4'}`,
      duration: format === 'video' ? 30 : null,
      generated_at: now(),
    };
  }
}

export {
  MarketplaceStore,
  TemplateListing,
  PricingEngine,
  ReviewSystem,
  PurchaseManager,
  LicenseManager,
  CreatorProgram,
  CouponSystem,
  RecommendationEngine,
  ContentDelivery,
};
