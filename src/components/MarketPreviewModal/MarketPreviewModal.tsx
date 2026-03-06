'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
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
  const scrollPositionRef = useRef<number>(0);

  const lockScroll = useCallback(() => {
    if (typeof window === 'undefined') return;
    scrollPositionRef.current = window.scrollY || 0;
    document.body.style.overflow = 'hidden';
  }, []);

  const unlockScroll = useCallback(() => {
    if (typeof window === 'undefined') return;
    document.body.style.overflow = '';
    if (scrollPositionRef.current !== undefined) {
      window.scrollTo(0, scrollPositionRef.current);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') {
        try { document.body.style.overflow = 'unset'; } catch { /* noop */ }
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (isOpen) {
      setIsAnimating(true);
      setShouldAnimate(false);
      lockScroll();
      const t = setTimeout(() => setShouldAnimate(true), 50);
      return () => clearTimeout(t);
    } else {
      setShouldAnimate(false);
      unlockScroll();
      const t = setTimeout(() => setIsAnimating(false), 700);
      return () => clearTimeout(t);
    }
  }, [isOpen, lockScroll, unlockScroll]);

  useEffect(() => {
    return () => { unlockScroll(); };
  }, [unlockScroll]);

  useEffect(() => {
    if (typeof window === 'undefined' || !isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleTransitionEnd = () => {
    if (!isOpen && !shouldAnimate) {
      setIsAnimating(false);
      setShouldAnimate(false);
    }
  };

  if (typeof window === 'undefined') return null;
  if (!isOpen && !isAnimating) return null;

  const mainImage = templates.length > 0 && templates[0].image ? templates[0] : null;

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
        onTransitionEnd={handleTransitionEnd}
      >
        <div className={styles.dragHandle} />

        <button
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close modal"
        >
          &#x2715;
        </button>

        <div className={styles.content}>
          <div className={styles.grid}>
            {/* Left — market info */}
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

              <div className={styles.pricingSection}>
                <div className={styles.pricingButtonRow}>
                  <div className={styles.pricing}>
                    <span className={styles.priceLabel}>from</span>
                    <span className={styles.priceAmount}>{price}</span>
                    <span className={styles.currency}>{currency}</span>
                  </div>
                  <button className={styles.ctaButton} onClick={onGoToProduct}>
                    Go to Market
                  </button>
                </div>
              </div>

              <p className={styles.description}>{description}</p>
            </div>

            {/* Right — preview images */}
            <div className={styles.rightColumn}>
              <div className={styles.mainPreview}>
                <div className={styles.previewFrame}>
                  {mainImage ? (
                    <img
                      src={mainImage.image}
                      alt={mainImage.title}
                      className={styles.mainPreviewImage}
                    />
                  ) : (
                    <div className={styles.placeholderImage}>
                      <span>Preview</span>
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.templateGrid}>
                {templates.slice(0, 4).map((template) => (
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

                {Array.from({ length: Math.max(0, 4 - templates.length) }, (_, i) => (
                  <div key={`placeholder-${i}`} className={styles.templateCard}>
                    <div className={styles.miniPreview}>
                      <div className={styles.placeholderMini}>+</div>
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
};

export default MarketPreviewModal;
