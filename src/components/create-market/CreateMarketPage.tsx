'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
const CreateMarketFormClient = dynamic(() => import('./CreateMarketForm').then(m => m.CreateMarketForm), { ssr: false });
import type { MarketFormData } from '@/hooks/useCreateMarketForm';
import { useRouter } from 'next/navigation';
import { DeploymentProgressPanel, type ProgressStep, type StepStatus } from './DeploymentProgressPanel';
import { ErrorModal } from '@/components/StatusModals';
// Archive snapshot is executed via server proxy to avoid browser CORS
import { createMarketOnChain } from '@/lib/createMarketOnChain';
import { ethers } from 'ethers';
import { ProgressOverlay } from './ProgressOverlay';

export const CreateMarketPage = () => {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const initialSteps: ProgressStep[] = [
    { id: 'tx', title: 'Send Transaction', description: 'Creating market on-chain (server)', status: 'pending' },
    { id: 'confirm', title: 'Confirm & Parse', description: 'Waiting for confirmations (server)', status: 'pending' },
    { id: 'roles', title: 'Grant Admin Roles', description: 'Authorizing roles (server)', status: 'pending' },
    { id: 'save', title: 'Save Market', description: 'Persisting market metadata (server)', status: 'pending' },
  ];

  const [steps, setSteps] = useState<ProgressStep[]>(initialSteps);
  const [showProgress, setShowProgress] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [errorModal, setErrorModal] = useState<{ isOpen: boolean; title: string; message: string }>({ isOpen: false, title: '', message: '' });

  const resetSteps = () => setSteps(initialSteps.map(s => ({ ...s, status: 'pending' })));
  const setStepStatus = (id: string, status: StepStatus) =>
    setSteps(prev => prev.map(s => (s.id === id ? { ...s, status } : s)));
  const markActive = (id: string) => setStepStatus(id, 'active');
  const markDone = (id: string) => setStepStatus(id, 'done');
  const markError = (id: string) => setStepStatus(id, 'error');

  

  const isUserRejected = (_e: any): boolean => false;

  // Vertical carousel configuration mapped to deployment pipeline
  const carouselMessages = ['Deploying contract...', 'Setting up market...', 'Registering oracle feed...'];
  const trackedOrder: string[] = ['tx', 'roles', 'save']; // map steps to carousel sequence
  const completedTrackedCount = steps.filter(s => trackedOrder.includes(s.id) && s.status === 'done').length;
  const activeTrackedIndex = steps.findIndex(s => trackedOrder.includes(s.id) && s.status === 'active' && trackedOrder.includes(s.id));
  const activeCarouselIndex = activeTrackedIndex >= 0 ? trackedOrder.indexOf(steps[activeTrackedIndex].id) : Math.min(completedTrackedCount, carouselMessages.length - 1);
  const percentComplete = Math.min(
    100,
    Math.round(((completedTrackedCount + (activeTrackedIndex >= 0 ? 0.35 : 0)) / Math.max(carouselMessages.length, 1)) * 100)
  );

  const beginFadeOutToToken = (targetSymbol: string) => {
    setIsFadingOut(true);
    setTimeout(() => {
      router.push(`/token/${encodeURIComponent(targetSymbol)}`);
    }, 450);
  };

  const handleCreateMarket = async (marketData: MarketFormData) => {
    setIsLoading(true);
    setShowProgress(true);
    setIsFadingOut(false);
    resetSteps();
    try {
      // Params
      const symbol = marketData.symbol;
      const metricUrl = marketData.metricUrl;
      const dataSource = marketData.dataSource || 'User Provided';
      const tags = marketData.tags || [];
      const sourceLocator = (marketData as any).sourceLocator || null;

      // Optional Wayback Machine snapshot (skip when debug flag is set)
      const skipArchive = Boolean((marketData as any).skipArchive);
      if (!skipArchive) {
        const metricUrlToArchive = typeof metricUrl === 'string' ? metricUrl.trim() : '';
        if (metricUrlToArchive) {
          void fetch('/api/archives/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: metricUrlToArchive,
              captureOutlinks: false,
              captureScreenshot: true,
              skipIfRecentlyArchived: true,
            }),
          })
            .then(async (r) => {
              const data = await r.json().catch(() => null);
              if (r.ok && data?.success) {
                console.info('Wayback snapshot created', {
                  url: metricUrlToArchive,
                  waybackUrl: data?.waybackUrl,
                  timestamp: data?.timestamp,
                });
              } else {
                console.warn('Wayback snapshot failed', {
                  url: metricUrlToArchive,
                  status: r.status,
                  error: data?.error,
                });
              }
            })
            .catch(err => {
              console.warn('Wayback snapshot error', {
                url: metricUrlToArchive,
                error: (err as any)?.message || String(err),
              });
            });
        }
      } else {
        console.info('[create-market] Skipping Wayback snapshot due to debug flag');
      }

      // Create market on chain using connected wallet (mimics new-create-market.js)
      markActive('tx');
      const { orderBook, marketId, chainId, transactionHash } = await createMarketOnChain({
        symbol,
        metricUrl,
        startPrice: String(marketData.startPrice || '1'),
        dataSource,
        tags,
      });
      markDone('tx');

      // Confirm step completed as part of the awaited tx above
      markDone('confirm');

      // Grant roles on CoreVault via server-admin endpoint (user is not necessarily admin)
      markActive('roles');
      {
        const grant = await fetch('/api/markets/grant-roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderBook }),
        });
        if (!grant.ok) {
          const gErr = await grant.json().catch(() => ({} as any));
          throw new Error(gErr?.error || 'Role grant failed');
        }
        markDone('roles');
      }

      // Persist market metadata via API (Supabase upsert, verification)
      markActive('save');
      {
        const networkName =
          (process.env as any).NEXT_PUBLIC_NETWORK_NAME ||
          (globalThis as any).process?.env?.NEXT_PUBLIC_NETWORK_NAME ||
          'hyperliquid';
        const saveRes = await fetch('/api/markets/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            marketIdentifier: symbol,
            symbol,
            name: `${(symbol.split('-')[0] || symbol).toUpperCase()} Futures`,
            description: `OrderBook market for ${symbol}`,
            category: Array.isArray(tags) && tags.length ? tags[0] : 'CUSTOM',
            decimals: 6,
            minimumOrderSize: Number(process.env.DEFAULT_MINIMUM_ORDER_SIZE || 0.1),
            settlementDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
            tradingEndDate: null,
            dataRequestWindowSeconds: Number(process.env.DEFAULT_DATA_REQUEST_WINDOW_SECONDS || 3600),
            autoSettle: true,
            oracleProvider: null,
            initialOrder: {
              metricUrl,
              startPrice: String(marketData.startPrice || '1'),
              dataSource,
              tags,
            },
            chainId,
            networkName,
            creatorWalletAddress: undefined,
            marketAddress: orderBook,
            marketIdBytes32: marketId,
            transactionHash,
            blockNumber: null,
            gasUsed: null,
            aiSourceLocator: sourceLocator,
            iconImageUrl: (marketData as any).iconUrl ? String((marketData as any).iconUrl).trim() : null,
          }),
        });
        if (!saveRes.ok) {
          const sErr = await saveRes.json().catch(() => ({} as any));
          throw new Error(sErr?.error || 'Save failed');
        }
        markDone('save');
      }

      // Fade out progress overlay gracefully before navigating
      const targetSymbol = String(symbol || '').toUpperCase();
      beginFadeOutToToken(targetSymbol);
    } catch (error) {
      console.error('Error creating market:', error);
      // Mark the first active step as error for visual feedback
      const active = steps.find(s => s.status === 'active');
      if (active) markError(active.id);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-screen flex items-center bg-[#0F0F0F]">
      <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Cancel/Error modal */}
        <ErrorModal
          isOpen={errorModal.isOpen}
          onClose={() => { setErrorModal({ isOpen: false, title: '', message: '' }); setShowProgress(false); }}
          title={errorModal.title}
          message={errorModal.message}
          buttonText="Back to Form"
          autoClose={false}
        />
        {!showProgress && (
          <>
            {/* Header Card */}
            <div className="group bg-[#0F0F0F] hover:bg-[#101010] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 mb-6">
              <div className="flex items-center justify-between p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
                    <h2 className="text-white text-lg font-medium truncate">Create New Market</h2>
                  </div>
                  <div className="mt-1 text-[11px] text-[#808080] truncate">
                    Configure market parameters and resolve data sources with AI
                  </div>
                </div>
              </div>
              <div className="h-px bg-gradient-to-r from-blue-500/40 via-transparent to-transparent" />
            </div>

            {/* Form (client-only to avoid hydration mismatches from extensions/dynamic attrs) */}
            <CreateMarketFormClient onSubmit={handleCreateMarket} isLoading={isLoading} />
          </>
        )}

        {/* High-end progress overlay */}
        {showProgress && (
          <ProgressOverlay
            visible={true}
            isFadingOut={isFadingOut}
            messages={carouselMessages}
            activeIndex={activeCarouselIndex}
            percentComplete={percentComplete}
            title="Deployment Pipeline"
            subtitle="Initializing market and registering oracle"
          />
        )}
      </div>
    </div>
  );
};