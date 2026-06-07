// Vireo chat — client-side logic.

const STUDIO_URL = "/api/studio";
const STORAGE_KEY_TOKEN = "vireo_token";
const STORAGE_KEY_USER = "vireo_user";
const STORAGE_KEY_CONV = "vireo_active_conv";

const $ = (id) => document.getElementById(id);

function getToken() { return localStorage.getItem(STORAGE_KEY_TOKEN); }
function getUser() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY_USER) || "null"); } catch { return null; } }

async function studioFetch(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch(STUDIO_URL + path, { ...opts, headers });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { error: "bad_json", raw: text }; }
  if (!r.ok) {
    const msg = body?.message || body?.error || `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.body = body;
    throw err;
  }
  return body;
}

const state = {
  conversations: [],
  projects: [],
  activeConvId: localStorage.getItem(STORAGE_KEY_CONV) || null,
  activeProjectId: "",
  sending: false,
  lastAssistantReply: null,
};

function setStatus(text, kind = "ok") {
  $("status-text").textContent = text;
  $("status-pill").classList.toggle("bad", kind === "bad");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Lightweight, safe markdown renderer built on marked + DOMPurify.
// marked handles the parsing; DOMPurify strips <script>, on* handlers,
// javascript: URLs, and any other XSS vector before we hand the HTML
// to innerHTML. Falls back to a plain-text escape if either lib failed
// to load (e.g. offline, CSP block, ad-blocker).
function renderMarkdown(text) {
  if (text == null) return "";
  const escaped = String(text);
  if (typeof window.marked === "undefined" || typeof window.DOMPurify === "undefined") {
    // Fallback: very lite (no deps)
    let html = escapeHtml(escaped);
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
    html = html.replace(/\n\n/g, "</p><p>");
    html = "<p>" + html + "</p>";
    return html;
  }
  try {
    const raw = window.marked.parse(escaped, { gfm: true, breaks: true, headerIds: false, mangle: false });
    return window.DOMPurify.sanitize(raw, {
      ALLOWED_TAGS: ["p", "br", "strong", "em", "code", "pre", "ul", "ol", "li", "h1", "h2", "h3", "h4", "blockquote", "a", "hr", "table", "thead", "tbody", "tr", "th", "td", "input"],
      ALLOWED_ATTR: ["href", "title", "target", "rel", "type", "checked", "disabled"],
    });
  } catch (e) {
    // If parsing failed for any reason, render as plain escaped text
    return "<p>" + escapeHtml(escaped).replace(/\n/g, "<br>") + "</p>";
  }
}

// After a fresh render of an assistant message body, walk the message's
// <pre><code> blocks and ask highlight.js to colour them. Cheap, idempotent,
// and safe to call on every delta (it bails out on already-coloured blocks).
function highlightInMessage(msgEl) {
  if (!window.hljs) return;
  msgEl.querySelectorAll("pre code").forEach((el) => {
    if (el.dataset.highlighted) return;
    try {
      window.hljs.highlightElement(el);
      el.dataset.highlighted = "1";
    } catch {}
  });
}

// Derive a short conversation title from the first user message.
// Avoids "(no reply)" / "ok" / 2-char titles by requiring a minimum length
// and trimming to 50 chars on a word boundary.
function deriveTitle(userText) {
  if (!userText) return "New conversation";
  const cleaned = userText.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return "New conversation";
  if (cleaned.length <= 50) return cleaned;
  const cut = cleaned.slice(0, 50);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + "…";
}

function makeMsgEl(role, content) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.dataset.role = role;
  const avatar = role === "user" ? "🧑" : "V";
  const roleLabel = role === "user" ? "You" : "Vireo";
  div.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div class="msg-body">
      <div class="msg-role">${roleLabel}</div>
      <div class="msg-content">${renderMarkdown(content)}</div>
    </div>
  `;
  // Per-message actions: Save (assistant), Edit (user), Regenerate (last assistant).
  // Feedback thumbs are added in attachFeedbackUi() once we know the message id.
  const actions = document.createElement("div");
  actions.className = "msg-actions";
  if (role === "assistant") {
    const saveBtn = document.createElement("button");
    saveBtn.className = "msg-save-btn";
    saveBtn.type = "button";
    saveBtn.title = "Save this message to a content piece";
    saveBtn.textContent = "💾 Save";
    saveBtn.addEventListener("click", () => saveMessageAsPiece(saveBtn, content));
    actions.appendChild(saveBtn);

    const regenBtn = document.createElement("button");
    regenBtn.className = "msg-action-btn msg-regen-btn";
    regenBtn.type = "button";
    regenBtn.title = "Regenerate: resend your last message and replace this reply";
    regenBtn.textContent = "↻ Regenerate";
    regenBtn.addEventListener("click", () => regenerateLast());
    actions.appendChild(regenBtn);
  }
  if (role === "user") {
    const editBtn = document.createElement("button");
    editBtn.className = "msg-action-btn msg-edit-btn";
    editBtn.type = "button";
    editBtn.title = "Edit this message and resend";
    editBtn.textContent = "✎ Edit";
    editBtn.addEventListener("click", () => startEditMessage(div));
    actions.appendChild(editBtn);
  }
  div.appendChild(actions);
  // Feedback row (thumbs) — populated after we know the persisted message id
  const fbRow = document.createElement("div");
  fbRow.className = "msg-feedback";
  fbRow.style.display = "none";
  div.appendChild(fbRow);
  div._fbRow = fbRow;
  return div;
}

