'use client';

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProgressOverlay } from '@/components/create-market/ProgressOverlay';

type DeploymentOverlayDisplayMode = 'overlay' | 'dock' | 'footer';

type DeploymentOverlayState = {
  isVisible: boolean;
  isFadingOut: boolean;
  splashVisible: boolean;
  displayMode: DeploymentOverlayDisplayMode;
  title: string;
  subtitle: string;
  messages: string[];
  activeIndex: number;
  percentComplete: number;
  /** Only show "Continue in background" after user has signed the market creation transaction. */
  transactionSigned: boolean;
  meta: {
    pipelineId: string | null;
    marketSymbol: string | null;
  };
};

type OpenOptions = {
  title?: string;
  subtitle?: string;
  messages: string[];
  splashMs?: number;
  meta?: Partial<DeploymentOverlayState['meta']>;
};

type UpdateOptions = Partial<Pick<DeploymentOverlayState, 'activeIndex' | 'percentComplete' | 'title' | 'subtitle' | 'messages' | 'transactionSigned'>>;

type DeploymentOverlayContextValue = {
  state: DeploymentOverlayState;
  open: (opts: OpenOptions) => void;
  update: (opts: UpdateOptions) => void;
  minimize: () => void;
  collapseToFooter: () => void;
  restore: () => void;
  fadeOutAndClose: (delayMs?: number) => void;
  close: () => void;
};

