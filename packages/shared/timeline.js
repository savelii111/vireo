// Shared timeline contract used by frontend, studio backend, and tests.
// The same shape must be used by humans and bot tools.

function newId(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 14)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const TIMELINE_KINDS = Object.freeze({
  VIDEO: "video",
  IMAGE: "image",
  AUDIO: "audio",
  TEXT: "text",
  OVERLAY: "overlay",
});

export const TIMELINE_CLIP_SOURCES = Object.freeze({
  UPLOAD: "upload",
  HIGGSFIELD: "higgsfield",
  STOCK: "stock",
  GENERATED: "generated",
});

export const TIMELINE_OPS = Object.freeze({
  INSERT_CLIP: "insertClip",
  TRIM_CLIP: "trimClip",
  SPLIT_CLIP: "splitClip",
  MOVE_CLIP: "moveClip",
  DELETE_CLIP: "deleteClip",
  GROUP_CLIPS: "groupClips",
  ADD_TRANSITION: "addTransition",
  ADD_EFFECT: "addEffect",
  ADD_TEXT: "addText",
  SET_EFFECT: "setEffect",
  SET_TITLE_PROPS: "setTitleProps",
  SET_TRACK_AUDIO: "setTrackAudio",
  SET_CLIP_AUDIO: "setClipAudio",
  SET_CLIP_COLOR: "setClipColor",
  SET_TRANSFORM: "setTransform",
  SET_KEYFRAME: "setKeyframe",
  REMOVE_KEYFRAME: "removeKeyframe",
  SET_VOLUME: "setVolume",
  REPLACE_ASSET: "replaceAsset",
  SET_TRACK_FLAG: "setTrackFlag",
  // Internal inverse-only ops accepted by applyOp for undo/redo journal replay.
  REMOVE_TRANSITION: "removeTransition",
  REMOVE_EFFECT: "removeEffect",
  REMOVE_TEXT: "removeText",
  REMOVE_VOLUME: "removeVolume",
  MERGE_CLIPS: "mergeClips",
  UNGROUP_CLIPS: "ungroupClips",
});

export const PUBLIC_TIMELINE_OPS = Object.freeze([
  TIMELINE_OPS.INSERT_CLIP,
  TIMELINE_OPS.TRIM_CLIP,
  TIMELINE_OPS.SPLIT_CLIP,
  TIMELINE_OPS.MOVE_CLIP,
  TIMELINE_OPS.DELETE_CLIP,
  TIMELINE_OPS.GROUP_CLIPS,
  TIMELINE_OPS.ADD_TRANSITION,
  TIMELINE_OPS.ADD_EFFECT,
  TIMELINE_OPS.ADD_TEXT,
  TIMELINE_OPS.SET_EFFECT,
  TIMELINE_OPS.SET_TITLE_PROPS,
  TIMELINE_OPS.SET_TRACK_AUDIO,
  TIMELINE_OPS.SET_CLIP_AUDIO,
  TIMELINE_OPS.SET_CLIP_COLOR,
  TIMELINE_OPS.SET_TRANSFORM,
  TIMELINE_OPS.SET_KEYFRAME,
  TIMELINE_OPS.REMOVE_KEYFRAME,
  TIMELINE_OPS.SET_VOLUME,
  TIMELINE_OPS.REPLACE_ASSET,
  TIMELINE_OPS.SET_TRACK_FLAG,
]);

export const DEFAULT_RESOLUTION = Object.freeze({ w: 1080, h: 1920 });

export const EXPORT_PRESETS = Object.freeze([
  Object.freeze({ id: "youtube_1080p", name: "YouTube 1080p", width: 1920, height: 1080, fps: 30, videoCodec: "h264", audioCodec: "aac", videoBitrateKbps: 8000, audioBitrateKbps: 192, container: "mp4" }),
  Object.freeze({ id: "youtube_4k", name: "YouTube 4K", width: 3840, height: 2160, fps: 30, videoCodec: "h264", audioCodec: "aac", videoBitrateKbps: 35000, audioBitrateKbps: 192, container: "mp4" }),
  Object.freeze({ id: "instagram_square_1080", name: "Instagram Square 1080", width: 1080, height: 1080, fps: 30, videoCodec: "h264", audioCodec: "aac", videoBitrateKbps: 6000, audioBitrateKbps: 128, container: "mp4" }),
  Object.freeze({ id: "tiktok_vertical_1080", name: "TikTok Vertical 1080", width: 1080, height: 1920, fps: 30, videoCodec: "h264", audioCodec: "aac", videoBitrateKbps: 6000, audioBitrateKbps: 128, container: "mp4" }),
  Object.freeze({ id: "web_720p", name: "Web 720p", width: 1280, height: 720, fps: 30, videoCodec: "h264", audioCodec: "aac", videoBitrateKbps: 4000, audioBitrateKbps: 128, container: "mp4" }),
]);

export class TimelineOpError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TimelineOpError";
    this.code = code;
    this.httpStatus = 400;
  }
}

export function createEmptyTimelineDocument({ projectId = "", timelineId = "", userId = "", fps = 30, resolution = DEFAULT_RESOLUTION } = {}) {
  return normalizeTimelineDocument({
    timelineId: timelineId || newId("tl"),
    projectId,
    userId,
    fps,
    resolution,
    version: 1,
    tracks: [
      { id: "trk_v1", kind: TIMELINE_KINDS.VIDEO, name: "Video 1", muted: false, locked: false, clips: [] },
      { id: "trk_a1", kind: TIMELINE_KINDS.AUDIO, name: "Audio 1", muted: false, locked: false, clips: [] },
      { id: "trk_t1", kind: TIMELINE_KINDS.TEXT, name: "Text 1", muted: false, locked: false, clips: [] },
    ],
    transitions: [],
    markers: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
}

export function normalizeResolution(value) {
  if (!value || typeof value !== "object") return { ...DEFAULT_RESOLUTION };
  const w = Number(value.w ?? value.width);
  const h = Number(value.h ?? value.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { ...DEFAULT_RESOLUTION };
  return { w, h };
}

export function normalizeTimelineDocument(doc) {
  if (!doc || typeof doc !== "object") throw new Error("Timeline document must be an object");

  const normalized = {
    timelineId: String(doc.timelineId || newId("tl")),
    projectId: String(doc.projectId || ""),
    userId: String(doc.userId || ""),
    fps: Number(doc.fps || 30),
    resolution: normalizeResolution(doc.resolution),
    version: Number(doc.version || 1),
    tracks: Array.isArray(doc.tracks) ? doc.tracks.map(normalizeTrack) : [],
    transitions: Array.isArray(doc.transitions) ? doc.transitions.map((item) => ({ ...item })) : [],
    markers: Array.isArray(doc.markers) ? doc.markers.map((item) => ({ ...item })) : [],
    createdAt: doc.createdAt || doc.created_at || nowIso(),
    updatedAt: doc.updatedAt || doc.updated_at || nowIso(),
  };

  validateTimelineDocument(normalized);
  return normalized;
}

export function normalizeTrack(track) {
  if (!track || typeof track !== "object") throw new Error("Track must be an object");
  return {
    id: String(track.id || newId("trk")),
    kind: track.kind || TIMELINE_KINDS.VIDEO,
    name: String(track.name || "Track"),
    muted: Boolean(track.muted),
    locked: Boolean(track.locked),
    hidden: Boolean(track.hidden),
    soloed: Boolean(track.soloed),
    role: normalizeTrackRole(track.role),
    audio: normalizeAudioTrack(track.audio),
    clips: Array.isArray(track.clips) ? track.clips.map(normalizeClip) : [],
  };
}

function normalizeTrackRole(value) {
  const role = String(value || "other");
  return ["voice", "music", "sfx", "ambience", "other"].includes(role) ? role : "other";
}

function clampDb(value, fallback, min = -60, max = 12) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function clampPan(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0;
}

function clampDuration(value, fallback, max = 30) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : fallback;
}

export function normalizeAudioTrack(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    role: normalizeTrackRole(raw.role),
    gainDb: clampDb(raw.gainDb ?? raw.gain_db, 0),
    pan: clampPan(raw.pan),
    fadeIn: clampDuration(raw.fadeIn ?? raw.fade_in, 0),
    fadeOut: clampDuration(raw.fadeOut ?? raw.fade_out, 0),
    crossfade: clampDuration(raw.crossfade, 0.25),
    ducking: normalizeAudioDucking(raw.ducking),
    metadata: { simulated_levels: true, real_decode: false },
  };
}

function normalizeAudioDucking(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    enabled: Boolean(raw.enabled),
    amountDb: Math.min(0, clampDb(raw.amountDb ?? raw.amount_db, -12, -60, 0)),
    thresholdDb: Math.min(0, clampDb(raw.thresholdDb ?? raw.threshold_db, -30, -60, 0)),
    attackSec: clampDuration(raw.attackSec ?? raw.attack_sec, 0.02, 5),
    releaseSec: clampDuration(raw.releaseSec ?? raw.release_sec, 0.2, 10),
  };
}

