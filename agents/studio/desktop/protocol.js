/**
 * desktop/protocol.js — Custom vireo:// protocol and asset resolution.
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';

export class VireoProtocol {
  constructor({ protocol = 'vireo', baseDir = 'frontend/dist', indexHtml = 'index.html' } = {}) {
    this.protocol = protocol;
    this.baseDir = baseDir;
    this.indexHtml = indexHtml;
  }

  createUrl(resourcePath = '') {
    const normalized = String(resourcePath || '').replace(/^\/+/, '');
    return `${this.protocol}://${normalized || 'index'}`;
  }

  parseUrl(url) {
    if (!String(url).startsWith(`${this.protocol}://`)) throw new Error(`Unsupported protocol: ${url}`);
    const parsed = new URL(url.replace(`${this.protocol}://`, 'http://vireo.local/'));
    return {
      protocol: this.protocol,
      pathname: decodeURIComponent(parsed.pathname.replace(/^\/+/, '')),
      search: parsed.search,
      host: parsed.host,
    };
  }

  isAllowedUrl(url) {
    try {
      return String(url).startsWith(`${this.protocol}://`);
    } catch {
      return false;
    }
  }

  resolveAssetPath(resourcePath = '') {
    const rawPath = String(resourcePath || '');
    if (rawPath.startsWith('/') || rawPath.startsWith('\\') || rawPath.startsWith('..') || rawPath.split('/').includes('..')) throw new Error('Invalid asset path');
    const parsed = this.parseUrl(this.createUrl(resourcePath));
    const safePath = parsed.pathname === '' || parsed.pathname === 'index' ? this.indexHtml : parsed.pathname;
    const normalized = safePath.replace(/\\/g, '/');
    if (normalized.split('/').some((part) => part === '..')) throw new Error('Invalid asset path');
    return path.resolve(this.baseDir, normalized);
  }

  getMimeForPath(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimes = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
    };
    return mimes[ext] || 'application/octet-stream';
  }

  async readAsset(resourcePath = '') {
    const filePath = this.resolveAssetPath(resourcePath);
    const body = await fs.readFile(filePath);
    return { body, mimeType: this.getMimeForPath(filePath), filePath };
  }

  registerMockProtocol(handlers = {}) {
    return {
      protocol: this.protocol,
      handler: handlers.handleRequest || ((request) => this.readAsset(request.url)),
    };
  }
}

export default VireoProtocol;
