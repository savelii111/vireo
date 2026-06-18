import assert from "node:assert/strict";
import test from "node:test";
import {
  TIMELINE_KINDS,
  TIMELINE_OPS,
  EXPORT_PRESETS,
  applyOp,
  applyTimelineOp,
  buildFfmpegArgs,
  buildRenderPlan,
  colorGradeToPixelParityBridge,
  colorGradeToPreviewCss,
  colorGradeToFfmpegColorFilters,
  createEmptyTimelineDocument,
  createTimelineOp,
  computeClipColorAt,
  computeClipGainDb,
  computeDuckingReductionDb,
  computeSimulatedColorScopes,
  deserializeTimelineDocument,
  evalParamAtTime,
  normalizeColorGrade,
  normalizeExportPreset,
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

test("audio ops merge gain/pan/fades/ducking, stay reversible, and keep volume keyframes in existing store", () => {
  let doc = createEmptyTimelineDocument({ projectId: "p_1", userId: "u_1" });
  doc.tracks.push({ id: "trk_a2", kind: "audio", name: "Music", muted: false, locked: false, hidden: false, soloed: false, role: "music", audio: { gainDb: 0, pan: 0, fadeIn: 0, fadeOut: 0, crossfade: 0.25, ducking: { enabled: false, amountDb: -12, thresholdDb: -30, attackSec: 0.02, releaseSec: 0.2 }, metadata: { simulated_levels: true, real_decode: false } }, clips: [] });
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.INSERT_CLIP, actor: "human", timelineId: doc.timelineId, trackId: "trk_a1", payload: { id: "voice", assetId: "voice.wav", start: 1, end: 5, source: "upload" } }));
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.INSERT_CLIP, actor: "human", timelineId: doc.timelineId, trackId: "trk_a2", payload: { id: "music", assetId: "music.wav", start: 0, end: 8, source: "upload" } }));
  doc.tracks.find((track) => track.id === "trk_a1").role = "voice";
  doc.tracks.find((track) => track.id === "trk_a2").role = "music";

  const humanTrack = createTimelineOp({ op: TIMELINE_OPS.SET_TRACK_AUDIO, actor: "human", timelineId: doc.timelineId, trackId: "trk_a2", payload: { audio: { gainDb: -3, pan: -0.25 } } });
  doc = applyTimelineOp(doc, humanTrack);
  const humanClip = createTimelineOp({ op: TIMELINE_OPS.SET_CLIP_AUDIO, actor: "human", timelineId: doc.timelineId, trackId: "trk_a2", clipId: "music", payload: { audio: { fadeIn: 1, fadeOut: 2, meters: [{ time: 0, level: -12, peak: -6 }], waveform: [-0.2, 0.4, -0.1] } } });
  doc = applyTimelineOp(doc, humanClip);
  const music = doc.tracks.find((track) => track.id === "trk_a2").clips.find((clip) => clip.id === "music");
  assert.equal(music.audio.gainDb, 0);
  assert.equal(music.audio.fadeIn, 1);
  assert.deepEqual(music.audio.metadata, { simulated_levels: true, real_decode: false });

  const botDuck = createTimelineOp({ op: TIMELINE_OPS.SET_TRACK_AUDIO, actor: "bot", timelineId: doc.timelineId, trackId: "trk_a2", payload: { audio: { ducking: { enabled: true, amountDb: -10, thresholdDb: -30, attackSec: 0.1, releaseSec: 0.4 } } } });
  const botDuckResult = applyTimelineOp(doc, botDuck);
  doc = botDuckResult;
  assert.equal(doc.version, 6);
  assert.equal(doc.tracks.find((track) => track.id === "trk_a2").audio.ducking.enabled, true);
  assert.equal(Math.round(computeDuckingReductionDb(doc, "trk_a2", 2) * 10) / 10, -10);
  assert.equal(Math.round(computeClipGainDb(doc, music, 2) * 10) / 10, -13);
  assert.equal(Math.round(computeDuckingReductionDb(doc, "trk_a2", 2) * 10) / 10, Math.round(computeDuckingReductionDb(doc, "trk_a2", 2) * 10) / 10);

  const key = createTimelineOp({ op: TIMELINE_OPS.SET_KEYFRAME, actor: "human", timelineId: doc.timelineId, trackId: "trk_a2", clipId: "music", payload: { targetId: "audio", param: "gain", keyframe: { time: 0, value: 0 } } });
  const keyResult = applyTimelineOp(doc, key);
  doc = keyResult;
  const key2 = createTimelineOp({ op: TIMELINE_OPS.SET_KEYFRAME, actor: "bot", timelineId: doc.timelineId, trackId: "trk_a2", clipId: "music", payload: { targetId: "audio", param: "gain", keyframe: { time: 4, value: -6 } } });
  const key2Result = applyTimelineOp(doc, key2);
  doc = key2Result;
  const musicWithKeyframes = doc.tracks.find((track) => track.id === "trk_a2").clips.find((clip) => clip.id === "music");
  assert.equal(Math.round(evalParamAtTime(musicWithKeyframes.keyframes.effects.audio.gain, 2) * 10) / 10, -3);

  const restoredClip = applyTimelineOp(doc, key2Result.inverse);
  assert.deepEqual(restoredClip.tracks.find((track) => track.id === "trk_a2").clips.find((clip) => clip.id === "music").keyframes.effects.audio.gain, [{ time: 0, value: 0, interp: "linear" }]);
  const restoredTrack = applyTimelineOp(restoredClip, keyResult.inverse);
  const withoutDuck = applyTimelineOp(restoredTrack, botDuckResult.inverse);
  assert.equal(withoutDuck.tracks.find((track) => track.id === "trk_a2").audio.ducking.enabled, false);
});

