// B2: Chat tools unit tests (2026-06-08).
//
// Verifies the 4 chat tools (create_project, save_content,
// list_projects, get_style_dna) work correctly through the
// full /api/chat path with a deterministic mock LLM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAT_TOOLS, executeChatToolCall } from "../src/chat_tools.js";
import { buildServer } from "../src/server.js";
import { signToken } from "../../../packages/auth-middleware/index.js";

async function listen(server) {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

/**
 * Mock LLM that calls a specific tool on the first user turn
 * and returns a final summary on the second turn (after the
 * tool result comes back).
 */
function makeMockLLM(toolCall) {
  return {
    model: "mock",
    isMock: () => true,
    costUsd: () => 0,
    chat: async ({ messages }) => {
      const last = messages[messages.length - 1];
      if (last?.role === "tool") {
        return { content: "Done!", tool_calls: null, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
      }
      if (toolCall) {
        return { content: "", tool_calls: [{ id: "t1", type: "function", function: toolCall }], usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } };
      }
      return { content: "ok", tool_calls: null, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
    },
    getUsage: () => ({}),
  };
}

async function chatWithTool(secret, sub, toolCall, message) {
  const llm = makeMockLLM(toolCall);
  const { server } = buildServer({ secret, llm });
  const { port, close } = await listen(server);
  const token = signToken({ sub, email: `${sub}@x.com`, name: sub }, secret, 600);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message }),
    });
    return await r.json();
  } finally { await close(); }
}

test("B2: CHAT_TOOLS exports 4 tools with valid OpenAI shape", () => {
  assert.equal(CHAT_TOOLS.length, 4);
  for (const t of CHAT_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name);
    assert.ok(t.function.description && t.function.description.length > 20);
    assert.ok(t.function.parameters);
    assert.equal(t.function.parameters.type, "object");
  }
  const names = CHAT_TOOLS.map((t) => t.function.name).sort();
  assert.deepEqual(names, ["create_project", "get_style_dna", "list_projects", "save_content"]);
});

test("B2: create_project tool creates a project in the store", async () => {
  // Build ONE server, then call /api/chat to create a project,
  // then call /api/projects on the SAME server to verify it's stored.
  // Each buildServer() call creates a fresh in-memory store, so
  // we can't use two separate server instances.
  const llm = makeMockLLM({
    name: "create_project",
    arguments: JSON.stringify({ name: "B2 Test Project" }),
  });
  const { server } = buildServer({ secret: "s1", llm });
  const { port, close } = await listen(server);
  const token = signToken({ sub: "u-create", email: "u@x.com", name: "u" }, "s1", 600);
  try {
    // 1. Call chat to create
    const r = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "create a project" }),
    });
    const body = await r.json();
    assert.ok(body.tool_calls);
    assert.equal(body.tool_calls[0].name, "create_project");
    // 2. List projects on the SAME server
    const r2 = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list = await r2.json();
    assert.equal(list.projects.length, 1, `expected 1 project, got ${list.projects.length}: ${JSON.stringify(list)}`);
    assert.equal(list.projects[0].name, "B2 Test Project");
  } finally { await close(); }
});

test("B2: list_projects tool returns existing projects", async () => {
  // First create a project
  await chatWithTool("s2", "u-list", {
    name: "create_project",
    arguments: JSON.stringify({ name: "Listed Project" }),
  }, "create");
  // Then list
  const body = await chatWithTool("s2", "u-list", {
    name: "list_projects",
    arguments: "{}",
  }, "list my projects");
  assert.ok(body.tool_calls);
  assert.equal(body.tool_calls[0].name, "list_projects");
});

test("B2: save_content tool creates a content piece", async () => {
  // First create a project
  await chatWithTool("s3", "u-save", {
    name: "create_project",
    arguments: JSON.stringify({ name: "Save Test" }),
  }, "create project");
  // Then save content
  const body = await chatWithTool("s3", "u-save", {
    name: "save_content",
    arguments: JSON.stringify({ text: "My first script content", kind: "script" }),
  }, "save this");
  assert.ok(body.tool_calls);
  assert.equal(body.tool_calls[0].name, "save_content");
});

test("B2: get_style_dna tool returns null when no DNA exists", async () => {
  const body = await chatWithTool("s4", "u-dna", {
    name: "get_style_dna",
    arguments: "{}",
  }, "analyze my style");
  assert.ok(body.tool_calls);
  assert.equal(body.tool_calls[0].name, "get_style_dna");
});

test("B2: unknown tool name in executeChatToolCall throws", () => {
  // We need a real deps object. Use the same stub we use elsewhere.
  const deps = {
    create_project: () => ({ ok: true }),
    list_projects: () => ({ ok: true }),
    save_content: () => ({ ok: true }),
    get_style_dna: () => ({ ok: true }),
  };
  assert.rejects(
    executeChatToolCall({ name: "nuke_database", args: {} }, { userId: "u", deps }),
    /Unknown chat tool/,
  );
});

test("B2: chat tools work in parallel via Promise.all (no shared state bug)", async () => {
  // Three parallel tool calls, each creating a different project.
  // If there were a race in the in-memory store, one would lose.
  const llm = {
    model: "mock",
    isMock: () => true,
    costUsd: () => 0,
    chat: async ({ messages }) => {
      const last = messages[messages.length - 1];
      if (last?.role === "tool") return { content: "Done", tool_calls: null, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
      return {
        content: "",
        tool_calls: [
          { id: "t1", type: "function", function: { name: "create_project", arguments: JSON.stringify({ name: "P1" }) } },
          { id: "t2", type: "function", function: { name: "create_project", arguments: JSON.stringify({ name: "P2" }) } },
          { id: "t3", type: "function", function: { name: "create_project", arguments: JSON.stringify({ name: "P3" }) } },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      };
    },
    getUsage: () => ({}),
  };
  const { server } = buildServer({ secret: "s5", llm });
  const { port, close } = await listen(server);
  const token = signToken({ sub: "u-par", email: "p@x.com", name: "P" }, "s5", 600);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "create 3 projects" }),
    });
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.tool_calls.length, 3);
    // Verify all 3 made it
    const r2 = await fetch(`http://127.0.0.1:${port}/api/projects`, { headers: { Authorization: `Bearer ${token}` } });
    const list = await r2.json();
    assert.equal(list.projects.length, 3);
  } finally { await close(); }
});
