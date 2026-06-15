import assert from "node:assert/strict";
import test from "node:test";
import {
  TIMELINE_OPS,
  applyOp,
  applyTimelineOp,
  createEmptyTimelineDocument,
  createTimelineOp,
  deserializeTimelineDocument,
  serializeTimelineDocument,
  snapTime,
} from "../packages/shared/index.js";

test("shared timeline contract creates a valid empty timeline", () => {
  const doc = createEmptyTimelineDocument({ projectId: "p_1", userId: "u_1", fps: 30 });
  assert.equal(doc.projectId, "p_1");
  assert.equal(doc.userId, "u_1");
  assert.equal(doc.version, 1);
  assert.equal(doc.tracks.length, 3);
  assert.deepEqual(doc.resolution, { w: 1080, h: 1920 });
});

test("shared timeline op applies insert and trim over one contract", () => {
  let doc = createEmptyTimelineDocument({ projectId: "p_1", userId: "u_1" });
  const insert = createTimelineOp({
    op: TIMELINE_OPS.INSERT_CLIP,
    actor: "human",
    timelineId: doc.timelineId,
    trackId: "trk_v1",
    payload: {
      assetId: "ast_1",
      start: 0,
      end: 5,
      source: "upload",
    },
  });
  doc = applyTimelineOp(doc, insert);
  assert.equal(doc.version, 2);
  assert.equal(doc.tracks[0].clips.length, 1);
  assert.equal(doc.tracks[0].clips[0].assetId, "ast_1");

  const trim = createTimelineOp({
    op: TIMELINE_OPS.TRIM_CLIP,
    actor: "bot",
    timelineId: doc.timelineId,
    trackId: "trk_v1",
    clipId: doc.tracks[0].clips[0].id,
    payload: { start: 1, end: 4 },
  });
  doc = applyTimelineOp(doc, trim);
  assert.equal(doc.version, 3);
  assert.equal(doc.tracks[0].clips[0].start, 1);
  assert.equal(doc.tracks[0].clips[0].end, 4);
});

test("shared timeline serializes and deserializes without losing contract shape", () => {
  const doc = createEmptyTimelineDocument({ projectId: "p_1", userId: "u_1" });
  const serialized = serializeTimelineDocument(doc);
  const restored = deserializeTimelineDocument(serialized);
  assert.equal(restored.timelineId, doc.timelineId);
  assert.deepEqual(restored.resolution, doc.resolution);
  assert.equal(restored.tracks.length, doc.tracks.length);
});

