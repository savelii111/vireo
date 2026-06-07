// Vireo LLM client (Node).
//
// Tiny, dependency-free wrapper around OpenAI's Chat Completions API.
// Supports:
//   - tool calling (function calling)
//   - automatic retry on 429/5xx
//   - token + cost tracking
//   - deterministic mock when OPENAI_API_KEY is missing
//
// Used by the Studio agent for /api/chat.

const PRICING = {
  "gpt-4o-mini":   { input: 0.00015, output: 0.0006 },
  "gpt-4o":        { input: 0.0025,  output: 0.01 },
  "gpt-4-turbo":   { input: 0.01,    output: 0.03 },
  "gpt-3.5-turbo": { input: 0.0005,  output: 0.0015 },
};

function approxTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export class LLMError extends Error {
  constructor(message, code) { super(message); this.name = "LLMError"; this.code = code; }
}

export class LLMClient {
  constructor({ apiKey, model = "gpt-4o-mini", baseUrl = "https://api.openai.com/v1", maxRetries = 2, fetchImpl, timeoutMs = 60_000, maxRetryAfterMs = 60_000 } = {}) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || "";
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.maxRetries = maxRetries;
    this.fetchImpl = fetchImpl || globalThis.fetch;
    this.timeoutMs = timeoutMs;
    this.maxRetryAfterMs = maxRetryAfterMs;
    this.usage = { input_tokens: 0, output_tokens: 0, request_count: 0, error_count: 0, retry_count: 0, total_cost_usd: 0 };
  }

  isMock() { return !this.apiKey; }

  costUsd(model, input, output) {
    const p = PRICING[model];
    if (!p) return 0;
    return input * p.input + output * p.output;
  }

  /**
   * Chat completion. Returns { content, tool_calls, usage }.
   * @param {object} opts
   * @param {string} opts.system
   * @param {Array}  opts.messages  - [{role, content, tool_call_id?, name?, tool_calls?}]
   * @param {Array}  opts.tools     - OpenAI tool schemas
   * @param {string} opts.toolChoice - "auto" | "none" | "required" | {type:"function", function:{name}}
   * @param {number} opts.temperature
   * @param {number} opts.maxTokens
   */
  async chat({ system, messages = [], tools = null, toolChoice = "auto", temperature = 0.7, maxTokens = 1024 } = {}) {
    if (this.isMock()) return this._mockChat({ system, messages, tools });

    const body = { model: this.model, messages: this._buildMessages(system, messages), temperature, max_tokens: maxTokens };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = toolChoice;
    }

    let lastErr;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const r = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        clearTimeout(t);
        if (r.status === 429 || r.status >= 500) {
          this.usage.retry_count++;
          if (attempt < this.maxRetries) {
            // Respect Retry-After on 429. OpenAI sends seconds; the RFC
            // also allows an HTTP-date, but real-world LLM providers use
            // seconds only, so we parse that and cap at 60s to avoid
            // being held hostage by a bad header. For 5xx (or 429 with
            // a missing/garbage header) we fall back to exponential
            // backoff. Without this we were hammering rate-limited APIs
            // every 500ms instead of waiting the requested second count.
            let wait;
            const ra = r.headers?.get?.("retry-after");
            if (r.status === 429 && ra) {
              const secs = Number(ra);
              // Cap is configurable so tests can verify the behaviour with
              // a 1s cap instead of waiting 60s of real time. Default 60s
              // matches what a polite upstream would ever ask for.
              wait = Number.isFinite(secs) && secs > 0
                ? Math.min(secs * 1000, this.maxRetryAfterMs)
                : 500 * Math.pow(2, attempt);
            } else {
              wait = 500 * Math.pow(2, attempt);
            }
            await new Promise((res) => setTimeout(res, wait));
            continue;
          }
        }
        if (!r.ok) {
          const errText = await r.text();
          this.usage.error_count++;
          throw new LLMError(`OpenAI ${r.status}: ${errText.slice(0, 300)}`, `http_${r.status}`);
        }
        const data = await r.json();
        const msg = data.choices?.[0]?.message || {};
        const inTok = data.usage?.prompt_tokens || 0;
        const outTok = data.usage?.completion_tokens || 0;
        this.usage.input_tokens += inTok;
        this.usage.output_tokens += outTok;
        this.usage.request_count++;
        this.usage.total_cost_usd += this.costUsd(this.model, inTok, outTok);
        return {
          content: msg.content || "",
          tool_calls: msg.tool_calls || null,
          usage: { input_tokens: inTok, output_tokens: outTok, total_tokens: inTok + outTok },
        };
      } catch (e) {
        clearTimeout(t);
        lastErr = e;
        if (e.name === "AbortError") {
          this.usage.error_count++;
          throw new LLMError("LLM request timed out", "timeout");
        }
        if (e instanceof LLMError) throw e;
        this.usage.error_count++;
        if (attempt < this.maxRetries) {
          this.usage.retry_count++;
          const wait = 500 * Math.pow(2, attempt);
          await new Promise((res) => setTimeout(res, wait));
          continue;
        }
        throw new LLMError(e.message || "LLM request failed", "network");
      }
    }
    throw lastErr || new LLMError("LLM request failed after retries", "unknown");
  }

  /**
   * Streaming chat completion. Yields text deltas as they arrive.
   * On the final delta, returns usage + cost.
   * Falls back to yielding the full response as a single chunk in mock mode.
   *
   * @param {object} opts (same as chat())
   * @returns {AsyncGenerator<{delta: string, finish_reason?: string, usage?: object}>}
   */
  async *streamChat(opts) {
    const { system, messages = [], tools = null, toolChoice = "auto", temperature = 0.7, maxTokens = 1024, signal = null } = opts;
    if (this.isMock()) {
      const r = await this._mockChat(opts);
      yield { delta: r.content || "", finish_reason: "stop", usage: r.usage };
      return;
    }
    const body = { model: this.model, messages: this._buildMessages(system, messages), temperature, max_tokens: maxTokens, stream: true, stream_options: { include_usage: true } };
    if (tools && tools.length > 0) { body.tools = tools; body.tool_choice = toolChoice; }

    // Combine the caller's external signal (from P0-2 AbortController) with
    // our internal timeout. Whichever fires first cancels the fetch.
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let r;
    try {
      r = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(t);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (e.name === "AbortError") throw new LLMError("LLM stream aborted", "aborted");
      throw new LLMError(e.message, "network");
    }
    if (!r.ok) {
      clearTimeout(t);
      if (signal) signal.removeEventListener("abort", onAbort);
      const errText = await r.text();
      throw new LLMError(`OpenAI ${r.status}: ${errText.slice(0, 300)}`, `http_${r.status}`);
    }
    if (!r.body || !r.body.getReader) {
      clearTimeout(t);
      if (signal) signal.removeEventListener("abort", onAbort);
      throw new LLMError("Streaming not supported in this environment", "no_stream");
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    let streamFinished = false;
    let externalAbort = false;
    try {
      while (true) {
        if (signal?.aborted) { externalAbort = true; break; }
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE: events separated by \n\n, each line starts with "data: "
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const evt = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLines = evt.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
          if (dataLines.length === 0) continue;
          const data = dataLines.join("\n");
          if (data === "[DONE]") { streamFinished = true; break; }
          let parsed;
          try { parsed = JSON.parse(data); } catch { continue; }
          // Streamed usage
          if (parsed.usage) {
            usage = { input_tokens: parsed.usage.prompt_tokens || 0, output_tokens: parsed.usage.completion_tokens || 0, total_tokens: parsed.usage.total_tokens || 0 };
            continue;
          }
          const choice = parsed.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta?.content || "";
          if (delta) {
            // Don't bump output_tokens here — the `finally` block at the
            // bottom of this method increments from the authoritative
            // `parsed.usage` chunk that OpenAI sends in the trailing SSE
            // event. Counting per-delta and again from usage was a real
            // double-count that inflated streaming cost dashboards by
            // roughly N_chunks per request.
            yield { delta, finish_reason: choice.finish_reason || null };
          } else if (choice.finish_reason) {
            yield { delta: "", finish_reason: choice.finish_reason };
          }
        }
        if (streamFinished) break;
      }
    } finally {
      clearTimeout(t);
      if (signal) signal.removeEventListener("abort", onAbort);
      try { reader.releaseLock(); } catch {}
      // Always record usage so a [DONE] early-out (or stream error) still
      // gets accounted. This was the silent cost-tracking bug: previously
      // the [DONE] branch returned before the usage block ran.
      // But don't double-count on external abort: the user paid for nothing
      // if they cancelled before any usage chunk arrived.
      if (!externalAbort) {
        this.usage.input_tokens += usage.input_tokens;
        this.usage.output_tokens += usage.output_tokens;
        this.usage.request_count++;
        this.usage.total_cost_usd += this.costUsd(this.model, usage.input_tokens, usage.output_tokens);
      }
    }
  }

  _buildMessages(system, messages) {
    const out = [];
    if (system) out.push({ role: "system", content: system });
    for (const m of messages) {
      const o = { role: m.role };
      if (m.content != null) o.content = m.content;
      if (m.tool_calls) o.tool_calls = m.tool_calls;
      if (m.tool_call_id) o.tool_call_id = m.tool_call_id;
      if (m.name) o.name = m.name;
      out.push(o);
    }
    return out;
  }

  /**
   * Deterministic mock used when no API key is set. Routes user messages
   * to the right tool, and produces a short summary after tool results
   * — enough to drive the chat UX offline.
   */
  async _mockChat({ system, messages, tools }) {
    this.usage.request_count++;
    const last = messages[messages.length - 1];

    // If we just got a tool result, summarize what happened.
    if (last?.role === "tool") {
      let summary = "Done!";
      try {
        const result = JSON.parse(last.content || "{}");
        if (result.ok === false) {
          summary = `I ran into an issue: ${result.error || result.message || "tool failed"}. Want me to try a different approach?`;
        } else if (result.project?.name) {
          summary = `Created project "${result.project.name}" (id: ${result.project.id}). What next?`;
        } else if (result.piece?.id) {
          summary = `Saved content piece ${result.piece.id.slice(0, 12)}… Want me to analyze your style or cut it for a platform?`;
        } else if (result.style_dna) {
          const conf = Math.round((result.style_dna.confidence || 0) * 100);
          summary = `Analyzed your style — tone: ${result.style_dna.tone}, pacing: ${result.style_dna.pacing}. Confidence: ${conf}%. (Mock mode — wire OPENAI_API_KEY for deeper analysis.)`;
        } else if (result.edit_plan) {
          summary = `Cut your content to ${result.edit_plan.output_duration_sec}s with ${result.edit_plan.cuts?.length || 0} segments. Ready to distribute?`;
        } else if (result.jobs) {
          summary = `Scheduled ${result.jobs.length} jobs across platforms. Want to check status?`;
        } else if (Array.isArray(result.projects)) {
          summary = result.projects.length === 0
            ? "You don't have any projects yet. Want me to create one?"
            : `You have ${result.projects.length} project(s): ${result.projects.map(p => `"${p.name}"`).join(", ")}.`;
        }
      } catch { /* keep default */ }
      const inTok = approxTokens(system) + approxTokens(JSON.stringify(messages).slice(-200));
      const outTok = Math.ceil(summary.length / 4);
      this.usage.input_tokens += inTok;
      this.usage.output_tokens += outTok;
      this.usage.total_cost_usd += this.costUsd(this.model, inTok, outTok);
      return { content: summary, tool_calls: null, usage: { input_tokens: inTok, output_tokens: outTok, total_tokens: inTok + outTok } };
    }

    // First call from user — decide if a tool should fire.
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const text = lastUser?.content || "";
    const lower = text.toLowerCase();
    let reply = "I'm running in mock mode (no OPENAI_API_KEY set). I can still help you explore Vireo. Try asking me to create a project, save a piece of text, or check your style DNA.";
    let toolCalls = null;

    if (/create.*project|new project|start a project/.test(lower) && tools?.some((t) => t.function.name === "create_project")) {
      const name = text.match(/project (?:called|named)?\s*["“']?([\w\s-]+)["”']?/i)?.[1]?.trim() || "Untitled Project";
      toolCalls = [{
        id: `call_mock_${Date.now()}`,
        type: "function",
        function: { name: "create_project", arguments: JSON.stringify({ name, niche: "general" }) },
      }];
      reply = `Creating project "${name}"…`;
    } else if (/(show|list).*(project|projects)|my projects/.test(lower) && tools?.some((t) => t.function.name === "list_projects")) {
      toolCalls = [{
        id: `call_mock_${Date.now()}`,
        type: "function",
        function: { name: "list_projects", arguments: JSON.stringify({ limit: 20 }) },
      }];
      reply = "Looking up your projects…";
    } else if (/(save|add|store)\b/.test(lower) && /(text|piece|script|content|note)/.test(lower) && tools?.some((t) => t.function.name === "save_content")) {
      const quoted = text.match(/["“']([^"”']{8,})["”']/);
      const textToSave = (quoted ? quoted[1] : text.replace(/^.*?(save|add|store)\s*/i, "").trim()).slice(0, 500);
      if (textToSave.length >= 4) {
        toolCalls = [{
          id: `call_mock_${Date.now()}`,
          type: "function",
          function: { name: "save_content", arguments: JSON.stringify({ text: textToSave, kind: "script" }) },
        }];
        reply = "Saving that text…";
      } else {
        reply = "What would you like me to save? Please share the text (in quotes is fine).";
      }
    } else if (/(analyze|build|create).*(style|dna)|my style|writing style/.test(lower) && tools?.some((t) => t.function.name === "analyze_style")) {
      toolCalls = [{
        id: `call_mock_${Date.now()}`,
        type: "function",
        function: { name: "analyze_style", arguments: JSON.stringify({}) },
      }];
      reply = "Analyzing your writing style…";
    } else if (/(get|show|my).*(style|dna)/.test(lower) && tools?.some((t) => t.function.name === "get_style_dna")) {
      toolCalls = [{
        id: `call_mock_${Date.now()}`,
        type: "function",
        function: { name: "get_style_dna", arguments: JSON.stringify({}) },
      }];
      reply = "Fetching your Style DNA…";
    } else if (/(cut|edit|shorten|condense|trim)/.test(lower) && /(second|sec|tiktok|reel|short)/.test(lower) && tools?.some((t) => t.function.name === "edit_content")) {
      const target = text.match(/(\d+)\s*(?:sec|second)/i)?.[1] || "30";
      const quoted = text.match(/[:\s"]([^"”':]{30,})/);
      const txt = (quoted ? quoted[1] : text).slice(0, 1000);
      toolCalls = [{
        id: `call_mock_${Date.now()}`,
        type: "function",
        function: { name: "edit_content", arguments: JSON.stringify({ text: txt, target_sec: Number(target) }) },
      }];
      reply = `Cutting your text to ${target}s…`;
    } else if (/distribute|publish|schedule/.test(lower) && tools?.some((t) => t.function.name === "distribute")) {
      toolCalls = [{
        id: `call_mock_${Date.now()}`,
        type: "function",
        function: { name: "distribute", arguments: JSON.stringify({ edit_plan: { cuts: [], output_duration_sec: 30, source_id: "mock" }, platforms: ["tiktok", "youtube_shorts"] }) },
      }];
      reply = "Scheduling your clip…";
    } else if (/style dna|writing style|my style/.test(lower)) {
      reply = "To analyze your style, save at least 2-3 writing samples to a project, then ask me to analyze. (Mock mode — wire OPENAI_API_KEY for real analysis.)";
    } else if (/save|add|store/.test(lower) && /text|piece|script|content/.test(lower)) {
      reply = "Use the save_content tool with { project_id, text, source: 'manual' } to save. (Mock mode.)";
    }
    const inTok = approxTokens(system) + approxTokens(text);
    const outTok = Math.ceil(reply.length / 4);
    this.usage.input_tokens += inTok;
    this.usage.output_tokens += outTok;
    this.usage.total_cost_usd += this.costUsd(this.model, inTok, outTok);
    return { content: reply, tool_calls: toolCalls, usage: { input_tokens: inTok, output_tokens: outTok, total_tokens: inTok + outTok } };
  }

  getUsage() { return { ...this.usage }; }
}
