// B2+B3: Chat tools for the Studio assistant (2026-06-08).
//
// Before this module existed, the LLM only saw EDIT_TOOLS
// (cut_video, add_broll, etc.) — there were no chat-level
// tools for create_project, save_content, list_projects, or
// get_style_dna. The LLM was forced to either:
//   (a) make stuff up (e.g. claim it created a project when
//       it didn't), or
//   (b) ask the user clarifying questions in plain text.
//
// This module adds the 4 chat tools the assistant SHOULD have.
// The goal is to make tool-selection deterministic for the
// common intents the eval harness tests.
//
// Why these specific 4:
//   - create_project: backbone of the multi-project model
//   - save_content: the #1 user action ("save this idea")
//   - list_projects: needed for "what do I have?"
//   - get_style_dna: needed for "cut this for TikTok" to
//     produce a platform-tailored cut
//
// All tools accept the standard `userId` via the same ctx
// pattern as EDIT_TOOLS (see server.js#buildEditToolContext).
// The execute* functions throw on user-facing errors so the
// tool-result path surfaces the error to the LLM in the
// next turn (and the user sees a clear message).

import { randomUUID } from "node:crypto";

/**
 * @typedef {Object} ChatToolCtx
 * @property {string} userId
 * @property {object} [deps] - per-request deps (projects, pieces, styleDNA, etc.)
 */

/**
 * Tool definitions in OpenAI function-calling format.
 * These get passed to the LLM as the `tools` array.
 */
export const CHAT_TOOLS = [
  {
    type: "function",
    function: {
      name: "create_project",
      description:
        "Create a new content project (a long-running theme/pillar like " +
        "'Cooking Hacks' or 'Tech Reviews'). Call this whenever the user " +
        "wants to start something new, says 'create / make / new project' " +
        "in any language, or describes a new content idea that should " +
        "become its own project. The name is REQUIRED — if missing, " +
        "ask the user for it instead of guessing.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Short project name (e.g. 'Cooking Hacks', 'Tech Reviews'). 1-80 chars.",
          },
          niche: {
            type: "string",
            description: "Content niche (e.g. 'cooking', 'tech', 'fitness'). Optional but recommended.",
          },
          target_platforms: {
            type: "array",
            items: { type: "string", enum: ["tiktok", "youtube", "instagram_reels", "twitter", "linkedin"] },
            description: "Where the user plans to publish. Default: empty (user adds later).",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_content",
      description:
        "Save a piece of text content (script, idea, hook, outline, " +
        "transcript, note) to a project. ALWAYS call this when the user " +
        "shares text and asks to 'save / remember / запомни / запиши / " +
        "сохрани' it. If the user doesn't mention a project, use the " +
        "most recent active project. If there are no projects yet, call " +
        "create_project FIRST and then save. The text is REQUIRED — " +
        "pass the user's exact words, don't summarize.",
      parameters: {
        type: "object",
        properties: {
          project_id: {
            type: "string",
            description: "Project to save into. Use list_projects to find the right one if unsure.",
          },
          text: {
            type: "string",
            description: "The text to save. Pass the user's exact words. Up to 200KB.",
          },
          kind: {
            type: "string",
            enum: ["script", "idea", "hook", "outline", "transcript", "note"],
            description: "What kind of content this is. Default 'script'.",
          },
          title: {
            type: "string",
            description: "Optional short title for the content piece.",
          },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_projects",
      description:
        "List the user's content projects. Call this whenever the user " +
        "asks 'what projects / мои проекты / show me / list / I have'. " +
        "Returns project name, niche, platforms, and last activity.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max projects to return. Default 20.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_style_dna",
      description:
        "Retrieve the user's Style DNA (their writing style analysis: " +
        "tone, pacing, hook patterns, CTA patterns, topics). Call this " +
        "when the user asks 'my style / analyze / style DNA' or before " +
        "any cut/edit operation that should be platform-tailored.",
      parameters: {
        type: "object",
        properties: {
          project_id: {
            type: "string",
            description: "Optional — get style for a specific project. If empty, uses user's global style.",
          },
        },
      },
    },
  },
];

/**
 * Execute a chat tool by name. Throws on user-facing errors so the
 * LLM can see the error and recover (e.g. project not found → ask
 * the user which project they meant).
 *
 * @param {{name: string, args: object}} call
 * @param {ChatToolCtx} ctx
 * @returns {Promise<object>} tool result
 */
export async function executeChatToolCall(call, ctx) {
  const { name, args = {} } = call;
  if (!ctx?.deps) {
    throw new Error("chat tool called without deps (server misconfig)");
  }
  // ctx.deps comes from buildToolDeps(server.js) which exposes
  // store-backed functions (create_project, list_projects, etc).
  // We delegate to those instead of touching stores directly so
  // in-memory and Postgres paths both work.
  const { create_project, save_content, list_projects, get_style_dna } = ctx.deps;
  switch (name) {
    case "create_project":
      if (!create_project) throw new Error("create_project tool not available in this deployment");
      return await create_project({
        userId: ctx.userId,
        name: args.name,
        niche: args.niche,
        target_platforms: args.target_platforms,
      });
    case "save_content":
      if (!save_content) throw new Error("save_content tool not available in this deployment");
      return await save_content({
        userId: ctx.userId,
        project_id: args.project_id,
        text: args.text,
        kind: args.kind,
        title: args.title,
      });
    case "list_projects":
      if (!list_projects) throw new Error("list_projects tool not available in this deployment");
      return await list_projects({ userId: ctx.userId, limit: args.limit });
    case "get_style_dna":
      if (!get_style_dna) throw new Error("get_style_dna tool not available in this deployment");
      return await get_style_dna({ userId: ctx.userId, project_id: args.project_id });
    default:
      throw new Error(`Unknown chat tool: ${name}`);
  }
}
