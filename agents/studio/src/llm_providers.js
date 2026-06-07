// Vireo LLM providers (Node).
//
// Multi-provider support: OpenAI, Anthropic, Gemini, Ollama, Groq,
// Mistral, DeepSeek, OpenRouter — all via a unified createLLMClient() factory.
//
// OpenAI-compatible providers (Ollama, Groq, Mistral, DeepSeek, OpenRouter)
// reuse the existing LLMClient with just a different baseUrl + model.
//
// Anthropic and Gemini use provider-specific API formats, handled by
// dedicated subclasses that expose the same .chat() / .streamChat() interface.

import { LLMClient, LLMError } from "./llm_client.js";

// ─── Provider configs ─────────────────────────────────────────────
// baseUrl: Chat Completions-compatible endpoint (most providers)
// apiKeyEnv: env var name that holds the API key
// defaultModel: recommended model for each provider
const OPENAI_COMPATIBLE = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
  },
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    apiKeyEnv: "OLLAMA_API_KEY",
    defaultModel: "llama3.1",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    defaultModel: "llama-3.1-70b-versatile",
  },
  mistral: {
    baseUrl: "https://api.mistral.ai/v1",
    apiKeyEnv: "MISTRAL_API_KEY",
    defaultModel: "mistral-small-latest",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-chat",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    defaultModel: "anthropic/claude-3-haiku",
  },
  lmstudio: {
    baseUrl: "http://localhost:1234/v1",
    apiKeyEnv: "",
    defaultModel: "",
  },
};

// ─── Anthropic client (Messages API) ─────────────────────────────
class AnthropicClient extends LLMClient {
  constructor({ apiKey, model = "claude-sonnet-4-20250514", ...rest } = {}) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY || "";
    super({ apiKey: "placeholder", baseUrl: "https://api.anthropic.com", model, ...rest });
    this.apiKey = key;
    this.baseUrl = "https://api.anthropic.com";
  }

  isMock() { return !this.apiKey; }

  async chat({ system, messages = [], tools = null, toolChoice = "auto", temperature = 0.7, maxTokens = 1024 } = {}) {
    if (this.isMock()) return this._mockChat({ system, messages, tools });

    const body = {
      model: this.model,
      max_tokens: maxTokens,
      temperature,
      messages: messages.map((m) => ({ role: m.role, content: m.content || "" })),
    };
    if (system) body.system = system;
    if (tools?.length) {
      body.tools = tools.map((t) => ({
        name: t.function.name,
        description: t.function.description || "",
        input_schema: t.function.parameters || { type: "object", properties: {} },
      }));
      if (toolChoice === "auto") body.tool_choice = { type: "auto" };
      else if (toolChoice === "none") body.tool_choice = { type: "none" };
      else if (toolChoice === "required") body.tool_choice = { type: "any" };
    }

    let lastErr;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const r = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        clearTimeout(t);
        if (r.status === 429 || r.status >= 500) {
          this.usage.retry_count++;
          if (attempt < this.maxRetries) {
            let wait;
            const ra = r.headers?.get?.("retry-after");
            if (r.status === 429 && ra) {
              const secs = Number(ra);
              wait = Number.isFinite(secs) && secs > 0 ? Math.min(secs * 1000, this.maxRetryAfterMs) : 500 * Math.pow(2, attempt);
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
          throw new LLMError(`Anthropic ${r.status}: ${errText.slice(0, 300)}`, `http_${r.status}`);
        }
        const data = await r.json();
        const textBlocks = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
        const toolBlocks = (data.content || []).filter((b) => b.type === "tool_use");
        const toolCalls = toolBlocks.length ? toolBlocks.map((b) => ({
          id: b.id,
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input || {}) },
        })) : null;
        const inTok = data.usage?.input_tokens || 0;
        const outTok = data.usage?.output_tokens || 0;
        this.usage.input_tokens += inTok;
        this.usage.output_tokens += outTok;
        this.usage.request_count++;
        this.usage.total_cost_usd += this.costUsd(this.model, inTok, outTok);
        return { content: textBlocks, tool_calls: toolCalls, usage: { input_tokens: inTok, output_tokens: outTok, total_tokens: inTok + outTok } };
      } catch (e) {
        clearTimeout(t);
        lastErr = e;
        if (e.name === "AbortError") { this.usage.error_count++; throw new LLMError("Anthropic request timed out", "timeout"); }
        if (e instanceof LLMError) throw e;
        this.usage.error_count++;
        if (attempt < this.maxRetries) { this.usage.retry_count++; await new Promise((res) => setTimeout(res, 500 * Math.pow(2, attempt))); continue; }
        throw new LLMError(e.message || "Anthropic request failed", "network");
      }
    }
    throw lastErr || new LLMError("Anthropic failed after retries", "unknown");
  }
}

