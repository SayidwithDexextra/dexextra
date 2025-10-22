'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import CryptoMarketTicker from '@/components/CryptoMarketTicker/CryptoMarketTicker';
import Hero from '@/components/Hero/Hero';
import Widget from '@/components/widgets/Widget';
import { ProductCard, ProductCardData } from '@/components/ProductCard';
import { MarketPreviewModal } from '@/components/MarketPreviewModal';
import MarketTickerCardContainer from '@/components/MarketTickerCard/MarketTickerCardContainer';
import { MarketTickerCardData } from '@/components/MarketTickerCard/types';
import { useMarkets } from '@/hooks/useMarkets';
import { transformMarketsToCards, sortMarketsByPriority } from '@/lib/marketTransformers';

export default function Home() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductCardData | null>(null);
  const router = useRouter();

  // Fetch active markets from the database using the new hook
  const { 
    markets, 
    isLoading: marketsLoading, 
    error: marketsError,
    refetch: refetchMarkets 
  } = useMarkets({
    status: 'ACTIVE',
    limit: 20,
    autoRefresh: true,
    refreshInterval: 30000 // Refresh every 30 seconds
  });

  // Sort markets by priority (active first, then by volume/date)
  const sortedMarkets = sortMarketsByPriority(markets);
  
  // Transform markets to card data format using the new transformer
  const marketCardData = transformMarketsToCards(sortedMarkets);
  
  const recentEvents: any[] = []
  const eventsLoading = false
  const eventsError = null


  const heroData = {
    title: "DexEtra",
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
    const market = markets.find(m => m.id === cardId);
    if (market) {
      // Navigate to token page with "long" intent using market_identifier instead of metric_id
      router.push(`/token/${market.market_identifier}?action=long`);
    }
  };

  const handleMarketCardShortPosition = (cardId: string) => {
    const market = markets.find(m => m.id === cardId);
    if (market) {
      // Navigate to token page with "short" intent using market_identifier instead of metric_id
      router.push(`/token/${market.market_identifier}?action=short`);
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
      {marketsError ? (
        <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
          <div className="max-w-7xl mx-auto text-center">
            <p className="text-red-500">Error loading markets: {marketsError}</p>
          </div>
        </div>
      ) : marketsLoading ? (
        <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
          <div className="max-w-7xl mx-auto text-center">
            <p className="text-white">Loading markets... ({markets.length} found so far)</p>
          </div>
        </div>
      ) : marketCardData.length > 0 ? (
        <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
          <div className="max-w-7xl mx-auto">
            <MarketTickerCardContainer
              title="Active Markets"
              cards={marketCardData}
              onCardLongPosition={handleMarketCardLongPosition}
              onCardShortPosition={handleMarketCardShortPosition}
            />
          </div>
        </div>
      ) : (
        <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
          <div className="max-w-7xl mx-auto text-center">
            <p className="text-gray-400">No markets found. Try creating one!</p>
          </div>
        </div>
      )}
      
   
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