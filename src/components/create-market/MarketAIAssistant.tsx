'use client';

import React, { useState, forwardRef, useImperativeHandle } from 'react';
import { MetricResolutionModal } from '@/components/MetricResolutionModal';
import type { MetricResolutionResponse } from '@/components/MetricResolutionModal/types';
import { runMetricAIWithPolling, type MetricAIResult } from '@/lib/metricAiWorker';

interface MarketAIAssistantProps {
  metric: string;
  description?: string;
  compact?: boolean;
  onMetricResolution: (data: {
    metricUrl: string;
    dataSource: string;
    startPrice: string;
    sourceLocator?: {
      url: string;
      css_selector?: string;
      xpath?: string;
      html_snippet?: string;
      js_extractor?: string;
    };
  }) => void;
  onRequireInputs?: () => void;
}

export type MarketAIAssistantHandle = {
  startAnalysis: () => void;
};

export const MarketAIAssistant = forwardRef<MarketAIAssistantHandle, MarketAIAssistantProps>(({ metric, description, compact = false, onMetricResolution, onRequireInputs }, ref) => {
  const [state, setState] = useState({
    isAnalyzing: false,
    error: '',
    urls: [] as string[],
    currentUrl: '',
    showModal: false,
    modalData: null as MetricResolutionResponse | null,
    showAcceptedScreenshot: false
  });

  const toModalResponse = (ai: MetricAIResult, processingMs: number): MetricResolutionResponse => {
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
  };

  const handleUrlAdd = () => {
    const url = state.currentUrl.trim();
    if (url && !state.urls.includes(url)) {
      try {
        new URL(url);
        setState(prev => ({
          ...prev,
          urls: [...prev.urls, url],
          currentUrl: '',
          error: ''
        }));
      } catch {
        setState(prev => ({
          ...prev,
          error: 'Please enter a valid URL (including http:// or https://)'
        }));
      }
    }
  };

  const handleUrlRemove = (index: number) => {
    setState(prev => ({
      ...prev,
      urls: prev.urls.filter((_, i) => i !== index),
      error: ''
    }));
  };

  const handleAnalyze = async () => {
    if (!metric || !description) {
      onRequireInputs?.();
      return;
    }
    if (state.urls.length === 0) {
      setState(prev => ({
        ...prev,
        error: 'Please add at least one URL to analyze'
      }));
      return;
    }

    setState(prev => ({
      ...prev,
      isAnalyzing: true,
      error: '',
      showModal: true,
      modalData: null
    }));

    try {
      const started = Date.now();
      const ai = await runMetricAIWithPolling(
        {
          metric: String(metric),
          description: description || `Resolve current value for ${metric}`,
          urls: state.urls,
          context: 'create',
        },
        { intervalMs: 1500, timeoutMs: 15000 }
      );

      if (!ai) throw new Error('AI analysis did not return a result in time');

      const processingMs = Math.max(0, Date.now() - started);
      const modalData = toModalResponse(ai, processingMs);

      setState(prev => ({
        ...prev,
        isAnalyzing: false,
        showModal: true,
        modalData
      }));

      const bestSource = modalData.data.sources?.[0];
      onMetricResolution({
        metricUrl: bestSource?.url || state.urls[0],
        dataSource: bestSource?.url || 'AI Analysis',
        startPrice: modalData.data.asset_price_suggestion || '1',
        sourceLocator: bestSource
          ? {
              url: bestSource.url,
              css_selector: bestSource.css_selector,
              xpath: bestSource.xpath,
              html_snippet: bestSource.html_snippet,
              js_extractor: bestSource.js_extractor
            }
          : undefined
      });

    } catch (error) {
      console.error('Analysis Error:', error);
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Analysis failed',
        isAnalyzing: false,
        showModal: false,
        modalData: null
      }));
    }
  };

  useImperativeHandle(ref, () => ({
    startAnalysis: () => {
      void handleAnalyze();
    }
  }));

  return (
    <div className={`space-y-3 bg-[#0F0F0F] rounded-md border border-[#222222] ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
          <img
            src="https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/market-images/markets/icon/1752608879138-xv9i75pez9k.gif"
            alt="AI Assistant"
            className="w-6 h-6"
          />
        </div>
        <div>
          <h5 className="text-xs font-medium text-white">AI Market Assistant</h5>
          <p className="text-[11px] text-[#808080]">Add URLs for AI to analyze market data</p>
        </div>
      </div>

      <div className="space-y-2.5">
        <div className="flex gap-2">
          <input
            type="url"
            value={state.currentUrl}
            onChange={(e) => setState(prev => ({ ...prev, currentUrl: e.target.value, error: '' }))}
            placeholder="https://example.com/market-data"
            className={`flex-1 bg-[#1A1A1A] border border-[#222222] rounded px-3 ${compact ? 'py-1.5' : 'py-2'} text-[11px] text-white placeholder-[#404040] focus:border-[#333333] focus:outline-none transition-colors`}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleUrlAdd())}
            disabled={state.isAnalyzing}
          />
          <button
            type="button"
            onClick={handleUrlAdd}
            className={`px-3 ${compact ? 'py-1.5' : 'py-2'} bg-[#1A1A1A] border border-[#222222] rounded text-[11px] text-[#808080] hover:border-[#333333] transition-colors disabled:opacity-50`}
            disabled={!state.currentUrl.trim() || state.isAnalyzing}
          >
            Add URL
          </button>
        </div>

        {state.urls.length > 0 && (
          <div className="space-y-1.5">
            {state.urls.map((url, index) => (
              <div
                key={`url-${index}-${url.substring(0, 20)}`}
                className={`flex items-center justify-between bg-[#1A1A1A] rounded px-3 ${compact ? 'py-1.5' : 'py-2'}`}
              >
                <span className="text-[11px] text-white truncate flex-1">{url}</span>
                <button
                  type="button"
                  onClick={() => handleUrlRemove(index)}
                  className="text-[#606060] hover:text-red-400 transition-colors ml-2"
                  disabled={state.isAnalyzing}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={handleAnalyze}
          className={`w-full ${compact ? 'py-2' : 'py-2'} px-4 rounded-md text-[11px] font-medium transition-all duration-200 ${
            state.isAnalyzing || state.urls.length === 0 || !metric || !description
              ? 'bg-[#1A1A1A] text-[#606060] cursor-not-allowed'
              : 'bg-blue-500 hover:bg-blue-600 text-white'
          }`}
          disabled={state.isAnalyzing || state.urls.length === 0 || !metric || !description}
        >
          {state.isAnalyzing ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
              Analyzing...
            </span>
          ) : (
            '✅ Validate Metric'
          )}
        </button>

        {state.error && (
          <div className="text-[11px] text-red-400">
            ⚠️ {state.error}
          </div>
        )}
      </div>

      {/* Metric Resolution Modal */}
      <MetricResolutionModal
        isOpen={state.showModal}
        onClose={() => setState(prev => ({ ...prev, showModal: false }))}
        response={state.modalData}
        onAccept={() => {
          setState(prev => ({ ...prev, showModal: false, showAcceptedScreenshot: true }));
        }}
        onDenySuggestedAssetPrice={() => {
          const bestSource = state.modalData?.data?.sources?.[0];
          // Keep resolved metric URL + data source, but clear start price so the user can input manually.
          onMetricResolution({
            metricUrl: bestSource?.url || state.urls[0] || '',
            dataSource: bestSource?.url || 'AI Analysis',
            startPrice: '',
            sourceLocator: bestSource
              ? {
                  url: bestSource.url,
                  css_selector: bestSource.css_selector,
                  xpath: bestSource.xpath,
                  html_snippet: bestSource.html_snippet,
                  js_extractor: bestSource.js_extractor
                }
              : undefined
          });

          // Keep modal state consistent if reopened
          setState(prev => ({
            ...prev,
            modalData: prev.modalData
              ? {
                  ...prev.modalData,
                  data: {
                    ...prev.modalData.data,
                    asset_price_suggestion: ''
                  }
                }
              : prev.modalData
          }));
        }}
      />
    </div>
  );
});
