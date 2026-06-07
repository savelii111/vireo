// Metric computation & engagement analysis.

export function engagementRate(snap) {
  // Standard ER: (likes + comments + shares + saves) / views
  // If no views, fall back to followers as denominator (caller should pass it)
  const interactions = (snap.likes || 0) + (snap.comments || 0) + (snap.shares || 0) + (snap.saves || 0);
  if (!snap.views || snap.views <= 0) return 0;
  return Math.min(1, interactions / snap.views);
}

export function platformBenchmark(platform) {
  // Rough 2025-2026 industry benchmarks for ER (as fraction).
  // Source: aggregated creator reports (Socialinsider, RivalIQ, etc.)
  return {
    youtube: 0.025,
    youtube_shorts: 0.05,
    instagram_reels: 0.045,
    tiktok: 0.065,
    x: 0.012,
    linkedin: 0.025,
    threads: 0.020,
    telegram: 0.015,
    substack: 0.045,
    podcast: 0.030,
  }[platform] || 0.02;
}

export function performanceScore(snap) {
  // Returns 0..1 score comparing this piece vs platform benchmark.
  const er = engagementRate(snap);
  const bench = platformBenchmark(snap.platform);
  if (!bench) return 0;
  const ratio = er / bench;
  // log scale: 1x = 0.5, 2x = 0.75, 0.5x = 0.25
  if (ratio <= 0) return 0;
  return Math.max(0, Math.min(1, 0.5 + 0.5 * Math.log2(Math.max(0.01, ratio))));
}

export function isAnomaly(snap) {
  // A piece is "anomalous" if it dramatically over- or under-performs.
  const er = engagementRate(snap);
  const bench = platformBenchmark(snap.platform);
  if (er >= bench * 3) return { kind: "viral", multiplier: er / bench };
  if (snap.views > 0 && er <= bench * 0.2) return { kind: "flop", multiplier: er / bench };
  return null;
}