export function normalizeAudioClip(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    gainDb: clampDb(raw.gainDb ?? raw.gain_db, 0),
    pan: clampPan(raw.pan),
    fadeIn: clampDuration(raw.fadeIn ?? raw.fade_in, 0),
    fadeOut: clampDuration(raw.fadeOut ?? raw.fade_out, 0),
    crossfade: clampDuration(raw.crossfade, 0.25),
    meters: Array.isArray(raw.meters) ? raw.meters.map((item) => ({
      time: Math.max(0, Number(item.time ?? item.time_sec ?? 0)),
      level: clampDb(item.level ?? item.db, -60),
      peak: clampDb(item.peak ?? item.peak_db, -60),
    })) : [],
    waveform: Array.isArray(raw.waveform) ? raw.waveform.map((item) => clampDb(item, 0)).slice(0, 240) : [],
    metadata: { simulated_levels: true, real_decode: false },
  };
}

function mergeAudioPatch(previous, patch, allowed) {
  const next = { ...(previous || {}) };
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key];
  }
  return next;
}

export function normalizeClip(clip) {
  if (!clip || typeof clip !== "object") throw new Error("Clip must be an object");
  const start = Number(clip.start ?? clip.start_sec ?? 0);
  const end = Number(clip.end ?? (clip.start_sec ?? 0) + (clip.duration_sec ?? clip.duration ?? 0));
  const inPoint = Number(clip.in ?? clip.in_sec ?? clip.inPoint ?? 0);
  const outPoint = Number(clip.out ?? clip.out_sec ?? clip.outPoint ?? end - start);
  const keyframes = normalizeClipKeyframes(clip.keyframes);
  const hasKeyframes = Object.values(keyframes.transform || {}).some((frames) => frames.length > 0)
    || Object.values(keyframes.effects || {}).some((params) => Object.values(params || {}).some((frames) => frames.length > 0));
  const normalized = {
    id: String(clip.id || newId("clp")),
    kind: clip.kind || TIMELINE_KINDS.VIDEO,
    assetId: String(clip.assetId ?? clip.asset_id ?? clip.source_file ?? ""),
    start,
    end: Number.isFinite(end) && end > start ? end : start + 1,
    in: inPoint,
    out: outPoint,
    transform: { ...(clip.transform || {}) },
    effects: Array.isArray(clip.effects) ? clip.effects.map((effect) => ({ ...effect })) : [],
    source: clip.source || TIMELINE_CLIP_SOURCES.UPLOAD,
    name: String(clip.name || "Clip"),
    selected: Boolean(clip.selected),
    locked: Boolean(clip.locked),
    muted: Boolean(clip.muted),
    text: clip.text == null ? "" : String(clip.text),
    titleProps: normalizeTitleProps(clip.titleProps),
    color: normalizeColorGrade(clip.color),
    audio: normalizeAudioClip(clip.audio),
  };
  if (hasKeyframes) normalized.keyframes = keyframes;
  return normalized;
}

export function normalizeTitleProps(value) {
  const validHexColor = (candidate) => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(candidate || "").trim());
  if (!value || typeof value !== "object") {
    return {
      text: "",
      fontFamily: "Inter",
      fontSize: 44,
      color: "#ffffff",
      align: "center",
      backgroundColor: "",
      strokeColor: "",
      strokeWidth: 0,
    };
  }

  const fontSize = Number(value.fontSize ?? value.size ?? 44);
  const strokeWidth = Number(value.strokeWidth ?? 0);
  return {
    text: value.text == null ? "" : String(value.text),
    fontFamily: String(value.fontFamily || value.font || "Inter"),
    fontSize: Number.isFinite(fontSize) ? Math.max(8, Math.min(240, fontSize)) : 44,
    color: validHexColor(value.color) ? String(value.color).trim() : "#ffffff",
    align: ["left", "center", "right"].includes(String(value.align || "center")) ? String(value.align || "center") : "center",
    backgroundColor: value.backgroundColor == null ? "" : validHexColor(value.backgroundColor) ? String(value.backgroundColor).trim() : "",
    strokeColor: value.strokeColor == null ? "" : validHexColor(value.strokeColor) ? String(value.strokeColor).trim() : "",
    strokeWidth: Number.isFinite(strokeWidth) ? Math.max(0, Math.min(12, strokeWidth)) : 0,
  };
}

const BASIC_COLOR_PARAMS = ["temperature", "tint", "exposure", "contrast", "highlights", "shadows", "whites", "blacks", "saturation", "vibrance"];

function clampRange(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function normalizeHexOrNull(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(text) ? text.toLowerCase() : null;
}

function normalizeCurvePoints(value) {
  return (Array.isArray(value) ? value : [])
    .map((point) => {
      const raw = point && typeof point === "object" ? point : { x: point, y: point };
      const x = clampRange(raw.x, 0, 0, 1);
      const y = clampRange(raw.y, 0, 0, 1);
      return { x, y };
    })
    .sort((a, b) => a.x - b.x || a.y - b.y);
}

function normalizeWheel(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    r: clampRange(raw.r ?? raw.red, 0, -1, 1),
    g: clampRange(raw.g ?? raw.green, 0, -1, 1),
    b: clampRange(raw.b ?? raw.blue, 0, -1, 1),
  };
}

export function normalizeColorGrade(value) {
  const raw = value && typeof value === "object" ? value : {};
  const basicRaw = raw.basic || raw.basicCorrection || {};
  const creativeRaw = raw.creative || {};
  const curvesRaw = raw.curves || raw.rgbCurves || {};
  const wheelsRaw = raw.wheels || raw.colorWheels || {};
  const metadataRaw = raw.metadata || {};
  return {
    basic: {
      temperature: clampRange(basicRaw.temperature, 0, -100, 100),
      tint: clampRange(basicRaw.tint, 0, -100, 100),
      exposure: clampRange(basicRaw.exposure, 0, -5, 5),
      contrast: clampRange(basicRaw.contrast, 0, -100, 100),
      highlights: clampRange(basicRaw.highlights, 0, -100, 100),
      shadows: clampRange(basicRaw.shadows, 0, -100, 100),
      whites: clampRange(basicRaw.whites, 0, -100, 100),
      blacks: clampRange(basicRaw.blacks, 0, -100, 100),
      saturation: clampRange(basicRaw.saturation, 100, 0, 200),
      vibrance: clampRange(basicRaw.vibrance, 0, -100, 100),
    },
    creative: {
      lut: {
        id: creativeRaw.lut?.id ? String(creativeRaw.lut.id) : "",
        name: creativeRaw.lut?.name ? String(creativeRaw.lut.name) : "",
        intensity: clampRange(creativeRaw.lut?.intensity, 0, 0, 100),
      },
      faded: clampRange(creativeRaw.faded, 0, 0, 100),
      sharpen: clampRange(creativeRaw.sharpen, 0, -100, 100),
      tintShadows: normalizeHexOrNull(creativeRaw.tintShadows),
      tintHighlights: normalizeHexOrNull(creativeRaw.tintHighlights),
    },
    curves: {
      master: normalizeCurvePoints(curvesRaw.master),
      r: normalizeCurvePoints(curvesRaw.r),
      g: normalizeCurvePoints(curvesRaw.g),
      b: normalizeCurvePoints(curvesRaw.b),
    },
    wheels: {
      shadows: normalizeWheel(wheelsRaw.shadows || wheelsRaw.lift),
      midtones: normalizeWheel(wheelsRaw.midtones || wheelsRaw.gamma),
      highlights: normalizeWheel(wheelsRaw.highlights || wheelsRaw.gain),
    },
    metadata: {
      simulated_scopes: Boolean(metadataRaw.simulated_scopes ?? metadataRaw.simulatedScopes ?? true),
      real_pixel_analysis: Boolean(metadataRaw.real_pixel_analysis ?? metadataRaw.realPixelAnalysis ?? false),
      real_lut_apply: Boolean(metadataRaw.real_lut_apply ?? metadataRaw.realLutApply ?? false),
    },
  };
}

export function evalColorAtTime(keyframes, t, defaultValue = 0) {
  return evalParamAtTime(keyframes, t, defaultValue);
}

export function computeClipColorAt(timeline, clip, t) {
  const base = normalizeColorGrade(clip.color || {});
  const colorFrames = clip.keyframes?.effects?.color || {};
  const next = normalizeColorGrade(base);
  for (const param of BASIC_COLOR_PARAMS) {
    const frames = Array.isArray(colorFrames[param]) ? colorFrames[param] : [];
    const value = evalParamAtTime(frames, t, base.basic[param]);
    next.basic[param] = clampRange(value, base.basic[param], param === "saturation" ? 0 : -100, param === "saturation" ? 200 : 100);
  }
  return next;
}

export function computeSimulatedColorScopes(timeline, clip, t) {
  const color = computeClipColorAt(timeline, clip, t);
  const exposure = color.basic.exposure / 5;
  const contrast = color.basic.contrast / 100;
  const saturation = color.basic.saturation / 100;
  const lut = color.creative.lut.intensity / 100;
  const deterministic = Math.sin((Number(t) || 0) + color.basic.temperature * 0.01) * 0.5 + 0.5;
  return {
    histogram: [0.18, 0.34, 0.46, 0.58, 0.52, 0.39, 0.26].map((value, index) => clampRange(value + exposure * 0.06 + contrast * 0.04 + (index - 3) * 0.01, value, 0, 1)),
    waveform: [0.2, 0.36, 0.52, 0.64, 0.56, 0.42, 0.28].map((value, index) => clampRange(value + exposure * 0.05 + saturation * 0.02 + deterministic * 0.03, value, 0, 1)),
    vectorscope: [
      { x: 0.5 + color.basic.temperature / 200, y: 0.5 + color.basic.tint / 200 },
      { x: 0.5 + (color.wheels.shadows.r - color.wheels.highlights.r) * 0.12, y: 0.5 + (color.creative.lut.id ? lut * 0.18 : 0) },
      { x: 0.5 + color.wheels.midtones.g * 0.12, y: 0.5 + color.wheels.midtones.b * 0.12 },
    ].map((point) => ({ x: clampRange(point.x, 0.5, 0, 1), y: clampRange(point.y, 0.5, 0, 1) })),
    metadata: { simulated_scopes: true, real_pixel_analysis: false, approx_preview: true },
  };
}