function makeTypingEl() {
  const div = document.createElement("div");
  div.className = "msg assistant";
  div.id = "typing-indicator";
  div.innerHTML = `
    <div class="msg-avatar">V</div>
    <div class="msg-body">
      <div class="msg-role">Vireo</div>
      <div class="typing"><span></span><span></span><span></span></div>
    </div>
  `;
  return div;
}

// Tool badge for a single tool call. Holds: name, args (json), result (json).
// Click toggles the detail panel.
function makeToolCard(toolName, args, result) {
  const wrap = document.createElement("div");
  wrap.className = "tool-card";
  const head = document.createElement("div");
  head.className = "tool-card-head";
  head.innerHTML = `<span class="tool-card-icon">🔧</span><span class="tool-card-name"></span><span class="tool-card-toggle">▾</span>`;
  head.querySelector(".tool-card-name").textContent = toolName;
  wrap.appendChild(head);
  const body = document.createElement("div");
  body.className = "tool-card-body";
  body.style.display = "none";
  const argSec = document.createElement("div");
  argSec.className = "tool-card-section";
  argSec.innerHTML = `<div class="tool-card-section-label">Arguments</div><pre></pre>`;
  argSec.querySelector("pre").textContent = args ? JSON.stringify(args, null, 2) : "(none)";
  body.appendChild(argSec);
  const resSec = document.createElement("div");
  resSec.className = "tool-card-section";
  resSec.innerHTML = `<div class="tool-card-section-label">Result</div><pre></pre>`;
  resSec.querySelector("pre").textContent = result !== null && result !== undefined ? JSON.stringify(result, null, 2) : "(no result)";
  body.appendChild(resSec);
  wrap.appendChild(body);
  head.addEventListener("click", () => {
    const open = body.style.display !== "none";
    body.style.display = open ? "none" : "block";
    head.querySelector(".tool-card-toggle").textContent = open ? "▾" : "▴";
    wrap.classList.toggle("open", !open);
  });
  return wrap;
}

function appendToolBadge(msgEl, toolName) {
  // Backwards-compat shim: a bare name with no args/result becomes a minimal card.
  appendToolCard(msgEl, toolName, null, null);
}

function appendToolCard(msgEl, toolName, args, result) {
  const body = msgEl.querySelector(".msg-body");
  body.appendChild(makeToolCard(toolName, args, result));
}

function scrollToBottom() {
  const m = $("messages");
  m.scrollTop = m.scrollHeight;
}

