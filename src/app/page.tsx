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

export default function Home() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductCardData | null>(null);
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
  
  // Transform markets to card data format using the new transformer
  const marketCardData = useMemo(() => transformOverviewToCards(sortedMarkets as any), [sortedMarkets]);
  
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
      <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-7xl mx-auto">
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
          ) : marketsLoading && !marketCardData.length ? (
            <div className="space-y-4">
              <div className="h-8 bg-gray-700/50 rounded-md animate-pulse w-48" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-48 bg-gray-700/50 rounded-lg animate-pulse" />
                ))}
              </div>
            </div>
          ) : marketCardData.length > 0 ? (
            <MarketTickerCardContainer
              title="Active Markets"
              cards={marketCardData}
              onCardLongPosition={handleMarketCardLongPosition}
              onCardShortPosition={handleMarketCardShortPosition}
              isLoading={marketsLoading} // Pass loading state to show refresh indicators
            />
          ) : (
            <div className="text-center py-12">
              <p className="text-gray-400 mb-4">No markets found</p>
              <button 
                onClick={() => refetchMarkets()}
                className="px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 rounded-md text-blue-500"
              >
                Refresh Markets
              </button>
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
          description={selectedProduct.subtitle || 'High-quality design templates perfect for your next project. Professional crafted with modern aesthetics and user experience in mind.'}
          category="Singular  Market"
          templates={mockTemplates}
          onGoToProduct={handleGoToProduct}
        />
      )}
      
    </>
  );
}