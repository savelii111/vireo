// Smart scheduler — picks the optimal publish time per platform.
//
// Strategy: per-platform heuristics based on peak engagement windows.
// Real version would learn from the creator's own Audience Mirror data.

const PEAK_WINDOWS = {
  youtube:       [14, 15, 16, 17, 18, 19, 20],     // 2-8 PM
  youtube_shorts:[11, 12, 13, 18, 19, 20, 21],
  instagram_reels:[11, 12, 13, 19, 20, 21],
  tiktok:        [6, 7, 8, 9, 10, 19, 20, 21, 22, 23],
  x:             [8, 9, 10, 12, 13, 17, 18],
  linkedin:      [7, 8, 9, 12, 13, 17, 18],
  threads:       [9, 10, 11, 19, 20],
  telegram:      [10, 11, 12, 18, 19, 20],
  substack:      [9, 10, 11],
  podcast:       [5, 6, 7, 17, 18, 19, 20],
};

const DAYS_AHEAD = {
  youtube: 0,        // immediate
  youtube_shorts: 0,
  instagram_reels: 0,
  tiktok: 0,
  x: 0,
  linkedin: 0,
  threads: 0,
  telegram: 0,
  substack: 1,       // next morning
  podcast: 2,        // day after
};

const MIN_GAP_MIN = 15; // never schedule two posts within 15 min of each other

export function nextSlotFor(platform, after = new Date(), existing = []) {
  const hours = PEAK_WINDOWS[platform] || [12];
  const daysAhead = DAYS_AHEAD[platform] || 0;

  // Start scanning from `after` + daysAhead, at the first peak hour.
  const start = new Date(after);
  start.setUTCDate(start.getUTCDate() + daysAhead);
  start.setUTCMinutes(0, 0, 0);

  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const candidateDay = new Date(start);
    candidateDay.setUTCDate(start.getUTCDate() + dayOffset);
    for (const h of hours) {
      const candidate = new Date(candidateDay);
      candidate.setUTCHours(h, 0, 0, 0);
      if (candidate <= after) continue;
      if (!collides(candidate, existing, MIN_GAP_MIN)) {
        return candidate.toISOString();
      }
    }
  }
  // Fallback: 1 hour from `after`
  return new Date(after.getTime() + 60 * 60 * 1000).toISOString();
}

function collides(t, existing, gapMin) {
  const tMs = t.getTime();
  const gapMs = gapMin * 60 * 1000;
  for (const e of existing) {
    if (!e) continue;
    const eMs = new Date(e.scheduled_at).getTime();
    if (Math.abs(eMs - tMs) < gapMs) return true;
  }
  return false;
}

export function buildSchedule(adaptedPieces, after = new Date()) {
  const jobs = [];
  for (const piece of adaptedPieces) {
    jobs.push({
      ...piece,
      scheduled_at: nextSlotFor(piece.platform, after, jobs),
    });
  }
  // Stable: sort by scheduled_at
  jobs.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  return jobs;
}

export const PEAK_WINDOWS_PUBLIC = PEAK_WINDOWS;
export const DAYS_AHEAD_PUBLIC = DAYS_AHEAD;