// ---- conversations sidebar ----

async function loadConversations() {
  try {
    const r = await studioFetch("/conversations");
    state.conversations = r.conversations || [];
    renderConvList();
  } catch (e) {
    if (e.status === 401) redirectToLogin();
    else setStatus("Conversations: " + e.message, "bad");
  }
}

function renderConvList() {
  const list = $("conv-list");
  if (state.conversations.length === 0) {
    list.innerHTML = '<div class="empty">No conversations yet. Send a message to start.</div>';
    return;
  }
  list.innerHTML = state.conversations.map((c) => {
    const title = c.title || "Untitled";
    const date = c.updated_at ? new Date(c.updated_at).toLocaleString() : "";
    return `<div class="conv-item ${c.id === state.activeConvId ? "active" : ""}" data-id="${c.id}">
      <div class="conv-item-title">${escapeHtml(title)}</div>
      <div class="conv-item-meta">${date}</div>
    </div>`;
  }).join("");
  list.querySelectorAll(".conv-item").forEach((el) => {
    el.addEventListener("click", () => openConversation(el.dataset.id));
  });
}

async function loadProjects() {
  try {
    const r = await studioFetch("/projects");
    state.projects = r.projects || [];
    renderProjectSelect();
  } catch (e) {
    // ignore
  }
}

function renderProjectSelect() {
  const sel = $("project-select");
  const current = state.activeProjectId;
  sel.innerHTML = '<option value="">All projects</option>' + state.projects.map((p) =>
    `<option value="${p.id}" ${p.id === current ? "selected" : ""}>${escapeHtml(p.name)}</option>`
  ).join("");
}

// ---- messages ----

async function openConversation(id) {
  state.activeConvId = id;
  localStorage.setItem(STORAGE_KEY_CONV, id);
  $("btn-delete-conv").disabled = false;
  renderConvList();
  try {
    const r = await studioFetch(`/conversations/${id}`);
    const c = r.conversation;
    const msgs = r.messages || [];
    $("chat-title").textContent = c.title || "Conversation";
    $("chat-sub").textContent = c.project_id ? `Project: ${state.projects.find((p) => p.id === c.project_id)?.name || c.project_id}` : "Free chat";
    $("messages").innerHTML = "";
    if (msgs.length === 0) {
      $("messages").innerHTML = '<div class="empty">No messages yet.</div>';
    } else {
      for (const m of msgs) {
        const el = makeMsgEl(m.role, m.content);
        $("messages").appendChild(el);
        if (m.tool_calls) {
          for (const tc of m.tool_calls) appendToolBadge(el, tc.name);
        }
      }
      state.lastAssistantReply = [...msgs].reverse().find((m) => m.role === "assistant")?.content || null;
      $("btn-save-content").disabled = !state.lastAssistantReply;
    }
    scrollToBottom();
  } catch (e) {
    setStatus("Open: " + e.message, "bad");
  }
}

async function newConversation() {
  state.activeConvId = null;
  localStorage.removeItem(STORAGE_KEY_CONV);
  $("btn-delete-conv").disabled = true;
  $("messages").innerHTML = `
    <div class="welcome">
      <h2>New conversation</h2>
      <p>Ask me to create a project, save text, analyze your style, or cut content for a platform.</p>
    </div>
  `;
  $("chat-title").textContent = "New conversation";
  $("chat-sub").textContent = "Talk to your creative director";
  $("btn-save-content").disabled = true;
  state.lastAssistantReply = null;
}

async function deleteCurrentConv() {
  if (!state.activeConvId) return;
  if (!confirm("Delete this conversation?")) return;
  try {
    await studioFetch(`/conversations/${state.activeConvId}`, { method: "DELETE" });
    await newConversation();
    await loadConversations();
    setStatus("Conversation deleted");
  } catch (e) {
    setStatus("Delete: " + e.message, "bad");
  }
}

// ---- per-message actions (regenerate, edit-resend, feedback) ----

