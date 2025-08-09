'use client';

import React from 'react';
import { StepProps, MetricResolutionState } from '../types';
import styles from '../VAMMWizard.module.css';
import { MetricResolutionModal, type MetricResolutionResponse } from '@/components/MetricResolutionModal';

const DATA_SOURCES = [
  { value: 'Chainlink', label: 'Chainlink Oracle Network' },
  { value: 'UMA', label: 'UMA Optimistic Oracle' },
  { value: 'Custom', label: 'Custom Oracle' },
  { value: 'API3', label: 'API3 Airnode' },
  { value: 'Band', label: 'Band Protocol' }
];

// Helper function to convert time components to total seconds
const timeToSeconds = (months: number, days: number, hours: number, minutes: number, seconds: number) => {
  return (months * 30 * 24 * 60 * 60) + (days * 24 * 60 * 60) + (hours * 60 * 60) + (minutes * 60) + seconds;
};

// Helper function to convert seconds to time components
const secondsToTime = (totalSeconds: number) => {
  const months = Math.floor(totalSeconds / (30 * 24 * 60 * 60));
  const remainingAfterMonths = totalSeconds % (30 * 24 * 60 * 60);
  
  const days = Math.floor(remainingAfterMonths / (24 * 60 * 60));
  const remainingAfterDays = remainingAfterMonths % (24 * 60 * 60);
  
  const hours = Math.floor(remainingAfterDays / (60 * 60));
  const remainingAfterHours = remainingAfterDays % (60 * 60);
  
  const minutes = Math.floor(remainingAfterHours / 60);
  const seconds = remainingAfterHours % 60;
  
  return { months, days, hours, minutes, seconds };
};

interface TimePickerProps {
  value: number; // Total seconds
  onChange: (seconds: number) => void;
  error?: string;
}

interface ScrollWheelProps {
  label: string;
  value: number;
  maxValue: number;
  unit: string;
  onValueChange: (unit: string, value: number) => void;
}

function ScrollWheel({ label, value, maxValue, unit, onValueChange }: ScrollWheelProps) {
  const [isDragging, setIsDragging] = React.useState(false);
  const [startY, setStartY] = React.useState(0);
  const [startValue, setStartValue] = React.useState(0);
  const wheelRef = React.useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return; // Ignore clicks on buttons
    setIsDragging(true);
    setStartY(e.clientY);
    setStartValue(value);
    e.preventDefault();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.target !== e.currentTarget) return; // Ignore touches on buttons
    setIsDragging(true);
    setStartY(e.touches[0].clientY);
    setStartValue(value);
    e.preventDefault();
  };

  React.useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = startY - e.clientY;
      const sensitivity = 3; // Pixels per unit
      const deltaValue = Math.round(deltaY / sensitivity);
      const newValue = Math.max(0, Math.min(maxValue, startValue + deltaValue));
      
      if (newValue !== value) {
        onValueChange(unit, newValue);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault(); // Prevent scrolling
      const deltaY = startY - e.touches[0].clientY;
      const sensitivity = 3;
      const deltaValue = Math.round(deltaY / sensitivity);
      const newValue = Math.max(0, Math.min(maxValue, startValue + deltaValue));
      
      if (newValue !== value) {
        onValueChange(unit, newValue);
      }
    };

    const handleEnd = () => {
      setIsDragging(false);
    };

    // Add event listeners with error handling
    try {
      document.addEventListener('mousemove', handleMouseMove, { passive: false });
      document.addEventListener('mouseup', handleEnd, { passive: true });
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleEnd, { passive: true });
    } catch (error) {
      console.error('Error adding event listeners:', error);
      setIsDragging(false);
    }

    // Cleanup function
    return () => {
      try {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleEnd);
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleEnd);
      } catch (error) {
        console.error('Error removing event listeners:', error);
      }
    };
  }, [isDragging, startY, startValue, maxValue, unit]); // Removed value and onValueChange from deps

  // Handle scroll wheel
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const deltaValue = e.deltaY > 0 ? -1 : 1;
    const newValue = Math.max(0, Math.min(maxValue, value + deltaValue));
    onValueChange(unit, newValue);
  };

  const handleIncrement = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const newValue = Math.min(maxValue, value + 1);
    onValueChange(unit, newValue);
  };

  const handleDecrement = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const newValue = Math.max(0, value - 1);
    onValueChange(unit, newValue);
  };

  return (
    <div className={styles.scrollWheelColumn}>
      <div className={styles.scrollWheelLabel}>{label}</div>
      <div 
        ref={wheelRef}
        className={`${styles.scrollWheel} ${isDragging ? styles.scrollWheelDragging : ''}`}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onWheel={handleWheel}
      >
        <div 
          className={styles.scrollWheelUpButton}
          onMouseDown={handleIncrement}
          onTouchStart={handleIncrement}
        />
        <div className={styles.scrollWheelValue}>
          {value.toString().padStart(2, '0')}
        </div>
        <div 
          className={styles.scrollWheelDownButton}
          onMouseDown={handleDecrement}
          onTouchStart={handleDecrement}
        />
        <div className={styles.scrollWheelIndicator} />
      </div>
    </div>
  );
}

