'use client';

import React, { useState, useCallback } from 'react';
import styles from './MarketWizard.module.css';
import { MetricResolutionModal } from '@/components/MetricResolutionModal';
import type { MetricResolutionResponse } from '@/components/MetricResolutionModal/types';
import type { MarketFormData, MetricResolutionData } from './types';

interface AIAssistantState {
  isAnalyzing: boolean;
  analysis: string;
  error: string;
  urls: string[];
  currentUrl: string;
  showModal: boolean;
  modalData: MetricResolutionResponse | null;
  showAcceptedScreenshot: boolean;
}

interface AIAssistantProps {
  metricName: string;
  formData: MarketFormData;
  updateFormData: (data: Partial<MarketFormData>) => void;
}

const AIAssistant: React.FC<AIAssistantProps> = ({ metricName, formData, updateFormData }) => {
  const [assistantState, setAssistantState] = useState<AIAssistantState>({
    isAnalyzing: false,
    analysis: '',
    error: '',
    urls: [],
    currentUrl: '',
    showModal: false,
    modalData: null,
    showAcceptedScreenshot: false
  });

  // Expose analysis function and URLs to parent through formData
  React.useEffect(() => {
    const aiAssistantData = {
      urls: assistantState.urls,
      hasAnalyzed: !!formData.metricResolution && formData.metricResolution.as_of !== '',
      canAnalyze: assistantState.urls.length > 0,
      triggerAnalysis: () => handleAnalyze()
    };
    
    updateFormData({ aiAssistantData });
  }, [assistantState.urls, formData.metricResolution]);

  // Cleanup effect to prevent memory leaks
  React.useEffect(() => {
    return () => {
      // Cancel any pending requests or cleanup
      setAssistantState(prev => ({
        ...prev,
        isAnalyzing: false,
        error: '',
        currentUrl: '',
        showModal: false,
        modalData: null,
        showAcceptedScreenshot: false
      }));
    };
  }, []);

  const handleUrlAdd = () => {
    const url = assistantState.currentUrl.trim();
    if (url && !assistantState.urls.includes(url)) {
      // Basic URL validation
      try {
        new URL(url);
        setAssistantState(prev => ({
          ...prev,
          urls: [...prev.urls, url],
          currentUrl: '',
          error: '' // Clear any existing errors
        }));
      } catch {
        setAssistantState(prev => ({
          ...prev,
          error: 'Please enter a valid URL (including http:// or https://)'
        }));
      }
    }
  };

  const handleUrlRemove = useCallback((index: number) => {
    setAssistantState(prev => ({
      ...prev,
      urls: prev.urls.filter((_, i) => i !== index),
      error: '' // Clear any existing errors
    }));
  }, []);

  const handleAnalyze = async () => {
    if (assistantState.urls.length === 0) {
      setAssistantState(prev => ({
        ...prev,
        error: 'Please add at least one URL to analyze'
      }));
      return;
    }

    setAssistantState(prev => ({
      ...prev,
      isAnalyzing: true,
      error: '',
      analysis: '',
      showModal: true,
      modalData: null // Clear previous data, modal will show loading
    }));

    // Update form data to indicate processing
    updateFormData({
      metricResolution: {
        metric: metricName,
        value: '',
        unit: '',
        as_of: '',
        confidence: 0,
        asset_price_suggestion: '',
        reasoning: '',
        sources: []
      }
    });

    try {
      const response = await fetch('/api/resolve-metric-fast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          metric: metricName,
          description: `Resolve current value for ${metricName}`,
          urls: assistantState.urls
        }),
      });

      if (!response.ok) {
        const errorData: any = await response.json().catch(() => ({ error: 'Metric resolution failed' }));
        throw new Error(errorData.error || 'Metric resolution failed');
      }

      const responseData: any = await response.json();

      if (responseData.status === 'completed' && responseData.data) {
        const metricData = {
          ...responseData.data,
          processingTime: responseData.processingTime,
          cached: responseData.cached
        };

        // Create modal data in the expected format
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

        // Create analysis text in the original format (for fallback)
        const analysisText = `✨ Metric Resolution Results

📊 Value: ${metricData.value} ${metricData.unit}
📅 As of: ${new Date(metricData.as_of).toLocaleDateString()}
🎯 Confidence: ${Math.round(metricData.confidence * 100)}%
💰 Suggested Asset Price: $${metricData.asset_price_suggestion}

🔍 Analysis Reasoning:
${metricData.reasoning}

📝 Data Sources:
${metricData.sources.map((source: any, index: number) => 
  `${index + 1}. ${source.url} (${Math.round(source.match_score * 100)}% match)
     Quote: "${source.quote}"`
).join('\n\n')}`;

        setAssistantState(prev => ({
          ...prev,
          analysis: analysisText,
          isAnalyzing: false,
          showModal: true,
          modalData: modalData
        }));

        // Update form data with the successful resolution
        updateFormData({
          metricResolution: metricData
        });

      } else if (responseData.status === 'processing') {
        // Handle background processing
        pollJobStatus(responseData.jobId);
      } else {
        throw new Error('Unexpected response format');
      }

    } catch (error) {
      console.error('Metric Resolution Error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Metric resolution failed';
      
      setAssistantState(prev => ({
        ...prev,
        error: errorMessage,
        isAnalyzing: false
      }));

      // Update form data with failed status
      updateFormData({
        metricResolution: {
          metric: metricName,
          value: '',
          unit: '',
          as_of: '',
          confidence: 0,
          asset_price_suggestion: '',
          reasoning: errorMessage,
          sources: []
        }
      });
    }
  };

  const pollJobStatus = async (jobId: string) => {
    const maxAttempts = 30; // 30 attempts × 2s = 60s timeout
    let attempts = 0;

    const poll = async () => {
      try {
        attempts++;
        const response = await fetch(`/api/resolve-metric-fast?jobId=${jobId}`);
        const data: any = await response.json();

        if (data.status === 'completed' && data.data) {
          const metricData = {
            ...data.data,
            processingTime: `${data.processingTime}ms`
          };

          // Create modal data in the expected format
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

          // Create analysis text in the original format (for fallback)
          const analysisText = `✨ Metric Resolution Results

📊 Value: ${metricData.value} ${metricData.unit}
📅 As of: ${new Date(metricData.as_of).toLocaleDateString()}
🎯 Confidence: ${Math.round(metricData.confidence * 100)}%
💰 Suggested Asset Price: $${metricData.asset_price_suggestion}

🔍 Analysis Reasoning:
${metricData.reasoning}

📝 Data Sources:
${metricData.sources.map((source: any, index: number) => 
  `${index + 1}. ${source.url} (${Math.round(source.match_score * 100)}% match)
     Quote: "${source.quote}"`
).join('\n\n')}`;

          setAssistantState(prev => ({
            ...prev,
            analysis: analysisText,
            isAnalyzing: false,
            showModal: true,
            modalData: modalData
          }));

          updateFormData({
            metricResolution: metricData
          });

        } else if (data.status === 'failed') {
          throw new Error(data.error || 'Job failed');
        } else if (data.status === 'processing' && attempts < maxAttempts) {
          // Continue polling
          setTimeout(poll, 2000);
        } else {
          throw new Error('Processing timeout');
        }
      } catch (error) {
        console.error('Job polling error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Processing failed';
        
        setAssistantState(prev => ({
          ...prev,
          error: errorMessage,
          isAnalyzing: false
        }));

        updateFormData({
          metricResolution: {
            metric: metricName,
            value: '',
            unit: '',
            as_of: '',
            confidence: 0,
            asset_price_suggestion: '',
            reasoning: errorMessage,
            sources: []
          }
        });
      }
    };

    poll();
  };

  const handleModalClose = () => {
    setAssistantState(prev => ({
      ...prev,
      showModal: false
    }));
  };

  const handleModalAccept = () => {
    setAssistantState(prev => ({
      ...prev,
      showModal: false,
      showAcceptedScreenshot: true
    }));
    // The form data is already updated when the analysis completes
    // Modal acceptance closes modal and shows screenshot below
  };

  return (
    <div className={styles.aiAssistantContainer}>
      <div className={styles.aiAssistantHeader}>
        <div className={styles.aiAssistantIcon}>
          <img
            src="https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/market-images/markets/icon/1752608879138-xv9i75pez9k.gif"
            alt="Gift Icon"
            className={styles.giftIconImage}
            style={{ width: '24px', height: '24px' }}
          />
        </div>
        <div className={styles.aiAssistantTitle}>AI Metric Assistant</div>
        <div className={styles.aiAssistantSubtitle}>
          Add URLs for AI to analyze and validate your metric data
        </div>
      </div>

      <div className={styles.urlInputSection}>
        <div className={styles.urlInputRow}>
          <input
            type="url"
            value={assistantState.currentUrl}
            onChange={(e) => setAssistantState(prev => ({ ...prev, currentUrl: (e.target as any).value, error: '' }))}
            placeholder="https://example.com/data-source"
            className={styles.urlInput}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleUrlAdd();
              }
            }}
            disabled={assistantState.isAnalyzing}
          />
          <button
            type="button"
            onClick={handleUrlAdd}
            className={styles.addUrlButton}
            disabled={!assistantState.currentUrl.trim() || assistantState.isAnalyzing}
          >
            Add URL
          </button>
        </div>

        {assistantState.urls.length > 0 && (
          <div className={styles.urlList}>
            {assistantState.urls.map((url, index) => (
              <div key={`url-${index}-${url.substring(0, 20)}`} className={styles.urlItem}>
                <span className={styles.urlText}>{url}</span>
                <button
                  type="button"
                  onClick={() => handleUrlRemove(index)}
                  className={styles.removeUrlButton}
                  aria-label={`Remove URL ${index + 1}`}
                  disabled={assistantState.isAnalyzing}
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
          className={styles.analyzeButton}
          disabled={assistantState.isAnalyzing || assistantState.urls.length === 0}
        >
          {assistantState.isAnalyzing ? (
            <>
              <div className={styles.spinner} />
              Analyzing URLs...
            </>
          ) : (
            <>
              🔍 Analyze Metric Data
            </>
          )}
        </button>

        {/* Auto-analysis hint */}
        {assistantState.urls.length > 0 && !assistantState.analysis && !assistantState.isAnalyzing && (
          <div className={styles.helpText} style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
            💡 Tip: You can also click "Next Step" to automatically analyze these URLs and proceed
          </div>
        )}
      </div>

      {assistantState.error && (
        <div className={styles.aiErrorMessage}>
          ⚠️ {assistantState.error}
        </div>
      )}

      {/* Accepted Screenshot Display */}
      {assistantState.showAcceptedScreenshot && assistantState.modalData?.data?.sources?.[0]?.screenshot_url && (
        <div className={styles.acceptedScreenshotSection}>
          <div className={styles.screenshotHeader}>
            <span className={styles.screenshotIcon}>📸</span>
            <span className={styles.screenshotTitle}>Analyzed Source Screenshot</span>
          </div>
          <div className={styles.screenshotContainer}>
            <img 
              src={assistantState.modalData.data.sources[0].screenshot_url} 
              alt="Analysis source screenshot"
              className={styles.screenshotImage}
              onClick={() => {
                const url = assistantState.modalData?.data?.sources?.[0]?.screenshot_url;
                if (url && typeof globalThis !== 'undefined' && 'window' in globalThis) {
                  (globalThis as any).window.open(url, '_blank');
                }
              }}
              onError={(e) => {
                // Hide screenshot section if image fails to load
                (e.currentTarget as any).style.display = 'none';
              }}
            />
            <div className={styles.screenshotInfo}>
              <div className={styles.screenshotUrl}>
                Source: {assistantState.modalData.data.sources[0].url}
              </div>
              <div className={styles.screenshotMatch}>
                Match Score: {Math.round(assistantState.modalData.data.sources[0].match_score * 100)}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Metric Resolution Modal */}
      <MetricResolutionModal
        isOpen={assistantState.showModal}
        onClose={handleModalClose}
        response={assistantState.modalData}
        onAccept={handleModalAccept}
        imageUrl={`https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/metric-oracle-screenshots/${assistantState.modalData?.data?.sources?.[0]?.screenshot_url || "/placeholder-market.svg"}`}
        fullscreenImageUrl={`https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/metric-oracle-screenshots/${assistantState.modalData?.data?.sources?.[0]?.screenshot_url || "/placeholder-market.svg"}`}
      />
    </div>
  );
};

export default AIAssistant;