export function normalizeKeyframe(value) {
  if (!value || typeof value !== "object") throw new Error("Keyframe must be an object");
  const time = Number(value.time ?? value.time_sec ?? value.t ?? 0);
  const keyValue = Number(value.value ?? value.v ?? value.amount ?? 0);
  if (!Number.isFinite(time) || time < 0) throw new Error("Keyframe.time must be finite and non-negative");
  if (!Number.isFinite(keyValue)) throw new Error("Keyframe.value must be finite");
  const interp = String(value.interp ?? value.interpolation ?? "linear");
  if (!["linear", "hold"].includes(interp)) throw new Error(`Unsupported keyframe interpolation: ${interp}`);
  return { time, value: keyValue, interp };
}

export function normalizeKeyframes(value) {
  return (Array.isArray(value) ? value : [])
    .map(normalizeKeyframe)
    .sort((a, b) => a.time - b.time || String(a.interp).localeCompare(String(b.interp)));
}

export function normalizeClipKeyframes(value) {
  if (!value || typeof value !== "object") return { transform: {}, effects: {} };
  const transform = {};
  const effects = {};
  for (const [target, params] of Object.entries(value.transform || {})) {
    transform[target] = Array.isArray(params) ? params.map(normalizeKeyframe).sort((a, b) => a.time - b.time) : [];
  }
  for (const [effectId, params] of Object.entries(value.effects || {})) {
    effects[effectId] = {};
    for (const [param, frames] of Object.entries(params || {})) {
      effects[effectId][param] = Array.isArray(frames) ? frames.map(normalizeKeyframe).sort((a, b) => a.time - b.time) : [];
    }
  }
  return { transform, effects };
}

export function evalParamAtTime(keyframes, t, defaultValue = 0) {
  const frames = normalizeKeyframes(keyframes);
  const time = Number(t);
  if (!Number.isFinite(time)) return Number.isFinite(defaultValue) ? defaultValue : 0;
  if (frames.length === 0) return Number.isFinite(defaultValue) ? defaultValue : 0;
  if (time <= frames[0].time) return frames[0].value;
  if (time >= frames[frames.length - 1].time) return frames[frames.length - 1].value;

  let leftIndex = 0;
  for (let i = 0; i < frames.length - 1; i++) {
    if (frames[i].time <= time && time <= frames[i + 1].time) {
      leftIndex = i;
      break;
    }
  }

  const left = frames[leftIndex];
  const right = frames[leftIndex + 1];
  if (left.interp === "hold" || right.interp === "hold") return left.value;
  if (right.time === left.time) return right.value;
  const ratio = (time - left.time) / (right.time - left.time);
  return left.value + (right.value - left.value) * ratio;
}

export function createTimelineOp({ op, actor = "human", timelineId, payload = {}, clipId, trackId } = {}) {
  if (!op || !isPublicTimelineOp(op)) throw new Error(`Unknown timeline op: ${op}`);
  return {
    op,
    actor,
    timelineId,
    clipId: clipId || "",
    trackId: trackId || "",
    payload,
    createdAt: nowIso(),
  };
}

export function applyOp(doc, op) {
  const timeline = normalizeTimelineDocument(doc);
  const normalizedOp = normalizeOp(op);
  const original = clone(timeline);

  try {
    const inverse = applyOpInternal(timeline, normalizedOp);
    validateTimelineDocument(timeline);
    return { doc: timeline, inverse };
  } catch (error) {
    // The reducer works on a clone, but keep this explicit: failed ops never
    // return a partially-applied document.
    if (error instanceof TimelineOpError) throw error;
    throw Object.assign(new TimelineOpError("timeline_op_invalid", error.message), { cause: error });
  } finally {
    // Defensive guard for future refactorings that accidentally mutate the
    // normalized input clone after an error path. The caller's original doc is
    // never mutated because normalizeTimelineDocument returns a new object.
    if (JSON.stringify(timeline) !== JSON.stringify(original) && false) {
      Object.assign(timeline, original);
    }
  }
}

export function applyTimelineOp(doc, op) {
  const result = applyOp(doc, op);
  const next = {
    ...result.doc,
    version: Number(result.doc.version || 1) + 1,
    updatedAt: nowIso(),
  };
  Object.defineProperty(next, "inverse", {
    value: result.inverse,
    enumerable: false,
    configurable: true,
  });
  validateTimelineDocument(next);
  return next;
}

export function serializeTimelineDocument(doc) {
  return JSON.stringify(normalizeTimelineDocument(doc), null, 2);
}

export function deserializeTimelineDocument(value) {
  if (typeof value === "string") {
    return normalizeTimelineDocument(JSON.parse(value));
  }
  return normalizeTimelineDocument(value);
}

export function validateTimelineDocument(doc) {
  if (!Array.isArray(doc.tracks)) throw new Error("Timeline tracks must be an array");
  if (!Number.isFinite(Number(doc.fps)) || Number(doc.fps) <= 0) throw new Error("Timeline fps must be positive");
  const ids = new Set();
  for (const track of doc.tracks) {
    if (!track.id || ids.has(track.id)) throw new Error(`Duplicate timeline id: ${track.id}`);
    ids.add(track.id);
    if (!Array.isArray(track.clips)) throw new Error(`Track ${track.id} clips must be an array`);
    for (const clip of track.clips) {
      if (!clip.id || ids.has(clip.id)) throw new Error(`Duplicate timeline id: ${clip.id}`);
      ids.add(clip.id);
      if (clip.end <= clip.start) throw new Error(`Clip ${clip.id} end must be greater than start`);
    }
  }
  return true;
}

function normalizeOp(op) {
  if (!op || typeof op !== "object") throw new TimelineOpError("timeline_op_invalid", "Timeline op must be an object");
  const opName = op.op;
  if (!isTimelineOp(opName)) throw new TimelineOpError("timeline_op_invalid", `Unknown timeline op: ${opName}`);

  const payload = op.payload && typeof op.payload === "object" ? { ...op.payload } : {};
  return {
    op: opName,
    actor: op.actor || "human",
    timelineId: String(op.timelineId || ""),
    clipId: String(op.clipId || payload.clipId || payload.clip_id || ""),
    trackId: String(op.trackId || payload.trackId || payload.track_id || ""),
    payload,
    createdAt: op.createdAt ?? "",
  };
}

function applyOpInternal(timeline, op) {
  switch (op.op) {
    case TIMELINE_OPS.INSERT_CLIP:
      return insertClip(timeline, op);
    case TIMELINE_OPS.TRIM_CLIP:
      return trimClip(timeline, op);
    case TIMELINE_OPS.SPLIT_CLIP:
      return splitClip(timeline, op);
    case TIMELINE_OPS.MOVE_CLIP:
      return moveClip(timeline, op);
    case TIMELINE_OPS.DELETE_CLIP:
      return deleteClip(timeline, op);
    case TIMELINE_OPS.GROUP_CLIPS:
      return groupClips(timeline, op);
    case TIMELINE_OPS.ADD_TRANSITION:
      return addTransition(timeline, op);
    case TIMELINE_OPS.ADD_EFFECT:
      return addEffect(timeline, op);
    case TIMELINE_OPS.ADD_TEXT:
      return addText(timeline, op);
    case TIMELINE_OPS.SET_EFFECT:
      return setEffect(timeline, op);
    case TIMELINE_OPS.SET_TITLE_PROPS:
      return setTitleProps(timeline, op);
    case TIMELINE_OPS.SET_TRACK_AUDIO:
      return setTrackAudio(timeline, op);
    case TIMELINE_OPS.SET_CLIP_AUDIO:
      return setClipAudio(timeline, op);
    case TIMELINE_OPS.SET_CLIP_COLOR:
      return setClipColor(timeline, op);
    case TIMELINE_OPS.SET_TRANSFORM:
      return setTransform(timeline, op);
    case TIMELINE_OPS.SET_KEYFRAME:
      return setKeyframe(timeline, op);
    case TIMELINE_OPS.REMOVE_KEYFRAME:
      return removeKeyframe(timeline, op);
    case TIMELINE_OPS.SET_VOLUME:
      return setVolume(timeline, op);
    case TIMELINE_OPS.REPLACE_ASSET:
      return replaceAsset(timeline, op);
    case TIMELINE_OPS.SET_TRACK_FLAG:
      return setTrackFlag(timeline, op);
    case TIMELINE_OPS.REMOVE_TRANSITION:
      return removeTransition(timeline, op);
    case TIMELINE_OPS.REMOVE_EFFECT:
      return removeEffect(timeline, op);
    case TIMELINE_OPS.REMOVE_TEXT:
      return removeText(timeline, op);
    case TIMELINE_OPS.MERGE_CLIPS:
      return mergeClips(timeline, op);
    case TIMELINE_OPS.UNGROUP_CLIPS:
      return ungroupClips(timeline, op);
    default:
      throw new TimelineOpError("timeline_op_invalid", `Timeline op not implemented: ${op.op}`);
  }
}

