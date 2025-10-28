import { useState } from 'react';
import { CreateMarketForm } from './CreateMarketForm';

export const CreateMarketPage = () => {
  const [isLoading, setIsLoading] = useState(false);

  const handleCreateMarket = async (marketData: any) => {
    setIsLoading(true);
    try {
      // Here you would integrate with your contract interaction logic
      console.log('Creating market with data:', marketData);
      // Example delay to simulate contract interaction
      await new Promise(resolve => setTimeout(resolve, 2000));
      // On success you might want to redirect or show a success message
    } catch (error) {
      console.error('Error creating market:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F0F0F] py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-8">
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

