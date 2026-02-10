'use client';

import React from 'react';
import Image from 'next/image';
import { IconSearchBubble } from '@/components/create-market-v2/IconSearchBubble';
import { InteractiveMarketCreation } from '@/components/create-market-v2/InteractiveMarketCreation';

export default function DebugCreateMarketV2Page() {
  const [query, setQuery] = React.useState('bitcoin');
  const [description, setDescription] = React.useState('Current price of Bitcoin in USD');
  const [selectedIconUrl, setSelectedIconUrl] = React.useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = React.useState<File | null>(null);
  const uploadedPreview = React.useMemo(() => {
    if (!uploadedFile) return null;
    try {
      return URL.createObjectURL(uploadedFile);
    } catch {
      return null;
    }
  }, [uploadedFile]);

  React.useEffect(() => {
    return () => {
      if (uploadedPreview) URL.revokeObjectURL(uploadedPreview);
    };
  }, [uploadedPreview]);

  return (
    <div className="mx-auto w-full max-w-6xl p-4">
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[12px] font-medium text-white">Debug: Create Market V2 components</div>
            <div className="mt-1 text-[11px] text-[#9CA3AF]">
              This page mounts the real UI components so you can verify search flows work end-to-end.
              The icon search uses <span className="font-mono text-white/80">/api/icon-search</span> (SerpAPI required).
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <a
              className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-white hover:bg-[#1A1A1A]"
              href="/debug"
            >
              Back to /debug
            </a>
            <a
              className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-white hover:bg-[#1A1A1A]"
              href="/new-market"
            >
              Open /new-market
            </a>
          </div>
        </div>
      </div>

      {/* IconSearchBubble direct test */}
      <div className="mt-4 rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="text-[12px] font-medium text-white">Component test: `IconSearchBubble`</div>
        <div className="mt-1 text-[11px] text-[#9CA3AF]">
          Change the inputs below. The bubble should fetch image results and let you select one.
          The debug block on <span className="font-mono text-white/80">/debug</span> shows whether fallback was triggered.
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Query</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="bitcoin"
            />
          </label>
          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Description</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional context"
            />
          </label>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/40">
            {selectedIconUrl ? (
              <Image
                src={selectedIconUrl}
                alt="Selected icon"
                width={48}
                height={48}
                className="h-full w-full object-contain"
                unoptimized
              />
            ) : uploadedPreview ? (
              <Image
                src={uploadedPreview}
                alt="Uploaded icon preview"
                width={48}
                height={48}
                className="h-full w-full object-contain"
                unoptimized
              />
            ) : (
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-white/10 to-white/5" />
            )}
          </div>
          <div className="min-w-0 flex-1 text-[11px] text-white/60">
            <div className="truncate">
              <span className="text-white/70">Selected:</span>{' '}
              <span className="font-mono text-white/80">{selectedIconUrl || '—'}</span>
            </div>
            <div className="truncate">
              <span className="text-white/70">Upload:</span>{' '}
              <span className="font-mono text-white/80">{uploadedFile?.name || '—'}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedIconUrl(null);
              setUploadedFile(null);
            }}
            className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[12px] text-white hover:bg-white/7"
          >
            Clear
          </button>
        </div>

        <div className="mt-4">
          <IconSearchBubble
            query={query}
            description={description}
            isVisible={true}
            layout="contained"
            selectedIconUrl={selectedIconUrl}
            onSelectIcon={(url) => {
              setUploadedFile(null);
              setSelectedIconUrl(url);
            }}
            onUploadIcon={(file) => {
              setSelectedIconUrl(null);
              setUploadedFile(file);
            }}
          />
        </div>
      </div>

      {/* InteractiveMarketCreation full flow */}
      <div className="mt-4 rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="text-[12px] font-medium text-white">Component test: `InteractiveMarketCreation`</div>
        <div className="mt-1 text-[11px] text-[#9CA3AF]">
          Walk through the flow and reach the Icon step to verify the integrated search bubble works in context.
          Step 3 source discovery should not blank out the UI even if SERP returns 0 results.
        </div>

        <div className="mt-6 flex justify-center">
          <InteractiveMarketCreation />
        </div>
      </div>
    </div>
  );
}