// Track the message id of the last user message we sent. Used by Regenerate.
let lastUserMessageId = null;
let lastUserMessageText = null;
let lastAssistantMessageId = null;

// Regenerate: resend the most recent user message. The server already has
// the full history, so all we need to do is re-issue the chat call. The
// previous assistant reply stays in the conversation (so the user can
// compare) but we mark it as "stale" with a "previous version" tag.
async function regenerateLast() {
  if (state.sending) return;
  if (!state.activeConvId || !lastUserMessageText) {
    setStatus("Nothing to regenerate yet.", "warn");
    return;
  }
  const text = lastUserMessageText;
  // Mark the current last assistant reply as previous version
  const lastAssistant = [...$("messages").querySelectorAll(".msg.assistant")].pop();
  if (lastAssistant) lastAssistant.classList.add("msg-stale");
  // Send the same text again — server will append a new assistant turn
  await sendMessage(text, { skipUserAppend: true });
}

// Edit & resend: turn the user message bubble into a textarea, save/cancel.
// On save: PATCH the message on the server, rewind everything after it, then
// re-send the (now updated) text.
function startEditMessage(msgEl) {
  if (state.sending) return;
  if (msgEl.classList.contains("editing")) return;
  const contentEl = msgEl.querySelector(".msg-content");
  const oldText = contentEl.dataset.raw || contentEl.textContent;
  msgEl.classList.add("editing");
  const ta = document.createElement("textarea");
  ta.className = "msg-edit-textarea";
  ta.value = oldText;
  ta.rows = Math.max(2, Math.min(8, oldText.split("\n").length));
  const btnRow = document.createElement("div");
  btnRow.className = "msg-edit-buttons";
  const save = document.createElement("button");
  save.className = "msg-action-btn";
  save.textContent = "Save & resend";
  const cancel = document.createElement("button");
  cancel.className = "msg-action-btn";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    contentEl.innerHTML = renderMarkdown(oldText);
    msgEl.classList.remove("editing");
  });
  save.addEventListener("click", async () => {
    const newText = ta.value.trim();
    if (!newText || newText === oldText) {
      cancel.click();
      return;
    }
    const messageId = msgEl.dataset.messageId;
    if (!messageId) {
      // We don't have the id yet (probably the first message just streamed).
      // Best-effort: just re-send with the new text; the original stays.
      cancel.click();
      await sendMessage(newText);
      return;
    }
    save.disabled = true;
    cancel.disabled = true;
    try {
      await studioFetch(`/messages/${messageId}`, { method: "PATCH", body: JSON.stringify({ content: newText }) });
      await studioFetch(`/conversations/${state.activeConvId}/rewind`, { method: "POST", body: JSON.stringify({ to_message_id: messageId }) });
      // Update local bubble
      contentEl.innerHTML = renderMarkdown(newText);
      contentEl.dataset.raw = newText;
      msgEl.classList.remove("editing");
      // Remove all subsequent message DOM nodes (they got rewinded on the server)
      let cur = msgEl.nextElementSibling;
      while (cur) { const next = cur.nextElementSibling; cur.remove(); cur = next; }
      // Now re-send — server will append a new assistant turn from the edited user message
      lastUserMessageText = newText;
      await sendMessage(newText, { skipUserAppend: true });
    } catch (e) {
      save.disabled = false;
      cancel.disabled = false;
      setStatus("Edit failed: " + e.message, "bad");
    }
  });
  btnRow.appendChild(cancel);
  btnRow.appendChild(save);
  contentEl.innerHTML = "";
  contentEl.appendChild(ta);
  contentEl.appendChild(btnRow);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

