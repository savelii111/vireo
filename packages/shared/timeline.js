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
  REPLACE_ASSET: "replaceAsset",
  SET_TRACK_FLAG: "setTrackFlag",
  // Internal inverse-only ops accepted by applyOp for undo/redo journal replay.
  REMOVE_TRANSITION: "removeTransition",
  REMOVE_EFFECT: "removeEffect",
  REMOVE_TEXT: "removeText",
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
  TIMELINE_OPS.REPLACE_ASSET,
  TIMELINE_OPS.SET_TRACK_FLAG,
]);

export const DEFAULT_RESOLUTION = Object.freeze({ w: 1080, h: 1920 });

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
    clips: Array.isArray(track.clips) ? track.clips.map(normalizeClip) : [],
  };
}

export function normalizeClip(clip) {
  if (!clip || typeof clip !== "object") throw new Error("Clip must be an object");
  const start = Number(clip.start ?? clip.start_sec ?? 0);
  const end = Number(clip.end ?? (clip.start_sec ?? 0) + (clip.duration_sec ?? clip.duration ?? 0));
  const inPoint = Number(clip.in ?? clip.in_sec ?? clip.inPoint ?? 0);
  const outPoint = Number(clip.out ?? clip.out_sec ?? clip.outPoint ?? end - start);

  return {
    id: String(clip.id || newId("clp")),
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
  };
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
    createdAt: op.createdAt || "",
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

function insertClip(timeline, op) {
  const track = findTrack(timeline, op.trackId);
  const rawClip = op.payload.clip || buildClipFromPayload(op.payload);
  const clip = normalizeClip(rawClip);
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
  if (Number.isFinite(originalStart) && Number.isFinite(originalEnd) && originalEnd > originalStart) {
    clip.start = originalStart;
    clip.end = originalEnd;
  } else {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw invalid(`Invalid trim range for clip ${clip.id}`);
    if (start < clip.start || end > clip.end) throw invalid(`Trim time outside clip ${clip.id}`);
    clip.start = start;
    clip.end = end;
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

  const oldTrackId = track.id;
  const oldStart = clip.start;
  track.clips.splice(index, 1);
  const moved = { ...clip, start, end: start + duration };
  const targetIndex = Number.isFinite(numberOr(op.payload.index ?? op.payload.targetIndex ?? op.payload.target_index, NaN))
    ? numberOr(op.payload.index ?? op.payload.targetIndex ?? op.payload.target_index, targetTrack.clips.length)
    : targetTrack.clips.length;
  targetTrack.clips.splice(targetIndex, 0, moved);

  return {
    ...op,
    trackId: oldTrackId,
    payload: { start: oldStart, index, targetTrackId: targetTrack.id === oldTrackId ? oldTrackId : targetTrack.id },
  };
}

function deleteClip(timeline, op) {
  const { track, clip, index } = resolveClip(timeline, op.trackId, op.clipId || op.payload.clip?.id);
  const removed = clone(clip);
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
    source: "text",
    name: op.payload.text || "Text clip",
    text: op.payload.text || "",
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
  for (const flag of ["muted", "locked", "hidden"]) {
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
  return {
    id: payload.id || payload.clipId || newId("clp"),
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
  };
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

function invalid(message) {
  return new TimelineOpError("timeline_op_invalid", message);
}

function isTimelineOp(op) {
  return Object.values(TIMELINE_OPS).includes(op);
}

function isPublicTimelineOp(op) {
  return PUBLIC_TIMELINE_OPS.includes(op);
}
