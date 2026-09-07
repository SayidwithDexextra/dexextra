'use client';

import React, { Suspense } from 'react';
import { InteractiveMarketCreation } from '@/components/create-market-v2/InteractiveMarketCreation';
import CryptoMarketTicker from '@/components/CryptoMarketTicker';

/**
 * DEV-ONLY design preview of the interactive market creation flow.
 *
 * Renders the exact same UX (prompt → source → name/description → icon →
 * market-type + legs → review) but runs InteractiveMarketCreation in
 * `previewMode`, so "Create market" only simulates the deployment overlay and
 * never hits the network, signs, pins to IPFS, deploys on-chain, or navigates.
 *
 * Route: /dev/create-market
 */
export default function DevCreateMarketPreviewRoute() {
  return (
    <>
      <div className="w-full overflow-hidden">
        <CryptoMarketTicker />
      </div>

      <div className="relative min-h-[calc(100vh-152px)] w-full bg-[#1a1a1a] text-white">
        {/* Preview banner */}
        <div className="sticky top-0 z-20 w-full border-b border-amber-500/30 bg-amber-500/[0.08] backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:px-8">
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                Dev Preview
              </span>
              <span className="text-[12px] text-amber-200/80">
                Design walkthrough only — no market is created, nothing is signed, deployed, or pinned.
              </span>
            </div>
            <a
              href="/new-market"
              className="text-[12px] text-amber-200/70 underline underline-offset-2 hover:text-amber-100"
            >
              Real flow →
            </a>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-5xl px-4 pb-8 pt-10 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center text-center">
            <h2 className="text-xl font-normal text-white">What do you want to create today?</h2>
            <div className="mt-8 w-full sm:mt-10">
              <div className="flex justify-center">
                <Suspense>
                  <InteractiveMarketCreation previewMode />
                </Suspense>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
