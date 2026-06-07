// Vireo monitoring webhook dispatcher.
// Sends alert payloads to Slack, Discord, Telegram, or generic HTTP endpoints.
// Configured via env: VIREO_WEBHOOKS (JSON) or VIREO_WEBHOOK_URL + VIREO_WEBHOOK_KIND.

const DEFAULT_TIMEOUT_MS = 5000;

export function parseWebhookConfig(env = process.env) {
  // 1) JSON list in VIREO_WEBHOOKS
  if (env.VIREO_WEBHOOKS) {
    try {
      const arr = JSON.parse(env.VIREO_WEBHOOKS);
      if (Array.isArray(arr)) return arr.filter(w => w && w.url);
    } catch {
      // fall through to single-webhook config
    }
  }
  // 2) Single webhook (legacy / simple)
  if (env.VIREO_WEBHOOK_URL) {
    return [{
      kind: env.VIREO_WEBHOOK_KIND || detectKind(env.VIREO_WEBHOOK_URL),
      url: env.VIREO_WEBHOOK_URL,
    }];
  }
  return [];
}

export function detectKind(url) {
  const u = String(url || "").toLowerCase();
  if (u.includes("hooks.slack.com")) return "slack";
  if (u.includes("discord.com/api/webhooks") || u.includes("discordapp.com/api/webhooks")) return "discord";
  if (u.includes("api.telegram.org")) return "telegram";
  return "generic";
}

/**
 * Build a Slack-compatible message from a list of alerts.
 * @param {Array} alerts
 * @param {object} [ctx] - { service, env, host }
 */
export function buildSlackPayload(alerts, ctx = {}) {
  const text = alerts.map(formatAlertLine).join("\n");
  return {
    text: `[${ctx.env || "dev"}] ${alerts.length} alert(s) from ${ctx.service || "vireo-monitoring"}`,
    attachments: [
      {
        color: alerts.some(a => a.kind === "agent_down") ? "danger" : "good",
        text,
        ts: Math.floor(Date.now() / 1000),
        footer: ctx.host || "vireo",
      },
    ],
  };
}

export function buildDiscordPayload(alerts, ctx = {}) {
  const description = alerts.map(formatAlertLine).join("\n");
  return {
    username: "Vireo Monitoring",
    embeds: [
      {
        title: `${alerts.length} alert(s) — ${ctx.service || "vireo"}`,
        description,
        color: alerts.some(a => a.kind === "agent_down") ? 0xcc0000 : 0x00cc00,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

/**
 * Build Telegram sendMessage payload.
 * @param {string} botUrl  - full URL like https://api.telegram.org/bot<TOKEN>/sendMessage
 * @param {Array} alerts
 * @param {object} [ctx]
 * @returns {{url: string, body: object}}
 */
export function buildTelegramPayload(botUrl, alerts, ctx = {}) {
  const text = alerts.map(formatAlertLine).join("\n");
  return {
    url: botUrl,
    body: {
      chat_id: ctx.chatId || process.env.VIREO_TELEGRAM_CHAT_ID,
      text: `*${ctx.service || "vireo-monitoring"}* (${ctx.env || "dev"})\n\n${text}`,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    },
  };
}

export function buildGenericPayload(alerts, ctx = {}) {
  return {
    service: ctx.service || "vireo-monitoring",
    env: ctx.env || "dev",
    host: ctx.host || null,
    timestamp: new Date().toISOString(),
    alerts,
  };
}

function formatAlertLine(a) {
  if (a.kind === "agent_down") return `❌ agent *${a.name}* DOWN — ${a.error || "no error message"}`;
  if (a.kind === "agent_recovered") return `✅ agent *${a.name}* recovered`;
  return `ℹ️  ${a.kind}: ${a.name}`;
}

/**
 * Serialize payload to (url, init) for fetch, given a webhook config entry.
 * Returns null if the entry should be skipped.
 */
export function buildRequest(webhook, alerts, ctx = {}) {
  if (!webhook?.url) return null;
  const kind = webhook.kind || detectKind(webhook.url);
  let url = webhook.url;
  let body;
  switch (kind) {
    case "slack":
      body = buildSlackPayload(alerts, ctx);
      break;
    case "discord":
      body = buildDiscordPayload(alerts, ctx);
      break;
    case "telegram": {
      const t = buildTelegramPayload(url, alerts, ctx);
      url = t.url;
      body = t.body;
      break;
    }
    case "generic":
    default:
      body = buildGenericPayload(alerts, ctx);
      break;
  }
  return {
    url,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  };
}

/**
 * Fire alerts to all configured webhooks.
 * @param {Array} alerts
 * @param {object} [opts]
 * @param {Array} [opts.webhooks]  - override webhooks (else read env)
 * @param {object} [opts.ctx]       - { service, env, host }
 * @param {function} [opts.fetchImpl] - injectable fetch (for tests)
 * @param {number}   [opts.timeoutMs]
 * @returns {Promise<Array<{url, ok, status, error}>>}
 */
export async function fireWebhooks(alerts, opts = {}) {
  const webhooks = opts.webhooks ?? parseWebhookConfig();
  if (webhooks.length === 0 || !alerts?.length) {
    return [];
  }
  const ctx = opts.ctx || {
    service: "vireo-monitoring",
    env: process.env.NODE_ENV || "dev",
    host: process.env.HOSTNAME || null,
  };
  const fetchFn = opts.fetchImpl || globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const results = await Promise.all(
    webhooks.map(async (w) => {
      const req = buildRequest(w, alerts, ctx);
      if (!req) return { url: w.url, ok: false, error: "invalid_webhook" };
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetchFn(req.url, { ...req.init, signal: controller.signal });
        clearTimeout(t);
        return {
          url: w.url,
          ok: resp.ok,
          status: resp.status,
          error: resp.ok ? null : `http_${resp.status}`,
        };
      } catch (e) {
        clearTimeout(t);
        return { url: w.url, ok: false, status: 0, error: e.message || String(e) };
      }
    })
  );
  return results;
}
