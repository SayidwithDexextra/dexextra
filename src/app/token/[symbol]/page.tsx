'use client';

import { use } from 'react';
import TokenHeader from '@/components/TokenHeader';
import TokenChart from '@/components/TokenChart';
import TradingPanel from '@/components/TradingPanel';
import TokenStats from '@/components/TokenStats';
import { useTokenData } from '@/hooks/useTokenData';

interface TokenPageProps {
  params: Promise<{ symbol: string }>;
}

export default function TokenPage({ params }: TokenPageProps) {
  const { symbol } = use(params);
  const { tokenData, isLoading, error } = useTokenData(symbol);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <div className="animate-pulse text-white">Loading token data...</div>
      </div>
    );
  }

  if (error || !tokenData) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <div className="text-red-500">Error loading token data: {error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <TokenHeader tokenData={tokenData} />
      
      <div className="max-w-[1200px] mx-auto p-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart Section */}
          <div className="lg:col-span-2">
            <TokenChart tokenData={tokenData} />
          </div>
          
          {/* Trading Panel */}
          <div className="lg:col-span-1">
            <TradingPanel tokenData={tokenData} />
          </div>
        </div>
        
        {/* Stats Section */}
        <div className="mt-8">
          <TokenStats tokenData={tokenData} />
        </div>
      </div>
    </div>
  );
} 