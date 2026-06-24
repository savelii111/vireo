import { useEffect, useMemo, useRef, useState } from 'react';
import { FileAudio, FileVideo, FolderOpen, Image as ImageIcon, Plus, Search, Upload } from 'lucide-react';
import clsx from 'clsx';
import type { ProjectAsset, ProjectAssetKind } from '../types';
import { getTusIngest, uploadMediaFile } from '../utils/tus_proxy';

type BinFilter = 'all' | ProjectAssetKind;

export interface MediaPanelProps {
  projectId?: string;
  // Phase 0: real "Add to timeline" button on each card.
  // The parent (App.tsx) wires this to useEditor.insertAsset.
  // Kept as a callback so the panel stays presentation-only.
  onAddToTimeline?: (asset: ProjectAsset) => void;
}

const BINS: Array<{ id: BinFilter; label: string; Icon: typeof FileVideo }> = [
  { id: 'all', label: 'All', Icon: FolderOpen },
  { id: 'video', label: 'Video', Icon: FileVideo },
  { id: 'audio', label: 'Audio', Icon: FileAudio },
  { id: 'image', label: 'Images', Icon: ImageIcon },
];

function assetName(asset: ProjectAsset) {
  return asset.filename || asset.name || asset.id;
}

function formatDuration(sec?: number | null) {
  const value = Number(sec);
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value < 60) return `${value.toFixed(value % 1 ? 1 : 0)}s`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function authHeaders(): Record<string, string> {
  const tokenValue = localStorage.getItem('vireo_token') || localStorage.getItem('vireo.auth.token');
  return tokenValue ? { Authorization: `Bearer ${tokenValue}` } : {};
}

function token() {
  return (authHeaders().Authorization || '').replace(/^Bearer\s+/, '');
}

function formatFps(fps?: number | null) {
  const value = Number(fps);
  return Number.isFinite(value) && value > 0 ? `${value.toFixed(3).replace(/\.?0+$/, '')} fps` : '—';
}

async function waitForIngest(uploadId: string) {
  const deadline = Date.now() + 30_000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const result = await getTusIngest(uploadId, token());
      if (result.real_decode === true) return result;
      if (result.error) throw new Error(String(result.error));
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (!lastError.includes('ingest_not_ready')) throw e;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(lastError || 'Timed out waiting for ffprobe ingest');
}

