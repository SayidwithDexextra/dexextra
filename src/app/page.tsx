'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import CryptoMarketTicker from '@/components/CryptoMarketTicker/CryptoMarketTicker';
import Hero from '@/components/Hero/Hero';
import Widget from '@/components/widgets/Widget';
import { ProductCard, ProductCardData } from '@/components/ProductCard';
import { MarketPreviewModal } from '@/components/MarketPreviewModal';
import MarketTickerCardContainer from '@/components/MarketTickerCard/MarketTickerCardContainer';
import { MarketTickerCardData } from '@/components/MarketTickerCard/types';
import useWallet from '@/hooks/useWallet';
import { useMarketOverview } from '@/hooks/useMarketOverview';
import { transformOverviewToCards, sortMarketsByPriority } from '@/lib/marketTransformers';
import { MarketToolbar, MarketToolbarFilterSettings } from '@/components/MarketToolbar';

export default function Home() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductCardData | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [watchlistIds, setWatchlistIds] = useState<string[]>([]);
  const [watchlistPending, setWatchlistPending] = useState<string[]>([]);
  const [isWatchlistSorted, setIsWatchlistSorted] = useState<boolean>(false);
  const [advancedFilters, setAdvancedFilters] = useState<MarketToolbarFilterSettings>({
    sortBy: '24h_volume',
    frequency: 'all',
    status: 'active',
    hideCrypto: false,
  });
  const [rankingRows, setRankingRows] = useState<any[]>([]);
  const router = useRouter();
  const { walletData } = useWallet();

  const statusFilter = useMemo(() => {
    switch (advancedFilters.status) {
      case 'active':
        return ['ACTIVE', 'SETTLEMENT_REQUESTED'];
      case 'paused':
        return ['PAUSED'];
      case 'settled':
        return ['SETTLED'];
      default:
        return undefined;
    }
  }, [advancedFilters.status]);

  // Fetch active markets from the materialized view with latest mark prices
  const {
    data: overview,
    isLoading: marketsLoading,
    error: marketsError,
    refetch: refetchMarkets
  } = useMarketOverview({
    status: statusFilter,
    autoRefresh: false,
    realtimeDebounce: 1000 // Add 1 second debounce for realtime updates
  });

  const baseMarkets = useMemo(() => (overview as any[]) || [], [overview]);

  useEffect(() => {
    const walletAddress = walletData?.address;
    if (!walletAddress) {
      setWatchlistIds([]);
      setIsWatchlistSorted(false);
      return;
    }
    const ctrl = new AbortController();
    const run = async () => {
      try {
        const res = await fetch(`/api/watchlist?wallet=${encodeURIComponent(walletAddress)}`, {
          signal: ctrl.signal,
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || 'Failed to fetch watchlist');
        }
        const ids = Array.isArray(json.market_ids) ? json.market_ids : [];
        setWatchlistIds(ids.filter((id: any) => typeof id === 'string'));
      } catch (error) {
        if ((error as any)?.name === 'AbortError') return;
        console.error('Error fetching watchlist:', error);
      }
    };
    run();
    return () => ctrl.abort();
  }, [walletData?.address]);
  
  // Extract unique categories from markets for filter options
  const marketFilters = useMemo(() => {
    const categories = new Set<string>();
    baseMarkets.forEach((market) => {
      if (market.category) {
        categories.add(market.category);
      }
    });
    
    // Format category labels: capitalize only first letter of each word
    const formatCategoryLabel = (category: string): string => {
      if (!category) return '';
      return category
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    };

    const filters = [
      { id: 'all', label: 'All' },
      ...Array.from(categories).map((cat) => ({
        id: cat.toLowerCase().replace(/\s+/g, '-'),
        label: formatCategoryLabel(cat),
        category: cat,
      })),
    ];
    
    return filters;
  }, [baseMarkets]);

  const resolveFrequency = (market: any): 'recurring' | 'one-off' => {
    const config = (market as any)?.market_config || {};
    const rawFrequency =
      config?.frequency ??
      config?.recurrence ??
      config?.recurring ??
      config?.is_recurring ??
      config?.isRecurring ??
      (market as any)?.frequency;
    if (typeof rawFrequency === 'boolean') {
      return rawFrequency ? 'recurring' : 'one-off';
    }
    if (typeof rawFrequency === 'string') {
      const normalized = rawFrequency.toLowerCase().trim();
      if (normalized.includes('recurr')) return 'recurring';
      if (normalized.includes('one')) return 'one-off';
    }
    const settlementDate = (market as any)?.settlement_date || (market as any)?.settlementDate;
    return settlementDate ? 'one-off' : 'recurring';
  };

  // Filter and search markets
  const filteredMarkets = useMemo(() => {
    let filtered = baseMarkets;

    if (advancedFilters.hideCrypto) {
      filtered = filtered.filter((market) => {
        const category = (market.category || '').toLowerCase();
        return category !== 'crypto';
      });
    }

    if (advancedFilters.frequency !== 'all') {
      filtered = filtered.filter((market) => resolveFrequency(market) === advancedFilters.frequency);
    }
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((market) => {
        const name = (market.name || market.symbol || market.market_identifier || '').toLowerCase();
        const category = (market.category || '').toLowerCase();
        const description = (market.description || '').toLowerCase();
        return name.includes(query) || category.includes(query) || description.includes(query);
      });
    }
    
    // Apply category filter (if not 'all')
    if (selectedFilter !== 'all') {
      filtered = filtered.filter((market) => {
        const category = (market.category || '').toLowerCase().replace(/\s+/g, '-');
        return category === selectedFilter.toLowerCase();
      });
    }
    
    return filtered;
  }, [baseMarkets, advancedFilters.frequency, advancedFilters.hideCrypto, searchQuery, selectedFilter]);

  useEffect(() => {
    const sortBy = advancedFilters.sortBy;
    if (!filteredMarkets.length) {
      setRankingRows([]);
      return;
    }
    if (!['24h_volume', 'notional', 'price', 'trending'].includes(sortBy)) {
      setRankingRows([]);
      return;
    }

    const ctrl = new AbortController();
    const run = async () => {
      const qs = new URLSearchParams();
      const limit = String(Math.max(50, Math.min(500, filteredMarkets.length * 2)));

      if (sortBy === 'trending' || sortBy === 'price') {
        qs.set('kind', 'trending');
      } else {
        qs.set('kind', 'top_volume');
        qs.set('windowHours', '24');
      }
      qs.set('limit', limit);

      const res = await fetch(`/api/market-rankings?${qs.toString()}`, { signal: ctrl.signal });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error('ranking_fetch_failed');
      const rows = Array.isArray(json.rows) ? json.rows : [];
      setRankingRows(rows);
    };

    run().catch(() => {
      if (!ctrl.signal.aborted) setRankingRows([]);
    });

    return () => ctrl.abort();
  }, [advancedFilters.sortBy, filteredMarkets.length]);

  const rankingLookup = useMemo(() => {
    const byId = new Map<string, any>();
    const bySymbol = new Map<string, any>();
    (rankingRows || []).forEach((row: any) => {
      const id = String(row?.marketUuid || row?.market_uuid || '').trim();
      if (id) byId.set(id, row);
      const sym = String(row?.symbol || '').toUpperCase().trim();
      if (sym) bySymbol.set(sym, row);
    });
    return { byId, bySymbol };
  }, [rankingRows]);

  const sortedMarkets = useMemo(() => {
    const baseSorted = sortMarketsByPriority(filteredMarkets as any);
    const watchlistSet = isWatchlistSorted ? new Set(watchlistIds) : null;

    const baseIndex = new Map<string, number>();
    baseSorted.forEach((m: any, idx: number) => {
      if (m?.market_id) baseIndex.set(String(m.market_id), idx);
    });

    const fallbackMetric = (market: any): number | null => {
      if (advancedFilters.sortBy === 'price') {
        const raw = Number(market?.mark_price ?? 0);
        return Number.isFinite(raw) ? raw : null;
      }
      if (advancedFilters.sortBy === '24h_volume' || advancedFilters.sortBy === 'notional') {
        const raw = Number(market?.total_volume ?? 0);
        return Number.isFinite(raw) ? raw : null;
      }
      if (advancedFilters.sortBy === 'trending') {
        const raw = Number(market?.total_trades ?? 0);
        return Number.isFinite(raw) ? raw : null;
      }
      return null;
    };

    if (!rankingRows.length) {
      return [...baseSorted].sort((a: any, b: any) => {
        const aMetric = fallbackMetric(a);
        const bMetric = fallbackMetric(b);
        const aHas = aMetric != null;
        const bHas = bMetric != null;
        if (watchlistSet) {
          const aWatch = watchlistSet.has(String(a?.market_id || ''));
          const bWatch = watchlistSet.has(String(b?.market_id || ''));
          if (aWatch !== bWatch) return aWatch ? -1 : 1;
        }
        if (aHas && bHas && aMetric !== bMetric) {
          return (bMetric as number) - (aMetric as number);
        }
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;
        const aIdx = baseIndex.get(String(a?.market_id || '')) ?? 0;
        const bIdx = baseIndex.get(String(b?.market_id || '')) ?? 0;
        return aIdx - bIdx;
      });
    }

    const resolveRankingRow = (market: any) => {
      const id = String(market?.market_id || '').trim();
      const symbol = String(market?.symbol || '').toUpperCase().trim();
      const identifier = String(market?.market_identifier || '').toUpperCase().trim();
      return (
        (id && rankingLookup.byId.get(id)) ||
        (symbol && rankingLookup.bySymbol.get(symbol)) ||
        (identifier && rankingLookup.bySymbol.get(identifier)) ||
        null
      );
    };

    const metricForSort = (row: any): number | null => {
      if (!row) return null;
      if (advancedFilters.sortBy === 'trending') {
        const score = Number(row?.score);
        return Number.isFinite(score) ? score : null;
      }
      if (advancedFilters.sortBy === 'price') {
        const price =
          row?.close24h ??
          row?.close_24h ??
          row?.close1h ??
          row?.close_1h ??
          row?.close ??
          null;
        const n = Number(price);
        return Number.isFinite(n) ? n : null;
      }
      if (advancedFilters.sortBy === '24h_volume') {
        const vol = row?.baseVolume ?? row?.base_volume ?? row?.volume ?? null;
        const n = Number(vol);
        return Number.isFinite(n) ? n : null;
      }
      if (advancedFilters.sortBy === 'notional') {
        const notional = row?.notionalVolume ?? row?.notional_volume ?? null;
        const n = Number(notional);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    };

    return [...baseSorted].sort((a: any, b: any) => {
      const aRow = resolveRankingRow(a);
      const bRow = resolveRankingRow(b);
      const aMetric = metricForSort(aRow);
      const bMetric = metricForSort(bRow);
      const aHas = aMetric != null;
      const bHas = bMetric != null;
      if (watchlistSet) {
        const aWatch = watchlistSet.has(String(a?.market_id || ''));
        const bWatch = watchlistSet.has(String(b?.market_id || ''));
        if (aWatch !== bWatch) return aWatch ? -1 : 1;
      }

      if (aHas && bHas && aMetric !== bMetric) {
        return (bMetric as number) - (aMetric as number);
      }
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;

      const aIdx = baseIndex.get(String(a?.market_id || '')) ?? 0;
      const bIdx = baseIndex.get(String(b?.market_id || '')) ?? 0;
      return aIdx - bIdx;
    });
  }, [
    advancedFilters.sortBy,
    filteredMarkets,
    rankingLookup,
    rankingRows.length,
    isWatchlistSorted,
    watchlistIds,
  ]);
  
  // Transform markets to card data format using the new transformer
  const marketCardData = useMemo(
    () => transformOverviewToCards(sortedMarkets as any),
    [sortedMarkets]
  );
  
  const recentEvents: any[] = []
  const eventsLoading = false
  const eventsError = null


  const heroData = {
    title: "DexEtera",
    author: "Trading Platform",
    isVerified: true,
    stats: {
      mintPrice: "Free",
      totalItems: 1000000,
      mintStartsIn: "2024-12-31T23:59:59"
    }
  };

  const featuredProducts = [
    {
      id: '1',
      title: 'Monologue — Framer Portfolio Template',
      author: 'ena',
      price: 49,
      currency: 'USD',
      imageUrl: 'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExcXVvYjE0cWp2cnpubGdiZjdtOGhham5seGdodmVtdmg5MzF5c3phdiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/xT77XUw1XMVGIxgove/giphy.gif',
      href: '/product/monologue-framer-template',
    },
    {
      id: '2',
      title: 'AiNest - Framer Template',
      subtitle: 'Smarter Design, Seamless Automation',
      author: 'Dmytri Ivanov',
      price: 69,
      currency: 'USD',
      imageUrl: 'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExcXVvYjE0cWp2cnpubGdiZjdtOGhham5seGdodmVtdmg5MzF5c3pohdiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/xT77XUw1XMVGIxgove/giphy.gif',
      href: '/product/ainest-framer-template',
    },
    {
      id: '3',
      title: 'Zentro — Modern Creative Agency Template',
      subtitle: 'Ideas that Move Brands',
      author: 'Shaig',
      price: 79,
      currency: 'USD',
      imageUrl: 'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExcXVvYjE0cWp2cnpubGdiZjdtOGhham5seGdodmVtdmg5MzF5c3pohdiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/xT77XUw1XMVGIxgove/giphy.gif',
      href: '/product/zentro-agency-template',
    },
  ];

  // Mock templates for the modal
  const mockTemplates = [
    { id: '1', title: 'Template 1', image: '/placeholder-template.png' },
    { id: '2', title: 'Template 2', image: '/placeholder-template.png' },
    { id: '3', title: 'Template 3', image: '/placeholder-template.png' },
    { id: '4', title: 'Template 4', image: '/placeholder-template.png' },
    { id: '5', title: 'Template 5', image: '/placeholder-template.png' },
  ];

  const handleViewMarket = (productData: ProductCardData) => {
    setSelectedProduct(productData);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedProduct(null);
  };

  const handleGoToProduct = () => {
    if (selectedProduct?.href) {
      router.push(selectedProduct.href);
    }
    handleCloseModal();
  };

  const handleMarketCardLongPosition = (cardId: string) => {
    const market = (overview || []).find((m: any) => m.market_id === cardId || m.id === cardId);
    if (market) {
      router.push(`/token/${(market as any).market_identifier || (market as any).symbol}?action=long`);
    }
  };

  const handleMarketCardShortPosition = (cardId: string) => {
    const market = (overview || []).find((m: any) => m.market_id === cardId || m.id === cardId);
    if (market) {
      router.push(`/token/${(market as any).market_identifier || (market as any).symbol}?action=short`);
    }
  };

  const handleMarketCardNavigate = (cardId: string) => {
    const market = (overview || []).find((m: any) => m.market_id === cardId || m.id === cardId);
    if (market) {
      router.push(`/token/${(market as any).market_identifier || (market as any).symbol}`);
    }
  };

  const handleWatchlistToggle = async (card: MarketTickerCardData) => {
    const marketId = card.id;
    const metricId = card.metricId || '';
    if (!marketId) return;
    if (!walletData?.address) {
      console.warn('Connect a wallet to add to watchlist.');
      return;
    }
    if (watchlistPending.includes(marketId)) return;

    const isWatchlisted = watchlistIds.includes(marketId);
    setWatchlistIds((prev) =>
      isWatchlisted ? prev.filter((id) => id !== marketId) : [...prev, marketId]
    );
    setWatchlistPending((prev) => [...prev, marketId]);
    try {
      const res = await fetch('/api/watchlist', {
        method: isWatchlisted ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_address: walletData.address,
          market_id: marketId,
          metric_id: metricId,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Failed to update watchlist');
      }
    } catch (error) {
      console.error('Error updating watchlist:', error);
      setWatchlistIds((prev) =>
        isWatchlisted ? [...prev, marketId] : prev.filter((id) => id !== marketId)
      );
    } finally {
      setWatchlistPending((prev) => prev.filter((id) => id !== marketId));
    }
  };

  return (
    <div className="dex-page-enter-up w-full">
      {/* Crypto Market Ticker with proper container */}
      <div className="w-full overflow-hidden">
        <CryptoMarketTicker />
      </div>

      <Hero data={heroData} />

      <div className="flex justify-center py-8">
        <Widget />
      </div>

      {/* Markets Section */}
      <div className="w-full py-8">
        <div className="w-full">
          {marketsError ? (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4 text-center">
              <p className="text-red-500">Error loading markets: {marketsError}</p>
              <button
                onClick={() => refetchMarkets()}
                className="mt-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 rounded-md text-red-500"
              >
                Retry
              </button>
            </div>
          ) : (
            <div data-walkthrough="home-active-markets">
              <MarketTickerCardContainer
                title="Active Markets"
                variant="inline"
                cards={marketCardData.length > 0 ? marketCardData : []}
                onCardClick={handleMarketCardNavigate}
                onCardLongPosition={handleMarketCardLongPosition}
                onCardShortPosition={handleMarketCardShortPosition}
                onWatchlistToggle={handleWatchlistToggle}
                watchlistIds={watchlistIds}
                watchlistPendingIds={watchlistPending}
                isWatchlistDisabled={!walletData?.address}
                isLoading={marketsLoading}
                toolbar={
                  <MarketToolbar
                    filters={marketFilters}
                    selectedFilter={selectedFilter}
                    onFilterChange={setSelectedFilter}
                    onSearch={setSearchQuery}
                    onFilterClick={() => {
                      // TODO: Implement filter modal/dropdown
                      console.log('Filter clicked');
                    }}
                    onSavedClick={() => setIsWatchlistSorted((prev) => !prev)}
                    savedCount={watchlistIds.length}
                    savedActive={isWatchlistSorted}
                    advancedFilters={advancedFilters}
                    onAdvancedFiltersChange={setAdvancedFilters}
                  />
                }
              />
            </div>
          )}
        </div>
      </div>

      {/* Market Preview Modal */}
      {selectedProduct && (
        <MarketPreviewModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          productTitle={selectedProduct.title}
          author={selectedProduct.author}
          price={selectedProduct.price}
          currency={selectedProduct.currency}
          description={
            selectedProduct.subtitle ||
            'High-quality design templates perfect for your next project. Professional crafted with modern aesthetics and user experience in mind.'
          }
          category="Singular  Market"
          templates={mockTemplates}
          onGoToProduct={handleGoToProduct}
        />
      )}
    </div>
  );
}