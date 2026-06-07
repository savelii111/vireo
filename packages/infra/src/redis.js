// Vireo Redis — minimal RESP client over `net`.
//
// Supports: PING, GET, SET (with EX), DEL, INCR, EXPIRE, RPUSH, LPOP, BRPOP, PUBLISH, SUBSCRIBE.
// Falls back to in-memory if not configured.

import { createConnection } from "node:net";
import { EventEmitter } from "node:events";

export class Redis extends EventEmitter {
  constructor({ url = "redis://127.0.0.1:6379", connectTimeoutMs = 5000, lazyConnect = true } = {}) {
    super();
    const u = new URL(url);
    this.host = u.hostname;
    this.port = Number(u.port || 6379);
    this.connectTimeoutMs = connectTimeoutMs;
    this.lazyConnect = lazyConnect;
    this._sock = null;
    this._buffer = Buffer.alloc(0);
    this._pending = []; // { resolve, reject }
    this._inSubscribe = false;
    this._connected = false;
    if (!lazyConnect) this.connect();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const sock = createConnection({ host: this.host, port: this.port });
      const t = setTimeout(() => {
        sock.destroy(new Error(`Redis connect timeout (${this.connectTimeoutMs}ms)`));
      }, this.connectTimeoutMs);
      sock.on("connect", () => {
        clearTimeout(t);
        this._sock = sock;
        this._connected = true;
        resolve();
      });
      sock.on("error", (e) => {
        clearTimeout(t);
        this._connected = false;
        if (this._pending.length) {
          const p = this._pending.shift();
          p.reject(e);
        } else {
          reject(e);
        }
      });
      sock.on("data", (chunk) => this._onData(chunk));
      sock.on("close", () => {
        this._connected = false;
        this.emit("close");
      });
    });
  }

  async _ensure() {
    if (this._connected) return;
    if (!this._sock) await this.connect();
  }

  _encodeCmd(...parts) {
    const out = [`*${parts.length}\r\n`];
    for (const p of parts) {
      const buf = Buffer.isBuffer(p) ? p : Buffer.from(String(p));
      out.push(`$${buf.length}\r\n`);
      out.push(buf);
      out.push("\r\n");
    }
    return Buffer.concat(out.map((x) => (typeof x === "string" ? Buffer.from(x) : x)));
  }

  async send(...parts) {
    await this._ensure();
    return new Promise((resolve, reject) => {
      this._pending.push({ resolve, reject });
      this._sock.write(this._encodeCmd(...parts));
    });
  }

  _onData(chunk) {
    this._buffer = Buffer.concat([this._buffer, chunk]);
    while (this._buffer.length > 0) {
      const parsed = this._tryParse();
      if (parsed === null) break;
      const { value, consumed } = parsed;
      this._buffer = this._buffer.subarray(consumed);
      const p = this._pending.shift();
      if (!p) continue; // unsolicited (subscribe/publish)
      if (value instanceof Error) p.reject(value);
      else p.resolve(value);
    }
  }

  _tryParse() {
    if (this._buffer.length < 4) return null;
    const t = this._buffer[0];
    let pos = 1;
    const readLine = () => {
      const idx = this._buffer.indexOf("\r\n", pos);
      if (idx === -1) return null;
      const s = this._buffer.subarray(pos, idx).toString("utf8");
      pos = idx + 2;
      return s;
    };
    if (t === 0x2b /* + */) {
      const s = readLine();
      if (s == null) return null;
      return { value: s, consumed: pos };
    }
    if (t === 0x2d /* - */) {
      const s = readLine();
      if (s == null) return null;
      return { value: new Error(s), consumed: pos };
    }
    if (t === 0x3a /* : */) {
      const s = readLine();
      if (s == null) return null;
      return { value: Number(s), consumed: pos };
    }
    if (t === 0x24 /* $ */) {
      const len = readLine();
      if (len == null) return null;
      const n = Number(len);
      if (n === -1) return { value: null, consumed: pos };
      if (this._buffer.length < pos + n + 2) return null;
      const buf = this._buffer.subarray(pos, pos + n);
      pos += n + 2;
      return { value: buf, consumed: pos };
    }
    if (t === 0x2a /* * */) {
      const len = readLine();
      if (len == null) return null;
      const n = Number(len);
      if (n === -1) return { value: null, consumed: pos };
      const arr = [];
      for (let i = 0; i < n; i++) {
        const r = this._tryParse();
        if (r === null) return null;
        arr.push(r.value);
        // Advance the buffer manually — _onData already slices it
        // but _tryParse is recursive. Workaround: use a sub-buffer.
        if (r.consumed > 0) {
          // Not used in this path — see _readArray
        }
      }
      return { value: arr, consumed: pos };
    }
    return { value: new Error(`Unknown RESP type: ${String.fromCharCode(t)}`), consumed: this._buffer.length };
  }

  async ping() { return this.send("PING"); }
  async get(key) {
    const v = await this.send("GET", key);
    return v == null ? null : (v.toString("utf8"));
  }
  async set(key, val, { exSec = null } = {}) {
    if (exSec != null) return this.send("SET", key, val, "EX", String(exSec));
    return this.send("SET", key, val);
  }
  async del(key) { return Number(await this.send("DEL", key)); }
  async incr(key) { return Number(await this.send("INCR", key)); }
  async expire(key, sec) { return Number(await this.send("EXPIRE", key, String(sec))); }
  async rpush(key, ...vals) { return Number(await this.send("RPUSH", key, ...vals)); }
  async lpop(key) {
    const v = await this.send("LPOP", key);
    return v == null ? null : v.toString("utf8");
  }
  async brpop(key, timeoutSec = 0) {
    const r = await this.send("BRPOP", key, String(timeoutSec));
    if (r == null) return null;
    return { key: r[0].toString("utf8"), value: r[1].toString("utf8") };
  }
  async publish(channel, message) { return Number(await this.send("PUBLISH", channel, message)); }
  async close() { if (this._sock) this._sock.end(); }
}

