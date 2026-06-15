import { useEffect, useMemo, useState } from 'react';
import { FileAudio, FileVideo, FolderOpen, Image as ImageIcon, Search, Upload } from 'lucide-react';
import clsx from 'clsx';
import type { ProjectAsset, ProjectAssetKind } from '../types';

type BinFilter = 'all' | ProjectAssetKind;

export interface MediaPanelProps {
  projectId?: string;
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

function authHeaders() {
  const token = localStorage.getItem('vireo_token') || localStorage.getItem('vireo.auth.token');
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

export function MediaPanel({ projectId }: MediaPanelProps) {
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bin, setBin] = useState<BinFilter>('all');
  const [query, setQuery] = useState('');
  const [importName, setImportName] = useState('');
  const [importKind, setImportKind] = useState<ProjectAssetKind>('video');
  const [importDuration, setImportDuration] = useState('5');
  const [importing, setImporting] = useState(false);

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
        const haystack = [assetName(asset), asset.id, asset.kind, asset.mime, asset.metadata?.label].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
      });
  }, [assets, bin, query]);

  async function submitSimulatedImport(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    setImporting(true);
    setError(null);
    try {
      const res = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          project_id: projectId,
          kind: importKind,
          source: 'upload',
          filename: importName.trim() || `simulated-${importKind}-${Date.now()}`,
          duration_sec: Math.max(0.1, Number(importDuration) || 5),
          metadata: { simulated_ingest: true, real_decode: false, registered_by: 'manual' },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || `POST /api/assets failed (${res.status})`);
      setAssets((prev) => [body.asset, ...prev]);
      setImportName('');
      setImportDuration('5');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <aside data-testid="media-panel" className="min-h-0 min-w-0 overflow-hidden border border-border-1 bg-bg-1">
      <div className="h-10 flex items-center justify-between gap-2 border-b border-border-1 px-3">
        <div className="flex items-center gap-2">
          <FolderOpen size={14} strokeWidth={1.6} className="text-accent" />
          <span className="text-[12px] font-semibold tracking-wide">Project / Media</span>
          <span className="rounded bg-bg-2 px-1.5 py-0.5 text-[10px] text-ink-3">{filtered.length}</span>
        </div>
        <span className="text-[10px] text-ink-3">simulated ingest</span>
      </div>

      <div className="grid h-[calc(100%-40px)] grid-rows-[auto_auto_minmax(0,1fr)] gap-2 p-3">
        <form onSubmit={submitSimulatedImport} className="grid grid-cols-[1fr_92px_72px_auto] gap-2">
          <input
            value={importName}
            onChange={(e) => setImportName(e.target.value)}
            placeholder="asset.mp4 / audio.wav / image.png"
            className="min-w-0 rounded border border-border-1 bg-bg-2 px-2 py-1.5 text-[12px] text-ink-1 outline-none placeholder:text-ink-4 focus:border-accent"
          />
          <select
            value={importKind}
            onChange={(e) => setImportKind(e.target.value as ProjectAssetKind)}
            className="rounded border border-border-1 bg-bg-2 px-2 py-1.5 text-[12px] text-ink-1 outline-none focus:border-accent"
          >
            <option value="video">video</option>
            <option value="audio">audio</option>
            <option value="image">image</option>
          </select>
          <input
            value={importDuration}
            onChange={(e) => setImportDuration(e.target.value)}
            placeholder="sec"
            inputMode="decimal"
            className="w-16 rounded border border-border-1 bg-bg-2 px-2 py-1.5 text-[12px] text-ink-1 outline-none focus:border-accent"
          />
          <button
            data-testid="import-simulated"
            disabled={importing || !projectId}
            className="flex items-center gap-1 rounded bg-accent px-2 py-1.5 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-bg-3 disabled:text-ink-3"
          >
            <Upload size={13} />
            Import
          </button>
        </form>

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
            <EmptyState title="No assets yet" subtitle="Use Import to register simulated metadata only." />
          )}
          <div className="space-y-2">
            {filtered.map((asset) => (
              <AssetCard key={asset.id} asset={asset} />
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

function AssetCard({ asset }: { asset: ProjectAsset }) {
  const Icon = asset.kind === 'audio' ? FileAudio : asset.kind === 'image' ? ImageIcon : FileVideo;
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
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-3">
            <span>{formatDuration(asset.duration_sec)} duration</span>
            <span>{asset.status || 'ready'}</span>
            {asset.metadata?.simulated_ingest === true && <span className="text-accent">metadata only</span>}
          </div>
          <p className="mt-1 truncate text-[10px] text-ink-4">Drag to any timeline track → insertClip</p>
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