// ─── Gemini client (generateContent API) ─────────────────────────
class GeminiClient extends LLMClient {
  constructor({ apiKey, model = "gemini-1.5-flash", ...rest } = {}) {
    const key = apiKey || process.env.GEMINI_API_KEY || "";
    super({ apiKey: "placeholder", baseUrl: "https://generativelanguage.googleapis.com", model, ...rest });
    this.apiKey = key;
    this.baseUrl = "https://generativelanguage.googleapis.com";
  }

  isMock() { return !this.apiKey; }

  async chat({ system, messages = [], tools = null, toolChoice = "auto", temperature = 0.7, maxTokens = 1024 } = {}) {
    if (this.isMock()) return this._mockChat({ system, messages, tools });

    const contents = [];
    if (messages.length > 0) {
      contents.push({ role: "user", parts: [{ text: messages[0].content || "" }] });
      for (let i = 1; i < messages.length; i++) {
        contents.push({ role: messages[i].role === "assistant" ? "model" : "user", parts: [{ text: messages[i].content || "" }] });
      }
    }
    const body = {
      contents,
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (tools?.length) {
      body.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.function.name, description: t.function.description || "", parameters: t.function.parameters })) }];
    }

    let lastErr;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const r = await this.fetchImpl(`${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        clearTimeout(t);
        if (r.status === 429 || r.status >= 500) {
          this.usage.retry_count++;
          if (attempt < this.maxRetries) { await new Promise((res) => setTimeout(res, 500 * Math.pow(2, attempt))); continue; }
        }
        if (!r.ok) {
          const errText = await r.text();
          this.usage.error_count++;
          throw new LLMError(`Gemini ${r.status}: ${errText.slice(0, 300)}`, `http_${r.status}`);
        }
        const data = await r.json();
        const text = (data.candidates?.[0]?.content?.parts || []).filter((p) => p.text).map((p) => p.text).join("");
        const fns = (data.candidates?.[0]?.content?.parts || []).filter((p) => p.functionCall);
        const toolCalls = fns.length ? fns.map((p, i) => ({
          id: `gemini_call_${i}_${Date.now()}`,
          type: "function",
          function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) },
        })) : null;
        const inTok = data.usageMetadata?.promptTokenCount || 0;
        const outTok = data.usageMetadata?.candidatesTokenCount || 0;
        this.usage.input_tokens += inTok;
        this.usage.output_tokens += outTok;
        this.usage.request_count++;
        this.usage.total_cost_usd += this.costUsd(this.model, inTok, outTok);
        return { content: text, tool_calls: toolCalls, usage: { input_tokens: inTok, output_tokens: outTok, total_tokens: inTok + outTok } };
      } catch (e) {
        clearTimeout(t);
        lastErr = e;
        if (e.name === "AbortError") { this.usage.error_count++; throw new LLMError("Gemini request timed out", "timeout"); }
        if (e instanceof LLMError) throw e;
        this.usage.error_count++;
        if (attempt < this.maxRetries) { this.usage.retry_count++; await new Promise((res) => setTimeout(res, 500 * Math.pow(2, attempt))); continue; }
        throw new LLMError(e.message || "Gemini request failed", "network");
      }
    }
    throw lastErr || new LLMError("Gemini failed after retries", "unknown");
  }
}

// ─── Provider registry ────────────────────────────────────────────
const ANTHROPIC_DEFAULTS = { baseUrl: "https://api.anthropic.com", apiKeyEnv: "ANTHROPIC_API_KEY", defaultModel: "claude-sonnet-4-20250514" };
const GEMINI_DEFAULTS = { baseUrl: "https://generativelanguage.googleapis.com", apiKeyEnv: "GEMINI_API_KEY", defaultModel: "gemini-1.5-flash" };

export const PROVIDER_DEFAULTS = {
  ...OPENAI_COMPATIBLE,
  anthropic: ANTHROPIC_DEFAULTS,
  gemini: GEMINI_DEFAULTS,
};

/**
 * Create an LLMClient for the given provider.
 *
 * @param {object} opts
 * @param {string} opts.provider - Provider name (openai, anthropic, gemini, ollama, groq, mistral, deepseek, openrouter, lmstudio)
 * @param {string} [opts.apiKey] - API key (falls back to env var for provider)
 * @param {string} [opts.model] - Model name (falls back to provider default)
 * @param {object} [opts.extra] - Extra options passed to the LLMClient constructor
 * @returns {LLMClient}
 */
export function createLLMClient({ provider = "openai", apiKey, model, ...extra } = {}) {
  const p = PROVIDER_DEFAULTS[provider];
  if (!p) throw new Error(`Unknown LLM provider: ${provider}. Available: ${Object.keys(PROVIDER_DEFAULTS).join(", ")}`);

  const resolvedKey = apiKey || (p.apiKeyEnv ? process.env[p.apiKeyEnv] : "") || "";
  const resolvedModel = model || p.defaultModel;

  if (provider === "anthropic") {
    return new AnthropicClient({ apiKey: resolvedKey, model: resolvedModel, ...extra });
  }
  if (provider === "gemini") {
    return new GeminiClient({ apiKey: resolvedKey, model: resolvedModel, ...extra });
  }
  // OpenAI-compatible providers: just change baseUrl
  return new LLMClient({ apiKey: resolvedKey, model: resolvedModel, baseUrl: p.baseUrl, ...extra });
}

/**
 * Smart router: cheap model for tool selection, expensive for generation.
 * Returns a proxy object with the same .chat() interface but routes calls.
 */
export class SmartRouter {
  constructor({ cheapClient, expensiveClient, tokenBudget = 100_000 } = {}) {
    this.cheap = cheapClient;
    this.expensive = expensiveClient;
    this.tokenBudget = tokenBudget;
    this.tokensUsed = 0;
  }

  get usage() {
    return {
      input_tokens: this.cheap.usage.input_tokens + this.expensive.usage.input_tokens,
      output_tokens: this.cheap.usage.output_tokens + this.expensive.usage.output_tokens,
      request_count: this.cheap.usage.request_count + this.expensive.usage.request_count,
      total_cost_usd: this.cheap.usage.total_cost_usd + this.expensive.usage.total_cost_usd,
    };
  }

  async chat(opts) {
    // Use cheap model for tool selection (when tools are provided)
    if (opts.tools?.length && !opts._forceExpensive) {
      return this.cheap.chat(opts);
    }
    // Use expensive model for generation
    return this.expensive.chat(opts);
  }

  async *streamChat(opts) {
    if (opts.tools?.length && !opts._forceExpensive) {
      yield* this.cheap.streamChat(opts);
      return;
    }
    yield* this.expensive.streamChat(opts);
  }

  isMock() { return this.cheap.isMock() && this.expensive.isMock(); }
}
