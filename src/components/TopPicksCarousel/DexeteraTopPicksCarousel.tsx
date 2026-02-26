'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';

export type DexeteraTopPickItem = {
  id: string;
  title: string;
  imageUrl?: string | null;
  imageAlt?: string;
  statLabel?: string;
  price?: number | null;
  currency?: string;
  statValue?: string;
  changePercent?: number | null;
  isVerified?: boolean;
};

export type DexeteraTopPicksCarouselProps = {
  title?: string;
  subtitle?: string;
  items: DexeteraTopPickItem[];
  onItemClick?: (id: string) => void;
  className?: string;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatStatValue(item: DexeteraTopPickItem) {
  if (item.statValue && item.statValue.trim()) return item.statValue;
  const price = Number(item.price ?? NaN);
  if (!Number.isFinite(price)) return '';
  const currency = (item.currency || '').trim();

  if (price > 0 && price < 0.01) {
    return currency && /^[A-Z]{3}$/.test(currency) ? `< 0.01 ${currency}` : '< 0.01';
  }

  if (currency && /^[A-Z]{3}$/.test(currency)) {
    return `${formatNumber(price)} ${currency}`;
  }

  if (currency) return `${currency}${formatNumber(price)}`;
  return formatNumber(price);
}

function formatChange(changePercent?: number | null) {
  if (changePercent == null || !Number.isFinite(changePercent)) return null;
  const sign = changePercent >= 0 ? '+' : '';
  return `${sign}${changePercent.toFixed(1)}%`;
}

const VerifiedBadge = ({ className = '' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-label="Verified">
    <circle cx="12" cy="12" r="10" fill="#3B82F6" />
    <path
      d="M9 12l2 2 4-4"
      stroke="white"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default function DexeteraTopPicksCarousel({
  title = 'Top Picks',
  subtitle = "This week’s top picks",
  items,
  onItemClick,
  className = '',
}: DexeteraTopPicksCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [cardWidth, setCardWidth] = useState(0);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const updateLayout = () => {
      const w = el.clientWidth;
      setCardWidth(Math.floor((w - 64) / 4.25)); // 64 = 4 gaps × 16px
    };

    updateLayout();
    const onScroll = () => updateScrollState();
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', updateLayout);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', updateLayout);
    };
  }, [items.length, updateScrollState]);

  // Re-check scroll boundaries after cardWidth changes and the DOM reflows
  useEffect(() => {
    if (!cardWidth) return;
    requestAnimationFrame(updateScrollState);
  }, [cardWidth, updateScrollState]);

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = cardWidth * 4 + 16 * 3;
    el.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth',
    });
  };

  if (!items || items.length === 0) return null;

  return (
    <section className={`w-full py-3 ${className}`}>
      <div>
        <div className="flex flex-col gap-1">
          <h2 className="text-[20px] font-medium leading-tight text-white">{title}</h2>
          {subtitle ? <p className="text-sm text-white/60">{subtitle}</p> : null}
        </div>
      </div>

      <div className="group/carousel relative mt-5">
        {/* Right edge fade — subtle gradient over the peeking 5th card */}
        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-10"
          style={{
            width: cardWidth ? Math.round(cardWidth * 0.55) : 0,
            background:
              'linear-gradient(to left, var(--primary-bg) 0%, rgba(26,26,26,0.88) 30%, rgba(26,26,26,0.4) 65%, transparent 100%)',
          }}
        />

        {/* Scroll buttons — visible on hover, disabled at scroll boundaries */}
        <button
          type="button"
          onClick={() => scroll('left')}
          disabled={!canScrollLeft}
          aria-label="Scroll left"
          className="absolute left-2 top-1/2 z-20 hidden -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/50 p-3 text-white shadow-lg backdrop-blur transition-all hover:bg-black/70 focus:outline-none disabled:cursor-not-allowed disabled:opacity-30 md:flex"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => scroll('right')}
          disabled={!canScrollRight}
          aria-label="Scroll right"
          className="absolute right-1 top-1/2 z-20 hidden -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/50 p-3 text-white shadow-lg backdrop-blur transition-all hover:bg-black/70 focus:outline-none disabled:cursor-not-allowed disabled:opacity-30 md:flex"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
            <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <div
          ref={scrollRef}
          className="scrollbar-none flex snap-x snap-proximity gap-4 overflow-x-auto scroll-smooth pb-2"
          role="region"
          aria-label="Dexetera top picks"
        >
          {items.map((item) => {
            const statValue = formatStatValue(item);
            const changeText = formatChange(item.changePercent);
            const isPositive = (item.changePercent ?? 0) >= 0;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onItemClick?.(item.id)}
                className="group relative snap-start overflow-hidden rounded-md border border-white/10 bg-white/5 shadow-sm transition hover:border-white/20 hover:shadow-md focus:outline-none"
                style={{
                  height: 200,
                  minWidth: cardWidth || 200,
                  flexShrink: 0,
                }}
              >
                <div className="absolute inset-0 bg-black">
                  <Image
                    src={item.imageUrl || '/template.png'}
                    alt={item.imageAlt || item.title}
                    fill
                    sizes="(max-width: 640px) 45vw, 22vw"
                    className="object-contain transition duration-300 group-hover:scale-[1.02]"
                  />
                  <div className="absolute inset-0 bg-black/20 transition group-hover:bg-black/10" />
                </div>

                <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-4 text-left">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h3 className="truncate text-sm font-medium text-white" title={item.title}>
                          {item.title}
                        </h3>
                        {item.isVerified ? <VerifiedBadge className="h-4 w-4 shrink-0" /> : null}
                      </div>
                    </div>
                  </div>

                  {(item.statLabel || statValue || changeText) && (
                    <div className="mt-2 flex items-center gap-2 text-[13px]">
                      {item.statLabel ? (
                        <span className="text-white/70">{item.statLabel}:</span>
                      ) : null}
                      {statValue ? <span className="text-white">{statValue}</span> : null}
                      {changeText ? (
                        <span
                          className={`ml-auto font-medium ${
                            isPositive ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {changeText}
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

