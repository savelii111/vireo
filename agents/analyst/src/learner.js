// Style DNA learning loop — updates a DNA based on observed performance.
//
// Strategy:
//   - Group snapshots by hook_pattern, topic, platform
//   - For each group, compute average engagement vs benchmark
//   - Adjust hook_patterns/cta_patterns/topics by frequency × performance
//   - Return a new DNA + diff so callers can audit the change

import { newStyleDNA, nowIso } from "@vireo/shared";

export class StyleLearner {
  constructor(dna) {
    this.dna = { ...newStyleDNA(""), ...(dna || {}) };
    this.observations = [];
  }

  observe(snap, meta = {}) {
    // snap: {content_id, platform, views, likes, comments, shares, saves, ...}
    // meta: {hook_used, cta_used, topic, content_text}
    this.observations.push({ snap, meta });
  }

  summarize() {
    const groups = new Map();
    for (const { snap, meta } of this.observations) {
      const key = `${snap.platform}|${meta.hook_used || "?"}|${meta.cta_used || "?"}|${meta.topic || "?"}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ snap, meta });
    }
    return [...groups.entries()].map(([key, items]) => {
      const avgEr = items.reduce((s, x) => s + er(x.snap), 0) / items.length;
      return { key, count: items.length, avg_er: avgEr };
    });
  }

  // Recommend the next DNA. Pure function — caller can compare before applying.
  recommend() {
    const dna = JSON.parse(JSON.stringify(this.dna));
    const counts = new Map();
    const perfByHook = new Map();
    const perfByCta = new Map();
    const perfByTopic = new Map();
    const perfByPlatform = new Map();

    for (const { snap, meta } of this.observations) {
      const erVal = er(snap);
      const inc = (m, k, w) => m.set(k, (m.get(k) || 0) + w);
      if (meta.hook_used) {
        inc(counts, `hook:${meta.hook_used}`, 1);
        inc(perfByHook, meta.hook_used, erVal);
      }
      if (meta.cta_used) {
        inc(counts, `cta:${meta.cta_used}`, 1);
        inc(perfByCta, meta.cta_used, erVal);
      }
      if (meta.topic) {
        inc(counts, `topic:${meta.topic}`, 1);
        inc(perfByTopic, meta.topic, erVal);
      }
      if (snap.platform) {
        inc(perfByPlatform, snap.platform, erVal);
      }
    }

    // Rank hooks: avg ER among uses
    const rankedHooks = [...perfByHook.entries()]
      .map(([h, sumEr]) => ({ h, avg: sumEr / (counts.get(`hook:${h}`) || 1) }))
      .sort((a, b) => b.avg - a.avg)
      .map((x) => x.h);

    const rankedCtas = [...perfByCta.entries()]
      .map(([c, sumEr]) => ({ c, avg: sumEr / (counts.get(`cta:${c}`) || 1) }))
      .sort((a, b) => b.avg - a.avg)
      .map((x) => x.c);

    const rankedTopics = [...perfByTopic.entries()]
      .map(([t, sumEr]) => ({ t, avg: sumEr / (counts.get(`topic:${t}`) || 1) }))
      .sort((a, b) => b.avg - a.avg)
      .map((x) => x.t);

    const updates = {
      hook_patterns: mergeRanked(dna.hook_patterns || [], rankedHooks, 5),
      cta_patterns: mergeRanked(dna.cta_patterns || [], rankedCtas, 5),
      topics: mergeRanked(dna.topics || [], rankedTopics, 8),
    };

    // No observations → return the original DNA unchanged (no updated_at bump, empty diff).
    if (this.observations.length === 0) {
      return { current: dna, recommended: dna, diff: [], sample_count: 0 };
    }

    const next = { ...dna, ...updates, updated_at: nowIso() };
    const diff = diffObjects(dna, next);
    return { current: dna, recommended: next, diff, sample_count: this.observations.length };
  }
}

function er(snap) {
  const i = (snap.likes || 0) + (snap.comments || 0) + (snap.shares || 0) + (snap.saves || 0);
  if (!snap.views || snap.views <= 0) return 0;
  return Math.min(1, i / snap.views);
}

function mergeRanked(existing, ranked, cap) {
  const out = [];
  const seen = new Set();
  // Existing first (preserve intent)
  for (const e of existing) {
    if (!seen.has(e)) { out.push(e); seen.add(e); }
    if (out.length >= cap) break;
  }
  // Then ranked
  for (const r of ranked) {
    if (!seen.has(r)) { out.push(r); seen.add(r); }
    if (out.length >= cap) break;
  }
  return out;
}

function diffObjects(a, b) {
  const changes = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      changes.push({ key: k, from: a[k], to: b[k] });
    }
  }
  return changes;
}
