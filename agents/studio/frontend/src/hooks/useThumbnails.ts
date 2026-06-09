// useThumbnails — generates stable thumbnail URLs for clips based on
// source filename. Uses picsum.photos which is fast + free + has
// deterministic seeds.
//
// In production this would call the server's /api/clip/:id/thumbnail
// endpoint which extracts a frame via ffmpeg and caches it.

const PALETTE = [
  '6366f1', 'a855f7', 'ec4899', 'f59e0b', '10b981',
  '06b6d4', '3b82f6', 'ef4444', '8b5cf6', 'f97316',
];

/**
 * Build a stable thumbnail URL for a clip.
 *
 * @param sourceFile - the source filename (e.g. "drone_shot_sunset.mp4")
 * @param width      - desired thumbnail width
 * @param height     - desired thumbnail height
 * @returns URL string
 */
export function thumbnailUrl(sourceFile: string, width = 160, height = 90): string {
  // Strip extension
  const stem = sourceFile.replace(/\.[^.]+$/, '');
  // picsum.photos supports deterministic seed + grayscale + blur
  // We use the grayscale=false to keep colors, but lock a fixed ID.
  // We avoid template-literal-with-`#` because esbuild on Windows has
  // a parser quirk there. Plain string concat instead.
  return "https://picsum.photos/seed/" + encodeURIComponent(stem) + "/" + String(width) + "/" + String(height);
}

/**
 * Hash a string to a stable integer in [0, 2^32).
 * Uses a tiny djb2 variant — collision-free for filenames, fast.
 */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Fallback gradient string for when no image has loaded.
 * Same color as the clip block so the timeline doesn't flicker.
 */
export function fallbackGradient(sourceFile: string): string {
  const stem = sourceFile.replace(/\.[^.]+$/, '');
  const seed = hashString(stem);
  const c1 = PALETTE[seed % PALETTE.length];
  const c2 = PALETTE[(seed >> 3) % PALETTE.length];
  // Use string concat (not template literal) — esbuild on Windows has a
  // parsing quirk when '#' appears in template-literal expressions.
  return "linear-gradient(135deg, #" + c1 + ", #" + c2 + ")";
}