export function snapTime(candidateTime, anchors = [], thresholdPx = 0, pxPerSec = 1) {
  const candidate = Number(candidateTime);
  if (!Number.isFinite(candidate)) return 0;
  const threshold = Number(thresholdPx);
  const scale = Number(pxPerSec);
  if (!Number.isFinite(threshold) || threshold <= 0 || !Number.isFinite(scale) || scale <= 0) return candidate;

  let best = candidate;
  let bestDistance = Infinity;
  for (const anchor of Array.isArray(anchors) ? anchors : []) {
    const time = Number(anchor);
    if (!Number.isFinite(time)) continue;
    const distance = Math.abs(candidate - time) * scale;
    if (distance <= threshold + 1e-9 && distance < bestDistance) {
      best = time;
      bestDistance = distance;
    }
  }
  return best;
}

function clipStart(clip) {
  return numberOr(clip.start ?? clip.start_sec, 0);
}

function clipEnd(clip) {
  const start = clipStart(clip);
  return numberOr(clip.end ?? clip.end_sec ?? start + 1, start + 1);
}

function clipRange(clip) {
  const start = clipStart(clip);
  const end = clipEnd(clip);
  return { start, end: end > start ? end : start + 1 };
}

function clipsOverlap(a, b) {
  const left = clipRange(a);
  const right = clipRange(b);
  return left.start < right.end && right.start < left.end;
}

function rangeOverlapsAny(range, clips) {
  for (const clip of clips) {
    if (clipsOverlap(range, clip)) return true;
  }
  return false;
}

function sortedClips(track, excludeId = "") {
  return track.clips
    .filter((clip) => clip.id !== excludeId)
    .sort((a, b) => clipStart(a) - clipStart(b) || clipEnd(a) - clipEnd(b));
}

function adjacentClips(track, clip, index = -1) {
  const sorted = sortedClips(track, clip.id);
  const effectiveIndex = Number.isFinite(index) && index >= 0 ? index : sorted.findIndex((item) => item.id === clip.id);
  return {
    previous: effectiveIndex > 0 ? sorted[effectiveIndex - 1] : null,
    next: effectiveIndex >= 0 && effectiveIndex < sorted.length ? sorted[effectiveIndex + 1] : null,
  };
}

function clampToRange(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (!Number.isFinite(max)) return Math.max(value, min);
  return Math.min(Math.max(value, min), max);
}

export function clampTrimRange({ track, clip, index = -1, start, end, originalStart = NaN, originalEnd = NaN, publicOp = true }) {
  const nextStart = numberOr(start, clip.start);
  const nextEnd = numberOr(end, clip.end);
  if (!publicOp) return { start: nextStart, end: nextEnd };
  if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd) || nextEnd <= nextStart) {
    throw invalid(`Invalid trim range for clip ${clip.id}`);
  }

  const { previous, next } = adjacentClips(track, clip, index);
  const lower = Math.max(0, clip.start, previous ? clipEnd(previous) : 0);
  const upper = Math.min(clip.end, next ? clipStart(next) : clip.end);
  const minDuration = 0.001;
  if (lower >= upper) throw invalid(`No room to trim clip ${clip.id}`);

  const originalStartTime = Number(originalStart);
  const originalEndTime = Number(originalEnd);
  let clampedStart = nextStart;
  let clampedEnd = nextEnd;

  if (Number.isFinite(originalStartTime) && Number.isFinite(originalEndTime)) {
    if (Math.abs(clampedStart - originalStartTime) > 1e-6) {
      clampedStart = clampToRange(clampedStart, lower, clampedEnd - minDuration);
    }
    if (Math.abs(clampedEnd - originalEndTime) > 1e-6) {
      clampedEnd = clampToRange(clampedEnd, clampedStart + minDuration, upper);
    }
  } else {
    clampedStart = clampToRange(clampedStart, lower, upper - minDuration);
    clampedEnd = clampToRange(clampedEnd, clampedStart + minDuration, upper);
  }

  if (clampedEnd <= clampedStart) throw invalid(`No room to trim clip ${clip.id}`);
  return { start: clampedStart, end: clampedEnd };
}

export function clampMoveStart({ track, clip, start, targetIndex = NaN, publicOp = true }) {
  const duration = clip.end - clip.start;
  const nextStart = Math.max(0, numberOr(start, clip.start));
  if (!publicOp) return nextStart;
  if (!Number.isFinite(duration) || duration <= 0) throw invalid(`Invalid move duration for clip ${clip.id}`);

  const sorted = sortedClips(track, clip.id);
  const effectiveIndex = Number.isFinite(targetIndex) ? Math.max(0, Math.min(Math.floor(targetIndex), sorted.length)) : null;
  const range = { start: nextStart, end: nextStart + duration };

  if (effectiveIndex !== null) {
    const before = effectiveIndex > 0 ? sorted[effectiveIndex - 1] : null;
    const after = effectiveIndex < sorted.length ? sorted[effectiveIndex] : null;
    const lower = before ? clipEnd(before) : 0;
    const upper = after ? clipStart(after) - duration : Infinity;
    if (upper < lower) throw invalid(`No room to move clip ${clip.id}`);
    return clampToRange(nextStart, lower, upper);
  }

  if (!rangeOverlapsAny(range, sorted)) return nextStart;
  const candidates = [0];
  for (const item of sorted) {
    candidates.push(clipEnd(item));
    candidates.push(clipStart(item) - duration);
  }

  let best = 0;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate) || candidate < 0) continue;
    const candidateRange = { start: candidate, end: candidate + duration };
    if (rangeOverlapsAny(candidateRange, sorted)) continue;
    const distance = Math.abs(candidate - nextStart);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function insertClip(timeline, op) {
  const track = findTrack(timeline, op.trackId);
  const rawClip = op.payload.clip || buildClipFromPayload(op.payload);
  const clip = normalizeClip({ ...rawClip, kind: rawClip.kind || track.kind });
  if (clip.end <= clip.start) throw invalid(`Clip ${clip.id} end must be greater than start`);
  if (timelineHasId(timeline, clip.id)) throw invalid(`Duplicate timeline id: ${clip.id}`);
  const index = Number.isFinite(numberOr(op.payload.index ?? op.payload.targetIndex ?? op.payload.target_index, NaN))
    ? numberOr(op.payload.index ?? op.payload.targetIndex ?? op.payload.target_index, track.clips.length)
    : track.clips.length;
  track.clips.splice(index, 0, clip);
  return {
    op: TIMELINE_OPS.DELETE_CLIP,
    actor: op.actor,
    timelineId: op.timelineId,
    clipId: clip.id,
    trackId: track.id,
    payload: { clip: clone(clip), index },
    createdAt: "",
  };
}

function trimClip(timeline, op) {
  const { clip } = resolveClip(timeline, op.trackId, op.clipId);
  const previousStart = clip.start;
  const previousEnd = clip.end;
  const originalStart = numberOr(op.payload.originalStart ?? op.payload.original_start, NaN);
  const originalEnd = numberOr(op.payload.originalEnd ?? op.payload.original_end, NaN);
  const start = numberOr(op.payload.start ?? op.payload.start_sec, previousStart);
  const end = numberOr(op.payload.end ?? op.payload.end_sec, previousEnd);
  const { track } = resolveClip(timeline, op.trackId, op.clipId);
  const index = track.clips.findIndex((item) => item.id === op.clipId);
  if (op.createdAt !== "" && track.locked) throw invalid(`Track is locked: ${track.id}`);
  if (Number.isFinite(originalStart) && Number.isFinite(originalEnd) && originalEnd > originalStart) {
    clip.start = originalStart;
    clip.end = originalEnd;
  } else {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw invalid(`Invalid trim range for clip ${clip.id}`);
    const clamped = clampTrimRange({ track, clip, index, start, end, originalStart, originalEnd, publicOp: op.createdAt !== "" });
    clip.start = clamped.start;
    clip.end = clamped.end;
  }
  const inversePayload = { start, end };
  if (Number.isFinite(start) && Number.isFinite(end)) {
    inversePayload.originalStart = previousStart;
    inversePayload.originalEnd = previousEnd;
  }
  return {
    ...op,
    payload: inversePayload,
  };
}

function splitClip(timeline, op) {
  const { track, clip, index } = resolveClip(timeline, op.trackId, op.clipId);
  const at = numberOr(op.payload.at ?? op.payload.splitAt, NaN);
  if (!Number.isFinite(at) || at <= clip.start || at >= clip.end) throw invalid(`Split time outside clip ${clip.id}`);

  const leftId = String(op.payload.leftId || op.payload.left_id || clip.id);
  const rightId = String(op.payload.rightId || op.payload.right_id || newId("clp"));
  if (leftId === rightId || timelineHasId(timeline, rightId)) {
    throw invalid("Split clip ids must be unique");
  }

  const left = { ...clone(clip), id: leftId, end: at };
  const right = { ...clone(clip), id: rightId, start: at };
  track.clips.splice(index, 1, left, right);

  return {
    op: TIMELINE_OPS.MERGE_CLIPS,
    actor: op.actor,
    timelineId: op.timelineId,
    clipId: leftId,
    trackId: track.id,
    payload: {
      mergeWithClipId: rightId,
      mergedClip: clone(clip),
    },
    createdAt: "",
  };
}

