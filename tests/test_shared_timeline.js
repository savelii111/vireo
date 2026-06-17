import assert from "node:assert/strict";
import test from "node:test";
import {
  TIMELINE_OPS,
  applyOp,
  applyTimelineOp,
  createEmptyTimelineDocument,
  createTimelineOp,
  deserializeTimelineDocument,
  evalParamAtTime,
  normalizeTitleProps,
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


test("setTitleProps edits only title style fields and is reversible", () => {
  let doc = createEmptyTimelineDocument({ projectId: "p_1", userId: "u_1" });
  const addText = createTimelineOp({
    op: TIMELINE_OPS.ADD_TEXT,
    actor: "human",
    timelineId: doc.timelineId,
    trackId: "trk_t1",
    payload: {
      id: "title_one",
      text: "Hello",
      start: 0,
      end: 3,
      in: 0,
      out: 3,
      transform: { x: 120, y: 80 },
      titleProps: { fontFamily: "Inter", fontSize: 44, color: "#ffffff", align: "center" },
    },
  });
  doc = applyTimelineOp(doc, addText);
  const title = doc.tracks.find((track) => track.id === "trk_t1").clips.find((clip) => clip.id === "title_one");
  assert.deepEqual(title.titleProps, { fontFamily: "Inter", fontSize: 44, color: "#ffffff", align: "center", text: "Hello", backgroundColor: "", strokeColor: "", strokeWidth: 0 });
  assert.deepEqual(title.transform, { x: 120, y: 80 });

  const setProps = createTimelineOp({
    op: TIMELINE_OPS.SET_TITLE_PROPS,
    actor: "human",
    timelineId: doc.timelineId,
    trackId: "trk_t1",
    clipId: "title_one",
    payload: { titleProps: { color: "#123456", fontSize: 56 } },
  });
  doc = applyTimelineOp(doc, setProps);
  const styled = doc.tracks.find((track) => track.id === "trk_t1").clips.find((clip) => clip.id === "title_one");
  assert.deepEqual(styled.titleProps, {
    text: "Hello",
    fontFamily: "Inter",
    fontSize: 56,
    color: "#123456",
    align: "center",
    backgroundColor: "",
    strokeColor: "",
    strokeWidth: 0,
  });
  assert.deepEqual(styled.transform, { x: 120, y: 80 });
  assert.equal(styled.text, "Hello");

  const restored = applyTimelineOp(doc, doc.inverse);
  const restoredTitle = restored.tracks.find((track) => track.id === "trk_t1").clips.find((clip) => clip.id === "title_one");
  assert.deepEqual(restoredTitle.titleProps, { fontFamily: "Inter", fontSize: 44, color: "#ffffff", align: "center", text: "Hello", backgroundColor: "", strokeColor: "", strokeWidth: 0 });
  assert.deepEqual(restoredTitle.transform, { x: 120, y: 80 });
});

test("setTitleProps rejects non-text clips and normalizes title props", () => {
  let doc = createEmptyTimelineDocument({ projectId: "p_1", userId: "u_1" });
  const insert = createTimelineOp({
    op: TIMELINE_OPS.INSERT_CLIP,
    actor: "human",
    timelineId: doc.timelineId,
    trackId: "trk_v1",
    payload: { id: "video_one", assetId: "hero.mp4", start: 0, end: 5, source: "upload" },
  });
  doc = applyTimelineOp(doc, insert);
  assert.throws(() => applyTimelineOp(doc, createTimelineOp({
    op: TIMELINE_OPS.SET_TITLE_PROPS,
    actor: "human",
    timelineId: doc.timelineId,
    trackId: "trk_v1",
    clipId: "video_one",
    payload: { titleProps: { color: "#123456" } },
  })), { code: "timeline_op_invalid" });

  assert.deepEqual(normalizeTitleProps(undefined), {
    text: "",
    fontFamily: "Inter",
    fontSize: 44,
    color: "#ffffff",
    align: "center",
    backgroundColor: "",
    strokeColor: "",
    strokeWidth: 0,
  });
  assert.deepEqual(normalizeTitleProps({
    text: "Title",
    fontFamily: "Arial",
    fontSize: 999,
    color: "not-a-color",
    backgroundColor: "#abc",
    strokeColor: "#112233",
    strokeWidth: -5,
    align: "middle",
    unknown: "ignored",
  }), {
    text: "Title",
    fontFamily: "Arial",
    fontSize: 240,
    color: "#ffffff",
    align: "center",
    backgroundColor: "#abc",
    strokeColor: "#112233",
    strokeWidth: 0,
  });
});

test("normalizeTitleProps preserves valid compact colors and zero numeric fields", () => {
  assert.deepEqual(normalizeTitleProps({
    fontSize: 0,
    strokeWidth: 0,
    color: "#abc",
    backgroundColor: "",
    strokeColor: "",
    unknown: "ignored",
  }), {
    text: "",
    fontFamily: "Inter",
    fontSize: 8,
    color: "#abc",
    align: "center",
    backgroundColor: "",
    strokeColor: "",
    strokeWidth: 0,
  });
});

test("snapTime snaps to anchors only inside pixel threshold", () => {
  assert.equal(snapTime(2.02, [2], 2, 100), 2);
  assert.equal(snapTime(2.02, [2], 0.5, 50), 2.02);
});

test("evalParamAtTime interpolates, holds, clamps, sorts and handles empty/one-keyframe input", () => {
  assert.equal(evalParamAtTime([], 3), 0);
  assert.equal(evalParamAtTime([{ time: 2, value: 40 }], 0), 40);
  assert.equal(evalParamAtTime([{ time: 2, value: 40 }], 2), 40);
  assert.equal(evalParamAtTime([{ time: 2, value: 40 }], 9), 40);
  assert.equal(evalParamAtTime([{ time: 4, value: 40 }, { time: 0, value: 0 }], 2), 20);
  assert.equal(evalParamAtTime([{ time: 0, value: 0 }, { time: 4, value: 40 }], -1), 0);
  assert.equal(evalParamAtTime([{ time: 0, value: 0 }, { time: 4, value: 40 }], 5), 40);
  assert.equal(evalParamAtTime([{ time: 0, value: 0, interp: "hold" }, { time: 4, value: 40 }], 2), 0);
  assert.equal(evalParamAtTime([{ time: 0, value: 0 }, { time: 4, value: 40, interp: "hold" }], 2), 0);
  assert.equal(evalParamAtTime([{ time: 0, value: 0 }, { time: 4, value: 40 }], 3), 30);
  assert.equal(evalParamAtTime([{ time: 0, value: 0 }, { time: 4, value: 40 }], 1, 10), 10);
});

test("keyframe ops are reversible and preserve effect keyframes", () => {
  let doc = createEmptyTimelineDocument({ projectId: "p_1", userId: "u_1" });
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.INSERT_CLIP, timelineId: doc.timelineId, trackId: "trk_v1", payload: { id: "a", assetId: "a.mp4", start: 0, end: 5 } }));
  const addEffect = createTimelineOp({ op: TIMELINE_OPS.ADD_EFFECT, timelineId: doc.timelineId, trackId: "trk_v1", clipId: "a", payload: { effect: { id: "fx_blur", type: "gaussian-blur", name: "Gaussian blur", params: { radius: 0 } } } });
  doc = applyTimelineOp(doc, addEffect);

  const docAfterHuman = doc;
  const humanKey = createTimelineOp({ op: TIMELINE_OPS.SET_KEYFRAME, actor: "human", timelineId: doc.timelineId, trackId: "trk_v1", clipId: "a", payload: { targetId: "transform", param: "opacity", keyframe: { time: 0, value: 0.2 } } });
  doc = applyTimelineOp(doc, humanKey);
  const botKey = createTimelineOp({ op: TIMELINE_OPS.SET_KEYFRAME, actor: "bot", timelineId: doc.timelineId, trackId: "trk_v1", clipId: "a", payload: { targetId: "transform", param: "opacity", keyframe: { time: 4, value: 1 } } });
  doc = applyTimelineOp(doc, botKey);
  const clip = doc.tracks.find((track) => track.id === "trk_v1").clips.find((item) => item.id === "a");
  assert.ok(Math.abs(evalParamAtTime(clip.keyframes.transform.opacity, 2) - 0.6) < 1e-9);
  assert.equal(evalParamAtTime(clip.keyframes.transform.opacity, 5), 1);
  assert.equal(clip.transform.opacity, 1);

  const docAfterBot = doc;
  const effectKey = createTimelineOp({ op: TIMELINE_OPS.SET_KEYFRAME, actor: "human", timelineId: doc.timelineId, trackId: "trk_v1", clipId: "a", payload: { targetId: "fx_blur", param: "radius", keyframe: { time: 1, value: 5 } } });
  doc = applyTimelineOp(doc, effectKey);
  assert.equal(evalParamAtTime(doc.tracks[0].clips[0].keyframes.effects.fx_blur.radius, 2), 5);

  const withoutEffectKey = applyTimelineOp(doc, doc.inverse);
  assert.equal(withoutEffectKey.tracks[0].clips[0].keyframes.effects.fx_blur, undefined);
  const withoutHumanKey = applyTimelineOp(docAfterHuman, docAfterHuman.inverse);
  assert.equal(withoutHumanKey.tracks[0].clips[0].keyframes?.transform?.opacity, undefined);
  const withoutBotKey = applyTimelineOp(docAfterBot, docAfterBot.inverse);
  assert.ok(Math.abs(evalParamAtTime(withoutBotKey.tracks[0].clips[0].keyframes.transform.opacity, 2) - 0.2) < 1e-9);
});

