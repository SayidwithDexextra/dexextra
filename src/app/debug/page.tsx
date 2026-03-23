'use client';
import React from 'react';
import { MarketInfoHeader } from '@/components/MarketInfoHeader';
import { CommentSection, type Comment } from '@/components/CommentSection';

type IconSearchResponse = {
  results: Array<{
    title: string;
    url: string;
    thumbnail: string;
    source: string;
    domain: string;
  }>;
  debug?: {
    kind?: string;
    intent?: string;
    primaryQuery?: string;
    usedQuery?: string;
    usedEngine?: string;
    usedQueryLabel?: string;
    resultCount?: number;
    primaryResultCount?: number;
    fallbackAttempted?: boolean;
    fallbackQuery?: string | null;
    fallbackResultCount?: number;
    backupAttempted?: boolean;
    backupQuery?: string | null;
    backupResultCount?: number;
  };
  error?: string;
};

type MetricDiscoveryResponse = {
  measurable: boolean;
  metric_definition: unknown | null;
  search_query: string | null;
  sources: unknown | null;
  rejection_reason: string | null;
  search_results: unknown[];
  processing_time_ms?: number;
};

function prettyJson(x: unknown) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

function getErrorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  try {
    return typeof e === 'string' ? e : JSON.stringify(e);
  } catch {
    return String(e);
  }
}

const MOCK_COMMENTS: Comment[] = [
  {
    id: '1',
    author: {
      id: 'user1',
      name: 'Toufik Hasan Khan',
    },
    text: 'When it comes to trading this token, choosing the right entry point is crucial. Which support level can enhance your position, making the user experience more enjoyable and engaging?',
    timestamp: new Date(Date.now() - 53 * 60 * 1000).toISOString(),
    likes: 25,
    isLiked: false,
    replies: [
      {
        id: '1-1',
        author: {
          id: 'user2',
          name: 'Abu Sayed',
          badge: 'verified',
        },
        text: 'Absolutely! Selecting the right entry point is key in trading. Levels like $1.20, $1.15, and $1.10 are excellent choices as they are designed for strong support. They help create a more enjoyable and engaging trading experience by ensuring that entries are clear and easy to manage.',
        timestamp: new Date(Date.now() - 17 * 60 * 1000).toISOString(),
        likes: 7,
        isLiked: false,
      },
    ],
  },
  {
    id: '2',
    author: {
      id: 'user3',
      name: 'Jubayer Rahman',
    },
    text: 'In trading, selecting the perfect entry point is essential. A well-chosen level can significantly boost screen readability, ultimately enriching the user experience and keeping users engaged.',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    likes: 25,
    isLiked: true,
    isEdited: true,
  },
  {
    id: '3',
    author: {
      id: 'user4',
      name: 'Market Maker',
      badge: 'creator',
    },
    text: 'Just deployed new liquidity to the SPARK/USDC pool. Looking forward to seeing more volume on this pair. The spread is tightening nicely.',
    timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    likes: 42,
    isLiked: true,
  },
  {
    id: '4',
    author: {
      id: 'user5',
      name: 'DeFi Dan',
      badge: 'moderator',
    },
    text: 'Not sure about the recent price action. Volume seems to be declining and we might see a pullback to support levels around $1.20. Anyone else concerned?',
    timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    likes: 7,
    isLiked: false,
    replies: [
      {
        id: '4-1',
        author: {
          id: 'user2',
          name: 'Abu Sayed',
          badge: 'verified',
        },
        text: 'Valid concern, but I think the low volume is temporary. Most holders are staking for yield.',
        timestamp: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
        likes: 12,
        isLiked: false,
      },
    ],
  },
];

