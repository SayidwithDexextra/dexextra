'use client';

import React from 'react';
import { MarketWizard, DeploymentResult } from '@/components/MarketWizard';
import CryptoMarketTicker from '@/components/CryptoMarketTicker';

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

  return (
    <>
    <div className="w-full overflow-hidden">
        <CryptoMarketTicker />
      </div>

    <MarketWizard 
      onSuccess={handleComplete}
      onError={handleCancel}
    />
    </>
  );
} 