function moveClip(timeline, op) {
  const { track, clip, index } = resolveClip(timeline, op.trackId, op.clipId);
  const targetTrack = findTrack(timeline, op.payload.targetTrackId || op.payload.target_track_id || op.trackId);
  const duration = clip.end - clip.start;
  const start = numberOr(op.payload.start ?? op.payload.newStart ?? op.payload.start_sec, clip.start);
  if (!Number.isFinite(start) || start < 0) throw invalid(`Invalid move start for clip ${clip.id}`);
  if (op.createdAt !== "" && (track.locked || targetTrack.locked)) {
    throw invalid(`Track is locked: ${track.locked ? track.id : targetTrack.id}`);
  }

  const requestedTargetIndex = numberOr(op.payload.index ?? op.payload.targetIndex ?? op.payload.target_index, NaN);
  const oldTrackId = track.id;
  const oldStart = clip.start;
  track.clips.splice(index, 1);
  const spliceIndex = Number.isFinite(requestedTargetIndex) ? requestedTargetIndex : targetTrack.clips.length;
  const clampedStart = clampMoveStart({ track: targetTrack, clip, start, targetIndex: Number.isFinite(requestedTargetIndex) ? requestedTargetIndex : null, publicOp: op.createdAt !== "" });
  const moved = { ...clip, start: clampedStart, end: clampedStart + duration };
  targetTrack.clips.splice(spliceIndex, 0, moved);

  return {
    ...op,
    trackId: oldTrackId,
    payload: { start: oldStart, index, targetTrackId: targetTrack.id === oldTrackId ? oldTrackId : targetTrack.id },
  };
}

function deleteClip(timeline, op) {
  const { track, clip, index } = resolveClip(timeline, op.trackId, op.clipId || op.payload.clip?.id);
  const removed = clone(clip);
  if (removed.keyframes) {
    const hasTransform = Object.values(removed.keyframes.transform || {}).some((frames) => frames.length > 0);
    const hasEffects = Object.values(removed.keyframes.effects || {}).some((params) => Object.values(params || {}).some((frames) => frames.length > 0));
    if (!hasTransform && !hasEffects) delete removed.keyframes;
  }
  track.clips.splice(index, 1);
  return {
    op: TIMELINE_OPS.INSERT_CLIP,
    actor: op.actor,
    timelineId: op.timelineId,
    clipId: removed.id,
    trackId: track.id,
    payload: { clip: removed, index },
    createdAt: "",
  };
}

function groupClips(timeline, op) {
  const clipIds = Array.isArray(op.payload.clipIds) ? op.payload.clipIds.map(String) : [];
  if (clipIds.length < 2) throw invalid("groupClips requires at least two clipIds");

  const positions = clipIds.map((clipId) => {
    const { track, clip, index } = resolveClip(timeline, op.trackId || "", clipId);
    return { trackId: track.id, index, clip: clone(clip) };
  });
  const firstTrackId = positions[0].trackId;
  if (!positions.every((p) => p.trackId === firstTrackId)) throw invalid("groupClips currently groups clips on one track");

  const groupId = String(op.payload.groupId || op.payload.id || newId("grp"));
  if (timelineHasId(timeline, groupId)) throw invalid(`Duplicate timeline id: ${groupId}`);

  const track = findTrack(timeline, firstTrackId);
  const groupedClips = positions.map((p) => p.clip);
  const start = Math.min(...groupedClips.map((c) => c.start));
  const end = Math.max(...groupedClips.map((c) => c.end));
  const groupClip = normalizeClip({
    id: groupId,
    assetId: "",
    start,
    end,
    in: start,
    out: end,
    transform: {},
    effects: [],
    keyframes: { transform: {}, effects: {} },
    source: "group",
    name: op.payload.name || "Group",
    groupedClipIds: clipIds,
    groupedClips,
  });

  const sortedPositions = [...positions].sort((a, b) => b.index - a.index);
  for (const p of sortedPositions) track.clips.splice(p.index, 1);
  track.clips.push(groupClip);

  return {
    op: TIMELINE_OPS.UNGROUP_CLIPS,
    actor: op.actor,
    timelineId: op.timelineId,
    clipId: groupId,
    trackId: firstTrackId,
    payload: { groupId, groupedClips },
    createdAt: "",
  };
}

function ungroupClips(timeline, op) {
  const { track, clip, index } = resolveClip(timeline, op.trackId, op.clipId || op.payload.groupId);
  if (!Array.isArray(op.payload.groupedClips)) throw invalid("ungroupClips requires groupedClips");
  const restored = op.payload.groupedClips.map(normalizeClip);
  for (const item of restored) {
    if (item.id !== clip.id && timelineHasId(timeline, item.id)) throw invalid(`Duplicate timeline id: ${item.id}`);
  }
  track.clips.splice(index, 1, ...restored);
  return {
    op: TIMELINE_OPS.GROUP_CLIPS,
    actor: op.actor,
    timelineId: op.timelineId,
    trackId: track.id,
    payload: {
      clipIds: restored.map((c) => c.id),
      groupId: clip.id,
      name: clip.name,
    },
    createdAt: "",
  };
}

function addTransition(timeline, op) {
  const id = String(op.payload.id || op.payload.transitionId || newId("tr"));
  if (timeline.transitions.some((item) => item.id === id)) throw invalid(`Duplicate transition id: ${id}`);
  const transition = {
    id,
    clipId: op.payload.clipId || op.clipId || "",
    trackId: op.payload.trackId || op.trackId || "",
    fromClipId: op.payload.fromClipId || "",
    toClipId: op.payload.toClipId || "",
    kind: op.payload.kind || "crossfade",
    duration: numberOr(op.payload.duration, 0.5),
    metadata: clone(op.payload.metadata || {}),
  };
  timeline.transitions.push(transition);
  return {
    op: TIMELINE_OPS.REMOVE_TRANSITION,
    actor: op.actor,
    timelineId: op.timelineId,
    transitionId: id,
    trackId: "",
    clipId: "",
    payload: { transition: clone(transition) },
    createdAt: "",
  };
}

function removeTransition(timeline, op) {
  const id = String(op.transitionId || op.payload.transitionId || op.payload.transition?.id || "");
  const index = timeline.transitions.findIndex((item) => item.id === id);
  if (index < 0) throw invalid(`Transition not found: ${id}`);
  const removed = clone(timeline.transitions[index]);
  timeline.transitions.splice(index, 1);
  return {
    op: TIMELINE_OPS.ADD_TRANSITION,
    actor: op.actor,
    timelineId: op.timelineId,
    trackId: removed.trackId || "",
    clipId: removed.clipId || "",
    payload: { ...removed, transition: removed },
    createdAt: "",
  };
}

function addEffect(timeline, op) {
  const { clip } = resolveClip(timeline, op.trackId, op.clipId);
  const effect = clone(op.payload.effect || op.payload.effects?.[0] || { id: newId("fx"), name: "Effect" });
  if (!effect || typeof effect !== "object") throw invalid("Effect must be an object");
  effect.id = String(effect.id || newId("fx"));
  if (clip.effects.some((item) => item.id === effect.id)) throw invalid(`Duplicate effect id: ${effect.id}`);
  clip.effects.push(effect);
  return {
    op: TIMELINE_OPS.REMOVE_EFFECT,
    actor: op.actor,
    timelineId: op.timelineId,
    clipId: clip.id,
    trackId: op.trackId,
    effectId: effect.id,
    payload: { effect: clone(effect) },
    createdAt: "",
  };
}

function removeEffect(timeline, op) {
  const { clip } = resolveClip(timeline, op.trackId, op.clipId);
  const effectId = String(op.effectId || op.payload.effectId || op.payload.effect?.id || "");
  const index = clip.effects.findIndex((item) => item.id === effectId);
  if (index < 0) throw invalid(`Effect not found: ${effectId}`);
  const removed = clone(clip.effects[index]);
  clip.effects.splice(index, 1);
  return {
    op: TIMELINE_OPS.ADD_EFFECT,
    actor: op.actor,
    timelineId: op.timelineId,
    clipId: clip.id,
    trackId: op.trackId,
    effectId: removed.id,
    payload: { effect: removed },
    createdAt: "",
  };
}

