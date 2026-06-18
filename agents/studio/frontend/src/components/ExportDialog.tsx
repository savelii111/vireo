import type React from 'react';
import { useMemo, useState } from 'react';
import { useEditor } from '../hooks/useEditor';
import type { ExportPreset } from '../types';

const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'youtube_1080p', name: 'YouTube 1080p', width: 1920, height: 1080, fps: 30, videoCodec: 'h264', audioCodec: 'aac', videoBitrateKbps: 8000, audioBitrateKbps: 192, container: 'mp4' },
  { id: 'youtube_4k', name: 'YouTube 4K', width: 3840, height: 2160, fps: 30, videoCodec: 'h264', audioCodec: 'aac', videoBitrateKbps: 35000, audioBitrateKbps: 192, container: 'mp4' },
  { id: 'instagram_square_1080', name: 'Instagram Square 1080', width: 1080, height: 1080, fps: 30, videoCodec: 'h264', audioCodec: 'aac', videoBitrateKbps: 6000, audioBitrateKbps: 128, container: 'mp4' },
  { id: 'tiktok_vertical_1080', name: 'TikTok Vertical 1080', width: 1080, height: 1920, fps: 30, videoCodec: 'h264', audioCodec: 'aac', videoBitrateKbps: 6000, audioBitrateKbps: 128, container: 'mp4' },
  { id: 'web_720p', name: 'Web 720p', width: 1280, height: 720, fps: 30, videoCodec: 'h264', audioCodec: 'aac', videoBitrateKbps: 4000, audioBitrateKbps: 128, container: 'mp4' },
];

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    background: 'rgba(2, 6, 23, 0.68)',
    zIndex: 40,
  },
  panel: {
    width: 'min(560px, calc(100vw - 32px))',
    border: '1px solid rgba(100, 116, 139, 0.35)',
    borderRadius: 24,
    background: '#0f172a',
    color: '#e2e8f0',
    boxShadow: '0 24px 80px rgba(2, 6, 23, 0.55)',
    padding: 24,
    animation: 'vireo-pop var(--dur-2) var(--ease-out)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 18,
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: '#f8fafc',
  },
  close: {
    border: 0,
    background: 'transparent',
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: 24,
    lineHeight: 1,
  },
  label: {
    display: 'block',
    marginBottom: 8,
    color: '#94a3b8',
    fontSize: 13,
  },
  select: {
    width: '100%',
    border: '1px solid rgba(148, 163, 184, 0.35)',
    borderRadius: 14,
    background: '#111827',
    color: '#f8fafc',
    padding: '12px 14px',
    outline: 'none',
  },
  meta: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 8,
    marginTop: 12,
  },
  chip: {
    borderRadius: 999,
    background: '#111827',
    border: '1px solid rgba(148, 163, 184, 0.25)',
    color: '#cbd5e1',
    padding: '8px 10px',
    fontSize: 12,
    textAlign: 'center',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    padding: '6px 10px',
    background: 'rgba(99, 102, 241, 0.16)',
    color: '#c7d2fe',
    border: '1px solid rgba(99, 102, 241, 0.35)',
    fontSize: 12,
    marginTop: 12,
  },
  progress: {
    height: 8,
    borderRadius: 999,
    background: '#111827',
    overflow: 'hidden',
    marginTop: 16,
  },
  bar: {
    height: '100%',
    borderRadius: 999,
    background: '#6366f1',
    transition: 'width var(--dur-3) var(--ease-out)',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
  },
  secondary: {
    border: '1px solid rgba(148, 163, 184, 0.35)',
    borderRadius: 999,
    background: 'transparent',
    color: '#cbd5e1',
    padding: '10px 16px',
    cursor: 'pointer',
  },
  primary: {
    border: 0,
    borderRadius: 999,
    background: '#6366f1',
    color: '#ffffff',
    padding: '10px 18px',
    cursor: 'pointer',
    fontWeight: 700,
  },
  disabled: {
    opacity: 0.55,
    cursor: 'not-allowed',
  },
  error: {
    marginTop: 12,
    color: '#fecaca',
    fontSize: 13,
  },
  result: {
    marginTop: 12,
    color: '#bfdbfe',
    fontSize: 13,
    wordBreak: 'break-all',
  },
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export function ExportDialog({ open, onClose }: Props) {
  const {
    exportPresetId,
    setExportPresetId,
    exportJob,
    exportError,
    enqueueExport,
    pollExport,
  } = useEditor();
  const [polling, setPolling] = useState(false);
  const selectedPreset = useMemo(() => EXPORT_PRESETS.find((preset) => preset.id === exportPresetId) ?? EXPORT_PRESETS[0], [exportPresetId]);

  if (!open) return null;

  const runExport = async () => {
    try {
      const job = await enqueueExport(exportPresetId);
      setPolling(true);
      while (job.state === 'queued' || job.state === 'running') {
        await new Promise((resolve) => window.setTimeout(resolve, 700));
        const next = await pollExport(job.id);
        if (!next) break;
        if (next.state === 'done' || next.state === 'failed') break;
      }
    } catch (e) {
      setPolling(false);
    } finally {
      setPolling(false);
    }
  };

  const simulated = exportJob?.result?.metadata?.simulated_media === true || exportJob?.result?.metadata?.real_encode === false;

  return (
    <div style={styles.backdrop} role="dialog" aria-modal="true" aria-label="Export">
      <div style={styles.panel}>
        <div style={styles.header}>
          <h2 style={styles.title}>Export</h2>
          <button style={styles.close} onClick={onClose} aria-label="Close">×</button>
        </div>

        <label style={styles.label}>
          Preset
          <select
            style={styles.select}
            value={exportPresetId}
            onChange={(event) => setExportPresetId(event.target.value)}
            disabled={polling || exportJob?.state === 'running'}
          >
            {EXPORT_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name} · {preset.width}×{preset.height} · {preset.fps}fps
              </option>
            ))}
          </select>
        </label>

        <div style={styles.meta} aria-label="Export preset summary">
          <span style={styles.chip}>{selectedPreset.width}×{selectedPreset.height}</span>
          <span style={styles.chip}>{selectedPreset.fps} fps</span>
          <span style={styles.chip}>{selectedPreset.videoCodec} / {selectedPreset.audioCodec}</span>
        </div>

        {exportJob && (
          <div>
            <div style={styles.progress}>
              <div style={{ ...styles.bar, width: `${Math.max(5, Math.min(100, exportJob.progress))}%` }} />
            </div>
            <div style={{ ...styles.label, marginTop: 8 }}>{exportJob.state} · {exportJob.progress}%</div>
            {simulated && <div style={styles.badge}>simulated media · approx</div>}
            {exportJob.state === 'done' && exportJob.result?.path && (
              <div style={styles.result}>Ready: {exportJob.result.path}</div>
            )}
            {exportError && <div style={styles.error}>{exportError}</div>}
          </div>
        )}

        <div style={styles.actions}>
          <button style={styles.secondary} onClick={onClose} disabled={polling}>Cancel</button>
          <button
            style={{ ...styles.primary, ...(polling || exportJob?.state === 'running' ? styles.disabled : {}) }}
            onClick={runExport}
            disabled={polling || exportJob?.state === 'running'}
          >
            {polling ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
