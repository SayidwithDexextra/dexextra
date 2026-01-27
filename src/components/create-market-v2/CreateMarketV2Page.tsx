'use client';

import React from 'react';
import { PromptComposer } from './PromptComposer';
import { GenerateTiles } from './GenerateTiles';
import { LatestFeatures } from './LatestFeatures';
import { MarketExamplesCarousel } from './MarketExamplesCarousel';
import CryptoMarketTicker from '@/components/CryptoMarketTicker';

export function CreateMarketV2Page() {
  const [isMounted, setIsMounted] = React.useState(false);

  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return (
      <>
        <div className="w-full overflow-hidden">
          <CryptoMarketTicker />
        </div>
        <div className="relative flex min-h-[calc(100vh-144px)] w-full items-center justify-center bg-[#1a1a1a] text-white">
          <div className="relative w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center text-center">
              <h1 className="text-xl font-medium text-white sm:text-2xl">
                What do you want to create today?
              </h1>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="w-full overflow-hidden">
        <CryptoMarketTicker />
      </div>
      <div className="relative flex min-h-[calc(100vh-144px)] w-full items-center justify-center bg-[#1a1a1a] text-white">
        <div className="relative w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Main content - Vertically and horizontally centered */}
        <div className="flex flex-col items-center text-center">
          <h1 className="text-xl font-medium text-white sm:text-2xl">
            What do you want to create today?
          </h1>
          <div className="mt-8 w-full sm:mt-10">
            <div className="flex justify-center">
              <PromptComposer />
            </div>
          </div>

          {/* Market examples carousel */}
          <MarketExamplesCarousel />
        </div>

        {/* Lower content - commented out for now */}
        {/* <div className="mt-32 grid gap-10 lg:grid-cols-[420px_1fr] lg:items-start">
          <div>
            <div className="text-base font-medium text-white/90">Generate</div>
            <div className="mt-4">
              <GenerateTiles />
            </div>
          </div>

          <div className="lg:pl-6">
            <LatestFeatures />
          </div>
        </div> */}
        </div>
      </div>
    </>
  );
}

