import type { ExportJob, ExportPreset } from './types';

export type ExportClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export type EnqueueExportInput = {
  projectId: string;
  presetId: string;
  baseVersion: number;
  actor?: 'human' | 'bot';
};

export function createExportClient({ baseUrl = '', fetchImpl = fetch }: ExportClientOptions = {}) {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || `Export request failed with ${response.status}`);
    }
    return data;
  };

  return {
    listPresets(): ExportPreset[] {
      return [
        { id: 'youtube_1080p', name: 'YouTube 1080p', width: 1920, height: 1080, fps: 30, videoCodec: 'h264', audioCodec: 'aac', videoBitrateKbps: 8000, audioBitrateKbps: 192, container: 'mp4' },
        { id: 'youtube_4k', name: 'YouTube 4K', width: 3840, height: 2160, fps: 30, videoCodec: 'h264', audioCodec: 'aac', videoBitrateKbps: 35000, audioBitrateKbps: 192, container: 'mp4' },
        { id: 'instagram_square_1080', name: 'Instagram Square 1080', width: 1080, height: 1080, fps: 30, videoCodec: 'h264', audioCodec: 'aac', videoBitrateKbps: 6000, audioBitrateKbps: 128, container: 'mp4' },
        { id: 'tiktok_vertical_1080', name: 'TikTok Vertical 1080', width: 1080, height: 1920, fps: 30, videoCodec: 'h264', audioCodec: 'aac', videoBitrateKbps: 6000, audioBitrateKbps: 128, container: 'mp4' },
        { id: 'web_720p', name: 'Web 720p', width: 1280, height: 720, fps: 30, videoCodec: 'h264', audioCodec: 'aac', videoBitrateKbps: 4000, audioBitrateKbps: 128, container: 'mp4' },
      ];
    },
    enqueueExport(input: EnqueueExportInput): Promise<{ ok: boolean; job: ExportJob }> {
      return request('/api/exports', {
        method: 'POST',
        body: JSON.stringify({ ...input, actor: input.actor || 'human' }),
      });
    },
    pollExport(jobId: string): Promise<{ ok: boolean; job: ExportJob }> {
      return request(`/api/exports/${encodeURIComponent(jobId)}`);
    },
    getResult(jobId: string): Promise<{ ok: boolean; result: ExportJob['result'] }> {
      return request(`/api/exports/${encodeURIComponent(jobId)}/result`);
    },
  };
}