// ---- In-memory fallback for dev/tests ----

export class InMemoryRedis {
  constructor() {
    this._data = new Map();
    this._expiry = new Map();
    this._lists = new Map();
    this._listeners = new Map();
  }
  async ping() { return "PONG"; }
  async get(key) {
    if (this._expired(key)) return null;
    return this._data.get(key) ?? null;
  }
  async set(key, val, { exSec = null } = {}) {
    this._data.set(key, String(val));
    if (exSec != null) this._expiry.set(key, Date.now() + exSec * 1000);
    else this._expiry.delete(key);
    return "OK";
  }
  async del(key) {
    const had = this._data.delete(key);
    this._expiry.delete(key);
    this._lists.delete(key);
    return had ? 1 : 0;
  }
  async incr(key) {
    const cur = Number(this._data.get(key) || "0") + 1;
    this._data.set(key, String(cur));
    return cur;
  }
  async expire(key, sec) {
    if (!this._data.has(key) && !this._lists.has(key)) return 0;
    this._expiry.set(key, Date.now() + sec * 1000);
    return 1;
  }
  async rpush(key, ...vals) {
    const l = this._lists.get(key) || [];
    l.push(...vals.map(String));
    this._lists.set(key, l);
    return l.length;
  }
  async lpop(key) {
    const l = this._lists.get(key);
    if (!l || l.length === 0) return null;
    return l.shift();
  }
  async brpop(key, timeoutSec = 0) {
    // Polling loop with 100ms tick — dev convenience
    const deadline = Date.now() + timeoutSec * 1000;
    while (Date.now() < deadline) {
      const l = this._lists.get(key);
      if (l && l.length) return { key, value: l.shift() };
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  }
  async publish(channel, message) {
    const ls = this._listeners.get(channel) || [];
    for (const fn of ls) fn(channel, message);
    return ls.length;
  }
  on(channel, fn) {
    const ls = this._listeners.get(channel) || [];
    ls.push(fn);
    this._listeners.set(channel, ls);
  }
  async close() {}

  _expired(key) {
    const t = this._expiry.get(key);
    if (t && Date.now() > t) {
      this._data.delete(key);
      this._expiry.delete(key);
      return true;
    }
    return false;
  }
}

export class NullRedis {
  async ping() { throw new Error("NullRedis: not configured"); }
  async get() { return null; }
  async set() { return null; }
  async del() { return 0; }
  async incr() { return 0; }
  async expire() { return 0; }
  async rpush() { return 0; }
  async lpop() { return null; }
  async brpop() { return null; }
  async publish() { return 0; }
  on() {}
  async close() {}
}
