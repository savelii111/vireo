// Metric storage + analysis orchestrator.

import { newMetricSnapshot, nowIso } from "@vireo/shared";
import { engagementRate, performanceScore, isAnomaly, platformBenchmark } from "./metrics.js";
import { StyleLearner } from "./learner.js";

export class Analyst {
  constructor() {
    this.snapshots = [];
    this.alerts = [];
  }

  ingest(snap) {
    const s = { ...newMetricSnapshot(), ...snap };
    if (!s.captured_at) s.captured_at = nowIso();
    if (typeof s.engagement_rate !== "number" || s.engagement_rate === 0) {
      s.engagement_rate = +engagementRate(s).toFixed(4);
    }
    this.snapshots.push(s);
    this._checkAnomaly(s);
    return s;
  }

  _checkAnomaly(s) {
    const a = isAnomaly(s);
    if (a) {
      this.alerts.push({
        content_id: s.content_id,
        platform: s.platform,
        kind: a.kind,
        multiplier: +a.multiplier.toFixed(2),
        engagement_rate: s.engagement_rate,
        captured_at: s.captured_at,
      });
    }
  }

  forContent(contentId) {
    return this.snapshots.filter((s) => s.content_id === contentId);
  }

  forPlatform(platform) {
    return this.snapshots.filter((s) => s.platform === platform);
  }

  report({ days = 7, platform = null } = {}) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const fresh = this.snapshots.filter((s) => {
      if (platform && s.platform !== platform) return false;
      return new Date(s.captured_at).getTime() >= cutoff;
    });

    const by = (k) => fresh.reduce((acc, s) => acc + (s[k] || 0), 0);
    const totalViews = by("views");
    const totalEng = fresh.reduce(
      (acc, s) => acc + (s.likes || 0) + (s.comments || 0) + (s.shares || 0) + (s.saves || 0),
      0,
    );

    const perPlatform = {};
    for (const p of new Set(fresh.map((s) => s.platform))) {
      const sub = fresh.filter((s) => s.platform === p);
      const v = sub.reduce((a, s) => a + s.views, 0);
      const e = sub.reduce(
        (a, s) => a + (s.likes || 0) + (s.comments || 0) + (s.shares || 0) + (s.saves || 0),
        0,
      );
      perPlatform[p] = {
        count: sub.length,
        views: v,
        engagement_rate: v > 0 ? +(e / v).toFixed(4) : 0,
        benchmark: platformBenchmark(p),
        performance_score: avg(sub.map(performanceScore)),
      };
    }

    return {
      window_days: days,
      platform_filter: platform,
      total_pieces: fresh.length,
      total_views: totalViews,
      total_engagement: totalEng,
      avg_engagement_rate: totalViews > 0 ? +(totalEng / totalViews).toFixed(4) : 0,
      per_platform: perPlatform,
      recent_alerts: this.alerts.slice(-10),
    };
  }

  learn(dna) {
    const sl = new StyleLearner(dna);
    for (const snap of this.snapshots) {
      sl.observe(snap, {});  // meta is optional — ranking works without it
    }
    return sl.recommend();
  }
}

function avg(arr) {
  if (!arr.length) return 0;
  return +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3);
}