// Feedback: attach thumbs up/down to an assistant message DOM element.
// messageId is the persisted id (string). rating=1 or -1, or null to clear.
function attachFeedbackUi(msgEl, messageId) {
  if (!messageId) return;
  const row = msgEl._fbRow;
  if (!row) return;
  row.innerHTML = "";
  row.style.display = "flex";
  const up = document.createElement("button");
  up.className = "msg-thumb msg-thumb-up";
  up.title = "This reply was helpful";
  up.textContent = "👍";
  const down = document.createElement("button");
  down.className = "msg-thumb msg-thumb-down";
  down.title = "This reply was not helpful";
  down.textContent = "👎";
  const send = async (rating) => {
    try {
      await studioFetch(`/messages/${messageId}/feedback`, { method: "POST", body: JSON.stringify({ rating }) });
      up.classList.toggle("active", rating === 1);
      down.classList.toggle("active", rating === -1);
    } catch (e) {
      setStatus("Feedback failed: " + e.message, "bad");
    }
  };
  up.addEventListener("click", () => send(1));
  down.addEventListener("click", () => send(-1));
  row.appendChild(up);
  row.appendChild(down);
}

// Auto-title: after the first turn, ask the server for an LLM-generated title.
// Falls back gracefully if the request fails.
async function maybeAutoTitle(firstUserText) {
  if (!state.activeConvId) return;
  try {
    const r = await studioFetch(`/conversations/${state.activeConvId}/auto-title`, { method: "POST", body: "{}" });
    if (r.title) {
      const conv = state.conversations.find((c) => c.id === state.activeConvId);
      if (conv) { conv.title = r.title; }
      $("chat-title").textContent = r.title;
      // Don't await — sidebar refresh is best-effort
      loadConversations().catch(() => {});
    }
  } catch (e) {
    // Non-fatal. The client-side deriveTitle() will run as a fallback.
  }
}

// ---- welcome interview (P1 #31) ----
// One-shot guided onboarding the first time a new user opens the chat.
// Captures niche + platforms + tone + goals, persists them, and pre-fills
// future agent context with the answers.

const WELCOME_PLATFORMS = [
  "Instagram Reels", "TikTok", "YouTube Shorts", "YouTube Long-form",
  "Twitter / X", "LinkedIn", "Telegram", "Substack", "Podcast"
];

async function maybeShowWelcome() {
  // Only show on the empty state of a brand-new user. We don't fight the
  // user: if they already have a chat going, leave them alone.
  const messagesEl = $("messages");
  if (!messagesEl || messagesEl.children.length > 0) return;
  let answers = null;
  try {
    const r = await studioFetch("/welcome", { method: "GET" });
    answers = r.answers;
  } catch (e) { return; }
  if (answers && answers.niche) return; // already done

  // Render the welcome card
  const card = document.createElement("div");
  card.className = "welcome-interview";
  card.innerHTML = `
    <h2>👋 Let's set you up</h2>
    <p>Three quick questions so every agent knows your style from the start. You can skip and change later.</p>
    <div class="welcome-step">
      <label for="wi-niche">1. What niche or topic do you create about?</label>
      <input id="wi-niche" type="text" placeholder="e.g. AI for indie hackers, plant-based cooking, ..." maxlength="200">
    </div>
    <div class="welcome-step">
      <label>2. Which platforms?</label>
      <div class="welcome-platforms" id="wi-platforms">
        ${WELCOME_PLATFORMS.map((p) => `
          <label><input type="checkbox" value="${p}"> ${p}</label>
        `).join("")}
      </div>
    </div>
    <div class="welcome-step">
      <label for="wi-tone">3. What tone should the agents default to?</label>
      <select id="wi-tone">
        <option value="">— pick one —</option>
        <option value="casual">Casual / conversational</option>
        <option value="professional">Professional / authoritative</option>
        <option value="playful">Playful / meme-y</option>
        <option value="educational">Educational / step-by-step</option>
        <option value="punchy">Punchy / hook-first</option>
      </select>
    </div>
    <div class="welcome-step">
      <label for="wi-goals">Optional: short-term goals</label>
      <textarea id="wi-goals" rows="2" placeholder="e.g. hit 10k subs by Q3, launch a $29 course" maxlength="1000"></textarea>
    </div>
    <div class="welcome-interview-actions">
      <button class="secondary" id="wi-skip">Skip</button>
      <button id="wi-save">Save & continue</button>
    </div>
  `;
  messagesEl.appendChild(card);
  setTimeout(() => $("wi-niche")?.focus(), 50);

  $("wi-skip").addEventListener("click", () => {
    // Mark as completed-without-data so we never show it again
    studioFetch("/welcome", { method: "POST", body: JSON.stringify({ niche: "unspecified", platforms: [], tone: null, goals: null }) }).catch(() => {});
    card.remove();
  });
  $("wi-save").addEventListener("click", async () => {
    const niche = $("wi-niche").value.trim();
    if (!niche) { $("wi-niche").focus(); return; }
    const platforms = [...$("wi-platforms").querySelectorAll("input:checked")].map((el) => el.value);
    const tone = $("wi-tone").value || null;
    const goals = $("wi-goals").value.trim() || null;
    $("wi-save").disabled = true;
    try {
      await studioFetch("/welcome", { method: "POST", body: JSON.stringify({ niche, platforms, tone, goals }) });
      card.remove();
      setStatus("Welcome! Agents are tuned to your style.", "ok");
    } catch (e) {
      $("wi-save").disabled = false;
      setStatus("Welcome save failed: " + e.message, "bad");
    }
  });
}

