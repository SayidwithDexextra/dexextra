'use client';

import React, { useState, forwardRef, useImperativeHandle } from 'react';
import { MetricResolutionModal } from '@/components/MetricResolutionModal';
import type { MetricResolutionResponse } from '@/components/MetricResolutionModal/types';

interface MarketAIAssistantProps {
  metric: string;
  description?: string;
  compact?: boolean;
  onMetricResolution: (data: {
    metricUrl: string;
    dataSource: string;
    startPrice: string;
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
      const response = await fetch('/api/resolve-metric-fast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          metric: metric,
          description: description || `Resolve current value for ${metric}`,
          urls: state.urls
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Analysis failed' }));
        throw new Error(errorData.error || 'Analysis failed');
      }

      const responseData = await response.json();

      if (responseData.status === 'completed' && responseData.data) {
        const metricData = {
          ...responseData.data,
          processingTime: responseData.processingTime,
          cached: responseData.cached
        };

        const modalData: MetricResolutionResponse = {
          status: 'completed',
          processingTime: responseData.processingTime || '0ms',
          cached: responseData.cached || false,
          data: {
            metric: metricData.metric,
            value: metricData.value,
            unit: metricData.unit,
            as_of: metricData.as_of,
            confidence: metricData.confidence,
            asset_price_suggestion: metricData.asset_price_suggestion,
            reasoning: metricData.reasoning,
            sources: metricData.sources.map((source: any) => ({
              url: source.url,
              screenshot_url: source.screenshot_url || '',
              quote: source.quote,
              match_score: source.match_score
            }))
          },
          performance: {
            totalTime: parseInt(responseData.processingTime) || 0,
            breakdown: {
              cacheCheck: '0ms',
              scraping: '0ms',
              processing: responseData.processingTime || '0ms',
              aiAnalysis: '0ms'
            }
          }
        };

        setState(prev => ({
          ...prev,
          isAnalyzing: false,
          showModal: true,
          modalData
        }));

        // Update form with the analyzed data
        onMetricResolution({
          metricUrl: state.urls[0],
          dataSource: metricData.sources[0]?.url || 'AI Analysis',
          startPrice: metricData.asset_price_suggestion || '1'
        });

      } else if (responseData.status === 'processing') {
        pollJobStatus(responseData.jobId);
      } else {
        throw new Error('Unexpected response format');
      }

    } catch (error) {
      console.error('Analysis Error:', error);
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Analysis failed',
        isAnalyzing: false
      }));
    }
  };

  useImperativeHandle(ref, () => ({
    startAnalysis: () => {
      void handleAnalyze();
    }
  }));

  const pollJobStatus = async (jobId: string) => {
    const maxAttempts = 30;
    let attempts = 0;

    const poll = async () => {
      try {
        attempts++;
        const response = await fetch(`/api/resolve-metric-fast?jobId=${jobId}`);
        const data = await response.json();

        if (data.status === 'completed' && data.data) {
          const metricData = {
            ...data.data,
            processingTime: `${data.processingTime}ms`
          };

          const modalData: MetricResolutionResponse = {
            status: 'completed',
            processingTime: data.processingTime || '0ms',
            cached: false,
            data: {
              metric: metricData.metric,
              value: metricData.value,
              unit: metricData.unit,
              as_of: metricData.as_of,
              confidence: metricData.confidence,
              asset_price_suggestion: metricData.asset_price_suggestion,
              reasoning: metricData.reasoning,
              sources: metricData.sources.map((source: any) => ({
                url: source.url,
                screenshot_url: source.screenshot_url || '',
                quote: source.quote,
                match_score: source.match_score
              }))
            },
            performance: {
              totalTime: parseInt(data.processingTime) || 0,
              breakdown: {
                cacheCheck: '0ms',
                scraping: '0ms',
                processing: data.processingTime || '0ms',
                aiAnalysis: '0ms'
              }
            }
          };

          setState(prev => ({
            ...prev,
            isAnalyzing: false,
            showModal: true,
            modalData
          }));

          onMetricResolution({
            metricUrl: state.urls[0],
            dataSource: metricData.sources[0]?.url || 'AI Analysis',
            startPrice: metricData.asset_price_suggestion || '1'
          });

        } else if (data.status === 'failed') {
          throw new Error(data.error || 'Job failed');
        } else if (data.status === 'processing' && attempts < maxAttempts) {
          setTimeout(poll, 2000);
        } else {
          throw new Error('Processing timeout');
        }
      } catch (error) {
        console.error('Job polling error:', error);
        setState(prev => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Processing failed',
          isAnalyzing: false
        }));
      }
    };

    poll();
  };

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
            '🔍 Analyze Market Data'
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
      />
    </div>
  );
});
