import { LayoutGrid, Sparkles, Music, Type, Globe, History, Folder, Settings, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';

export type RailItem = {
  id: string;
  label: string;
  Icon: LucideIcon;
};

const ITEMS: RailItem[] = [
  { id: 'media',   label: 'Media',      Icon: LayoutGrid },
  { id: 'effects', label: 'Effects',    Icon: Sparkles },
  { id: 'audio',   label: 'Audio',      Icon: Music },
  { id: 'text',    label: 'Text',       Icon: Type },
  { id: 'style',   label: 'Style DNA',  Icon: Globe },
  { id: 'history', label: 'History',    Icon: History },
  { id: 'projects',label: 'Projects',   Icon: Folder },
];

interface Props {
  active: string;
  onChange: (id: string) => void;
}

export function SideRail({ active, onChange }: Props) {
  return (
    <nav className="w-14 bg-bg-1 border-r border-border-1 flex flex-col items-center py-2 gap-0.5">
      {ITEMS.map((item) => {
        const isActive = item.id === active;
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            data-tip={item.label}
            className={clsx(
              'tip w-9 h-9 flex items-center justify-center rounded-md transition-all duration-[120ms] relative',
              isActive
                ? 'text-accent bg-accent/10'
                : 'text-ink-3 hover:text-ink-1 hover:bg-bg-2',
            )}
          >
            <item.Icon size={18} strokeWidth={1.6} />
          </button>
        );
      })}
      <div className="flex-1" />
      <button
        data-tip="Settings"
        className="tip w-9 h-9 flex items-center justify-center rounded-md text-ink-3 hover:text-ink-1 hover:bg-bg-2 transition-all duration-[120ms] mb-1"
      >
        <Settings size={18} strokeWidth={1.6} />
      </button>
    </nav>
  );
}
