'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import { InteractiveMarketCreation } from './InteractiveMarketCreation';
import CryptoMarketTicker from '@/components/CryptoMarketTicker';
import useWallet from '@/hooks/useWallet';
import { useMarketDraft } from '@/hooks/useMarketDraft';
import { snapshotToDraft, draftToInitialState } from '@/lib/marketDraftSerializer';
import type { CreationStateSnapshot } from '@/lib/marketDraftSerializer';
import type { CreationStep } from './InteractiveMarketCreation';
import type { MarketDraftSummary } from '@/types/marketDraft';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

function DraftResumeHint({
  drafts,
  onResume,
  onDismiss,
}: {
  drafts: MarketDraftSummary[];
  onResume: (id: string) => void;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const latest = drafts[0];
  if (!latest) return null;

  if (drafts.length === 1) {
    return (
      <div className="mt-6 flex items-center justify-center gap-2 text-[13px] text-white/35 animate-[fadeIn_0.4s_ease]">
        <span className="truncate max-w-[200px]">{latest.title || 'Untitled'}</span>
        <span className="text-white/15">·</span>
        <span>{relativeTime(latest.updatedAt)}</span>
        <button
          onClick={() => onResume(latest.id)}
          className="ml-1 text-white/55 hover:text-white/80 transition-colors underline underline-offset-2 decoration-white/20 hover:decoration-white/40"
        >
          Resume
        </button>
        <button
          onClick={onDismiss}
          className="ml-0.5 text-white/20 hover:text-white/50 transition-colors p-0.5"
          aria-label="Dismiss"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
            <path d="M4.28 3.22a.75.75 0 00-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 101.06 1.06L8 9.06l3.72 3.72a.75.75 0 101.06-1.06L9.06 8l3.72-3.72a.75.75 0 00-1.06-1.06L8 6.94 4.28 3.22z" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col items-center gap-1 text-[13px] text-white/35 animate-[fadeIn_0.4s_ease]">
      {!expanded ? (
        <div className="flex items-center gap-2">
          <span className="truncate max-w-[200px]">{latest.title || 'Untitled'}</span>
          <span className="text-white/15">·</span>
          <span>{relativeTime(latest.updatedAt)}</span>
          <button
            onClick={() => onResume(latest.id)}
            className="ml-1 text-white/55 hover:text-white/80 transition-colors underline underline-offset-2 decoration-white/20 hover:decoration-white/40"
          >
            Resume
          </button>
          <button
            onClick={() => setExpanded(true)}
            className="ml-0.5 text-white/25 hover:text-white/50 transition-colors"
          >
            +{drafts.length - 1} more
          </button>
          <button
            onClick={onDismiss}
            className="ml-0.5 text-white/20 hover:text-white/50 transition-colors p-0.5"
            aria-label="Dismiss"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
              <path d="M4.28 3.22a.75.75 0 00-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 101.06 1.06L8 9.06l3.72 3.72a.75.75 0 101.06-1.06L9.06 8l3.72-3.72a.75.75 0 00-1.06-1.06L8 6.94 4.28 3.22z" />
            </svg>
          </button>
        </div>
      ) : (
        <>
          {drafts.map((d) => (
            <div key={d.id} className="flex items-center gap-2">
              <span className="truncate max-w-[200px]">{d.title || 'Untitled'}</span>
              <span className="text-white/15">·</span>
              <span>{relativeTime(d.updatedAt)}</span>
              <button
                onClick={() => onResume(d.id)}
                className="ml-1 text-white/55 hover:text-white/80 transition-colors underline underline-offset-2 decoration-white/20 hover:decoration-white/40"
              >
                Resume
              </button>
            </div>
          ))}
          <button
            onClick={onDismiss}
            className="mt-1 text-white/25 hover:text-white/50 transition-colors text-[12px]"
          >
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}

export function CreateMarketV2Page() {
  const [isMounted, setIsMounted] = React.useState(false);
  const { walletData } = useWallet();
  const wallet = walletData.address ?? null;

  const {
    drafts,
    activeDraftId,
    activeDraft,
    createDraft,
    updateDraft,
    updateDraftAndFlush,
    loadDraft,
    deleteDraft,
    clearActiveDraft,
    markCompleted,
    refreshDrafts,
  } = useMarketDraft(wallet);

  const [loadedState, setLoadedState] = React.useState<CreationStateSnapshot | null>(null);
  const [creationKey, setCreationKey] = React.useState(0);
  const [draftHintDismissed, setDraftHintDismissed] = React.useState(false);
  const [currentStep, setCurrentStep] = React.useState<CreationStep>('clarify_metric');
  const searchParams = useSearchParams();
  const draftParam = searchParams?.get('draft') ?? null;
  const draftParamLoadedRef = React.useRef<string | null>(null);
  const [isDraftLoading, setIsDraftLoading] = React.useState(false);

  React.useEffect(() => {
    const hasDraftParam = !!new URLSearchParams(window.location.search).get('draft');
    if (hasDraftParam) setIsDraftLoading(true);
    setIsMounted(true);
  }, []);

  const handleStateChange = React.useCallback((snap: CreationStateSnapshot) => {
    if (!activeDraftId) return;
    if (!snap.prompt.trim() && snap.discoveryState === 'idle') return;
    const draft = snapshotToDraft(activeDraftId, snap);
    updateDraft(draft);
  }, [activeDraftId, updateDraft]);

  const handleStepConfirm = React.useCallback((snap: CreationStateSnapshot) => {
    if (!activeDraftId) return;
    const draft = snapshotToDraft(activeDraftId, snap);
    updateDraftAndFlush(draft);
  }, [activeDraftId, updateDraftAndFlush]);

  const handleDeploySuccess = React.useCallback((symbol: string, marketId: string) => {
    if (activeDraftId) {
      void markCompleted(activeDraftId, marketId);
    }
  }, [activeDraftId, markCompleted]);

  const handleResumeDraft = React.useCallback(async (id: string): Promise<boolean> => {
    const draft = await loadDraft(id);
    if (!draft) return false;
    const state = draftToInitialState(draft);
    setLoadedState(state);
    setCreationKey((k) => k + 1);
    setIsDraftLoading(false);
    return true;
  }, [loadDraft]);

  // Auto-load draft from ?draft=ID query parameter (e.g. from Settings page).
  // Tries localStorage first; retries with server once wallet connects.
  // Keeps isDraftLoading=true until the draft is loaded or we've tried with a
  // wallet and still failed (nothing more to retry).
  React.useEffect(() => {
    if (!draftParam || draftParamLoadedRef.current === draftParam) return;
    void handleResumeDraft(draftParam).then((ok) => {
      if (ok) {
        draftParamLoadedRef.current = draftParam;
      } else if (wallet) {
        setIsDraftLoading(false);
      }
    });
  }, [draftParam, wallet, handleResumeDraft]);

  const handleResumeDraftFromList = React.useCallback(async (id: string) => {
    setIsDraftLoading(true);
    await handleResumeDraft(id);
  }, [handleResumeDraft]);

  const handleDeleteDraft = React.useCallback(async (id: string) => {
    await deleteDraft(id);
  }, [deleteDraft]);

  const handleNewMarket = React.useCallback(() => {
    createDraft();
    setLoadedState(null);
    setCreationKey((k) => k + 1);
  }, [createDraft]);

  // Auto-create a draft when user starts typing (first state change without active draft)
  const handleStateChangeWithAutoCreate = React.useCallback((snap: CreationStateSnapshot) => {
    setCurrentStep(snap.visibleStep);
    if (!activeDraftId && snap.prompt.trim()) {
      const id = createDraft();
      const draft = snapshotToDraft(id, snap);
      updateDraft(draft);
      return;
    }
    handleStateChange(snap);
  }, [activeDraftId, createDraft, updateDraft, handleStateChange]);

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

  const showDraftHint = drafts.length > 0 && !activeDraftId && !draftHintDismissed;
  const isReviewStep = currentStep === 'complete';

  return (
    <>
      <div className="w-full overflow-hidden">
        <CryptoMarketTicker />
      </div>
      <div className="relative min-h-[calc(100vh-144px)] w-full bg-[#1a1a1a] text-white">
        <div className={`relative mx-auto w-full max-w-5xl px-4 pb-8 sm:px-6 lg:px-8 transition-[padding] duration-300 ${isReviewStep ? 'pt-6 sm:pt-8 lg:pt-10' : 'pt-24 sm:pt-32 lg:pt-40'}`}>
        <div className="flex flex-col items-center text-center">
          {!isReviewStep && (
            <h2 className="text-xl font-normal text-white text-center">
              What do you want to create today?
            </h2>
          )}

          <div className={`w-full ${isReviewStep ? '' : 'mt-8 sm:mt-10'}`}>
            <div className="flex justify-center">
              {isDraftLoading ? (
                <div className="flex items-center gap-2 py-12 text-white/40 text-sm">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Loading draft…
                </div>
              ) : (
                <InteractiveMarketCreation
                  key={creationKey}
                  initialState={loadedState}
                  onStateChange={handleStateChangeWithAutoCreate}
                  onDeploySuccess={handleDeploySuccess}
                />
              )}
            </div>
          </div>

          {showDraftHint && !isReviewStep && (
            <DraftResumeHint
              drafts={drafts}
              onResume={handleResumeDraftFromList}
              onDismiss={() => setDraftHintDismissed(true)}
            />
          )}
        </div>
        </div>
      </div>
    </>
  );
}
