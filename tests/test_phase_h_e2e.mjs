// Vireo Studio — Phase H end-to-end contract test.
//
// Phase H goal: prove the wire from Studio to the video agent works for the
// 5 newly-wired tools (add_music, add_broll, apply_hook_style,
// find_best_moments, generate_thumbnail). We stand up a tiny in-process
// video agent that records each request, then drive Studio through
// executeToolCall() with a real JWT and a mock LLM and assert the right
// shape lands at the video endpoint.
//
// This is a CONTRACT test, not a runtime test: the real video agent needs
// ffmpeg + a real video file. What we lock down is the wire shape so a
// later regression (e.g. someone renames a field, drops a parameter, or
// routes the tool to a wrong path) is caught at unit-test time.
//
// P0 wire-mismatch note (2026-06-08): add_broll / apply_hook_style /
// generate_thumbnail currently send { file_path, operation,
// operation_params: {...} } to /edit. The video agent's pipeline does not
// yet branch on `operation` — these calls land in the default /edit
// pipeline. This test verifies the SHAPE Studio sends; the Phase H
// follow-up is to make the video agent honor `operation` (P0-4 in the
// plan). Until then, these tools return ok:true but do not actually
// perform the named operation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const STUDIO_ROOT = path.join(PROJECT_ROOT, "agents", "studio");
const AUTH_MIDDLEWARE = path.join(PROJECT_ROOT, "packages", "auth-middleware", "index.js");

// URL helpers — absolute paths must be file:// URLs on Windows. The
// Studio server.js reads VIDEO_URL from env at MODULE LOAD time (const
// VIDEO_URL = process.env.VIREO_VIDEO_URL || "http://..."), so to
// re-bind the URL per test we need a fresh module each time. We append
// a unique query string to the file URL — Node treats URL+query as a
// distinct module spec, so each test gets a fresh `VIDEO_URL` constant.
function studioURL() { return `${pathToFileURL(path.join(STUDIO_ROOT, "src", "server.js")).href}?v=${Math.random().toString(36).slice(2)}`; }
function toolsURL() { return `${pathToFileURL(path.join(STUDIO_ROOT, "src", "tools.js")).href}?v=${Math.random().toString(36).slice(2)}`; }
function authURL() { return pathToFileURL(AUTH_MIDDLEWARE).href; }

// ---------- shared helpers ----------

function startMockVideoAgent() {
  const calls = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const rec = {
        method: req.method,
        path: url.pathname,
        headers: { ...req.headers },
        body: null,
      };
      try { rec.body = body ? JSON.parse(body) : null; } catch { rec.body = body; }
      calls.push(rec);

      // Branch on the endpoint the Studio tools hit. We return a distinct
      // shape per endpoint so a misrouted call is obvious from the
      // response.
      if (url.pathname === "/transcribe") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          transcript: { text: "hello world", duration: 60, segments: [] },
        }));
        return;
      }
      if (url.pathname === "/chapters") {
        // /chapters is called twice: once without llm_response (returns
        // prompt), once with llm_response (returns parsed chapters).
        if (rec.body?.llm_response) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            chapters: [
              { start_sec: 0, end_sec: 30, title: "Intro" },
              { start_sec: 30, end_sec: 60, title: "Main" },
            ],
          }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ prompt: "List the chapters for this transcript." }));
        }
        return;
      }
      if (url.pathname === "/moments") {
        if (rec.body?.llm_response) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            moments: [
              { start_sec: 0, end_sec: 15, score: 0.9, reason: "hook" },
              { start_sec: 30, end_sec: 45, score: 0.7, reason: "punchline" },
            ],
          }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ prompt: "Find 3 best moments." }));
        }
        return;
      }
      if (url.pathname === "/edit") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          job_id: "job_mock_1",
          output: "/tmp/mock_output.mp4",
        }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "mock_video_unhandled_path", path: url.pathname }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port, calls });
    });
  });
}

