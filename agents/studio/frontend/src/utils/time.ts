// Time formatting helpers — all the formats video editors expect.

export const formatTimecode = (sec: number, fps = 30): string => {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const f = Math.floor((sec - Math.floor(sec)) * fps);
  if (h > 0) {
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}:${pad2(f)}`;
  }
  return `${pad2(m)}:${pad2(s)}.${pad1(Math.floor((sec - Math.floor(sec)) * 10))}`;
};

export const formatShortTime = (sec: number): string => {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${pad2(m)}:${pad2(s)}`;
};

export const formatSeconds = (sec: number): string => {
  if (!isFinite(sec) || sec < 0) sec = 0;
  return `${sec.toFixed(1)}s`;
};

const pad2 = (n: number) => n.toString().padStart(2, '0');
const pad1 = (n: number) => n.toString().padStart(1, '0');
