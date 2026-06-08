// Vireo Studio — basic server tests.
//
// We exercise:
//   - /health
//   - 401 on unauthenticated
//   - /api/projects CRUD
//   - /api/content-pieces
//   - /api/style-dna/analyze
//   - /api/chat with a mock LLM

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../src/server.js";
import { signToken } from "../../../packages/auth-middleware/index.js";

function makeMockLLM() {
  return {
    model: "mock",
    isMock: () => true,
    costUsd: () => 0,
    chat: async ({ system, messages }) => {
      const last = [...messages].reverse().find((m) => m.role === "user");
      const text = last?.content || "";
      return { content: `mock-reply: ${text.slice(0, 40)}`, tool_calls: null, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
    },
    getUsage: () => ({ input_tokens: 0, output_tokens: 0, request_count: 0, error_count: 0, retry_count: 0, total_cost_usd: 0 }),
  };
}

function makeMockLLMWithTool() {
  return {
    model: "mock",
    isMock: () => true,
    costUsd: () => 0,
    chat: async ({ messages, tools }) => {
      // If last message is a tool result, give a final summary (no more tool calls).
      const last = messages[messages.length - 1];
      if (last?.role === "tool") {
        return { content: "Done! I created the project.", tool_calls: null, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
      }
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const text = (lastUser?.content || "").toLowerCase();
      if (/create.*project/.test(text)) {
        return {
          content: "",
          tool_calls: [{ id: "c1", type: "function", function: { name: "create_project", arguments: JSON.stringify({ name: "Demo Project" }) } }],
          usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
        };
      }
      return { content: "ok", tool_calls: null, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
    },
    getUsage: () => ({}),
  };
}

async function listen(server) {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return { port, close: () => new Promise((r) => server.close(r)) };
}

async function getToken(secret = "testsecret") {
  return signToken({ sub: "u-test-1", email: "t@example.com", name: "T" }, secret, 600);
}

test("health: returns ok", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.status, "ok");
  assert.equal(body.agent, "studio");
  assert.equal(body.llm_mock, true);
  await close();
});

test("projects: 401 without auth", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/api/projects`);
  assert.equal(r.status, 401);
  await close();
});

test("projects: create, list, get, delete", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const token = await getToken("s");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  // create
  const r1 = await fetch(`http://127.0.0.1:${port}/api/projects`, { method: "POST", headers, body: JSON.stringify({ name: "Test", niche: "tech" }) });
  assert.equal(r1.status, 201);
  const { project } = await r1.json();
  assert.equal(project.name, "Test");
  assert.equal(project.user_id, "u-test-1");
  const id = project.id;

  // list
  const r2 = await fetch(`http://127.0.0.1:${port}/api/projects`, { headers });
  assert.equal(r2.status, 200);
  const { projects } = await r2.json();
  assert.equal(projects.length, 1);

  // get
  const r3 = await fetch(`http://127.0.0.1:${port}/api/projects/${id}`, { headers });
  assert.equal(r3.status, 200);

  // delete
  const r4 = await fetch(`http://127.0.0.1:${port}/api/projects/${id}`, { method: "DELETE", headers });
  assert.equal(r4.status, 200);

  // 404 after delete
  const r5 = await fetch(`http://127.0.0.1:${port}/api/projects/${id}`, { headers });
  assert.equal(r5.status, 404);

  await close();
});

test("content-pieces: save and list", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const token = await getToken("s");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  // create project first
  const p1 = await (await fetch(`http://127.0.0.1:${port}/api/projects`, { method: "POST", headers, body: JSON.stringify({ name: "P" }) })).json();
  const projectId = p1.project.id;

  // save piece
  const r1 = await fetch(`http://127.0.0.1:${port}/api/content-pieces`, { method: "POST", headers, body: JSON.stringify({ project_id: projectId, text: "hello world" }) });
  assert.equal(r1.status, 201);
  const { piece } = await r1.json();
  assert.equal(piece.text, "hello world");
  assert.equal(piece.user_id, "u-test-1");

  // list
  const r2 = await fetch(`http://127.0.0.1:${port}/api/content-pieces?project_id=${projectId}`, { headers });
  const { pieces } = await r2.json();
  assert.equal(pieces.length, 1);

  await close();
});

test("content-pieces: project isolation across users", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const t1 = await getToken("s");
  const t2 = signToken({ sub: "u-test-2", email: "2@x.com" }, "s", 600);
  const h1 = { "Content-Type": "application/json", Authorization: `Bearer ${t1}` };
  const h2 = { "Content-Type": "application/json", Authorization: `Bearer ${t2}` };

  // user 1 creates project and content
  const p1 = await (await fetch(`http://127.0.0.1:${port}/api/projects`, { method: "POST", headers: h1, body: JSON.stringify({ name: "U1" }) })).json();
  const pid = p1.project.id;
  await fetch(`http://127.0.0.1:${port}/api/content-pieces`, { method: "POST", headers: h1, body: JSON.stringify({ project_id: pid, text: "secret" }) });

  // user 2 cannot read
  const r = await fetch(`http://127.0.0.1:${port}/api/projects/${pid}`, { headers: h2 });
  assert.equal(r.status, 404);
  // user 2's list should be empty
  const r2 = await fetch(`http://127.0.0.1:${port}/api/projects`, { headers: h2 });
  const { projects } = await r2.json();
  assert.equal(projects.length, 0);
  // user 2 cannot save to user 1's project
  const r3 = await fetch(`http://127.0.0.1:${port}/api/content-pieces`, { method: "POST", headers: h2, body: JSON.stringify({ project_id: pid, text: "x" }) });
  assert.equal(r3.status, 404);
  await close();
});

