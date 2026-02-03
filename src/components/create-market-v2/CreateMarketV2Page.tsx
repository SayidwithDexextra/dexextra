'use client';

import React from 'react';
import { InteractiveMarketCreation } from './InteractiveMarketCreation';
import { GenerateTiles } from './GenerateTiles';
import { LatestFeatures } from './LatestFeatures';
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
        <div className="relative min-h-[calc(100vh-144px)] w-full bg-[#1a1a1a] text-white">
          <div className="relative mx-auto w-full max-w-5xl px-4 pt-24 pb-8 sm:px-6 sm:pt-32 lg:px-8 lg:pt-40">
            <div className="flex flex-col items-center text-center">
              <h2 className="text-xl font-normal text-white text-center">
                What do you want to create today?
              </h2>
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
      <div className="relative min-h-[calc(100vh-144px)] w-full bg-[#1a1a1a] text-white">
        <div className="relative mx-auto w-full max-w-5xl px-4 pt-24 pb-8 sm:px-6 sm:pt-32 lg:px-8 lg:pt-40">
        {/* Main content - Fixed position from top */}
        <div className="flex flex-col items-center text-center">
          <h2 className="text-xl font-normal text-white text-center">
            What do you want to create today?
          </h2>
          <div className="mt-8 w-full sm:mt-10">
            <div className="flex justify-center">
              <InteractiveMarketCreation />
            </div>
          </div>
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

