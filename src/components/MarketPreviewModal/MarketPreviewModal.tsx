'use client';

import React, { useEffect, useState, useRef } from 'react';
import { MarketPreviewModalProps } from './types';
import styles from './MarketPreviewModal.module.css';

const MarketPreviewModal: React.FC<MarketPreviewModalProps> = ({
  isOpen,
  onClose,
  productTitle,
  author,
  price,
  currency = '$',
  description,
  category,
  templates,
  onGoToProduct,
}) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [shouldAnimate, setShouldAnimate] = useState(false);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && document.body) {
        try {
          document.body.style.overflow = 'unset';
        } catch (error) {
          console.warn('Error cleaning up body overflow on unmount:', error);
        }
      }
    };
  }, []);

  // Use useRef to store scroll position to avoid DOM property manipulation
  const scrollPositionRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    if (isOpen) {
      setIsAnimating(true);
      setShouldAnimate(false);
      
      // Store current scroll position in ref
      scrollPositionRef.current = window.scrollY || 0;
      
      // Simple scroll lock
      if (document.body) {
        document.body.style.overflow = 'hidden';
      }
      
      // Start animation after a brief delay
      const timer = setTimeout(() => {
        setShouldAnimate(true);
      }, 50);
      
      return () => {
        if (timer) clearTimeout(timer);
      };
    } else {
      setShouldAnimate(false);
      
      // Restore scroll when modal closes
      if (document.body) {
        document.body.style.overflow = '';
      }
      
      // Restore scroll position
      if (scrollPositionRef.current !== undefined) {
        window.scrollTo(0, scrollPositionRef.current);
      }
      
      // Reset animation state after a delay
      const timer = setTimeout(() => {
        setIsAnimating(false);
      }, 1000);
      
      return () => {
        if (timer) clearTimeout(timer);
      };
    }
  }, [isOpen]);

  // Cleanup effect to ensure scroll is restored on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && document?.body) {
        document.body.style.overflow = '';
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    
    return () => {
      if (typeof window !== 'undefined') {
        document.removeEventListener('keydown', handleEscape);
      }
    };
  }, [isOpen, onClose]);

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    try {
      if (event.target === event.currentTarget) {
        onClose();
      }
    } catch (error) {
      console.warn('Error in backdrop click handler:', error);
      onClose(); // Still try to close the modal
    }
  };

  const handleAnimationEnd = () => {
    try {
      if (!isOpen && !shouldAnimate) {
        setIsAnimating(false);
        setShouldAnimate(false);
      }
    } catch (error) {
      console.warn('Error in animation end handler:', error);
      setIsAnimating(false); // Ensure animation state is reset
      setShouldAnimate(false);
    }
  };

  // Don't render on server-side
  if (typeof window === 'undefined') {
    return null;
  }

  if (!isOpen && !isAnimating) {
    return null;
  }

  try {
    return (
      <div
        className={`${styles.backdrop} ${shouldAnimate ? styles.open : ''}`}
        onClick={handleBackdropClick}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
      <div
        className={`${styles.modal} ${shouldAnimate ? styles.open : ''}`}
        onTransitionEnd={handleAnimationEnd}
      >
        <div className={styles.dragHandle} />
        
        <button
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close modal"
        >
          ×
        </button>

        <div className={styles.content}>
          <div className={styles.grid}>
            {/* Left Column - Product Information */}
            <div className={styles.leftColumn}>
              {category && (
                <span className={styles.category}>{category}</span>
              )}

              <h1 id="modal-title" className={styles.title}>
                {productTitle}
              </h1>

              <p className={styles.author}>
                <span className={styles.authorLabel}>by</span>
                {author}
              </p>

              {/* Pricing and Button Section with Separators */}
              <div className={styles.pricingSection}>
                <div className={styles.pricingButtonRow}>
                  <div className={styles.pricing}>
                    <span className={styles.priceLabel}>from</span>
                    <span className={styles.priceAmount}>
                      {price}
                    </span>
                    <span className={styles.currency}>{currency}</span>
                  </div>

                                <button
                    className={styles.ctaButton}
                    onClick={onGoToProduct}
                  >
                    Go to Market
                  </button>
                </div>
              </div>

              <p className={styles.description}>
                {description}
              </p>
            </div>

            {/* Right Column - Image Preview */}
            <div className={styles.rightColumn}>
              {/* Main Preview Image */}
              <div className={styles.mainPreview}>
                <div className={styles.previewFrame}>
                  {templates.length > 0 && templates[0].image ? (
                    <img
                      src={templates[0].image}
                      alt={templates[0].title}
                      className={styles.mainPreviewImage}
                    />
                  ) : (
                    <div className={styles.placeholderImage}>
                      <span>Preview Image</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Template Grid */}
              <div className={styles.templateGrid}>
                {templates.slice(0, 4).map((template, index) => (
                  <div key={template.id} className={styles.templateCard}>
                    <div className={styles.miniPreview}>
                      {template.image ? (
                        <img
                          src={template.image}
                          alt={template.title}
                          className={styles.miniPreviewImage}
                        />
                      ) : (
                        <div className={styles.placeholderMini}>
                          {template.title.charAt(0)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                
                {/* Fill remaining slots with placeholders if needed */}
                {Array.from({ length: Math.max(0, 4 - templates.length) }, (_, index) => (
                  <div key={`placeholder-${index}`} className={styles.templateCard}>
                    <div className={styles.miniPreview}>
                      <div className={styles.placeholderMini}>
                        <span>+</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    );
  } catch (error) {
    console.error('Error rendering MarketPreviewModal:', error);
    // Return a simple fallback if there's a rendering error
    return null;
  }
};

export default MarketPreviewModal; 