function makeMockLLM() {
  return {
    model: "mock", isMock: () => true, costUsd: () => 0,
    chat: async ({ messages }) => {
      // find_best_moments and generate_chapters feed the LLM a prompt
      // and need a real-looking JSON answer back. Return a stub that
      // the video agent's parser will accept.
      return { content: "1. Hook\n2. Main\n3. Conclusion", tool_calls: null,
               usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    },
    getUsage: () => ({}),
  };
}

async function buildStudioServer({ videoPort, llm, secret = "phase-h-test" } = {}) {
  // Studio reads VIREO_VIDEO_URL (with the VIREO_ prefix) at module-load
// time. We set it before every fresh import.
process.env.VIREO_VIDEO_URL = `http://127.0.0.1:${videoPort}`;
  // Force a fresh module load so the new VIDEO_URL is captured.
  const { buildServer } = await import(studioURL());
  const { server } = buildServer({ secret, llm: llm || makeMockLLM() });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return { server, port, close: () => new Promise((r) => server.close(r)) };
}

async function getToken(secret) {
  const mod = await import(authURL());
  return mod.signToken({ sub: "u-phase-h", email: "h@example.com", name: "H" }, secret, 600);
}

// ---------- tests ----------

test("phase-H e2e: add_music → /edit with enable_music + mood", async () => {
  const video = await startMockVideoAgent();
  try {
    process.env.VIREO_VIDEO_URL = `http://127.0.0.1:${video.port}`;
    const { executeToolCall } = await import(toolsURL());
    const ctx = { userId: "u-phase-h", deps: null };
    const result = await executeToolCall(
      { name: "add_music", args: { file_id: "/uploads/demo.mp4", mood: "upbeat", volume: 0.2 } },
      ctx
    );
    assert.equal(result.ok, true, `expected ok:true, got ${JSON.stringify(result)}`);
    const editCall = video.calls.find((c) => c.path === "/edit");
    assert.ok(editCall, "video agent should have received a /edit call");
    assert.equal(editCall.body.source_path, "/uploads/demo.mp4");
    assert.equal(editCall.body.enable_music, true);
    assert.equal(editCall.body.music_mood, "upbeat");
    assert.equal(editCall.body.music_volume, 0.2);
  } finally {
    await new Promise((r) => video.server.close(r));
  }
});

test("phase-H e2e: add_broll → /edit with operation=add_broll + source_path", async () => {
  // add_broll is a STUDIO_INPROCESS tool: it's implemented in
  // buildToolDeps (server.js) and needs a real ctx.deps. We exercise
  // it through the chat endpoint with a tool-forcing mock LLM.
  //
  // B1 fix (2026-06-08): the Studio handler now maps
  // `{file_path: ...}` (LLM-facing) to `{source_path: ...}`
  // (video agent's EditRequest field). Previously the request
  // fell through to the default edit pipeline because
  // _build_edit_request filtered out `file_path`.
  const video = await startMockVideoAgent();
  try {
    const toolLLM = {
      model: "mock", isMock: () => true, costUsd: () => 0,
      chat: async ({ messages }) => {
        const last = messages[messages.length - 1];
        if (last?.role === "tool") {
          return { content: "Added 3 b-roll clips.", tool_calls: null,
                   usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
        }
        return {
          content: "",
          tool_calls: [{
            id: "c1", type: "function",
            function: { name: "add_broll", arguments: JSON.stringify({ file_path: "/uploads/long.mp4", style: "tech", count: 3 }) },
          }],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        };
      },
      getUsage: () => ({}),
    };
    const { server, port, close } = await buildStudioServer({ videoPort: video.port, llm: toolLLM, secret: "phase-h-test" });
    const token = await getToken("phase-h-test");
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: "add broll about tech" }),
      });
      const body = await r.json();
      assert.equal(r.status, 200, `chat should be 200, got ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
      assert.ok(body.tool_calls?.length >= 1);
      assert.equal(body.tool_calls[0].name, "add_broll");
      const editCall = video.calls.find((c) => c.path === "/edit");
      assert.ok(editCall, "video agent /edit should have been called");
      // B1 wire-shape: Studio sends `source_path` (snake_case alias of
      // `file_path`) + the new `operation` + `operation_params` fields.
      assert.equal(editCall.body.source_path, "/uploads/long.mp4", "Studio must map file_path -> source_path for the video agent");
      assert.equal(editCall.body.operation, "add_broll");
      assert.deepEqual(editCall.body.operation_params, { style: "tech", count: 3 });
    } finally {
      await close();
    }
  } finally {
    await new Promise((r) => video.server.close(r));
  }
});

test("phase-H e2e: apply_hook_style → /edit with operation=apply_hook_style", async () => {
  const video = await startMockVideoAgent();
  try {
    const toolLLM = {
      model: "mock", isMock: () => true, costUsd: () => 0,
      chat: async ({ messages }) => {
        const last = messages[messages.length - 1];
        if (last?.role === "tool") {
          return { content: "Hook restructured.", tool_calls: null,
                   usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
        }
        return {
          content: "",
          tool_calls: [{
            id: "c1", type: "function",
            function: { name: "apply_hook_style", arguments: JSON.stringify({ file_path: "/uploads/v.mp4", style: "question" }) },
          }],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        };
      },
      getUsage: () => ({}),
    };
    const { server, port, close } = await buildStudioServer({ videoPort: video.port, llm: toolLLM, secret: "phase-h-test" });
    const token = await getToken("phase-h-test");
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: "make my hook more engaging" }),
      });
      const body = await r.json();
      assert.equal(r.status, 200, `chat should be 200, got ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
      const editCall = video.calls.find((c) => c.path === "/edit");
      assert.ok(editCall, "video agent /edit should have been called");
      assert.equal(editCall.body.source_path, "/uploads/v.mp4", "Studio must map file_path -> source_path");
      assert.equal(editCall.body.operation, "apply_hook_style");
      assert.deepEqual(editCall.body.operation_params, { style: "question" });
    } finally {
      await close();
    }
  } finally {
    await new Promise((r) => video.server.close(r));
  }
});

