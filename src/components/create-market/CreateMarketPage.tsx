'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
const CreateMarketFormClient = dynamic(() => import('./CreateMarketForm').then(m => m.CreateMarketForm), { ssr: false });
import type { MarketFormData } from '@/hooks/useCreateMarketForm';
import { useRouter } from 'next/navigation';
import { DeploymentProgressPanel, type ProgressStep, type StepStatus } from './DeploymentProgressPanel';
import { ErrorModal } from '@/components/StatusModals';
// Archive snapshot is executed via server proxy to avoid browser CORS

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
  const [errorModal, setErrorModal] = useState<{ isOpen: boolean; title: string; message: string }>({ isOpen: false, title: '', message: '' });

  const resetSteps = () => setSteps(initialSteps.map(s => ({ ...s, status: 'pending' })));
  const setStepStatus = (id: string, status: StepStatus) =>
    setSteps(prev => prev.map(s => (s.id === id ? { ...s, status } : s)));
  const markActive = (id: string) => setStepStatus(id, 'active');
  const markDone = (id: string) => setStepStatus(id, 'done');
  const markError = (id: string) => setStepStatus(id, 'error');

  

  const isUserRejected = (_e: any): boolean => false;

  const handleCreateMarket = async (marketData: MarketFormData) => {
    setIsLoading(true);
    setShowProgress(true);
    resetSteps();
    try {
      // Params
      const symbol = marketData.symbol;
      const metricUrl = marketData.metricUrl;
      const dataSource = marketData.dataSource || 'User Provided';
      const tags = marketData.tags || [];
      const sourceLocator = (marketData as any).sourceLocator || null;

      // Best-effort Wayback Machine snapshot of the metric/source URL.
      // This runs in the background and never blocks market creation.
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

      // Send to server for fully automated deploy from Deployer
      markActive('tx');
      const resp = await fetch('/api/markets/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          metricUrl,
          startPrice: String(marketData.startPrice || '1'),
          dataSource,
          tags,
          aiSourceLocator: sourceLocator,
          iconImageUrl: (marketData as any).iconUrl ? String((marketData as any).iconUrl).trim() : null,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({} as any));
        throw new Error(err?.error || 'Server create failed');
      }
      const { orderBook, marketId } = await resp.json();
      markDone('tx');

      // Server performs confirmation, roles, and saving. Reflect in UI.
      markDone('confirm');
      markDone('roles');
      markDone('save');

      const targetSymbol = String(symbol || '').toUpperCase();
      router.push(`/token/${encodeURIComponent(targetSymbol)}`);
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

        {showProgress && (
          <div className="flex items-center justify-center">
            <div className="w-full max-w-2xl">
              <DeploymentProgressPanel visible={true} steps={steps} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};