test("setTrackAudio role is part of audio sidechain merge and inverse restores previous role", () => {
  let doc = createEmptyTimelineDocument({ projectId: "p_1", userId: "u_1" });
  const roleOp = createTimelineOp({ op: TIMELINE_OPS.SET_TRACK_AUDIO, actor: "bot", timelineId: doc.timelineId, trackId: "trk_a1", payload: { audio: { role: "voice" } } });
  doc = applyTimelineOp(doc, roleOp);
  assert.equal(doc.tracks.find((track) => track.id === "trk_a1").role, "voice");
  const restored = applyTimelineOp(doc, doc.inverse);
  assert.equal(restored.tracks.find((track) => track.id === "trk_a1").role, "other");
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

test("setClipColor merges visual color fields, rejects text/audio, and resolves keyframed exposure", () => {
  let doc = createEmptyTimelineDocument({ projectId: "p_1", userId: "u_1" });
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.INSERT_CLIP, actor: "human", timelineId: doc.timelineId, trackId: "trk_v1", payload: { id: "shot", assetId: "shot.mp4", start: 0, end: 10, kind: "video" } }));

  const human = createTimelineOp({ op: TIMELINE_OPS.SET_CLIP_COLOR, actor: "human", timelineId: doc.timelineId, trackId: "trk_v1", clipId: "shot", payload: { color: { basic: { exposure: 1.5, contrast: 20 } } } });
  doc = applyTimelineOp(doc, human);
  const bot = createTimelineOp({ op: TIMELINE_OPS.SET_CLIP_COLOR, actor: "bot", timelineId: doc.timelineId, trackId: "trk_v1", clipId: "shot", payload: { color: { basic: { saturation: 140 }, creative: { lut: { id: "lut_teal", name: "Teal", intensity: 70 }, faded: 25, sharpen: 12 }, metadata: { simulated_scopes: true, real_pixel_analysis: false, real_lut_apply: false } } } });
  doc = applyTimelineOp(doc, bot);
  const clip = doc.tracks[0].clips.find((item) => item.id === "shot");
  assert.equal(clip.color.basic.exposure, 1.5);
  assert.equal(clip.color.basic.contrast, 20);
  assert.equal(clip.color.basic.saturation, 140);
  assert.equal(clip.color.creative.lut.id, "lut_teal");
  assert.equal(clip.color.creative.lut.intensity, 70);
  assert.deepEqual(clip.color.metadata, { simulated_scopes: true, real_pixel_analysis: false, real_lut_apply: false });

  const key0 = createTimelineOp({ op: TIMELINE_OPS.SET_KEYFRAME, actor: "human", timelineId: doc.timelineId, trackId: "trk_v1", clipId: "shot", payload: { targetId: "color", param: "exposure", keyframe: { time: 0, value: 0 } } });
  const key0Result = applyTimelineOp(doc, key0);
  doc = key0Result;
  const key4 = createTimelineOp({ op: TIMELINE_OPS.SET_KEYFRAME, actor: "bot", timelineId: doc.timelineId, trackId: "trk_v1", clipId: "shot", payload: { targetId: "color", param: "exposure", keyframe: { time: 4, value: 3 } } });
  const key4Result = applyTimelineOp(doc, key4);
  doc = key4Result;
  assert.equal(Math.round(evalParamAtTime(doc.tracks[0].clips[0].keyframes.effects.color.exposure, 2) * 10) / 10, 1.5);
  assert.equal(Math.round(computeClipColorAt(doc, doc.tracks[0].clips[0], 2).basic.exposure * 10) / 10, 1.5);

  const restoredKey4 = applyTimelineOp(doc, key4Result.inverse);
  assert.deepEqual(restoredKey4.tracks[0].clips[0].keyframes.effects.color.exposure, [{ time: 0, value: 0, interp: "linear" }]);
  assert.equal(applyTimelineOp(restoredKey4, key0Result.inverse).tracks[0].clips[0].keyframes.effects.color, undefined);

  const textDoc = createEmptyTimelineDocument({ projectId: "p_1", userId: "u_1" });
  const textResult = applyTimelineOp(textDoc, createTimelineOp({ op: TIMELINE_OPS.ADD_TEXT, timelineId: textDoc.timelineId, trackId: "trk_t1", payload: { id: "title", text: "Title", start: 0, end: 3 } }));
  assert.throws(() => applyTimelineOp(textResult, createTimelineOp({ op: TIMELINE_OPS.SET_CLIP_COLOR, timelineId: textResult.timelineId, trackId: "trk_t1", clipId: "title", payload: { color: { basic: { exposure: 1 } } } })), /visual clips/);

  const audioDoc = createEmptyTimelineDocument({ projectId: "p_1", userId: "u_1" });
  const audioResult = applyTimelineOp(audioDoc, createTimelineOp({ op: TIMELINE_OPS.INSERT_CLIP, timelineId: audioDoc.timelineId, trackId: "trk_a1", payload: { id: "music", assetId: "music.wav", start: 0, end: 5 } }));
  assert.throws(() => applyTimelineOp(audioResult, createTimelineOp({ op: TIMELINE_OPS.SET_CLIP_COLOR, timelineId: audioResult.timelineId, trackId: "trk_a1", clipId: "music", payload: { color: { basic: { exposure: 1 } } } })), /visual clips/);

  const scopes = computeSimulatedColorScopes(doc, doc.tracks[0].clips[0], 2);
  assert.equal(scopes.histogram.length, 7);
  assert.equal(scopes.waveform.length, 7);
  assert.equal(scopes.vectorscope.length, 3);
  assert.deepEqual(scopes.metadata, { simulated_scopes: true, real_pixel_analysis: false, approx_preview: true });
});

