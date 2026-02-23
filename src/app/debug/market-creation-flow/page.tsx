'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDeploymentOverlay } from '@/contexts/DeploymentOverlayContext';

type Phase = 'form' | 'overlay' | 'dock' | 'complete';

const PHASES: { id: Phase; label: string; num: string }[] = [
  { id: 'form', label: 'Market Input Form', num: '01' },
  { id: 'overlay', label: 'Deployment Overlay', num: '02' },
  { id: 'dock', label: 'Dock / Background', num: '03' },
  { id: 'complete', label: 'Completion', num: '04' },
];

const PIPELINE_MESSAGES = [
  'Fetch facet cut configuration',
  'Build initializer and selectors',
  'Prepare meta-create',
  'Sign meta request',
  'Submit to relayer',
  'Wait for confirmation',
  'Parse FuturesMarketCreated event',
  'Verify required selectors',
  'Patch missing selectors if needed',
  'Attach session registry',
  'Grant admin roles on CoreVault',
  'Saving market metadata',
  'Finalize deployment',
];

interface PresetData {
  symbol: string;
  metricUrl: string;
  startPrice: string;
  dataSource: string;
  tags: string[];
  metricDescription: string;
  iconUrl: string;
}

const DEFAULT_PRESET: PresetData = {
  symbol: 'TEST-USD',
  metricUrl: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
  startPrice: '42.50',
  dataSource: 'CoinGecko API',
  tags: ['CRYPTO', 'TEST'],
  metricDescription: 'Test market for debugging the creation flow',
  iconUrl: '',
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function PresetEditor({
  preset,
  onChange,
  onReset,
}: {
  preset: PresetData;
  onChange: (p: PresetData) => void;
  onReset: () => void;
}) {
  const [tagInput, setTagInput] = useState('');

  const set = (key: keyof PresetData, value: string) =>
    onChange({ ...preset, [key]: value });

  const addTag = () => {
    const t = tagInput.trim().toUpperCase();
    if (t && !preset.tags.includes(t)) {
      onChange({ ...preset, tags: [...preset.tags, t] });
      setTagInput('');
    }
  };

  const removeTag = (tag: string) =>
    onChange({ ...preset, tags: preset.tags.filter((t) => t !== tag) });

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <label className="block">
        <div className="text-[10px] text-[#808080] mb-1">Symbol</div>
        <input
          className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white focus:border-[#333333] focus:outline-none"
          value={preset.symbol}
          onChange={(e) => set('symbol', e.target.value)}
          placeholder="TEST-USD"
        />
      </label>
      <label className="block">
        <div className="text-[10px] text-[#808080] mb-1">Start Price (USD)</div>
        <input
          className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white focus:border-[#333333] focus:outline-none"
          value={preset.startPrice}
          onChange={(e) => set('startPrice', e.target.value)}
          placeholder="42.50"
        />
      </label>
      <label className="block md:col-span-2">
        <div className="text-[10px] text-[#808080] mb-1">Description</div>
        <input
          className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white focus:border-[#333333] focus:outline-none"
          value={preset.metricDescription}
          onChange={(e) => set('metricDescription', e.target.value)}
          placeholder="Market description"
        />
      </label>
      <label className="block md:col-span-2">
        <div className="text-[10px] text-[#808080] mb-1">Metric URL</div>
        <input
          className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white focus:border-[#333333] focus:outline-none"
          value={preset.metricUrl}
          onChange={(e) => set('metricUrl', e.target.value)}
          placeholder="https://..."
        />
      </label>
      <label className="block">
        <div className="text-[10px] text-[#808080] mb-1">Data Source</div>
        <input
          className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white focus:border-[#333333] focus:outline-none"
          value={preset.dataSource}
          onChange={(e) => set('dataSource', e.target.value)}
          placeholder="CoinGecko API"
        />
      </label>
      <label className="block">
        <div className="text-[10px] text-[#808080] mb-1">Icon URL (optional)</div>
        <input
          className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white focus:border-[#333333] focus:outline-none"
          value={preset.iconUrl}
          onChange={(e) => set('iconUrl', e.target.value)}
          placeholder="https://..."
        />
      </label>
      <div className="md:col-span-2">
        <div className="text-[10px] text-[#808080] mb-1">Tags</div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {preset.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 bg-[#1A1A1A] text-[10px] text-white px-2 py-0.5 rounded-full"
            >
              {tag}
              <button
                onClick={() => removeTag(tag)}
                className="text-[#606060] hover:text-red-400"
              >
                ×
              </button>
            </span>
          ))}
          {preset.tags.length === 0 && (
            <span className="text-[10px] text-[#606060]">No tags</span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-[#222222] bg-[#111111] px-3 py-1.5 text-[12px] text-white focus:border-[#333333] focus:outline-none"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
            placeholder="Add tag"
          />
          <button
            onClick={addTag}
            className="rounded border border-[#222222] bg-[#141414] px-3 py-1.5 text-[11px] text-[#808080] hover:text-white hover:border-[#333333]"
          >
            Add
          </button>
        </div>
      </div>
      <div className="md:col-span-2 flex justify-end">
        <button
          onClick={onReset}
          className="rounded border border-[#333333] bg-[#141414] px-3 py-1.5 text-[11px] text-[#9CA3AF] hover:text-white hover:border-[#444444]"
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}

function FormPreview({ preset }: { preset: PresetData }) {
  const [highlightName, setHighlightName] = useState(false);
  const [highlightDesc, setHighlightDesc] = useState(false);

  const triggerHighlight = () => {
    setHighlightName(false);
    setHighlightDesc(false);
    requestAnimationFrame(() => {
      setHighlightName(true);
      setHighlightDesc(true);
      setTimeout(() => {
        setHighlightName(false);
        setHighlightDesc(false);
      }, 1200);
    });
  };

  const showRevealFields = Boolean(preset.metricUrl && preset.dataSource);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-[#606060]">
          This is a live preview of the market creation form with your preset values.
        </div>
        <button
          onClick={triggerHighlight}
          className="rounded border border-[#333333] bg-[#141414] px-2.5 py-1.5 text-[11px] text-[#9CA3AF] hover:text-white hover:border-[#444444]"
        >
          Test highlight animation
        </button>
      </div>

      <div className="bg-[#0F0F0F] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
        <div className="p-4 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
              Market Details
            </h4>
            <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
              {preset.tags.length} Tags
            </div>
          </div>

          {/* Name & Description */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-[#808080] mb-2">
                Name
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={preset.symbol}
                  readOnly
                  className={`w-full bg-[#1A1A1A] border ${highlightName ? 'border-red-500 ring-2 ring-red-500' : 'border-[#222222]'} rounded px-3 py-2 text-[11px] text-white placeholder-[#404040] focus:border-[#333333] focus:outline-none transition-colors`}
                />
                {highlightName && (
                  <span className="pointer-events-none absolute -right-1 -top-1 inline-flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-red-500/70 animate-[ping_0.6s_ease-out_2]" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                  </span>
                )}
              </div>
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-[#808080] mb-2">
                Description
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={preset.metricDescription}
                  readOnly
                  className={`w-full bg-[#1A1A1A] border ${highlightDesc ? 'border-red-500 ring-2 ring-red-500' : 'border-[#222222]'} rounded px-3 py-2 text-[11px] text-white placeholder-[#404040] focus:border-[#333333] focus:outline-none transition-colors`}
                />
                {highlightDesc && (
                  <span className="pointer-events-none absolute -right-1 -top-1 inline-flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-red-500/70 animate-[ping_0.6s_ease-out_2]" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* AI Assistant placeholder */}
          <div className="rounded border border-dashed border-[#333333] bg-[#0B0B0B] p-3">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-[11px] text-[#9CA3AF]">
                AI Market Metric Validator
              </span>
              <span className="text-[10px] text-[#606060] ml-auto">
                (Simulated — would analyze metric URL)
              </span>
            </div>
            <div className="mt-2 text-[10px] text-[#606060]">
              Metric URL: <span className="text-[#9CA3AF] break-all">{preset.metricUrl || '—'}</span>
            </div>
            <div className="mt-1 text-[10px] text-[#606060]">
              Status: <span className="text-green-400">Resolved</span> — Data Source: <span className="text-white">{preset.dataSource || '—'}</span>
            </div>
          </div>

          {/* Reveal fields */}
          {showRevealFields && (
            <>
              {/* Start Price and Source */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex-1">
                  <label className="block text-[11px] font-medium text-[#808080] mb-2">
                    Start Price (USD)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={preset.startPrice}
                      readOnly
                      className="flex-1 bg-[#1A1A1A] border border-[#222222] rounded px-3 py-2 text-[11px] text-white focus:border-[#333333] focus:outline-none transition-colors"
                    />
                    <button
                      type="button"
                      className="px-2.5 py-2 rounded text-[11px] border bg-[#1A1A1A] text-[#C0C0C0] border-[#222222] hover:border-[#333333]"
                    >
                      Get Price
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[11px] text-[#808080]">
                  <span className="truncate">Resolved Source</span>
                  <span className="text-white truncate max-w-[65%] text-right">{preset.dataSource || '—'}</span>
                </div>
              </div>

              {/* Market Icon */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#808080]">Market Icon</span>
                  <div className="flex items-center gap-2">
                    {preset.iconUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={preset.iconUrl} alt="Icon" className="w-6 h-6 rounded" />
                    ) : (
                      <div className="w-6 h-6 rounded bg-[#1A1A1A] border border-[#222222]" />
                    )}
                    <button
                      type="button"
                      className="px-2 py-1 bg-[#1A1A1A] border border-[#222222] rounded text-[11px] text-[#808080] hover:border-[#333333]"
                    >
                      Upload
                    </button>
                  </div>
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="block text-[11px] font-medium text-[#808080] mb-2">
                  Market Tags
                </label>
                <div className="flex gap-2 flex-wrap mb-2">
                  {preset.tags.map((tag) => (
                    <div
                      key={tag}
                      className="bg-[#1A1A1A] text-[10px] text-white px-2 py-0.5 rounded-full flex items-center gap-1.5"
                    >
                      <span>{tag}</span>
                      <span className="text-[#606060]">×</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Submit Button Preview */}
      <button
        type="button"
        className="w-full py-2.5 px-4 rounded-md text-[11px] font-medium bg-blue-500 hover:bg-blue-600 text-white transition-all duration-200"
      >
        Create Market
      </button>
    </div>
  );
}

function EmbeddedOverlayPreview({
  messages,
  activeIndex,
  percentComplete,
  title,
  subtitle,
  showSplash,
}: {
  messages: string[];
  activeIndex: number;
  percentComplete: number;
  title: string;
  subtitle: string;
  showSplash: boolean;
}) {
  const clampedIndex = Math.max(0, Math.min(activeIndex, Math.max(messages.length - 1, 0)));
  const completedMessages = messages.slice(0, Math.max(0, clampedIndex));
  const remainingMessages = messages.slice(clampedIndex);

  const previewFinalized = completedMessages.slice(Math.max(0, completedMessages.length - 3));
  const previewPending = remainingMessages.slice(0, 6);
  const moreFinalized = Math.max(0, completedMessages.length - previewFinalized.length);
  const morePending = Math.max(0, remainingMessages.length - previewPending.length);
  const progressWidth = `${clamp(percentComplete, 0, 100)}%`;

  return (
    <div className="relative w-full rounded-lg overflow-hidden">
      {/* Simulated backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm rounded-lg" />

      {/* Splash */}
      <div
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-500 z-10 ${showSplash ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
          <div className="text-xs text-[#9CA3AF] uppercase tracking-wide">{title}</div>
          <div className="text-[11px] text-[#808080] text-center max-w-[28rem]">{subtitle}</div>
        </div>
      </div>

      {/* Card */}
      <div
        className={`relative w-full flex items-center justify-center p-4 transition-opacity duration-500 ${showSplash ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      >
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-lg border border-[#222222] hover:border-[#333333] transition-all duration-200 w-full max-w-[640px] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400 animate-pulse" />
              <div className="min-w-0">
                <div className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide truncate leading-tight">
                  {title}
                </div>
                <div className="text-[10px] text-[#606060] truncate">{subtitle}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-24 h-1 bg-[#2A2A2A] rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-400 transition-all duration-300"
                  style={{ width: progressWidth }}
                />
              </div>
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            </div>
          </div>

          <div className="h-px bg-gradient-to-r from-blue-500/40 via-transparent to-transparent" />

          {/* Finalized */}
          <div className="px-4 pt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                Finalized deployments
              </div>
              <div className="text-[11px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                {completedMessages.length}/{messages.length}
              </div>
            </div>
            <div className="h-px bg-[#1A1A1A]" />
            <div className="mt-3 grid gap-2">
              {previewFinalized.length === 0 ? (
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                  <span className="text-xs text-[#808080] truncate">None yet</span>
                </div>
              ) : (
                previewFinalized.map((m, i) => (
                  <div key={`f-${i}`} className="flex items-center gap-2 min-w-0">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
                    <span className="text-xs text-white truncate leading-snug">{m}</span>
                  </div>
                ))
              )}
              {moreFinalized > 0 && (
                <div className="text-[11px] text-[#606060]">+{moreFinalized} more</div>
              )}
            </div>
          </div>

          <div className="mt-4 h-px bg-[#1A1A1A]" />

          {/* Pipeline */}
          <div className="px-4 pt-4 pb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                Progression of the deployment pipeline
              </div>
              <div className="text-[11px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                {clamp(percentComplete, 0, 100)}%
              </div>
            </div>
            <div className="h-px bg-[#1A1A1A]" />
            <div className="mt-3 grid gap-2">
              {previewPending.map((m, i) => (
                <div key={`p-${i}`} className="flex items-center justify-between gap-3 min-h-[2rem]">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${i === 0 ? 'bg-blue-400' : 'bg-[#404040]'}`}
                    />
                    <span className="text-sm text-white truncate leading-snug">{m}</span>
                  </div>
                  <span
                    className={`text-[11px] whitespace-nowrap ${i === 0 ? 'text-blue-400' : 'text-[#606060]'}`}
                  >
                    {i === 0 ? 'In Progress' : 'Pending'}
                  </span>
                </div>
              ))}
              {morePending > 0 && (
                <div className="text-[11px] text-[#606060]">+{morePending} more pending</div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="h-px bg-[#1A1A1A]" />
          <div className="px-4 py-3 flex items-center justify-end">
            <button className="text-sm text-white bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded px-3 py-2 transition-all duration-200">
              Continue in background
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmbeddedDockPreview({
  title,
  subtitle,
  messages,
  activeIndex,
  percentComplete,
  marketSymbol,
}: {
  title: string;
  subtitle: string;
  messages: string[];
  activeIndex: number;
  percentComplete: number;
  marketSymbol: string;
}) {
  const idx = clamp(activeIndex, 0, Math.max(messages.length - 1, 0));
  const msg = messages[idx] || 'Working…';
  const pct = clamp(percentComplete, 0, 100);

  return (
    <div className="flex justify-end">
      <div className="w-[360px] rounded-lg border border-[#222222] bg-[#0F0F0F] shadow-lg">
        <div className="flex items-start justify-between gap-3 p-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide truncate leading-tight">
              {title}
            </div>
            <div className="text-[11px] text-[#606060] truncate">{subtitle}</div>
            <div className="mt-2 text-sm text-white truncate leading-snug" title={msg}>
              {msg}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button className="h-6 w-6 rounded border border-[#222222] bg-[#111111] text-[#9CA3AF] hover:text-white hover:border-[#333333] transition-all duration-200 flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <button className="text-xs text-white bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded px-2.5 py-1.5 transition-all duration-200">
              View
            </button>
            {marketSymbol && (
              <button className="text-xs text-[#8a8a8a] hover:text-white bg-transparent border border-[#222222] hover:border-[#333333] rounded px-2.5 py-1.5 transition-all duration-200">
                Open market
              </button>
            )}
          </div>
        </div>
        <div className="h-px bg-[#1A1A1A]" />
        <div className="p-3">
          <div className="flex items-center justify-between text-xs text-[#808080]">
            <span>Progress</span>
            <span className="font-mono text-[#9CA3AF]">{pct}%</span>
          </div>
          <div className="mt-2 w-full h-1 bg-[#1A1A1A] rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-400 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function EmbeddedCompletionPreview({ marketSymbol }: { marketSymbol: string }) {
  return (
    <div className="flex justify-end">
      <div className="w-[380px] rounded-lg border border-[#222222] bg-[#0F0F0F] shadow-lg">
        <div className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-green-400 uppercase tracking-wide">
                Deployment complete
              </div>
              <div className="mt-1 text-sm text-white truncate leading-snug">
                {marketSymbol} is ready.
              </div>
            </div>
            <button className="text-xs text-[#606060] hover:text-white border border-[#222222] hover:border-[#333333] rounded px-2.5 py-1.5 transition-all duration-200">
              Dismiss
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="text-xs text-black bg-green-400 hover:bg-green-300 rounded px-3 py-2 transition-all duration-200">
              Open market
            </button>
            <button className="text-xs text-white bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded px-3 py-2 transition-all duration-200">
              Copy symbol
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DebugMarketCreationFlowPage() {
  const [preset, setPreset] = useState<PresetData>(DEFAULT_PRESET);
  const [activePhase, setActivePhase] = useState<Phase>('form');
  const [presetOpen, setPresetOpen] = useState(true);

  // Overlay state (for embedded preview + live trigger)
  const overlay = useDeploymentOverlay();
  const [overlayTitle, setOverlayTitle] = useState('Deployment Pipeline');
  const [overlaySubtitle, setOverlaySubtitle] = useState('Initializing market and registering oracle');
  const [overlayMessages, setOverlayMessages] = useState<string[]>(PIPELINE_MESSAGES);
  const [splashMs, setSplashMs] = useState(900);
  const [intervalMs, setIntervalMs] = useState(800);
  const [embeddedIdx, setEmbeddedIdx] = useState(0);
  const [showSplash, setShowSplash] = useState(false);

  // Auto-advance
  const autoTimerRef = useRef<number | null>(null);
  const idxRef = useRef(0);
  const liveIdxRef = useRef(0);
  const liveTimerRef = useRef<number | null>(null);

  const clearAutoTimer = useCallback(() => {
    if (autoTimerRef.current) {
      window.clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  }, []);

  const clearLiveTimer = useCallback(() => {
    if (liveTimerRef.current) {
      window.clearInterval(liveTimerRef.current);
      liveTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearAutoTimer();
      clearLiveTimer();
    };
  }, [clearAutoTimer, clearLiveTimer]);

  const embeddedPercent =
    overlayMessages.length > 0
      ? Math.min(100, Math.round(((embeddedIdx + 1) / overlayMessages.length) * 100))
      : 0;

  // Embedded overlay controls
  const embeddedStepOnce = useCallback(() => {
    setEmbeddedIdx((prev) => {
      const next = Math.min(prev + 1, Math.max(overlayMessages.length - 1, 0));
      idxRef.current = next;
      return next;
    });
  }, [overlayMessages.length]);

  const embeddedAutoRun = useCallback(() => {
    clearAutoTimer();
    autoTimerRef.current = window.setInterval(() => {
      const maxIdx = Math.max(overlayMessages.length - 1, 0);
      if (idxRef.current >= maxIdx) {
        clearAutoTimer();
        return;
      }
      setEmbeddedIdx((prev) => {
        const next = Math.min(prev + 1, maxIdx);
        idxRef.current = next;
        return next;
      });
    }, clamp(intervalMs, 150, 10000));
  }, [clearAutoTimer, overlayMessages.length, intervalMs]);

  const embeddedReset = useCallback(() => {
    clearAutoTimer();
    idxRef.current = 0;
    setEmbeddedIdx(0);
    setShowSplash(false);
  }, [clearAutoTimer]);

  const embeddedShowSplash = useCallback(() => {
    setShowSplash(true);
    setTimeout(() => setShowSplash(false), clamp(splashMs, 200, 5000));
  }, [splashMs]);

  // Live overlay (triggers actual global overlay)
  const openLiveOverlay = useCallback(() => {
    clearLiveTimer();
    liveIdxRef.current = 0;
    const pid = crypto.randomUUID?.() ?? `dbg-${Date.now()}`;
    overlay.open({
      title: overlayTitle,
      subtitle: overlaySubtitle,
      messages: overlayMessages,
      splashMs: Math.max(0, splashMs),
      meta: { pipelineId: pid, marketSymbol: preset.symbol.toUpperCase() },
    });
    overlay.update({
      activeIndex: 0,
      percentComplete: Math.round((1 / Math.max(overlayMessages.length, 1)) * 100),
    });
  }, [clearLiveTimer, overlay, overlayTitle, overlaySubtitle, overlayMessages, splashMs, preset.symbol]);

  const liveStepOnce = useCallback(() => {
    const next = liveIdxRef.current + 1;
    const maxIdx = Math.max(overlayMessages.length - 1, 0);
    liveIdxRef.current = clamp(next, 0, maxIdx);
    const percent = Math.min(
      100,
      Math.round(((liveIdxRef.current + 1) / Math.max(overlayMessages.length, 1)) * 100)
    );
    overlay.update({ activeIndex: liveIdxRef.current, percentComplete: percent });
  }, [overlay, overlayMessages.length]);

  const liveAutoRun = useCallback(() => {
    clearLiveTimer();
    liveTimerRef.current = window.setInterval(() => {
      const maxIdx = Math.max(overlayMessages.length - 1, 0);
      if (liveIdxRef.current >= maxIdx) {
        clearLiveTimer();
        overlay.fadeOutAndClose(450);
        return;
      }
      liveStepOnce();
    }, clamp(intervalMs, 150, 10000));
  }, [clearLiveTimer, overlay, liveStepOnce, intervalMs, overlayMessages.length]);

  const liveComplete = useCallback(() => {
    clearLiveTimer();
    liveIdxRef.current = Math.max(overlayMessages.length - 1, 0);
    overlay.update({ activeIndex: liveIdxRef.current, percentComplete: 100 });
    overlay.fadeOutAndClose(450);
  }, [clearLiveTimer, overlay, overlayMessages.length]);

  const runFullSimulation = useCallback(() => {
    setActivePhase('form');
    clearAutoTimer();
    clearLiveTimer();

    setTimeout(() => {
      setActivePhase('overlay');
      openLiveOverlay();

      setTimeout(() => {
        liveAutoRun();
      }, clamp(splashMs, 200, 5000) + 200);
    }, 1500);
  }, [clearAutoTimer, clearLiveTimer, openLiveOverlay, liveAutoRun, splashMs]);

  return (
    <div className="mx-auto max-w-5xl p-4 pb-20">
      {/* Header */}
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-[12px] font-medium text-white">
              Debug: Market Creation Flow
            </div>
            <div className="mt-1 text-[11px] text-[#9CA3AF]">
              Walk through every step of the market creation process with preset values.
              Edit UI aspects from the input form through to the deployment overlay.
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <a
              className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-white hover:bg-[#1A1A1A]"
              href="/debug"
            >
              Debug Index
            </a>
            <a
              className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-white hover:bg-[#1A1A1A]"
              href="/debug/deployment-overlay"
            >
              Deployment Overlay
            </a>
          </div>
        </div>
      </div>

      {/* Preset Data Editor */}
      <div className="mt-4 rounded-md border border-[#222222] bg-[#0F0F0F]">
        <button
          onClick={() => setPresetOpen(!presetOpen)}
          className="w-full flex items-center justify-between p-4 text-left"
        >
          <div>
            <div className="text-[12px] font-medium text-white">Preset Values</div>
            <div className="text-[10px] text-[#606060]">
              Edit the data that flows through each phase of market creation
            </div>
          </div>
          <svg
            className={`w-4 h-4 text-[#808080] transition-transform duration-200 ${presetOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {presetOpen && (
          <div className="px-4 pb-4 border-t border-[#1A1A1A] pt-3">
            <PresetEditor
              preset={preset}
              onChange={setPreset}
              onReset={() => setPreset(DEFAULT_PRESET)}
            />
          </div>
        )}
      </div>

      {/* Phase Tabs */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {PHASES.map((phase) => (
          <button
            key={phase.id}
            onClick={() => setActivePhase(phase.id)}
            className={`rounded px-3 py-2 text-[12px] font-medium transition-all duration-200 ${
              activePhase === phase.id
                ? 'bg-white text-black'
                : 'border border-[#333333] bg-[#141414] text-[#9CA3AF] hover:text-white hover:bg-[#1A1A1A]'
            }`}
          >
            <span className="text-[10px] opacity-60 mr-1.5">{phase.num}</span>
            {phase.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={runFullSimulation}
          className="rounded bg-blue-500 px-3 py-2 text-[12px] font-medium text-white hover:bg-blue-400"
        >
          Run Full Simulation
        </button>
      </div>

      {/* Phase Content */}
      <div className="mt-4">
        {/* Phase 1: Form Input */}
        {activePhase === 'form' && (
          <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[12px] font-medium text-white">
                  Phase 1: Market Input Form
                </div>
                <div className="mt-1 text-[11px] text-[#606060]">
                  Live preview of the CreateMarketForm with your preset values.
                  All fields reflect the preset data editor above.
                </div>
              </div>
              <button
                onClick={() => setActivePhase('overlay')}
                className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[11px] text-white hover:bg-[#1A1A1A]"
              >
                Next: Deployment Overlay →
              </button>
            </div>
            <div className="border border-[#1A1A1A] rounded-lg p-4 bg-[#0B0B0B]">
              <FormPreview preset={preset} />
            </div>
          </div>
        )}

        {/* Phase 2: Deployment Overlay */}
        {activePhase === 'overlay' && (
          <div className="space-y-4">
            {/* Overlay controls */}
            <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
              <div className="text-[12px] font-medium text-white mb-1">
                Phase 2: Deployment Overlay
              </div>
              <div className="text-[11px] text-[#606060] mb-4">
                The full-screen overlay shown during market deployment.
                Use the embedded preview below or trigger the real overlay.
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <div className="text-[10px] text-[#808080] mb-1">Overlay Title</div>
                  <input
                    className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white focus:border-[#333333] focus:outline-none"
                    value={overlayTitle}
                    onChange={(e) => setOverlayTitle(e.target.value)}
                  />
                </label>
                <label className="block">
                  <div className="text-[10px] text-[#808080] mb-1">Overlay Subtitle</div>
                  <input
                    className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white focus:border-[#333333] focus:outline-none"
                    value={overlaySubtitle}
                    onChange={(e) => setOverlaySubtitle(e.target.value)}
                  />
                </label>
                <label className="block">
                  <div className="text-[10px] text-[#808080] mb-1">Splash Duration (ms)</div>
                  <input
                    className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white focus:border-[#333333] focus:outline-none"
                    value={String(splashMs)}
                    onChange={(e) => setSplashMs(Number(e.target.value) || 0)}
                  />
                </label>
                <label className="block">
                  <div className="text-[10px] text-[#808080] mb-1">Auto-advance Interval (ms)</div>
                  <input
                    className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white focus:border-[#333333] focus:outline-none"
                    value={String(intervalMs)}
                    onChange={(e) => setIntervalMs(Number(e.target.value) || 800)}
                  />
                </label>
              </div>

              {/* Embedded preview controls */}
              <div className="mt-4 flex items-center justify-between">
                <div className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wide">
                  Embedded Preview
                </div>
                <div className="text-[11px] text-[#606060]">
                  Step {embeddedIdx + 1}/{overlayMessages.length} · {embeddedPercent}%
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={embeddedShowSplash}
                  className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] text-white hover:bg-[#1A1A1A]"
                >
                  Show Splash
                </button>
                <button
                  onClick={embeddedStepOnce}
                  className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] text-white hover:bg-[#1A1A1A]"
                >
                  Step +1
                </button>
                <button
                  onClick={embeddedAutoRun}
                  className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] text-white hover:bg-[#1A1A1A]"
                >
                  Auto-run
                </button>
                <button
                  onClick={clearAutoTimer}
                  className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] text-white hover:bg-[#1A1A1A]"
                >
                  Stop
                </button>
                <button
                  onClick={embeddedReset}
                  className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] text-[#9CA3AF] hover:text-white hover:bg-[#1A1A1A]"
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Embedded overlay preview */}
            <div className="rounded-md border border-[#222222] bg-[#080808] overflow-hidden">
              <EmbeddedOverlayPreview
                messages={overlayMessages}
                activeIndex={embeddedIdx}
                percentComplete={embeddedPercent}
                title={overlayTitle}
                subtitle={overlaySubtitle}
                showSplash={showSplash}
              />
            </div>

            {/* Live overlay trigger */}
            <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
              <div className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wide mb-3">
                Live Overlay (Triggers Real Global Overlay)
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={openLiveOverlay}
                  className="rounded bg-blue-500 px-3 py-2 text-[12px] font-medium text-white hover:bg-blue-400"
                >
                  Open Live Overlay
                </button>
                <button
                  onClick={liveStepOnce}
                  className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] text-white hover:bg-[#1A1A1A]"
                >
                  Step +1
                </button>
                <button
                  onClick={() => overlay.update({ transactionSigned: true })}
                  className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] text-white hover:bg-[#1A1A1A]"
                >
                  Simulate Tx Signed
                </button>
                <button
                  onClick={liveAutoRun}
                  className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] text-white hover:bg-[#1A1A1A]"
                >
                  Auto-run
                </button>
                <button
                  onClick={() => overlay.minimize()}
                  className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] text-white hover:bg-[#1A1A1A]"
                >
                  Minimize to Dock
                </button>
                <button
                  onClick={liveComplete}
                  className="rounded bg-green-500 px-3 py-2 text-[12px] font-medium text-black hover:bg-green-400"
                >
                  Complete
                </button>
                <button
                  onClick={() => {
                    clearLiveTimer();
                    overlay.close();
                  }}
                  className="rounded border border-red-500/40 bg-[#141414] px-3 py-2 text-[12px] text-red-300 hover:bg-[#1A1A1A]"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Phase 3: Dock View */}
        {activePhase === 'dock' && (
          <div className="space-y-4">
            <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
              <div className="text-[12px] font-medium text-white mb-1">
                Phase 3: Dock / Background View
              </div>
              <div className="text-[11px] text-[#606060] mb-4">
                When the user clicks &quot;Continue in background&quot;, the overlay minimizes to this
                dock in the bottom-right corner. Progress continues updating in real time.
              </div>

              <div className="grid gap-3 md:grid-cols-3 mb-4">
                <label className="block">
                  <div className="text-[10px] text-[#808080] mb-1">Active Step</div>
                  <input
                    type="range"
                    min={0}
                    max={overlayMessages.length - 1}
                    value={embeddedIdx}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setEmbeddedIdx(val);
                      idxRef.current = val;
                    }}
                    className="w-full"
                  />
                  <div className="text-[10px] text-[#606060] mt-1">
                    Step {embeddedIdx + 1} of {overlayMessages.length}
                  </div>
                </label>
                <label className="block">
                  <div className="text-[10px] text-[#808080] mb-1">Market Symbol</div>
                  <input
                    className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white focus:border-[#333333] focus:outline-none"
                    value={preset.symbol}
                    readOnly
                  />
                </label>
                <div className="flex items-end">
                  <button
                    onClick={() => {
                      openLiveOverlay();
                      setTimeout(() => overlay.minimize(), 100);
                    }}
                    className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] text-white hover:bg-[#1A1A1A]"
                  >
                    Show Live Dock
                  </button>
                </div>
              </div>
            </div>

            {/* Embedded dock preview */}
            <div className="rounded-md border border-[#222222] bg-[#080808] p-6">
              <div className="text-[10px] text-[#606060] mb-3 uppercase tracking-wide">
                Dock Preview (positioned inline for preview)
              </div>
              <EmbeddedDockPreview
                title={overlayTitle}
                subtitle={overlaySubtitle}
                messages={overlayMessages}
                activeIndex={embeddedIdx}
                percentComplete={embeddedPercent}
                marketSymbol={preset.symbol.toUpperCase()}
              />
            </div>
          </div>
        )}

        {/* Phase 4: Completion */}
        {activePhase === 'complete' && (
          <div className="space-y-4">
            <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
              <div className="text-[12px] font-medium text-white mb-1">
                Phase 4: Completion Notice
              </div>
              <div className="text-[11px] text-[#606060] mb-4">
                Shown after deployment finishes. Appears as a toast notification in the top-right
                corner with options to open the market or copy the symbol.
              </div>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  onClick={() => {
                    openLiveOverlay();
                    setTimeout(() => liveComplete(), 100);
                  }}
                  className="rounded bg-green-500 px-3 py-2 text-[12px] font-medium text-black hover:bg-green-400"
                >
                  Trigger Live Completion Notice
                </button>
              </div>
            </div>

            {/* Embedded completion preview */}
            <div className="rounded-md border border-[#222222] bg-[#080808] p-6">
              <div className="text-[10px] text-[#606060] mb-3 uppercase tracking-wide">
                Completion Notice Preview (positioned inline for preview)
              </div>
              <EmbeddedCompletionPreview marketSymbol={preset.symbol.toUpperCase()} />
            </div>
          </div>
        )}
      </div>

      {/* Pipeline Messages Editor */}
      <div className="mt-6 rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[12px] font-medium text-white">Pipeline Messages</div>
            <div className="text-[10px] text-[#606060]">
              Edit the deployment step messages shown in the overlay and dock
            </div>
          </div>
          <button
            onClick={() => setOverlayMessages(PIPELINE_MESSAGES)}
            className="rounded border border-[#333333] bg-[#141414] px-3 py-1.5 text-[11px] text-[#9CA3AF] hover:text-white hover:border-[#444444]"
          >
            Reset Messages
          </button>
        </div>
        <div className="space-y-1.5">
          {overlayMessages.map((msg, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[10px] text-[#606060] w-5 text-right font-mono">{i}</span>
              <input
                className="flex-1 rounded border border-[#222222] bg-[#111111] px-3 py-1.5 text-[12px] text-white focus:border-[#333333] focus:outline-none"
                value={msg}
                onChange={(e) => {
                  const updated = [...overlayMessages];
                  updated[i] = e.target.value;
                  setOverlayMessages(updated);
                }}
              />
              <button
                onClick={() => setOverlayMessages(overlayMessages.filter((_, j) => j !== i))}
                className="text-[#606060] hover:text-red-400 text-[11px] px-1"
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={() => setOverlayMessages([...overlayMessages, `Step ${overlayMessages.length}`])}
            className="mt-2 rounded border border-dashed border-[#333333] bg-[#0B0B0B] px-3 py-1.5 text-[11px] text-[#606060] hover:text-[#9CA3AF] hover:border-[#444444] w-full"
          >
            + Add Step
          </button>
        </div>
      </div>

      {/* State Inspector */}
      <details className="mt-4">
        <summary className="cursor-pointer text-[11px] text-[#606060] hover:text-[#9CA3AF]">
          State Inspector
        </summary>
        <div className="mt-2 rounded-md border border-[#222222] bg-[#0B0B0B] p-3">
          <pre className="text-[11px] text-[#9CA3AF] overflow-auto whitespace-pre-wrap">
            {JSON.stringify(
              {
                activePhase,
                preset,
                overlay: {
                  title: overlayTitle,
                  subtitle: overlaySubtitle,
                  messagesCount: overlayMessages.length,
                  splashMs,
                  intervalMs,
                  embeddedIdx,
                  embeddedPercent,
                },
                globalOverlayState: {
                  isVisible: overlay.state.isVisible,
                  displayMode: overlay.state.displayMode,
                  activeIndex: overlay.state.activeIndex,
                  percentComplete: overlay.state.percentComplete,
                  transactionSigned: overlay.state.transactionSigned,
                  meta: overlay.state.meta,
                },
              },
              null,
              2
            )}
          </pre>
        </div>
      </details>
    </div>
  );
}
