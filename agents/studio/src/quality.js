// F2+F3: Code quality helpers (2026-06-08).
//
// This module holds two utilities used to keep the codebase
// maintainable:
//
//   - addDeprecationHeaders(res, { sunset, replacement })
//     Adds RFC-8594 Deprecation + Sunset headers so clients
//     can prepare for endpoint retirement gracefully.
//
//   - runAll(tasks) / pSettled
//     Promise.all + Promise.allSettled wrappers that never
//     throw and always return { ok, value|error } for each
//     input. Use these when you have N independent async
//     operations and want to handle failures per-task rather
//     than letting one failure kill the others.
//
// Why a separate module:
//   - Deprecation headers are easy to forget to add. By making
//     them a one-call helper, we reduce the chance of shipping
//     a v1 endpoint without a Sunset date.
//   - runAll/pSettled are small but show up in 10+ places in
//     the server. Centralizing them avoids subtle bugs
//     (e.g. one of N tasks throws and silently kills a route).

/**
 * Add Deprecation + Sunset headers to a response. Both are
 * RFC-8594 / RFC-8288 standards. Clients (browsers, SDKs)
 * can use these to warn users or stop using the endpoint.
 *
 * @param {http.ServerResponse} res
 * @param {object} opts
 * @param {string} [opts.since]      - ISO date when deprecation started
 * @param {string} [opts.sunset]     - ISO date when endpoint will be removed
 * @param {string} [opts.replacement] - URL or path of the new endpoint
 * @returns {void}
 */
export function addDeprecationHeaders(res, { since, sunset, replacement } = {}) {
  // Deprecation: true | RFC-8594-date
  // We use a date if available, otherwise just "true".
  res.setHeader("Deprecation", since || "true");
  if (sunset) res.setHeader("Sunset", sunset);
  if (replacement) res.setHeader("Link", `<${replacement}>; rel="successor-version"`);
}

/**
 * Run N independent async functions in parallel, returning a
 * typed result for each. Unlike Promise.all, one failure does
 * not abort the others — every task runs to completion.
 *
 * @param {Object<string, () => Promise<any>>} tasks
 * @returns {Promise<Object<string, {ok: boolean, value?: any, error?: string}>>}
 */
export async function runAll(tasks) {
  const entries = Object.entries(tasks);
  const settled = await Promise.allSettled(entries.map(([, fn]) => fn()));
  const out = {};
  entries.forEach(([key], i) => {
    const s = settled[i];
    if (s.status === "fulfilled") {
      out[key] = { ok: true, value: s.value };
    } else {
      out[key] = { ok: false, error: s.reason?.message || String(s.reason) };
    }
  });
  return out;
}

/**
 * Like runAll but for an array of values + mapper function.
 * Useful when you want to fire the same async op for each
 * item in a list.
 *
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<R>} mapper
 * @returns {Promise<{ok: boolean, value?: R, error?: string}[]>}
 */
export async function pSettledMap(items, mapper) {
  return Promise.allSettled(items.map(mapper)).then((results) =>
    results.map((r) => (r.status === "fulfilled"
      ? { ok: true, value: r.value }
      : { ok: false, error: r.reason?.message || String(r.reason) }))
  );
}
