'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarketDraftState, MarketDraftSummary, CreationStep, PipelineStage } from '@/types/marketDraft';
import { DRAFT_SCHEMA_VERSION } from '@/types/marketDraft';
import type { PipelineResumeState } from '@/lib/createMarketOnChain';

const LS_ACTIVE_KEY = 'dexextra:market-draft:active';
const LS_PREFIX = 'dexextra:market-draft:';
const SYNC_INTERVAL_MS = 30_000;
const DEBOUNCE_MS = 400;

function lsDraftKey(id: string) {
  return `${LS_PREFIX}${id}`;
}

function readLocalDraft(id: string): MarketDraftState | null {
  try {
    const raw = localStorage.getItem(lsDraftKey(id));
    return raw ? (JSON.parse(raw) as MarketDraftState) : null;
  } catch {
    return null;
  }
}

function writeLocalDraft(draft: MarketDraftState) {
  try {
    localStorage.setItem(lsDraftKey(draft.id), JSON.stringify(draft));
  } catch {}
}

function removeLocalDraft(id: string) {
  try {
    localStorage.removeItem(lsDraftKey(id));
  } catch {}
}

function readActiveDraftId(): string | null {
  try {
    return localStorage.getItem(LS_ACTIVE_KEY) || null;
  } catch {
    return null;
  }
}

function writeActiveDraftId(id: string | null) {
  try {
    if (id) localStorage.setItem(LS_ACTIVE_KEY, id);
    else localStorage.removeItem(LS_ACTIVE_KEY);
  } catch {}
}

function generateId(): string {
  return crypto.randomUUID();
}

async function fetchDraftList(wallet: string): Promise<MarketDraftSummary[]> {
  try {
    const res = await fetch(`/api/market-drafts?wallet=${encodeURIComponent(wallet)}`);
    if (!res.ok) return [];
    const json = await res.json();
    return (json.drafts ?? []).map((d: any) => ({
      id: d.id,
      title: d.title,
      currentStep: d.current_step as CreationStep,
      pipelineStage: (d.pipeline_stage || 'draft') as PipelineStage,
      orderbookAddress: d.orderbook_address || null,
      marketIdBytes32: d.market_id_bytes32 || null,
      updatedAt: d.updated_at,
      createdAt: d.created_at,
    }));
  } catch {
    return [];
  }
}

