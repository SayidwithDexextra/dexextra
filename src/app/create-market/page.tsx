'use client';

import React from 'react';
import { MarketWizard, DeploymentResult } from '@/components/MarketWizard';
import CryptoMarketTicker from '@/components/CryptoMarketTicker';
import { AIMarketCreationModal } from '@/components/AIMarketCreationModal';

export default function CreateMarket() {
  const handleComplete = (result: DeploymentResult) => {
    console.log('Orderbook Market deployed successfully:', result);
    // Could redirect to a success page or market detail page
    // router.push(`/markets/${result.marketId}`);
  };

  const handleCancel = () => {
    console.log('Market creation cancelled');
    // Could redirect back to markets listing
    // router.push('/markets');
  };

  const handleLearnMore = () => {
    window.open('/docs/market-creation-guide', '_blank');
  };

  return (
    <>
      <div className="w-full overflow-hidden">
        <CryptoMarketTicker />
      </div>

      <MarketWizard 
        onSuccess={handleComplete}
        onError={handleCancel}
      />

      <AIMarketCreationModal
        title="AI Market Creation Assistant"
        description="Get help creating your market with our AI assistant. We'll guide you through the process and help you optimize your market parameters based on historical data and market analysis."
        codeExample={{
          language: "json",
          code: `{
  "marketConfig": {
    "name": "BTC Volatility Index",
    "type": "perpetual",
    "asset": "BTC-USD",
    "leverage": 20,
    "initialLiquidity": "100000",
    "tradingFee": "0.1%",
    "maintenanceMargin": "2%"
  }
}`
        }}
        onLearnMore={handleLearnMore}
      />
    </>
  );
}