const DeploymentOverlayContext = createContext<DeploymentOverlayContextValue | null>(null);

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function DeploymentDock(props: {
  title: string;
  subtitle: string;
  messages: string[];
  activeIndex: number;
  percentComplete: number;
  marketSymbol: string | null;
  pipelineId: string | null;
  onRestore: () => void;
  onCollapseToFooter: () => void;
}) {
  const { title, subtitle, messages, activeIndex, percentComplete, marketSymbol, pipelineId, onRestore, onCollapseToFooter } = props;
  const router = useRouter();
  const idx = clamp(activeIndex, 0, Math.max(messages.length - 1, 0));
  const msg = messages[idx] || 'Working…';
  const pct = clamp(percentComplete, 0, 100);
  // Keep the dock above the fixed footer (Footer is 48px tall).
  const dockBottom = 'calc(48px + 16px + env(safe-area-inset-bottom, 0px))';

  const openMarket = useCallback(() => {
    if (!marketSymbol) return;
    // Open the token page in "deploying" mode while this dock is visible.
    // This prevents "Market Not Found" / "inactive" UX while the DB row is still being created.
    const qs = new URLSearchParams();
    qs.set('deploying', '1');
    if (pipelineId) qs.set('pipelineId', String(pipelineId));
    router.push(`/token/${encodeURIComponent(marketSymbol)}?${qs.toString()}`);
  }, [marketSymbol, pipelineId, router]);

  return (
    <div
      className="fixed left-4 right-4 sm:left-auto sm:right-4 z-50 w-auto sm:w-[360px] rounded-lg border border-[#222222] bg-[#0F0F0F] shadow-lg"
      style={{ bottom: dockBottom }}
    >
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] sm:text-xs font-medium text-[#9CA3AF] uppercase tracking-wide truncate leading-tight">{title}</div>
          <div className="text-[10px] sm:text-[11px] text-[#606060] truncate">{subtitle}</div>
          <div className="mt-2 text-xs sm:text-sm text-white truncate leading-snug" title={msg}>
            {msg}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {/* Further-reduce control (dock -> footer pip), top-right corner */}
          <button
            onClick={onCollapseToFooter}
            className="h-6 w-6 rounded border border-[#222222] bg-[#111111] text-[#9CA3AF] hover:text-white hover:border-[#333333] transition-all duration-200 flex items-center justify-center"
            title="Reduce to footer"
            aria-label="Reduce to footer"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            onClick={onRestore}
            className="text-[11px] sm:text-xs text-white bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded px-2.5 py-1.5 transition-all duration-200"
          >
            View
          </button>
          {marketSymbol ? (
            <button
              onClick={openMarket}
              className="text-[11px] sm:text-xs text-[#8a8a8a] hover:text-white bg-transparent border border-[#222222] hover:border-[#333333] rounded px-2.5 py-1.5 transition-all duration-200"
            >
              Open market
            </button>
          ) : null}
        </div>
      </div>
      <div className="h-px bg-[#1A1A1A]" />
      <div className="p-3">
        <div className="flex items-center justify-between text-[11px] sm:text-xs text-[#808080]">
          <span>Progress</span>
          <span className="font-mono text-[#9CA3AF]">{pct}%</span>
        </div>
        <div className="mt-2 w-full h-1 bg-[#1A1A1A] rounded-full overflow-hidden">
          <div className="h-full bg-blue-400 transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

function DeploymentCompleteNotice(props: { marketSymbol: string; onDismiss: () => void }) {
  const { marketSymbol, onDismiss } = props;
  const router = useRouter();
  return (
    <div className="fixed top-16 left-4 right-4 sm:left-auto sm:right-4 z-50 w-auto sm:w-[380px] rounded-lg border border-[#222222] bg-[#0F0F0F] shadow-lg">
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] sm:text-xs font-medium text-green-400 uppercase tracking-wide">Deployment complete</div>
            <div className="mt-1 text-xs sm:text-sm text-white truncate leading-snug">
              {marketSymbol} is ready.
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="text-[11px] sm:text-xs text-[#606060] hover:text-white border border-[#222222] hover:border-[#333333] rounded px-2.5 py-1.5 transition-all duration-200"
          >
            Dismiss
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => router.push(`/token/${encodeURIComponent(marketSymbol)}`)}
            className="text-[11px] sm:text-xs text-black bg-green-400 hover:bg-green-300 rounded px-3 py-2 transition-all duration-200"
          >
            Open market
          </button>
          <button
            onClick={() => {
              try {
                navigator.clipboard?.writeText(marketSymbol);
              } catch {}
            }}
            className="text-[11px] sm:text-xs text-white bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded px-3 py-2 transition-all duration-200"
            title="Copy symbol"
          >
            Copy symbol
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeploymentOverlayProvider({ children }: { children: React.ReactNode }) {
  const splashTimerRef = useRef<number | null>(null);
  const persistPendingPipeline = useCallback((meta: { pipelineId: string | null; marketSymbol: string | null }) => {
    try {
      if (typeof window === 'undefined') return;
      const symbol = meta.marketSymbol ? String(meta.marketSymbol).toUpperCase().trim() : '';
      if (!symbol) return;
      const storageKey = `dexextra:deployment:pending:${symbol}`;
      const payload = {
        symbol,
        pipelineId: meta.pipelineId ? String(meta.pipelineId) : null,
        updatedAt: Date.now(),
      };
      window.localStorage?.setItem(storageKey, JSON.stringify(payload));
    } catch {}
  }, []);

  const clearPendingPipeline = useCallback((symbol: string | null) => {
    try {
      if (typeof window === 'undefined') return;
      const s = symbol ? String(symbol).toUpperCase().trim() : '';
      if (!s) return;
      const storageKey = `dexextra:deployment:pending:${s}`;
      window.localStorage?.removeItem(storageKey);
    } catch {}
  }, []);

  const [overlay, setOverlay] = useState<DeploymentOverlayState>({
    isVisible: false,
    isFadingOut: false,
    splashVisible: false,
    displayMode: 'overlay',
    title: 'Deployment Pipeline',
    subtitle: 'Initializing market and registering oracle',
    messages: [],
    activeIndex: 0,
    percentComplete: 0,
    transactionSigned: false,
    meta: { pipelineId: null, marketSymbol: null },
  });
  const [completedSymbol, setCompletedSymbol] = useState<string | null>(null);
  const completedTimerRef = useRef<number | null>(null);

  const open = useCallback((opts: OpenOptions) => {
    if (splashTimerRef.current) {
      window.clearTimeout(splashTimerRef.current);
      splashTimerRef.current = null;
    }
    setOverlay({
      isVisible: true,
      isFadingOut: false,
      splashVisible: Boolean(opts.splashMs && opts.splashMs > 0),
      displayMode: 'overlay',
      title: opts.title || 'Deployment Pipeline',
      subtitle: opts.subtitle || 'Initializing market and registering oracle',
      messages: opts.messages,
      activeIndex: 0,
      percentComplete: 0,
      transactionSigned: false,
      meta: {
        pipelineId: (opts.meta?.pipelineId ? String(opts.meta.pipelineId) : null),
        marketSymbol: (opts.meta?.marketSymbol ? String(opts.meta.marketSymbol).toUpperCase() : null),
      },
    });
    if (opts.splashMs && opts.splashMs > 0) {
      splashTimerRef.current = window.setTimeout(() => {
        setOverlay(prev => ({ ...prev, splashVisible: false }));
        splashTimerRef.current = null;
      }, opts.splashMs);
    }
  }, []);

  const update = useCallback((opts: UpdateOptions) => {
    setOverlay(prev => ({
      ...prev,
      ...opts,
      activeIndex: typeof opts.activeIndex === 'number' ? Math.max(0, opts.activeIndex) : prev.activeIndex,
      percentComplete: typeof opts.percentComplete === 'number'
        ? Math.max(0, Math.min(100, opts.percentComplete))
        : prev.percentComplete,
      messages: Array.isArray(opts.messages) ? opts.messages : prev.messages,
      title: typeof opts.title === 'string' ? opts.title : prev.title,
      subtitle: typeof opts.subtitle === 'string' ? opts.subtitle : prev.subtitle,
      transactionSigned: typeof opts.transactionSigned === 'boolean' ? opts.transactionSigned : prev.transactionSigned,
    }));
  }, []);

  const minimize = useCallback(() => {
    setOverlay(prev => {
      if (!prev.isVisible) return prev;
      try { persistPendingPipeline(prev.meta); } catch {}
      return { ...prev, displayMode: 'dock' };
    });
  }, [persistPendingPipeline]);

  const collapseToFooter = useCallback(() => {
    setOverlay(prev => {
      if (!prev.isVisible) return prev;
      try { persistPendingPipeline(prev.meta); } catch {}
      return { ...prev, displayMode: 'footer' };
    });
  }, [persistPendingPipeline]);

  const restore = useCallback(() => {
    setOverlay(prev => (prev.isVisible ? { ...prev, displayMode: 'overlay' } : prev));
  }, []);

  const triggerCompletedNotice = useCallback((symbol: string | null) => {
    const s = symbol ? String(symbol).toUpperCase().trim() : '';
    if (!s) return;
    setCompletedSymbol(s);
    if (completedTimerRef.current) window.clearTimeout(completedTimerRef.current);
    completedTimerRef.current = window.setTimeout(() => {
      setCompletedSymbol(null);
      completedTimerRef.current = null;
    }, 15_000);
  }, []);

  const fadeOutAndClose = useCallback((delayMs: number = 450) => {
    if (splashTimerRef.current) {
      window.clearTimeout(splashTimerRef.current);
      splashTimerRef.current = null;
    }
    // If we have a market symbol, show a small completion notice even if the overlay was minimized.
    try {
      triggerCompletedNotice(overlay.meta.marketSymbol);
    } catch {}
    // Clear any pending "building" hint once the pipeline finishes.
    try {
      clearPendingPipeline(overlay.meta.marketSymbol);
    } catch {}
    setOverlay(prev => ({ ...prev, isFadingOut: true }));
    window.setTimeout(() => {
    setOverlay(prev => ({
      ...prev,
      isFadingOut: false,
      isVisible: false,
      splashVisible: false,
      displayMode: 'overlay',
      messages: [],
      activeIndex: 0,
      percentComplete: 0,
      transactionSigned: false,
      meta: { pipelineId: null, marketSymbol: null },
    }));
  }, delayMs);
  }, [overlay.meta.marketSymbol, triggerCompletedNotice, clearPendingPipeline]);

  const close = useCallback(() => {
    if (splashTimerRef.current) {
      window.clearTimeout(splashTimerRef.current);
      splashTimerRef.current = null;
    }
    setOverlay(prev => ({
      ...prev,
      isVisible: false,
      isFadingOut: false,
      splashVisible: false,
      displayMode: 'overlay',
      messages: [],
      activeIndex: 0,
      percentComplete: 0,
      transactionSigned: false,
      meta: { pipelineId: null, marketSymbol: null },
    }));
  }, []);

  const value = useMemo<DeploymentOverlayContextValue>(() => ({
    state: overlay,
    open,
    update,
    minimize,
    collapseToFooter,
    restore,
    fadeOutAndClose,
    close,
  }), [overlay, open, update, minimize, collapseToFooter, restore, fadeOutAndClose, close]);

  return (
    <DeploymentOverlayContext.Provider value={value}>
      {children}
      {completedSymbol ? (
        <DeploymentCompleteNotice
          marketSymbol={completedSymbol}
          onDismiss={() => setCompletedSymbol(null)}
        />
      ) : null}
      {overlay.isVisible && overlay.displayMode === 'dock' ? (
        <DeploymentDock
          title={overlay.title}
          subtitle={overlay.subtitle}
          messages={overlay.messages}
          activeIndex={overlay.activeIndex}
          percentComplete={overlay.percentComplete}
          marketSymbol={overlay.meta.marketSymbol}
          pipelineId={overlay.meta.pipelineId}
          onRestore={restore}
          onCollapseToFooter={collapseToFooter}
        />
      ) : null}
      <ProgressOverlay
        visible={overlay.isVisible && overlay.displayMode === 'overlay'}
        isFadingOut={overlay.isFadingOut}
        showSplash={overlay.splashVisible}
        messages={overlay.messages}
        activeIndex={overlay.activeIndex}
        percentComplete={overlay.percentComplete}
        title={overlay.title}
        subtitle={overlay.subtitle}
        onMinimize={overlay.transactionSigned ? minimize : undefined}
      />
    </DeploymentOverlayContext.Provider>
  );
}

export function useDeploymentOverlay(): DeploymentOverlayContextValue {
  const ctx = useContext(DeploymentOverlayContext);
  if (!ctx) {
    throw new Error('useDeploymentOverlay must be used within a DeploymentOverlayProvider');
  }
  return ctx;
}


