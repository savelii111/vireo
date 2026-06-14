/**
 * desktop/ipc.js — IPC channel registry and authorization.
 */

import { randomUUID } from 'node:crypto';
import { DESKTOP_CHANNELS } from './constants.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class IpcChannelRegistry {
  constructor({ allowedChannels = Object.values(DESKTOP_CHANNELS), roles = new Map() } = {}) {
    this.allowedChannels = new Set(allowedChannels);
    this.handlers = new Map();
    this.roles = roles;
    this.history = [];
  }

  register(channel, handler, meta = {}) {
    if (!this.allowedChannels.has(channel)) throw new Error(`IPC channel is not allowed: ${channel}`);
    if (typeof handler !== 'function') throw new Error(`IPC handler for ${channel} must be a function`);
    this.handlers.set(channel, { handler, meta });
    return { channel, registered: true };
  }

  handle(channel, handler, meta = {}) {
    return this.register(channel, handler, meta);
  }

  remove(channel) {
    return this.handlers.delete(channel);
  }

  listChannels() {
    return [...this.handlers.keys()].sort();
  }

  getChannelMeta(channel) {
    return this.handlers.get(channel)?.meta || {};
  }

  authorize(channel, context = {}) {
    const meta = this.getChannelMeta(channel);
    const requiredRole = meta.requiredRole;
    if (!requiredRole) return { allowed: true, reason: 'public_channel' };
    const role = context.role || 'viewer';
    const allowed = this.roles.get?.(context.userId) === requiredRole || role === requiredRole || role === 'owner';
    return { allowed, reason: allowed ? 'authorized' : 'role_denied' };
  }

  validateRequest(channel, args = {}, context = {}) {
    if (!this.handlers.has(channel)) return { valid: false, reason: 'unknown_channel' };
    const auth = this.authorize(channel, context);
    if (!auth.allowed) return { valid: false, reason: auth.reason };
    return { valid: true, args: clone(args), context: clone(context) };
  }

  async invoke(channel, args = {}, context = {}) {
    const validation = this.validateRequest(channel, args, context);
    if (!validation.valid) throw new Error(validation.reason);
    const { handler } = this.handlers.get(channel);
    const invocationContext = this.createContext(context);
    const result = await handler(validation.args, invocationContext);
    this.history.push({ channel, args: validation.args, context: invocationContext, ok: true, at: new Date().toISOString() });
    return result;
  }

  createContext(context = {}) {
    return {
      userId: context.userId || null,
      role: context.role || 'viewer',
      windowId: context.windowId || null,
      requestId: context.requestId || randomUUID(),
    };
  }

  getHistory(channel) {
    return clone(channel ? this.history.filter((entry) => entry.channel === channel) : this.history);
  }

  clearHistory() {
    this.history = [];
  }
}

export default IpcChannelRegistry;
