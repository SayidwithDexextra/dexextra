import React from 'react';

export function LatestFeatures() {
  return (
    <div className="rounded-[18px] border border-white/10 bg-white/5 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
      <div className="aspect-[16/10] w-full overflow-hidden rounded-[14px] border border-white/10 bg-gradient-to-br from-white/8 via-white/3 to-transparent">
        <div className="h-full w-full bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.10),transparent_55%),radial-gradient(circle_at_70%_60%,rgba(59,130,246,0.22),transparent_50%)]" />
      </div>
      <div className="mt-3">
        <div className="text-sm font-medium text-white/90">Latest features</div>
        <div className="mt-1 text-[12px] leading-relaxed text-white/55">
          Preview new creation modes, templates, and workflows. This is a visual placeholder — we’ll wire it to live
          market presets once you’re happy with the layout.
        </div>
      </div>
    </div>
  );
}

