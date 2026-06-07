// End-to-end test of the studio agent — full user flow.
//
// Simulates a creator going through the entire app:
//   1. Build in-process server with mock LLM
//   2. Create a project
//   3. Save 2 content pieces (analyze requires >= 2)
//   4. Analyze style (style-learner unreachable → derived DNA)
//   5. Chat: tool-calling LLM creates a new project via chat
//   6. Multi-turn chat: history grows
//   7. Other user cannot see Alice's data
//   8. Delete the project
//
// Auth uses a real JWT signed with the same secret the server uses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../agents/studio/src/server.js";
import { signToken } from "../packages/auth-middleware/index.js";

const SECRET = "***";

function mockLLM(toolPlan = []) {
  return {
    model: "mock",
    isMock: () => true,
    costUsd: () => 0,
    chat: async ({ messages }) => {
      const last = messages[messages.length - 1];
      if (last?.role === "tool") {
        return { content: "Done! \u2705", tool_calls: null, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
      }
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const text = (lastUser?.content || "").toLowerCase();
      for (const plan of toolPlan) {
        if (plan.match.test(text)) {
          return {
            content: "",
            tool_calls: [{ id: `call_${Date.now()}`, type: "function", function: { name: plan.tool, arguments: JSON.stringify(plan.args) } }],
            usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
          };
        }
      }
      return { content: `I heard: "${lastUser?.content || ""}"`, tool_calls: null, usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 } };
    },
    getUsage: () => ({}),
  };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

function authHeader(userId) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${signToken({ sub: userId, email: `${userId}@x.com` }, SECRET, 600)}` };
}

test("E2E: full creator flow", async () => {
  // 1. Build server (in-memory) and start it
  const { server } = buildServer({ secret: SECRET, llm: mockLLM() });
  const { port, close } = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  const alice = authHeader("alice");

  // Style URL is intentionally unreachable — server must fall back to derived DNA.
  const prevStyleUrl = process.env.VIREO_STYLE_URL;
  process.env.VIREO_STYLE_URL = "http://127.0.0.1:1";

  try {
    // 2. Create a project
    const pRes = await fetch(`${base}/api/projects`, {
      method: "POST", headers: alice,
      body: JSON.stringify({ name: "Alice's Tech Channel", niche: "tech", target_platforms: ["youtube", "tiktok"] }),
    });
    assert.equal(pRes.status, 201, `create project: ${pRes.status} ${await pRes.clone().text()}`);
    const { project } = await pRes.json();
    assert.equal(project.name, "Alice's Tech Channel");

    // 3. Save TWO content pieces (analyze requires >= 2 for meaningful DNA)
    const pieceTexts = [
      "Stop scrolling! AI just changed everything. Here are 3 things creators need to know in 2026.",
      "Most people use AI wrong. They ask it to write. I ask it to think. The difference is everything.",
    ];
    for (const text of pieceTexts) {
      const cRes = await fetch(`${base}/api/content-pieces`, {
        method: "POST", headers: alice,
        body: JSON.stringify({ project_id: project.id, text, kind: "script" }),
      });
      assert.equal(cRes.status, 201, `create piece: ${cRes.status} ${await cRes.clone().text()}`);
    }

    // 4. List content
    const lRes = await fetch(`${base}/api/content-pieces?project_id=${project.id}`, { headers: alice });
    const { pieces } = await lRes.json();
    assert.equal(pieces.length, 2);

    // 5. Analyze style (style-learner unreachable → derived DNA)
    const aRes = await fetch(`${base}/api/style-dna/analyze`, {
      method: "POST", headers: alice,
      body: JSON.stringify({ project_id: project.id }),
    });
    assert.equal(aRes.status, 200, `analyze: ${aRes.status} ${await aRes.clone().text()}`);
    const aBody = await aRes.json();
    assert.ok(aBody.style_dna, "style_dna should be present");
    assert.ok(["energetic", "casual", "verbose"].includes(aBody.style_dna.tone), `unexpected tone: ${aBody.style_dna.tone}`);

    // 6. Style DNA is linked to the project
    const p2Res = await fetch(`${base}/api/projects/${project.id}`, { headers: alice });
    const { project: p2 } = await p2Res.json();
    assert.equal(p2.style_dna_id, aBody.style_dna.id);

    // 7. Chat — tool-calling LLM creates a new project via chat
    // We use a SECOND server (different LLM), but on the same storage/auth code.
    const toolLLM = mockLLM([{ match: /create.*project.*demo/i, tool: "create_project", args: { name: "Demo Project From Chat" } }]);
    const { server: server2 } = buildServer({ secret: SECRET, llm: toolLLM });
    const { port: port2, close: close2 } = await listen(server2);
    try {
      const chatRes = await fetch(`http://127.0.0.1:${port2}/api/chat`, {
        method: "POST", headers: alice,
        body: JSON.stringify({ message: "create a project called Demo Project From Chat" }),
      });
      assert.equal(chatRes.status, 200, `chat: ${chatRes.status} ${await chatRes.clone().text()}`);
      const chatBody = await chatRes.json();
      assert.ok(chatBody.tool_calls, "tool_calls should be present");
      assert.equal(chatBody.tool_calls[0].name, "create_project");

      // The new project should be visible to Alice
      const p3Res = await fetch(`http://127.0.0.1:${port2}/api/projects`, { headers: alice });
      const { projects } = await p3Res.json();
      assert.ok(projects.find((p) => p.name === "Demo Project From Chat"), "new project not visible");
    } finally {
      await close2();
    }

    // 8. Multi-turn chat: continue the same conversation
    const c1Res = await fetch(`${base}/api/chat`, { method: "POST", headers: alice, body: JSON.stringify({ message: "thanks!" }) });
    assert.equal(c1Res.status, 200, `chat1: ${c1Res.status} ${await c1Res.clone().text()}`);
    const c1 = await c1Res.json();
    const convId = c1.conversation_id;
    const c2Res = await fetch(`${base}/api/chat`, { method: "POST", headers: alice, body: JSON.stringify({ message: "what can you do?", conversation_id: convId }) });
    assert.equal(c2Res.status, 200, `chat2: ${c2Res.status} ${await c2Res.clone().text()}`);
    const c2 = await c2Res.json();
    assert.equal(c2.conversation_id, convId);
    // History grows (user, assistant, user, assistant)
    const convRes = await fetch(`${base}/api/conversations/${convId}`, { headers: alice });
    const conv = await convRes.json();
    assert.ok(conv.messages.length >= 4, `history too short: ${conv.messages.length}`);

    // 9. Other user cannot see Alice's data
    const bob = authHeader("bob");
    const bobProjects = await (await fetch(`${base}/api/projects`, { headers: bob })).json();
    assert.equal(bobProjects.projects.length, 0);
    const bobPieces = await (await fetch(`${base}/api/content-pieces`, { headers: bob })).json();
    assert.equal(bobPieces.pieces.length, 0);
    const aliceProjectRes = await fetch(`${base}/api/projects/${project.id}`, { headers: bob });
    assert.equal(aliceProjectRes.status, 404);

    // 10. Delete the project
    const delRes = await fetch(`${base}/api/projects/${project.id}`, { method: "DELETE", headers: alice });
    assert.equal(delRes.status, 200);
    const after = await fetch(`${base}/api/projects/${project.id}`, { headers: alice });
    assert.equal(after.status, 404);
  } finally {
    // Restore env so other tests aren't affected
    if (prevStyleUrl === undefined) delete process.env.VIREO_STYLE_URL;
    else process.env.VIREO_STYLE_URL = prevStyleUrl;
    await close();
  }
});
