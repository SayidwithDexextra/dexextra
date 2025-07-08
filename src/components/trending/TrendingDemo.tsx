'use client';

import React from 'react';
import { TrendingMarkets } from './TrendingMarkets';
import { NFTGraphic } from './NFTGraphics';
import { useMockMarketData } from './useMockAuctionData';
import { MarketData } from './types';

interface TrendingDemoProps {
  title?: string;
  showControls?: boolean;
}

export const TrendingDemo: React.FC<TrendingDemoProps> = ({ 
  title = "Trending markets",
  showControls = false 
}) => {
  const { markets, loading, refreshData } = useMockMarketData({ 
    count: 4, 
    includeClickHandlers: true 
  });

  // Add NFT graphics to market data
  const marketsWithGraphics: MarketData[] = markets.map(market => ({
    ...market,
    nftGraphic: market.nftGraphicType ? (
      <NFTGraphic type={market.nftGraphicType} />
    ) : undefined
  }));

  if (loading) {
    return (
      <div className="trending-loading">
        <div className="loading-container">
          <div className="loading-spinner" />
          <p>Loading trending markets...</p>
        </div>
        
        <style jsx>{`
          .trending-loading {
            background: #0F0F0F;
            padding: 64px 24px;
            min-height: 300px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          
          .loading-container {
            text-align: center;
            color: #FFFFFF;
          }
          
          .loading-spinner {
            width: 40px;
            height: 40px;
            border: 3px solid rgba(255, 255, 255, 0.1);
            border-top: 3px solid #8B5CF6;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
          }
          
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          
          p {
            margin: 0;
            font-size: 16px;
            opacity: 0.8;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="trending-demo">
      {showControls && (
        <div className="demo-controls">
          <button onClick={refreshData} className="refresh-btn">
            🔄 Refresh Data
          </button>
          <span className="market-count">
            {markets.length} markets loaded
          </span>
        </div>
      )}
      
      <TrendingMarkets 
        markets={marketsWithGraphics}
        title={title}
      />

      <style jsx>{`
        .trending-demo {
          width: 100%;
        }
        
        .demo-controls {
          background: #0F0F0F;
          padding: 16px 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .refresh-btn {
          background: linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%);
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: transform 0.2s ease-in-out;
        }
        
        .refresh-btn:hover {
          transform: translateY(-2px);
        }
        
        .market-count {
          color: #9CA3AF;
          font-size: 14px;
        }
      `}</style>
    </div>
  );
};

// Example usage component for documentation
export const TrendingUsageExample: React.FC = () => {
  return (
    <div className="usage-example">
      <h3>Basic Usage</h3>
      <TrendingDemo />
      
      <h3>With Controls</h3>
      <TrendingDemo 
        title="Featured Auctions" 
        showControls={true} 
      />

      <style jsx>{`
        .usage-example {
          padding: 20px;
          background: #1a1a1a;
        }
        
        h3 {
          color: #FFFFFF;
          margin: 32px 0 16px 0;
          font-size: 18px;
          font-weight: 600;
        }
        
        h3:first-child {
          margin-top: 0;
        }
      `}</style>
    </div>
  );
}; 