function addText(timeline, op) {
  const trackId = op.trackId || TIMELINE_KINDS.TEXT;
  const track = op.trackId ? findTrack(timeline, trackId) : findTrackByKind(timeline, TIMELINE_KINDS.TEXT) || ensureTrack(timeline, TIMELINE_KINDS.TEXT, "Text");
  const rawClip = op.payload.clip || {
    id: op.payload.id || op.payload.clipId || newId("txt"),
    assetId: "",
    start: op.payload.start ?? op.payload.start_sec ?? 0,
    end: op.payload.end ?? op.payload.end_sec ?? 3,
    in: op.payload.in ?? op.payload.in_sec ?? 0,
    out: op.payload.out ?? op.payload.out_sec ?? 3,
    transform: clone(op.payload.transform || {}),
    effects: [],
    keyframes: { transform: {}, effects: {} },
    source: "text",
    kind: TIMELINE_KINDS.TEXT,
    name: op.payload.text || "Text clip",
    text: op.payload.text || "",
    titleProps: normalizeTitleProps({
      ...op.payload.titleProps,
      text: op.payload.text ?? op.payload.titleProps?.text,
    }),
  };
  const clip = normalizeClip(rawClip);
  if (clip.end <= clip.start) throw invalid(`Text clip ${clip.id} end must be greater than start`);
  if (timelineHasId(timeline, clip.id)) throw invalid(`Duplicate timeline id: ${clip.id}`);
  track.clips.push(clip);
  return {
    op: TIMELINE_OPS.REMOVE_TEXT,
    actor: op.actor,
    timelineId: op.timelineId,
    clipId: clip.id,
    trackId: track.id,
    payload: { clip: clone(clip) },
    createdAt: "",
  };
}

function removeText(timeline, op) {
  const { track, clip, index } = resolveClip(timeline, op.trackId, op.clipId || op.payload.clip?.id);
  const removed = clone(clip);
  track.clips.splice(index, 1);
  return {
    op: TIMELINE_OPS.ADD_TEXT,
    actor: op.actor,
    timelineId: op.timelineId,
    clipId: removed.id,
    trackId: track.id,
    payload: { clip: removed },
    createdAt: "",
  };
}

function setEffect(timeline, op) {
  const { clip } = resolveClip(timeline, op.trackId, op.clipId);
  if (!op.payload || typeof op.payload.effect !== "object") throw invalid("setEffect requires payload.effect");
  const nextEffect = clone(op.payload.effect);
  nextEffect.id = String(nextEffect.id || newId("fx"));
  let index = Number.isInteger(op.payload.index) ? op.payload.index : null;
  if (index == null && op.payload.effectId) index = clip.effects.findIndex((item) => item.id === op.payload.effectId);
  if (index == null || index < 0 || index >= clip.effects.length) throw invalid(`Effect not found for clip ${clip.id}`);
  const previous = clone(clip.effects[index]);
  clip.effects[index] = nextEffect;
  return {
    ...op,
    effectId: previous.id,
    payload: { effect: previous, index },
  };
}

function keyframeTargetStore(clip, targetId) {
  clip.keyframes = normalizeClipKeyframes(clip.keyframes);
  if (targetId === "transform") return { store: clip.keyframes.transform || (clip.keyframes.transform = {}), kind: "transform" };
  if (targetId === "audio") {
    const effects = clip.keyframes.effects || (clip.keyframes.effects = {});
    return { store: effects.audio || (effects.audio = {}), kind: "audio" };
  }
  if (targetId === "color") {
    const effects = clip.keyframes.effects || (clip.keyframes.effects = {});
    return { store: effects.color || (effects.color = {}), kind: "color" };
  }
  const effect = clip.effects.find((item) => item.id === targetId);
  if (!effect) throw invalid(`Effect not found: ${targetId}`);
  const effectStore = clip.keyframes.effects || (clip.keyframes.effects = {});
  return { store: effectStore[targetId] || (effectStore[targetId] = {}), kind: "effect" };
}

function setKeyframe(timeline, op) {
  const { clip } = resolveClip(timeline, op.trackId, op.clipId);
  const targetId = String(op.payload.targetId || op.payload.effectId || "transform");
  const param = String(op.payload.param || op.payload.parameter || "");
  const frame = normalizeKeyframe(op.payload.keyframe || op.payload.frame || op.payload);
  if (!param) throw invalid("setKeyframe requires param");
  const { store } = keyframeTargetStore(clip, targetId);
  const existing = Array.isArray(store[param]) ? store[param] : [];
  const previous = clone(existing);
  const next = op.payload.restore
    ? normalizeKeyframes(op.payload.previous)
    : existing
      .filter((item) => Math.abs(Number(item.time) - frame.time) > 1e-9)
      .concat(frame)
      .sort((a, b) => a.time - b.time);
  store[param] = next;
  if (next.length === 0) delete store[param];
  if (targetId !== "transform" && next.length === 0) delete clip.keyframes.effects[targetId];
  if (targetId === "transform" && ["x", "y", "scale", "opacity", "rotation"].includes(param)) {
    clip.transform = { ...(clip.transform || {}) };
    clip.transform[param] = frame.value;
  }
  return {
    op: TIMELINE_OPS.SET_KEYFRAME,
    actor: op.actor,
    timelineId: op.timelineId,
    clipId: clip.id,
    trackId: op.trackId,
    targetId,
    param,
    payload: { targetId, param, keyframe: frame, previous, restore: true },
  };
}

function removeKeyframe(timeline, op) {
  const { clip } = resolveClip(timeline, op.trackId, op.clipId);
  const targetId = String(op.payload.targetId || op.payload.effectId || "transform");
  const param = String(op.payload.param || op.payload.parameter || "");
  const time = Number(op.payload.time ?? op.payload.keyframe?.time);
  if (!param || !Number.isFinite(time)) throw invalid("removeKeyframe requires param and time");
  const { store } = keyframeTargetStore(clip, targetId);
  const existing = Array.isArray(store[param]) ? store[param] : [];
  const removedIndex = existing.findIndex((item) => Math.abs(Number(item.time) - time) <= 1e-9);
  if (removedIndex < 0) throw invalid(`Keyframe not found at ${time}`);
  const removed = clone(existing[removedIndex]);
  const previous = clone(existing);
  const next = existing.filter((_, index) => index !== removedIndex);
  if (next.length) store[param] = next;
  else delete store[param];
  if (Object.keys(store).length === 0) delete clip.keyframes.effects[targetId];
  if (targetId === "transform" && ["x", "y", "scale", "opacity", "rotation"].includes(param)) {
    clip.transform = { ...(clip.transform || {}) };
    clip.transform[param] = next.length ? next[next.length - 1].value : undefined;
    if (clip.transform[param] === undefined) delete clip.transform[param];
  }
  return {
    op: TIMELINE_OPS.SET_KEYFRAME,
    actor: op.actor,
    timelineId: op.timelineId,
    clipId: clip.id,
    trackId: op.trackId,
    targetId,
    param,
    payload: { targetId, param, keyframe: removed, previous, restore: true },
  };
}

function setTitleProps(timeline, op) {
  const { clip } = resolveClip(timeline, op.trackId, op.clipId);
  if (!op.payload || typeof op.payload.titleProps !== "object") throw invalid("setTitleProps requires payload.titleProps");
  if (clip.source !== "text") throw invalid("setTitleProps only applies to text clips");
  const previous = clone(clip.titleProps || normalizeTitleProps({}));
  const next = normalizeTitleProps({ ...previous, ...op.payload.titleProps });
  clip.titleProps = next;
  return {
    ...op,
    payload: { titleProps: previous },
  };
}

function setTrackAudio(timeline, op) {
  const track = findTrack(timeline, op.trackId);
  if (!op.payload || typeof op.payload.audio !== "object") throw invalid("setTrackAudio requires payload.audio");
  const previous = {
    role: track.role || "other",
    audio: clone(track.audio || normalizeAudioTrack({})),
  };
  const audioPayload = op.payload.audio;
  const hasMixFields = ["gainDb", "gain_db", "pan", "fadeIn", "fade_in", "fadeOut", "fade_out", "crossfade", "ducking"].some((key) => key in audioPayload);
  if (hasMixFields && track.kind !== TIMELINE_KINDS.AUDIO) throw invalid("setTrackAudio only applies to audio tracks");
  track.role = normalizeTrackRole(audioPayload.role ?? previous.role);
  if (hasMixFields) {
    track.audio = normalizeAudioTrack({ ...previous.audio, ...audioPayload });
  }
  return {
    ...op,
    payload: {
      audio: {
        role: previous.role,
        ...previous.audio,
      },
    },
  };
}

function setClipAudio(timeline, op) {
  const { track, clip } = resolveClip(timeline, op.trackId, op.clipId);
  if (track.kind !== TIMELINE_KINDS.AUDIO) throw invalid("setClipAudio only applies to audio clips");
  if (!op.payload || typeof op.payload.audio !== "object") throw invalid("setClipAudio requires payload.audio");
  const previous = clone(clip.audio || normalizeAudioClip({}));
  const next = normalizeAudioClip({ ...previous, ...op.payload.audio });
  clip.audio = next;
  return {
    ...op,
    payload: { audio: previous },
  };
}

function setClipColor(timeline, op) {
  const { track, clip } = resolveClip(timeline, op.trackId, op.clipId);
  if (!["video", "image"].includes(track.kind)) throw invalid("setClipColor only applies to visual clips");
  if (!op.payload || typeof op.payload.color !== "object") throw invalid("setClipColor requires payload.color");
  const previous = clone(clip.color || normalizeColorGrade({}));
  const next = normalizeColorGrade(mergeColorFields(previous, op.payload.color));
  clip.color = next;
  return {
    ...op,
    payload: { color: previous },
  };
}

