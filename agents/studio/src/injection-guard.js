// B2.2 prompt-injection guard (2026-06-08).
//
// Detects the most common prompt-injection patterns in user-supplied
// content that gets re-injected into the LLM context (Style DNA
// fields, content piece text, transcript snippets, metadata strings).
//
// Strategy: regex-based pattern matching on the *outermost* user input
// — not on LLM outputs, not on tool result strings we constructed
// ourselves. The goal is to catch:
//   1. Classic "ignore previous instructions" / "system:" /
//      "assistant:" injection — the attacker adds a fake system
//      prompt to a content piece, hoping the agent will follow it.
//   2. Tool-call injection — fake `{"name": "create_project",
//      "args": {...}}` JSON embedded in text, hoping the agent
//      treats it as a real tool call.
//   3. URL/command injection — `file:///etc/passwd`,
//      `{{system_prompt}}`, `\`rm -rf /\``.
//
// This is *defense in depth*, not a complete solution. The LLM
// itself should be the last line of defense. We:
//   - Strip dangerous patterns from text passed back to the LLM
//     (replace with `[redacted]`).
//   - Reject outright (return 400) when a clearly malicious
//     pattern is detected in a `name` or `id` field that goes
//     into a URL or DB column.

const INJECTION_PATTERNS = [
  // Fake system / role markers
  // V8 has a long-standing edge case: patterns with `|` (alternation)
  // and `\s+` silently fail to match. We avoid alternation and
  // instead use `(?=...)` lookaheads for the terminal boundary.
  { rx: /\bignore\s+all\s+previous\s+instructions?(?=\s|$|[.,!?;:]|\band\b)/i, kind: "instruction_override" },
  { rx: /\bignore\s+any\s+previous\s+instructions?(?=\s|$|[.,!?;:]|\band\b)/i, kind: "instruction_override" },
  { rx: /\bignore\s+the\s+previous\s+instructions?(?=\s|$|[.,!?;:]|\band\b)/i, kind: "instruction_override" },
  { rx: /\bdisregard\s+all\s+previous\s+instructions?(?=\s|$|[.,!?;:]|\band\b)/i, kind: "instruction_override" },
  { rx: /\bforget\s+all\s+previous\s+instructions?(?=\s|$|[.,!?;:]|\band\b)/i, kind: "instruction_override" },
  { rx: /\bignore\s+previous\s+context(?=\s|$|[.,!?;:]|\band\b)/i, kind: "instruction_override_ctx" },
  { rx: /^\s*(system|assistant|user)\s*:/im, kind: "fake_role_marker" },
  { rx: /\<\/?(system|assistant|user|prompt|tool_call)\>/i, kind: "xml_role_marker" },
  { rx: /\[\[?(system|assistant|tool|instruction|admin|root)\]?\]/i, kind: "bracket_role_marker" },

  // Tool-call injection
  { rx: /\{\s*"?name"?\s*:\s*"?[a-z_]+"?\s*,\s*"?arguments"?\s*:/i, kind: "fake_tool_call" },
  { rx: /```\s*(json|tool|tool_call)/i, kind: "code_block_injection" },

  // URL / filesystem injection
  { rx: /file:\/\/\/(etc\/passwd|proc\/self\/environ|\/dev\/|\/sys\/)/i, kind: "path_traversal" },
  { rx: /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|169\.254\.|metadata\.google|metadata\.internal)[^\s]*/i, kind: "ssrf_attempt" },

  // Command injection
  { rx: /(\$\(|`)\s*(rm|wget|curl|chmod|chown|dd|mkfs|shutdown|reboot|kill|eval)/i, kind: "shell_injection" },
  { rx: /;\s*(rm|wget|curl|chmod|chown|dd|mkfs|shutdown|reboot|kill)\s+/i, kind: "shell_command_chain" },

  // Template / variable injection
  { rx: /\{\{\s*(system_prompt|secret|api_key|password|token|env\.[A-Z_]+)\s*\}\}/i, kind: "template_var_leak" },

  // Identity impersonation
  { rx: /\bI\s+am\s+(the\s+)?(admin|root|system|developer|owner)\b/i, kind: "identity_impersonation" },
  { rx: /\byou\s+are\s+now\s+[a-z][a-z\s]{2,30}\b/i, kind: "persona_hijack" },
];

const REDACTED = "[redacted:prompt-injection]";

/**
 * Sanitize a user-supplied string before it's used as part of the
 * LLM prompt. Returns the redacted string.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {boolean} [opts.failClosed=false] - if true, throw instead
 *   of redacting. Use for fields that are NEVER supposed to contain
 *   instructions (e.g. user email, project name).
 * @returns {string}
 */
export function sanitizeForLLM(text, opts = {}) {
  if (typeof text !== "string" || text.length === 0) return text;
  let out = text;
  let matched = null;
  for (const p of INJECTION_PATTERNS) {
    if (p.rx.test(out)) {
      matched = p.kind;
      out = out.replace(p.rx, REDACTED);
      if (opts.failClosed) {
        const err = new Error(`prompt_injection_detected: ${p.kind}`);
        err.code = "prompt_injection_detected";
        err.kind = p.kind;
        throw err;
      }
    }
  }
  return out;
}

/**
 * Check a string for injection patterns without modifying it.
 * Returns { safe: boolean, kind: string | null }.
 */
export function checkForInjection(text) {
  if (typeof text !== "string" || text.length === 0) return { safe: true, kind: null };
  for (const p of INJECTION_PATTERNS) {
    if (p.rx.test(text)) return { safe: false, kind: p.kind };
  }
  return { safe: true, kind: null };
}

/**
 * Sanitize an object's string fields recursively. Useful for
 * Style DNA `name`, `description`, `topics`, etc. before they
 * are concatenated into the system prompt.
 *
 * @param {object} obj
 * @returns {object} - new object with sanitized strings
 */
export function sanitizeObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return sanitizeForLLM(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  if (typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = sanitizeObject(v);
    }
    return out;
  }
  return obj;
}