test("normalizeColorGrade clamps Lumetri fields and preserves neutral defaults", () => {
  const grade = normalizeColorGrade({
    basic: { exposure: 99, saturation: -5 },
    creative: {
      tintShadows: "#ABC",
      lut: { intensity: 200 },
      faded: -1,
      sharpen: 500,
      tintHighlights: "bad",
    },
    curves: { r: [{ x: 2, y: 2 }, { x: 0, y: 0.5 }] },
    wheels: { highlights: { r: 9, g: -9, b: 0.5 } },
    metadata: { simulated_scopes: true, real_pixel_analysis: false, real_lut_apply: false },
  });
  assert.equal(grade.basic.exposure, 5);
  assert.equal(grade.basic.saturation, 0);
  assert.equal(grade.creative.tintShadows, "#abc");
  assert.equal(grade.creative.lut.intensity, 100);
  assert.equal(grade.creative.tintHighlights, null);
  assert.deepEqual(grade.curves.r, [{ x: 0, y: 0.5 }, { x: 1, y: 1 }]);
  assert.deepEqual(grade.wheels.highlights, { r: 1, g: -1, b: 0.5 });
  assert.deepEqual(normalizeColorGrade({}).metadata, { simulated_scopes: true, real_pixel_analysis: false, real_lut_apply: false });
});