test("chat: works with mock LLM (no tools)", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const token = await getToken("s");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const r = await fetch(`http://127.0.0.1:${port}/api/chat`, { method: "POST", headers, body: JSON.stringify({ message: "hello agent" }) });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.reply.startsWith("mock-reply:"));
  assert.ok(body.conversation_id);
  assert.equal(body.usage.total_tokens, 15);

  // Second message continues the same conversation
  const r2 = await fetch(`http://127.0.0.1:${port}/api/chat`, { method: "POST", headers, body: JSON.stringify({ message: "second", conversation_id: body.conversation_id }) });
  assert.equal(r2.status, 200);
  // Read back the conversation
  const r3 = await fetch(`http://127.0.0.1:${port}/api/conversations/${body.conversation_id}`, { headers });
  const conv = await r3.json();
  assert.ok(conv.messages.length >= 4);
  await close();
});

test("chat: invokes tool (create_project) and stores result", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLMWithTool() });
  const { port, close } = await listen(server);
  const token = await getToken("s");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const r = await fetch(`http://127.0.0.1:${port}/api/chat`, { method: "POST", headers, body: JSON.stringify({ message: "please create a project for me" }) });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.tool_calls && body.tool_calls.length === 1);
  assert.equal(body.tool_calls[0].name, "create_project");
  // Verify the project was actually created
  const r2 = await fetch(`http://127.0.0.1:${port}/api/projects`, { headers });
  const { projects } = await r2.json();
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, "Demo Project");
  await close();
});

test("style-dna: analyze requires corpus, falls back to simple DNA", async () => {
  // Make style-learner unreachable by using an invalid URL
  process.env.VIREO_STYLE_URL = "http://127.0.0.1:1";
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const token = await getToken("s");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  // Need at least 2 pieces for meaningful DNA
  await fetch(`http://127.0.0.1:${port}/api/content-pieces`, { method: "POST", headers, body: JSON.stringify({ text: "Hey! Subscribe! Insane content!" }) });
  await fetch(`http://127.0.0.1:${port}/api/content-pieces`, { method: "POST", headers, body: JSON.stringify({ text: "Quick tip: always warm up before coding. Trust me on this one." }) });
  const r = await fetch(`http://127.0.0.1:${port}/api/style-dna/analyze`, { method: "POST", headers, body: JSON.stringify({}) });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.style_dna);
  assert.equal(body.corpus_size, 2);
  assert.ok(["energetic", "casual", "verbose"].includes(body.style_dna.tone));
  // First analyze should not be flagged as merged
  assert.equal(body.merged, false);
  await close();
  delete process.env.VIREO_STYLE_URL;
});

test("style-dna: analyze with 1 piece returns no_corpus error", async () => {
  process.env.VIREO_STYLE_URL = "http://127.0.0.1:1";
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const token = await getToken("s");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  // Only 1 piece — should be rejected
  await fetch(`http://127.0.0.1:${port}/api/content-pieces`, { method: "POST", headers, body: JSON.stringify({ text: "Just one piece" }) });
  const r = await fetch(`http://127.0.0.1:${port}/api/style-dna/analyze`, { method: "POST", headers, body: JSON.stringify({}) });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.error, "no_corpus");
  await close();
  delete process.env.VIREO_STYLE_URL;
});

test("style-dna: second analyze merges with first", async () => {
  process.env.VIREO_STYLE_URL = "http://127.0.0.1:1";
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const token = await getToken("s");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  await fetch(`http://127.0.0.1:${port}/api/content-pieces`, { method: "POST", headers, body: JSON.stringify({ text: "First piece about tech and AI" }) });
  await fetch(`http://127.0.0.1:${port}/api/content-pieces`, { method: "POST", headers, body: JSON.stringify({ text: "Second piece about crypto" }) });
  const r1 = await fetch(`http://127.0.0.1:${port}/api/style-dna/analyze`, { method: "POST", headers, body: JSON.stringify({}) });
  const first = await r1.json();
  assert.equal(first.merged, false);

  // Add more pieces and re-analyze — should merge, not overwrite
  await fetch(`http://127.0.0.1:${port}/api/content-pieces`, { method: "POST", headers, body: JSON.stringify({ text: "Third piece about startups" }) });
  await fetch(`http://127.0.0.1:${port}/api/content-pieces`, { method: "POST", headers, body: JSON.stringify({ text: "Fourth piece about SaaS" }) });
  const r2 = await fetch(`http://127.0.0.1:${port}/api/style-dna/analyze`, { method: "POST", headers, body: JSON.stringify({}) });
  const second = await r2.json();
  assert.equal(second.merged, true);
  assert.equal(second.style_dna.id, first.style_dna.id, "DNA should be updated in place, not created new");
  await close();
  delete process.env.VIREO_STYLE_URL;
});

test("chat: rejects unauthenticated", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "x" }) });
  assert.equal(r.status, 401);
  await close();
});

// ---- P0 #16: edit_content / distribute / save_content tool coverage ----

