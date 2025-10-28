'use client';

import { useState } from 'react';
import { ethers } from 'ethers';
import { CreateMarketForm, MarketFormData } from './CreateMarketForm';
import { useRouter } from 'next/navigation';

export const CreateMarketPage = () => {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleCreateMarket = async (marketData: MarketFormData) => {
    setIsLoading(true);
    try {
      // For now, we'll just simulate the contract interaction
      await new Promise(resolve => setTimeout(resolve, 2000));
      router.push('/markets');
    } catch (error) {
      console.error('Error creating market:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-screen flex items-center bg-[#0F0F0F]">
      <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-medium text-white">Create New Market</h2>
        </div>
        <CreateMarketForm
          onSubmit={handleCreateMarket}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
};