'use client';

import React from 'react';
import { IconAspectRatio, IconImage, IconShuffle, IconSliders, IconSparkles } from './icons';
import { MetricDiscoveryResponse } from '@/types/metricDiscovery';
import { MetricDefinitionCard } from './MetricDefinitionCard';
import { SourceList } from './SourceList';

type DiscoveryState = 'idle' | 'discovering' | 'success' | 'rejected' | 'error';

export function PromptComposer() {
  const [prompt, setPrompt] = React.useState('');
  const [isFocused, setIsFocused] = React.useState(false);
  const [discoveryState, setDiscoveryState] = React.useState<DiscoveryState>('idle');
  const [discoveryResult, setDiscoveryResult] = React.useState<MetricDiscoveryResponse | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setDiscoveryState('discovering');
    setErrorMessage(null);

    try {
      const response = await fetch('/api/metric-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: prompt }),
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
    <div className="w-full max-w-[90vw] sm:max-w-[600px] md:max-w-[720px]">
      <div 
        className={`rounded-2xl border-2 bg-[#2A2A2A]/90 backdrop-blur-md shadow-[0_10px_40px_rgba(0,0,0,0.5)] transition-colors duration-200 ${
          isFocused ? 'border-blue-500' : 'border-white/10'
        }`}
      >
        {/* Input area */}
        <div className="px-4 py-3 sm:px-5 sm:py-4">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Describe your metric (e.g., Current price of Bitcoin in USD)"
            className="w-full resize-none border-0 bg-transparent text-sm text-white placeholder:text-white/35 outline-none focus:outline-none focus:ring-0 focus:border-0 sm:text-base"
            style={{ outline: 'none', boxShadow: 'none' }}
            rows={2}
            disabled={discoveryState === 'discovering'}
          />
        </div>

        {/* Bottom toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
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
              </>
            )}
            {discoveryState === 'discovering' && (
              <span className="text-white/70 text-sm">Discovering metric sources...</span>
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
            <IconSparkles className="h-3.5 w-3.5 text-black sm:h-4 sm:w-4" />
            <span>{discoveryState === 'discovering' ? 'Discovering...' : 'Discover'}</span>
          </button>
        </div>
      </div>

      {/* Discovery Results */}
      {discoveryState === 'success' && discoveryResult && discoveryResult.metric_definition && (
        <div className="mt-4 space-y-4">
          <MetricDefinitionCard
            definition={discoveryResult.metric_definition}
            confidence={discoveryResult.sources?.primary_source.confidence}
            processingTime={discoveryResult.processing_time_ms}
          />

          {discoveryResult.sources && (
            <div className="rounded-2xl border border-white/10 bg-[#2A2A2A]/90 p-4 sm:p-6">
              <SourceList
                primarySource={discoveryResult.sources.primary_source}
                secondarySources={discoveryResult.sources.secondary_sources}
              />
            </div>
          )}

          {discoveryResult.assumptions && discoveryResult.assumptions.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-[#2A2A2A]/90 p-4 sm:p-6">
              <div className="text-sm text-white/60 mb-2">Assumptions</div>
              <ul className="text-sm text-white/80 space-y-1.5">
                {discoveryResult.assumptions.map((assumption, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-blue-400 mt-0.5">•</span>
                    <span>{assumption}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-3 text-sm font-medium text-white shadow-lg transition-all hover:bg-blue-600 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
          >
            <IconSparkles className="h-4 w-4" />
            <span>Continue to Market Creation</span>
          </button>
        </div>
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
    </div>
  );
}

