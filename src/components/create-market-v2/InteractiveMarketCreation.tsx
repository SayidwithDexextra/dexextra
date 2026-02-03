'use client';

import React from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { IconSparkles } from './icons';
import { MetricDiscoveryResponse } from '@/types/metricDiscovery';
import { MetricSourceBubble, MetricSourceOption } from './MetricSourceBubble';
import { IconSearchBubble } from './IconSearchBubble';
import { MarketExamplesCarousel } from './MarketExamplesCarousel';
import { MetricResolutionModal } from '@/components/MetricResolutionModal';
import type { MetricResolutionResponse } from '@/components/MetricResolutionModal/types';
import { runMetricAIWithPolling, getMetricAIWorkerBaseUrl, type MetricAIResult } from '@/lib/metricAiWorker';
import type { CreateMarketAssistantResponse } from '@/types/createMarketAssistant';
import { createMarketOnChain } from '@/lib/createMarketOnChain';
import { useDeploymentOverlay } from '@/contexts/DeploymentOverlayContext';
import { usePusher } from '@/lib/pusher-client';

type DiscoveryState = 'idle' | 'discovering' | 'success' | 'clarify' | 'rejected' | 'error';
type CreationStep = 'clarify_metric' | 'name' | 'description' | 'select_source' | 'icon' | 'complete';

