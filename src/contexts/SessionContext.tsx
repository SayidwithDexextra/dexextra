'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { createGaslessSession } from '@/lib/gasless';

type SessionState = {
  sessionId: string | null;
  sessionActive: boolean | null; // null = unknown/not applicable
  loading: boolean;
  enableTrading: () => Promise<{ success: boolean; sessionId?: string; error?: string }>;
  refresh: () => Promise<void>;
  clear: () => void;
};

const SessionContext = createContext<SessionState | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { walletData } = useWallet() as any;
  const address = walletData?.address as string | undefined;
  const GASLESS_ENABLED = typeof process !== 'undefined' && (process as any)?.env?.NEXT_PUBLIC_GASLESS_ENABLED === 'true';
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionActive, setSessionActive] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const storageKey = useMemo(() => (address ? `gasless:session:${address}` : ''), [address]);
  const storageExpiryKey = useMemo(() => (address ? `gasless:session:expiry:${address}` : ''), [address]);
  const storageMetaKey = useMemo(() => (address ? `gasless:session:meta:${address}` : ''), [address]);

  const refresh = useCallback(async () => {
    if (!GASLESS_ENABLED || !address) {
      setSessionActive(null);
      setSessionId(null);
      return;
    }
    const sess = (typeof window !== 'undefined' && storageKey) ? (window.localStorage.getItem(storageKey) || '') : '';
    const expStr = (typeof window !== 'undefined' && storageExpiryKey) ? (window.localStorage.getItem(storageExpiryKey) || '') : '';
    if (!sess) {
      setSessionId(null);
      setSessionActive(false);
      return;
    }
    // If we know expiry locally, use it to determine activity without polling
    const nowMs = Date.now();
    const expMs = expStr ? (parseInt(expStr, 10) * 1000) : 0;
    if (expMs && nowMs > expMs) {
      if (typeof window !== 'undefined') {
        try { window.localStorage.removeItem(storageKey); } catch {}
        try { window.localStorage.removeItem(storageExpiryKey); } catch {}
      }
      setSessionId(null);
      setSessionActive(false);
      return;
    }
    setSessionId(sess);
    setSessionActive(true);
  }, [GASLESS_ENABLED, address, storageKey, storageExpiryKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Schedule an in-memory timeout to flip state exactly when expiry passes (no polling)
  useEffect(() => {
    if (!GASLESS_ENABLED || !address) return;
    if (typeof window === 'undefined') return;
    const expStr = storageExpiryKey ? (window.localStorage.getItem(storageExpiryKey) || '') : '';
    if (!expStr) return;
    const expMs = parseInt(expStr, 10) * 1000;
    const now = Date.now();
    if (!Number.isFinite(expMs) || expMs <= now) return;
    const delay = Math.min(expMs - now, 2_147_483_647);
    const id = window.setTimeout(() => {
      if (typeof window !== 'undefined') {
        try { window.localStorage.removeItem(storageKey); } catch {}
        try { window.localStorage.removeItem(storageExpiryKey); } catch {}
      }
      setSessionId(null);
      setSessionActive(false);
    }, delay);
    return () => {
      window.clearTimeout(id);
    };
  }, [GASLESS_ENABLED, address, storageKey, storageExpiryKey, sessionId]);

  // React to cross-tab changes without polling
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key === storageKey || e.key === storageExpiryKey) {
        void refresh();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, [storageKey, storageExpiryKey, refresh]);

  // Refresh when tab becomes visible again (catch up after inactivity/background)
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  const enableTrading = useCallback(async () => {
    if (!GASLESS_ENABLED || !address) return { success: false, error: 'Wallet or gasless disabled' };
    try {
      setLoading(true);
      const created = await createGaslessSession({ trader: address });
      if (created.success && created.sessionId) {
        setSessionId(created.sessionId);
        setSessionActive(true);
        if (typeof window !== 'undefined' && storageKey) {
          window.localStorage.setItem(storageKey, created.sessionId);
          if (storageExpiryKey && created.expirySec) {
            window.localStorage.setItem(storageExpiryKey, String(created.expirySec));
          }
          if (storageMetaKey) {
            const meta = {
              address,
              sessionId: created.sessionId,
              expirySec: created.expirySec || null,
              createdAtSec: Math.floor(Date.now() / 1000),
            };
            try { window.localStorage.setItem(storageMetaKey, JSON.stringify(meta)); } catch {}
          }
        }
        return { success: true, sessionId: created.sessionId };
      }
      return { success: false, error: created.error || 'session init failed' };
    } catch (e: any) {
      return { success: false, error: e?.message || 'session init failed' };
    } finally {
      setLoading(false);
    }
  }, [GASLESS_ENABLED, address, storageKey, storageExpiryKey, storageMetaKey]);

  const clear = useCallback(() => {
    if (typeof window !== 'undefined' && storageKey) {
      window.localStorage.removeItem(storageKey);
      if (storageExpiryKey) {
        window.localStorage.removeItem(storageExpiryKey);
      }
      if (storageMetaKey) {
        window.localStorage.removeItem(storageMetaKey);
      }
    }
    setSessionId(null);
    setSessionActive(false);
  }, [storageKey, storageExpiryKey, storageMetaKey]);

  const value: SessionState = useMemo(() => ({
    sessionId,
    sessionActive,
    loading,
    enableTrading,
    refresh,
    clear,
  }), [sessionId, sessionActive, loading, enableTrading, refresh, clear]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return ctx;
}




