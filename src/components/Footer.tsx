import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useETHPrice } from '../hooks/useETHPrice';
import { useActiveMarkets } from '@/contexts/ActiveMarketsContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useWallet } from '@/hooks/useWallet';
import { useMarkets } from '@/hooks/useMarkets';
import { normalizeBytes32Hex } from '@/lib/hex';
import { FooterWatchlistPopup } from './FooterWatchlistPopup';
import { FooterSupportPopup } from './FooterSupportPopup';
import { useDeploymentOverlay } from '@/contexts/DeploymentOverlayContext';
import PortfolioSidebar from './PortfolioV2/PortfolioSidebar';

const INACTIVE_ORDER_STATUSES = new Set(['FILLED', 'CANCELLED', 'CANCELED', 'EXPIRED', 'REJECTED']);
const ORDERBOOK_PREFIX = 'orderbook:activeOrders:';
const PORTFOLIO_PREFIX = 'portfolio:orders:';

function truncateChipLabel(raw: unknown, maxChars = 7): string {
  const s = String(raw ?? '').trim();
  if (s.length <= maxChars) return s;

  const suffix = '...';
  if (maxChars <= suffix.length) return suffix.slice(0, maxChars);

  const headLen = maxChars - suffix.length;
  const headRaw = s.slice(0, headLen);
  const head = headRaw.replace(/[\s\-_]+$/g, '').trimEnd();
  // If trimming removed everything (e.g. "---"), fall back to raw slice.
  return (head.length ? head : headRaw) + suffix;
}

function isEvmAddress(value: string): boolean {
  const v = String(value || '').trim();
  return /^0x[a-fA-F0-9]{40}$/i.test(v);
}

function isBytes32Hex(value: string): boolean {
  const v = String(value || '').trim();
  return /^0x[a-fA-F0-9]{64}$/i.test(v);
}

function shortAddress(value: string): string {
  const v = String(value || '').trim();
  if (!isEvmAddress(v)) return v;
  return `${v.slice(0, 6)}…${v.slice(-4)}`.toUpperCase();
}

function isActiveOrderStatus(status: unknown): boolean {
  const normalized = String(status || '').trim().toUpperCase();
  if (!normalized) return true;
  return !INACTIVE_ORDER_STATUSES.has(normalized);
}