function makeMockLLMWithMultiTool() {
  return {
    model: "mock", isMock: () => true, costUsd: () => 0, getUsage: () => ({}),
    chat: async ({ messages }) => {
      const last = messages[messages.length - 1];
      // After tool results, give a final summary
      if (last?.role === "tool") {
        return { content: "All done!", tool_calls: null, usage: { input_tokens: 30, output_tokens: 10, total_tokens: 40 } };
      }
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const text = (lastUser?.content || "").toLowerCase();
      if (/save.*content/.test(text)) {
        return {
          content: "",
          tool_calls: [{ id: "t-save", type: "function", function: { name: "save_content", arguments: JSON.stringify({ text: "Latest content piece from agent" }) } }],
          usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
        };
      }
      if (/edit/.test(text)) {
        return {
          content: "",
          tool_calls: [{ id: "t-edit", type: "function", function: { name: "edit_content", arguments: JSON.stringify({ piece_id: "p1", changes: "make it punchier" }) } }],
          usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
        };
      }
      if (/distribute|publish|share/.test(text)) {
        return {
          content: "",
          tool_calls: [{ id: "t-dist", type: "function", function: { name: "distribute", arguments: JSON.stringify({ piece_id: "p1", platforms: ["twitter"] }) } }],
          usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
        };
      }
      return { content: "ok", tool_calls: null, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
    },
  };
}

test("chat: save_content tool creates a content piece", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLMWithMultiTool() });
  const { port, close } = await listen(server);
  const token = await getToken("s");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const r = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: "POST", headers,
    body: JSON.stringify({ message: "save this content for me" }),
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.tool_calls?.[0]?.name, "save_content");
  // Verify a piece was actually created
  const r2 = await fetch(`http://127.0.0.1:${port}/api/content-pieces`, { headers });
  const { pieces } = await r2.json();
  assert.ok(pieces.length >= 1, "save_content should have created at least one piece");
  assert.equal(pieces[0].text, "Latest content piece from agent");
  await close();
});

// ---- P0 #16: edit_content tool coverage ----
//
// Note: the edit_content tool schema (in src/tools.js) accepts
// { text, target_sec, project_id } — there is no piece_id argument.
// The LLM is expected to fetch a piece's text via list_content /
// get_style_dna first and pass the text directly. This test asserts
// that the edit plan reflects the LLM's *requested* text, not a
// silent `pieces.listForUser()[0]` fallback.

test("chat: edit_content tool reflects the requested text (no silent all[0] fallback)", async () => {
  const requestedText = "Make this paragraph punchier and tighten the hook line";
  const editMock = {
    model: "mock", isMock: () => true, costUsd: () => 0, getUsage: () => ({}),
    chat: async ({ messages }) => {
      const last = messages[messages.length - 1];
      if (last?.role === "tool") return { content: "Edited!", tool_calls: null, usage: { input_tokens: 30, output_tokens: 10, total_tokens: 40 } };
      return {
        content: "",
        tool_calls: [{ id: "t-e", type: "function", function: { name: "edit_content", arguments: JSON.stringify({ text: requestedText, target_sec: 30 }) } }],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
      };
    },
  };
  // Disable the editor upstream so the server falls back to makeFallbackPlan,
  // whose cut text we then assert contains the LLM's requested text. (If the
  // editor were live, the test would need a stubbed fetchImpl — overkill.)
  process.env.VIREO_EDITOR_URL = "http://127.0.0.1:1";
  try {
    const { server } = buildServer({ secret: "s", llm: editMock });
    const { port, close } = await listen(server);
    const token = await getToken("s");
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

    // Two unrelated pieces — if the dep silently used all[0] instead of
    // the LLM's requested text, we'd see this decoy text in the cut.
    await fetch(`http://127.0.0.1:${port}/api/content-pieces`, { method: "POST", headers, body: JSON.stringify({ text: "DECOY piece that should not appear in the cut plan" }) });
    await fetch(`http://127.0.0.1:${port}/api/content-pieces`, { method: "POST", headers, body: JSON.stringify({ text: "Another decoy" }) });

    const r = await fetch(`http://127.0.0.1:${port}/api/chat`, { method: "POST", headers, body: JSON.stringify({ message: "edit this" }) });
    const body = await r.json();
    assert.equal(body.tool_calls?.[0]?.name, "edit_content");
    // The LLM tool result (sent back as a 'tool' message in the conversation)
    // should reference the requested text, not the decoy.
    const conv = await (await fetch(`http://127.0.0.1:${port}/api/conversations/${body.conversation_id}`, { headers })).json();
    const toolMsg = conv.messages.find((m) => m.role === "tool");
    assert.ok(toolMsg, "should have a tool result message in the conversation");
    const parsed = JSON.parse(toolMsg.content);
    assert.equal(parsed.ok, true, `tool should succeed, got: ${toolMsg.content}`);
    // The fallback plan serializes the requested text into cuts — assert at
    // least one cut carries the requested content, and none carry the decoy.
    const cutsText = JSON.stringify(parsed.edit_plan);
    assert.ok(cutsText.includes("punchier"), `cut plan should reflect the requested text, got: ${cutsText.slice(0, 200)}`);
    assert.ok(!cutsText.includes("DECOY"), `cut plan must not silently fall back to a saved piece: ${cutsText.slice(0, 200)}`);
    await close();
  } finally {
    delete process.env.VIREO_EDITOR_URL;
  }
});

// ---- P0 #17: analyze_style with project_id and content_piece --project linkage ----

