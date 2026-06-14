/**
 * desktop/windowState.js — Persist and restore desktop window bounds.
 */

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export class WindowStateManager {
  constructor({ store = new Map(), defaultWindow = {} } = {}) {
    this.store = store instanceof Map ? store : new Map();
    this.defaultWindow = {
      x: undefined,
      y: undefined,
      width: 1280,
      height: 800,
      ...defaultWindow,
    };
  }

  load(key) {
    return this.store.get(key) ? { ...this.defaultWindow, ...this.store.get(key) } : { ...this.defaultWindow };
  }

  save(key, bounds) {
    const sanitized = this.sanitizeBounds(bounds);
    this.store.set(key, sanitized);
    return sanitized;
  }

  sanitizeBounds(bounds = {}) {
    const width = isFiniteNumber(bounds.width) ? Math.max(320, Math.round(bounds.width)) : this.defaultWindow.width;
    const height = isFiniteNumber(bounds.height) ? Math.max(240, Math.round(bounds.height)) : this.defaultWindow.height;
    const x = isFiniteNumber(bounds.x) ? Math.round(bounds.x) : undefined;
    const y = isFiniteNumber(bounds.y) ? Math.round(bounds.y) : undefined;
    return { width, height, ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}) };
  }

  clear(key) {
    return this.store.delete(key);
  }

  keys() {
    return [...this.store.keys()];
  }

  exportState() {
    return Object.fromEntries(this.store);
  }

  importState(state = {}) {
    for (const [key, value] of Object.entries(state)) this.save(key, value);
    return this.exportState();
  }
}

export default WindowStateManager;
