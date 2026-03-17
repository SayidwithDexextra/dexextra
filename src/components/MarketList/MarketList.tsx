'use client';

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { useExploreMarkets, SortMode, ExploreMarket } from '@/hooks/useExploreMarkets';
import ExploreHero from '@/components/ExploreHero/ExploreHero';
import { Tooltip } from '@/components/ui/Tooltip';

function formatPrice(price: number | null, decimals?: number): string {
  if (price == null || price === 0) return '—';
  if (price >= 1_000_000) return `$${(price / 1_000_000).toFixed(2)}M`;
  if (price >= 10_000) return `$${(price / 1_000).toFixed(1)}K`;
  if (price >= 1) return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  const d = decimals ?? 6;
  return `$${price.toFixed(Math.min(d, 8))}`;
}

function formatVolume(vol: number): string {
  if (!vol || vol === 0) return '—';
  if (vol >= 1_000_000_000) return `$${(vol / 1_000_000_000).toFixed(1)}B`;
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(1)}K`;
  return `$${vol.toFixed(0)}`;
}

function formatCount(n: number): string {
  if (!n || n === 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatAge(dateStr: string | null): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = diff / 60_000;
  if (mins < 60) return `${Math.floor(mins)}m`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = hours / 24;
  if (days < 30) return `${Math.floor(days)}d`;
  const months = days / 30;
  if (months < 12) return `${Math.floor(months)}mo`;
  return `${(days / 365).toFixed(0)}y`;
}

function PriceChangeCell({ value }: { value: number }) {
  if (value === 0) return <span className="text-t-fg-muted">—</span>;
  const isPositive = value > 0;
  return (
    <span className={isPositive ? 'text-green-400' : 'text-red-400'}>
      {isPositive ? '+' : ''}{value.toFixed(2)}%
    </span>
  );
}

function MarketIcon({ url, symbol }: { url: string | null; symbol: string }) {
  if (url) {
    return (
      <div className="explore-icon-wrap w-7 h-7 rounded-full overflow-hidden flex-shrink-0 bg-t-card relative border border-t-fg/[0.08] shadow-[0_0_0_1px_rgba(139,92,246,0.08)]">
        <Image src={url} alt={symbol} fill sizes="28px" className="object-cover" />
      </div>
    );
  }
  return (
    <div className="explore-icon-wrap w-7 h-7 rounded-full flex-shrink-0 bg-t-card flex items-center justify-center border border-t-fg/[0.08] shadow-[0_0_0_1px_rgba(139,92,246,0.08)]">
      <span className="text-[10px] font-semibold text-t-fg-muted">
        {symbol.slice(0, 2).toUpperCase()}
      </span>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  if (status === 'ACTIVE') {
    return <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400 explore-status-pulse" />;
  }
  const color =
    status === 'SETTLEMENT_REQUESTED' || status === 'SETTLEMENT_PROPOSED' ? 'bg-yellow-400' :
    status === 'SETTLED' ? 'bg-blue-400' :
    'bg-t-dot';
  return <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color}`} />;
}

