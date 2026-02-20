'use client';

import React, { useState } from 'react';
import MetricResolutionModal from '@/components/MetricResolutionModal/MetricResolutionModal';
import type { MetricResolutionResponse } from '@/components/MetricResolutionModal/MetricResolutionModal';

const SAMPLE_RESPONSES: Record<string, MetricResolutionResponse> = {
  realEstate: {
    status: 'completed',
    processingTime: '22630ms',
    cached: false,
    data: {
      metric: 'Median Residential Real Estate Value in Los Angeles',
      value: '$990,833 (Median sale price, December 31, 2025)',
      unit: 'unknown',
      as_of: '2025-12-31',
      confidence: 0.87,
      asset_price_suggestion: '990830',
      reasoning: `did not yield a price, but HTML extraction clearly provides a labeled 'Median sale price (December 31, 2025): $990,833', which matches the metric definition precisely and aligns with the listing period. While cross-validation with vision was not possible, the HTML evidence is direct and unambiguous, so confidence is moderately high (slightly reduced due to lack of cross-validation). The suggested asset price is derived directly from the extracted value after removing currency formatting.`,
      sources: [
        {
          url: 'https://www.redfin.com/city/11203/CA/Los-Angeles/housing-market',
          screenshot_url: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=600&h=300&fit=crop&auto=format',
          quote: 'Median sale price (December 31, 2025): $990,833',
          match_score: 0.95,
        },
      ],
    },
    performance: {
      totalTime: 22630,
      breakdown: {
        cacheCheck: '12ms',
        scraping: '8500ms',
        processing: '2100ms',
        aiAnalysis: '12018ms',
      },
    },
  },
  crypto: {
    status: 'completed',
    processingTime: '5420ms',
    cached: true,
    data: {
      metric: 'Bitcoin Price USD',
      value: '67,432.50',
      unit: 'USD',
      as_of: '2025-02-19T18:00:00Z',
      confidence: 0.98,
      asset_price_suggestion: '67432.50',
      reasoning: 'Price extracted directly from CoinGecko API with high confidence. Multiple sources confirm this value within 0.1% variance.',
      sources: [
        {
          url: 'https://www.coingecko.com/en/coins/bitcoin',
          screenshot_url: 'https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=600&h=300&fit=crop&auto=format',
          quote: 'BTC: $67,432.50 USD',
          match_score: 0.99,
        },
      ],
    },
    performance: {
      totalTime: 5420,
      breakdown: {
        cacheCheck: '5ms',
        scraping: '1200ms',
        processing: '800ms',
        aiAnalysis: '3415ms',
      },
    },
  },
  stock: {
    status: 'completed',
    processingTime: '8150ms',
    cached: false,
    data: {
      metric: 'Apple Inc. (AAPL) Stock Price',
      value: '182.63',
      unit: 'USD',
      as_of: '2025-02-19T16:00:00Z',
      confidence: 0.65,
      asset_price_suggestion: '182.63',
      reasoning: 'Stock price extracted from Yahoo Finance. Moderate confidence due to market hours and potential delay in data refresh. Cross-validation with other sources showed minor discrepancies.',
      sources: [
        {
          url: 'https://finance.yahoo.com/quote/AAPL',
          screenshot_url: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=600&h=300&fit=crop&auto=format',
          quote: 'AAPL: $182.63',
          match_score: 0.72,
        },
      ],
    },
    performance: {
      totalTime: 8150,
      breakdown: {
        cacheCheck: '8ms',
        scraping: '3200ms',
        processing: '1500ms',
        aiAnalysis: '3442ms',
      },
    },
  },
  lowConfidence: {
    status: 'completed',
    processingTime: '15200ms',
    cached: false,
    data: {
      metric: 'Average Gas Price in California',
      value: '4.89',
      unit: 'USD/gallon',
      as_of: '2025-02-18',
      confidence: 0.45,
      asset_price_suggestion: '4.89',
      reasoning: 'Data extracted from AAA gas prices but shows significant regional variation. Source data may be outdated by up to 24 hours. Low confidence due to high variance across different stations and regions.',
      sources: [
        {
          url: 'https://gasprices.aaa.com/state-gas-price-averages/',
          screenshot_url: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=600&h=300&fit=crop&auto=format',
          quote: 'California Average: $4.89/gal',
          match_score: 0.55,
        },
      ],
    },
    performance: {
      totalTime: 15200,
      breakdown: {
        cacheCheck: '10ms',
        scraping: '5500ms',
        processing: '2200ms',
        aiAnalysis: '7490ms',
      },
    },
  },
};