async function registerAssetFromIngest(projectId: string, ingest: Record<string, unknown>) {
  const res = await fetch('/api/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      project_id: projectId,
      kind: (ingest.hasAudio === true ? 'video' : 'video') as ProjectAssetKind,
      source: 'upload',
      filename: ingest.filename,
      storage_path: ingest.file_path,
      duration_sec: ingest.duration_sec,
      width: ingest.width,
      height: ingest.height,
      fps: ingest.fps,
      codec: ingest.video_codec || ingest.codec,
      container: ingest.container,
      has_audio: ingest.hasAudio,
      real_decode: ingest.real_decode,
      metadata: {
        ...(ingest.metadata && typeof ingest.metadata === 'object' ? ingest.metadata : {}),
        real_decode: ingest.real_decode,
        video_codec: ingest.video_codec || ingest.codec,
        container: ingest.container,
        fps: ingest.fps,
        hasAudio: ingest.hasAudio,
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || body.error || `POST /api/assets failed (${res.status})`);
  return body.asset as ProjectAsset;
}

export function MediaPanel({ projectId, onAddToTimeline }: MediaPanelProps) {
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bin, setBin] = useState<BinFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!projectId) {
        setAssets([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/assets?project_id=${encodeURIComponent(projectId)}&limit=200`, {
          headers: authHeaders(),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || `GET /api/assets failed (${res.status})`);
        if (!cancelled) setAssets(Array.isArray(body.assets) ? body.assets : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [projectId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets
      .filter((asset) => bin === 'all' || asset.kind === bin)
      .filter((asset) => {
        if (!q) return true;
        const haystack = [
          assetName(asset), asset.id, asset.kind, asset.mime,
          asset.metadata?.label, asset.codec, asset.container,
          asset.real_decode === true ? 'real_decode' : '',
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
      });
  }, [assets, bin, query]);

  async function runImport(file: File) {
    if (!projectId || !file) return;
    setUploading(true);
    setError(null);
    setUploadProgress(0);
    setSelectedFile(file);
    try {
      const uploadId = await uploadMediaFile(file, {
        projectId,
        token: token(),
        onProgress: setUploadProgress,
      });
      const ingest = await waitForIngest(uploadId);
      const asset = await registerAssetFromIngest(projectId, ingest);
      setAssets((prev) => [asset, ...prev]);
      setSelectedFile(null);
      setUploadProgress(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  // Day 27 / Electron desktop: import a file directly from
  // disk without TUS. The native dialog (in main) gave us
  // a local path. We ffprobe it in main, register the
  // asset on the server with storage_path = the local
  // path, and the <video> in the preview uses
  // file:///<path> directly — no upload, no transcoding.
  // Falls back to the TUS path when window.vireo is not
  // present (browser mode without Electron).
  async function runImportFromDisk(localPath: string) {
    if (!projectId || !localPath) return;
    setUploading(true);
    setError(null);
    setSelectedFile(new File([new Uint8Array(0)], localPath.split(/[/\\]/).pop() || "file"));
    try {
      const vireo = (window as unknown as { vireo?: { ffprobe: (p: string) => Promise<unknown> } }).vireo;
      if (!vireo) throw new Error("desktop bridge not available");
      const probe = (await vireo.ffprobe(localPath)) as {
        ok: boolean;
        duration_sec?: number;
        width?: number;
        height?: number;
        fps?: number;
        video_codec?: string | null;
        audio_codec?: string | null;
        container?: string | null;
        size?: number;
        error?: string;
      };
      if (!probe.ok) throw new Error(probe.error || "ffprobe failed");
      const tokenVal = token();
      // POST /api/assets with storage_path = localPath.
      // The server's existing handler reads storage_path
      // and creates an asset row. streamAssetMedia already
      // serves the file from disk via the media root.
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer" + " " + tokenVal,
        },
        body: JSON.stringify({
          project_id: projectId,
          filename: localPath.split(/[/\\]/).pop(),
          storage_path: localPath,
          media_origin: "file",
          duration_sec: probe.duration_sec || 0,
          width: probe.width || 0,
          height: probe.height || 0,
          fps: probe.fps || 0,
          video_codec: probe.video_codec || null,
          audio_codec: probe.audio_codec || null,
          container: probe.container || null,
          size_bytes: probe.size || 0,
          source: "desktop",
          real_decode: true,
        }),
      });
      if (!res.ok) throw new Error("/api/assets " + res.status + " " + (await res.text()).slice(0, 200));
      const json = await res.json();
      const asset = json.asset || json;
      setAssets((prev) => [asset, ...prev]);
      setSelectedFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function submitRealUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) return;
    await runImport(selectedFile);
  }

  return (
    <aside data-testid="media-panel" className="min-h-0 min-w-0 overflow-hidden border border-border-1 bg-bg-1">
      <div
        className="h-10 flex items-center justify-between gap-2 border-b border-border-1 px-3"
        data-testid="media-panel-title"
      >
        <div className="flex items-center gap-2">
          <FolderOpen size={14} strokeWidth={1.6} className="text-accent" />
          <span className="text-[12px] font-semibold tracking-wide">Project / Media</span>
          <span className="rounded bg-bg-2 px-1.5 py-0.5 text-[10px] text-ink-3">{filtered.length}</span>
        </div>
        <span className="text-[10px] text-ink-3">TUS + ffprobe</span>
      </div>

      <div className="grid h-[calc(100%-40px)] grid-rows-[auto_auto_minmax(0,1fr)] gap-2 p-3">
        {/* Day 26: visible, prominent Import zone with file
            picker AND drag-and-drop from the OS file manager.
            Disabled (with explanation) when no project is
            active. */}
        {projectId ? (
          <ImportZone
            disabled={uploading}
            onFile={runImport}
            onPickLocalPath={(p) => void runImportFromDisk(p)}
            progress={uploadProgress}
            file={selectedFile}
            onPickFile={(f) => setSelectedFile(f)}
          />
        ) : (
          <div
            data-testid="media-import-empty"
            className="rounded border border-dashed border-border-1 bg-bg-2 px-3 py-2 text-[12px] text-ink-3"
          >
            Сначала выберите или создайте проект
          </div>
        )}
        <form onSubmit={submitRealUpload} className="grid grid-cols-[1fr_auto] gap-2 sr-only" aria-hidden>
          <input
            type="file"
            accept="video/*,audio/*,image/*"
            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            data-testid="import-file-input"
          />
          <button
            data-testid="import-real"
            type="submit"
            disabled
            className="hidden"
          >
            Import
          </button>
        </form>
        {uploading && (
          <div className="h-1.5 overflow-hidden rounded bg-bg-3">
            <div className="h-full bg-accent transition-all duration-300 ease-out" style={{ width: `${Math.round(uploadProgress * 100)}%` }} />
          </div>
        )}

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-4" />
            <input
              data-testid="media-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search assets…"
              className="w-full rounded border border-border-1 bg-bg-2 pl-7 pr-2 py-1.5 text-[12px] text-ink-1 outline-none placeholder:text-ink-4 focus:border-accent"
            />
          </div>
          <div className="flex items-center gap-1">
            {BINS.map((item) => (
              <button
                key={item.id}
                data-testid={`bin-${item.id}`}
                onClick={() => setBin(item.id)}
                className={clsx(
                  'flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors',
                  bin === item.id ? 'bg-accent/10 text-accent' : 'text-ink-3 hover:bg-bg-2 hover:text-ink-1',
                )}
              >
                <item.Icon size={12} strokeWidth={1.6} />
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto pr-0.5">
          {!projectId && <EmptyState title="No active project" subtitle="Open or create a project to register assets." />}
          {loading && <EmptyState title="Loading assets…" subtitle="Reading metadata from /api/assets." />}
          {error && <div className="rounded border border-danger/30 bg-danger/10 p-2 text-[11px] text-danger">{error}</div>}
          {!loading && !error && filtered.length === 0 && (
            <EmptyState title="No assets yet" subtitle="Use Import to upload through TUS and ffprobe." />
          )}
          <div className="space-y-2">
            {filtered.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                onAddToTimeline={onAddToTimeline ? () => onAddToTimeline(asset) : undefined}
              />
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

function AssetCard({ asset, onAddToTimeline }: {
  asset: ProjectAsset;
  onAddToTimeline?: () => void;
}) {
  const Icon = asset.kind === 'audio' ? FileAudio : asset.kind === 'image' ? ImageIcon : FileVideo;
  const realDecode = asset.real_decode === true || asset.metadata?.real_decode === true;
  return (
    <article
      data-testid="asset-card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-vireo-asset', JSON.stringify(asset));
      }}
      className="group rounded-lg border border-border-1 bg-bg-2 p-2 transition-colors hover:border-accent/50 hover:bg-bg-3"
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded bg-accent/10 text-accent">
          <Icon size={16} strokeWidth={1.6} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[12px] font-semibold text-ink-1" title={assetName(asset)}>{assetName(asset)}</h3>
            <span className="rounded bg-bg-1 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-ink-3">{asset.kind}</span>
            {realDecode ? <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-semibold text-accent">real_decode</span> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-3">
            <span>{formatDuration(asset.duration_sec)} duration</span>
            {asset.width && asset.height ? <span>{asset.width}×{asset.height}</span> : null}
            {asset.fps ? <span>{formatFps(asset.fps)}</span> : null}
            {asset.codec ? <span>{asset.codec}</span> : null}
            {asset.container ? <span>{asset.container}</span> : null}
            <span>{asset.status || 'ready'}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            {onAddToTimeline && (
              <button
                type="button"
                data-testid={`add-to-timeline-${asset.id}`}
                onClick={(e) => { e.stopPropagation(); onAddToTimeline(); }}
                className="flex items-center gap-1 px-2 py-1 rounded bg-accent text-white text-[11px] font-semibold hover:opacity-90"
                title="Добавить клип на Video 1 в позиции плейхеда"
              >
                <Plus size={12} strokeWidth={2} /> Добавить на таймлайн
              </button>
            )}
            <p className="truncate text-[10px] text-ink-4">или перетащите на дорожку</p>
          </div>
        </div>
      </div>
    </article>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="rounded border border-border-1 bg-bg-2 p-4 text-center text-[12px] text-ink-3">
      <div className="font-semibold text-ink-2">{title}</div>
      <div className="mt-1">{subtitle}</div>
    </div>
  );
}

// Day 26: prominent, accessible Import zone. Lets the user
// either pick a file from the OS dialog or drag a file from
// the file manager. Disables itself while a previous upload
// is in flight. Surfaces the upload progress and the most
// recent error in the same area.
function ImportZone({
  disabled,
  onFile,
  onPickFile,
  onPickLocalPath,
  progress,
  file,
}: {
  disabled: boolean;
  onFile: (f: File) => void | Promise<void>;
  onPickFile: (f: File | null) => void;
  onPickLocalPath?: (path: string) => void | Promise<void>;
  progress: number;
  file: File | null;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputEl = useRef<HTMLInputElement>(null);

  return (
    <div
      data-testid="media-import-zone"
      onDragEnter={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
      onDragLeave={(e) => {
        e.preventDefault();
        // only clear when leaving the actual zone, not children
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (disabled) return;
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={clsx(
        'rounded-md border-2 border-dashed transition-colors p-2 flex flex-col gap-2',
        dragOver ? 'border-accent bg-bg-2' : 'border-border-1 bg-bg-2',
        disabled && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="media-import-button"
          disabled={disabled}
          onClick={() => inputEl.current?.click()}
          className="flex-1 flex items-center justify-center gap-1.5 rounded bg-accent px-2 py-1.5 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-bg-3 disabled:text-ink-3"
        >
          <Upload size={13} />
          {disabled ? 'Загрузка…' : 'Импортировать медиа'}
        </button>
        {/* Day 27 / Electron desktop: "Open file…" button
            that uses the native dialog and a direct disk
            path. The button is rendered only when the
            preload bridge (window.vireo) is available. */}
        {typeof window !== "undefined" &&
        (window as unknown as { vireo?: { isDesktop?: boolean } }).vireo?.isDesktop ? (
          <button
            type="button"
            data-testid="media-import-desktop-button"
            disabled={disabled}
            onClick={async () => {
              const w = window as unknown as {
                vireo?: { importFile: () => Promise<Array<{ path: string; name: string }> | null> };
              };
              const picked = await w.vireo?.importFile();
              if (picked && picked[0]?.path) {
                await onPickLocalPath?.(picked[0].path);
              }
            }}
            title="Открыть файл с диска (Electron)"
            className="rounded border border-border-1 bg-bg-2 px-2 py-1.5 text-[12px] font-semibold text-ink-1 hover:bg-bg-3 disabled:opacity-60"
          >
            <FolderOpen size={13} />
          </button>
        ) : null}
        <input
          ref={inputEl}
          type="file"
          accept="video/*,audio/*,image/*"
          data-testid="media-import-file-input"
          // Make the input clickable in tests even though it's
          // visually hidden by the parent. We dispatch the
          // click on it through a Playwright `setInputFiles`
          // call. The CSS class "hidden" is OK for human users
          // because the parent button is the entry point.
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            onPickFile(f);
            if (f) onFile(f);
            e.target.value = '';
          }}
        />
      </div>
      <div
        data-testid="media-import-drop"
        className="rounded border border-border-1 bg-bg-1 px-2 py-2 text-center text-[11px] text-ink-3"
      >
        Перетащите видео, аудио или картинку сюда
      </div>
      {file && (
        <div className="text-[11px] text-ink-2 truncate" data-testid="media-import-filename">
          {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
        </div>
      )}
      {progress > 0 && progress < 100 && (
        <div className="h-1 rounded bg-bg-3 overflow-hidden" data-testid="media-import-progress">
          <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