test("A: normalizeExportPreset clamps, defaults, and rejects unknown presets", () => {
  const preset = normalizeExportPreset({ id: "youtube_1080p", width: 17, height: 7690, fps: 999, videoBitrateKbps: 0, audioBitrateKbps: -2 });
  assert.equal(preset.width, 16);
  assert.equal(preset.height, 7680);
  assert.equal(preset.fps, 30);
  assert.equal(preset.videoBitrateKbps, 1);
  assert.equal(preset.audioBitrateKbps, 1);
  assert.equal(normalizeExportPreset({ width: 1281, height: 721, fps: 24 }).id, "youtube_1080p");
  assert.equal(normalizeExportPreset("tiktok_vertical_1080").id, "tiktok_vertical_1080");
  assert.throws(() => normalizeExportPreset({ id: "unknown" }), /unknown export preset/);
});

test("B: buildRenderPlan keeps audio, uses shared color/gain/ducking, transitions, and is deterministic", () => {
  let doc = createEmptyTimelineDocument({ projectId: "p_export", userId: "u_export", fps: 30 });
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.INSERT_CLIP, actor: "human", timelineId: doc.timelineId, trackId: "trk_v1", payload: { id: "shot", assetId: "shot.mp4", start: 0, end: 6, kind: "video", in: 10, out: 16 } }));
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.SET_CLIP_COLOR, actor: "human", timelineId: doc.timelineId, trackId: "trk_v1", clipId: "shot", payload: { color: { basic: { exposure: 1, contrast: 10, saturation: 120, temperature: 20, tint: -10 } } } }));
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.SET_KEYFRAME, actor: "human", timelineId: doc.timelineId, trackId: "trk_v1", clipId: "shot", payload: { targetId: "color", param: "exposure", keyframe: { time: 0, value: 0 } } }));
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.SET_KEYFRAME, actor: "human", timelineId: doc.timelineId, trackId: "trk_v1", clipId: "shot", payload: { targetId: "color", param: "exposure", keyframe: { time: 3, value: 2 } } }));
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.INSERT_CLIP, actor: "human", timelineId: doc.timelineId, trackId: "trk_a1", payload: { id: "music", assetId: "music.wav", start: 0, end: 6, kind: "audio" } }));
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.SET_TRACK_AUDIO, actor: "human", timelineId: doc.timelineId, trackId: "trk_a1", payload: { audio: { gainDb: -3, ducking: { enabled: true, amountDb: -6 } } } }));
  doc.transitions = [{ id: "x1", kind: "crossfade", fromClipId: "shot", toClipId: "music", duration: 0.5 }];

  const plan = buildRenderPlan(doc, "youtube_1080p");
  const visual = plan.find((item) => item.clipId === "shot");
  const audio = plan.find((item) => item.clipId === "music");
  assert.equal(plan.length, 2);
  assert.equal(visual.color.basic.exposure, computeClipColorAt(doc, doc.tracks[0].clips[0], 0).basic.exposure);
  assert.equal(audio.kind, TIMELINE_KINDS.AUDIO);
  assert.equal(audio.audioGainDb, computeClipGainDb(doc, doc.tracks[1].clips[0], 0));
  assert.equal(audio.audioDuckingDb, computeDuckingReductionDb(doc, "trk_a1", 0));
  assert.deepEqual(visual.transitions, [{ id: "x1", kind: "crossfade", fromClipId: "shot", toClipId: "music", duration: 0.5 }]);
  assert.deepEqual(plan, buildRenderPlan(doc, "youtube_1080p"));
  assert.deepEqual(plan.metadata, { simulated_media: true, real_encode: false });
});

