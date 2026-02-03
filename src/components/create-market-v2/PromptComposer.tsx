'use client';

import React from 'react';
import { IconAspectRatio, IconImage, IconShuffle, IconSliders, IconSparkles } from './icons';
import { MetricDiscoveryResponse } from '@/types/metricDiscovery';
import { MetricSourceBubble } from './MetricSourceBubble';
import { MarketExamplesCarousel } from './MarketExamplesCarousel';

type DiscoveryState = 'idle' | 'discovering' | 'success' | 'rejected' | 'error';

export function PromptComposer() {
  const [prompt, setPrompt] = React.useState('');
  const [isFocused, setIsFocused] = React.useState(false);
  const [discoveryState, setDiscoveryState] = React.useState<DiscoveryState>('idle');
  const [discoveryResult, setDiscoveryResult] = React.useState<MetricDiscoveryResponse | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const resizeTextarea = React.useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Ensure there is never a visible scrollbar (even with OS "always show scrollbars").
    textarea.style.overflowY = 'hidden';

    // Reset to measure correctly, then grow to fit content.
    textarea.style.height = '0px';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  // Auto-resize before paint to avoid scrollbar flicker.
  React.useLayoutEffect(() => {
    resizeTextarea();
  }, [prompt, resizeTextarea]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setDiscoveryState('discovering');
    setErrorMessage(null);

    try {
      const response = await fetch('/api/metric-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Only define the metric here. URL discovery happens later in Create Market V2 (Step 3).
        body: JSON.stringify({ description: prompt, mode: 'define_only' }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Discovery failed');
      }

      setDiscoveryResult(data);

      if (data.measurable) {
        setDiscoveryState('success');
      } else {
        setDiscoveryState('rejected');
      }
    } catch (error) {
      console.error('Discovery error:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to discover metric');
      setDiscoveryState('error');
    }
  };

  const handleReset = () => {
    setDiscoveryState('idle');
    setDiscoveryResult(null);
    setErrorMessage(null);
    setPrompt('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleGenerate();
    }
  };

  return (
    <div className="w-full max-w-[90vw] sm:w-[702px] sm:max-w-[702px]">
      <div 
        className={`relative space-y-1 rounded-3xl border-[0.5px] bg-[#2A2A2A] p-3 pt-1.5 shadow-lg transition-shadow duration-200 ease-out ${
          isFocused 
            ? 'shadow-[0px_0px_0px_3px_rgb(55,55,55)] border-white/20' 
            : 'border-white/10'
        }`}
      >
        {/* Input area */}
        <div className="px-1 py-2">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onInput={resizeTextarea}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Describe your metric (e.g., Current price of Bitcoin in USD)"
            className="scrollbar-none w-full resize-none border-0 bg-transparent text-sm text-white placeholder:text-white/40 outline-none focus:outline-none focus:ring-0 focus:border-0 sm:text-base leading-relaxed overflow-y-hidden"
            style={{ outline: 'none', boxShadow: 'none', minHeight: '7.5rem' }}
            rows={3}
            disabled={discoveryState === 'discovering'}
          />
        </div>

        {/* Bottom toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-1.5 sm:gap-3">
          <div className="flex items-center gap-2 text-xs text-white/70 sm:gap-3">
            {discoveryState === 'idle' && (
              <>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-white/5 focus-visible:bg-white/5 transition-colors"
                  aria-label="Creation type"
                >
                  <IconImage className="h-3.5 w-3.5 text-white/70 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline">Image</span>
                </button>

                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-white/5 focus-visible:bg-white/5 transition-colors"
                  aria-label="Aspect ratio"
                >
                  <IconAspectRatio className="h-3.5 w-3.5 text-white/70 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline">16:9</span>
                </button>

                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-md p-1.5 hover:bg-white/5 focus-visible:bg-white/5 transition-colors"
                  aria-label="Settings"
                >
                  <IconSliders className="h-3.5 w-3.5 text-white/70 sm:h-4 sm:w-4" />
                </button>

                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-md p-1.5 hover:bg-white/5 focus-visible:bg-white/5 transition-colors"
                  aria-label="Shuffle"
                >
                  <IconShuffle className="h-3.5 w-3.5 text-white/70 sm:h-4 sm:w-4" />
                </button>

                {/* Development-only: Load dummy data button */}
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
            {(discoveryState === 'success' || discoveryState === 'rejected' || discoveryState === 'error') && (
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

      {/* Discovery Results - Source Selection Tiles */}
      {discoveryState === 'success' && discoveryResult && discoveryResult.metric_definition && (
        <MetricSourceBubble
          primarySource={discoveryResult?.sources?.primary_source ?? null}
          secondarySources={discoveryResult?.sources?.secondary_sources ?? []}
          metricName={discoveryResult.metric_definition.metric_name}
          isVisible={true}
          onSelectSource={(source) => {
            console.log('Selected source:', source);
            // TODO: Handle source selection
          }}
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
      {discoveryState === 'idle' && (
        <MarketExamplesCarousel />
      )}
    </div>
  );
}