const Footer: React.FC = () => {
  const pathname = usePathname();
  const { 
    price: ethPrice, 
    changePercent24h, 
    isLoading, 
    error, 
    source, 
    isStale,
    refreshPrice 
  } = useETHPrice();

  const { rankedSymbols } = useActiveMarkets();
  const { theme } = useTheme();
  const { walletData } = useWallet() as any;
  const walletAddress: string | null = walletData?.address || null;
  const deploymentOverlay = useDeploymentOverlay();
  const [sessionOrderSymbols, setSessionOrderSymbols] = useState<string[]>([]);
  const [isWatchlistOpen, setIsWatchlistOpen] = useState(false);
  const watchlistCloseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const supportCloseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isPortfolioSidebarOpen, setIsPortfolioSidebarOpen] = useState(false);

  const deploymentFooterPip = useMemo(() => {
    const s = deploymentOverlay?.state;
    if (!s?.isVisible) return null;
    if (s.displayMode !== 'footer') return null;

    const pct = Math.max(0, Math.min(100, Number.isFinite(s.percentComplete) ? s.percentComplete : 0));
    const messages = Array.isArray(s.messages) ? s.messages : [];
    const idx = Math.max(0, Math.min(Number.isFinite(s.activeIndex) ? s.activeIndex : 0, Math.max(messages.length - 1, 0)));
    const msg = (messages[idx] || s.subtitle || s.title || 'Working…').toString();

    const isRunning = pct < 100;

    return (
      <button
        onClick={() => deploymentOverlay.minimize()}
        title={msg}
        aria-label="Show deployment progress"
        className="group relative inline-flex items-center justify-center rounded border border-[#222222] bg-[#0F0F0F] px-2 py-1 transition-all duration-200 hover:border-[#333333] hover:bg-[#1A1A1A] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/30 cursor-pointer"
      >
        <div className="w-14 h-1 bg-[#2A2A2A] rounded-full overflow-hidden">
          <div
            className={`h-full bg-blue-500 transition-all duration-300 ${isRunning ? 'animate-pulse' : ''}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </button>
    );
  }, [deploymentOverlay]);

  const handleWatchlistMouseEnter = useCallback(() => {
    // Clear any pending close timeout
    if (watchlistCloseTimeoutRef.current) {
      clearTimeout(watchlistCloseTimeoutRef.current);
      watchlistCloseTimeoutRef.current = null;
    }
    setIsWatchlistOpen(true);
  }, []);

  const handleWatchlistMouseLeave = useCallback(() => {
    // Delay closing to give user time to move to popup
    watchlistCloseTimeoutRef.current = setTimeout(() => {
      setIsWatchlistOpen(false);
    }, 200); // 200ms delay before closing
  }, []);

  const handleSupportMouseEnter = useCallback(() => {
    if (supportCloseTimeoutRef.current) {
      clearTimeout(supportCloseTimeoutRef.current);
      supportCloseTimeoutRef.current = null;
    }
    setIsSupportOpen(true);
  }, []);

  const handleSupportMouseLeave = useCallback(() => {
    supportCloseTimeoutRef.current = setTimeout(() => {
      setIsSupportOpen(false);
    }, 200);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (watchlistCloseTimeoutRef.current) {
        clearTimeout(watchlistCloseTimeoutRef.current);
      }
      if (supportCloseTimeoutRef.current) {
        clearTimeout(supportCloseTimeoutRef.current);
      }
    };
  }, []);
  const { markets } = useMarkets({ limit: 500, autoRefresh: true, refreshInterval: 60000 });

  const symbolByMarketAddress = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of markets || []) {
      const addr = String((m as any)?.market_address || '').trim().toLowerCase();
      if (!addr || !isEvmAddress(addr)) continue;
      const sym = String((m as any)?.symbol || '').trim().toUpperCase();
      if (!sym) continue;
      map.set(addr, sym);
    }
    return map;
  }, [markets]);

  const symbolByMarketIdBytes32 = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of markets || []) {
      const key = normalizeBytes32Hex(String((m as any)?.market_id_bytes32 || ''));
      if (!key) continue;
      const sym = String((m as any)?.symbol || '').trim().toUpperCase();
      if (!sym) continue;
      map.set(key, sym);
    }
    return map;
  }, [markets]);

  const normalizeActiveMarketCandidate = useCallback((raw: unknown): { hrefId: string; key: string; label: string } | null => {
    const v = String(raw || '').trim();
    if (!v) return null;

    // If we received a market address, prefer resolving to the canonical symbol.
    if (isEvmAddress(v)) {
      const sym = symbolByMarketAddress.get(v.toLowerCase());
      if (sym) return { hrefId: sym, key: sym, label: sym };
      // Unknown address: keep href usable, but display a short label.
      return { hrefId: v, key: v.toUpperCase(), label: shortAddress(v) };
    }

    // If we received a bytes32 market id, resolve to symbol when possible.
    if (isBytes32Hex(v)) {
      const key = normalizeBytes32Hex(v);
      const sym = key ? symbolByMarketIdBytes32.get(key) : null;
      if (!sym) return null;
      // bytes32 itself isn't a stable route; prefer symbol.
      return { hrefId: sym, key: sym, label: sym };
    }

    // Otherwise treat as a symbol-like identifier.
    const sym = v.toUpperCase();
    return { hrefId: sym, key: sym, label: sym };
  }, [symbolByMarketAddress, symbolByMarketIdBytes32]);

  const hydrateSessionOrderSymbols = useCallback(() => {
    if (typeof window === 'undefined' || !walletAddress) {
      setSessionOrderSymbols([]);
      return;
    }

    try {
      const lowerWallet = walletAddress.toLowerCase();
      const dedup = new Set<string>();
      const next: string[] = [];

      const pushSymbol = (value: unknown) => {
        const symbol = String(value || '').toUpperCase();
        if (!symbol || dedup.has(symbol)) return;
        dedup.add(symbol);
        next.push(symbol);
      };

      for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i);
        if (!key) continue;

        const isPortfolioKey = key.startsWith(PORTFOLIO_PREFIX);
        const isOrderbookKey = key.startsWith(ORDERBOOK_PREFIX);
        if (!isPortfolioKey && !isOrderbookKey) continue;

        const raw = window.sessionStorage.getItem(key);
        if (!raw) continue;

        let payload: any;
        try {
          payload = JSON.parse(raw);
        } catch {
          continue;
        }

        const payloadWallet = String(payload?.walletAddress || '').toLowerCase();
        if (!payloadWallet || payloadWallet !== lowerWallet) continue;

        if (isPortfolioKey) {
          const version = Number((payload as any)?.version || 0);
          if (version && version !== 1) continue;
          const buckets = Array.isArray(payload?.buckets) ? payload.buckets : [];
          for (const bucket of buckets) {
            const orders = Array.isArray(bucket?.orders) ? bucket.orders : [];
            if (!orders.length) continue;
            pushSymbol(
              bucket?.symbol ||
                bucket?.token ||
                bucket?.metricId ||
                bucket?.marketId
            );
          }
          continue;
        }

        if (isOrderbookKey) {
          const version = Number((payload as any)?.version || 0);
          if (version && version !== 1) continue;
          const orders = Array.isArray(payload?.orders) ? payload.orders : [];
          const hasActive = orders.some((o) => isActiveOrderStatus((o as any)?.status));
          if (!hasActive) continue;
          pushSymbol(payload?.marketId || payload?.symbol);
        }
      }

      setSessionOrderSymbols(next);
    } catch {
      setSessionOrderSymbols([]);
    }
  }, [walletAddress]);

  useEffect(() => {
    hydrateSessionOrderSymbols();
  }, [hydrateSessionOrderSymbols]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler: EventListener = () => {
      hydrateSessionOrderSymbols();
    };
    window.addEventListener('ordersUpdated', handler);
    return () => {
      window.removeEventListener('ordersUpdated', handler);
    };
  }, [hydrateSessionOrderSymbols]);

  const currentTokenSymbol = useMemo(() => {
    const path = String(pathname || '');
    const match = path.match(/^\/token\/([^/?#]+)/i);
    if (!match) return null;
    const raw = match[1] || '';
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }, [pathname]);

  // Normalize current route market id to a stable symbol (prevents address->symbol flicker).
  const currentTokenKey = useMemo(() => {
    if (!currentTokenSymbol) return null;
    const normalized = normalizeActiveMarketCandidate(currentTokenSymbol);
    return normalized?.key ? String(normalized.key).toUpperCase() : String(currentTokenSymbol || '').toUpperCase();
  }, [currentTokenSymbol, normalizeActiveMarketCandidate]);

  const combinedActiveMarkets = useMemo(() => {
    const ordered: Array<{ hrefId: string; key: string; label: string }> = [];
    const seen = new Set<string>();
    const push = (value: unknown) => {
      const normalized = normalizeActiveMarketCandidate(value);
      if (!normalized) return;
      const k = String(normalized.key || '').toUpperCase();
      if (!k || seen.has(k)) return;
      seen.add(k);
      ordered.push({ ...normalized, key: k });
    };

    (rankedSymbols || []).forEach(push);
    sessionOrderSymbols.forEach(push);
    return ordered;
  }, [rankedSymbols, sessionOrderSymbols, normalizeActiveMarketCandidate]);

  const activeMarketLinks = useMemo(() => {
    const filtered = combinedActiveMarkets.filter((m) => {
      if (!m?.key) return false;
      if (!currentTokenKey) return true;
      return String(m.key).toUpperCase() !== String(currentTokenKey).toUpperCase();
    });

    const marketsForLinks =
      filtered.length > 0 ? filtered.slice(0, 3) : combinedActiveMarkets.slice(0, 3);

    return marketsForLinks.map((m) => ({
      label: m.label,
      href: `/token/${encodeURIComponent(m.hrefId)}`,
      title: 'Your active market',
    }));
  }, [combinedActiveMarkets, currentTokenKey]);

  const secondaryNavLinks = useMemo(() => ([
    { label: 'Portfolio', onClick: () => setIsPortfolioSidebarOpen(true), title: 'View portfolio' },
  ]), []);

  // Only show "Active Markets" shortcuts when a wallet is connected and we can infer user activity.
  const showActiveMarketShortcuts = Boolean(walletAddress) && combinedActiveMarkets.length > 0;
  // When disconnected or when there's no activity, Quick Links should only show Portfolio.
  const footerNavLinks = showActiveMarketShortcuts ? activeMarketLinks : secondaryNavLinks;
  
  // Create tooltip text for ETH price
  const getETHPriceTooltip = () => {
    if (error && isStale) {
      return `Using ${source || 'cached'} data due to API issues. Last updated: ${new Date().toLocaleTimeString()}`;
    }
    if (isStale) {
      return `Data may be stale. Source: ${source || 'Unknown'}`;
    }
    if (source) {
      return `Live data from ${source}`;
    }
    return 'Live ETH price';
  };

  return (
    <footer 
      className="fixed bottom-0 right-0 z-40 flex items-center justify-between transition-all duration-300 ease-in-out"
      style={{
        height: '48px',
        background: `
          radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0),
          radial-gradient(circle at 3px 3px, rgba(255,255,255,0.1) 1px, transparent 0),
          #000000
        `,
        backgroundSize: '4px 4px, 8px 8px',
        backgroundPosition: '0 0, 0 0',
        padding: '0 16px',
        borderTop: '1px solid #333333',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        left: '60px', // Fixed position for collapsed navbar only
        width: 'calc(100vw - 60px)' // Fixed width for collapsed navbar only
      }}
    >
      {/* Left Section - Status Indicators and Navigation */}
      <div 
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
        }}
      >
        {/* Live Status Indicator */}
        <div 
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 8px',
            fontSize: '12px',
            fontWeight: '500',
            color: '#00FF88',
          }}
        >
          <div 
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#00FF88',
            }}
          />
          Live
        </div>

        {/* How it works */}
        <Link
          href="https://doc.dexetera.win/docs/how-it-works"
          target="_blank"
          rel="noopener noreferrer"
          title="How it works: markets are created on-chain, users place orders on the OrderBook, and positions/settlement are handled by smart contracts."
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 8px',
            fontSize: '12px',
            fontWeight: '400',
            color: '#FFFFFF',
            textDecoration: 'none',
            cursor: 'pointer',
            transition: 'color 0.2s ease, opacity 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#CCCCCC';
            e.currentTarget.style.opacity = '0.95';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#FFFFFF';
            e.currentTarget.style.opacity = '1';
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="-1 -1 26 26"
            fill="currentColor"
            aria-hidden="true"
            style={{ display: 'block', flexShrink: 0 }}
          >
            <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-20C8.69 1 6 3.69 6 7c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-4.26c1.81-1.27 3-3.36 3-5.74 0-3.31-2.69-6-6-6zm2.71 10.29L14 11.74V16h-4v-4.26l-.71-.45A4.992 4.992 0 0 1 8 7c0-2.21 1.79-4 4-4s4 1.79 4 4c0 1.64-.8 3.16-2.29 4.29z"/>
          </svg>
          How it works
        </Link>

        {/* Watchlist */}
        <div 
          style={{
            position: 'relative',
          }}
          onMouseEnter={handleWatchlistMouseEnter}
          onMouseLeave={handleWatchlistMouseLeave}
        >
          <button 
            onClick={() => setIsWatchlistOpen(!isWatchlistOpen)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 8px',
              fontSize: '12px',
              fontWeight: '400',
              color: isWatchlistOpen ? '#CCCCCC' : '#FFFFFF',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              transition: 'color 0.2s ease',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            Watchlist
          </button>
          <FooterWatchlistPopup 
            isOpen={isWatchlistOpen} 
            onClose={() => setIsWatchlistOpen(false)} 
          />
        </div>
      </div>

      {/* Center Section - Navigation Links */}
      <div 
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        <Link 
          href="https://dexetera.win/dexetera-tos.html"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            padding: '4px 8px',
            fontSize: '14px',
            fontWeight: '400',
            color: '#FFFFFF',
            textDecoration: 'none',
            cursor: 'pointer',
            transition: 'color 0.2s ease',
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = '#CCCCCC'}
          onMouseLeave={(e) => e.currentTarget.style.color = '#FFFFFF'}
        >
          Terms of Service
        </Link>
        
        <Link 
          href="https://dexetera.win/dexetera-privacy.html"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            padding: '4px 8px',
            fontSize: '14px',
            fontWeight: '400',
            color: '#FFFFFF',
            textDecoration: 'none',
            cursor: 'pointer',
            transition: 'color 0.2s ease',
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = '#CCCCCC'}
          onMouseLeave={(e) => e.currentTarget.style.color = '#FFFFFF'}
        >
          Privacy Policy
        </Link>

        {/* Social Icons */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            style={{
              width: '20px',
              height: '20px',
              padding: '2px',
              cursor: 'pointer',
              color: '#FFFFFF',
              background: 'none',
              border: 'none',
              transition: 'opacity 0.2s ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
          </button>
          
          <button 
            style={{
              width: '20px',
              height: '20px',
              padding: '2px',
              cursor: 'pointer',
              color: '#FFFFFF',
              background: 'none',
              border: 'none',
              transition: 'opacity 0.2s ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.445.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Right Section - User Info and Controls */}
      <div 
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          minWidth: 0, // allow children (like Active Markets) to shrink/ellipsis
        }}
      >
        {/* Deployment progress pip (when reduced to footer) */}
        {deploymentFooterPip ? (
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {deploymentFooterPip}
          </div>
        ) : null}

        {/* ETH Price Display */}
        <div 
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '14px',
            fontWeight: '500',
            color: '#FFFFFF',
            position: 'relative',
          }}
          title={getETHPriceTooltip()}
        >
          <span >
            
          <img
            src="https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos//ethereum-eth-logo-diamond.svg"
            alt="ETH"
            width={13}
            height={13}
            style={{ display: 'inline-block', verticalAlign: 'middle' }}
          />
            
            </span>
          {isLoading ? (
            <span style={{ color: '#CCCCCC' }}>Loading...</span>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>${ethPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span 
                style={{ 
                  color: changePercent24h >= 0 ? '#10B981' : '#EF4444',
                  fontSize: '12px',
                  fontWeight: '400'
                }}
              >
                {changePercent24h >= 0 ? '↗' : '↘'} {Math.abs(changePercent24h).toFixed(2)}%
              </span>
              
              {/* Status indicators */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                {isStale && (
                  <span 
                    style={{ 
                      color: '#FFB800', 
                      fontSize: '10px',
                      cursor: 'help'
                    }}
                    title="Data may be stale"
                  >
                    ⚠
                  </span>
                )}
                {error && (
                  <button
                    onClick={refreshPrice}
                    style={{ 
                      color: '#EF4444', 
                      fontSize: '10px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '0'
                    }}
                    title="Click to retry fetching price"
                  >
                    ↻
                  </button>
                )}
                {source && (
                  <span 
                    style={{ 
                      color: '#CCCCCC', 
                      fontSize: '8px',
                      opacity: 0.7
                    }}
                    title={`Data from ${source}`}
                  >
                    {source === 'Static Fallback' ? 'FB' : 
                     source === 'CoinGecko' ? 'CG' :
                     source === 'Binance' ? 'BN' :
                     source === 'Kraken' ? 'KR' :
                     source === 'CoinMarketCap' ? 'CMC' :
                     source === 'CryptoCompare' ? 'CC' : 
                     source.substring(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Support */}
        <div
          style={{ position: 'relative' }}
          onMouseEnter={handleSupportMouseEnter}
          onMouseLeave={handleSupportMouseLeave}
        >
          <button
            onClick={() => setIsSupportOpen(!isSupportOpen)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 8px',
              fontSize: '14px',
              fontWeight: '400',
              color: isSupportOpen ? '#CCCCCC' : '#FFFFFF',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              transition: 'color 0.2s ease',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
            </svg>
            Support
          </button>
          <FooterSupportPopup
            isOpen={isSupportOpen}
            onClose={() => setIsSupportOpen(false)}
          />
        </div>

        {/* Theme Toggle */}
        <button 
          disabled
          aria-disabled="true"
          aria-label={`Theme locked to ${theme}`}
          title="Theme switching is disabled"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 8px',
            fontSize: '14px',
            fontWeight: '400',
            color: '#FFFFFF',
            background: 'none',
            border: 'none',
            cursor: 'not-allowed',
            transition: 'opacity 0.2s ease',
            opacity: 0.5,
          }}
        >
          {theme === 'light' ? (
            // Sun icon (light theme indicator)
            <svg
              width="16"
              height="16"
              viewBox="-1 -1 26 26"
              fill="currentColor"
              aria-hidden="true"
              style={{ display: 'block', flexShrink: 0 }}
            >
              <path d="M6.76 4.84l-1.8-1.79L3.55 4.46l1.79 1.8 1.42-1.42zM1 13h3v-2H1v2zm10 10h2v-3h-2v3zm9-10v-2h-3v2h3zm-2.55-8.54l-1.41-1.41-1.8 1.79 1.42 1.42 1.79-1.8zM17.24 19.16l1.8 1.79 1.41-1.41-1.79-1.8-1.42 1.42zM4.84 17.24l-1.79 1.8 1.41 1.41 1.8-1.79-1.42-1.42zM12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/>
            </svg>
          ) : (
            // Moon icon (dark theme indicator)
            <svg
              width="16"
              height="16"
              viewBox="-1 -1 26 26"
              fill="currentColor"
              aria-hidden="true"
              style={{ display: 'block', flexShrink: 0 }}
            >
              <path d="M12.76 2.05a.75.75 0 0 0-.82.3.75.75 0 0 0-.03.88A8.5 8.5 0 0 0 20.77 12a.75.75 0 0 0 1.18.61.75.75 0 0 0 .3-.82A9.75 9.75 0 0 1 12.76 2.05zM3.25 12c0-3.77 2.55-6.93 6.04-7.87a11.25 11.25 0 0 0 10.58 14.58A8.75 8.75 0 0 1 3.25 12z"/>
            </svg>
          )}
        </button>

        {/* Active Markets (positions first, then orders) */}
        <div 
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '12px',
            fontWeight: '500',
            color: '#FFFFFF',
            // Footer is fixed-height; never wrap to a second line.
            flexWrap: 'nowrap',
            minWidth: 0,
            maxWidth: 'min(42vw, 520px)',
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              color: '#9CA3AF',
              fontSize: '11px',
              fontWeight: '500',
              letterSpacing: '0.2px',
              marginRight: '2px',
              whiteSpace: 'nowrap',
              flex: '0 0 auto',
            }}
          >
            {showActiveMarketShortcuts ? 'Active Markets:' : 'Quick Links:'}
          </span>
          <div
            className="scrollbar-none"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flex: '1 1 auto',
              minWidth: 0,
              overflowX: 'auto',
              overflowY: 'hidden',
            }}
            aria-label={showActiveMarketShortcuts ? 'Active markets' : 'Quick links'}
          >
            {footerNavLinks.map((l: any) => {
              const isActiveMarket = showActiveMarketShortcuts;
              const baseBorder = isActiveMarket ? '#333333' : '#2A2A2A';
              const hoverBorder = isActiveMarket ? '#444444' : '#3A3A3A';
              const keyPrefix = isActiveMarket ? 'active' : 'nav';
              const fullLabel = String(l.label ?? '');
              // Only truncate active market labels, not static nav links
              const chipLabel = isActiveMarket ? truncateChipLabel(fullLabel, 7) : fullLabel;
              const chipStyles: React.CSSProperties = {
                padding: '2px 6px',
                border: `1px solid ${baseBorder}`,
                borderRadius: '4px',
                color: '#FFFFFF',
                textDecoration: 'none',
                cursor: 'pointer',
                transition: 'opacity 0.2s ease, border-color 0.2s ease',
                display: 'inline-block',
                flex: '0 0 auto',
                maxWidth: 'min(38vw, 240px)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                verticalAlign: 'middle',
                background: 'none',
                fontSize: 'inherit',
                fontFamily: 'inherit',
              };
              const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
                e.currentTarget.style.opacity = '0.9';
                e.currentTarget.style.borderColor = hoverBorder;
              };
              const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
                e.currentTarget.style.opacity = '1';
                e.currentTarget.style.borderColor = baseBorder;
              };

              // If the item has onClick (e.g., Portfolio), render as a button
              if (l.onClick) {
                return (
                  <button
                    key={`${keyPrefix}-${fullLabel}`}
                    type="button"
                    title={l.title || fullLabel}
                    style={chipStyles}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                    onClick={l.onClick}
                  >
                    {chipLabel}
                  </button>
                );
              }

              // Otherwise render as a Link (for active markets)
              return (
                <Link
                  key={`${keyPrefix}-${l.href}`}
                  href={l.href}
                  title={fullLabel}
                  style={chipStyles}
                  onMouseEnter={handleMouseEnter}
                  onMouseLeave={handleMouseLeave}
                >
                  {chipLabel}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Volume Control */}
        <button 
          style={{
            width: '20px',
            height: '20px',
            padding: '2px',
            cursor: 'pointer',
            color: '#FFFFFF',
            background: 'none',
            border: 'none',
            transition: 'opacity 0.2s ease',
          }}
          onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
          onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
          </svg>
        </button>
      </div>

      {/* Portfolio Sidebar */}
      <PortfolioSidebar
        isOpen={isPortfolioSidebarOpen}
        onClose={() => setIsPortfolioSidebarOpen(false)}
      />
    </footer>
  );
};

export default Footer; 