export default function DebugMetricResolutionPage() {
  const debugEnabled =
    process.env.NODE_ENV !== 'production' ||
    String(process.env.NEXT_PUBLIC_ENABLE_DEBUG_PAGES || '').toLowerCase() === 'true';

  const [open, setOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<keyof typeof SAMPLE_RESPONSES>('realEstate');
  const [showLoading, setShowLoading] = useState(false);
  const [showError, setShowError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('Could not extract a numeric value from the provided URL.');

  const [customValue, setCustomValue] = useState('$990,833');
  const [customUnit, setCustomUnit] = useState('unknown');
  const [customConfidence, setCustomConfidence] = useState(0.87);
  const [customReasoning, setCustomReasoning] = useState(
    'This is a sample reasoning text that demonstrates the scrollable summary section. The AI has analyzed the data source and determined the metric value with the specified confidence level.'
  );

  const getResponse = (): MetricResolutionResponse | null => {
    if (showLoading) return null;
    
    const base = SAMPLE_RESPONSES[selectedPreset];
    return {
      ...base,
      data: {
        ...base.data,
        value: customValue,
        unit: customUnit,
        confidence: customConfidence,
        reasoning: customReasoning,
      },
    };
  };

  if (!debugEnabled) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
          <div className="text-[12px] font-medium text-white">Debug pages disabled</div>
          <div className="mt-1 text-[11px] text-[#9CA3AF]">
            Set <span className="font-mono text-white/80">NEXT_PUBLIC_ENABLE_DEBUG_PAGES=true</span> to enable in production.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-4 space-y-4">
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-[13px] font-medium text-white">Debug: Metric Resolution Modal</div>
            <div className="mt-1 text-[11px] text-[#9CA3AF]">
              Source validation modal for market creation with AI-powered metric extraction.
            </div>
          </div>
          <a
            href="/debug"
            className="rounded border border-[#333333] bg-[#141414] px-3 py-1.5 text-[11px] text-white hover:bg-[#1A1A1A]"
          >
            Back to Debug Hub
          </a>
        </div>
      </div>

      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4 space-y-4">
        <div className="text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide mb-2">Preset Scenarios</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(SAMPLE_RESPONSES).map(([key, resp]) => (
            <button
              key={key}
              onClick={() => setSelectedPreset(key as keyof typeof SAMPLE_RESPONSES)}
              className={`rounded border px-3 py-1.5 text-[11px] transition-all ${
                selectedPreset === key
                  ? 'border-white/30 bg-white/10 text-white'
                  : 'border-[#333333] bg-[#141414] text-[#9CA3AF] hover:bg-[#1A1A1A] hover:text-white'
              }`}
            >
              {key === 'realEstate' && 'Real Estate'}
              {key === 'crypto' && 'Crypto (High Conf)'}
              {key === 'stock' && 'Stock (Med Conf)'}
              {key === 'lowConfidence' && 'Low Confidence'}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4 space-y-4">
        <div className="text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide mb-2">Custom Values</div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Value</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
            />
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Unit</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={customUnit}
              onChange={(e) => setCustomUnit(e.target.value)}
            />
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Confidence ({Math.round(customConfidence * 100)}%)</div>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(customConfidence * 100)}
              onChange={(e) => setCustomConfidence(Number(e.target.value) / 100)}
              className="w-full"
            />
            <div className="flex justify-between text-[9px] text-[#606060] mt-1">
              <span>Low (red)</span>
              <span>Medium (yellow)</span>
              <span>High (green)</span>
            </div>
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Error Message</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={errorMessage}
              onChange={(e) => setErrorMessage(e.target.value)}
            />
          </label>
        </div>

        <label className="block">
          <div className="text-[10px] text-[#808080] mb-1">Reasoning (Summary text)</div>
          <textarea
            className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[11px] text-white resize-y min-h-[80px]"
            value={customReasoning}
            onChange={(e) => setCustomReasoning(e.target.value)}
          />
        </label>
      </div>

      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4 space-y-4">
        <div className="text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide mb-2">Actions</div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => {
              setShowLoading(false);
              setShowError(false);
              setOpen(true);
            }}
            className="rounded bg-white px-3 py-2 text-[12px] font-medium text-black hover:bg-white/90"
          >
            Open Modal
          </button>

          <button
            onClick={() => {
              setShowLoading(true);
              setShowError(false);
              setOpen(true);
            }}
            className="rounded border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[12px] font-medium text-blue-300 hover:bg-blue-500/15"
          >
            Show Loading
          </button>

          <button
            onClick={() => {
              setShowLoading(false);
              setShowError(true);
              setOpen(true);
            }}
            className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-300 hover:bg-red-500/15"
          >
            Show Error
          </button>

          <button
            onClick={() => setOpen(false)}
            className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] font-medium text-white hover:bg-[#1A1A1A]"
          >
            Close Modal
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-[11px] text-[#9CA3AF]">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showLoading}
              onChange={(e) => setShowLoading(e.target.checked)}
              className="accent-white"
            />
            Loading state
          </label>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showError}
              onChange={(e) => setShowError(e.target.checked)}
              className="accent-white"
            />
            Error state
          </label>
        </div>
      </div>

      <MetricResolutionModal
        isOpen={open}
        onClose={() => setOpen(false)}
        response={getResponse()}
        error={showError ? errorMessage : undefined}
        onAccept={() => {
          console.log('Accept clicked');
          setOpen(false);
        }}
        onDeny={() => {
          console.log('Deny clicked');
          setOpen(false);
        }}
        onPickAnotherSource={() => {
          console.log('Pick another source clicked');
          setOpen(false);
        }}
        onDenySuggestedAssetPrice={() => {
          console.log('Deny suggested asset price clicked');
        }}
        imageUrl="https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=600&h=300&fit=crop&auto=format"
        fullscreenImageUrl="https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=1400&h=900&fit=crop&auto=format"
      />
    </div>
  );
}