// ---- streaming send ----

// Post to /api/chat/stream and pipe SSE events back to the UI.
// Falls back to the non-streaming /api/chat endpoint if the browser
// doesn't support ReadableStream (very old browsers).
async function sendMessage(text, { skipUserAppend = false } = {}) {
  if (state.sending) return;
  if (!text.trim()) return;
  state.sending = true;
  $("btn-send").disabled = true;
  $("composer-input").value = "";

  // If we're sending a new user-visible message (not regenerating), append
  // the bubble optimistically. For Regenerate we already have a bubble and
  // just need to re-run the assistant turn.
  if (!skipUserAppend) {
    if ($("messages").querySelector(".welcome")) $("messages").innerHTML = "";
    $("messages").appendChild(makeMsgEl("user", text));
    lastUserMessageText = text;
  }

  if (typeof window.ReadableStream === "undefined" || !window.fetch) {
    return sendMessageSync(text, { skipUserAppend });
  }
  return sendMessageStreamed(text, { skipUserAppend });
}

async function sendMessageSync(text, { skipUserAppend = false } = {}) {
  const typing = makeTypingEl();
  $("messages").appendChild(typing);
  scrollToBottom();
  try {
    const body = { message: text };
    if (state.activeConvId) body.conversation_id = state.activeConvId;
    if (state.activeProjectId) body.project_id = state.activeProjectId;
    const r = await studioFetch("/chat", { method: "POST", body: JSON.stringify(body) });
    typing.remove();
    state.activeConvId = r.conversation_id;
    localStorage.setItem(STORAGE_KEY_CONV, state.activeConvId);
    const replyEl = makeMsgEl("assistant", r.reply || "(no reply)");
    $("messages").appendChild(replyEl);
    if (r.tool_calls && r.tool_calls.length > 0) {
      for (const tc of r.tool_calls) appendToolCard(replyEl, tc.name, tc.args || null, tc.result || null);
    }
    state.lastAssistantReply = r.reply;
    // First turn → ask the server for an LLM-generated title (non-blocking).
    if (!skipUserAppend) maybeAutoTitle(text);
    if (r.message_id) { replyEl.dataset.messageId = r.message_id; attachFeedbackUi(replyEl, r.message_id); }
    if (r.user_message_id && !skipUserAppend) {
      // Find the user bubble we just appended and tag it with the id
      const userEls = [...$("messages").querySelectorAll(".msg.user")];
      const last = userEls[userEls.length - 1];
      if (last) last.dataset.messageId = r.user_message_id;
      lastUserMessageId = r.user_message_id;
    }
    await loadConversations();
    setStatus(r.usage ? `${r.usage.total_tokens} tokens · $${(r.cost_usd || 0).toFixed(4)}` : "Ready");
  } catch (e) {
    typing.remove();
    $("messages").appendChild(makeMsgEl("assistant", `⚠️ ${e.message}`));
    if (e.status === 401) redirectToLogin();
    else setStatus("Send: " + e.message, "bad");
  } finally {
    state.sending = false;
    $("btn-send").disabled = false;
    $("composer-input").focus();
  }
}

