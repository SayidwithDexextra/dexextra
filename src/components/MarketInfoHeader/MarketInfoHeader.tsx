'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import styles from './MarketInfoHeader.module.css';
import { ShareModal } from '../ShareModal';
import { Tooltip } from '../ui/Tooltip';

export interface MarketInfoHeaderTag {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface MarketInfoHeaderAction {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
}

export interface MarketStatsOnChain {
  totalTrades: number;
  totalVolume: number;
  totalFees: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadBps: number;
  lastTradePrice: number;
  markPrice: number;
  high24h: number;
  low24h: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  totalMarginLocked?: number;
  // Lifecycle state (on-chain)
  lifecycleState?: number; // 1=Rollover, 2=ChallengeWindow, 3=Settled
  isSettled?: boolean; // true only after settleMarket() tx confirmed
  challengeActive?: boolean;
  challenger?: string;
  challengedPrice?: number;
  challengeBondEscrowed?: number;
  evidenceUrl?: string;
  evidenceHash?: string;
  settlementPrice?: number;
}

export interface SeriesMarketItem {
  marketId: string;
  symbol: string;
  isActive: boolean;
  isPrimary: boolean;
  role?: 'front' | 'next';
  contractCode?: string;
}

export interface SettlementPnLData {
  totalPnl: number;
  returnOnMargin: number;
  totalMarginUsed: number;
  longPnl: number;
  shortPnl: number;
  longCount: number;
  shortCount: number;
}

export interface MarketInfoHeaderProps {
  name: string;
  symbol?: string;
  description?: string;
  logoUrl?: string;
  verified?: boolean;
  status?: 'live' | 'pending' | 'inactive' | 'settlement' | 'settled';
  settlementDate?: string | Date;
  settlementValue?: number | null;
  settlementPnl?: SettlementPnLData | null;
  challengeWindowExpiresAt?: string | Date;
  orderbookAddress?: string;
  marketId?: string;
  markPrice?: number | null;
  markPriceLabel?: string;
  markPricePrefix?: string;
  tags?: MarketInfoHeaderTag[];
  moreTagsCount?: number;
  stats?: Array<{ label: string; value: string }>;
  marketStats?: MarketStatsOnChain | null;
  actions?: MarketInfoHeaderAction[];
  websiteUrl?: string;
  twitterUrl?: string;
  waybackSnapshot?: {
    url: string;
    timestamp?: string;
    source_url?: string;
  };
  onShare?: () => void;
  onWatchlistToggle?: () => void;
  onTriggerSettlementOverlay?: () => void;
  isWatchlisted?: boolean;
  isWatchlistLoading?: boolean;
  isWatchlistDisabled?: boolean;
  seriesSlug?: string;
  seriesMarkets?: SeriesMarketItem[];
  className?: string;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function TwitterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8v8" />
      <path d="M3 4h18v4H3z" />
      <rect x="5" y="8" width="14" height="12" rx="1" />
      <path d="M9 12h6" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function StarIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function LoadingSpinner() {
  return (
    <svg className={styles.spinner} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function truncateAddress(address: string, chars = 4): string {
  if (!address || address.length < chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

function ChevronIcon() {
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function formatSettlementDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const calendarDayDiff = Math.round(
    (targetStart.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24)
  );

  const formatted = d.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
  
  if (diffMs < 0) {
    return `Settled ${formatted}`;
  } else if (calendarDayDiff === 0) {
    return `Settles today`;
  } else if (calendarDayDiff === 1) {
    return `Settles tomorrow`;
  } else if (calendarDayDiff <= 7) {
    return `Settles in ${calendarDayDiff}d`;
  } else {
    return `Settles ${formatted}`;
  }
}

function formatPriceMaybe(value: number | null | undefined, prefix = '$'): string {
  const n = Number(value ?? NaN);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${prefix}${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  })}`;
}

function formatStatValue(value: number, prefix = '$'): string {
  if (!Number.isFinite(value) || value === 0) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${prefix}${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${prefix}${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${prefix}${(value / 1e3).toFixed(1)}K`;
  if (abs >= 1) return `${prefix}${value.toFixed(2)}`;
  return `${prefix}${value.toFixed(6)}`;
}

interface CountdownResult {
  isSettled: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function calculateCountdown(targetDate: Date): CountdownResult {
  const now = new Date();
  const diffMs = targetDate.getTime() - now.getTime();
  
  if (diffMs <= 0) {
    return {
      isSettled: true,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    };
  }
  
  const seconds = Math.floor((diffMs / 1000) % 60);
  const minutes = Math.floor((diffMs / (1000 * 60)) % 60);
  const hours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  return {
    isSettled: false,
    days,
    hours,
    minutes,
    seconds,
  };
}

function useCountdown(targetDate: Date | string | undefined): CountdownResult | null {
  const parsedDate = useMemo(() => {
    if (!targetDate) return null;
    const d = typeof targetDate === 'string' ? new Date(targetDate) : targetDate;
    return isNaN(d.getTime()) ? null : d;
  }, [targetDate]);
  
  const [countdown, setCountdown] = useState<CountdownResult | null>(() => 
    parsedDate ? calculateCountdown(parsedDate) : null
  );
  
  useEffect(() => {
    if (!parsedDate) {
      setCountdown(null);
      return;
    }
    
    setCountdown(calculateCountdown(parsedDate));
    
    const interval = setInterval(() => {
      const result = calculateCountdown(parsedDate);
      setCountdown(result);
      
      if (result.isSettled) {
        clearInterval(interval);
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [parsedDate]);
  
  return countdown;
}

const PLACEHOLDER_LOGO = 'https://api.dicebear.com/9.x/shapes/svg?seed=market&backgroundColor=111111&shape1Color=3b82f6';

export default function MarketInfoHeader({
  name,
  symbol,
  description,
  logoUrl,
  verified = false,
  status = 'live',
  settlementDate,
  settlementValue,
  settlementPnl,
  challengeWindowExpiresAt,
  orderbookAddress,
  marketId,
  markPrice,
  markPriceLabel = 'Mark',
  markPricePrefix = '$',
  tags = [],
  moreTagsCount,
  stats = [],
  marketStats,
  actions = [],
  websiteUrl,
  twitterUrl,
  waybackSnapshot,
  onShare,
  onWatchlistToggle,
  onTriggerSettlementOverlay,
  isWatchlisted = false,
  isWatchlistLoading = false,
  isWatchlistDisabled = false,
  seriesSlug,
  seriesMarkets,
  className,
}: MarketInfoHeaderProps) {
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [copiedField, setCopiedField] = useState<'address' | 'marketId' | null>(null);
  const resolvedLogo = logoUrl || PLACEHOLDER_LOGO;
  const hasDescription = description && description.trim().length > 0;
  const formattedSettlement = settlementDate ? formatSettlementDate(settlementDate) : null;
  const countdown = useCountdown(settlementDate);
  const challengeCountdown = useCountdown(challengeWindowExpiresAt);
  const formattedMarkPrice = useMemo(() => formatPriceMaybe(markPrice, markPricePrefix), [markPrice, markPricePrefix]);
  const hasRollover = seriesSlug && seriesMarkets && seriesMarkets.length >= 1;

  // Only show "settled" when the on-chain isSettled() confirms settleMarket() has executed.
  // Downgrade to "settlement" if isSettled is false OR hasn't loaded yet.
  const effectiveStatus = useMemo(() => {
    if (status === 'settled' && marketStats?.isSettled !== true) {
      return 'settlement' as const;
    }
    return status;
  }, [status, marketStats?.isSettled]);

  const handleWatchlistClick = () => {
    if (!isWatchlistLoading && !isWatchlistDisabled && onWatchlistToggle) {
      onWatchlistToggle();
    }
  };

  const handleShareClick = () => {
    if (onShare) {
      onShare();
    }
    setIsShareModalOpen(true);
  };

  const handleCopy = async (value: string, field: 'address' | 'marketId') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className={`${styles.wrapper} ${className ?? ''}`} data-walkthrough="token-market-header">
      <header className={styles.header}>
        {/* Identity */}
        <div className={styles.identity}>
          <div className={styles.logoWrapper}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resolvedLogo} alt={name} className={styles.logo} />
            <div className={`${styles.statusDot} ${styles[effectiveStatus]}`} />
          </div>
          <div className={styles.nameBlock}>
            <div className={styles.nameRow}>
              <span className={styles.name} title={name}>{name}</span>
              {verified && (
                <span className={styles.verifiedBadge}>
                  <CheckIcon />
                </span>
              )}
            </div>
            {symbol && <span className={styles.symbol}>{symbol}</span>}
          </div>
        </div>

        {/* Mobile inline mark price – sits between identity and settlement badge */}
        {markPrice !== undefined && (
          <div className={styles.markPriceInline} data-walkthrough="token-mark-price">
            <span className={styles.markPriceDot} />
            <span className={styles.markPriceValue}>{formattedMarkPrice}</span>
          </div>
        )}

        {/* Settlement Date Badge */}
        {effectiveStatus === 'settlement' && challengeCountdown ? (() => {
          const cc = challengeCountdown;
          const isExpired = cc.isSettled;
          const badgeClass = [
            styles.settlementBadge,
            isExpired ? styles.settlementBadgeSettling : styles.settlementBadgeSettlement,
          ].filter(Boolean).join(' ');

          return (
            <Tooltip
              content={
                <div className={styles.countdownTooltip}>
                  <div className={styles.countdownTooltipLabel}>
                    {isExpired ? 'Awaiting on-chain settlement' : 'Challenge window closes in'}
                  </div>
                  {!isExpired && (
                    <div className={styles.countdownDisplay}>
                      <span className={styles.countdownUnit}>
                        <span className={styles.countdownValue}>{cc.days}</span>
                        <span className={styles.countdownLabel}>d</span>
                      </span>
                      <span className={styles.countdownSeparator}>:</span>
                      <span className={styles.countdownUnit}>
                        <span className={styles.countdownValue}>{String(cc.hours).padStart(2, '0')}</span>
                        <span className={styles.countdownLabel}>h</span>
                      </span>
                      <span className={styles.countdownSeparator}>:</span>
                      <span className={styles.countdownUnit}>
                        <span className={styles.countdownValue}>{String(cc.minutes).padStart(2, '0')}</span>
                        <span className={styles.countdownLabel}>m</span>
                      </span>
                      <span className={styles.countdownSeparator}>:</span>
                      <span className={styles.countdownUnit}>
                        <span className={styles.countdownValue}>{String(cc.seconds).padStart(2, '0')}</span>
                        <span className={styles.countdownLabel}>s</span>
                      </span>
                    </div>
                  )}
                </div>
              }
              maxWidth={200}
              delay={100}
            >
              <div className={badgeClass} data-walkthrough="token-settlement-date">
                {isExpired ? (
                  <>
                    <div className={styles.settlingDot} />
                    <span>Market Settling</span>
                  </>
                ) : (
                  <>
                    <CalendarIcon />
                    <span className={styles.inlineCountdown}>
                      {cc.days > 0 && <>{cc.days}d </>}
                      {cc.hours > 0 && <>{String(cc.hours).padStart(2, '0')}h </>}
                      {String(cc.minutes).padStart(2, '0')}m{' '}
                      {String(cc.seconds).padStart(2, '0')}s
                    </span>
                  </>
                )}
              </div>
            </Tooltip>
          );
        })() : effectiveStatus === 'settled' ? (
          <div className={`${styles.settlementBadge} ${styles.settlementBadgeSettled}`} data-walkthrough="token-settlement-date">
            <CalendarIcon />
            <span>{settlementDate ? `Settled ${new Date(settlementDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'Settled'}</span>
          </div>
        ) : formattedSettlement && (() => {
          const isImminent = countdown && !countdown.isSettled && countdown.days === 0;
          const isUrgent = isImminent && countdown.hours === 0;
          const badgeClass = [
            styles.settlementBadge,
            isUrgent ? styles.settlementBadgeUrgent : isImminent ? styles.settlementBadgeImminent : '',
          ].filter(Boolean).join(' ');

          return (
            <Tooltip
              content={
                <div className={styles.countdownTooltip}>
                  {countdown && !countdown.isSettled ? (
                    <>
                      <div className={styles.countdownTooltipLabel}>Time until settlement</div>
                      <div className={styles.countdownDisplay}>
                        <span className={styles.countdownUnit}>
                          <span className={styles.countdownValue}>{countdown.days}</span>
                          <span className={styles.countdownLabel}>d</span>
                        </span>
                        <span className={styles.countdownSeparator}>:</span>
                        <span className={styles.countdownUnit}>
                          <span className={styles.countdownValue}>{String(countdown.hours).padStart(2, '0')}</span>
                          <span className={styles.countdownLabel}>h</span>
                        </span>
                        <span className={styles.countdownSeparator}>:</span>
                        <span className={styles.countdownUnit}>
                          <span className={styles.countdownValue}>{String(countdown.minutes).padStart(2, '0')}</span>
                          <span className={styles.countdownLabel}>m</span>
                        </span>
                        <span className={styles.countdownSeparator}>:</span>
                        <span className={styles.countdownUnit}>
                          <span className={styles.countdownValue}>{String(countdown.seconds).padStart(2, '0')}</span>
                          <span className={styles.countdownLabel}>s</span>
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className={styles.countdownTooltipLabel}>Settlement</div>
                  )}
                  <div className={styles.countdownTooltipDate}>
                    {settlementDate ? new Date(settlementDate).toLocaleString() : ''}
                  </div>
                </div>
              }
              maxWidth={200}
              delay={100}
            >
              <div className={badgeClass} data-walkthrough="token-settlement-date">
                <CalendarIcon />
                {isImminent ? (
                  <span className={styles.inlineCountdown}>
                    {countdown.hours > 0 && (
                      <>{String(countdown.hours).padStart(2, '0')}h </>
                    )}
                    {String(countdown.minutes).padStart(2, '0')}m{' '}
                    {String(countdown.seconds).padStart(2, '0')}s
                  </span>
                ) : (
                  <span>{formattedSettlement}</span>
                )}
              </div>
            </Tooltip>
          );
        })()}

        {/* Tags */}
        {tags.length > 0 && (
          <div className={styles.tags}>
            {tags.map((tag, i) =>
              tag.href ? (
                <Link
                  key={i}
                  href={tag.href}
                  className={styles.tag}
                  style={{ cursor: 'pointer' }}
                >
                  {tag.label}
                </Link>
              ) : (
                <span
                  key={i}
                  className={styles.tag}
                  onClick={tag.onClick}
                  style={tag.onClick ? { cursor: 'pointer' } : undefined}
                >
                  {tag.label}
                </span>
              )
            )}
            {typeof moreTagsCount === 'number' && moreTagsCount > 0 && (
              <span className={styles.tagMore}>+{moreTagsCount}</span>
            )}
          </div>
        )}

        {/* Contract Addresses */}
        {(orderbookAddress || marketId) && (
          <div className={styles.addressBadges}>
            {orderbookAddress && (
              <button
                className={`${styles.addressBadge} ${copiedField === 'address' ? styles.addressBadgeCopied : ''}`}
                onClick={() => handleCopy(orderbookAddress, 'address')}
                title={`Orderbook: ${orderbookAddress}`}
              >
                <span className={styles.addressLabel}>OB</span>
                <span className={styles.addressValue}>{truncateAddress(orderbookAddress)}</span>
                <CopyIcon />
              </button>
            )}
            {marketId && (
              <button
                className={`${styles.addressBadge} ${copiedField === 'marketId' ? styles.addressBadgeCopied : ''}`}
                onClick={() => handleCopy(marketId, 'marketId')}
                title={`Market ID: ${marketId}`}
              >
                <span className={styles.addressLabel}>ID</span>
                <span className={styles.addressValue}>{truncateAddress(marketId)}</span>
                <CopyIcon />
              </button>
            )}
          </div>
        )}

        {/* Stats */}
        {stats.length > 0 && (
          <div className={styles.stats}>
            {stats.map((stat, i) => (
              <div key={i} className={styles.stat}>
                <div className={styles.statIcon}>
                  <EyeIcon />
                </div>
                <div className={styles.statContent}>
                  <span className={styles.statLabel}>{stat.label}</span>
                  <span className={styles.statValue}>{stat.value}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Socials */}
        <div className={styles.socials}>
          {websiteUrl && (
            <a
              href={websiteUrl}
              target="_blank"
              rel="noreferrer"
              className={styles.socialLink}
              title="Website"
            >
              <GlobeIcon />
            </a>
          )}
          {twitterUrl && (
            <a
              href={twitterUrl}
              target="_blank"
              rel="noreferrer"
              className={styles.socialLink}
              title="Twitter / X"
            >
              <TwitterIcon />
            </a>
          )}
          {waybackSnapshot?.url && (
            <a
              href={waybackSnapshot.url}
              target="_blank"
              rel="noreferrer"
              className={`${styles.socialLink} ${styles.archiveLink}`}
              title={waybackSnapshot.source_url ? `Archived: ${waybackSnapshot.source_url}` : 'Wayback Archive'}
              data-walkthrough="token-wayback"
            >
              <ArchiveIcon />
            </a>
          )}
        </div>

        {/* Actions */}
        <div className={styles.actions}>
          {/* Watchlist Button */}
          {onWatchlistToggle && (
            <button
              className={`${styles.watchlistBtn} ${isWatchlisted ? styles.watchlistBtnActive : ''}`}
              onClick={handleWatchlistClick}
              disabled={isWatchlistDisabled || isWatchlistLoading}
              title={isWatchlisted ? 'Remove from Watchlist' : 'Add to Watchlist'}
            >
              {isWatchlistLoading ? (
                <LoadingSpinner />
              ) : (
                <StarIcon filled={isWatchlisted} />
              )}
            </button>
          )}
          {actions.map((action, i) => (
            <button
              key={i}
              className={action.primary ? styles.actionBtnPrimary : styles.actionBtn}
              onClick={action.onClick}
              title={action.label}
            >
              {action.icon}
            </button>
          ))}
          <button className={styles.shareBtn} onClick={handleShareClick}>
            <ShareIcon />
            Share
          </button>
        </div>
      </header>

      {/* Contract Rollover Bar */}
      {hasRollover && (
        <div className={styles.rolloverBar}>
          <div className={styles.rolloverInfo}>
            <div className={styles.rolloverDot} />
            <span className={styles.rolloverLabel}>Contract Rollover Active</span>
            <span className={styles.rolloverSlug}>{seriesSlug}</span>
          </div>
          <div className={styles.rolloverMarkets}>
            {seriesMarkets!.map((m) => (
              <button
                key={m.marketId}
                className={`${styles.rolloverMarketBtn} ${m.isActive ? styles.rolloverMarketBtnActive : ''} ${m.isPrimary ? styles.rolloverMarketBtnPrimary : ''}`}
                onClick={() => router.push(`/token/${encodeURIComponent(m.symbol)}`)}
                title={m.isPrimary ? 'Primary' : 'Secondary'}
              >
                <span>{m.symbol}</span>
                {m.contractCode && (
                  <span className={styles.rolloverMarketCode}>{m.contractCode}</span>
                )}
                {m.role && (
                  <span className={styles.rolloverMarketCode}>
                    {m.role === 'front' ? 'Front Year' : 'Next Year'}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* On-Chain Market Stats Bar */}
      {marketStats && (
        <div className={styles.marketStatsBar}>
          <div className={styles.marketStatItem}>
            <span className={styles.marketStatLabel}>Mark</span>
            <span className={styles.marketStatValue}>{formatStatValue(marketStats.markPrice)}</span>
          </div>
          <span className={styles.marketStatDivider} />
          <div className={styles.marketStatItem}>
            <span className={styles.marketStatLabel}>Last</span>
            <span className={styles.marketStatValue}>{formatStatValue(marketStats.lastTradePrice)}</span>
          </div>
          <span className={styles.marketStatDivider} />
          <div className={styles.marketStatItem}>
            <span className={styles.marketStatLabel}>24h Chg</span>
            <span className={`${styles.marketStatValue} ${marketStats.priceChange24h >= 0 ? styles.marketStatPositive : styles.marketStatNegative}`}>
              {marketStats.priceChange24h >= 0 ? '+' : ''}{formatStatValue(marketStats.priceChange24h)}
              {marketStats.priceChangePercent24h !== 0 && (
                <span className={styles.marketStatMuted}> ({marketStats.priceChangePercent24h >= 0 ? '+' : ''}{marketStats.priceChangePercent24h.toFixed(2)}%)</span>
              )}
            </span>
          </div>
          <span className={styles.marketStatDivider} />
          <div className={styles.marketStatItem}>
            <span className={styles.marketStatLabel}>24h High</span>
            <span className={styles.marketStatValue}>{formatStatValue(marketStats.high24h)}</span>
          </div>
          <span className={styles.marketStatDivider} />
          <div className={styles.marketStatItem}>
            <span className={styles.marketStatLabel}>24h Low</span>
            <span className={styles.marketStatValue}>{formatStatValue(marketStats.low24h)}</span>
          </div>
          <span className={styles.marketStatDivider} />
          <div className={styles.marketStatItem}>
            <span className={styles.marketStatLabel}>Bid</span>
            <span className={`${styles.marketStatValue} ${styles.marketStatPositive}`}>{formatStatValue(marketStats.bestBid)}</span>
          </div>
          <span className={styles.marketStatDivider} />
          <div className={styles.marketStatItem}>
            <span className={styles.marketStatLabel}>Ask</span>
            <span className={`${styles.marketStatValue} ${styles.marketStatNegative}`}>{formatStatValue(marketStats.bestAsk)}</span>
          </div>
          <span className={styles.marketStatDivider} />
          <div className={styles.marketStatItem}>
            <span className={styles.marketStatLabel}>Spread</span>
            <span className={styles.marketStatValue}>
              {formatStatValue(marketStats.spread)}
              {marketStats.spreadBps > 0 && <span className={styles.marketStatMuted}> ({(marketStats.spreadBps / 100).toFixed(2)}%)</span>}
            </span>
          </div>
          <span className={styles.marketStatDivider} />
          <div className={styles.marketStatItem}>
            <span className={styles.marketStatLabel}>Volume</span>
            <span className={styles.marketStatValue}>{formatStatValue(marketStats.totalVolume)}</span>
          </div>
          <span className={styles.marketStatDivider} />
          <div className={styles.marketStatItem}>
            <span className={styles.marketStatLabel}>Trades</span>
            <span className={styles.marketStatValue}>{marketStats.totalTrades.toLocaleString()}</span>
          </div>
          {marketStats.totalMarginLocked != null && marketStats.totalMarginLocked > 0 && (
            <>
              <span className={styles.marketStatDivider} />
              <div className={styles.marketStatItem}>
                <span className={styles.marketStatLabel}>Total Margin</span>
                <span className={styles.marketStatValue}>{formatStatValue(marketStats.totalMarginLocked)}</span>
              </div>
            </>
          )}
          {marketStats.lifecycleState != null && marketStats.lifecycleState > 0 && (
            <>
              <span className={styles.marketStatDivider} />
              <div className={styles.marketStatItem}>
                <span className={styles.marketStatLabel}>Lifecycle</span>
                <span className={styles.marketStatValue}>
                  {['Unsettled', 'Rollover', 'Challenge Window', 'Settled'][marketStats.lifecycleState] ?? `State ${marketStats.lifecycleState}`}
                </span>
              </div>
            </>
          )}
          {marketStats.challengeActive && (
            <>
              <span className={styles.marketStatDivider} />
              <div className={styles.marketStatItem}>
                <span className={styles.marketStatLabel}>Challenge</span>
                <span className={`${styles.marketStatValue} ${styles.marketStatNegative}`}>
                  Active — ${formatStatValue(marketStats.challengedPrice ?? 0)}
                </span>
              </div>
            </>
          )}
          {marketStats.evidenceUrl && (
            <>
              <span className={styles.marketStatDivider} />
              <div className={styles.marketStatItem}>
                <span className={styles.marketStatLabel}>Evidence</span>
                <a
                  href={marketStats.evidenceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`${styles.marketStatValue}`}
                  style={{ color: 'var(--color-blue-400, #60a5fa)', textDecoration: 'underline', textUnderlineOffset: '2px' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  Wayback Archive
                </a>
              </div>
            </>
          )}
        </div>
      )}

      {/* Settlement P&L Bar */}
      {effectiveStatus === 'settled' && settlementValue != null && settlementValue > 0 && settlementPnl && (
        <div className={styles.marketStatsBar} style={{ borderTop: '1px solid rgba(251, 191, 36, 0.15)', background: 'rgba(251, 191, 36, 0.03)' }}>
          <div className={styles.marketStatItem}>
            <span className={styles.marketStatLabel} style={{ color: '#fbbf24' }}>Settlement Price</span>
            <span className={styles.marketStatValue}>{formatStatValue(settlementValue)}</span>
          </div>
          {settlementPnl && (
            <>
              <span className={styles.marketStatDivider} />
              <div className={styles.marketStatItem}>
                <span className={styles.marketStatLabel}>Your P&L</span>
                <span className={`${styles.marketStatValue} ${settlementPnl.totalPnl >= 0 ? styles.marketStatPositive : styles.marketStatNegative}`}>
                  {settlementPnl.totalPnl >= 0 ? '+' : ''}{formatStatValue(settlementPnl.totalPnl)}
                </span>
              </div>
              <span className={styles.marketStatDivider} />
              <div className={styles.marketStatItem}>
                <span className={styles.marketStatLabel}>RoM</span>
                <span className={`${styles.marketStatValue} ${settlementPnl.returnOnMargin >= 0 ? styles.marketStatPositive : styles.marketStatNegative}`}>
                  {settlementPnl.returnOnMargin >= 0 ? '+' : ''}{settlementPnl.returnOnMargin.toFixed(2)}%
                </span>
              </div>
              {settlementPnl.longCount > 0 && (
                <>
                  <span className={styles.marketStatDivider} />
                  <div className={styles.marketStatItem}>
                    <span className={styles.marketStatLabel}>Longs ({settlementPnl.longCount})</span>
                    <span className={`${styles.marketStatValue} ${settlementPnl.longPnl >= 0 ? styles.marketStatPositive : styles.marketStatNegative}`}>
                      {settlementPnl.longPnl >= 0 ? '+' : ''}{formatStatValue(settlementPnl.longPnl)}
                    </span>
                  </div>
                </>
              )}
              {settlementPnl.shortCount > 0 && (
                <>
                  <span className={styles.marketStatDivider} />
                  <div className={styles.marketStatItem}>
                    <span className={styles.marketStatLabel}>Shorts ({settlementPnl.shortCount})</span>
                    <span className={`${styles.marketStatValue} ${settlementPnl.shortPnl >= 0 ? styles.marketStatPositive : styles.marketStatNegative}`}>
                      {settlementPnl.shortPnl >= 0 ? '+' : ''}{formatStatValue(settlementPnl.shortPnl)}
                    </span>
                  </div>
                </>
              )}
              <span className={styles.marketStatDivider} />
              <div className={styles.marketStatItem}>
                <span className={styles.marketStatLabel}>Margin Used</span>
                <span className={styles.marketStatValue}>{formatStatValue(settlementPnl.totalMarginUsed)}</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Share Modal */}
      <ShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        title={name}
        text={description || `Check out ${name}`}
      />

      {/* Always-visible Description with Fade Preview */}
      {hasDescription && (
        <div 
          className={`${styles.descriptionBar} ${isExpanded ? styles.descriptionBarExpanded : ''}`}
          onClick={() => setIsExpanded(!isExpanded)}
          data-walkthrough="token-description"
        >
          <div className={styles.descriptionTextWrapper}>
            <p className={styles.descriptionText}>{description}</p>
            <div className={styles.descriptionFade} />
          </div>
          <button
            className={styles.descriptionToggle}
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            title={isExpanded ? 'Show less' : 'Read more'}
          >
            <ChevronIcon />
            <span>{isExpanded ? 'Less' : 'More'}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export { StarIcon, ShareIcon };
