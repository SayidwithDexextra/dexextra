'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './MetricResolutionModal.module.css';
import type { 
  MetricResolution, 
  MetricResolutionResponse, 
  MetricResolutionModalProps 
} from './types';

// Re-export types for convenience
export type { 
  MetricResolution, 
  MetricResolutionResponse, 
  MetricResolutionModalProps 
} from './types';

// Back Arrow Icon Component
const BackArrowIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M19 12H5M12 19L5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Close Icon Component
const CloseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Loading Spinner Component
const LoadingSpinner = () => (
  <div className={styles.loadingContainer}>
    <div className={styles.loadingSpinner} />
    <div className={styles.loadingText}>
      Validating metric source
      <span className={styles.loadingSubtext}>
        AI is analyzing the data to confirm accuracy
      </span>
    </div>
  </div>
);

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
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isImageExpanded, setIsImageExpanded] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Typewriter effect for AI response
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
    }, 100); // 100ms delay between words
    
    return () => clearInterval(timer);
  }, [isOpen, mounted, response?.data?.reasoning]);

  // Handle escape key for fullscreen image
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isImageExpanded) {
        setIsImageExpanded(false);
      }
    };

    if (isImageExpanded) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isImageExpanded]);

  if (!mounted || !isOpen) return null;

  // Check if we're in loading state (modal open but no response data yet)
  const hasError = Boolean(error && String(error).trim());
  const isLoading = (!response || !response.data) && !hasError;
  
  // Only destructure if we have response data
  const data = response?.data;
  const status = response?.status;
  const processingTime = response?.processingTime;
  const cached = response?.cached;
  const performance = response?.performance;

  // Get confidence level styling
  const getConfidenceLevel = (confidence: number) => {
    if (confidence >= 0.8) return 'high';
    if (confidence >= 0.6) return 'medium'; 
    return 'low';
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  const formatConfidence = (confidence: number) => {
    return `${Math.round(confidence * 100)}%`;
  };

  const formatValue = (value: string | undefined) => {
    if (!value) return '';
    
    // Check if the value is a number (with optional decimal places)
    const numericValue = parseFloat(value.replace(/,/g, ''));
    
    if (!isNaN(numericValue)) {
      // Format number with commas and allow up to 4 decimal places (avoid default 3-cap)
      return new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 4
      }).format(numericValue);
    }
    
    // If not a number, return as-is
    return value;
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleAccept = () => {
    if (onAccept) {
      onAccept();
    } else {
      onClose();
    }
  };

  const hasSuggestedAssetPrice = (() => {
    const raw = String(data?.asset_price_suggestion || '').trim();
    if (!raw) return false;
    const numeric = raw.replace(/[^0-9.]/g, '');
    if (!numeric) return false;
    const n = parseFloat(numeric);
    return !Number.isNaN(n);
  })();

  const handleDeny = () => {
    try {
      // If there's a suggested asset price, also call that callback
      if (hasSuggestedAssetPrice) {
        onDenySuggestedAssetPrice?.();
      }
      onDeny?.();
    } finally {
      onClose();
    }
  };

  const handleDenySuggestedAssetPrice = () => {
    try {
      onDenySuggestedAssetPrice?.();
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

  return createPortal(
    <div className={styles.overlay} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        {/* Top Header Bar */}
        <div className={styles.topHeader}>
          <button className={styles.backButton} onClick={onClose} aria-label="Close">
            <BackArrowIcon />
          </button>
          <h1 className={styles.topTitle}>Source Validation</h1>
        </div>

        {/* Header - Metric Info */}
        <div className={styles.header}>
          <div className={styles.approveContainer}>
            <h2 className={styles.title}>{isLoading ? 'Analyzing...' : 'Confirm Metric'}</h2>
            <p className={styles.subtitle}>
              {isLoading ? 'Validating data source accuracy' : data?.metric || 'Loading...'}
            </p>
          </div>
        </div>

        {/* Main Content */}
        <div className={styles.content}>
          {isLoading ? (
            <LoadingSpinner />
          ) : hasError ? (
            <div className={styles.summarySection}>
              <h3 className={styles.summaryTitle}>Couldn’t validate this URL</h3>
              <div className={styles.summaryText}>
                {String(error || '').trim() || 'We couldn’t extract a numeric metric value from that URL.'}
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.4 }}>
                Pick another suggested source, or use <strong>Custom URL</strong> to paste a different public endpoint.
              </div>
              <div style={{ marginTop: 16, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  className={styles.denyButton}
                  onClick={handlePickAnotherSource}
                  type="button"
                >
                  Pick another source
                </button>
                <button
                  className={styles.acceptButton}
                  onClick={handlePickAnotherSource}
                  type="button"
                >
                  Enter custom URL
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Value Display */}
              <div className={styles.valueDisplay}>
                <div className={styles.tokenIcon}>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                </div>
                <div className={styles.valueSection}>
                  <div className={styles.mainValue}>
                    <span className={styles.value}>{formatValue(data?.value)}</span>
                    <span className={styles.unit}>{data?.unit}</span>
                  </div>
                  <div className={`${styles.confidence} ${styles[getConfidenceLevel(data?.confidence || 0)]}`}>
                    <span className={styles.confidenceLabel}>Confidence</span>
                    <span className={styles.confidenceValue}>
                      {formatConfidence(data?.confidence || 0)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Asset Price - Similar to approval amount */}
              <div className={styles.assetPrice}>
                <span className={styles.assetPriceLabel}>Suggested Asset Price</span>
                <span className={styles.assetPriceValue}>
                  {hasSuggestedAssetPrice ? `$${formatValue(data?.asset_price_suggestion)}` : '—'}
                </span>
              </div>

              {/* Summary Section */}
              <div className={styles.summarySection}>
                <h3 className={styles.summaryTitle}>Summary</h3>
                <div className={styles.summaryText}>
                  {displayedText}
                  {isTyping && <span className={styles.cursor}>|</span>}
                </div>
              </div>

              {/* Screenshot/Image Section */}
              <div className={styles.imageSection}>
                <img 
                  src={imageUrl} 
                  alt="Analysis visualization" 
                  className={styles.analysisImage}
                  onClick={() => setIsImageExpanded(true)}
                />
              </div>

              {/* Network Fee equivalent - Processing Time */}
              <div className={styles.networkFee}>
                <span className={styles.feeLabel}>Processing Time</span>
                <span className={styles.feeValue}>{processingTime || 'Calculating...'}</span>
              </div>
            </>
          )}
        </div>

        {/* Action Buttons */}
        <div className={styles.actions}>
          <button 
            className={styles.denyButton} 
            onClick={handleDeny} 
            type="button"
            disabled={isLoading || hasError}
          >
            Deny
          </button>
          <button 
            className={styles.acceptButton} 
            onClick={handleAccept} 
            type="button"
            disabled={isLoading || hasError}
          >
            Accept
          </button>
        </div>
      </div>

      {/* Fullscreen Image Overlay */}
      {isImageExpanded && (
        <div className={styles.imageOverlay} onClick={() => setIsImageExpanded(false)}>
          <div className={styles.imageOverlayContent}>
            <button 
              className={styles.imageCloseButton}
              onClick={() => setIsImageExpanded(false)}
            >
              <CloseIcon />
            </button>
            <img 
              src={fullscreenImageUrl} 
              alt="Analysis visualization - Full size" 
              className={styles.fullscreenImage}
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