async function sendMessageStreamed(text, { skipUserAppend = false } = {}) {
  const body = { message: text };
  if (state.activeConvId) body.conversation_id = state.activeConvId;
  if (state.activeProjectId) body.project_id = state.activeProjectId;

  // Create a streaming assistant message up front — empty body that
  // we'll fill in chunk-by-chunk as deltas arrive.
  const assistantEl = makeMsgEl("assistant", "");
  const contentEl = assistantEl.querySelector(".msg-content");
  $("messages").appendChild(assistantEl);
  $("messages").scrollTop = $("messages").scrollHeight;
  let buffer = "";
  let fullText = "";
  let activeStreamController = null;
  let wasFirstUserTurn = !state.activeConvId || skipUserAppend === false && !$("messages").querySelector(".msg.assistant");

  // Show a "Stop" button while streaming
  const stopBtn = document.createElement("button");
  stopBtn.className = "btn-stop";
  stopBtn.textContent = "■ Stop";
  stopBtn.addEventListener("click", () => { try { activeStreamController?.abort(); } catch {} });
  $("btn-send").insertAdjacentElement("afterend", stopBtn);

  const token = getToken();
  const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  activeStreamController = new AbortController();

  try {
    const r = await fetch(STUDIO_URL + "/chat/stream", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: activeStreamController.signal,
    });
    if (!r.ok) {
      const txt = await r.text();
      let errBody;
      try { errBody = JSON.parse(txt); } catch { errBody = { error: "http_" + r.status, message: txt.slice(0, 200) }; }
      throw new Error(errBody.message || errBody.error || `HTTP ${r.status}`);
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";
    let usage = null;
    let costUsd = 0;
    let error = null;
    let messageId = null;
    let firstDelta = true;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      // Parse SSE events
      let idx;
      while ((idx = sseBuffer.indexOf("\n\n")) !== -1) {
        const evt = sseBuffer.slice(0, idx);
        sseBuffer = sseBuffer.slice(idx + 2);
        const lines = evt.split("\n");
        let evName = "message";
        let dataLines = [];
        for (const l of lines) {
          if (l.startsWith("event: ")) evName = l.slice(7).trim();
          else if (l.startsWith("data: ")) dataLines.push(l.slice(6));
        }
        if (dataLines.length === 0) continue;
        let data;
        try { data = JSON.parse(dataLines.join("\n")); } catch { continue; }
        if (evName === "meta") {
          state.activeConvId = data.conversation_id;
          localStorage.setItem(STORAGE_KEY_CONV, state.activeConvId);
        } else if (evName === "tool") {
          // Rich tool card with full args + parsed result, not just a name badge.
          appendToolCard(assistantEl, data.name, data.args || null, data.result !== undefined ? data.result : null);
        } else if (evName === "delta") {
          fullText += data.text;
          if (firstDelta) {
            // Remove the welcome/empty state
            firstDelta = false;
          }
          contentEl.innerHTML = renderMarkdown(fullText);
          highlightInMessage(assistantEl);
          $("messages").scrollTop = $("messages").scrollHeight;
        } else if (evName === "done") {
          usage = data.usage;
          costUsd = data.cost_usd;
          error = data.error;
          messageId = data.message_id;
          // Tag the assistant DOM node + wire up feedback thumbs
          if (messageId) {
            assistantEl.dataset.messageId = messageId;
            attachFeedbackUi(assistantEl, messageId);
            lastAssistantMessageId = messageId;
          }
          // Tag the user DOM node so Edit & resend can find the persisted id
          if (data.user_message_id) {
            lastUserMessageId = data.user_message_id;
            const userEls = [...$("messages").querySelectorAll(".msg.user")];
            const last = userEls[userEls.length - 1];
            if (last && !last.dataset.messageId) last.dataset.messageId = data.user_message_id;
          }
          // First turn of a new conversation → ask server for an LLM title
          if (wasFirstUserTurn) maybeAutoTitle(text);
        } else if (evName === "error") {
          error = data.error || "stream_error";
        }
      }
    }

    if (error && !fullText) {
      contentEl.innerHTML = renderMarkdown(`⚠️ ${error}`);
    }
    state.lastAssistantReply = fullText;
    state.activeConvId = state.activeConvId || (usage && null);
    await loadConversations();
    setStatus(usage ? `${usage.total_tokens} tokens · $${(costUsd || 0).toFixed(4)}` : "Ready");
  } catch (e) {
    if (e.name === "AbortError") {
      // User clicked Stop — keep what was streamed, mark as stopped
      contentEl.innerHTML = renderMarkdown(fullText + (fullText ? "\n\n_[stopped by user]_" : ""));
    } else {
      contentEl.innerHTML = renderMarkdown(`⚠️ ${e.message}`);
      if (e.status === 401) redirectToLogin();
      else setStatus("Stream: " + e.message, "bad");
    }
  } finally {
    stopBtn.remove();
    state.sending = false;
    $("btn-send").disabled = false;
    $("composer-input").focus();
  }
}