test("shared timeline transition/effect/text ops apply and inverse back out", () => {
  let doc = createEmptyTimelineDocument({ projectId: "p_1", userId: "u_1" });

  const clipA = createTimelineOp({
    op: TIMELINE_OPS.INSERT_CLIP,
    actor: "human",
    timelineId: doc.timelineId,
    trackId: "trk_v1",
    payload: { id: "clp_a", assetId: "a.mp4", start: 0, end: 5, source: "upload" },
  });
  const clipB = createTimelineOp({
    op: TIMELINE_OPS.INSERT_CLIP,
    actor: "human",
    timelineId: doc.timelineId,
    trackId: "trk_v1",
    payload: { id: "clp_b", assetId: "b.mp4", start: 5, end: 10, source: "upload" },
  });
  doc = applyTimelineOp(doc, clipA);
  doc = applyTimelineOp(doc, clipB);

  const addTransition = createTimelineOp({
    op: TIMELINE_OPS.ADD_TRANSITION,
    actor: "human",
    timelineId: doc.timelineId,
    trackId: "trk_v1",
    clipId: "clp_a",
    payload: {
      clipId: "clp_a",
      trackId: "trk_v1",
      fromClipId: "clp_a",
      toClipId: "clp_b",
      kind: "crossfade",
      duration: 0.75,
    },
  });
  const transitionResult = applyOp(doc, addTransition);
  const withTransition = transitionResult.doc;
  assert.equal(withTransition.transitions.length, 1);
  assert.equal(withTransition.transitions[0].id.startsWith("tr_"), true);
  assert.deepEqual(withTransition.transitions[0], {
    ...withTransition.transitions[0],
    clipId: "clp_a",
    trackId: "trk_v1",
    fromClipId: "clp_a",
    toClipId: "clp_b",
    kind: "crossfade",
    duration: 0.75,
    metadata: {},
  });
  const withoutTransition = applyTimelineOp(withTransition, transitionResult.inverse);
  assert.equal(withoutTransition.transitions.length, 0);

  const addEffect = createTimelineOp({
    op: TIMELINE_OPS.ADD_EFFECT,
    actor: "human",
    timelineId: withoutTransition.timelineId,
    trackId: "trk_v1",
    clipId: "clp_a",
    payload: {
      effect: {
        id: "fx_color",
        type: "colorGrade",
        name: "Cinematic",
        params: { contrast: 1.2 },
      },
    },
  });
  const effectResult = applyOp(withoutTransition, addEffect);
  const withEffect = effectResult.doc;
  assert.equal(withEffect.tracks[0].clips[0].effects.length, 1);
  assert.deepEqual(withEffect.tracks[0].clips[0].effects[0], {
    id: "fx_color",
    type: "colorGrade",
    name: "Cinematic",
    params: { contrast: 1.2 },
  });
  const withoutEffect = applyTimelineOp(withEffect, effectResult.inverse);
  assert.equal(withoutEffect.tracks[0].clips[0].effects.length, 0);

  const addText = createTimelineOp({
    op: TIMELINE_OPS.ADD_TEXT,
    actor: "human",
    timelineId: withoutEffect.timelineId,
    trackId: "trk_t1",
    payload: {
      id: "txt_hello",
      text: "Hello",
      start: 2,
      end: 5,
      in: 0,
      out: 3,
      transform: { x: 120, y: 80 },
    },
  });
  const textResult = applyOp(withoutEffect, addText);
  const withText = textResult.doc;
  const textTrack = withText.tracks.find((track) => track.id === "trk_t1");
  assert.ok(textTrack);
  assert.equal(textTrack.clips.length, 1);
  assert.equal(textTrack.clips[0].text, "Hello");
  assert.deepEqual(textTrack.clips[0].transform, { x: 120, y: 80 });
  const withoutText = applyTimelineOp(withText, textResult.inverse);
  assert.equal(withoutText.tracks.find((track) => track.id === "trk_t1").clips.length, 0);

  const restoreEffect = applyTimelineOp(withoutText, addEffect);
  const setEffect = createTimelineOp({
    op: TIMELINE_OPS.SET_EFFECT,
    actor: "human",
    timelineId: restoreEffect.timelineId,
    trackId: "trk_v1",
    clipId: "clp_a",
    payload: {
      effectId: "fx_color",
      effect: {
        id: "fx_color",
        type: "blur",
        name: "Soft blur",
        params: { radius: 8 },
      },
    },
  });
  const withSetEffect = applyTimelineOp(restoreEffect, setEffect);
  assert.equal(withSetEffect.tracks[0].clips[0].effects[0].type, "blur");
  const restoredEffect = applyTimelineOp(withSetEffect, withSetEffect.inverse);
  assert.equal(restoredEffect.tracks[0].clips[0].effects[0].type, "colorGrade");
});

test("snapTime snaps to anchors only inside pixel threshold", () => {
  assert.equal(snapTime(2.02, [2], 2, 100), 2);
  assert.equal(snapTime(2.02, [2], 0.5, 50), 2.02);
});