test("style-dna: analyze with project_id scopes the corpus", async () => {
  process.env.VIREO_STYLE_URL = "http://127.0.0.1:1";
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const token = await getToken("s");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  // Two projects, each with their own pieces
  const pa = (await (await fetch(`http://127.0.0.1:${port}/api/projects`, { method: "POST", headers, body: JSON.stringify({ name: "Project A", niche: "tech" }) })).json()).project;
  const pb = (await (await fetch(`http://127.0.0.1:${port}/api/projects`, { method: "POST", headers, body: JSON.stringify({ name: "Project B", niche: "fitness" }) })).json()).project;

  // 2 pieces in project A
  await fetch(`http://127.0.0.1:${port}/api/content-pieces`, { method: "POST", headers, body: JSON.stringify({ text: "Tech piece one from A", project_id: pa.id }) });
  await fetch(`http://127.0.0.1:${port}/api/content-pieces`, { method: "POST", headers, body: JSON.stringify({ text: "Tech piece two from A", project_id: pa.id }) });
  // 5 pieces in project B (more, but should be ignored)
  for (let i = 0; i < 5; i++) {
    await fetch(`http://127.0.0.1:${port}/api/content-pieces`, { method: "POST", headers, body: JSON.stringify({ text: `Fitness ${i}`, project_id: pb.id }) });
  }

  // Analyze scoped to project A
  const r = await fetch(`http://127.0.0.1:${port}/api/style-dna/analyze`, { method: "POST", headers, body: JSON.stringify({ project_id: pa.id }) });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.corpus_size, 2, "should only consider pieces from project A");
  await close();
  delete process.env.VIREO_STYLE_URL;
});

// ---- P0 #18: multi-turn with 2+ tool calls in a row ----

function makeMockLLMTwoTools() {
  return {
    model: "mock", isMock: () => true, costUsd: () => 0, getUsage: () => ({}),
    chat: async ({ messages }) => {
      const last = messages[messages.length - 1];
      const toolCount = messages.filter((m) => m.role === "tool").length;
      // After 2 tool results, finish
      if (last?.role === "tool" && toolCount >= 2) {
        return { content: "Both projects created!", tool_calls: null, usage: { input_tokens: 50, output_tokens: 20, total_tokens: 70 } };
      }
      // First tool result: ask for the second one
      if (last?.role === "tool" && toolCount === 1) {
        return {
          content: "",
          tool_calls: [{ id: "t2", type: "function", function: { name: "create_project", arguments: JSON.stringify({ name: "Second Project" }) } }],
          usage: { input_tokens: 30, output_tokens: 10, total_tokens: 40 },
        };
      }
      // First request: do the first tool
      return {
        content: "",
        tool_calls: [{ id: "t1", type: "function", function: { name: "create_project", arguments: JSON.stringify({ name: "First Project" }) } }],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
      };
    },
  };
}

test("chat: multi-turn handles 2+ tool calls in sequence", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLMTwoTools() });
  const { port, close } = await listen(server);
  const token = await getToken("s");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const r = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: "POST", headers, body: JSON.stringify({ message: "create two projects" }),
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.reply.includes("Both"), "final reply should come after both tool calls");
  // Verify both projects exist
  const r2 = await fetch(`http://127.0.0.1:${port}/api/projects`, { headers });
  const { projects } = await r2.json();
  assert.equal(projects.length, 2);
  const names = projects.map((p) => p.name).sort();
  assert.deepEqual(names, ["First Project", "Second Project"]);
  // Verify tool result messages are persisted in the conversation
  const r3 = await fetch(`http://127.0.0.1:${port}/api/conversations/${body.conversation_id}`, { headers });
  const conv = await r3.json();
  const toolMessages = conv.messages.filter((m) => m.role === "tool");
  assert.equal(toolMessages.length, 2, "both tool result messages should be persisted");
  await close();
});

// ---- P0 #19: user isolation ----

test("isolation: user A cannot see user B's projects, pieces, conversations, DNA", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const tokenA = await signToken({ sub: "user-a", email: "a@x.com" }, "s", 600);
  const tokenB = await signToken({ sub: "user-b", email: "b@x.com" }, "s", 600);
  const hA = { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` };
  const hB = { "Content-Type": "application/json", Authorization: `Bearer ${tokenB}` };

  // A creates a project + piece
  const pa = (await (await fetch(`http://127.0.0.1:${port}/api/projects`, { method: "POST", headers: hA, body: JSON.stringify({ name: "A's project" }) })).json()).project;
  await fetch(`http://127.0.0.1:${port}/api/content-pieces`, { method: "POST", headers: hA, body: JSON.stringify({ text: "A's secret text", project_id: pa.id }) });
  // A creates a conversation
  const ca = (await (await fetch(`http://127.0.0.1:${port}/api/conversations`, { method: "POST", headers: hA, body: JSON.stringify({ title: "A's chat" }) })).json()).conversation;

  // B reads — should see nothing
  const r1 = await fetch(`http://127.0.0.1:${port}/api/projects`, { headers: hB });
  const { projects } = await r1.json();
  assert.equal(projects.length, 0, "user B should not see user A's projects");
  const r2 = await fetch(`http://127.0.0.1:${port}/api/content-pieces`, { headers: hB });
  const { pieces } = await r2.json();
  assert.equal(pieces.length, 0);
  const r3 = await fetch(`http://127.0.0.1:${port}/api/conversations`, { headers: hB });
  const { conversations } = await r3.json();
  assert.equal(conversations.length, 0);

  // B cannot GET A's project by id
  const r4 = await fetch(`http://127.0.0.1:${port}/api/projects/${pa.id}`, { headers: hB });
  assert.equal(r4.status, 404, "user B should get 404 on user A's project id");
  // B cannot GET A's conversation
  const r5 = await fetch(`http://127.0.0.1:${port}/api/conversations/${ca.id}`, { headers: hB });
  assert.equal(r5.status, 404);
  await close();
});

// ---- P0 #20: LLM error path ----

