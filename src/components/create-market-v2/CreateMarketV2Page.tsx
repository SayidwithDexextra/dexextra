'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import { InteractiveMarketCreation } from './InteractiveMarketCreation';
import CryptoMarketTicker from '@/components/CryptoMarketTicker';
import useWallet from '@/hooks/useWallet';
import { useMarketDraft } from '@/hooks/useMarketDraft';
import { snapshotToDraft, draftToInitialState } from '@/lib/marketDraftSerializer';
import type { CreationStateSnapshot } from '@/lib/marketDraftSerializer';
import type { MarketDraftSummary } from '@/types/marketDraft';
import { stepLabel } from '@/types/marketDraft';

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

function DraftCard({
  draft,
  onResume,
  onDelete,
}: {
  draft: MarketDraftSummary;
  onResume: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  return (
    <div className="group flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 transition-colors hover:bg-white/[0.06]">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-white/90">
          {draft.title || 'Untitled market'}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-white/45">
          <span>{stepLabel(draft.currentStep)}</span>
          <span className="text-white/20">·</span>
          <span>{relativeTime(draft.updatedAt)}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {confirmDelete ? (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="rounded-lg bg-red-500/20 px-2.5 py-1.5 text-[11px] font-medium text-red-300 hover:bg-red-500/30 transition-colors"
            >
              Confirm
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
              className="rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-white/60 hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
              className="rounded-lg p-1.5 text-white/30 hover:text-red-400 hover:bg-white/5 transition-colors opacity-0 group-hover:opacity-100"
              aria-label="Delete draft"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              onClick={onResume}
              className="inline-flex items-center gap-1 rounded-lg bg-white/8 px-3 py-1.5 text-[12px] font-medium text-white/80 hover:bg-white/12 transition-colors"
            >
              Continue
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function DraftList({
  drafts,
  onResume,
  onDelete,
}: {
  drafts: MarketDraftSummary[];
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (!drafts.length) return null;

  return (
    <div className="w-full max-w-[560px] mx-auto mb-8">
      <div className="mb-2 text-[12px] font-medium text-white/50 uppercase tracking-wider">
        Continue where you left off
      </div>
      <div className="space-y-1.5">
        {drafts.map((d) => (
          <DraftCard
            key={d.id}
            draft={d}
            onResume={() => onResume(d.id)}
            onDelete={() => onDelete(d.id)}
          />
        ))}
      </div>
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

  const showDraftList = drafts.length > 0 && !activeDraftId;

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

          {showDraftList && (
            <div className="mt-8 w-full sm:mt-10">
              <DraftList
                drafts={drafts}
                onResume={handleResumeDraftFromList}
                onDelete={handleDeleteDraft}
              />
            </div>
          )}

          <div className="mt-8 w-full sm:mt-10">
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
        </div>
        </div>
      </div>
    </>
  );
}
