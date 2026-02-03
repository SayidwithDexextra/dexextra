'use client';

import { useEffect, useRef, useState } from 'react';
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
import { useDeploymentOverlay } from '@/contexts/DeploymentOverlayContext';
import { usePusher } from '@/lib/pusher-client';
import { getMetricAIWorkerBaseUrl, runMetricAIWithPolling } from '@/lib/metricAiWorker';

export const CreateMarketPage = () => {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const deploymentOverlay = useDeploymentOverlay();
  const pusher = usePusher();
  const [timerStart, setTimerStart] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [showTimer, setShowTimer] = useState<boolean>(false);
  const intervalRef = useRef<number | null>(null);

  // Only show timer on localhost
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      setShowTimer(host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost'));
    }
  }, []);

  const formatElapsed = (ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60).toString().padStart(2, '0');
    const s = (total % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const gaslessEnabled = String(
    (process.env as any).NEXT_PUBLIC_GASLESS_CREATE_ENABLED ||
    (globalThis as any)?.process?.env?.NEXT_PUBLIC_GASLESS_CREATE_ENABLED ||
    ''
  ).toLowerCase() === 'true';

  // Detailed pipeline messages reflecting backend-oriented steps
  const pipelineMessages: string[] = gaslessEnabled
    ? [
        'Fetch facet cut configuration',      // 0
        'Build initializer and selectors',    // 1
        'Prepare meta-create',                // 2 (meta_prepare / factory_static_call_meta)
        'Sign meta request',                  // 3 (meta_signature)
        'Submit to relayer',                  // 4 (relayer_submit / factory_send_tx_meta)
        'Wait for confirmation',              // 5 (factory_confirm_meta*)
        'Parse FuturesMarketCreated event',   // 6 (parse_event)
        'Verify required selectors',          // 7 (ensure_selectors)
        'Patch missing selectors if needed',  // 8 (ensure_selectors_missing/diamond_cut)
        'Attach session registry',            // 9 (attach_session_registry)
        'Grant admin roles on CoreVault',     // 10 (grant_roles)
        'Saving market metadata',               // 11 (save_market)
        'Finalize deployment',                // 12
      ]
    : [
        'Fetch facet cut configuration',      // 0
        'Build initializer and selectors',    // 1
        'Preflight validation (static call)', // 2
        'Submit create transaction',          // 3
        'Wait for confirmation',              // 4
        'Parse FuturesMarketCreated event',   // 5
        'Verify required selectors',          // 6
        'Patch missing selectors if needed',  // 7
        'Grant admin roles on CoreVault',     // 8
        'Saving market metadata',               // 9
        'Finalize deployment',                // 10
      ];
  const stepIndexMap: Record<string, number> = {
    // Common client steps
    cut_fetch: 0,
    cut_build: 1,
    // Legacy
    static_call: 2,
    send_tx: 3,
    confirm: gaslessEnabled ? 5 : 4,
    parse_event: gaslessEnabled ? 6 : 5,
    verify_selectors: gaslessEnabled ? 7 : 6,
    diamond_cut: gaslessEnabled ? 8 : 7,
    // Gasless/client-only
    meta_prepare: 2,
    meta_signature: 3,
    relayer_submit: 4,
    // Server (gasless) mapped steps
    facet_cut_built: 1,
    factory_static_call_meta: 2,
    factory_static_call: 2,
    factory_send_tx_meta: 4,
    factory_send_tx: 3,
    factory_send_tx_meta_sent: 4,
    factory_send_tx_sent: 3,
    factory_confirm_meta: 5,
    factory_confirm_meta_mined: 5,
    factory_confirm: gaslessEnabled ? 5 : 4,
    factory_confirm_mined: gaslessEnabled ? 5 : 4,
    ensure_selectors: 7,
    ensure_selectors_missing: 8,
    ensure_selectors_diamondCut_sent: 8,
    ensure_selectors_diamondCut_mined: 8,
    attach_session_registry: 9,
    attach_session_registry_sent: 9,
    attach_session_registry_mined: 9,
    grant_roles: 10,
    grant_ORDERBOOK_ROLE_sent: 10,
    grant_ORDERBOOK_ROLE_mined: 10,
    grant_SETTLEMENT_ROLE_sent: 10,
    grant_SETTLEMENT_ROLE_mined: 10,
    save_market: 11,
  };
  const updateOverlayIndex = (idx: number) => {
    const clamped = Math.max(0, Math.min(idx, pipelineMessages.length - 1));
    const percent = Math.min(100, Math.round(((clamped + 1) / Math.max(pipelineMessages.length, 1)) * 100));
    deploymentOverlay.update({ activeIndex: clamped, percentComplete: percent });
  };

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

  const runInspect = async (orderBook: string | null | undefined, pipelineId: string | null) => {
    if (!orderBook) return;
    try {
      await fetch('/api/markets/inspect-gasless', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderBook, autoFix: false, pipelineId }),
      });
    } catch {
      // best-effort; do not block UX
    }
  };

  

  const isUserRejected = (e: any): boolean => {
    if (!e) return false;
    // Common shapes across EIP-1193, ethers v5/v6, wagmi/viem
    const code = (e as any)?.code ?? (e as any)?.error?.code ?? (e as any)?.cause?.code;
    const name = (e as any)?.name ?? (e as any)?.cause?.name ?? (e as any)?.error?.name;
    const rawMessage =
      (e as any)?.shortMessage ||
      (e as any)?.message ||
      (e as any)?.error?.message ||
      (e as any)?.cause?.message ||
      '';
    const msg = String(rawMessage || '').toLowerCase();
    return (
      code === 4001 || // EIP-1193 user rejected
      code === 'ACTION_REJECTED' || // ethers v6
      name === 'UserRejectedRequestError' || // wagmi/viem
      msg.includes('user rejected') ||
      msg.includes('user denied') ||
      msg.includes('rejected the request') ||
      msg.includes('transaction was rejected') ||
      msg.includes('request rejected') ||
      msg.includes('action rejected')
    );
  };

  const beginFadeOutToToken = (targetSymbol: string) => {
    setIsFadingOut(true);
    setTimeout(() => {
      router.push(`/token/${encodeURIComponent(targetSymbol)}`);
    }, 450);
  };

  const handleCreateMarket = async (marketData: MarketFormData) => {
    setIsLoading(true);
    // Use global overlay instead of local page overlay
    setShowProgress(false);
    setIsFadingOut(false);
    resetSteps();
    let unsubscribePusher: (() => void) | null = null;
    try {
      // Start local timer
      setTimerStart(Date.now());
      setElapsedMs(0);
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      intervalRef.current = window.setInterval(() => {
        setElapsedMs(prev => {
          if (timerStart == null) return 0;
          return Date.now() - timerStart;
        });
      }, 250);

      const INITIAL_SPLASH_MS = 1200;
      // Params
      const symbol = marketData.symbol;
      const metricUrl = marketData.metricUrl;
      const dataSource = marketData.dataSource || 'User Provided';
      const tags = marketData.tags || [];
      let sourceLocator = (marketData as any).sourceLocator || null;
      const skipMetricWorker = Boolean((marketData as any).skipMetricWorker);
      // Attempt to prefill startPrice using background worker (non-blocking with timeout)
      try {
        const workerUrl = getMetricAIWorkerBaseUrl();
        if (!skipMetricWorker && workerUrl && typeof metricUrl === 'string' && metricUrl.trim()) {
          const ai = await runMetricAIWithPolling(
            {
              metric: String(symbol || '').toUpperCase(),
              urls: [metricUrl.trim()],
              related_market_identifier: String(symbol || '').toUpperCase(),
              context: 'create',
            },
            { intervalMs: 2000, timeoutMs: 60000 } // Increased for screenshot + vision analysis
          );
          if (ai) {
            const suggested = ai.asset_price_suggestion || ai.value;
            if (suggested && !Number.isNaN(Number(suggested))) {
              (marketData as any).startPrice = String(suggested);
            }
            if (!sourceLocator && Array.isArray(ai.sources) && ai.sources.length > 0) {
              const primary = ai.sources[0];
              if (primary && primary.url) {
                sourceLocator = { url: primary.url };
              }
            }
          }
        } else if (skipMetricWorker) {
          try { console.info('[create-market][debug] Skipping metric worker due to debug flag'); } catch {}
        }
      } catch {
        // Soft-fail; continue without AI prefill
      }
      // Correlate frontend with backend progress (gasless)
      const pipelineId =
        (typeof crypto !== 'undefined' && (crypto as any).randomUUID)
          ? (crypto as any).randomUUID()
          : `cm-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      // Subscribe to Pusher progress (always; safe no-op if server doesn't emit)
      if (pusher) {
        try {
          unsubscribePusher = pusher.subscribeToChannel(`deploy-${pipelineId}`, {
            progress: (evt: any) => {
              const s = evt?.step;
              if (typeof s === 'string') {
                const idx = stepIndexMap[s];
                if (typeof idx === 'number') updateOverlayIndex(idx);
                // High‑signal console diagnostics for session registry steps coming from server
                const banner = 'background: #0b1220; color: #e5e7eb; padding: 2px 6px; border-radius: 4px; font-weight: 700;';
                const kv = 'color:#93c5fd;';
                const good = 'color:#22c55e; font-weight:700;';
                const bad = 'color:#ef4444; font-weight:700;';
                const meh = 'color:#f59e0b; font-weight:700;';
                const shortAddr = (a: unknown) => {
                  const t = String(a || '');
                  return t.startsWith('0x') && t.length === 42 ? `${t.slice(0, 6)}…${t.slice(-4)}` : t;
                };
                if (s === 'attach_session_registry' || s === 'attach_session_registry_sent' || s === 'attach_session_registry_mined') {
                  // eslint-disable-next-line no-console
                  console.groupCollapsed('%c🔐 GASLESS SESSION REGISTRY — SERVER', banner);
                  // eslint-disable-next-line no-console
                  console.log('%cstep', kv, s, 'status:', (evt?.status || '').toUpperCase());
                  if (evt?.data) {
                    const d = evt.data;
                    // eslint-disable-next-line no-console
                    console.log('%corderBook', kv, d.orderBook || d?.data?.orderBook || '—', shortAddr(d.orderBook || d?.data?.orderBook || '—'));
                    // eslint-disable-next-line no-console
                    console.log('%cregistry', kv, d.registry || d?.data?.registry || '—', shortAddr(d.registry || d?.data?.registry || '—'));
                    if (d.registrySigner) {
                      // eslint-disable-next-line no-console
                      console.log('%cregistrySigner', kv, d.registrySigner, shortAddr(d.registrySigner));
                    }
                    if (d.hash) {
                      // eslint-disable-next-line no-console
                      console.log('%ctx', kv, d.hash);
                    }
                    if (d.error) {
                      // eslint-disable-next-line no-console
                      console.warn('%cerror', bad, d.error);
                    }
                    if (d.message) {
                      // eslint-disable-next-line no-console
                      console.log('%cmessage', meh, d.message);
                    }
                  }
                  // eslint-disable-next-line no-console
                  console.groupEnd();
                }
                // Mirror server steps into panel status when possible
                if (s === 'factory_confirm_meta_mined' || s === 'factory_confirm_mined' || s === 'confirm') {
                  markDone('confirm');
                }
                if (s === 'grant_roles' || s === 'grant_ORDERBOOK_ROLE_mined' || s === 'grant_SETTLEMENT_ROLE_mined') {
                  markDone('roles');
                }
                if (s === 'save_market') {
                  const st = String(evt?.status || '').toLowerCase();
                  if (st === 'success') {
                    markDone('save');
                    // Close overlay shortly after final step
                    setTimeout(() => deploymentOverlay.fadeOutAndClose(300), 200);
                  }
                }
              }
            },
          });
        } catch {}
      }

      // Open global deployment overlay and navigate to token page immediately
      deploymentOverlay.open({
        title: 'Deployment Pipeline',
        subtitle: 'Initializing market and registering oracle',
        messages: pipelineMessages,
        splashMs: INITIAL_SPLASH_MS,
      });
      // Brief splash for aesthetic purposes, then navigate behind the modal
      await new Promise(resolve => setTimeout(resolve, INITIAL_SPLASH_MS));
      {
        const targetSymbol = String(symbol || '').toUpperCase();
        router.replace(`/token/${encodeURIComponent(targetSymbol)}?deploying=1`);
      }

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
        pipelineId,
        onProgress: ({ step, data }) => {
          const idx = stepIndexMap[step];
          if (typeof idx === 'number') updateOverlayIndex(idx);
          // Mirror client-side attach-session-registry steps to console for visibility
          if (step === 'attach_session_registry' || step === 'attach_session_registry_sent' || step === 'attach_session_registry_mined' || step === 'attach_session_registry_client_probe') {
            const banner = 'background: #0b1220; color: #e5e7eb; padding: 2px 6px; border-radius: 4px; font-weight: 700;';
            const kv = 'color:#93c5fd;';
            // eslint-disable-next-line no-console
            console.groupCollapsed('%c🔐 GASLESS SESSION REGISTRY — CLIENT PROGRESS', banner);
            // eslint-disable-next-line no-console
            console.log('%cstep', kv, step);
            if (data) {
              // eslint-disable-next-line no-console
              console.log('%cdata', kv, data);
            }
            // eslint-disable-next-line no-console
            console.groupEnd();
          }
        },
      });
      markDone('tx');
      if (!gaslessEnabled) {
        // Legacy: local confirm UI
        updateOverlayIndex(5);
        // Confirm step completed as part of the awaited tx above
        markDone('confirm');
        // Grant roles on CoreVault via server-admin endpoint (user is not necessarily admin)
        markActive('roles');
        {
          updateOverlayIndex(8);
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
          updateOverlayIndex(9);
        }
        // Persist market metadata via API (Supabase upsert, verification)
        markActive('save');
        {
          updateOverlayIndex(9);
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
          updateOverlayIndex(10);
        }
      } else {
        // Gasless: server performed confirm/roles/save; reflect completion
        markDone('confirm');
        markDone('roles');
        markDone('save');
      }

      // Trigger post-deploy inspection (gasless readiness, roles, allowlist)
      void runInspect(orderBook, pipelineId);

      // Notify token page to refetch its market data and drop the deploying flag
      {
        const targetSymbol = String(marketData.symbol || '').toUpperCase();
        try {
          window.dispatchEvent(new CustomEvent('marketDeployed', { detail: { symbol: targetSymbol } }));
        } catch {}
        // Replace URL to remove ?deploying=1 and ensure fresh view
        router.replace(`/token/${encodeURIComponent(targetSymbol)}`);
      }
      // Fade out global overlay gracefully
      deploymentOverlay.fadeOutAndClose(500);
    } catch (error) {
      console.error('Error creating market:', error);
      // Mark the first active step as error for visual feedback
      const active = steps.find(s => s.status === 'active');
      if (active) markError(active.id);
      // Handle user-cancelled transaction gracefully
      if (isUserRejected(error)) {
        // Close overlay if it was open
        deploymentOverlay.close();
        // Navigate back to Create Market form
        router.replace('/markets/create');
        return;
      }
      deploymentOverlay.close();
      throw error;
    } finally {
      setIsLoading(false);
      // Clean up real-time subscription
      try { /* eslint-disable no-empty */ } catch {}
      // unsubscribe if set
      // @ts-ignore: narrow type
      if (typeof unsubscribePusher === 'function') {
        try { unsubscribePusher(); } catch {}
      }
      // Stop timer
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  };

  return (
    <div className="h-screen flex items-center bg-[#0F0F0F]">
      <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Local-only deploy timer (top-right) */}
        {showTimer && timerStart != null && (
          <div className="fixed top-3 right-3 z-[9999] rounded-md bg-[#0B0B0B] border border-[#222222] px-2.5 py-1.5 shadow-md">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#808080]">Deploy</span>
              <span className="text-[11px] text-white font-mono">{formatElapsed(elapsedMs)}</span>
            </div>
          </div>
        )}
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

        {/* Progress overlay is now managed globally via DeploymentOverlayProvider */}
      </div>
    </div>
  );
};