async function fetchFullDraft(id: string, wallet: string): Promise<MarketDraftState | null> {
  try {
    const res = await fetch('/api/market-drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'load', id, wallet }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const row = json.draft;
    if (!row?.draft_state) return null;
    return {
      ...row.draft_state,
      id: row.id,
      currentStep: row.current_step,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } as MarketDraftState;
  } catch {
    return null;
  }
}

async function upsertDraftToServer(draft: MarketDraftState, wallet: string): Promise<boolean> {
  try {
    const res = await fetch('/api/market-drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: draft.id,
        wallet,
        title: draft.title,
        current_step: draft.currentStep,
        draft_state: draft,
        schema_version: draft.schemaVersion ?? DRAFT_SCHEMA_VERSION,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function archiveDraftOnServer(id: string, wallet: string): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/market-drafts?id=${encodeURIComponent(id)}&wallet=${encodeURIComponent(wallet)}`,
      { method: 'DELETE' },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export function useMarketDraft(walletAddress: string | null) {
  const wallet = walletAddress?.toLowerCase() ?? null;
  const [drafts, setDrafts] = useState<MarketDraftSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeDraftId, setActiveDraftIdState] = useState<string | null>(null);

  const activeDraftRef = useRef<MarketDraftState | null>(null);
  const dirtyRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  // Restore active draft ID on mount
  useEffect(() => {
    const stored = readActiveDraftId();
    if (stored) {
      const local = readLocalDraft(stored);
      if (local) {
        activeDraftRef.current = local;
        setActiveDraftIdState(stored);
      }
    }
  }, []);

  // Fetch draft list from server when wallet changes
  useEffect(() => {
    if (!wallet) {
      setDrafts([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    fetchDraftList(wallet).then((list) => {
      if (cancelled) return;
      setDrafts(list);
      setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [wallet]);

  const flushToServer = useCallback(async () => {
    const w = walletRef.current;
    const draft = activeDraftRef.current;
    if (!w || !draft || !dirtyRef.current) return;
    dirtyRef.current = false;
    await upsertDraftToServer(draft, w);
  }, []);

  // Periodic sync to server
  useEffect(() => {
    syncTimerRef.current = setInterval(() => {
      void flushToServer();
    }, SYNC_INTERVAL_MS);
    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  }, [flushToServer]);

  // Flush on visibilitychange + beforeunload
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') void flushToServer();
    };
    const handleUnload = () => {
      const w = walletRef.current;
      const draft = activeDraftRef.current;
      if (!w || !draft || !dirtyRef.current) return;
      dirtyRef.current = false;
      const body = JSON.stringify({
        id: draft.id,
        wallet: w,
        title: draft.title,
        current_step: draft.currentStep,
        draft_state: draft,
        schema_version: draft.schemaVersion ?? DRAFT_SCHEMA_VERSION,
      });
      try {
        navigator.sendBeacon('/api/market-drafts', new Blob([body], { type: 'application/json' }));
      } catch {}
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [flushToServer]);

  const setActiveDraftId = useCallback((id: string | null) => {
    setActiveDraftIdState(id);
    writeActiveDraftId(id);
  }, []);

  const createDraft = useCallback((): string => {
    const id = generateId();
    const now = new Date().toISOString();
    const draft: MarketDraftState = {
      id,
      schemaVersion: DRAFT_SCHEMA_VERSION,
      prompt: '',
      metricClarification: '',
      marketName: '',
      marketDescription: '',
      isNameConfirmed: false,
      nameTouched: false,
      isDescriptionConfirmed: false,
      descriptionTouched: false,
      isIconConfirmed: false,
      similarMarketsAcknowledged: false,
      discoveryResult: null,
      discoveryState: 'idle',
      selectedSource: null,
      validationResult: null,
      deniedSourceUrls: [],
      iconUrl: null,
      assistantHistory: [],
      title: '',
      currentStep: 'clarify_metric',
      createdAt: now,
      updatedAt: now,
    };
    activeDraftRef.current = draft;
    writeLocalDraft(draft);
    setActiveDraftId(id);
    return id;
  }, [setActiveDraftId]);

  const updateDraft = useCallback((patch: Partial<MarketDraftState>) => {
    if (!activeDraftRef.current) return;
    const updated = {
      ...activeDraftRef.current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    activeDraftRef.current = updated;
    dirtyRef.current = true;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      writeLocalDraft(updated);
    }, DEBOUNCE_MS);
  }, []);

  const updateDraftAndFlush = useCallback((patch: Partial<MarketDraftState>) => {
    if (!activeDraftRef.current) return;
    const updated = {
      ...activeDraftRef.current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    activeDraftRef.current = updated;
    dirtyRef.current = true;
    writeLocalDraft(updated);
    void flushToServer();
  }, [flushToServer]);

  const loadDraft = useCallback(async (id: string): Promise<MarketDraftState | null> => {
    const local = readLocalDraft(id);
    const w = walletRef.current;

    let draft = local;
    if (w) {
      const remote = await fetchFullDraft(id, w);
      if (remote) {
        const localIsEmpty = !local || (!local.prompt?.trim() && local.discoveryState === 'idle');
        const remoteIsNewer = !local || new Date(remote.updatedAt) > new Date(local.updatedAt);
        if (localIsEmpty || remoteIsNewer) {
          draft = remote;
        }
      }
    }
    if (!draft) return null;

    activeDraftRef.current = draft;
    writeLocalDraft(draft);
    setActiveDraftId(id);
    dirtyRef.current = false;
    return draft;
  }, [setActiveDraftId]);

  const deleteDraft = useCallback(async (id: string) => {
    removeLocalDraft(id);
    if (activeDraftRef.current?.id === id) {
      activeDraftRef.current = null;
      setActiveDraftId(null);
    }
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    const w = walletRef.current;
    if (w) await archiveDraftOnServer(id, w);
  }, [setActiveDraftId]);

  const clearActiveDraft = useCallback(() => {
    activeDraftRef.current = null;
    setActiveDraftId(null);
    dirtyRef.current = false;
  }, [setActiveDraftId]);

  const markCompleted = useCallback(async (draftId: string, marketId: string) => {
    removeLocalDraft(draftId);
    if (activeDraftRef.current?.id === draftId) {
      activeDraftRef.current = null;
      setActiveDraftId(null);
    }
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));

    const w = walletRef.current;
    if (w) {
      try {
        const sb = await fetch('/api/market-drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'complete',
            id: draftId,
            wallet: w,
            market_id: marketId,
          }),
        });
      } catch {}
    }
  }, [setActiveDraftId]);

  const refreshDrafts = useCallback(async () => {
    const w = walletRef.current;
    if (!w) return;
    const list = await fetchDraftList(w);
    setDrafts(list);
  }, []);

  const getResumeState = useCallback(async (id: string): Promise<PipelineResumeState | null> => {
    const w = walletRef.current;
    if (!w) return null;
    try {
      const res = await fetch('/api/market-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'load', id, wallet: w }),
      });
      if (!res.ok) return null;
      const json = await res.json();
      const row = json.draft;
      if (!row) return null;
      const stage = row.pipeline_stage as PipelineStage;
      if (stage === 'draft' || stage === 'finalized') return null;
      return {
        draftId: row.id,
        pipelineStage: stage,
        orderbookAddress: row.orderbook_address || null,
        marketIdBytes32: row.market_id_bytes32 || null,
        transactionHash: row.transaction_hash || null,
        blockNumber: row.block_number ?? null,
        chainId: row.chain_id ?? null,
      };
    } catch {
      return null;
    }
  }, []);

  return {
    drafts,
    isLoading,
    activeDraftId,
    activeDraft: activeDraftRef.current,
    createDraft,
    updateDraft,
    updateDraftAndFlush,
    loadDraft,
    deleteDraft,
    clearActiveDraft,
    markCompleted,
    flushToServer,
    refreshDrafts,
    getResumeState,
  };
}
