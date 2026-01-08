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
import { useMarketOverview } from '@/hooks/useMarketOverview';
import { transformOverviewToCards, sortMarketsByPriority } from '@/lib/marketTransformers';
import { MarketToolbar } from '@/components/MarketToolbar';

export default function Home() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductCardData | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const router = useRouter();

  // Fetch active markets from the materialized view with latest mark prices
  const {
    data: overview,
    isLoading: marketsLoading,
    error: marketsError,
    refetch: refetchMarkets
  } = useMarketOverview({
    status: ['ACTIVE', 'SETTLEMENT_REQUESTED'],
    limit: 20,
    autoRefresh: false,
    realtimeDebounce: 1000 // Add 1 second debounce for realtime updates
  });

  // Memoize sorted markets and card data to prevent unnecessary recalculations
  const sortedMarkets = useMemo(() => sortMarketsByPriority(overview as any), [overview]);
  
  // Extract unique categories from markets for filter options
  const marketFilters = useMemo(() => {
    const categories = new Set<string>();
    (sortedMarkets as any[]).forEach((market) => {
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
  }, [sortedMarkets]);

  // Filter and search markets
  const filteredMarkets = useMemo(() => {
    let filtered = sortedMarkets as any[];
    
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
  }, [sortedMarkets, searchQuery, selectedFilter]);
  
  // Transform markets to card data format using the new transformer
  const marketCardData = useMemo(() => transformOverviewToCards(filteredMarkets as any), [filteredMarkets]);
  
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

  return (
    <>
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
            <MarketTickerCardContainer
              title="Active Markets"
              variant="inline"
              cards={marketCardData.length > 0 ? marketCardData : []}
              onCardLongPosition={handleMarketCardLongPosition}
              onCardShortPosition={handleMarketCardShortPosition}
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
                  onSavedClick={() => {
                    // TODO: Implement saved markets view
                    console.log('Saved markets clicked');
                  }}
                  savedCount={0}
                />
              }
            />
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
          description={selectedProduct.subtitle || 'High-quality design templates perfect for your next project. Professional crafted with modern aesthetics and user experience in mind.'}
          category="Singular  Market"
          templates={mockTemplates}
          onGoToProduct={handleGoToProduct}
        />
      )}
      
    </>
  );
}