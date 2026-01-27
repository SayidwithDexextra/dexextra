import React from 'react';
import { Badge } from './Badge';
import { IconCube, IconImage, IconNodes, IconVideo } from './icons';

type Tile = {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  badge?: { text: string; variant?: 'blue' | 'neutral' };
};

const tiles: Tile[] = [
  { title: 'Market', icon: <IconImage className="h-5 w-5" /> },
  { title: 'Automation', icon: <IconVideo className="h-5 w-5" />, badge: { text: 'Pro', variant: 'blue' } },
  { title: '3D Objects', icon: <IconCube className="h-5 w-5" /> },
  { title: 'Nodes', icon: <IconNodes className="h-5 w-5" />, badge: { text: 'Challenge', variant: 'neutral' } },
];

export function GenerateTiles() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
      {tiles.map((t) => (
        <button
          key={t.title}
          type="button"
          className="group flex items-center gap-3 rounded-[14px] border border-white/10 bg-white/5 px-3 py-3 text-left hover:bg-white/7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-white/6 text-white/85 ring-1 ring-white/10 group-hover:bg-white/7">
            {t.icon}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="truncate text-sm font-medium text-white/90">{t.title}</div>
              {t.badge ? <Badge variant={t.badge.variant}>{t.badge.text}</Badge> : null}
            </div>
            {t.subtitle ? (
              <div className="mt-0.5 truncate text-[11px] text-white/50">{t.subtitle}</div>
            ) : null}
          </div>
        </button>
      ))}
    </div>
  );
}

