/**
 * desktop/updateManager.js — Update lifecycle manager for Electron autoUpdater.
 */

export class UpdateManager {
  constructor({ autoUpdater, config = {}, scheduleTimer = null } = {}) {
    this.autoUpdater = autoUpdater || {
      checkForUpdates: async () => ({ updateInfo: null }),
      downloadUpdate: async () => [],
      quitAndInstall: () => {},
      setFeedURL: () => {},
    };
    this.config = config;
    this.scheduleTimer = scheduleTimer;
    this.status = { state: 'idle', lastCheckedAt: null, lastError: null };
    this.history = [];
  }

  setFeedUrl(url) {
    if (!url) throw new Error('Feed URL is required');
    this.autoUpdater.setFeedURL?.(url);
    this.config.feedUrl = url;
    return { feedUrl: url };
  }

  async checkForUpdates() {
    this.status = { ...this.status, state: 'checking' };
    try {
      const result = await this.autoUpdater.checkForUpdates();
      this.status = { state: 'checked', lastCheckedAt: new Date().toISOString(), lastError: null };
      this.record('check', result);
      return { ...result, status: this.status.state };
    } catch (error) {
      this.status = { state: 'error', lastCheckedAt: new Date().toISOString(), lastError: error.message };
      this.record('check_error', { message: error.message });
      throw error;
    }
  }

  async installUpdate() {
    if (this.status.state !== 'checked') await this.checkForUpdates();
    await this.autoUpdater.downloadUpdate?.();
    this.record('install_requested', {});
    return { status: 'ready_to_install' };
  }

  quitAndInstall() {
    this.autoUpdater.quitAndInstall?.();
    this.record('quit_and_install', {});
    return { status: 'installing' };
  }

  scheduleCheck(intervalMs = 6 * 60 * 60 * 1000) {
    if (intervalMs <= 0) throw new Error('intervalMs must be positive');
    this.config.checkIntervalMs = intervalMs;
    return { scheduled: true, intervalMs };
  }

  clearSchedule() {
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    this.scheduleTimer = null;
    return { scheduled: false };
  }

  isUpdateAllowed() {
    return this.config.allowUpdates !== false;
  }

  record(type, payload = {}) {
    const entry = { type, payload, at: new Date().toISOString() };
    this.history.push(entry);
    return entry;
  }

  getUpdateHistory() {
    return [...this.history];
  }

  getUpdateStatus() {
    return { ...this.status, allowed: this.isUpdateAllowed(), feedUrl: this.config.feedUrl || null };
  }
}

export default UpdateManager;