function TimePicker({ value, onChange, error }: TimePickerProps) {
  const timeComponents = secondsToTime(value);

  const handleTimeChange = (unit: string, newValue: number) => {
    const current = secondsToTime(value);
    const updated = { ...current, [unit]: newValue };
    const totalSeconds = timeToSeconds(updated.months, updated.days, updated.hours, updated.minutes, updated.seconds);
    onChange(totalSeconds);
  };

  return (
    <div className={styles.timePickerContainer}>
      <div className={styles.timePickerRow}>
        <ScrollWheel
          label="Months"
          value={timeComponents.months}
          maxValue={12}
          unit="months"
          onValueChange={handleTimeChange}
        />
        <ScrollWheel
          label="Days"
          value={timeComponents.days}
          maxValue={30}
          unit="days"
          onValueChange={handleTimeChange}
        />
        <ScrollWheel
          label="Hours"
          value={timeComponents.hours}
          maxValue={23}
          unit="hours"
          onValueChange={handleTimeChange}
        />
        <ScrollWheel
          label="Minutes"
          value={timeComponents.minutes}
          maxValue={59}
          unit="minutes"
          onValueChange={handleTimeChange}
        />
        <ScrollWheel
          label="Seconds"
          value={timeComponents.seconds}
          maxValue={59}
          unit="seconds"
          onValueChange={handleTimeChange}
        />
      </div>
      {error && <div className={styles.errorText}>{error}</div>}
      <div className={styles.helpText}>
        Total: {Math.floor(value / 86400)} days, {Math.floor((value % 86400) / 3600)} hours, {Math.floor((value % 3600) / 60)} minutes, {value % 60} seconds
      </div>
    </div>
  );
}

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