function mergeColorFields(previous, patch) {
  const next = clone(previous || {});
  for (const key of Object.keys(patch || {})) {
    const value = patch[key];
    if (value && typeof value === "object" && !Array.isArray(value) && next[key] && typeof next[key] === "object" && !Array.isArray(next[key])) {
      next[key] = mergeColorFields(next[key], value);
    } else {
      next[key] = clone(value);
    }
  }
  return next;
}

function setTransform(timeline, op) {
  const { clip } = resolveClip(timeline, op.trackId, op.clipId);
  if (!op.payload || typeof op.payload.transform !== "object") throw invalid("setTransform requires payload.transform");
  const nextTransform = { ...(clip.transform || {}) };
  for (const key of ["x", "y", "scale", "opacity", "rotation"]) {
    if (Object.prototype.hasOwnProperty.call(op.payload.transform, key)) {
      nextTransform[key] = Number(op.payload.transform[key]);
    }
  }
  if (!Number.isFinite(nextTransform.scale) || nextTransform.scale < 0) throw invalid("setTransform.scale must be non-negative");
  if (!Number.isFinite(nextTransform.opacity) || nextTransform.opacity < 0 || nextTransform.opacity > 1) throw invalid("setTransform.opacity must be between 0 and 1");
  const previous = clone(clip.transform || {});
  clip.transform = nextTransform;
  return {
    ...op,
    payload: { transform: previous },
  };
}

function setVolume(timeline, op) {
  const { clip } = resolveClip(timeline, op.trackId, op.clipId);
  const volume = Number(op.payload?.volume);
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw invalid("setVolume.volume must be between 0 and 1");
  const previous = clip.volume ?? 1;
  clip.volume = volume;
  return {
    ...op,
    payload: { volume: previous },
  };
}

function replaceAsset(timeline, op) {
  const { clip } = resolveClip(timeline, op.trackId, op.clipId);
  const assetId = String(op.payload.assetId ?? op.payload.asset_id ?? "");
  if (!assetId) throw invalid("replaceAsset requires assetId");
  const previous = clip.assetId;
  clip.assetId = assetId;
  return {
    ...op,
    payload: { assetId: previous },
  };
}

function setTrackFlag(timeline, op) {
  const track = findTrack(timeline, op.trackId);
  const previous = {};
  let changed = false;
  for (const flag of ["muted", "soloed", "locked", "hidden"]) {
    if (Object.prototype.hasOwnProperty.call(op.payload, flag)) {
      if (typeof op.payload[flag] !== "boolean") throw invalid(`setTrackFlag.${flag} must be boolean`);
      previous[flag] = track[flag];
      track[flag] = op.payload[flag];
      changed = true;
    }
  }
  if (!changed) throw invalid("setTrackFlag requires at least one flag");
  return {
    ...op,
    payload: previous,
  };
}

function mergeClips(timeline, op) {
  const { track, clip, index } = resolveClip(timeline, op.trackId, op.clipId);
  const mergeWithClipId = String(op.payload.mergeWithClipId || "");
  const rightIndex = track.clips.findIndex((item) => item.id === mergeWithClipId);
  if (rightIndex < 0) throw invalid(`Merge clip not found: ${mergeWithClipId}`);
  if (!op.payload.mergedClip || typeof op.payload.mergedClip !== "object") throw invalid("mergeClips requires mergedClip");
  const merged = normalizeClip({ ...op.payload.mergedClip, id: clip.id });
  const right = track.clips[rightIndex];
  if (Math.abs(right.start - clip.end) > 1e-6) throw invalid("mergeClips clips must be adjacent");
  track.clips.splice(index, 1, merged);
  if (rightIndex > index) track.clips.splice(rightIndex, 1);
  else track.clips.splice(rightIndex, 1);
  return {
    op: TIMELINE_OPS.SPLIT_CLIP,
    actor: op.actor,
    timelineId: op.timelineId,
    clipId: merged.id,
    trackId: track.id,
    payload: { at: merged.end, leftId: merged.id, rightId: mergeWithClipId },
    createdAt: "",
  };
}

function buildClipFromPayload(payload) {
  const start = numberOr(payload.start ?? payload.start_sec, 0);
  const rawEnd = payload.end ?? payload.end_sec ?? (payload.duration_sec ?? payload.duration);
  const end = rawEnd == null ? start + 1 : numberOr(rawEnd, start + 1);
  if (!Number.isFinite(end) || end <= start) throw invalid("insertClip requires end greater than start");
  const clip = {
    id: payload.id || payload.clipId || newId("clp"),
    kind: payload.kind || TIMELINE_KINDS.VIDEO,
    assetId: payload.assetId ?? payload.asset_id ?? "",
    start,
    end,
    in: numberOr(payload.in ?? payload.in_sec, 0),
    out: numberOr(payload.out ?? payload.out_sec, end - start),
    transform: clone(payload.transform || {}),
    effects: Array.isArray(payload.effects) ? clone(payload.effects) : [],
    source: payload.source || TIMELINE_CLIP_SOURCES.UPLOAD,
    name: payload.name || "Clip",
    selected: Boolean(payload.selected),
    locked: Boolean(payload.locked),
    muted: Boolean(payload.muted),
    text: payload.text == null ? "" : String(payload.text),
    titleProps: normalizeTitleProps(payload.titleProps),
    color: normalizeColorGrade(payload.color),
    audio: normalizeAudioClip(payload.audio),
    volume: numberOr(payload.volume, 1),
  };
  if (payload.keyframes) clip.keyframes = normalizeClipKeyframes(payload.keyframes);
  return clip;
}

function activeClipAtTime(clip, t) {
  return Number.isFinite(t) && clipStart(clip) <= t && t < clipEnd(clip);
}

function voiceLevelDb(clip, t) {
  if (!activeClipAtTime(clip, t)) return -Infinity;
  const clipAudio = clip.audio || normalizeAudioClip({});
  const gain = clampDb(clipAudio.gainDb, 0);
  const keyframes = clip.keyframes?.effects?.audio?.gain ?? [];
  const keyframeGain = evalParamAtTime(keyframes, t, 0);
  return gain + keyframeGain;
}

function duckingEnvelope(trackAudio, t, voiceClip) {
  const amount = Math.min(0, Number(trackAudio.amountDb ?? -12));
  const attack = Math.max(0, Number(trackAudio.attackSec ?? 0.02));
  const release = Math.max(0, Number(trackAudio.releaseSec ?? 0.2));
  const start = clipStart(voiceClip);
  const end = clipEnd(voiceClip);
  if (attack > 0 && t >= start && t < start + attack) return amount * ((t - start) / attack);
  if (release > 0 && t > end - release && t < end) return amount * ((end - t) / release);
  return amount;
}

export function computeDuckingReductionDb(timeline, trackId, t) {
  const track = findTrack(timeline, trackId);
  const audio = track.audio || normalizeAudioTrack({});
  const ducking = audio.ducking || {};
  if (!ducking.enabled) return 0;
  const threshold = Number(ducking.thresholdDb ?? -30);
  let reduction = 0;
  for (const voiceTrack of timeline.tracks) {
    if (voiceTrack.id === track.id || voiceTrack.role !== "voice") continue;
    if (voiceTrack.muted) continue;
    for (const voiceClip of voiceTrack.clips) {
      const level = voiceLevelDb(voiceClip, t);
      if (level >= threshold) {
        reduction = Math.min(reduction, duckingEnvelope(ducking, t, voiceClip));
      }
    }
  }
  return reduction;
}

export function computeClipGainDb(timeline, clip, t) {
  const track = timeline.tracks.find((item) => item.clips.some((itemClip) => itemClip.id === clip.id));
  const clipAudio = clip.audio || normalizeAudioClip({});
  const trackAudio = track?.audio || normalizeAudioTrack({});
  const keyframes = clip.keyframes?.effects?.audio?.gain ?? [];
  const keyframeGain = evalParamAtTime(keyframes, t, 0);
  const ducking = track && track.id && track.kind === TIMELINE_KINDS.AUDIO ? computeDuckingReductionDb(timeline, track.id, t) : 0;
  return clipAudio.gainDb + trackAudio.gainDb + keyframeGain + ducking;
}

function findTrack(timeline, trackId) {
  const track = timeline.tracks.find((item) => item.id === trackId);
  if (!track) throw invalid(`Track not found: ${trackId}`);
  return track;
}

function findTrackByKind(timeline, kind) {
  return timeline.tracks.find((item) => item.kind === kind) || null;
}