function CommentSectionPreview() {
  const [comments, setComments] = React.useState<Comment[]>(MOCK_COMMENTS);
  const [sortBy, setSortBy] = React.useState<'newest' | 'oldest' | 'top'>('newest');

  const currentUser = {
    id: 'current-user',
    name: 'You',
  };

  const handleSubmitComment = (text: string) => {
    const newComment: Comment = {
      id: `new-${Date.now()}`,
      author: currentUser,
      text,
      timestamp: new Date().toISOString(),
      likes: 0,
      isLiked: false,
    };
    setComments([newComment, ...comments]);
  };

  const handleSubmitReply = (commentId: string, text: string) => {
    const newReply: Comment = {
      id: `reply-${Date.now()}`,
      author: currentUser,
      text,
      timestamp: new Date().toISOString(),
      likes: 0,
      isLiked: false,
    };
    setComments(
      comments.map((c) =>
        c.id === commentId
          ? { ...c, replies: [...(c.replies || []), newReply] }
          : c
      )
    );
  };

  const handleLikeComment = (commentId: string) => {
    const toggleLike = (c: Comment): Comment => {
      if (c.id === commentId) {
        return {
          ...c,
          isLiked: !c.isLiked,
          likes: c.isLiked ? c.likes - 1 : c.likes + 1,
        };
      }
      if (c.replies) {
        return { ...c, replies: c.replies.map(toggleLike) };
      }
      return c;
    };
    setComments(comments.map(toggleLike));
  };

  const handleDeleteComment = (commentId: string) => {
    const deleteFromList = (list: Comment[]): Comment[] =>
      list
        .filter((c) => c.id !== commentId)
        .map((c) => (c.replies ? { ...c, replies: deleteFromList(c.replies) } : c));
    setComments(deleteFromList(comments));
  };

  const handleSortChange = (sort: 'newest' | 'oldest' | 'top') => {
    setSortBy(sort);
    const sorted = [...comments];
    switch (sort) {
      case 'newest':
        sorted.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        break;
      case 'oldest':
        sorted.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        break;
      case 'top':
        sorted.sort((a, b) => b.likes - a.likes);
        break;
    }
    setComments(sorted);
  };

  return (
    <CommentSection
      comments={comments}
      totalCount={comments.length}
      currentUser={currentUser}
      sortBy={sortBy}
      onSortChange={handleSortChange}
      onSubmitComment={handleSubmitComment}
      onSubmitReply={handleSubmitReply}
      onLikeComment={handleLikeComment}
      onDeleteComment={handleDeleteComment}
      onReportComment={(id) => alert(`Reported comment: ${id}`)}
      hasMore={false}
    />
  );
}