function AIAssistant({ metricName, formData, updateFormData }: { metricName: string; formData: any; updateFormData: (data: any) => void }) {
  const [assistantState, setAssistantState] = React.useState<AIAssistantState>({
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
      hasAnalyzed: !!formData.metricResolution && formData.metricResolution.status !== 'processing',
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

  const handleUrlRemove = React.useCallback((index: number) => {
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
        status: 'processing',
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
        const errorData = await response.json().catch(() => ({ error: 'Metric resolution failed' }));
        throw new Error(errorData.error || 'Metric resolution failed');
      }

      const responseData = await response.json();

      if (responseData.status === 'completed' && responseData.data) {
        const metricData = {
          ...responseData.data,
          status: 'completed' as const,
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
          metricResolution: metricData,
          initialPrice: metricData.asset_price_suggestion || ''
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
          status: 'failed',
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
        const data = await response.json();

        if (data.status === 'completed' && data.data) {
          const metricData = {
            ...data.data,
            status: 'completed' as const,
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
            metricResolution: metricData,
            initialPrice: metricData.asset_price_suggestion || ''
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
            status: 'failed',
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
            onChange={(e) => setAssistantState(prev => ({ ...prev, currentUrl: e.target.value, error: '' }))}
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
              onClick={() => window.open(assistantState.modalData?.data?.sources?.[0]?.screenshot_url, '_blank')}
              onError={(e) => {
                // Hide screenshot section if image fails to load
                e.currentTarget.style.display = 'none';
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
}

export default function Step2MetricsSetup({ formData, updateFormData, onNext, errors }: StepProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext();
  };

  // Debug current form state
  React.useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('🔍 Step 2 Current State:', {
        metricName: formData.metricName,
        metricDataSource: formData.metricDataSource,
        settlementPeriod: formData.settlementPeriod,
        hasMetricResolution: !!formData.metricResolution,
        metricResolutionStatus: formData.metricResolution?.status,
        errors: errors
      });
    }
  }, [formData.metricName, formData.metricDataSource, formData.settlementPeriod, formData.metricResolution, errors]);

  // Error boundary for the component
  React.useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error('Step2MetricsSetup Error:', event.error);
      // Prevent the error from propagating
      event.preventDefault();
    };

    window.addEventListener('error', handleError);
    return () => {
      window.removeEventListener('error', handleError);
    };
  }, []);

  return (
    <form onSubmit={handleSubmit} className={styles.formSection}>
      <div className={styles.stepHeader}>
        <div className={styles.stepNumber}>02.</div>
        <h1 className={styles.pageTitle}>Metrics Setup</h1>
      </div>


      {/* Main Metric Name */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Primary Metric</div>
          <div className={styles.fieldDescription}>
            The main metric name for your VAMM. This will be displayed to users and should clearly identify what they're trading.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>METRIC NAME (*)</div>
          <input
            type="text"
            value={formData.metricName}
            onChange={(e) => updateFormData({ metricName: e.target.value })}
            placeholder="e.g., Bitcoin Price, Tesla Stock, NYC Temperature"
            className={`${styles.input} ${errors.metricName ? styles.inputError : ''}`}
            maxLength={100}
          />
          {errors.metricName && <div className={styles.errorText}>{errors.metricName}</div>}
          <div className={styles.helpText}>
            Clear, descriptive name for the primary metric being tracked
          </div>
        </div>
      </div>

      {/* AI Assistant - Only show if metric name is provided */}
      {formData.metricName.trim() && (
        <div className={styles.fieldRow}>
          <div>
            <div className={styles.fieldLabel}>AI Data Validation</div>
            <div className={styles.fieldDescription}>
              Use our AI assistant to analyze online sources and validate your metric data. Provide URLs for comprehensive analysis.
            </div>
          </div>
          <div className={styles.fieldInput}>
            <AIAssistant 
              metricName={formData.metricName} 
              formData={formData}
              updateFormData={updateFormData}
            />
            {errors.metricResolution && <div className={styles.errorText}>{errors.metricResolution}</div>}
          </div>
        </div>
      )}

      {/* Data Source */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Data Source</div>
          <div className={styles.fieldDescription}>
            The oracle or data provider that will supply price/value feeds for your metrics. We recommend UMA for custom metrics.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>DATA SOURCE (*)</div>
          <select
            value={formData.metricDataSource}
            onChange={(e) => updateFormData({ metricDataSource: e.target.value })}
            className={`${styles.select} ${errors.metricDataSource ? styles.inputError : ''}`}
          >
            <option value="">Select data source...</option>
            {DATA_SOURCES.map((source) => (
              <option key={source.value} value={source.value}>
                {source.label}
              </option>
            ))}
          </select>
          {errors.metricDataSource && <div className={styles.errorText}>{errors.metricDataSource}</div>}
          <div className={styles.helpText}>
            Choose the oracle network that will provide data feeds
          </div>
        </div>
      </div>

      {/* Settlement Period - Timer Picker */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Settlement Period</div>
          <div className={styles.fieldDescription}>
            The time window for position settlement. This determines how long positions remain open before automatic settlement. Typical ranges: 1 hour to 30 days.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>SETTLEMENT PERIOD (*)</div>
          <TimePicker
            value={parseInt(formData.settlementPeriod) || 86400} // Default to 1 day
            onChange={(seconds) => updateFormData({ settlementPeriod: seconds.toString() })}
            error={errors.settlementPeriod}
          />
        </div>
      </div>

      {/* Auto-configured Settings Info */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Auto-Configuration</div>
          <div className={styles.fieldDescription}>
            Some settings are automatically configured for optimal performance and security.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.autoConfigInfo}>
            <div className={styles.autoConfigItem}>
              <span className={styles.autoConfigLabel}>Metric ID:</span>
              <span className={styles.autoConfigValue}>Auto-generated from metric name</span>
            </div>
            <div className={styles.autoConfigItem}>
              <span className={styles.autoConfigLabel}>Update Frequency:</span>
              <span className={styles.autoConfigValue}>Monthly (optimized for cost)</span>
            </div>
            <div className={styles.autoConfigItem}>
              <span className={styles.autoConfigLabel}>Price Decimals:</span>
              <span className={styles.autoConfigValue}>18 (standard precision)</span>
            </div>
            {formData.metricResolution?.asset_price_suggestion && (
              <div className={styles.autoConfigItem}>
                <span className={styles.autoConfigLabel}>Initial Price:</span>
                <span className={styles.autoConfigValue}>${formData.metricResolution.asset_price_suggestion}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </form>
  );
} 