test("C: buildFfmpegArgs contains preset encode flags and stable filter_complex snapshot", () => {
  let doc = createEmptyTimelineDocument({ projectId: "p_export", userId: "u_export", fps: 30 });
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.INSERT_CLIP, actor: "human", timelineId: doc.timelineId, trackId: "trk_v1", payload: { id: "shot", assetId: "shot.mp4", start: 0, end: 3, kind: "video" } }));
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.SET_CLIP_COLOR, actor: "human", timelineId: doc.timelineId, trackId: "trk_v1", clipId: "shot", payload: { color: { basic: { exposure: 0, contrast: 0, saturation: 100, temperature: 0, tint: 0 } } } }));
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.INSERT_CLIP, actor: "human", timelineId: doc.timelineId, trackId: "trk_a1", payload: { id: "music", assetId: "music.wav", start: 0, end: 3, kind: "audio" } }));
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.SET_TRACK_AUDIO, actor: "human", timelineId: doc.timelineId, trackId: "trk_a1", payload: { audio: { gainDb: -2 } } }));
  const plan = buildRenderPlan(doc, "web_720p");
  const args = buildFfmpegArgs(plan, "web_720p");
  assert.ok(args.argv.includes("-s"));
  assert.ok(args.argv.includes("1280x720"));
  assert.ok(args.argv.includes("-r"));
  assert.ok(args.argv.includes("30"));
  assert.ok(args.argv.includes("-b:v"));
  assert.ok(args.argv.includes("4000k"));
  assert.ok(args.argv.includes("-b:a"));
  assert.ok(args.argv.includes("128k"));
  assert.ok(args.argv.includes("libx264"));
  assert.ok(args.argv.includes("aac"));
  assert.ok(args.argv.includes("+faststart"));
  assert.match(args.filter_complex, /eq=/);
  assert.match(args.filter_complex, /volume=-2\.00dB/);
  assert.equal(args.filter_complex, "[0:v:0]eq=brightness=0.00:contrast=1.00:saturation=1.00:gamma=1.00,colorbalance=rs=0.00:gs=0.00:bs=0.00[v0];[1:a:0]volume=-2.00dB[a0];[a0]volume=0.00dB[a1];[v0]format=yuv420p[vout];[a1]anull[aout]");
  assert.deepEqual(args.filter_complex, buildFfmpegArgs(plan, { id: "web_720p" }).filter_complex);
});

test("D: pixel parity bridge and empty timeline guard", () => {
  let doc = createEmptyTimelineDocument({ projectId: "p_export", userId: "u_export", fps: 30 });
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.INSERT_CLIP, actor: "human", timelineId: doc.timelineId, trackId: "trk_v1", payload: { id: "shot", assetId: "shot.mp4", start: 0, end: 2, kind: "video" } }));
  doc = applyTimelineOp(doc, createTimelineOp({ op: TIMELINE_OPS.SET_CLIP_COLOR, actor: "human", timelineId: doc.timelineId, trackId: "trk_v1", clipId: "shot", payload: { color: { basic: { exposure: 1, contrast: 20, saturation: 120, temperature: 20, tint: -10 } } } }));
  const color = computeClipColorAt(doc, doc.tracks[0].clips[0], 0);
  const bridge = colorGradeToPixelParityBridge(color);
  const plan = buildRenderPlan(doc, "youtube_1080p");
  const args = buildFfmpegArgs(plan, "youtube_1080p");
  const ffmpeg = colorGradeToFfmpegColorFilters(color);
  const preview = colorGradeToPreviewCss(color);
  assert.deepEqual(ffmpeg, bridge.ffmpeg);
  assert.deepEqual(preview, bridge.css);
  assert.match(args.filter_complex, new RegExp(ffmpeg.eq.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(args.filter_complex, new RegExp(ffmpeg.colorbalance.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const eqSaturation = ffmpeg.eq.match(/saturation=([0-9.]+)/)?.[1];
  const cssSaturation = preview.filter.match(/saturate\(([0-9.]+)\)/)?.[1];
  assert.equal(eqSaturation, "1.20");
  assert.equal(cssSaturation, "1.200");
  assert.throws(() => buildRenderPlan(createEmptyTimelineDocument({ projectId: "p_empty", userId: "u_empty", fps: 30 }), "youtube_1080p"), /at least one visible clip/);
});