export default function DebugSearchPage() {
  const debugEnabled =
    process.env.NODE_ENV !== 'production' ||
    String(process.env.NEXT_PUBLIC_ENABLE_DEBUG_PAGES || '').toLowerCase() === 'true';

  // Icon search tester
  const [iconQuery, setIconQuery] = React.useState('bitcoin');
  const [iconDescription, setIconDescription] = React.useState('Current price of Bitcoin in USD');
  const [iconMaxResults, setIconMaxResults] = React.useState(8);
  const [iconDebug, setIconDebug] = React.useState(true);
  const [iconLoading, setIconLoading] = React.useState(false);
  const [iconError, setIconError] = React.useState<string | null>(null);
  const [iconResp, setIconResp] = React.useState<IconSearchResponse | null>(null);

  // Metric discovery tester
  const [mdDescription, setMdDescription] = React.useState(
    'Current price of Bitcoin in USD. Prefer a stable public API endpoint.'
  );
  const [mdMode, setMdMode] = React.useState<'define_only' | 'full'>('full');
  const [mdSearchVariation, setMdSearchVariation] = React.useState(0);
  const [mdExcludeUrls, setMdExcludeUrls] = React.useState('');
  const [mdLoading, setMdLoading] = React.useState(false);
  const [mdError, setMdError] = React.useState<string | null>(null);
  const [mdResp, setMdResp] = React.useState<MetricDiscoveryResponse | null>(null);

  // Step1 -> Step3 simulation (matches Create Market V2 behavior)
  const [simLoading, setSimLoading] = React.useState(false);
  const [simError, setSimError] = React.useState<string | null>(null);
  const [simStep1, setSimStep1] = React.useState<MetricDiscoveryResponse | null>(null);
  const [simStep3, setSimStep3] = React.useState<MetricDiscoveryResponse | null>(null);
  const [simMerged, setSimMerged] = React.useState<MetricDiscoveryResponse | null>(null);

  const runIconSearch = React.useCallback(async () => {
    setIconLoading(true);
    setIconError(null);
    setIconResp(null);
    try {
      const res = await fetch('/api/icon-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: iconQuery,
          description: iconDescription,
          maxResults: iconMaxResults,
          debug: iconDebug,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as IconSearchResponse;
      if (!res.ok) throw new Error(json?.error || `icon-search failed (${res.status})`);
      setIconResp(json);
    } catch (e: unknown) {
      setIconError(getErrorMessage(e) || 'Icon search failed');
    } finally {
      setIconLoading(false);
    }
  }, [iconQuery, iconDescription, iconMaxResults, iconDebug]);

  const runMetricDiscovery = React.useCallback(async () => {
    setMdLoading(true);
    setMdError(null);
    setMdResp(null);
    try {
      const excludeUrls = mdExcludeUrls
        .split(/\n|,/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 25);

      const res = await fetch('/api/metric-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: mdDescription,
          mode: mdMode,
          searchVariation: mdMode === 'full' ? mdSearchVariation : undefined,
          excludeUrls: mdMode === 'full' && excludeUrls.length > 0 ? excludeUrls : undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as MetricDiscoveryResponse & {
        error?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(json?.message || json?.error || `metric-discovery failed (${res.status})`);
      setMdResp(json);
    } catch (e: unknown) {
      setMdError(getErrorMessage(e) || 'Metric discovery failed');
    } finally {
      setMdLoading(false);
    }
  }, [mdDescription, mdExcludeUrls, mdMode, mdSearchVariation]);

  const runSim = React.useCallback(async () => {
    setSimLoading(true);
    setSimError(null);
    setSimStep1(null);
    setSimStep3(null);
    setSimMerged(null);
    try {
      const step1Res = await fetch('/api/metric-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: mdDescription, mode: 'define_only' }),
      });
      const step1 = (await step1Res.json().catch(() => ({}))) as MetricDiscoveryResponse & {
        message?: string;
      };
      if (!step1Res.ok) throw new Error(step1?.message || `Step 1 failed (${step1Res.status})`);
      setSimStep1(step1);

      const step3Res = await fetch('/api/metric-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: mdDescription, mode: 'full', search_query: step1.search_query || undefined, searchVariation: mdSearchVariation }),
      });
      const step3 = (await step3Res.json().catch(() => ({}))) as MetricDiscoveryResponse & {
        message?: string;
      };
      if (!step3Res.ok) throw new Error(step3?.message || `Step 3 failed (${step3Res.status})`);
      setSimStep3(step3);

      // Mimic InteractiveMarketCreation merge behavior (preserve metric_definition)
      const merged: MetricDiscoveryResponse = {
        ...step1,
        ...step3,
        metric_definition: step3.metric_definition || step1.metric_definition,
        search_query: step3.search_query || step1.search_query,
      };
      if (step1.metric_definition && step3.measurable === false) {
        merged.measurable = true;
        merged.rejection_reason = step1.rejection_reason ?? null;
      }
      setSimMerged(merged);
    } catch (e: unknown) {
      setSimError(getErrorMessage(e) || 'Simulation failed');
    } finally {
      setSimLoading(false);
    }
  }, [mdDescription, mdSearchVariation]);

  if (!debugEnabled) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
          <div className="text-[12px] font-medium text-white">Debug pages disabled</div>
          <div className="mt-1 text-[11px] text-[#9CA3AF]">
            Set <span className="font-mono text-white/80">NEXT_PUBLIC_ENABLE_DEBUG_PAGES=true</span> to enable in production.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-[12px] font-medium text-white">Debug: Search + Image Intent</div>
            <div className="mt-1 text-[11px] text-[#9CA3AF]">
              Test SerpAPI fallback behavior and the Unsplash/logo intent normalization.
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <a className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-white hover:bg-[#1A1A1A]" href="/debug/js-extractor">
              JS Extractor
            </a>
            <a className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-white hover:bg-[#1A1A1A]" href="/debug/market-creation-flow">
              Market Creation Flow
            </a>
            <a className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-white hover:bg-[#1A1A1A]" href="/debug/deployment-overlay">
              Deployment Overlay
            </a>
            <a className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-white hover:bg-[#1A1A1A]" href="/debug/market-similarity">
              Market Similarity
            </a>
            <a className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-white hover:bg-[#1A1A1A]" href="/debug/create-market-v2">
              Create Market V2 UI
            </a>
            <a className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-white hover:bg-[#1A1A1A]" href="/debug/orders-v2">
              On-Chain Orders V2
            </a>
            <a className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-white hover:bg-[#1A1A1A]" href="/debug/order-fill-modal">
              Order Fill Modal
            </a>
            <a className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-white hover:bg-[#1A1A1A]" href="/debug/market-preview-modal">
              Market Preview Modal
            </a>
            <a className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-white hover:bg-[#1A1A1A]" href="/debug/settlement-lifecycle">
              Settlement Lifecycle
            </a>
          </div>
        </div>
      </div>

      {/* MarketInfoHeader Component Preview */}
      <div className="mt-4 rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="text-[12px] font-medium text-white mb-1">MarketInfoHeader Preview</div>
        <div className="text-[11px] text-[#9CA3AF] mb-4">
          Minimal trading interface header component for token/market pages.
        </div>
        <MarketInfoHeader
          name="Spark Protocol"
          symbol="SPARK"
          description="Spark is a decentralized lending protocol built on Ethereum that enables users to borrow and lend crypto assets. The protocol features competitive interest rates, over-collateralized loans, and integration with major DeFi ecosystems. Spark leverages battle-tested smart contracts and has undergone multiple security audits."
          logoUrl="https://storage.googleapis.com/public-bubblemaps/app/tokens-images/ethereum/0xD31a59c85aE9D8edEFec411D448f90841571b89c"
          verified
          status="live"
          settlementDate={new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()}
          orderbookAddress="0xE9B225Dfc187b657F199dBbEd573567b0e53b945"
          marketId="0x8f64de7b105020f4c18ddc01f9ddfdf4ce4802c6e5dbd2fdbc02b51a47c7f9d2"
          tags={[
            { label: 'DeFi' },
            { label: 'Lending' },
            { label: 'Ethereum' },
          ]}
          moreTagsCount={12}
          stats={[
            { label: 'Watching', value: '328' },
          ]}
          websiteUrl="https://spark.fi"
          twitterUrl="https://twitter.com/sparkdotfi"
          waybackSnapshot={{
            url: 'https://web.archive.org/web/20251216005857/https://markets.businessinsider.com/commodities/copper-price',
            timestamp: '20251216005857',
            source_url: 'https://markets.businessinsider.com/commodities/copper-price',
          }}
          onWatchlistToggle={() => alert('Watchlist toggled')}
          isWatchlisted={false}
          isWatchlistLoading={false}
        />
      </div>

      {/* CommentSection Preview */}
      <div className="mt-4 rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="text-[12px] font-medium text-white mb-1">CommentSection Preview</div>
        <div className="text-[11px] text-[#9CA3AF] mb-4">
          Token page comment section with threaded replies, likes, and user interactions.
        </div>
        <CommentSectionPreview />
      </div>

      {/* Icon search */}
      <div className="mt-4 rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="text-[12px] font-medium text-white">Icon Search (SerpAPI Images)</div>
        <div className="mt-1 text-[11px] text-[#9CA3AF]">
          Calls <span className="font-mono text-white/80">/api/icon-search</span>. If results are empty, it will retry with a different query and a backup engine.
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Query</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={iconQuery}
              onChange={(e) => setIconQuery(e.target.value)}
              placeholder="bitcoin"
            />
          </label>
          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Max results</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={String(iconMaxResults)}
              onChange={(e) => setIconMaxResults(Math.max(1, Math.min(20, Number(e.target.value) || 8)))}
              placeholder="8"
            />
          </label>
          <label className="block md:col-span-2">
            <div className="text-[10px] text-[#808080] mb-1">Description (optional)</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={iconDescription}
              onChange={(e) => setIconDescription(e.target.value)}
              placeholder="Context helps the intent model pick photo vs logo/icon"
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[11px] text-[#9CA3AF]">
            <input type="checkbox" checked={iconDebug} onChange={(e) => setIconDebug(e.target.checked)} />
            Include debug block
          </label>
          <button
            onClick={runIconSearch}
            disabled={iconLoading}
            className="rounded bg-white px-3 py-2 text-[12px] font-medium text-black hover:bg-white/90 disabled:opacity-50"
          >
            {iconLoading ? 'Searching…' : 'Run icon search'}
          </button>
          {iconError ? <div className="text-[11px] text-red-300/90">{iconError}</div> : null}
        </div>

        {iconResp?.debug ? (
          <div className="mt-3 space-y-3 text-[11px] text-[#9CA3AF]">
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <span className="text-white/70">Kind:</span>{' '}
                <span className="text-white/90">{iconResp.debug.kind || '—'}</span>
              </div>
              <div>
                <span className="text-white/70">Intent:</span>{' '}
                <span className="text-white/90">{iconResp.debug.intent || '—'}</span>
              </div>
              <div>
                <span className="text-white/70">Used engine:</span>{' '}
                <span className="text-white/90">{iconResp.debug.usedEngine || '—'}</span>
              </div>
              <div>
                <span className="text-white/70">Used path:</span>{' '}
                <span className="text-white/90">{iconResp.debug.usedQueryLabel || '—'}</span>
              </div>
            </div>

            {/* Highlight: primary vs fallback */}
            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={[
                    'rounded-full px-2 py-0.5 text-[10px] font-medium',
                    iconResp.debug.usedQueryLabel === 'primary'
                      ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/30'
                      : 'bg-white/5 text-white/70 border border-white/10',
                  ].join(' ')}
                >
                  Primary
                </span>
                <span className="text-white/70">results:</span>{' '}
                <span className="text-white/90 tabular-nums">
                  {typeof iconResp.debug.primaryResultCount === 'number' ? iconResp.debug.primaryResultCount : '—'}
                </span>
              </div>
              <div className="mt-2">
                <span className="text-white/70">query:</span>{' '}
                <span className="text-white/90 font-mono break-all">{iconResp.debug.primaryQuery || '—'}</span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span
                  className={[
                    'rounded-full px-2 py-0.5 text-[10px] font-medium',
                    iconResp.debug.usedQueryLabel === 'fallback' || iconResp.debug.usedQueryLabel === 'backup_engine'
                      ? 'bg-yellow-500/20 text-yellow-200 border border-yellow-500/30'
                      : 'bg-white/5 text-white/70 border border-white/10',
                  ].join(' ')}
                >
                  Fallback triggered
                </span>
                <span className="text-white/90">
                  {iconResp.debug.fallbackAttempted ? 'Yes' : 'No'}
                </span>
                {iconResp.debug.fallbackAttempted ? (
                  <>
                    <span className="text-white/60">•</span>
                    <span className="text-white/70">fallback results:</span>{' '}
                    <span className="text-white/90 tabular-nums">
                      {typeof iconResp.debug.fallbackResultCount === 'number'
                        ? iconResp.debug.fallbackResultCount
                        : '—'}
                    </span>
                  </>
                ) : null}
              </div>

              {iconResp.debug.fallbackAttempted ? (
                <div className="mt-2">
                  <span className="text-white/70">fallback query:</span>{' '}
                  <span className="text-white/90 font-mono break-all">
                    {iconResp.debug.fallbackQuery || '—'}
                  </span>
                </div>
              ) : null}

              {iconResp.debug.backupAttempted ? (
                <div className="mt-3">
                  <div className="text-white/70">
                    Backup engine attempted ({iconResp.debug.usedEngine || '—'}):{' '}
                    <span className="text-white/90 tabular-nums">
                      {typeof iconResp.debug.backupResultCount === 'number'
                        ? iconResp.debug.backupResultCount
                        : '—'}
                    </span>
                  </div>
                  {iconResp.debug.backupQuery ? (
                    <div className="mt-1">
                      <span className="text-white/70">backup query:</span>{' '}
                      <span className="text-white/90 font-mono break-all">{iconResp.debug.backupQuery}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {iconResp?.results?.length ? (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {iconResp.results.map((r, idx) => (
              <a
                key={`${r.domain}-${idx}`}
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="group rounded-lg border border-white/10 bg-black/30 p-2 hover:bg-black/40"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.thumbnail || r.url}
                  alt={r.title || 'result'}
                  className="h-20 w-full rounded-md bg-black/40 object-contain"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
                <div className="mt-2 text-[10px] text-white/70 line-clamp-2">{r.title || r.domain || 'Result'}</div>
                <div className="mt-1 text-[10px] text-white/40">{r.domain}</div>
              </a>
            ))}
          </div>
        ) : iconResp ? (
          <div className="mt-4 text-[11px] text-white/60">No results.</div>
        ) : null}

        {iconResp ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-[11px] text-white/60">Raw response</summary>
            <pre className="mt-2 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-[11px] text-white/80">
{prettyJson(iconResp)}
            </pre>
          </details>
        ) : null}
      </div>

      {/* Metric discovery */}
      <div className="mt-4 rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="text-[12px] font-medium text-white">Metric Discovery (SerpAPI Web)</div>
        <div className="mt-1 text-[11px] text-[#9CA3AF]">
          Calls <span className="font-mono text-white/80">/api/metric-discovery</span>. In full mode, it returns
          <span className="font-mono text-white/80"> search_results</span> that should no longer be empty just because the first query was too strict.
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="block md:col-span-2">
            <div className="text-[10px] text-[#808080] mb-1">Description</div>
            <textarea
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={mdDescription}
              onChange={(e) => setMdDescription(e.target.value)}
              rows={3}
            />
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Mode</div>
            <select
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={mdMode}
              onChange={(e) => {
                const v = e.target.value === 'define_only' ? 'define_only' : 'full';
                setMdMode(v);
              }}
            >
              <option value="full">full (SERP + AI ranking)</option>
              <option value="define_only">define_only (no SERP)</option>
            </select>
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Search variation (full only)</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={String(mdSearchVariation)}
              onChange={(e) => setMdSearchVariation(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
            />
          </label>

          <label className="block md:col-span-2">
            <div className="text-[10px] text-[#808080] mb-1">Exclude URLs (optional, newline/comma separated)</div>
            <textarea
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={mdExcludeUrls}
              onChange={(e) => setMdExcludeUrls(e.target.value)}
              rows={2}
              placeholder="https://example.com"
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={runMetricDiscovery}
            disabled={mdLoading}
            className="rounded bg-white px-3 py-2 text-[12px] font-medium text-black hover:bg-white/90 disabled:opacity-50"
          >
            {mdLoading ? 'Running…' : 'Run metric discovery'}
          </button>
          {mdError ? <div className="text-[11px] text-red-300/90">{mdError}</div> : null}
        </div>

        {mdResp ? (
          <details className="mt-4" open>
            <summary className="cursor-pointer text-[11px] text-white/60">
              Response ({Array.isArray(mdResp.search_results) ? mdResp.search_results.length : 0} search results)
            </summary>
            <pre className="mt-2 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-[11px] text-white/80">
{prettyJson(mdResp)}
            </pre>
          </details>
        ) : null}
      </div>

      {/* Simulation */}
      <div className="mt-4 rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="text-[12px] font-medium text-white">Create Market V2 Simulation (Step 1 → Step 3 merge)</div>
        <div className="mt-1 text-[11px] text-[#9CA3AF]">
          Runs <span className="font-mono text-white/80">define_only</span> then <span className="font-mono text-white/80">full</span> and shows a merged payload that preserves <span className="font-mono text-white/80">metric_definition</span> if SERP returns nothing.
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={runSim}
            disabled={simLoading}
            className="rounded bg-white px-3 py-2 text-[12px] font-medium text-black hover:bg-white/90 disabled:opacity-50"
          >
            {simLoading ? 'Running…' : 'Run simulation'}
          </button>
          {simError ? <div className="text-[11px] text-red-300/90">{simError}</div> : null}
        </div>

        {simMerged ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <details className="md:col-span-1">
              <summary className="cursor-pointer text-[11px] text-white/60">Step 1 (define_only)</summary>
              <pre className="mt-2 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-[11px] text-white/80">
{prettyJson(simStep1)}
              </pre>
            </details>
            <details className="md:col-span-1">
              <summary className="cursor-pointer text-[11px] text-white/60">Step 3 (full)</summary>
              <pre className="mt-2 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-[11px] text-white/80">
{prettyJson(simStep3)}
              </pre>
            </details>
            <details className="md:col-span-1" open>
              <summary className="cursor-pointer text-[11px] text-white/60">Merged (Create Market V2 behavior)</summary>
              <pre className="mt-2 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-[11px] text-white/80">
{prettyJson(simMerged)}
              </pre>
            </details>
          </div>
        ) : null}
      </div>
    </div>
  );
}

