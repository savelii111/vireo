// test_embed.js — 15 tests for the Vireo Studio embeddable widget.
//
// Runs in Node.js (node:test).  Because there is no real DOM we mock
// just enough of window / document / HTMLElement to exercise the logic.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// =====================================================================
// Minimal DOM mock
// =====================================================================

class MockElement {
  constructor(tag) {
    this.tagName = tag;            // real DOM returns lowercase
    this.style = {};
    this.childNodes = [];
    this.parentNode = null;
    this._src = "";
    // iframe elements get a contentWindow mock
    this.contentWindow = tag === "iframe"
      ? { postMessage: () => {} }
      : undefined;
  }
  setAttribute(k, v) {
    this["attr_" + k] = v;
    if (k === "src") this._src = v;
  }
  getAttribute(k) {
    return this["attr_" + k];
  }
  appendChild(child) {
    this.childNodes.push(child);
    child.parentNode = this;
  }
  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) this.childNodes.splice(idx, 1);
    child.parentNode = null;
  }
}

class MockHTMLElement extends MockElement {
  constructor() {
    super("div");
  }
}

const mockMatchMedia = (matches) => () => ({
  matches,
  addEventListener: () => {},
  removeEventListener: () => {},
});

function setupMocks() {
  globalThis.window = {
    matchMedia: mockMatchMedia(false),
    addEventListener: (type, handler) => {
      if (type === "message") {
        globalThis._messageHandler = handler;
      }
    },
    removeEventListener: () => {},
  };

  globalThis.document = {
    createElement: (tag) => new MockElement(tag),
    querySelector: (sel) => new MockHTMLElement(),
  };

  globalThis.HTMLElement = MockHTMLElement;
}

function teardownMocks() {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.HTMLElement;
  delete globalThis._messageHandler;
}

// =====================================================================
// Dynamic import (fresh per test to pick up fresh globals)
// =====================================================================

let createVireoEmbed;

beforeEach(async () => {
  setupMocks();
  const mod = await import(`../src/embed.js?t=${Date.now()}`);
  createVireoEmbed = mod.createVireoEmbed;
});

afterEach(() => {
  teardownMocks();
});

// =====================================================================
// Helpers
// =====================================================================

function makeContainer() {
  return new MockHTMLElement();
}

// =====================================================================
// Tests
// =====================================================================

// 1. createVireoEmbed creates an iframe inside the container
test("createVireoEmbed creates iframe inside container", () => {
  const container = makeContainer();
  const handle = createVireoEmbed(container, { videoId: "v99" });

  assert.equal(container.childNodes.length, 1);
  const iframe = container.childNodes[0];
  assert.equal(iframe.tagName, "iframe");
  assert.ok(iframe._src.includes("videoId=v99"));
  handle.destroy();
});

// 2. destroy removes the iframe from the container
test("destroy removes the iframe from the container", () => {
  const container = makeContainer();
  const handle = createVireoEmbed(container, { videoId: "v1" });

  assert.equal(container.childNodes.length, 1);
  handle.destroy();
  assert.equal(container.childNodes.length, 0);
});

// 3. theme option is passed correctly in iframe src
test("theme option is encoded in iframe src URL", () => {
  const container = makeContainer();
  const handle = createVireoEmbed(container, { videoId: "v1", theme: "dark" });
  const iframe = container.childNodes[0];
  assert.ok(iframe._src.includes("theme=dark"));
  assert.equal(handle.themeName, "dark");
  handle.destroy();
});

// 4. autoplay option is encoded in iframe src URL
test("autoplay option is encoded in iframe src URL", () => {
  const container = makeContainer();
  const handle = createVireoEmbed(container, { videoId: "v1", autoplay: true });
  const iframe = container.childNodes[0];
  assert.ok(iframe._src.includes("autoplay=1"));
  handle.destroy();
});

// 5. controls option — when false, encoded as controls=0
test("controls=false encoded as controls=0 in URL", () => {
  const container = makeContainer();
  const handle = createVireoEmbed(container, { videoId: "v1", controls: false });
  const iframe = container.childNodes[0];
  assert.ok(iframe._src.includes("controls=0"));
  handle.destroy();
});