function findTrackByClip(timeline, clipId) {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

function resolveClip(timeline, trackId, clipId) {
  if (trackId) {
    const track = findTrack(timeline, trackId);
    const index = track.clips.findIndex((item) => item.id === clipId);
    if (index < 0) throw invalid(`Clip not found: ${clipId}`);
    return { track, clip: track.clips[index], index };
  }

  const located = findTrackByClip(timeline, clipId);
  if (!located) throw invalid(`Clip not found: ${clipId}`);
  return { ...located, index: located.track.clips.findIndex((item) => item.id === clipId) };
}

function ensureTrack(timeline, kind, name) {
  let track = findTrackByKind(timeline, kind);
  if (!track) {
    track = normalizeTrack({ id: newId("trk"), kind, name });
    timeline.tracks.push(track);
  }
  return track;
}

function timelineHasId(timeline, id) {
  if (!id) return false;
  for (const track of timeline.tracks) {
    if (track.id === id) return true;
    if (track.clips.some((clip) => clip.id === id)) return true;
  }
  return false;
}

function clampEven(value, min, max, fallback) {
  const n = Math.round(Number.isFinite(value) ? value : fallback);
  const clamped = Math.max(min, Math.min(max, n));
  return clamped % 2 === 0 ? clamped : clamped - 1;
}

export function normalizeExportPreset(value) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const id = typeof value === "string" ? value : String(raw.id || "youtube_1080p");
  const known = EXPORT_PRESETS.find((preset) => preset.id === id);
  if (!known) throw invalid(`unknown export preset: ${id}`);
  const width = clampEven(Number(raw.width ?? known.width), 16, 7680, known.width);
  const height = clampEven(Number(raw.height ?? known.height), 16, 7680, known.height);
  const fps = [24, 25, 30, 50, 60].includes(Number(raw.fps ?? known.fps)) ? Number(raw.fps ?? known.fps) : known.fps;
  const videoBitrateKbps = Math.max(1, Number(raw.videoBitrateKbps ?? known.videoBitrateKbps));
  const audioBitrateKbps = Math.max(1, Number(raw.audioBitrateKbps ?? known.audioBitrateKbps));
  return Object.freeze({
    id,
    name: String(raw.name ?? known.name),
    width,
    height,
    fps,
    videoCodec: "h264",
    audioCodec: "aac",
    videoBitrateKbps,
    audioBitrateKbps,
    container: "mp4",
  });
}

function isRenderVisibleTrack(track) {
  return track && !track.muted && !track.hidden && !track.soloed;
}

function isRenderableClip(track, clip) {
  return Boolean(clip && !clip.muted && (track.kind === TIMELINE_KINDS.AUDIO || [TIMELINE_KINDS.VIDEO, TIMELINE_KINDS.IMAGE, TIMELINE_KINDS.OVERLAY].includes(track.kind)));
}

export function buildRenderPlan(timeline, presetId) {
  if (!timeline || !Array.isArray(timeline.tracks)) throw invalid("render plan requires a timeline document");
  normalizeExportPreset({ id: presetId });
  const plan = [];
  const transitions = timeline.transitions || [];
  for (const track of timeline.tracks) {
    if (!isRenderVisibleTrack(track)) continue;
    const clips = [...(track.clips || [])]
      .filter((clip) => isRenderableClip(track, clip))
      .sort((a, b) => clipStart(a) - clipStart(b) || String(a.id).localeCompare(String(b.id)));
    for (const clip of clips) {
      const start = clipStart(clip);
      const end = clipEnd(clip);
      const isAudio = track.kind === TIMELINE_KINDS.AUDIO;
      const duckingDb = isAudio ? computeDuckingReductionDb(timeline, track.id, start) : 0;
      const computedGainDb = isAudio ? computeClipGainDb(timeline, clip, start) : 0;
      const color = isAudio ? null : computeClipColorAt(timeline, clip, start);
      plan.push({
        trackId: track.id,
        clipId: clip.id,
        kind: clip.kind || track.kind,
        start,
        end,
        sourceIn: Number.isFinite(Number(clip.in)) ? Number(clip.in) : 0,
        sourceOut: Number.isFinite(Number(clip.out)) ? Number(clip.out) : end - start,
        color,
        audioGainDb: computedGainDb,
        audioDuckingDb: duckingDb,
        audioGainKeyframes: isAudio ? [{ time: start, value: computedGainDb, duckingDb }] : [],
        transitions: transitions
          .filter((transition) => transition && (transition.fromClipId === clip.id || transition.toClipId === clip.id))
          .map((transition) => ({
            id: transition.id,
            kind: transition.kind,
            fromClipId: transition.fromClipId,
            toClipId: transition.toClipId,
            duration: transition.duration,
          })),
      });
    }
  }
  plan.sort((a, b) => a.trackId.localeCompare(b.trackId) || a.start - b.start || a.clipId.localeCompare(b.clipId));
  if (plan.length === 0) throw invalid("render plan requires at least one visible clip");
  plan.metadata = { simulated_media: true, real_encode: false };
  return plan;
}

function colorGradeToPixelParityBridge(color) {
  const c = normalizeColorGrade(color);
  const exposure = clampRange(c.basic.exposure / 5, 0, -1, 1);
  const contrast = clampRange(1 + c.basic.contrast / 100, 1, 0.01, 2);
  const saturation = clampRange(c.basic.saturation / 100, 1, 0, 4);
  const temperature = clampRange(c.basic.temperature / 100, 0, -1, 1);
  const tint = clampRange(c.basic.tint / 100, 0, -1, 1);
  const hueDegrees = clampRange(c.basic.temperature / 2, 0, -30, 30);
  const eq = `eq=brightness=${exposure.toFixed(2)}:contrast=${contrast.toFixed(2)}:saturation=${saturation.toFixed(2)}:gamma=1.00`;
  const colorbalance = `colorbalance=rs=${temperature.toFixed(2)}:gs=${tint.toFixed(2)}:bs=${(-temperature).toFixed(2)}`;
  return {
    css: {
      filter: [
        `brightness(${(1 + exposure / 2).toFixed(3)})`,
        `contrast(${contrast.toFixed(3)})`,
        `saturate(${saturation.toFixed(3)})`,
        `hue-rotate(${hueDegrees.toFixed(2)}deg)`,
        `sepia(${Math.max(0, c.creative.faded / 100).toFixed(3)})`,
      ].join(" "),
      colorBalance: { rs: temperature, gs: tint, bs: -temperature },
    },
    ffmpeg: {
      eq,
      colorbalance,
      approximations: ["eq", "colorbalance"],
    },
  };
}

export function colorGradeToPreviewCss(color) {
  return colorGradeToPixelParityBridge(color).css;
}

export function colorGradeToFfmpegColorFilters(color) {
  return colorGradeToPixelParityBridge(color).ffmpeg;
}

export function buildFfmpegArgs(renderPlan, preset) {
  const plan = Array.isArray(renderPlan) ? renderPlan : renderPlan?.clips || [];
  const metadata = Array.isArray(renderPlan) ? renderPlan.metadata : renderPlan?.metadata || {};
  if (!Array.isArray(plan) || plan.length === 0) throw invalid("render plan requires at least one clip");
  const normalizedPreset = normalizeExportPreset(preset);
  const duration = Math.max(0.001, plan.reduce((max, item) => Math.max(max, Number(item.end || 0) - Number(item.start || 0)), 0));
  const approximations = [];
  const videoFilters = [];
  const audioFilters = [];
  const visualItems = plan.filter((item) => item.color !== null && item.color !== undefined);
  const audioItems = plan.filter((item) => item.kind === TIMELINE_KINDS.AUDIO || Number.isFinite(Number(item.audioGainDb)));
  visualItems.forEach((item, index) => {
    const filters = colorGradeToFfmpegColorFilters(item.color || {});
    const labelIn = index === 0 ? "0:v:0" : `v${index - 1}`;
    const labelOut = `v${index}`;
    videoFilters.push(`[${labelIn}]${filters.eq},${filters.colorbalance}[${labelOut}]`);
    approximations.push(`clip:${item.clipId}:approx:${filters.approximations.join("+")}`);
  });
  if (visualItems.length === 0) {
    videoFilters.push("[0:v:0]format=yuv420p[v0]");
  }
  audioItems.forEach((item, index) => {
    const gain = Number(item.audioGainDb || 0);
    const ducking = Number(item.audioDuckingDb || 0);
    const parts = [`volume=${gain.toFixed(2)}dB`];
    if (ducking !== 0) parts.push(`volume=${ducking.toFixed(2)}dB`);
    const labelIn = index === 0 ? "1:a:0" : `a${index - 1}`;
    const labelOut = `a${index}`;
    audioFilters.push(`[${labelIn}]${parts.join(",")}[${labelOut}]`);
  });
  if (audioItems.length === 0) {
    audioFilters.push("[1:a:0]anull[a0]");
  }
  const filterComplex = [
    ...videoFilters,
    ...audioFilters,
    `[v${Math.max(0, visualItems.length - 1)}]format=yuv420p[vout]`,
    `[a${Math.max(0, audioItems.length - 1)}]anull[aout]`,
  ].join(";");
  const argv = [
    "-y",
    "-f", "lavfi", "-i", `color=c=#111111:s=${normalizedPreset.width}x${normalizedPreset.height}:r=${normalizedPreset.fps}:d=${duration.toFixed(3)}`,
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-map", "[aout]",
    "-s", `${normalizedPreset.width}x${normalizedPreset.height}`,
    "-r", String(normalizedPreset.fps),
    "-b:v", `${normalizedPreset.videoBitrateKbps}k`,
    "-b:a", `${normalizedPreset.audioBitrateKbps}k`,
    "-c:v", "libx264",
    "-c:a", "aac",
    "-movflags", "+faststart",
    "output.mp4",
  ];
  return { argv, filter_complex: filterComplex, approximations, metadata: { simulated_media: metadata.simulated_media !== false, real_encode: Boolean(metadata.real_encode) } };
}

function invalid(message) {
  return new TimelineOpError("timeline_op_invalid", message);
}

function isTimelineOp(op) {
  return Object.values(TIMELINE_OPS).includes(op);
}

function isPublicTimelineOp(op) {
  return PUBLIC_TIMELINE_OPS.includes(op);
}

export { clipsOverlap };
