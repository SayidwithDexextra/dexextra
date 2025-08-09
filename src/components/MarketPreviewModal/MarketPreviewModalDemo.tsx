'use client';

import React, { useState } from 'react';
import MarketPreviewModal from './MarketPreviewModal';
import ErrorBoundary from './ErrorBoundary';
import { PreviewTemplate } from './types';

const MarketPreviewModalDemo: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const sampleTemplates: PreviewTemplate[] = [
    {
      id: '1',
      title: 'Portfolio Template',
      image: '',
      category: 'Portfolio'
    },
    {
      id: '2',
      title: 'Business Landing',
      image: '',
      category: 'Business'
    },
    {
      id: '3',
      title: 'Creative Agency',
      image: '',
      category: 'Agency'
    },
    {
      id: '4',
      title: 'E-commerce Store',
      image: '',
      category: 'E-commerce'
    },
    {
      id: '5',
      title: 'Blog Template',
      image: '',
      category: 'Blog'
    },
    {
      id: '6',
      title: 'SaaS Platform',
      image: '',
      category: 'SaaS'
    }
  ];

  const handleGoToProduct = () => {
    try {
       console.log('Navigating to product page...');
      // In a real app, this would navigate to the product page
      alert('Navigating to product page!');
    } catch (error) {
      console.error('Error in handleGoToProduct:', error);
    }
  };

  const demoButtonStyle: React.CSSProperties = {
    backgroundColor: '#FF8A65',
    color: '#FFFFFF',
    padding: '16px 32px',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer',
    margin: '20px',
    transition: 'all 0.2s ease',
  };

  return (
    <div style={{ padding: '40px', textAlign: 'center' }}>
      <h2 style={{ marginBottom: '20px', color: '#1A1A1A' }}>
        Market Preview Modal Demo
      </h2>
      
      <p style={{ color: '#666666', marginBottom: '20px' }}>
        Click the button below to see the modal <strong>slide up from the bottom</strong> with smooth animations.
      </p>
      
             <div style={{ 
         background: '#f8f9fa', 
         padding: '16px', 
         borderRadius: '8px', 
         marginBottom: '30px',
         fontSize: '14px',
         color: '#666666'
       }}>
         <strong>Fast & Smooth Full-Height Animation:</strong><br/>
         🎬 Quick slide-up from bottom (0.8 seconds duration)<br/>
         📺 Takes 80% of screen height with full-width coverage<br/>
         🎨 Content fades in after 0.1s delay over 0.3 seconds<br/>
         📱 Drag handle appears after 0.2s delay<br/>
         ⚡ Smooth cubic-bezier transitions with responsive timing
       </div>

      <button
        style={demoButtonStyle}
        onClick={() => {
          try {
            setIsModalOpen(true);
          } catch (error) {
            console.error('Error opening modal:', error);
          }
        }}
        onMouseOver={(e) => {
          try {
            e.currentTarget.style.backgroundColor = '#FF7043';
            e.currentTarget.style.transform = 'translateY(-1px)';
          } catch (error) {
            console.warn('Error in button hover:', error);
          }
        }}
        onMouseOut={(e) => {
          try {
            e.currentTarget.style.backgroundColor = '#FF8A65';
            e.currentTarget.style.transform = 'translateY(0)';
          } catch (error) {
            console.warn('Error in button hover out:', error);
          }
        }}
      >
        Open Market Preview
      </button>

      <ErrorBoundary>
        <MarketPreviewModal
          isOpen={isModalOpen}
          onClose={() => {
            try {
              setIsModalOpen(false);
            } catch (error) {
              console.error('Error closing modal:', error);
            }
          }}
          productTitle="Unlimited Access • Framer Template Bundle"
          author="Bryn Taylor"
          price={249}
          currency="$"
          description="Get unlimited access to all of my current and future Framer templates. A lifetime pass to all my current and future Framer templates. I've built templates for every category: portfolios, blogs, SaaS, events, directories and more. Pick a site, remix in a click, and ship a high-performing site in minutes. My Framer templates are some of the best-performing on the platform."
          category="Digital Product"
          templates={sampleTemplates}
          onGoToProduct={handleGoToProduct}
        />
      </ErrorBoundary>
    </div>
  );
};

export default MarketPreviewModalDemo; 