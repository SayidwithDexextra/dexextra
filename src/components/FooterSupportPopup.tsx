'use client';

import React, { useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWalkthrough } from '@/contexts/WalkthroughContext';
import { makeGetStartedWalkthrough } from '@/walkthroughs/getStarted';
import { depositWalkthrough } from '@/walkthroughs/deposit';
import { tokenPageWalkthrough } from '@/walkthroughs/tokenPage';
import { useWallet } from '@/hooks/useWallet';

type FooterSupportPopupProps = {
  isOpen: boolean;
  onClose: () => void;
};

type TourItem = {
  id: string;
  title: string;
  description: string;
  onStart: () => void;
};

export function FooterSupportPopup({ isOpen, onClose }: FooterSupportPopupProps) {
  const walkthrough = useWalkthrough();
  const { walletData } = useWallet();

  // Close on escape key (matches watchlist behavior)
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const startTour = useCallback(
    (def: any) => {
      onClose();
      walkthrough.start(def, { force: true });
    },
    [onClose, walkthrough]
  );

  const startTokenPageTour = useCallback(() => {
    const route = '/token/BITCOIN';
    const def = {
      ...tokenPageWalkthrough,
      steps: tokenPageWalkthrough.steps.map((s: any) => ({ ...s, route })),
    };
    startTour(def);
  }, [startTour]);

  const tours: TourItem[] = useMemo(() => {
    return [
      {
        id: 'get-started',
        title: 'Get Started',
        description: 'A quick intro to the core parts of the platform UI.',
        onStart: () => startTour(makeGetStartedWalkthrough({ includeWalletConnectSteps: !walletData.isConnected })),
      },
      {
        id: 'deposit',
        title: 'Deposit collateral',
        description: 'Walk through Arbitrum → USDC collateral → deposit flow.',
        onStart: () => startTour(depositWalkthrough),
      },
      {
        id: 'token-page',
        title: 'Token page tour',
        description: "We'll open the BITCOIN token page and walk through the chart, activity, trading panel, and metric panels.",
        onStart: () => startTokenPageTour(),
      },
    ];
  }, [startTokenPageTour, startTour, walletData.isConnected]);

  if (!isOpen) return null;

  return (
    <div
      className="absolute bottom-full right-0 mb-3.5 z-50"
      style={{
        minWidth: '320px',
        maxWidth: '360px',
      }}
    >
      <div className="bg-[#0F0F0F] rounded-md border border-[#222222] overflow-hidden shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-2.5 border-b border-[#1A1A1A]">
          <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
            Product tours
          </h4>
          <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
            {tours.length}
          </div>
        </div>

        {/* Content */}
        <div className="p-1.5">
          <div className="space-y-0.5">
            {tours.map((t) => {
              return (
                <button
                  key={t.id}
                  onClick={() => t.onStart()}
                  title={t.description}
                  className={[
                    'group w-full rounded-md transition-all duration-200 text-left',
                    'bg-[#0F0F0F] hover:bg-[#1A1A1A]',
                  ].join(' ')}
                >
                  <div className="flex items-start gap-2 p-2.5">
                    <div
                      className={[
                        'w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5',
                        'bg-green-400',
                      ].join(' ')}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[11px] font-medium text-white truncate">
                          {t.title}
                        </span>
                      </div>
                      <div className="text-[10px] text-[#808080] leading-snug mt-0.5">
                        {t.description}
                      </div>
                    </div>
                    <svg
                      className="w-3 h-3 text-[#404040] group-hover:text-[#606060] transition-colors duration-200 flex-shrink-0 mt-0.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer row */}
        <div className="p-1.5 border-t border-[#1A1A1A]">
          <Link
            href="/support"
            onClick={onClose}
            className="w-full flex items-center justify-center gap-1.5 p-2 rounded-md text-[11px] font-medium text-[#808080] hover:text-white bg-[#0F0F0F] hover:bg-[#1A1A1A] border border-[#222222] hover:border-[#333333] transition-all duration-200"
          >
            Support center
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}