function clampText(input: string, maxLen: number) {
  const trimmed = input.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function suggestMarketName(params: { metricName?: string; sourceLabel?: string }) {
  const base = params.metricName?.trim() || 'New Market';
  const withSource = params.sourceLabel ? `${base} • ${params.sourceLabel}` : base;
  return clampText(withSource, 56);
}

function suggestMarketDescription(params: {
  metricName?: string;
  measurementMethod?: string;
  sourceLabel?: string;
}) {
  const name = params.metricName?.trim() || 'this metric';
  const source = params.sourceLabel ? ` using ${params.sourceLabel}` : '';
  const method = params.measurementMethod?.trim();
  const body = method
    ? `A market tracking ${name}${source}. Measurement: ${method}.`
    : `A market tracking ${name}${source}.`;
  return clampText(body, 160);
}

function toModalResponse(ai: MetricAIResult, metric: string, processingMs: number): MetricResolutionResponse {
  const rawSources = Array.isArray(ai?.sources) ? ai.sources : [];
  const sources = rawSources
    .map((s: any) => ({
      url: String(s?.url || ''),
      screenshot_url: String(s?.screenshot_url || ''),
      quote: String(s?.quote || ''),
      match_score: typeof s?.match_score === 'number' ? s.match_score : 0.5,
      css_selector: s?.css_selector,
      xpath: s?.xpath,
      html_snippet: s?.html_snippet,
      js_extractor: s?.js_extractor,
    }))
    .filter((s: any) => Boolean(s?.url));

  return {
    status: 'completed',
    processingTime: `${processingMs}ms`,
    cached: false,
    data: {
      metric: String(ai?.metric || metric || ''),
      value: String(ai?.value || ''),
      unit: String(ai?.unit || ''),
      as_of: String(ai?.as_of || new Date().toISOString()),
      confidence: typeof ai?.confidence === 'number' ? ai.confidence : 0.5,
      asset_price_suggestion: String(ai?.asset_price_suggestion || ai?.value || ''),
      reasoning: String(ai?.reasoning || ''),
      sources,
    },
    performance: {
      totalTime: processingMs,
      breakdown: {
        cacheCheck: '0ms',
        scraping: '0ms',
        processing: `${processingMs}ms`,
        aiAnalysis: '0ms',
      },
    },
  };
}

function AssistantResponseBubble({
  text,
  isLoading,
}: {
  text: string;
  isLoading: boolean;
}) {
  const [displayedText, setDisplayedText] = React.useState('');
  const [isTyping, setIsTyping] = React.useState(false);
  const typingTimerRef = React.useRef<number | null>(null);
  const prevTextRef = React.useRef<string>('');

  React.useEffect(() => {
    // Respect reduced motion.
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // If the text didn't change, don't re-type.
    if (text === prevTextRef.current) return;
    prevTextRef.current = text;

    if (typingTimerRef.current) {
      window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }

    if (prefersReducedMotion) {
      setIsTyping(false);
      setDisplayedText(text);
      return;
    }

    setDisplayedText('');
    setIsTyping(true);
    let i = 0;

    const tick = () => {
      i += 1;
      setDisplayedText(text.slice(0, i));

      if (i >= text.length) {
        setIsTyping(false);
        return;
      }

      const ch = text[i - 1];
      // Typewriter cadence: steady with slight jitter, slower on punctuation/newlines.
      const base = 18 + Math.floor(Math.random() * 14); // 18–31ms
      const extra =
        ch === '\n' ? 120 : ch === '.' || ch === '!' || ch === '?' ? 90 : ch === ',' ? 50 : 0;

      typingTimerRef.current = window.setTimeout(tick, base + extra);
    };

    // Start with a tiny delay for “AI thinking” feel.
    typingTimerRef.current = window.setTimeout(tick, 220);

    return () => {
      if (typingTimerRef.current) {
        window.clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    };
  }, [text]);

  return (
    <div className="rounded-2xl border border-white/8 bg-[#0F0F0F] px-4 py-3 text-[13px] leading-relaxed text-white/85 shadow-lg whitespace-pre-wrap">
      {isLoading && !displayedText ? (
        <span className="text-white/65">
          Thinking<span className="inline-block w-[1ch] animate-pulse">.</span>
          <span className="inline-block w-[1ch] animate-pulse [animation-delay:120ms]">.</span>
          <span className="inline-block w-[1ch] animate-pulse [animation-delay:240ms]">.</span>
        </span>
      ) : (
        <>
          {displayedText}
          {isTyping ? <span className="ml-[2px] inline-block w-[8px] animate-pulse">▍</span> : null}
        </>
      )}
    </div>
  );
}

function StepPanel({
  step,
  isAnimating,
  message,
  isAssistantLoading,
  metricClarification,
  onChangeMetricClarification,
  onSubmitMetricClarification,
  marketName,
  onChangeName,
  onConfirmName,
  marketDescription,
  onChangeDescription,
  onConfirmDescription,
  iconPreviewUrl,
  onConfirmIcon,
  onStartOver,
  devTools,
}: {
  step: CreationStep;
  isAnimating: boolean;
  message: string;
  isAssistantLoading: boolean;
  metricClarification: string;
  onChangeMetricClarification: (v: string) => void;
  onSubmitMetricClarification: () => void;
  marketName: string;
  onChangeName: (v: string) => void;
  onConfirmName: () => void;
  marketDescription: string;
  onChangeDescription: (v: string) => void;
  onConfirmDescription: () => void;
  iconPreviewUrl: string | null;
  onConfirmIcon: () => void;
  onStartOver: () => void;
  devTools?: React.ReactNode;
}) {
  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && marketName.trim()) {
      e.preventDefault();
      onConfirmName();
    }
  };

  const handleDescriptionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && marketDescription.trim()) {
      e.preventDefault();
      onConfirmDescription();
    }
  };

  const handleClarificationKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && metricClarification.trim()) {
      e.preventDefault();
      onSubmitMetricClarification();
    }
  };

  const clarificationRef = React.useRef<HTMLTextAreaElement>(null);
  const descriptionRef = React.useRef<HTMLTextAreaElement>(null);

  const resizeTextarea = React.useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    // Hide scrollbar even if OS is set to always show scrollbars.
    el.style.overflowY = 'hidden';
    // Reset, then grow to content height.
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  React.useLayoutEffect(() => {
    if (step === 'clarify_metric') resizeTextarea(clarificationRef.current);
  }, [metricClarification, resizeTextarea, step]);

  React.useLayoutEffect(() => {
    if (step === 'description') resizeTextarea(descriptionRef.current);
  }, [marketDescription, resizeTextarea, step]);

  return (
    <div className="space-y-4">
      {/* Row 1: AI message on right side of page */}
      <div
        className={[
          'flex justify-end transition-all duration-200 ease-out',
          isAnimating ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0',
        ].join(' ')}
      >
        <div className="flex items-start gap-3 max-w-[520px]">
          <AssistantResponseBubble text={message} isLoading={isAssistantLoading} />
          <div className="mt-1 shrink-0 flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={onStartOver}
              className="text-[12px] text-white/55 hover:text-white/80 transition-colors"
            >
              Start over
            </button>
            {devTools ? <div className="relative">{devTools}</div> : null}
          </div>
        </div>
      </div>

      {/* Row 2: User input on left side of page */}
      <div
        className={[
          'flex justify-start transition-all duration-200 ease-out delay-75',
          isAnimating ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0',
        ].join(' ')}
      >
        <div className="rounded-2xl border border-white/8 bg-[#0A0A0A] px-4 py-3 shadow-lg w-full max-w-[520px]">
          {step === 'clarify_metric' ? (
            <div>
              <textarea
                ref={clarificationRef}
                value={metricClarification}
                onChange={(e) => onChangeMetricClarification(e.target.value)}
                onInput={() => resizeTextarea(clarificationRef.current)}
                onKeyDown={handleClarificationKeyDown}
                className="scrollbar-none w-full resize-none bg-transparent text-sm text-white placeholder:text-white/35 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 border-none !outline-none overflow-y-hidden"
                style={{ outline: 'none', boxShadow: 'none', minHeight: '7.5rem' }}
                rows={4}
                placeholder="Reply with a clarification (Shift+Enter for a new line)"
                autoFocus
              />
              <div className="mt-2 text-[11px] text-white/45">
                Press Enter to submit clarification
              </div>
            </div>
          ) : null}

          {step === 'name' ? (
            <div>
              <input
                value={marketName}
                onChange={(e) => onChangeName(e.target.value)}
                onKeyDown={handleNameKeyDown}
                className="w-full bg-transparent text-sm text-white placeholder:text-white/35 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 border-none !outline-none"
                style={{ outline: 'none', boxShadow: 'none' }}
                placeholder="Market name"
                autoFocus
              />
              <div className="mt-2 text-[11px] text-white/45">
                Press Enter to continue
              </div>
            </div>
          ) : null}

          {step === 'description' ? (
            <div>
              <textarea
                ref={descriptionRef}
                value={marketDescription}
                onChange={(e) => onChangeDescription(e.target.value)}
                onInput={() => resizeTextarea(descriptionRef.current)}
                onKeyDown={handleDescriptionKeyDown}
                className="scrollbar-none w-full resize-none bg-transparent text-sm text-white placeholder:text-white/35 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 border-none !outline-none overflow-y-hidden"
                style={{ outline: 'none', boxShadow: 'none', minHeight: '7.5rem' }}
                rows={4}
                placeholder="Market description"
                autoFocus
              />
              <div className="mt-2 text-[11px] text-white/45">
                Press Enter to continue
              </div>
            </div>
          ) : null}

          {step === 'select_source' ? (
            <div className="text-[12px] text-white/45">
              Select a data source below. Tip: hover a source to see reliability details.
            </div>
          ) : null}

          {step === 'icon' ? (
            <div className="flex items-center gap-3">
              {/* Preview */}
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border border-white/8 bg-black/40">
                {iconPreviewUrl ? (
                  <Image
                    src={iconPreviewUrl}
                    alt="Market icon preview"
                    width={48}
                    height={48}
                    className="h-full w-full object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-white/10 to-white/5" />
                )}
              </div>

              <div className="flex-1 text-sm text-white/60">
                {iconPreviewUrl ? 'Icon selected' : 'Select an icon below'}
              </div>

              <button
                type="button"
                onClick={onConfirmIcon}
                disabled={!iconPreviewUrl}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-white px-4 text-sm font-medium text-black transition-opacity disabled:opacity-50"
              >
                Done
              </button>
            </div>
          ) : null}

          {step === 'complete' ? (
            <div className="text-[12px] text-white/55">
              Review your market configuration below. When ready, confirm to generate the market parameters.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MarketDetailsReview({
  marketName,
  marketDescription,
  selectedSource,
  iconPreviewUrl,
  metricDefinition,
  onEdit,
  onStartOver,
  onCreateMarket,
  isCreating,
}: {
  marketName: string;
  marketDescription: string;
  selectedSource: MetricSourceOption | null;
  iconPreviewUrl: string | null;
  metricDefinition?: {
    metric_name?: string;
    unit?: string;
    scope?: string;
    time_basis?: string;
    measurement_method?: string;
  } | null;
  onEdit: (step: CreationStep) => void;
  onStartOver: () => void;
  onCreateMarket: () => void;
  isCreating: boolean;
}) {
  const [hasAnimated, setHasAnimated] = React.useState(false);

  React.useEffect(() => {
    const t = window.setTimeout(() => setHasAnimated(true), 50);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="mt-4 w-full max-w-[900px]">
      {/* Compact single-view layout */}
      <div
        className="rounded-2xl border border-white/8 bg-[#0A0A0A] overflow-hidden"
        style={{
          opacity: hasAnimated ? 1 : 0,
          transform: hasAnimated ? 'translateY(0)' : 'translateY(16px)',
          transition: 'opacity 0.4s ease-out, transform 0.4s ease-out',
        }}
      >
        {/* Header bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 bg-black/40">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 text-green-400"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
              </svg>
              <span className="text-sm font-medium text-white/90">Market Configuration</span>
            </div>
            <button
              type="button"
              onClick={onStartOver}
              className="text-[11px] text-white/40 hover:text-white/60 transition-colors"
            >
              Start over
            </button>
          </div>
          <button
            type="button"
            onClick={onCreateMarket}
            disabled={isCreating}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium shadow transition-all active:scale-[0.98] ${
              isCreating
                ? 'bg-white/50 text-black/50 cursor-not-allowed'
                : 'bg-white text-black hover:bg-white/90'
            }`}
          >
            {isCreating ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border border-black/20 border-t-black" />
                Creating...
              </>
            ) : (
              <>
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
                Create Market
              </>
            )}
          </button>
        </div>

        {/* Main content - 2 column grid */}
        <div className="grid grid-cols-[1fr_1.2fr] divide-x divide-white/5">
          {/* Left column - Identity */}
          <div className="p-4 space-y-3">
            {/* Icon + Name row */}
            <div className="flex items-start gap-3">
              {/* Icon */}
              <button
                type="button"
                onClick={() => onEdit('icon')}
                className="group relative shrink-0"
              >
                {iconPreviewUrl ? (
                  <div className="h-12 w-12 rounded-xl border border-white/8 bg-black/40 overflow-hidden shadow-lg transition-all group-hover:border-white/15">
                    <Image
                      src={iconPreviewUrl}
                      alt="Market icon"
                      width={48}
                      height={48}
                      className="h-full w-full object-cover"
                      unoptimized
                    />
                  </div>
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-white/15 bg-black/40 transition-all group-hover:border-white/25 group-hover:bg-black/60">
                    <svg viewBox="0 0 24 24" className="h-5 w-5 text-white/40" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                    </svg>
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-[10px] text-white font-medium">Edit</span>
                </div>
              </button>

              {/* Name + Description */}
              <div className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => onEdit('name')}
                  className="group w-full text-left"
                >
                  <div className="text-base font-medium text-white leading-tight truncate group-hover:text-white/80 transition-colors">
                    {marketName || <span className="text-white/40 italic text-sm">Untitled market</span>}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onEdit('description')}
                  className="group w-full text-left mt-1"
                >
                  <div className="text-xs text-white/60 leading-relaxed line-clamp-2 group-hover:text-white/70 transition-colors">
                    {marketDescription || <span className="text-white/40 italic">No description</span>}
                  </div>
                </button>
              </div>
            </div>

            {/* Data Source */}
            <button
              type="button"
              onClick={() => onEdit('select_source')}
              className="group w-full rounded-xl border border-white/5 bg-black/30 p-3 text-left transition-all hover:border-white/10 hover:bg-black/40"
            >
              <div className="text-[10px] font-medium text-white/40 uppercase tracking-wider mb-2">Data Source</div>
              {selectedSource ? (
                <div className="flex items-center gap-2.5">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white shadow ${selectedSource.iconBg}`}>
                    {selectedSource.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">
                      {selectedSource.label}
                    </div>
                    <div className="text-[10px] text-white/40 truncate">
                      {selectedSource.sublabel || new URL(selectedSource.url).hostname}
                    </div>
                  </div>
                  {selectedSource.badge && (
                    <span className="shrink-0 rounded-full bg-blue-500/20 border border-blue-500/30 px-1.5 py-0.5 text-[9px] font-medium text-blue-300">
                      {selectedSource.badge}
                    </span>
                  )}
                </div>
              ) : (
                <div className="text-xs text-white/40 italic">No source selected</div>
              )}
            </button>

            {/* Source confidence bar */}
            {selectedSource && (
              <div className="flex items-center gap-4 px-1">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-white/40">Confidence</span>
                    <span className="text-[10px] text-white font-medium">{Math.round(selectedSource.confidence * 100)}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-black/60 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.round(selectedSource.confidence * 100)}%`,
                        backgroundColor:
                          selectedSource.confidence >= 0.85
                            ? '#22c55e'
                            : selectedSource.confidence >= 0.7
                            ? '#eab308'
                            : '#ef4444',
                      }}
                    />
                  </div>
                </div>
                <div className="text-[10px]">
                  <span className="text-white/40">Type: </span>
                  <span className="text-white/70">{selectedSource.tooltip?.dataType || 'Web'}</span>
                </div>
              </div>
            )}
          </div>

          {/* Right column - Metric details */}
          <div className="p-4 bg-black/20">
            <button
              type="button"
              onClick={() => onEdit('clarify_metric')}
              className="group w-full text-left"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] font-medium text-white/40 uppercase tracking-wider">Metric Definition</div>
                <span className="text-[10px] text-white/30 opacity-0 group-hover:opacity-100 transition-opacity">Edit</span>
              </div>
            </button>

            {metricDefinition?.metric_name ? (
              <div className="space-y-3">
                {/* Metric name */}
                <div className="text-sm font-medium text-white">{metricDefinition.metric_name}</div>

                {/* Grid of metric properties */}
                <div className="grid grid-cols-3 gap-3">
                  {metricDefinition.unit && (
                    <div className="rounded-lg bg-black/40 border border-white/5 px-2.5 py-2">
                      <div className="text-[9px] text-white/40 uppercase tracking-wider mb-0.5">Unit</div>
                      <div className="text-xs text-white truncate">{metricDefinition.unit}</div>
                    </div>
                  )}
                  {metricDefinition.scope && (
                    <div className="rounded-lg bg-black/40 border border-white/5 px-2.5 py-2">
                      <div className="text-[9px] text-white/40 uppercase tracking-wider mb-0.5">Scope</div>
                      <div className="text-xs text-white truncate">{metricDefinition.scope}</div>
                    </div>
                  )}
                  {metricDefinition.time_basis && (
                    <div className="rounded-lg bg-black/40 border border-white/5 px-2.5 py-2">
                      <div className="text-[9px] text-white/40 uppercase tracking-wider mb-0.5">Time Basis</div>
                      <div className="text-xs text-white truncate">{metricDefinition.time_basis}</div>
                    </div>
                  )}
                </div>

                {/* Measurement method */}
                {metricDefinition.measurement_method && (
                  <div className="rounded-lg bg-black/40 border border-white/5 px-2.5 py-2">
                    <div className="text-[9px] text-white/40 uppercase tracking-wider mb-1">Measurement Method</div>
                    <div className="text-xs text-white/70 leading-relaxed line-clamp-3">
                      {metricDefinition.measurement_method}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-24 text-xs text-white/30 italic">
                No metric definition available
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function InteractiveMarketCreation() {
  const devToolsEnabled =
    process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DEV_TOOLS === 'true';
  const [devToolsOpen, setDevToolsOpen] = React.useState(false);

  const DEV_SELECT_SOURCE_PRESET: NonNullable<MetricDiscoveryResponse['sources']> = {
    primary_source: {
      url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      authority: 'CoinGecko',
      confidence: 0.95,
    },
    secondary_sources: [
      {
        url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
        authority: 'Binance',
        confidence: 0.92,
      },
      {
        url: 'https://data.chain.link/ethereum/mainnet/crypto-usd/btc-usd',
        authority: 'Chainlink',
        confidence: 0.94,
      },
      {
        url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
        authority: 'Coinbase',
        confidence: 0.91,
      },
      {
        url: 'https://pyth.network/price-feeds',
        authority: 'Pyth',
        confidence: 0.89,
      },
    ],
  };

  const [prompt, setPrompt] = React.useState('');
  const [isFocused, setIsFocused] = React.useState(false);
  const [discoveryState, setDiscoveryState] = React.useState<DiscoveryState>('idle');
  const [discoveryResult, setDiscoveryResult] = React.useState<MetricDiscoveryResponse | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [sourcesFetchState, setSourcesFetchState] = React.useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [sourcesFetchNonce, setSourcesFetchNonce] = React.useState(0);
  const [selectedSource, setSelectedSource] = React.useState<MetricSourceOption | null>(null);
  const [marketName, setMarketName] = React.useState('');
  const [marketDescription, setMarketDescription] = React.useState('');
  const [isNameConfirmed, setIsNameConfirmed] = React.useState(false);
  const [isDescriptionConfirmed, setIsDescriptionConfirmed] = React.useState(false);
  const [iconFile, setIconFile] = React.useState<File | null>(null);
  const [iconPreviewUrl, setIconPreviewUrl] = React.useState<string | null>(null);
  const [isIconConfirmed, setIsIconConfirmed] = React.useState(false);
  const [nameTouched, setNameTouched] = React.useState(false);
  const [descriptionTouched, setDescriptionTouched] = React.useState(false);

  // Validation state
  const [isValidating, setIsValidating] = React.useState(false);
  const [validationResult, setValidationResult] = React.useState<MetricResolutionResponse | null>(null);
  const [showValidationModal, setShowValidationModal] = React.useState(false);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  // Market creation state
  const [isCreatingMarket, setIsCreatingMarket] = React.useState(false);
  const router = useRouter();
  const deploymentOverlay = useDeploymentOverlay();
  const pusher = usePusher();

  // Create Market assistant state
  const [assistantMessage, setAssistantMessage] = React.useState<string>('');
  const [assistantIsLoading, setAssistantIsLoading] = React.useState(false);
  const [assistantHistory, setAssistantHistory] = React.useState<Array<{ role: 'system' | 'user' | 'assistant'; content: string }>>([]);

  const [metricClarification, setMetricClarification] = React.useState('');

  const [visibleStep, setVisibleStep] = React.useState<CreationStep>('clarify_metric');
  const [isStepAnimating, setIsStepAnimating] = React.useState(false);
  const stepTimerRef = React.useRef<number | null>(null);

  const metricName = discoveryResult?.metric_definition?.metric_name;

  const promptRef = React.useRef(prompt);
  const marketNameRef = React.useRef(marketName);
  const marketDescriptionRef = React.useRef(marketDescription);
  const lastAssistantRequestKeyRef = React.useRef<string>('');

  React.useEffect(() => {
    promptRef.current = prompt;
  }, [prompt]);

  React.useEffect(() => {
    marketNameRef.current = marketName;
  }, [marketName]);

  React.useEffect(() => {
    marketDescriptionRef.current = marketDescription;
  }, [marketDescription]);

  const assistantRequestKey = React.useMemo(() => {
    if ((discoveryState !== 'success' && discoveryState !== 'clarify') || !discoveryResult) return '';
    return JSON.stringify({
      step: visibleStep,
      discoveryState,
      measurable: Boolean(discoveryResult.measurable),
      rejection: discoveryResult.rejection_reason ?? '',
      metricName: discoveryResult.metric_definition?.metric_name ?? '',
      selectedUrl: selectedSource?.url ?? '',
    });
    // Intentionally exclude `discoveryResult.sources/search_results` so source fetching doesn't retrigger typing.
  }, [
    discoveryResult?.measurable,
    discoveryResult?.rejection_reason,
    discoveryResult?.metric_definition?.metric_name,
    discoveryState,
    selectedSource?.url,
    visibleStep,
  ]);

  const ensureDevDiscovery = React.useCallback((): MetricDiscoveryResponse => {
    if (discoveryResult?.metric_definition) return discoveryResult;

    const idea = (promptRef.current || prompt || 'Example metric').trim() || 'Example metric';
    const stub: MetricDiscoveryResponse = {
      measurable: true,
      metric_definition: {
        metric_name: idea,
        unit: '',
        scope: '',
        time_basis: '',
        measurement_method: '',
      },
      assumptions: [],
      sources: null,
      rejection_reason: null,
      search_results: [],
      processing_time_ms: 0,
    };

    setDiscoveryResult(stub);
    return stub;
  }, [discoveryResult, prompt]);

  const devEnsureSelectedSource = React.useCallback(() => {
    if (selectedSource?.url) return selectedSource;
    const d = discoveryResult || ensureDevDiscovery();
    const primary = d.sources?.primary_source;
    const url = primary?.url || 'https://example.com';
    const host = (() => {
      try {
        return new URL(url).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    })();

    const devSource: MetricSourceOption = {
      id: 'dev-source',
      icon: (
        <div className="relative h-7 w-7">
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/15 text-white/90">
            <span className="text-[14px] font-semibold">D</span>
          </div>
        </div>
      ),
      label: primary?.authority || 'Dev Source',
      sublabel: host || undefined,
      url,
      confidence: primary?.confidence ?? 0,
      authority: primary?.authority || 'Dev',
      badge: 'Dev',
      iconBg: 'bg-gradient-to-br from-gray-500 to-gray-700',
      tooltip: {
        name: 'Dev Source',
        description: 'Developer-injected source (skip control).',
        reliability: 'Dev',
        updateFrequency: 'Unknown',
        dataType: 'Web/API',
      },
    };

    setSelectedSource(devSource);
    return devSource;
  }, [discoveryResult, ensureDevDiscovery, selectedSource]);

  const devJumpToStep = React.useCallback(
    (step: CreationStep) => {
      // Ensure we can render the chat UI.
      ensureDevDiscovery();
      setErrorMessage(null);
      setDiscoveryState(step === 'clarify_metric' ? 'clarify' : 'success');

      // Reset the "downstream" state so desiredStep matches the jump target.
      if (step === 'clarify_metric') {
        setIsNameConfirmed(false);
        setIsDescriptionConfirmed(false);
        setSelectedSource(null);
        setIsIconConfirmed(false);
        setSourcesFetchState('idle');
        return;
      }

      if (step === 'name') {
        setIsNameConfirmed(false);
        setIsDescriptionConfirmed(false);
        setSelectedSource(null);
        setIsIconConfirmed(false);
        setSourcesFetchState('idle');
        return;
      }

      // Ensure name exists (helps render).
      const metric = discoveryResult?.metric_definition?.metric_name || promptRef.current;
      if (!marketNameRef.current?.trim() && metric) {
        setMarketName(suggestMarketName({ metricName: metric }));
      }

      if (step === 'description') {
        setIsNameConfirmed(true);
        setIsDescriptionConfirmed(false);
        setSelectedSource(null);
        setIsIconConfirmed(false);
        setSourcesFetchState('idle');
        return;
      }

      // Ensure description exists (helps render).
      const method = discoveryResult?.metric_definition?.measurement_method;
      if (!marketDescriptionRef.current?.trim() && metric) {
        setMarketDescription(
          suggestMarketDescription({
            metricName: metric,
            measurementMethod: method,
          })
        );
      }

      if (step === 'select_source') {
        setIsNameConfirmed(true);
        setIsDescriptionConfirmed(true);
        setSelectedSource(null);
        setIsIconConfirmed(false);
        // Dev track: do NOT make any searches. Provide a deterministic, hardcoded set of sources.
        if (devToolsEnabled) {
          setDiscoveryResult((prev) => {
            const base = prev || ensureDevDiscovery();
            return {
              ...base,
              measurable: true,
              rejection_reason: null,
              sources: DEV_SELECT_SOURCE_PRESET,
              search_results: [],
            };
          });
          setSourcesFetchState('success');
        } else {
          // Non-dev: trigger source fetch.
          setSourcesFetchState('idle');
          setSourcesFetchNonce((n) => n + 1);
        }
        return;
      }

      if (step === 'icon') {
        setIsNameConfirmed(true);
        setIsDescriptionConfirmed(true);
        devEnsureSelectedSource();
        setIsIconConfirmed(false);
        return;
      }

      if (step === 'complete') {
        setIsNameConfirmed(true);
        setIsDescriptionConfirmed(true);
        devEnsureSelectedSource();
        setIsIconConfirmed(true);
      }
    },
    [
      devEnsureSelectedSource,
      discoveryResult,
      ensureDevDiscovery,
      marketDescriptionRef,
      marketNameRef,
      promptRef,
      setSourcesFetchNonce,
    ]
  );

  const runDefineOnlyDiscovery = async (description: string) => {
    setDiscoveryState('discovering');
    setErrorMessage(null);
    setSourcesFetchState('idle');
    setSelectedSource(null);
    setIsValidating(false);
    setValidationResult(null);
    setShowValidationModal(false);
    setValidationError(null);

    try {
      const response = await fetch('/api/metric-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, mode: 'define_only' }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Discovery failed');

      setDiscoveryResult(data);

      if (data.measurable) {
        setMetricClarification('');
        setDiscoveryState('success');
      } else {
        // Enter clarification loop rather than hard reject.
        setDiscoveryState('clarify');
      }
    } catch (error) {
      console.error('Discovery error:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to discover metric');
      setDiscoveryState('error');
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setMarketName('');
    setMarketDescription('');
    setIsNameConfirmed(false);
    setIsDescriptionConfirmed(false);
    setIconFile(null);
    setIconPreviewUrl(null);
    setIsIconConfirmed(false);
    setNameTouched(false);
    setDescriptionTouched(false);
    // Reset assistant state
    setAssistantMessage('');
    setAssistantIsLoading(false);
    setAssistantHistory([{ role: 'user', content: prompt.trim() }]);

    await runDefineOnlyDiscovery(prompt);
  };

  const handleReset = () => {
    setDiscoveryState('idle');
    setDiscoveryResult(null);
    setErrorMessage(null);
    setPrompt('');
    setSourcesFetchState('idle');
    setSelectedSource(null);
    setMarketName('');
    setMarketDescription('');
    setIsNameConfirmed(false);
    setIsDescriptionConfirmed(false);
    setIconFile(null);
    setIconPreviewUrl(null);
    setIsIconConfirmed(false);
    setNameTouched(false);
    setDescriptionTouched(false);
    setMetricClarification('');
    // Reset validation state
    setIsValidating(false);
    setValidationResult(null);
    setShowValidationModal(false);
    setValidationError(null);
    // Reset assistant state
    setAssistantMessage('');
    setAssistantIsLoading(false);
    setAssistantHistory([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleGenerate();
    }
  };

  // Gasless market creation pipeline (mirrors CreateMarketPage logic)
  const gaslessEnabled = String(
    (process.env as any).NEXT_PUBLIC_GASLESS_CREATE_ENABLED ||
    (globalThis as any)?.process?.env?.NEXT_PUBLIC_GASLESS_CREATE_ENABLED ||
    ''
  ).toLowerCase() === 'true';

  const pipelineMessages: string[] = gaslessEnabled
    ? [
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
      ]
    : [
        'Fetch facet cut configuration',
        'Build initializer and selectors',
        'Preflight validation (static call)',
        'Submit create transaction',
        'Wait for confirmation',
        'Parse FuturesMarketCreated event',
        'Verify required selectors',
        'Patch missing selectors if needed',
        'Grant admin roles on CoreVault',
        'Saving market metadata',
        'Finalize deployment',
      ];

  const stepIndexMap: Record<string, number> = {
    cut_fetch: 0,
    cut_build: 1,
    static_call: 2,
    send_tx: 3,
    confirm: gaslessEnabled ? 5 : 4,
    parse_event: gaslessEnabled ? 6 : 5,
    verify_selectors: gaslessEnabled ? 7 : 6,
    diamond_cut: gaslessEnabled ? 8 : 7,
    meta_prepare: 2,
    meta_signature: 3,
    relayer_submit: 4,
    facet_cut_built: 1,
    factory_static_call_meta: 2,
    factory_static_call: 2,
    factory_send_tx_meta: 4,
    factory_send_tx: 3,
    factory_send_tx_meta_sent: 4,
    factory_send_tx_sent: 3,
    factory_confirm_meta: 5,
    factory_confirm_meta_mined: 5,
    factory_confirm: gaslessEnabled ? 5 : 4,
    factory_confirm_mined: gaslessEnabled ? 5 : 4,
    ensure_selectors: 7,
    ensure_selectors_missing: 8,
    ensure_selectors_diamondCut_sent: 8,
    ensure_selectors_diamondCut_mined: 8,
    attach_session_registry: 9,
    attach_session_registry_sent: 9,
    attach_session_registry_mined: 9,
    grant_roles: 10,
    grant_ORDERBOOK_ROLE_sent: 10,
    grant_ORDERBOOK_ROLE_mined: 10,
    grant_SETTLEMENT_ROLE_sent: 10,
    grant_SETTLEMENT_ROLE_mined: 10,
    save_market: 11,
  };

  const updateOverlayIndex = React.useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(idx, pipelineMessages.length - 1));
    const percent = Math.min(100, Math.round(((clamped + 1) / Math.max(pipelineMessages.length, 1)) * 100));
    deploymentOverlay.update({ activeIndex: clamped, percentComplete: percent });
  }, [deploymentOverlay, pipelineMessages.length]);

  const handleCreateMarket = React.useCallback(async () => {
    if (!selectedSource || !marketName.trim()) return;

    setIsCreatingMarket(true);
    let unsubscribePusher: (() => void) | null = null;

    try {
      const INITIAL_SPLASH_MS = 1200;
      const symbol = marketName.trim().replace(/\s+/g, '-').toUpperCase();
      const metricUrl = selectedSource.url;
      const dataSource = selectedSource.authority || selectedSource.label || 'User Provided';
      const tags: string[] = [];
      let sourceLocator: { url: string; css_selector?: string; xpath?: string; html_snippet?: string; js_extractor?: string } | null = null;
      let startPrice = validationResult?.data?.asset_price_suggestion || validationResult?.data?.value || '1';

      // Try to get start price from AI worker if not already available
      const workerUrl = getMetricAIWorkerBaseUrl();
      if (workerUrl && metricUrl) {
        try {
          const ai = await runMetricAIWithPolling(
            {
              metric: symbol,
              urls: [metricUrl],
              related_market_identifier: symbol,
              context: 'create',
            },
            { intervalMs: 2000, timeoutMs: 60000 } // Increased for screenshot + vision analysis
          );
          if (ai) {
            const suggested = ai.asset_price_suggestion || ai.value;
            if (suggested && !Number.isNaN(Number(suggested))) {
              startPrice = String(suggested);
            }
            if (!sourceLocator && Array.isArray(ai.sources) && ai.sources.length > 0) {
              const primary = ai.sources[0];
              if (primary && primary.url) {
                sourceLocator = { url: primary.url };
              }
            }
          }
        } catch {
          // Soft-fail; continue without AI prefill
        }
      }

      // Generate pipeline ID for tracking
      const pipelineId =
        (typeof crypto !== 'undefined' && (crypto as any).randomUUID)
          ? (crypto as any).randomUUID()
          : `cm-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

      // Subscribe to Pusher progress
      if (pusher) {
        try {
          unsubscribePusher = pusher.subscribeToChannel(`deploy-${pipelineId}`, {
            progress: (evt: any) => {
              const s = evt?.step;
              if (typeof s === 'string') {
                const idx = stepIndexMap[s];
                if (typeof idx === 'number') updateOverlayIndex(idx);
                if (s === 'save_market') {
                  const st = String(evt?.status || '').toLowerCase();
                  if (st === 'success') {
                    setTimeout(() => deploymentOverlay.fadeOutAndClose(300), 200);
                  }
                }
              }
            },
          });
        } catch {}
      }

      // Open global deployment overlay and navigate to token page
      deploymentOverlay.open({
        title: 'Deployment Pipeline',
        subtitle: 'Initializing market and registering oracle',
        messages: pipelineMessages,
        splashMs: INITIAL_SPLASH_MS,
      });

      await new Promise(resolve => setTimeout(resolve, INITIAL_SPLASH_MS));
      router.replace(`/token/${encodeURIComponent(symbol)}?deploying=1`);

      // Optional Wayback Machine snapshot
      if (metricUrl) {
        void fetch('/api/archives/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: metricUrl,
            captureOutlinks: false,
            captureScreenshot: true,
            skipIfRecentlyArchived: true,
          }),
        }).catch(() => {});
      }

      // Create market on chain
      const { orderBook, marketId, chainId, transactionHash } = await createMarketOnChain({
        symbol,
        metricUrl,
        startPrice: String(startPrice),
        dataSource,
        tags,
        pipelineId,
        onProgress: ({ step }) => {
          const idx = stepIndexMap[step];
          if (typeof idx === 'number') updateOverlayIndex(idx);
        },
      });

      if (!gaslessEnabled) {
        // Legacy: grant roles via server endpoint
        updateOverlayIndex(8);
        const grant = await fetch('/api/markets/grant-roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderBook }),
        });
        if (!grant.ok) {
          const gErr = await grant.json().catch(() => ({} as any));
          throw new Error(gErr?.error || 'Role grant failed');
        }
        updateOverlayIndex(9);

        // Save market metadata
        const networkName =
          (process.env as any).NEXT_PUBLIC_NETWORK_NAME ||
          (globalThis as any).process?.env?.NEXT_PUBLIC_NETWORK_NAME ||
          'hyperliquid';
        const saveRes = await fetch('/api/markets/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            marketIdentifier: symbol,
            symbol,
            name: `${(symbol.split('-')[0] || symbol).toUpperCase()} Futures`,
            description: marketDescription || `OrderBook market for ${symbol}`,
            category: 'CUSTOM',
            decimals: 6,
            minimumOrderSize: Number(process.env.DEFAULT_MINIMUM_ORDER_SIZE || 0.1),
            settlementDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
            tradingEndDate: null,
            dataRequestWindowSeconds: Number(process.env.DEFAULT_DATA_REQUEST_WINDOW_SECONDS || 3600),
            autoSettle: true,
            oracleProvider: null,
            initialOrder: {
              metricUrl,
              startPrice: String(startPrice),
              dataSource,
              tags,
            },
            chainId,
            networkName,
            creatorWalletAddress: undefined,
            marketAddress: orderBook,
            marketIdBytes32: marketId,
            transactionHash,
            blockNumber: null,
            gasUsed: null,
            aiSourceLocator: sourceLocator,
            iconImageUrl: iconPreviewUrl || null,
          }),
        });
        if (!saveRes.ok) {
          const sErr = await saveRes.json().catch(() => ({} as any));
          throw new Error(sErr?.error || 'Save failed');
        }
        updateOverlayIndex(10);
      }

      // Trigger post-deploy inspection
      void fetch('/api/markets/inspect-gasless', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderBook, autoFix: false, pipelineId }),
      }).catch(() => {});

      // Notify and navigate
      try {
        window.dispatchEvent(new CustomEvent('marketDeployed', { detail: { symbol } }));
      } catch {}
      router.replace(`/token/${encodeURIComponent(symbol)}`);
      deploymentOverlay.fadeOutAndClose(500);
    } catch (error) {
      console.error('Error creating market:', error);
      deploymentOverlay.close();
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create market');
    } finally {
      setIsCreatingMarket(false);
      if (typeof unsubscribePusher === 'function') {
        try { unsubscribePusher(); } catch {}
      }
    }
  }, [
    selectedSource,
    marketName,
    marketDescription,
    validationResult,
    iconPreviewUrl,
    deploymentOverlay,
    pusher,
    router,
    pipelineMessages,
    stepIndexMap,
    updateOverlayIndex,
    gaslessEnabled,
  ]);

  React.useEffect(() => {
    if (discoveryState !== 'success' || !discoveryResult?.metric_definition) return;
    if (!marketName && !nameTouched) {
      setMarketName(suggestMarketName({ metricName: discoveryResult.metric_definition.metric_name }));
    }
    if (!marketDescription && !descriptionTouched) {
      setMarketDescription(
        suggestMarketDescription({
          metricName: discoveryResult.metric_definition.metric_name,
          measurementMethod: discoveryResult.metric_definition.measurement_method,
        })
      );
    }
  }, [discoveryState, discoveryResult]);

  React.useEffect(() => {
    if (!iconFile) {
      setIconPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(iconFile);
    setIconPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [iconFile]);

  // Step 3: After name + description are confirmed, fetch sources (SERP + AI ranking) for MetricSourceBubble.
  React.useEffect(() => {
    if (discoveryState !== 'success' || !discoveryResult) return;
    if (visibleStep !== 'select_source') return;
    if (!isNameConfirmed || !isDescriptionConfirmed) return;
    if (sourcesFetchState === 'loading' || sourcesFetchState === 'success') return;

    const controller = new AbortController();
    setSourcesFetchState('loading');

    const query = `${marketNameRef.current || ''}\n\n${marketDescriptionRef.current || ''}`.trim() || promptRef.current;

    void (async () => {
      try {
        const res = await fetch('/api/metric-discovery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ description: query, mode: 'full' }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.message || 'Failed to fetch sources');

        if (!controller.signal.aborted) {
          setDiscoveryResult(json);
          setSourcesFetchState('success');
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setSourcesFetchState('error');
        }
      }
    })();

    return () => controller.abort();
  }, [discoveryResult, discoveryState, isDescriptionConfirmed, isNameConfirmed, visibleStep, sourcesFetchNonce]);

  const desiredStep = React.useMemo<CreationStep>(() => {
    if (!discoveryResult) return 'clarify_metric';
    if (discoveryState === 'clarify') return 'clarify_metric';
    if (discoveryState !== 'success') return 'clarify_metric';
    if (!isNameConfirmed) return 'name';
    if (!isDescriptionConfirmed) return 'description';
    if (!selectedSource) return 'select_source';
    if (!isIconConfirmed) return 'icon';
    return 'complete';
  }, [discoveryResult, discoveryState, isDescriptionConfirmed, isIconConfirmed, isNameConfirmed, selectedSource]);

  React.useEffect(() => {
    if ((discoveryState !== 'success' && discoveryState !== 'clarify') || !discoveryResult) {
      setAssistantMessage('');
      setAssistantIsLoading(false);
      lastAssistantRequestKeyRef.current = '';
      return;
    }

    // Prevent repeated assistant calls (and typewriter restarts) when unrelated state changes,
    // e.g. `discoveryResult` updating after sources are fetched.
    if (!assistantRequestKey || assistantRequestKey === lastAssistantRequestKeyRef.current) return;
    lastAssistantRequestKeyRef.current = assistantRequestKey;

    const controller = new AbortController();
    setAssistantIsLoading(true);

    void (async () => {
      try {
        const res = await fetch('/api/create-market-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            step: visibleStep,
            context: {
              metricPrompt: promptRef.current,
              discovery: {
                measurable: discoveryResult.measurable,
                rejection_reason: discoveryResult.rejection_reason ?? null,
                metric_definition: discoveryResult.metric_definition ?? null,
                assumptions: discoveryResult.assumptions ?? [],
                sources: discoveryResult.sources ?? null,
              },
              marketName: marketNameRef.current,
              marketDescription: marketDescriptionRef.current,
              selectedSource: selectedSource
                ? {
                    url: selectedSource.url,
                    label: selectedSource.label,
                    authority: selectedSource.authority,
                    confidence: selectedSource.confidence,
                  }
                : null,
            },
            history: assistantHistory,
          }),
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.message || 'Assistant request failed');

        const data = json as CreateMarketAssistantResponse;
        if (controller.signal.aborted) return;

        if (typeof data?.message === 'string' && data.message.trim()) {
          setAssistantMessage(data.message.trim());
          setAssistantHistory((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && last.content === data.message.trim()) return prev;
            return [...prev, { role: 'assistant' as const, content: data.message.trim() }].slice(-24);
          });
        }

        // Optional: let the assistant provide suggestions into the LEFT input bubbles,
        // but never overwrite user edits.
        if (visibleStep === 'name' && data?.suggestions?.marketName && !nameTouched) {
          setMarketName(data.suggestions.marketName);
        }
        if (visibleStep === 'description' && data?.suggestions?.marketDescription && !descriptionTouched) {
          setMarketDescription(data.suggestions.marketDescription);
        }
      } catch (e) {
        // Keep the last assistant message on transient errors to prevent UI "blinking".
      } finally {
        if (!controller.signal.aborted) {
          setAssistantIsLoading(false);
        }
      }
    })();

    return () => controller.abort();
    // We intentionally only refresh on step / source changes (not per keystroke).
  }, [
    assistantRequestKey,
    discoveryResult,
    discoveryState,
    visibleStep,
    selectedSource?.url,
    nameTouched,
    descriptionTouched,
    assistantHistory,
  ]);

  React.useEffect(() => {
    if (visibleStep === desiredStep) return;
    setIsStepAnimating(true);

    if (stepTimerRef.current) {
      window.clearTimeout(stepTimerRef.current);
    }

    stepTimerRef.current = window.setTimeout(() => {
      setVisibleStep(desiredStep);
      // allow next paint before fading in
      requestAnimationFrame(() => setIsStepAnimating(false));
    }, 160);
  }, [desiredStep, visibleStep]);

  React.useEffect(() => {
    return () => {
      if (stepTimerRef.current) {
        window.clearTimeout(stepTimerRef.current);
      }
    };
  }, []);

  const fallbackAssistantResponseText = React.useMemo(() => {
    if ((discoveryState !== 'success' && discoveryState !== 'clarify') || !discoveryResult) return '';

    if (discoveryState === 'clarify' || !discoveryResult.measurable) {
      const reason = discoveryResult.rejection_reason ? ` ${discoveryResult.rejection_reason}` : '';
      return `I need one quick clarification to make this metric objectively measurable.${reason}`;
    }

    if (!isNameConfirmed) {
      return `Great — now pick a market name. I suggested one, but you can edit it.`;
    }

    if (!isDescriptionConfirmed) {
      return `Next, add a short description. I suggested one, but you can edit it.`;
    }

    if (!selectedSource) {
      return `Now pick a data source for this market.`;
    }

    if (!isIconConfirmed) {
      return `Last step — upload an icon image for your market.`;
    }

    return `Perfect. Your market setup is ready.`;
  }, [discoveryResult, discoveryState, isDescriptionConfirmed, isIconConfirmed, isNameConfirmed, selectedSource]);

  return (
    <div className="relative w-full max-w-[90vw] sm:w-[702px] sm:max-w-[702px]">
      {/* Step panel - full page width chat layout with equal margins from edges */}
      {/* Hide when at 'complete' step - we show the MarketDetailsReview instead */}
      {(discoveryState === 'success' || discoveryState === 'clarify') && discoveryResult && visibleStep !== 'complete' ? (
        <div className="mt-6 w-full lg:w-[calc(100vw-60px)] lg:ml-[calc(50%-50vw+60px)] lg:px-[60px]">
          <StepPanel
                step={visibleStep}
                isAnimating={isStepAnimating}
                message={assistantMessage || fallbackAssistantResponseText}
                isAssistantLoading={assistantIsLoading}
                metricClarification={metricClarification}
                onChangeMetricClarification={setMetricClarification}
                onSubmitMetricClarification={async () => {
                  const reply = metricClarification.trim();
                  if (!reply) return;
                  setAssistantHistory((prev) => [...prev, { role: 'user' as const, content: reply }].slice(-24));
                  setMetricClarification('');
                  // Re-try metric definition using the original prompt + latest clarification.
                  const combined = `${promptRef.current}\n\nClarification: ${reply}`.trim();
                  await runDefineOnlyDiscovery(combined);
                }}
                marketName={marketName}
                onChangeName={(v) => {
                  setNameTouched(true);
                  setMarketName(v);
                }}
                onConfirmName={() => setIsNameConfirmed(true)}
                marketDescription={marketDescription}
                onChangeDescription={(v) => {
                  setDescriptionTouched(true);
                  setMarketDescription(v);
                }}
                onConfirmDescription={() => setIsDescriptionConfirmed(true)}
                iconPreviewUrl={iconPreviewUrl}
                onConfirmIcon={() => setIsIconConfirmed(true)}
                onStartOver={handleReset}
            devTools={
              devToolsEnabled ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setDevToolsOpen((v) => !v)}
                    className="rounded-md border border-dashed border-purple-500/40 bg-purple-500/10 px-2 py-1 text-[11px] font-medium text-purple-300 hover:bg-purple-500/20"
                  >
                    Dev
                  </button>
                  {devToolsOpen ? (
                    <div className="absolute right-0 mt-2 w-[180px] rounded-xl border border-white/10 bg-[#0A0A0A] p-2 shadow-xl z-50">
                      <div className="px-2 pb-1 text-[11px] text-white/45">Jump to step</div>
                      {(['clarify_metric', 'name', 'description', 'select_source', 'icon', 'complete'] as CreationStep[]).map(
                        (s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => {
                              devJumpToStep(s);
                              setDevToolsOpen(false);
                            }}
                            className={[
                              'w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-white/80 hover:bg-white/5',
                              visibleStep === s ? 'bg-white/5' : '',
                            ].join(' ')}
                          >
                            {s.replace('_', ' ')}
                          </button>
                        )
                      )}
                      <div className="mt-2 pt-2 border-t border-white/10">
                        <div className="px-2 pb-1 text-[11px] text-white/45">Modals</div>
                        <button
                          type="button"
                          onClick={() => {
                            // Create mock validation result for preview
                            setValidationResult({
                              status: 'completed',
                              processingTime: '1,234ms',
                              cached: false,
                              data: {
                                metric: marketName || 'Bitcoin Price',
                                value: '97,245.50',
                                unit: 'USD',
                                as_of: new Date().toISOString(),
                                confidence: 0.92,
                                asset_price_suggestion: '97,245.50',
                                reasoning: 'The current Bitcoin price was retrieved from the CoinGecko API endpoint. The value reflects the latest spot price in USD with high confidence based on multiple exchange aggregation.',
                                sources: [{
                                  url: selectedSource?.url || 'https://api.coingecko.com/api/v3/simple/price',
                                  screenshot_url: '',
                                  quote: 'BTC: $97,245.50 USD',
                                  match_score: 0.95,
                                }],
                              },
                              performance: {
                                totalTime: 1234,
                                breakdown: {
                                  cacheCheck: '12ms',
                                  scraping: '456ms',
                                  processing: '234ms',
                                  aiAnalysis: '532ms',
                                },
                              },
                            });
                            setShowValidationModal(true);
                            setDevToolsOpen(false);
                          }}
                          className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-white/80 hover:bg-white/5"
                        >
                          Validation Modal
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            // Show loading state
                            setValidationResult(null);
                            setShowValidationModal(true);
                            setDevToolsOpen(false);
                          }}
                          className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-white/80 hover:bg-white/5"
                        >
                          Validation (Loading)
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null
            }
          />
        </div>
      ) : null}

      {/* Prompt composer (removed after discovery/clarification to transition to chat) */}
      {discoveryState !== 'success' && discoveryState !== 'clarify' && (
        <div
          className={`relative space-y-1 rounded-3xl border-[0.5px] bg-[#0F0F0F] p-3 pt-1.5 shadow-lg transition-shadow duration-200 ease-out ${
            isFocused
              ? 'shadow-[0px_0px_0px_3px_rgb(35,35,35)] border-white/15'
              : 'border-white/8'
          }`}
        >
          {/* Input area */}
          <div className="px-1 py-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder="Describe your metric (e.g., Current price of Bitcoin in USD)"
              className="w-full resize-none border-0 bg-transparent text-sm text-white placeholder:text-white/40 outline-none focus:outline-none focus:ring-0 focus:border-0 sm:text-base leading-relaxed"
              style={{ outline: 'none', boxShadow: 'none' }}
              rows={2}
              disabled={discoveryState === 'discovering'}
            />
          </div>

          {/* Bottom toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-1.5 sm:gap-3">
            <div className="flex items-center gap-2 text-xs text-white/70 sm:gap-3">
              {discoveryState === 'idle' && (
                <>
                  {/* Dev-only step skipper */}
                  {devToolsEnabled ? (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setDevToolsOpen((v) => !v)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-purple-500/40 bg-purple-500/10 px-2 py-1 text-purple-300 hover:bg-purple-500/20 transition-colors"
                        aria-label="Dev tools"
                      >
                        <span className="text-xs">Dev</span>
                      </button>
                      {devToolsOpen ? (
                        <div className="absolute left-0 top-full mt-2 w-[200px] rounded-xl border border-white/10 bg-[#0A0A0A] p-2 shadow-xl z-50">
                          <div className="px-2 pb-1 text-[11px] text-white/45">Jump to step</div>
                          {(['clarify_metric', 'name', 'description', 'select_source', 'icon', 'complete'] as CreationStep[]).map(
                            (s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => {
                                  devJumpToStep(s);
                                  setDevToolsOpen(false);
                                }}
                                className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-white/80 hover:bg-white/5"
                              >
                                {s.replace('_', ' ')}
                              </button>
                            )
                          )}
                          <div className="mt-2 pt-2 border-t border-white/10">
                            <div className="px-2 pb-1 text-[11px] text-white/45">Modals</div>
                            <button
                              type="button"
                              onClick={() => {
                                setValidationResult({
                                  status: 'completed',
                                  processingTime: '1,234ms',
                                  cached: false,
                                  data: {
                                    metric: 'Bitcoin Price',
                                    value: '97,245.50',
                                    unit: 'USD',
                                    as_of: new Date().toISOString(),
                                    confidence: 0.92,
                                    asset_price_suggestion: '97,245.50',
                                    reasoning: 'The current Bitcoin price was retrieved from the CoinGecko API endpoint. The value reflects the latest spot price in USD with high confidence based on multiple exchange aggregation.',
                                    sources: [{
                                      url: 'https://api.coingecko.com/api/v3/simple/price',
                                      screenshot_url: '',
                                      quote: 'BTC: $97,245.50 USD',
                                      match_score: 0.95,
                                    }],
                                  },
                                  performance: {
                                    totalTime: 1234,
                                    breakdown: {
                                      cacheCheck: '12ms',
                                      scraping: '456ms',
                                      processing: '234ms',
                                      aiAnalysis: '532ms',
                                    },
                                  },
                                });
                                setShowValidationModal(true);
                                setDevToolsOpen(false);
                              }}
                              className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-white/80 hover:bg-white/5"
                            >
                              Validation Modal
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setValidationResult(null);
                                setShowValidationModal(true);
                                setDevToolsOpen(false);
                              }}
                              className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-white/80 hover:bg-white/5"
                            >
                              Validation (Loading)
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
              {discoveryState === 'discovering' && (
                <div className="flex items-center gap-1.5" aria-live="polite" aria-label="Loading">
                  <span className="sr-only">Loading</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-white/45 animate-bounce" />
                  <span className="h-1.5 w-1.5 rounded-full bg-white/45 animate-bounce [animation-delay:120ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-white/45 animate-bounce [animation-delay:240ms]" />
                </div>
              )}
              {(discoveryState === 'rejected' || discoveryState === 'error') && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-white/70 text-sm hover:text-white transition-colors"
                >
                  ← Start over
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={!prompt.trim() || discoveryState === 'discovering'}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-xs font-medium text-black shadow-sm transition-all hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-50 disabled:cursor-not-allowed sm:gap-2 sm:px-4 sm:py-2 sm:text-sm"
            >
              {discoveryState === 'discovering' ? (
                <span
                  className="h-4 w-4 animate-spin rounded-full border border-black/20 border-t-black"
                  aria-hidden="true"
                />
              ) : (
                <IconSparkles className="h-3.5 w-3.5 text-black sm:h-4 sm:w-4" />
              )}
              <span>Create</span>
            </button>
          </div>
        </div>
      )}

      {/* Discovery Results - Source Selection Tiles (Step 3) */}
      {discoveryState === 'success' &&
        discoveryResult &&
        discoveryResult.metric_definition &&
        visibleStep === 'select_source' && (
        <MetricSourceBubble
          primarySource={discoveryResult?.sources?.primary_source ?? null}
          secondarySources={discoveryResult?.sources?.secondary_sources ?? []}
          metricName={discoveryResult.metric_definition.metric_name}
          searchResults={discoveryResult.search_results ?? []}
          fetchState={sourcesFetchState}
          onRetry={() => {
            // Force a re-fetch (effect runs when fetchState returns to idle).
            setSourcesFetchState('idle');
            setSourcesFetchNonce((n) => n + 1);
          }}
          isVisible={true}
          onSelectSource={async (source) => {
            const md = discoveryResult.metric_definition;
            if (!md) return;

            setSelectedSource(source);
            setIsIconConfirmed(false);
            
            // Optionally enrich defaults with source if user hasn't edited.
            if (!nameTouched) {
              setMarketName(
                suggestMarketName({
                  metricName: md.metric_name,
                  sourceLabel: source.label,
                })
              );
            }
            if (!descriptionTouched) {
              setMarketDescription(
                suggestMarketDescription({
                  metricName: md.metric_name,
                  measurementMethod: md.measurement_method,
                  sourceLabel: source.label,
                })
              );
            }

            // Trigger AI validation with the selected source
            setIsValidating(true);
            setValidationError(null);
            setShowValidationModal(true);
            setValidationResult(null);

            try {
              const started = Date.now();
              const ai = await runMetricAIWithPolling(
                {
                  metric: marketName || md.metric_name,
                  description: marketDescription || `Resolve current value for ${md.metric_name}`,
                  urls: [source.url],
                  context: 'create',
                },
                { intervalMs: 2000, timeoutMs: 60000 } // Increased for screenshot + vision analysis
              );

              if (!ai) throw new Error('AI analysis did not return a result in time');

              const processingMs = Math.max(0, Date.now() - started);
              const result = toModalResponse(ai, marketName || md.metric_name, processingMs);
              
              setValidationResult(result);
              setIsValidating(false);
            } catch (error) {
              console.error('Validation Error:', error);
              setValidationError(error instanceof Error ? error.message : 'Validation failed');
              setIsValidating(false);
            }
          }}
        />
      )}

      {/* Icon Selection Tiles (Step: Icon) */}
      {discoveryState === 'success' &&
        discoveryResult &&
        discoveryResult.metric_definition &&
        visibleStep === 'icon' && (
        <IconSearchBubble
          query={discoveryResult.metric_definition.metric_name || marketName || prompt}
          onSelectIcon={(url) => {
            setIconFile(null);
            setIconPreviewUrl(url);
            setIsIconConfirmed(false);
          }}
          onUploadIcon={(file) => {
            setIconFile(file);
            setIsIconConfirmed(false);
          }}
          selectedIconUrl={iconPreviewUrl}
          isVisible={true}
        />
      )}

      {/* Market Details Review (Step: Complete) */}
      {discoveryState === 'success' &&
        discoveryResult &&
        visibleStep === 'complete' && (
        <MarketDetailsReview
          marketName={marketName}
          marketDescription={marketDescription}
          selectedSource={selectedSource}
          iconPreviewUrl={iconPreviewUrl}
          metricDefinition={discoveryResult.metric_definition}
          onEdit={(step) => {
            // Allow user to go back and edit a specific step
            if (step === 'name') {
              setIsNameConfirmed(false);
              setIsDescriptionConfirmed(false);
              setSelectedSource(null);
              setIsIconConfirmed(false);
            } else if (step === 'description') {
              setIsDescriptionConfirmed(false);
              setSelectedSource(null);
              setIsIconConfirmed(false);
            } else if (step === 'select_source') {
              setSelectedSource(null);
              setIsIconConfirmed(false);
            } else if (step === 'icon') {
              setIsIconConfirmed(false);
            } else if (step === 'clarify_metric') {
              // Go back to the beginning
              setIsNameConfirmed(false);
              setIsDescriptionConfirmed(false);
              setSelectedSource(null);
              setIsIconConfirmed(false);
              setDiscoveryState('clarify');
            }
          }}
          onStartOver={handleReset}
          onCreateMarket={handleCreateMarket}
          isCreating={isCreatingMarket}
        />
      )}

      {/* Rejection Notice */}
      {discoveryState === 'rejected' && discoveryResult && (
        <div className="mt-4 rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-4 sm:p-6">
          <h3 className="text-lg font-medium text-yellow-400 mb-3">⚠ Metric Not Measurable</h3>
          <p className="text-sm text-white/80 mb-4">{discoveryResult.rejection_reason}</p>
          <div className="text-xs text-white/60">
            Try refining your metric to be more specific and objectively measurable using public data sources.
          </div>
        </div>
      )}

      {/* Error Notice */}
      {discoveryState === 'error' && (
        <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/5 p-4 sm:p-6">
          <h3 className="text-lg font-medium text-red-400 mb-3">✗ Discovery Failed</h3>
          <p className="text-sm text-white/80">{errorMessage || 'An unexpected error occurred'}</p>
        </div>
      )}

      {/* Market examples carousel - only shown in idle state */}
      {discoveryState === 'idle' && <MarketExamplesCarousel />}

      {/* AI Validation Modal */}
      <MetricResolutionModal
        isOpen={showValidationModal}
        onClose={() => {
          setShowValidationModal(false);
          setValidationResult(null);
          setValidationError(null);
        }}
        response={validationResult}
        onAccept={() => {
          // Handle accepted validation - proceed to next step
          setShowValidationModal(false);
          // The source is already selected, validation is complete
          // User can now proceed to icon step
        }}
      />
    </div>
  );
}