test("removeKeyframe is reversible and restores previous keyframes", () => {
  let doc = createEmptyTimelineDocument({ projectId: "p_1", userId: "u_1" });
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.INSERT_CLIP, timelineId: doc.timelineId, trackId: "trk_v1", payload: { id: "a", assetId: "a.mp4", start: 0, end: 5 } }));
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.SET_KEYFRAME, timelineId: doc.timelineId, trackId: "trk_v1", clipId: "a", payload: { targetId: "transform", param: "x", keyframe: { time: 0, value: 0 } } }));
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.SET_KEYFRAME, timelineId: doc.timelineId, trackId: "trk_v1", clipId: "a", payload: { targetId: "transform", param: "x", keyframe: { time: 5, value: 100 } } }));
  const remove = createTimelineOp({ op: TIMELINE_OPS.REMOVE_KEYFRAME, timelineId: doc.timelineId, trackId: "trk_v1", clipId: "a", payload: { targetId: "transform", param: "x", time: 0 } });
  doc = applyTimelineOp(doc, remove);
  assert.equal(evalParamAtTime(doc.tracks[0].clips[0].keyframes.transform.x, 2), 100);
  const restored = applyTimelineOp(doc, doc.inverse);
  assert.equal(evalParamAtTime(restored.tracks[0].clips[0].keyframes.transform.x, 2), 40);
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