async function saveMessageAsPiece(btn, text) {
  if (!text || !text.trim()) {
    btn.textContent = "⚠️ empty";
    setTimeout(() => { btn.textContent = "💾 Save"; }, 1500);
    return;
  }
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const body = { text: text.trim(), kind: "note", source: "chat" };
    if (state.activeProjectId) body.project_id = state.activeProjectId;
    const r = await studioFetch("/content-pieces", { method: "POST", body: JSON.stringify(body) });
    btn.textContent = "✓ Saved";
    setStatus(`Saved as content piece ${r.piece.id.slice(0, 8)}…`);
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 2000);
  } catch (e) {
    btn.textContent = "✗ Failed";
    setStatus("Save: " + e.message, "bad");
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 2000);
  }
}

// Legacy header-level "Save" — still wired for backwards compat with the
// chat.html button, but the per-message "💾 Save" buttons are preferred.
async function saveLastReply() {
  if (!state.lastAssistantReply) return;
  await saveMessageAsPiece($("btn-save-content"), state.lastAssistantReply);
}

function redirectToLogin() {
  localStorage.removeItem(STORAGE_KEY_TOKEN);
  localStorage.removeItem(STORAGE_KEY_USER);
  location.href = "/login.html";
}

// ---- bind events ----

function bind() {
  $("btn-send").addEventListener("click", () => sendMessage($("composer-input").value));
  $("composer-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage($("composer-input").value);
    }
  });
  $("composer-input").addEventListener("input", (e) => {
    e.target.style.height = "auto";
    e.target.style.height = Math.min(200, e.target.scrollHeight) + "px";
  });
  $("btn-new-conv").addEventListener("click", newConversation);
  $("btn-delete-conv").addEventListener("click", deleteCurrentConv);
  $("btn-save-content").addEventListener("click", saveLastReply);
  $("project-select").addEventListener("change", (e) => { state.activeProjectId = e.target.value; });

  document.querySelectorAll(".suggestion").forEach((b) => {
    b.addEventListener("click", () => sendMessage(b.textContent));
  });
}

// ---- init ----

(async function init() {
  if (!getToken()) { redirectToLogin(); return; }
  bind();
  await Promise.all([loadProjects(), loadConversations()]);
  if (state.activeConvId) {
    try { await openConversation(state.activeConvId); }
    catch { state.activeConvId = null; }
  }
  // First-time-user welcome interview. Only renders if there are no
  // existing messages on screen and the user hasn't filled it in yet.
  maybeShowWelcome().catch(() => {});
})();