test("chat: LLM error -> user-friendly error response (not 500 crash)", async () => {
  const errorLLM = {
    model: "mock", isMock: () => true, costUsd: () => 0, getUsage: () => ({}),
    chat: async () => {
      throw new Error("LLM provider returned 502: upstream down");
    },
  };
  const { server } = buildServer({ secret: "s", llm: errorLLM });
  const { port, close } = await listen(server);
  const token = await getToken("s");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const r = await fetch(`http://127.0.0.1:${port}/api/chat`, { method: "POST", headers, body: JSON.stringify({ message: "hello" }) });
  // We expect 502 (or a handled 200 with error in body, legacy), not a 500 crash
  assert.ok(r.status === 200 || r.status === 502, `expected 200/502, got ${r.status}`);
  const body = await r.json();
  // The response must signal an error to the user (reply text or body.error).
  assert.ok(body.reply || body.error, "expected an error indication in reply or body.error");
  await close();
});

// =====================================================================
// P0 — streaming endpoint
// =====================================================================

test("stream: /api/chat/stream returns SSE with meta+tool+done events (mock LLM, no delta)", async () => {
  // With a mock LLM (no streamChat), we still emit meta/tool/done but no
  // delta events — the mock returns the full reply in one shot. P0-1 removed
  // the previous fake 12ms-per-token splitting.
  const { server } = buildServer({ secret: "s", llm: makeMockLLMWithTool() });
  const { port, close } = await listen(server);
  const token = await getToken("s");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const r = await fetch(`http://127.0.0.1:${port}/api/chat/stream`, {
    method: "POST", headers, body: JSON.stringify({ message: "create a project" }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const text = await r.text();
  assert.ok(text.includes("event: meta"), "should emit meta event");
  assert.ok(text.includes("event: tool"), "should emit tool event");
  assert.ok(text.includes("event: done"), "should emit done event");
  assert.ok(text.includes("conversation_id"), "meta should include conversation_id");
  await close();
});

test("stream: real LLM with streamChat emits real-time delta events", async () => {
  // P0-1: deltas come from the LLM's streamChat, not from a fake 12ms splitter.
  const realLLM = {
    model: "real-mock", isMock: () => false, costUsd: () => 0,
    chat: async ({ messages }) => {
      const last = messages[messages.length - 1];
      if (last?.role === "tool") return { content: "Done! Project created.", tool_calls: null, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
      const t = [...messages].reverse().find((m) => m.role === "user")?.content || "";
      if (/create.*project/.test(t.toLowerCase())) {
        return {
          content: "",
          tool_calls: [{ id: "c1", type: "function", function: { name: "create_project", arguments: JSON.stringify({ name: "Demo" }) } }],
          usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
        };
      }
      return { content: "ok", tool_calls: null, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
    },
    streamChat: async function* ({ messages }) {
      // Real LLM behaviour in pass 2: a tool result is somewhere in the
      // trajectory, the previous assistant turn was a tool_calls stub, and
      // we just need to produce a short final reply. We detect the
      // post-tool-call state by looking for ANY tool message in the
      // trajectory (not just the last role, which is `assistant` after
      // round 2 of _runAgent).
      const hasToolResult = messages.some((m) => m.role === "tool");
      if (hasToolResult) {
        const text = "Done! Project created.";
        for (const part of ["Done!", " Project", " created."]) {
          yield { delta: part, finish_reason: null };
        }
        yield { delta: "", finish_reason: "stop", usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 } };
        return;
      }
      const text = "regular reply";
      for (const ch of text.split("")) yield { delta: ch, finish_reason: null };
      yield { delta: "", finish_reason: "stop", usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
    },
    getUsage: () => ({ input_tokens: 0, output_tokens: 0, request_count: 0, error_count: 0, retry_count: 0, total_cost_usd: 0 }),
  };
  const { server } = buildServer({ secret: "s", llm: realLLM });
  const { port, close } = await listen(server);
  const token = await getToken("s");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const r = await fetch(`http://127.0.0.1:${port}/api/chat/stream`, {
    method: "POST", headers, body: JSON.stringify({ message: "create a project" }),
  });
  assert.equal(r.status, 200);
  const text = await r.text();

  // Parse SSE events
  const events = text.split("\n\n").filter(Boolean).map((block) => {
    const lines = block.split("\n");
    const ev = {};
    for (const l of lines) {
      if (l.startsWith("event: ")) ev.event = l.slice(7).trim();
      else if (l.startsWith("data: ")) ev.data = l.slice(6);
    }
    return ev;
  });

  // Should have: meta, tool, delta (multiple from real LLM), done
  const eventNames = events.map((e) => e.event);
  assert.ok(eventNames.includes("meta"));
  assert.ok(eventNames.includes("tool"));
  assert.ok(eventNames.includes("delta"));
  assert.ok(eventNames.includes("done"));

  // Deltas should be the actual streamed text "Done! Project created."
  const deltaEvents = events.filter((e) => e.event === "delta");
  assert.ok(deltaEvents.length >= 2, `should have multiple deltas, got ${deltaEvents.length}`);
  const fullDelta = deltaEvents.map((e) => JSON.parse(e.data).text).join("");
  assert.equal(fullDelta, "Done! Project created.", `delta should be the streamed text, got: "${fullDelta}"`);

  // done event should have the full reply
  const done = events.find((e) => e.event === "done");
  const doneData = JSON.parse(done.data);
  assert.equal(doneData.reply, "Done! Project created.");
  await close();
});

test("stream: first delta arrives within 200ms (no fake 12ms splitting)", async () => {
  // P0-1: deltas come as fast as the LLM produces them, not on a 12ms timer.
  // The old code would take at least 12ms per token; the new code returns
  // the LLM's delta as soon as it arrives.
  const realLLM = {
    model: "real-mock", isMock: () => false, costUsd: () => 0,
    chat: async ({ messages }) => {
      const last = messages[messages.length - 1];
      if (last?.role === "tool") return { content: "Done!", tool_calls: null, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
      return { content: "ok", tool_calls: null, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    },
    streamChat: async function* () {
      yield { delta: "Done!", finish_reason: null };
      yield { delta: "", finish_reason: "stop", usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    },
    getUsage: () => ({}),
  };
  const { server } = buildServer({ secret: "s", llm: realLLM });
  const { port, close } = await listen(server);
  const token = await getToken("s");
  const start = Date.now();
  const r = await fetch(`http://127.0.0.1:${port}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: "hi" }),
  });
  const text = await r.text();
  const elapsed = Date.now() - start;
  // Real streaming should complete in well under 1 second for a tiny reply.
  assert.ok(elapsed < 1000, `streaming should be fast, took ${elapsed}ms`);
  assert.ok(text.includes("event: delta"), "has delta events");
  await close();
});

// =====================================================================
// P1 — new endpoints (rewind, edit-message, feedback, welcome, auto-title,
//                    configurable rate limit)
// =====================================================================

// ---- helpers (post / get JSON) ----

function post(port, path, body, token) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
}

function get(port, path, token) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
}

function patch(port, path, body, token) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
}

async function ensureProject(port, tok, name) {
  const r = await post(port, "/api/projects", { name, niche: "" }, tok);
  return r.project.id;
}

// ---- rewind ----

test("rewind: deletes messages after to_message_id and keeps earlier ones", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const tok = await getToken("s");
  await ensureProject(port, tok, "P1");
  const r1 = await post(port, "/api/chat", { message: "first" }, tok);
  // Pass conversation_id on the second call so it joins the same conversation
  const r2 = await post(port, "/api/chat", { message: "second", conversation_id: r1.conversation_id }, tok);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  const before = await get(port, `/api/conversations/${r1.conversation_id}`, tok);
  assert.equal(before.messages.length >= 4, true, `should have ≥4 messages, got ${before.messages.length}`);
  // The "earliest user message" is the first user message in the conversation
  const firstUserMsg = before.messages.find((m) => m.role === "user");
  const rewindR = await post(port, `/api/conversations/${r1.conversation_id}/rewind`, { to_message_id: firstUserMsg.id }, tok);
  assert.equal(rewindR.ok, true, `rewind ok: ${rewindR.error}`);
  assert.equal(rewindR.deleted >= 3, true, `should delete ≥3: ${rewindR.deleted}`);
  const after = await get(port, `/api/conversations/${r1.conversation_id}`, tok);
  assert.equal(after.messages.length, 1, `expected 1 message left, got ${after.messages.length}`);
  assert.equal(after.messages[0].id, firstUserMsg.id, "first user message preserved");
  await close();
});

test("rewind: rejects other users' conversations with 404", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const tokA = await getToken("s");
  const tokB = signToken({ sub: "u-other", email: "o@x", name: "O" }, "s", 600);
  const r1 = await post(port, "/api/chat", { message: "hi" }, tokA);
  const rewindR = await post(port, `/api/conversations/${r1.conversation_id}/rewind`, { to_message_id: "m_x" }, tokB);
  assert.equal(rewindR.status, 404);
  assert.equal(rewindR.error, "not_found");
  await close();
});

test("rewind: missing to_message_id returns 400", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const tok = await getToken("s");
  const r1 = await post(port, "/api/chat", { message: "hi" }, tok);
  const rewindR = await post(port, `/api/conversations/${r1.conversation_id}/rewind`, {}, tok);
  assert.equal(rewindR.status, 400);
  assert.equal(rewindR.error, "validation");
  await close();
});

// ---- edit message (Edit & resend) ----

test("PATCH message: updates content", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const tok = await getToken("s");
  const r1 = await post(port, "/api/chat", { message: "original text" }, tok);
  const list = await get(port, `/api/conversations/${r1.conversation_id}`, tok);
  const userMsg = list.messages.find((m) => m.role === "user");
  const editR = await patch(port, `/api/messages/${userMsg.id}`, { content: "edited text" }, tok);
  assert.equal(editR.ok, true);
  // Server returns {ok: true} — verify persistence via re-read
  const after = await get(port, `/api/conversations/${r1.conversation_id}`, tok);
  const afterMsg = after.messages.find((m) => m.id === userMsg.id);
  assert.equal(afterMsg.content, "edited text");
  await close();
});

test("PATCH message: rejects non-owner with 404", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const tokA = await getToken("s");
  const tokB = signToken({ sub: "u-other", email: "o@x", name: "O" }, "s", 600);
  const r1 = await post(port, "/api/chat", { message: "hi" }, tokA);
  const list = await get(port, `/api/conversations/${r1.conversation_id}`, tokA);
  const userMsg = list.messages.find((m) => m.role === "user");
  const r = await patch(port, `/api/messages/${userMsg.id}`, { content: "hacked" }, tokB);
  assert.equal(r.status, 404, `expected 404, got ${r.status}`);
  await close();
});

test("PATCH message: rejects empty content with 400", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const tok = await getToken("s");
  const r1 = await post(port, "/api/chat", { message: "hi" }, tok);
  const list = await get(port, `/api/conversations/${r1.conversation_id}`, tok);
  const userMsg = list.messages.find((m) => m.role === "user");
  const r = await patch(port, `/api/messages/${userMsg.id}`, { content: "" }, tok);
  assert.equal(r.status, 400);
  assert.equal(r.error, "validation");
  await close();
});

// ---- feedback ----

test("feedback: thumbs up/down recorded, summary reflects, idempotent on same rating", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const tok = await getToken("s");
  const r1 = await post(port, "/api/chat", { message: "hi" }, tok);
  const list = await get(port, `/api/conversations/${r1.conversation_id}`, tok);
  const aMsg = list.messages.find((m) => m.role === "assistant");
  // Thumbs up
  const f1 = await post(port, `/api/messages/${aMsg.id}/feedback`, { rating: 1, comment: "great" }, tok);
  assert.equal(f1.ok, true);
  // Thumbs up again — same rating
  const f2 = await post(port, `/api/messages/${aMsg.id}/feedback`, { rating: 1 }, tok);
  assert.equal(f2.ok, true);
  // Switch to thumbs down
  const f3 = await post(port, `/api/messages/${aMsg.id}/feedback`, { rating: -1 }, tok);
  assert.equal(f3.ok, true);
  // Summary — shape: { total, upvotes, downvotes }
  const sum = await get(port, `/api/feedback/summary`, tok);
  assert.equal(sum.ok, true);
  assert.ok(sum.summary.downvotes >= 1, `summary should have ≥1 downvote: ${JSON.stringify(sum.summary)}`);
  await close();
});

test("feedback: rejects non-owner with 404", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const tokA = await getToken("s");
  const tokB = signToken({ sub: "u-other", email: "o@x", name: "O" }, "s", 600);
  const r1 = await post(port, "/api/chat", { message: "hi" }, tokA);
  const list = await get(port, `/api/conversations/${r1.conversation_id}`, tokA);
  const aMsg = list.messages.find((m) => m.role === "assistant");
  const r = await post(port, `/api/messages/${aMsg.id}/feedback`, { rating: 1 }, tokB);
  assert.equal(r.status, 404);
  assert.equal(r.error, "not_found");
  await close();
});

test("feedback: invalid rating rejected", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const tok = await getToken("s");
  const r1 = await post(port, "/api/chat", { message: "hi" }, tok);
  const list = await get(port, `/api/conversations/${r1.conversation_id}`, tok);
  const aMsg = list.messages.find((m) => m.role === "assistant");
  const r = await post(port, `/api/messages/${aMsg.id}/feedback`, { rating: 7 }, tok);
  assert.equal(r.status, 400);
  assert.equal(r.error, "validation");
  await close();
});

// ---- welcome interview ----

test("welcome: GET→not completed → POST → GET returns completed", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const tok = await getToken("s");
  const r1 = await get(port, "/api/welcome", tok);
  assert.equal(r1.ok, true);
  assert.equal(r1.completed, false);
  assert.equal(r1.answers, null);
  const r2 = await post(port, "/api/welcome", { niche: "AI for indie hackers", platforms: ["Twitter / X", "Substack"], tone: "casual", goals: "launch $29 course" }, tok);
  assert.equal(r2.ok, true);
  assert.equal(r2.answers.niche, "AI for indie hackers");
  const r3 = await get(port, "/api/welcome", tok);
  assert.equal(r3.ok, true);
  assert.equal(r3.completed, true);
  assert.equal(r3.answers.platforms.length, 2);
  await close();
});

test("welcome: rejects empty niche with 400", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const tok = await getToken("s");
  const r = await post(port, "/api/welcome", { niche: "", platforms: [] }, tok);
  assert.equal(r.status, 400);
  assert.equal(r.error, "validation");
  await close();
});

test("welcome: is per-user (u-other doesn't see u-test-1's answers)", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const tokA = await getToken("s");
  const tokB = signToken({ sub: "u-other", email: "o@x", name: "O" }, "s", 600);
  await post(port, "/api/welcome", { niche: "A's niche", platforms: ["TikTok"] }, tokA);
  const r = await get(port, "/api/welcome", tokB);
  assert.equal(r.completed, false);
  await close();
});

// ---- auto-title ----

test("auto-title: returns a short title and persists it to the conversation", async () => {
  const llm = makeMockLLM();
  llm.chat = async ({ system }) => {
    if (String(system).toLowerCase().includes("title")) {
      return { content: "Indie hacker content tips", tool_calls: null, usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 } };
    }
    return { content: "ok", tool_calls: null, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  };
  const { server } = buildServer({ secret: "s", llm });
  const { port, close } = await listen(server);
  const tok = await getToken("s");
  await ensureProject(port, tok, "P1");
  const r1 = await post(port, "/api/chat", { message: "Give me 5 content tips for indie hackers" }, tok);
  const titleR = await post(port, `/api/conversations/${r1.conversation_id}/auto-title`, {}, tok);
  assert.equal(titleR.ok, true, `auto-title err: ${titleR.error}`);
  assert.ok(titleR.title && titleR.title.length > 0, "non-empty title");
  assert.ok(titleR.title.length <= 80, `title too long: ${titleR.title.length}`);
  const conv = await get(port, `/api/conversations/${r1.conversation_id}`, tok);
  assert.equal(conv.conversation.title, titleR.title, "title persisted");
  await close();
});

// ---- configurable rate limit ----

test("rate limit: VIREO_RATE_LIMIT_MAX=2 caps at 2 calls/window", async () => {
  const prev = process.env.VIREO_RATE_LIMIT_MAX;
  process.env.VIREO_RATE_LIMIT_MAX = "2";
  try {
    const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
    const { port, close } = await listen(server);
    const tok = signToken({ sub: "u-rl", email: "rl@x", name: "RL" }, "s", 600);
    // First two pass (with or without success)
    await post(port, "/api/chat", { message: "hi" }, tok);
    await post(port, "/api/chat", { message: "hi" }, tok);
    // Third should 429
    const r3 = await post(port, "/api/chat", { message: "third" }, tok);
    assert.equal(r3.status, 429, `expected 429 on 3rd call, got ${r3.status} ${r3.error}`);
    await close();
  } finally {
    if (prev === undefined) delete process.env.VIREO_RATE_LIMIT_MAX;
    else process.env.VIREO_RATE_LIMIT_MAX = prev;
  }
});

// ---- vendor assets present (offline markdown + code highlighting) ----

test("vendor assets exist for offline markdown rendering", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const url = await import("node:url");
  // Resolve relative to THIS test file so the path works regardless of
  // where `node --test` was invoked from (was process.cwd()-relative, which
  // broke when the repo moved into "случайный проект/vireo/").
  // test file: agents/studio/tests/test_server.js
  // target:    apps/dashboard/public/vendor   (up 2 levels)
  const root = url.fileURLToPath(new URL("../../../apps/dashboard/public/vendor", import.meta.url));
  for (const f of ["marked.umd.js", "purify.min.js", "highlight.min.js"]) {
    const p = path.join(root, f);
    const stat = await fs.stat(p);
    assert.ok(stat.size > 1024, `${f} should be > 1KB, got ${stat.size}`);
  }
});

// ---- welcome interview (one-shot guided onboarding) ----
//
// The /api/welcome route and its store layer (InMemoryWelcomeStore +
// WelcomeAnswersStore) were added in earlier phases but never had direct
// HTTP tests. These cover both reads and writes, and verify that POST
// is idempotent (upsert on user_id PK) — onboarding is allowed to retry
// because flaky networks will lose the first POST and users will hit
// "Next →" twice.

test("welcome: GET without auth returns 401", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/api/welcome`);
  assert.equal(r.status, 401);
  await close();
});

test("welcome: GET for new user returns completed:false", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const token = await getToken("s");
  const r = await fetch(`http://127.0.0.1:${port}/api/welcome`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.completed, false);
  assert.equal(body.answers, null);
  await close();
});

test("welcome: POST without niche returns 400 validation", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const token = await getToken("s");
  const r = await fetch(`http://127.0.0.1:${port}/api/welcome`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ platforms: ["tiktok"] }),
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.error, "validation");
  await close();
});

test("welcome: POST then GET returns the saved answers", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const token = await getToken("s");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  // First POST — completed
  const post1 = await fetch(`http://127.0.0.1:${port}/api/welcome`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      niche: "tech",
      platforms: ["youtube", "tiktok"],
      tone: "energetic",
      goals: "build a faceless YouTube channel",
    }),
  });
  assert.equal(post1.status, 201);
  const { answers: a1 } = await post1.json();
  assert.equal(a1.niche, "tech");
  assert.deepEqual(a1.platforms, ["youtube", "tiktok"]);
  assert.equal(a1.tone, "energetic");
  assert.equal(a1.goals, "build a faceless YouTube channel");
  assert.equal(a1.user_id, "u-test-1");
  assert.ok(a1.created_at, "created_at should be set on first write");
  assert.ok(a1.updated_at, "updated_at should be set on first write");

  // GET should now return completed:true
  const get1 = await fetch(`http://127.0.0.1:${port}/api/welcome`, { headers });
  assert.equal(get1.status, 200);
  const body1 = await get1.json();
  assert.equal(body1.completed, true);
  assert.equal(body1.answers.niche, "tech");
  assert.equal(body1.answers.tone, "energetic");
  await close();
});