function formatWallet(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function CreatorBadge({ market }: { market: ExploreMarket }) {
  if (!market.creator_wallet_address) return <span className="text-t-fg-muted">—</span>;

  const label = market.creator_display_name || formatWallet(market.creator_wallet_address);

  return (
    <Tooltip
      content={market.creator_wallet_address}
      maxWidth={320}
    >
      <Link
        href={`/user/${market.creator_wallet_address}`}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1.5 max-w-[120px] group/creator"
      >
        {market.creator_profile_image_url ? (
          <Image
            src={market.creator_profile_image_url}
            alt=""
            width={14}
            height={14}
            className="rounded-full flex-shrink-0"
          />
        ) : (
          <div className="w-3.5 h-3.5 rounded-full flex-shrink-0 bg-t-card border border-t-fg/[0.08] flex items-center justify-center">
            <span className="text-[6px] font-semibold text-t-fg-muted">
              {label.slice(0, 1).toUpperCase()}
            </span>
          </div>
        )}
        <span className="text-[11px] text-t-fg-muted truncate group-hover/creator:text-[#a78bfa] transition-colors duration-150">
          {label}
        </span>
      </Link>
    </Tooltip>
  );
}

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'trending', label: 'Trending' },
  { value: 'volume', label: 'Top Volume' },
  { value: 'gainers', label: 'Gainers' },
  { value: 'losers', label: 'Losers' },
  { value: 'newest', label: 'Newest' },
];

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i} className="animate-pulse">
          <td className="py-3 pl-4 pr-1">
            <div className="w-4 h-3 bg-t-inset rounded" />
          </td>
          <td className="py-3 pr-2">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-t-inset flex-shrink-0" />
              <div className="flex flex-col gap-1">
                <div className="w-20 h-3 bg-t-inset rounded" />
                <div className="w-12 h-2.5 bg-t-inset rounded" />
              </div>
            </div>
          </td>
          <td className="hidden sm:table-cell py-3 pr-4"><div className="w-14 h-3 bg-t-inset rounded ml-auto" /></td>
          <td className="hidden sm:table-cell py-3 pr-4"><div className="w-8 h-3 bg-t-inset rounded ml-auto" /></td>
          <td className="hidden sm:table-cell py-3 pr-4"><div className="w-8 h-3 bg-t-inset rounded ml-auto" /></td>
          <td className="hidden sm:table-cell py-3 pr-4"><div className="w-12 h-3 bg-t-inset rounded ml-auto" /></td>
          <td className="hidden sm:table-cell py-3 pr-4"><div className="w-10 h-3 bg-t-inset rounded ml-auto" /></td>
          <td className="hidden sm:table-cell py-3 pr-4"><div className="w-10 h-3 bg-t-inset rounded ml-auto" /></td>
          <td className="hidden sm:table-cell py-3 pr-4"><div className="w-16 h-3 bg-t-inset rounded" /></td>
          <td className="hidden sm:table-cell py-3 pr-4"><div className="w-2 h-2 bg-t-inset rounded-full mx-auto" /></td>
        </tr>
      ))}
    </>
  );
}

function TrendingIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

function BarChartIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="12" width="4" height="8" rx="1" />
      <rect x="10" y="8" width="4" height="12" rx="1" />
      <rect x="17" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