test("phase-H e2e: generate_thumbnail → /edit with operation=generate_thumbnail + title", async () => {
  const video = await startMockVideoAgent();
  try {
    const toolLLM = {
      model: "mock", isMock: () => true, costUsd: () => 0,
      chat: async ({ messages }) => {
        const last = messages[messages.length - 1];
        if (last?.role === "tool") {
          return { content: "Thumbnail saved.", tool_calls: null,
                   usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
        }
        return {
          content: "",
          tool_calls: [{
            id: "c1", type: "function",
            function: { name: "generate_thumbnail", arguments: JSON.stringify({ file_path: "/uploads/v.mp4", style: "expressive", title: "AI editing 101" }) },
          }],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        };
      },
      getUsage: () => ({}),
    };
    const { server, port, close } = await buildStudioServer({ videoPort: video.port, llm: toolLLM, secret: "phase-h-test" });
    const token = await getToken("phase-h-test");
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: "make me a thumbnail" }),
      });
      const body = await r.json();
      assert.equal(r.status, 200, `chat should be 200, got ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
      const editCall = video.calls.find((c) => c.path === "/edit");
      assert.ok(editCall, "video agent /edit should have been called");
      assert.equal(editCall.body.source_path, "/uploads/v.mp4", "Studio must map file_path -> source_path");
      assert.equal(editCall.body.operation, "generate_thumbnail");
      assert.deepEqual(editCall.body.operation_params, { style: "expressive", title: "AI editing 101" });
    } finally {
      await close();
    }
  } finally {
    await new Promise((r) => video.server.close(r));
  }
});

test("phase-H e2e: find_best_moments → transcribe + /moments prompt + /moments parse", async () => {
  const video = await startMockVideoAgent();
  try {
    const toolLLM = {
      model: "mock", isMock: () => true, costUsd: () => 0,
      chat: async ({ messages }) => {
        const last = messages[messages.length - 1];
        if (last?.role === "tool") {
          return { content: "Found 2 great moments.", tool_calls: null,
                   usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
        }
        return {
          content: "",
          tool_calls: [{
            id: "c1", type: "function",
            function: { name: "find_best_moments", arguments: JSON.stringify({ file_path: "/uploads/long.mp4", max_moments: 2 }) },
          }],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        };
      },
      getUsage: () => ({}),
    };
    const { server, port, close } = await buildStudioServer({ videoPort: video.port, llm: toolLLM, secret: "phase-h-test" });
    const token = await getToken("phase-h-test");
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: "find 2 best moments from /uploads/long.mp4" }),
      });
      const body = await r.json();
      assert.equal(r.status, 200, `chat should be 200, got ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
      assert.ok(body.tool_calls?.length >= 1, "should have made at least one tool call");
      const momentsCall = video.calls.find((c) => c.path === "/moments");
      const transcribeCall = video.calls.find((c) => c.path === "/transcribe");
      assert.ok(transcribeCall, "should have called /transcribe first");
      assert.ok(momentsCall, "should have called /moments");
      assert.equal(momentsCall.body.max_moments, 2);
      assert.equal(momentsCall.body.platform, "tiktok");
    } finally {
      await close();
    }
  } finally {
    await new Promise((r) => video.server.close(r));
  }
});

test("phase-H e2e: chat with no API key (mock LLM) — full request → tool → reply cycle", async () => {
  // P0-1 smoke: real Studio with a mock LLM end-to-end, no API key.
  // Validates that buildServer({ llm: mock }) works in production code
  // path (not just a test mock) and that the chat endpoint returns a
  // 200 with both a tool call AND a final summary, with the tool call
  // actually hitting the video agent.
  const video = await startMockVideoAgent();
  try {
    const llm = {
      model: "mock", isMock: () => true, costUsd: () => 0,
      chat: async ({ messages }) => {
        const last = messages[messages.length - 1];
        if (last?.role === "tool") {
          return { content: "Music added!", tool_calls: null,
                   usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
        }
        return {
          content: "",
          tool_calls: [{
            id: "c1", type: "function",
            function: { name: "add_music", arguments: JSON.stringify({ file_id: "/uploads/x.mp4", mood: "chill" }) },
          }],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        };
      },
      getUsage: () => ({}),
    };
    const { server, port, close } = await buildStudioServer({ videoPort: video.port, llm, secret: "phase-h-test" });
    const { signToken } = await import(authURL());
    const token = await signToken({ sub: "u-phase-h", email: "h@example.com", name: "H" }, "phase-h-test", 600);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: "add chill music to my video" }),
      });
      const body = await r.json();
      assert.equal(r.status, 200, `chat should be 200, got ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
      assert.ok(body.reply, "should have a final reply");
      assert.ok(body.tool_calls?.length >= 1, "should have made at least one tool call");
      assert.equal(body.tool_calls[0].name, "add_music");
      const editCall = video.calls.find((c) => c.path === "/edit");
      assert.ok(editCall, "video agent /edit should have been called");
      assert.equal(editCall.body.enable_music, true);
      assert.equal(editCall.body.music_mood, "chill");
    } finally {
      await close();
    }
  } finally {
    await new Promise((r) => video.server.close(r));
  }
});
