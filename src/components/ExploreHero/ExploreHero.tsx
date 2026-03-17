'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { ExploreMarket } from '@/hooks/useExploreMarkets';
import styles from './ExploreHero.module.css';

const ROTATE_INTERVAL = 6000;
const HERO_COUNT = 5;

function formatPrice(price: number | null): string {
  if (price == null || price === 0) return '—';
  if (price >= 1) return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(6)}`;
}

function formatVolume(vol: number): string {
  if (!vol || vol === 0) return '$0';
  if (vol >= 1_000_000_000) return `$${(vol / 1_000_000_000).toFixed(1)}B`;
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(1)}K`;
  return `$${vol.toFixed(0)}`;
}

function formatChange(value: number): { text: string; positive: boolean } {
  if (value === 0) return { text: '0.00%', positive: true };
  const positive = value > 0;
  return { text: `${positive ? '+' : ''}${value.toFixed(2)}%`, positive };
}

interface ExploreHeroProps {
  markets: ExploreMarket[];
}

export default function ExploreHero({ markets }: ExploreHeroProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [direction, setDirection] = useState(1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const heroMarkets = useMemo(() => {
    if (!markets || markets.length === 0) return [];
    const sorted = [...markets]
      .filter(m => m.banner_image_url || m.icon_image_url)
      .sort((a, b) => b.trending_score - a.trending_score);
    return sorted.slice(0, HERO_COUNT);
  }, [markets]);

  const goTo = useCallback((index: number) => {
    setDirection(index > activeIndex ? 1 : -1);
    setActiveIndex(index);
  }, [activeIndex]);

  const goNext = useCallback(() => {
    setDirection(1);
    setActiveIndex(prev => (prev + 1) % heroMarkets.length);
  }, [heroMarkets.length]);

  const goPrev = useCallback(() => {
    setDirection(-1);
    setActiveIndex(prev => (prev - 1 + heroMarkets.length) % heroMarkets.length);
  }, [heroMarkets.length]);

  useEffect(() => {
    if (isPaused || heroMarkets.length <= 1) return;
    timerRef.current = setInterval(goNext, ROTATE_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, goNext, heroMarkets.length, activeIndex]);

  if (heroMarkets.length === 0) return null;

  const current = heroMarkets[activeIndex];
  if (!current) return null;

  const change24h = formatChange(current.price_change_24h);
  const href = `/token/${current.symbol?.toLowerCase() || current.market_identifier}`;
  const bgImage = current.banner_image_url || current.icon_image_url;

  const slideVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 60 : -60,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? -60 : 60,
      opacity: 0,
    }),
  };

  return (
    <section
      className={styles.heroWrap}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Background layer */}
      <div className={styles.bgLayer}>
        <AnimatePresence mode="popLayout" custom={direction}>
          <motion.div
            key={`bg-${activeIndex}`}
            custom={direction}
            initial={{ opacity: 0, scale: 1.08 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className={styles.bgImage}
          >
            {bgImage && (
              <Image
                src={bgImage}
                alt=""
                fill
                sizes="100vw"
                className="object-cover"
                priority={activeIndex === 0}
              />
            )}
          </motion.div>
        </AnimatePresence>
        <div className={styles.bgOverlay} />
        <div className={styles.bgGrain} />
      </div>

      {/* Content */}
      <div className={styles.content}>
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={`content-${activeIndex}`}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className={styles.slideContent}
          >
            <div className={styles.topRow}>
              <div className={styles.badge}>
                <span className={styles.badgeDot} />
                TRENDING
              </div>
              <div className={styles.rankBadge}>
                #{activeIndex + 1}
              </div>
            </div>

            <Link href={href} className={styles.titleLink}>
              <div className={styles.tokenInfo}>
                <div className={styles.tokenIcon}>
                  <Image
                    src={current.icon_image_url || '/template.png'}
                    alt={current.symbol}
                    fill
                    sizes="56px"
                    className="object-cover"
                  />
                </div>
                <div className={styles.tokenText}>
                  <h2 className={styles.tokenSymbol}>
                    {current.symbol}
                    <span className={styles.tokenPair}>/USDC</span>
                  </h2>
                  <p className={styles.tokenName}>{current.name}</p>
                </div>
              </div>
            </Link>

            <div className={styles.statsRow}>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Price</span>
                <span className={styles.statValue}>{formatPrice(current.mark_price)}</span>
              </div>
              <div className={styles.statDivider} />
              <div className={styles.stat}>
                <span className={styles.statLabel}>24h Change</span>
                <span className={`${styles.statValue} ${change24h.positive ? styles.positive : styles.negative}`}>
                  {change24h.text}
                </span>
              </div>
              <div className={styles.statDivider} />
              <div className={styles.stat}>
                <span className={styles.statLabel}>Volume</span>
                <span className={styles.statValue}>{formatVolume(current.total_volume)}</span>
              </div>
              <div className={`${styles.statDivider} ${styles.hideMobile}`} />
              <div className={`${styles.stat} ${styles.hideMobile}`}>
                <span className={styles.statLabel}>Trades</span>
                <span className={styles.statValue}>{current.total_trades.toLocaleString()}</span>
              </div>
            </div>

            {current.description && (
              <p className={styles.description}>
                {current.description.length > 120
                  ? current.description.slice(0, 120) + '...'
                  : current.description}
              </p>
            )}

            <Link href={href} className={styles.ctaButton}>
              View Market
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
          </motion.div>
        </AnimatePresence>

        {/* Navigation */}
        {heroMarkets.length > 1 && (
          <div className={styles.nav}>
            <button onClick={goPrev} className={styles.navArrow} aria-label="Previous slide">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>

            <div className={styles.dots}>
              {heroMarkets.map((m, i) => (
                <button
                  key={m.market_id}
                  onClick={() => goTo(i)}
                  className={`${styles.dot} ${i === activeIndex ? styles.dotActive : ''}`}
                  aria-label={`Go to slide ${i + 1}`}
                >
                  {i === activeIndex && (
                    <motion.div
                      className={styles.dotProgress}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: isPaused ? undefined : 1 }}
                      transition={{
                        duration: ROTATE_INTERVAL / 1000,
                        ease: 'linear',
                      }}
                      key={`progress-${activeIndex}-${Date.now()}`}
                    />
                  )}
                </button>
              ))}
            </div>

            <button onClick={goNext} className={styles.navArrow} aria-label="Next slide">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Side preview strip — desktop only */}
      {heroMarkets.length > 1 && (
        <div className={styles.sideStrip}>
          {heroMarkets.map((m, i) => {
            const isActive = i === activeIndex;
            return (
              <button
                key={m.market_id}
                onClick={() => goTo(i)}
                className={`${styles.stripItem} ${isActive ? styles.stripItemActive : ''}`}
              >
                <div className={styles.stripIcon}>
                  <Image
                    src={m.icon_image_url || '/template.png'}
                    alt={m.symbol}
                    fill
                    sizes="32px"
                    className="object-cover"
                  />
                </div>
                <div className={styles.stripText}>
                  <span className={styles.stripSymbol}>{m.symbol}</span>
                  <span className={`${styles.stripChange} ${m.price_change_24h >= 0 ? styles.positive : styles.negative}`}>
                    {m.price_change_24h >= 0 ? '+' : ''}{m.price_change_24h.toFixed(1)}%
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