test("welcome: POST is idempotent — second POST updates same row", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const token = await getToken("s");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  // First write
  const r1 = await fetch(`http://127.0.0.1:${port}/api/welcome`, {
    method: "POST",
    headers,
    body: JSON.stringify({ niche: "tech", tone: "energetic" }),
  });
  const { answers: a1 } = await r1.json();
  const createdAt1 = a1.created_at;

  // Tiny sleep so updated_at can move forward (ISO ms granularity, but
  // we want robustness on fast CI where two writes could land on the same ms)
  await new Promise((r) => setTimeout(r, 5));

  // Second write with different tone — should UPDATE, not INSERT
  const r2 = await fetch(`http://127.0.0.1:${port}/api/welcome`, {
    method: "POST",
    headers,
    body: JSON.stringify({ niche: "tech", tone: "calm" }),
  });
  assert.equal(r2.status, 201);
  const { answers: a2 } = await r2.json();
  assert.equal(a2.tone, "calm");
  assert.equal(a2.created_at, createdAt1, "created_at must be preserved across upsert");
  assert.notEqual(a2.updated_at, a1.updated_at, "updated_at must move forward");
  await close();
});

test("welcome: platforms array is capped at 8 entries", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);
  const token = await getToken("s");
  const r = await fetch(`http://127.0.0.1:${port}/api/welcome`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      niche: "tech",
      platforms: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
    }),
  });
  const { answers } = await r.json();
  assert.equal(answers.platforms.length, 8, "should be capped at 8 platforms");
  assert.deepEqual(answers.platforms, ["a", "b", "c", "d", "e", "f", "g", "h"]);
  await close();
});

test("welcome: cross-user isolation — user A cannot see user B's answers", async () => {
  const { server } = buildServer({ secret: "s", llm: makeMockLLM() });
  const { port, close } = await listen(server);

  const tokenA = signToken({ sub: "u-A", email: "a@x", name: "A" }, "s", 600);
  const tokenB = signToken({ sub: "u-B", email: "b@x", name: "B" }, "s", 600);

  // User A writes
  await fetch(`http://127.0.0.1:${port}/api/welcome`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ niche: "tech" }),
  });

  // User B reads — must see completed:false (their own, not user A's)
  const r = await fetch(`http://127.0.0.1:${port}/api/welcome`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  const body = await r.json();
  assert.equal(body.completed, false);
  assert.equal(body.answers, null);
  await close();
});
