'use client';

import React, { useState } from 'react';
import { ProductCard, ProductCardData } from '../ProductCard';
import MarketPreviewModal from './MarketPreviewModal';

// Example of how to integrate ProductCard with MarketPreviewModal
const MarketPreviewModalIntegration: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductCardData | null>(null);

  // Sample product data
  const sampleProduct: ProductCardData = {
    id: '1',
    title: 'Premium Design Templates',
    subtitle: 'Professional templates for modern websites',
    author: 'Design Studio Pro',
    price: 29,
    currency: 'USD',
    imageUrl: '/placeholder-product.jpg',
    imageAlt: 'Premium Design Templates Preview',
  };

  // Mock templates data for the modal
  const mockTemplates = [
    { id: '1', title: 'Template 1', image: null },
    { id: '2', title: 'Template 2', image: null },
    { id: '3', title: 'Template 3', image: null },
    { id: '4', title: 'Template 4', image: null },
    { id: '5', title: 'Template 5', image: null },
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
    // Navigate to product page or perform action
     console.log('Going to product:', selectedProduct?.id);
    handleCloseModal();
  };

  return (
    <div style={{ padding: '20px', maxWidth: '400px' }}>
      <h2>ProductCard + MarketPreviewModal Integration</h2>
      
      <ProductCard
        {...sampleProduct}
        onViewMarket={handleViewMarket}
      />

      {selectedProduct && (
        <MarketPreviewModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          productTitle={selectedProduct.title}
          author={selectedProduct.author}
          price={selectedProduct.price}
          currency={selectedProduct.currency}
          description={selectedProduct.subtitle || 'High-quality design templates perfect for your next project. Created by professional designers with attention to detail and modern aesthetics.'}
          category="Digital Product"
          templates={mockTemplates.map(t => ({
            id: t.id,
            title: t.title,
            image: t.image ?? ''
          }))}
          onGoToProduct={handleGoToProduct}
        />
      )}
    </div>
  );
};

export default MarketPreviewModalIntegration; 