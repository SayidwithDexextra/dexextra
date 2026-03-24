'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import styles from './MetricResolutionModal.module.css';
import type { 
  MetricResolution, 
  MetricResolutionResponse, 
  MetricResolutionModalProps 
} from './types';

export type { 
  MetricResolution, 
  MetricResolutionResponse, 
  MetricResolutionModalProps 
} from './types';

const MetricResolutionModal: React.FC<MetricResolutionModalProps> = ({ 
  isOpen, 
  onClose, 
  response,
  error,
  onAccept,
  onDeny,
  onPickAnotherSource,
  onDenySuggestedAssetPrice,
  imageUrl = 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=600&h=300&fit=crop&auto=format',
  fullscreenImageUrl = 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=1400&h=900&fit=crop&auto=format'
}) => {
  const [mounted, setMounted] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isImageExpanded, setIsImageExpanded] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setIsAnimating(false);
      return;
    }
    requestAnimationFrame(() => setIsAnimating(true));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !mounted || !response?.data?.reasoning) return;
    
    const text = response.data.reasoning;
    const words = text.split(' ');
    let currentIndex = 0;
    
    setDisplayedText('');
    setIsTyping(true);
    
    const timer = setInterval(() => {
      if (currentIndex < words.length) {
        setDisplayedText(prev => {
          const newText = currentIndex === 0 ? words[0] : prev + ' ' + words[currentIndex];
          return newText;
        });
        currentIndex++;
      } else {
        setIsTyping(false);
        clearInterval(timer);
      }
    }, 100);
    
    return () => clearInterval(timer);
  }, [isOpen, mounted, response?.data?.reasoning]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isImageExpanded) {
          setIsImageExpanded(false);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, isImageExpanded]);

  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!modalRef.current) return;
      if (!modalRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isImageExpanded) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isImageExpanded]);

  if (!mounted || !isOpen) return null;

  const hasError = Boolean(error && String(error).trim());
  const isLoading = (!response || !response.data) && !hasError;
  const data = response?.data;
  const processingTime = response?.processingTime;

  const getConfidenceLevel = (confidence: number) => {
    if (confidence >= 0.8) return 'high';
    if (confidence >= 0.6) return 'medium'; 
    return 'low';
  };

  const confidenceColors: Record<string, { dot: string; text: string; badge: string }> = {
    high: { dot: 'bg-t-positive', text: 'text-t-positive', badge: 'bg-t-positive/10 text-t-positive' },
    medium: { dot: 'bg-t-warning', text: 'text-t-warning', badge: 'bg-t-warning/10 text-t-warning' },
    low: { dot: 'bg-t-negative', text: 'text-t-negative', badge: 'bg-t-negative/10 text-t-negative' },
  };

  const formatConfidence = (confidence: number) => `${Math.round(confidence * 100)}%`;

  const formatValue = (value: string | undefined) => {
    if (!value) return '';
    const numericValue = parseFloat(value.replace(/,/g, ''));
    if (!isNaN(numericValue)) {
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(numericValue);
    }
    return value;
  };

  const handleAccept = () => {
    if (onAccept) onAccept();
    else onClose();
  };

  const hasSuggestedAssetPrice = (() => {
    const raw = String(data?.asset_price_suggestion || '').trim();
    if (!raw) return false;
    const numeric = raw.replace(/[^0-9.]/g, '');
    if (!numeric) return false;
    return !Number.isNaN(parseFloat(numeric));
  })();

  const handleDeny = () => {
    try {
      if (hasSuggestedAssetPrice) onDenySuggestedAssetPrice?.();
      onDeny?.();
    } finally {
      onClose();
    }
  };

  const handlePickAnotherSource = () => {
    try {
      onPickAnotherSource?.();
    } finally {
      onClose();
    }
  };

  const toneMeta = (() => {
    if (hasError) return { dot: 'bg-t-negative', badge: 'bg-t-negative/10 text-t-negative', label: 'ERROR' };
    if (isLoading) return { dot: 'bg-t-accent', badge: 'bg-t-accent/10 text-t-accent', label: 'VALIDATING' };
    const level = getConfidenceLevel(data?.confidence || 0);
    if (level === 'high') return { dot: 'bg-t-positive', badge: 'bg-t-positive/10 text-t-positive', label: 'VERIFIED' };
    if (level === 'medium') return { dot: 'bg-t-warning', badge: 'bg-t-warning/10 text-t-warning', label: 'REVIEW' };
    return { dot: 'bg-t-negative', badge: 'bg-t-negative/10 text-t-negative', label: 'LOW CONF.' };
  })();

  const confLevel = getConfidenceLevel(data?.confidence || 0);
  const confMeta = confidenceColors[confLevel];

  return createPortal(
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-200 ${isAnimating ? 'opacity-100' : 'opacity-0'}`}>
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: 'var(--t-overlay)' }} onClick={onClose} />

      <div
        ref={modalRef}
        className={`relative z-10 w-full bg-t-card rounded-md border border-t-stroke transition-all duration-200 flex flex-col ${styles.modalEntrance}`}
        style={{ maxWidth: '480px', maxHeight: '85vh', boxShadow: 'var(--t-shadow-lg)' }}
      >
        {/* Header */}
        <div className="p-4 border-b border-t-stroke-sub flex-shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${toneMeta.dot} ${isLoading ? 'animate-pulse' : ''}`} />
                <div className="text-t-fg text-[13px] font-medium tracking-tight truncate">Source Validation</div>
                <div className={`text-[10px] px-1.5 py-0.5 rounded ${toneMeta.badge}`}>{toneMeta.label}</div>
              </div>
              {!isLoading && !hasError && data?.metric ? (
                <div className="mt-1 ml-[14px] text-[10px] text-t-fg-muted leading-relaxed truncate">
                  {data.metric}
                </div>
              ) : null}
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-md border border-t-stroke hover:border-t-stroke-hover hover:bg-t-card-hover text-t-fg-sub transition-all duration-200"
              aria-label="Close"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className={`p-4 flex-1 overflow-y-auto ${styles.hideScrollbar}`}>
          {isLoading ? (
            /* Loading State */
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <div className={`w-5 h-5 border-2 border-t-stroke rounded-full ${styles.spinner}`} style={{ borderTopColor: 'var(--t-accent)' }} />
              <div className="text-center">
                <div className="text-t-fg text-[11px] font-medium">Validating metric source</div>
                <div className="text-t-fg-muted text-[10px] mt-1">Analyzing data accuracy</div>
              </div>
            </div>
          ) : hasError ? (
            /* Error State */
            <div className="space-y-3">
              <div className="rounded-md border border-t-negative/20 bg-t-negative/5 p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-t-negative flex-shrink-0" />
                  <div className="text-[11px] font-medium text-t-negative">Validation Failed</div>
                </div>
                <div className="text-[10px] text-t-fg-muted leading-relaxed">
                  {String(error || '').trim() || 'Couldn\'t extract a numeric metric value from that URL.'}
                </div>
              </div>

              <div className="text-[10px] text-t-fg-muted leading-relaxed">
                Pick another suggested source, or use <span className="text-t-fg font-medium">Custom URL</span> to paste a different public endpoint.
              </div>
            </div>
          ) : (
            /* Success / Data State */
            <div className="space-y-3">
              {/* Value + Confidence */}
              <div className="rounded-md border border-t-stroke bg-t-card-hover p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[9px] text-t-fg-muted uppercase tracking-wider mb-1">Extracted Value</div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-t-fg text-sm font-semibold tracking-tight tabular-nums">{formatValue(data?.value)}</span>
                      {data?.unit ? <span className="text-[10px] text-t-fg-muted">{data.unit}</span> : null}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                    <div className="text-[9px] text-t-fg-muted uppercase tracking-wider">Confidence</div>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${confMeta.dot}`} />
                      <span className={`text-[11px] font-semibold tabular-nums ${confMeta.text}`}>
                        {formatConfidence(data?.confidence || 0)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Suggested Asset Price */}
              <div className="rounded-md border border-t-stroke bg-t-card-hover p-3 flex items-center justify-between">
                <span className="text-[11px] text-t-fg-sub">Suggested Asset Price</span>
                <span className={`text-[11px] font-semibold tabular-nums ${hasSuggestedAssetPrice ? 'text-t-positive' : 'text-t-fg-muted'}`}>
                  {hasSuggestedAssetPrice ? `$${formatValue(data?.asset_price_suggestion)}` : '—'}
                </span>
              </div>

              {/* Summary */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[9px] text-t-fg-muted uppercase tracking-wider font-medium">Summary</div>
                </div>
                <div className={`rounded-md border border-t-stroke bg-t-card-hover p-3 text-[11px] text-t-fg-label leading-relaxed ${styles.summaryScroll}`} style={{ maxHeight: '100px' }}>
                  {displayedText}
                  {isTyping && <span className={styles.cursor}>|</span>}
                </div>
              </div>

              {/* Screenshot */}
              <div>
                <div className="text-[9px] text-t-fg-muted uppercase tracking-wider font-medium mb-1.5">Preview</div>
                <img 
                  src={imageUrl} 
                  alt="Analysis visualization" 
                  className="w-full h-[80px] object-cover rounded-md border border-t-stroke hover:border-t-stroke-hover cursor-pointer transition-all duration-200"
                  onClick={() => setIsImageExpanded(true)}
                />
              </div>

              {/* Processing Time */}
              {processingTime ? (
                <div className="flex items-center justify-between px-3 py-2 rounded-md border border-t-stroke bg-t-card-hover">
                  <span className="text-[10px] text-t-fg-muted">Processing time</span>
                  <span className="text-[10px] text-t-fg-label tabular-nums">{processingTime}</span>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-t-stroke-sub flex-shrink-0">
          <div className="flex items-center justify-end gap-2">
            {hasError ? (
              <>
                <button
                  type="button"
                  onClick={handlePickAnotherSource}
                  className="px-3 py-2 rounded-md text-[11px] border border-t-stroke text-t-fg-sub hover:border-t-stroke-hover hover:bg-t-card-hover hover:text-t-fg transition-all duration-200"
                >
                  Pick another source
                </button>
                <button
                  type="button"
                  onClick={handlePickAnotherSource}
                  className="px-3 py-2 rounded-md text-[11px] border border-t-accent/30 text-t-accent hover:border-t-accent/40 hover:bg-t-accent/5 transition-all duration-200"
                >
                  Enter custom URL
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleDeny}
                  disabled={isLoading}
                  className={`px-3 py-2 rounded-md text-[11px] border transition-all duration-200 ${
                    isLoading
                      ? 'border-t-stroke text-t-fg-muted cursor-not-allowed'
                      : 'border-t-negative/20 text-t-negative hover:border-t-negative/30 hover:bg-t-negative/5'
                  }`}
                >
                  Deny
                </button>
                <button
                  type="button"
                  onClick={handleAccept}
                  disabled={isLoading}
                  className={`px-3 py-2 rounded-md text-[11px] border transition-all duration-200 ${
                    isLoading
                      ? 'border-t-stroke text-t-fg-muted cursor-not-allowed'
                      : 'border-t-positive/30 text-t-positive hover:border-t-positive/40 hover:bg-t-positive/5'
                  }`}
                >
                  Accept
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Fullscreen Image Overlay */}
      {isImageExpanded && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/95 animate-in fade-in" onClick={() => setIsImageExpanded(false)}>
          <div className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center">
            <button 
              className="absolute -top-10 right-0 w-8 h-8 rounded-md border border-t-stroke-hover bg-t-card-hover text-t-fg flex items-center justify-center hover:bg-t-card transition-all duration-200"
              onClick={() => setIsImageExpanded(false)}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <img 
              src={fullscreenImageUrl} 
              alt="Analysis visualization - Full size" 
              className="max-w-full max-h-full object-contain rounded-md"
              style={{ boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8)' }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

export default MetricResolutionModal;