test("moveClip rejects locked tracks and clamps against same-track neighbors", () => {
  let doc = createEmptyTimelineDocument({ projectId: "p_1", userId: "u_1" });
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.INSERT_CLIP, timelineId: doc.timelineId, trackId: "trk_v1", payload: { id: "a", assetId: "a.mp4", start: 0, end: 2 } }));
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.INSERT_CLIP, timelineId: doc.timelineId, trackId: "trk_v1", payload: { id: "b", assetId: "b.mp4", start: 7, end: 10 } }));

  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.MOVE_CLIP, timelineId: doc.timelineId, trackId: "trk_v1", clipId: "a", payload: { targetTrackId: "trk_v1", start: 6.5 } }));
  assert.equal(doc.tracks.find((track) => track.id === "trk_v1").clips.find((clip) => clip.id === "a").start, 5);

  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.SET_TRACK_FLAG, timelineId: doc.timelineId, trackId: "trk_v1", payload: { locked: true } }));
  assert.throws(() => applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.MOVE_CLIP, timelineId: doc.timelineId, trackId: "trk_v1", clipId: "b", payload: { targetTrackId: "trk_v1", start: 1 } })), /Track is locked/);

  let crossTrack = createEmptyTimelineDocument({ projectId: "p_2", userId: "u_1" });
  crossTrack.tracks.push({ id: "trk_o1", kind: "overlay", name: "Overlay", muted: false, soloed: false, locked: false, hidden: false, clips: [] });
  crossTrack = applyTimelineOp(crossTrack, createTimelineOp({ op: TIMELINE_OPS.INSERT_CLIP, timelineId: crossTrack.timelineId, trackId: "trk_v1", payload: { id: "a", assetId: "a.mp4", start: 0, end: 5 } }));
  crossTrack = applyTimelineOp(crossTrack, createTimelineOp({ op: TIMELINE_OPS.INSERT_CLIP, timelineId: crossTrack.timelineId, trackId: "trk_o1", payload: { id: "o", assetId: "o.png", start: 2, end: 4 } }));
  crossTrack = applyTimelineOp(crossTrack, createTimelineOp({ op: TIMELINE_OPS.MOVE_CLIP, timelineId: crossTrack.timelineId, trackId: "trk_v1", clipId: "a", payload: { targetTrackId: "trk_o1", start: 2 } }));
  assert.equal(crossTrack.tracks.find((track) => track.id === "trk_o1").clips.length, 2);
  assert.equal(crossTrack.tracks.find((track) => track.id === "trk_o1").clips.find((clip) => clip.id === "a").start, 4);
});

test("trimClip clamps against neighbor boundaries and rejects locked tracks", () => {
  let doc = createEmptyTimelineDocument({ projectId: "p_1", userId: "u_1" });
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.INSERT_CLIP, timelineId: doc.timelineId, trackId: "trk_v1", payload: { id: "a", assetId: "a.mp4", start: 0, end: 5 } }));
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.INSERT_CLIP, timelineId: doc.timelineId, trackId: "trk_v1", payload: { id: "b", assetId: "b.mp4", start: 5, end: 10 } }));

  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.TRIM_CLIP, timelineId: doc.timelineId, trackId: "trk_v1", clipId: "a", payload: { start: 0, end: 8, originalStart: 0, originalEnd: 5 } }));
  assert.equal(doc.tracks.find((track) => track.id === "trk_v1").clips.find((clip) => clip.id === "a").end, 5);

  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.TRIM_CLIP, timelineId: doc.timelineId, trackId: "trk_v1", clipId: "b", payload: { start: 3, end: 10, originalStart: 5, originalEnd: 10 } }));
  assert.equal(doc.tracks.find((track) => track.id === "trk_v1").clips.find((clip) => clip.id === "b").start, 5);

  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.SET_TRACK_FLAG, timelineId: doc.timelineId, trackId: "trk_v1", payload: { locked: true } }));
  assert.throws(() => applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.TRIM_CLIP, timelineId: doc.timelineId, trackId: "trk_v1", clipId: "a", payload: { start: 1, end: 5, originalStart: 0, originalEnd: 5 } })), /Track is locked/);
});

test("setTrackFlag supports soloed through shared track state", () => {
  const doc = createEmptyTimelineDocument({ projectId: "p_1", userId: "u_1" });
  const next = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.SET_TRACK_FLAG, timelineId: doc.timelineId, trackId: "trk_v1", payload: { soloed: true } }));
  assert.equal(next.tracks.find((track) => track.id === "trk_v1").soloed, true);
  const restored = applyTimelineOp(next, next.inverse);
  assert.equal(restored.tracks.find((track) => track.id === "trk_v1").soloed, false);
});