export default function MarketList() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [sort, setSort] = useState<SortMode>('trending');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const categoryParam = searchParams.get('category') || '';

  const clearCategory = useCallback(() => {
    router.push('/explore');
  }, [router]);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: markets, isLoading, error } = useExploreMarkets({
    sort,
    search: debouncedSearch,
    category: categoryParam,
    limit: 100,
  });

  const totalVolume = useMemo(
    () => markets.reduce((sum, m) => sum + (m.total_volume || 0), 0),
    [markets]
  );

  const totalTrades = useMemo(
    () => markets.reduce((sum, m) => sum + (m.total_trades || 0), 0),
    [markets]
  );

  return (
    <div className="w-full max-w-[1400px] mx-auto">
      {/* Page Header */}
      <div className="px-4 pt-2 pb-6">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-lg font-semibold text-t-fg tracking-tight" style={{ fontFamily: 'var(--font-space-grotesk, "Space Grotesk", sans-serif)' }}>
            Explore Markets
          </h1>
          <div className="h-px flex-1 bg-gradient-to-r from-t-stroke via-[rgba(139,92,246,0.15)] to-transparent" />
        </div>
        <p className="text-[11px] text-t-fg-muted tracking-wide">
          Discover prediction markets across crypto, politics, sports, and more
        </p>
      </div>

      {/* Revolving Hero */}
      {!isLoading && markets.length > 0 && (
        <div className="px-2 sm:px-4 pb-6">
          <ExploreHero markets={markets} />
        </div>
      )}

      {/* Stats + Controls Bar */}
      <div className="flex items-center justify-between px-4 pb-4 gap-4 flex-wrap">
        {/* Stats */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-t-fg/[0.02] border border-t-fg/[0.06]">
            <div className="flex items-center justify-center w-5 h-5 rounded bg-[rgba(139,92,246,0.1)]">
              <BarChartIcon />
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] text-t-fg-muted uppercase tracking-wider font-medium" style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}>24H Vol</span>
              <span className="text-[12px] font-semibold text-t-fg tabular-nums" style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}>
                {formatVolume(totalVolume)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-t-fg/[0.02] border border-t-fg/[0.06]">
            <div className="flex items-center justify-center w-5 h-5 rounded bg-[rgba(139,92,246,0.1)]">
              <TrendingIcon />
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] text-t-fg-muted uppercase tracking-wider font-medium" style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}>24H Txns</span>
              <span className="text-[12px] font-semibold text-t-fg tabular-nums" style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}>
                {formatCount(totalTrades)}
              </span>
            </div>
          </div>
        </div>

        {/* Sort Tabs + Search */}
        <div className="flex items-center gap-3 flex-wrap flex-1 justify-end">
          <div className="flex items-center gap-0.5 bg-t-card border border-t-fg/[0.06] rounded-lg p-0.5">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSort(opt.value)}
                className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-all duration-200 ${
                  sort === opt.value
                    ? 'bg-t-fg/[0.06] text-t-fg border border-[rgba(139,92,246,0.2)] explore-sort-active'
                    : 'text-t-fg-muted hover:text-t-fg-sub border border-transparent'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="relative max-w-[200px] w-full">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-t-fg-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search markets..."
              className="w-full bg-t-card border border-t-fg/[0.06] rounded-lg pl-8 pr-3 py-1.5 text-[11px] text-t-fg placeholder-t-fg-muted focus:outline-none focus:border-[rgba(139,92,246,0.35)] focus:shadow-[0_0_0_1px_rgba(139,92,246,0.1)] transition-all duration-200"
            />
          </div>
        </div>
      </div>

      {/* Active Category Filter */}
      {categoryParam && (
        <div className="flex items-center gap-2 px-4 pb-3">
          <span className="text-[10px] text-[#555] uppercase tracking-wider">Filtered by:</span>
          <button
            onClick={clearCategory}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-[rgba(139,92,246,0.1)] border border-[rgba(139,92,246,0.25)] text-[#a78bfa] hover:bg-[rgba(139,92,246,0.15)] hover:border-[rgba(139,92,246,0.35)] transition-all duration-200"
          >
            {categoryParam}
            <svg className="w-3 h-3 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Table */}
      <div className="mx-2 sm:mx-0">
        <div className="explore-table-wrap border border-t-fg/[0.06] shadow-[0_4px_24px_-8px_rgba(0,0,0,0.5),0_0_0_1px_rgba(139,92,246,0.04)]">
          <table className="w-full border-collapse relative z-[1]">
            <thead>
              <tr className="border-b border-t-fg/[0.05]">
                <th className="w-10 py-2.5 pl-4 pr-1 text-left">
                  <span className="text-[10px] text-t-dot uppercase tracking-wider font-medium" style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}>#</span>
                </th>
                <th className="py-2.5 pr-2 text-left">
                  <span className="text-[10px] text-t-dot uppercase tracking-wider font-medium" style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}>Token</span>
                </th>
                <th className="hidden sm:table-cell w-[100px] py-2.5 pr-4 text-right">
                  <span className="text-[10px] text-t-dot uppercase tracking-wider font-medium" style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}>Price</span>
                </th>
                <th className="hidden sm:table-cell w-[52px] py-2.5 pr-4 text-right">
                  <span className="text-[10px] text-t-dot uppercase tracking-wider font-medium" style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}>Age</span>
                </th>
                <th className="hidden sm:table-cell w-[72px] py-2.5 pr-4 text-right">
                  <span className="text-[10px] text-t-dot uppercase tracking-wider font-medium" style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}>Txns</span>
                </th>
                <th className="hidden sm:table-cell w-[88px] py-2.5 pr-4 text-right">
                  <span className="text-[10px] text-t-dot uppercase tracking-wider font-medium" style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}>Volume</span>
                </th>
                <th className="hidden sm:table-cell w-[80px] py-2.5 pr-4 text-right">
                  <span className="text-[10px] text-t-dot uppercase tracking-wider font-medium" style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}>1H</span>
                </th>
                <th className="hidden sm:table-cell w-[80px] py-2.5 pr-4 text-right">
                  <span className="text-[10px] text-t-dot uppercase tracking-wider font-medium" style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}>24H</span>
                </th>
                <th className="hidden sm:table-cell w-[120px] py-2.5 pr-4 text-left">
                  <span className="text-[10px] text-t-dot uppercase tracking-wider font-medium" style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}>Maker</span>
                </th>
                <th className="hidden sm:table-cell w-[50px] py-2.5 pr-4 text-center">
                  <span className="text-[10px] text-t-dot uppercase tracking-wider font-medium" style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}>Status</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && markets.length === 0 ? (
                <SkeletonRows />
              ) : error ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-red-400/80" />
                      <span className="text-[11px] text-t-fg-muted">Failed to load markets</span>
                    </div>
                  </td>
                </tr>
              ) : markets.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-t-dot" />
                      <span className="text-[11px] text-t-fg-muted">No markets found</span>
                    </div>
                  </td>
                </tr>
              ) : (
                markets.map((market, index) => (
                  <MarketRow key={market.market_id} market={market} rank={index + 1} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function formatDateShort(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatOI(value: number): string {
  if (!value) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function statusLabel(status: string): { text: string; dotColor: string; textColor: string } {
  switch (status) {
    case 'ACTIVE': return { text: 'Active', dotColor: 'bg-green-400', textColor: 'text-green-400' };
    case 'SETTLEMENT_REQUESTED': return { text: 'Settlement Requested', dotColor: 'bg-yellow-400', textColor: 'text-yellow-400' };
    case 'SETTLEMENT_PROPOSED': return { text: 'Settlement Proposed', dotColor: 'bg-yellow-400', textColor: 'text-yellow-400' };
    case 'SETTLED': return { text: 'Settled', dotColor: 'bg-blue-400', textColor: 'text-blue-400' };
    default: return { text: status, dotColor: 'bg-t-dot', textColor: 'text-t-fg-sub' };
  }
}

const TOOLTIP_W = 640;
const TOOLTIP_H = 220;

function MarketRow({ market, rank }: { market: ExploreMarket; rank: number }) {
  const href = `/token/${market.symbol?.toLowerCase() || market.market_identifier}`;
  const age = formatAge(market.deployed_at || market.created_at);

  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const [tooltipKey, setTooltipKey] = useState(0);
  const rowRef = useRef<HTMLTableRowElement>(null);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mousePos = useRef({ x: 0, y: 0 });

  const onRowMouseMove = useCallback((e: React.MouseEvent) => {
    mousePos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onRowEnter = useCallback(() => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    enterTimer.current = setTimeout(() => {
      const { x, y } = mousePos.current;
      const pad = 12;

      let top = y - TOOLTIP_H - pad;
      let left = x + pad;

      if (left + TOOLTIP_W > window.innerWidth - pad) left = x - TOOLTIP_W - pad;
      if (top < pad) top = pad;
      if (left < pad) left = pad;

      setTooltipPos({ top, left });
      setTooltipKey(k => k + 1);
      setShowTooltip(true);
    }, 400);
  }, []);

  const onRowLeave = useCallback(() => {
    if (enterTimer.current) { clearTimeout(enterTimer.current); enterTimer.current = null; }
    leaveTimer.current = setTimeout(() => setShowTooltip(false), 180);
  }, []);

  const onTooltipEnter = useCallback(() => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
  }, []);

  useEffect(() => {
    return () => {
      if (enterTimer.current) clearTimeout(enterTimer.current);
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    };
  }, []);

  const status = statusLabel(market.market_status);
  const description = market.description || 'No description available for this market.';
  const truncatedDesc = description.length > 180 ? description.slice(0, 180) + '...' : description;
  const categories = Array.isArray(market.category) ? market.category : market.category ? [market.category] : [];
  const totalOI = market.open_interest_long + market.open_interest_short;
  const pc24 = market.price_change_24h;
  const changeColor = pc24 > 0 ? 'text-green-400' : pc24 < 0 ? 'text-red-400' : 'text-t-fg-muted';
  const changeStr = pc24 === 0 ? '—' : `${pc24 > 0 ? '+' : ''}${pc24.toFixed(2)}%`;

  return (
    <>
      <tr
        ref={rowRef}
        className="group cursor-pointer transition-colors duration-200 hover:bg-[rgba(139,92,246,0.03)] border-b border-t-fg/[0.03] last:border-b-0 explore-row-enter"
        style={{ animationDelay: `${Math.min(rank * 30, 300)}ms` }}
        onMouseEnter={onRowEnter}
        onMouseLeave={onRowLeave}
        onMouseMove={onRowMouseMove}
      >
        <td className="py-2.5 pl-4 pr-1">
          <Link href={href} className="text-[11px] text-t-dot font-mono tabular-nums">{rank}</Link>
        </td>
        <td className="py-2.5 pr-2 max-w-0">
          <Link href={href} className="flex items-center gap-2.5 min-w-0">
            <MarketIcon url={market.icon_image_url} symbol={market.symbol} />
            <div className="flex flex-col min-w-0 overflow-hidden">
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[13px] font-medium text-t-fg truncate group-hover:text-[#a78bfa] transition-colors duration-200" style={{ fontFamily: 'var(--font-space-grotesk, sans-serif)' }}>{market.symbol}</span>
                <span className="text-[10px] text-t-dot flex-shrink-0 font-mono">/USDC</span>
              </div>
              <span className="text-[10px] text-t-fg-muted truncate block">{market.name}</span>
            </div>
          </Link>
        </td>
        <td className="hidden sm:table-cell py-2.5 pr-4 text-right">
          <Link href={href}><span className="text-[12px] text-t-fg font-mono tabular-nums">{formatPrice(market.mark_price, market.decimals)}</span></Link>
        </td>
        <td className="hidden sm:table-cell py-2.5 pr-4 text-right">
          <Link href={href}><span className="text-[11px] text-t-fg-muted">{age}</span></Link>
        </td>
        <td className="hidden sm:table-cell py-2.5 pr-4 text-right">
          <Link href={href}><span className="text-[11px] text-t-fg-muted font-mono tabular-nums">{formatCount(market.total_trades)}</span></Link>
        </td>
        <td className="hidden sm:table-cell py-2.5 pr-4 text-right">
          <Link href={href}><span className="text-[11px] text-t-fg font-mono tabular-nums">{formatVolume(market.total_volume)}</span></Link>
        </td>
        <td className="hidden sm:table-cell py-2.5 pr-4 text-right text-[11px] font-mono tabular-nums">
          <Link href={href}><PriceChangeCell value={market.price_change_1h} /></Link>
        </td>
        <td className="hidden sm:table-cell py-2.5 pr-4 text-right text-[11px] font-mono tabular-nums">
          <Link href={href}><PriceChangeCell value={market.price_change_24h} /></Link>
        </td>
        <td className="hidden sm:table-cell py-2.5 pr-4">
          <CreatorBadge market={market} />
        </td>
        <td className="hidden sm:table-cell py-2.5 pr-4">
          <Link href={href} className="flex justify-center"><StatusDot status={market.market_status} /></Link>
        </td>
      </tr>

      {showTooltip && typeof document !== 'undefined' && createPortal(
        <div
          key={tooltipKey}
          onMouseEnter={onTooltipEnter}
          onMouseLeave={onRowLeave}
          className="fixed z-[9999] animate-tooltip-reveal"
          style={{ top: tooltipPos.top, left: tooltipPos.left, width: TOOLTIP_W }}
        >
          <div className="explore-tooltip-wrap border border-t-fg/[0.08] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.7),0_0_0_1px_rgba(139,92,246,0.06)]">
            <div className="flex relative z-[1]">
              {/* Left Panel */}
              <div className="flex-1 min-w-0 p-4 border-r border-t-fg/[0.04]">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-t-card relative border border-t-fg/[0.08] shadow-[0_0_0_1px_rgba(139,92,246,0.1),0_4px_12px_-4px_rgba(0,0,0,0.5)]">
                    {market.icon_image_url ? (
                      <Image src={market.icon_image_url} alt={market.symbol} fill sizes="40px" className="object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="text-xs font-semibold text-t-fg-muted">{market.symbol.slice(0, 2).toUpperCase()}</span>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-t-fg truncate" style={{ fontFamily: 'var(--font-space-grotesk, sans-serif)' }}>{market.symbol}</span>
                      <span className="text-[10px] text-t-dot font-mono">/USDC</span>
                    </div>
                    <span className="text-[10px] text-t-fg-muted block truncate">{market.name}</span>
                  </div>
                  <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${status.dotColor} ${market.market_status === 'ACTIVE' ? 'explore-status-pulse' : ''}`} />
                    <span className={`text-[10px] ${status.textColor}`}>{status.text}</span>
                  </div>
                </div>

                <p className="text-[11px] text-t-fg-sub leading-relaxed mb-2.5">{truncatedDesc}</p>

                {categories.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    {categories.slice(0, 4).map((cat, i) => (
                      <Link
                        key={i}
                        href={`/explore?category=${encodeURIComponent(cat)}`}
                        className="text-[9px] text-[#555] bg-white/[0.03] border border-white/[0.06] px-1.5 py-0.5 rounded hover:text-[#a78bfa] hover:border-[rgba(139,92,246,0.3)] hover:bg-[rgba(139,92,246,0.06)] transition-all duration-150"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {cat}
                      </Link>
                    ))}
                  </div>
                )}

                {market.creator_wallet_address && (
                  <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-t-fg/[0.04]">
                    <span className="text-[9px] text-t-dot">Created by</span>
                    <Link
                      href={`/user/${market.creator_wallet_address}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 hover:text-[#a78bfa] transition-colors duration-150"
                    >
                      {market.creator_profile_image_url ? (
                        <Image
                          src={market.creator_profile_image_url}
                          alt=""
                          width={14}
                          height={14}
                          className="rounded-full flex-shrink-0"
                        />
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-full flex-shrink-0 bg-t-card border border-t-fg/[0.08] flex items-center justify-center">
                          <span className="text-[6px] font-semibold text-t-fg-muted">
                            {(market.creator_display_name || market.creator_wallet_address).slice(0, 1).toUpperCase()}
                          </span>
                        </div>
                      )}
                      <span className="text-[10px] text-t-fg-sub font-medium">
                        {market.creator_display_name || formatWallet(market.creator_wallet_address)}
                      </span>
                    </Link>
                  </div>
                )}
              </div>

              {/* Right Panel */}
              <div className="w-[240px] flex-shrink-0 p-4 flex flex-col justify-between">
                <div className="mb-3">
                  <span className="text-[10px] text-t-fg-muted uppercase tracking-wider font-medium" style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}>Mark Price</span>
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <span className="text-lg font-semibold text-t-fg tabular-nums" style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}>{formatPrice(market.mark_price, market.decimals)}</span>
                    <span className={`text-[11px] font-mono tabular-nums ${changeColor}`}>{changeStr}</span>
                  </div>
                </div>

                <div className="space-y-0">
                  <div className="flex items-center justify-between py-1 border-b border-t-fg/[0.04]">
                    <span className="text-[10px] text-t-fg-muted">Volume</span>
                    <span className="text-[11px] text-t-fg font-mono tabular-nums">{formatVolume(market.total_volume)}</span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-t-fg/[0.04]">
                    <span className="text-[10px] text-t-fg-muted">Trades</span>
                    <span className="text-[11px] text-t-fg font-mono tabular-nums">{market.total_trades ? market.total_trades.toLocaleString() : '—'}</span>
                  </div>
                  {totalOI > 0 && (
                    <div className="flex items-center justify-between py-1 border-b border-t-fg/[0.04]">
                      <span className="text-[10px] text-t-fg-muted">Open Interest</span>
                      <span className="text-[11px] font-mono tabular-nums">
                        <span className="text-green-400">{formatOI(market.open_interest_long)}</span>
                        <span className="text-t-dot"> / </span>
                        <span className="text-red-400">{formatOI(market.open_interest_short)}</span>
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between py-1">
                    <span className="text-[10px] text-t-fg-muted">Settlement</span>
                    <span className="text-[11px] text-t-fg font-mono tabular-nums">{formatDateShort(market.settlement_date)}</span>
                  </div>
                </div>

                <div className="mt-2.5 pt-2 border-t border-t-fg/[0.04]">
                  <span className="text-[9px] text-t-dot">Click row to view full market</span>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
