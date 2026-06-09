// embed.js — Vireo Studio embeddable widget.
//
// Renders a Vireo Studio video player in an iframe (or shadow DOM),
// exposes a PostMessage API for parent–child communication, and
// provides a clean destroy() method for lifecycle management.

// =====================================================================
// Theme definitions
// =====================================================================

const THEMES = {
  dark: {
    bg: "#111118",
    surface: "#1a1a24",
    accent: "#7c5cfc",
    text: "#e8e6f0",
    border: "#2a2a3a",
  },
  light: {
    bg: "#f5f5fa",
    surface: "#ffffff",
    accent: "#5c3cdf",
    text: "#1a1a2e",
    border: "#d0d0e0",
  },
};

// =====================================================================
// createVireoEmbed
// =====================================================================

/**
 * Mount a Vireo Studio player widget inside `container`.
 *
 * @param {HTMLElement|string} container  DOM element or CSS selector
 * @param {object}  opts
 * @param {string}  opts.videoId    ID of the video to display
 * @param {string}  [opts.apiKey]   API key for authenticated playback
 * @param {string}  [opts.theme]    'dark' | 'light' | 'auto'  (default 'auto')
 * @param {boolean} [opts.autoplay] Start playback immediately (default false)
 * @param {boolean} [opts.controls] Show playback controls (default true)
 * @param {boolean} [opts.watermark]Show watermark overlay (default false)
 * @param {string}  [opts.baseUrl]  Override the player origin URL
 *
 * @returns {VireoEmbed}  Handle with on/off/emit for events and destroy()
 */
export function createVireoEmbed(container, opts = {}) {
  // ------------------------------------------------------------------
  // Validate container
  // ------------------------------------------------------------------
  if (!container) {
    throw new TypeError("container is required (element or CSS selector)");
  }

  let el;
  if (typeof container === "string") {
    el = document.querySelector(container);
    if (!el) throw new TypeError(`No element found for selector: ${container}`);
  } else if (container instanceof HTMLElement) {
    el = container;
  } else {
    throw new TypeError("container must be an HTMLElement or a CSS selector string");
  }

  if (!opts.videoId) {
    throw new TypeError("videoId is required");
  }

  // ------------------------------------------------------------------
  // Resolve theme
  // ------------------------------------------------------------------
  let themeName = opts.theme || "auto";
  if (themeName === "auto") {
    if (typeof window !== "undefined" && window.matchMedia) {
      themeName = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } else {
      themeName = "dark";
    }
  }
  const theme = THEMES[themeName] || THEMES.dark;

  // ------------------------------------------------------------------
  // Build iframe src URL with query params
  // ------------------------------------------------------------------
  const base = opts.baseUrl || "https://player.vireo.studio";
  const params = new URLSearchParams();
  params.set("videoId", opts.videoId);
  if (opts.apiKey) params.set("apiKey", opts.apiKey);
  if (opts.autoplay) params.set("autoplay", "1");
  if (opts.controls === false) params.set("controls", "0");
  if (opts.watermark) params.set("watermark", "1");
  params.set("theme", themeName);

  const src = `${base}/embed?${params.toString()}`;

  // ------------------------------------------------------------------
  // Create iframe
  // ------------------------------------------------------------------
  const iframe = document.createElement("iframe");
  iframe.setAttribute("src", src);
  iframe.setAttribute("allow", "autoplay; encrypted-media");
  iframe.setAttribute("frameborder", "0");
  iframe.setAttribute("allowfullscreen", "true");
  iframe.setAttribute("title", `Vireo Studio – ${opts.videoId}`);
  Object.assign(iframe.style, {
    width: "100%",
    height: "100%",
    border: "none",
    borderRadius: "8px",
    background: theme.bg,
  });

  // ------------------------------------------------------------------
  // Event bus
  // ------------------------------------------------------------------
  const listeners = new Map(); // event → Set<fn>

  function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return handle;           // chainable
  }

  function off(event, fn) {
    if (listeners.has(event)) {
      if (fn) listeners.get(event).delete(fn);
      else listeners.delete(event);
    }
    return handle;
  }

  function emit(event, data) {
    if (listeners.has(event)) {
      for (const fn of listeners.get(event)) {
        try { fn(data); } catch (_) { /* swallow listener errors */ }
      }
    }
  }

  // ------------------------------------------------------------------
  // PostMessage listener
  // ------------------------------------------------------------------
  const messageHandler = (evt) => {
    // Only accept messages from our iframe origin or wildcard in dev
    if (evt.source !== iframe.contentWindow) return;

    const msg = evt.data;
    if (!msg || typeof msg !== "object") return;

    emit(msg.event || msg.type, msg.payload || {});
  };

  if (typeof window !== "undefined") {
    window.addEventListener("message", messageHandler);
  }

  // ------------------------------------------------------------------
  // Mount
  // ------------------------------------------------------------------
  el.appendChild(iframe);

  // ------------------------------------------------------------------
  // Send a command to the iframe
  // ------------------------------------------------------------------
  function sendToFrame(command, payload = {}) {
    if (iframe.contentWindow) {
      iframe.contentWindow.postMessage({ command, payload }, "*");
    }
  }

  // ------------------------------------------------------------------
  // Public handle
  // ------------------------------------------------------------------
  const handle = {
    /** Register an event listener */
    on,
    /** Remove an event listener */
    off,
    /** Emit an event locally */
    emit,

    /** Send a command to the embedded player */
    send: sendToFrame,

    /** Get the underlying iframe element */
    get iframe() { return iframe; },

    /** Get the resolved theme object */
    get theme() { return theme; },

    /** Get the resolved theme name */
    get themeName() { return themeName; },

    /** Get the current options snapshot */
    get options() { return { ...opts, theme: themeName }; },

    /** Remove the iframe, clean up listeners, and stop receiving messages */
    destroy() {
      if (typeof window !== "undefined") {
        window.removeEventListener("message", messageHandler);
      }
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
      listeners.clear();
    },
  };

  return handle;
}

export default createVireoEmbed;