// 6. watermark option is encoded in iframe src URL
test("watermark option is encoded in iframe src URL", () => {
  const container = makeContainer();
  const handle = createVireoEmbed(container, { videoId: "v1", watermark: true });
  const iframe = container.childNodes[0];
  assert.ok(iframe._src.includes("watermark=1"));
  handle.destroy();
});

// 7. PostMessage API — send posts to iframe
test("send() posts a message to the iframe", () => {
  const container = makeContainer();
  const handle = createVireoEmbed(container, { videoId: "v1" });

  // Replace contentWindow with a spy
  let sent = [];
  const iframe = container.childNodes[0];
  iframe.contentWindow = { postMessage: (msg) => sent.push(msg) };

  handle.send("play", { time: 10 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].command, "play");
  assert.equal(sent[0].payload.time, 10);
  handle.destroy();
});

// 8. ready event fires via emit
test("ready event fires via on/emit", () => {
  const container = makeContainer();
  const handle = createVireoEmbed(container, { videoId: "v1" });

  let fired = false;
  handle.on("ready", () => { fired = true; });
  handle.emit("ready", {});

  assert.equal(fired, true);
  handle.destroy();
});

// 9. play event fires via event bus
test("play event fires via on/off", () => {
  const handle = createVireoEmbed(makeContainer(), { videoId: "v1" });
  let received = null;
  handle.on("play", (d) => { received = d; });
  handle.emit("play", { time: 5 });
  assert.deepEqual(received, { time: 5 });
  handle.destroy();
});

// 10. pause event fires via event bus
test("pause event fires via on/off", () => {
  const handle = createVireoEmbed(makeContainer(), { videoId: "v1" });
  let fired = false;
  handle.on("pause", () => { fired = true; });
  handle.emit("pause", {});
  assert.equal(fired, true);
  handle.destroy();
});

// 11. seek event fires via event bus
test("seek event fires via on/off", () => {
  const handle = createVireoEmbed(makeContainer(), { videoId: "v1" });
  let data = null;
  handle.on("seek", (d) => { data = d; });
  handle.emit("seek", { position: 30 });
  assert.equal(data.position, 30);
  handle.destroy();
});

// 12. export event fires via event bus
test("export event fires via on/off", () => {
  const handle = createVireoEmbed(makeContainer(), { videoId: "v1" });
  let fired = false;
  handle.on("export", () => { fired = true; });
  handle.emit("export", { format: "mp4" });
  assert.equal(fired, true);
  handle.destroy();
});

// 13. iframe fills the container (responsive style checks)
test("iframe fills container with 100% width and height", () => {
  const container = makeContainer();
  const handle = createVireoEmbed(container, { videoId: "v1" });
  const iframe = container.childNodes[0];
  assert.equal(iframe.style.width, "100%");
  assert.equal(iframe.style.height, "100%");
  assert.equal(iframe.style.border, "none");
  handle.destroy();
});

// 14. invalid container throws
test("invalid container throws TypeError", () => {
  assert.throws(
    () => createVireoEmbed(null, { videoId: "v1" }),
    (err) => err instanceof TypeError,
  );
});

// 15. multiple embeds are independent
test("multiple embeds create independent iframes and event buses", () => {
  const c1 = makeContainer();
  const c2 = makeContainer();
  const h1 = createVireoEmbed(c1, { videoId: "v1", theme: "dark" });
  const h2 = createVireoEmbed(c2, { videoId: "v2", theme: "light" });

  assert.equal(c1.childNodes.length, 1);
  assert.equal(c2.childNodes.length, 1);
  assert.notEqual(c1.childNodes[0], c2.childNodes[0]);
  assert.equal(h1.themeName, "dark");
  assert.equal(h2.themeName, "light");

  // Events are independent
  let v1Fired = false, v2Fired = false;
  h1.on("play", () => { v1Fired = true; });
  h2.on("play", () => { v2Fired = true; });

  h1.emit("play", {});
  assert.equal(v1Fired, true);
  assert.equal(v2Fired, false);

  h1.destroy();
  h2.destroy();
});
