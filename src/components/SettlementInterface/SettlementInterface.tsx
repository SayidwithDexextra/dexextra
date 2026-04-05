'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { useCoreVault } from '@/hooks/useCoreVault';
import { useSession } from '@/contexts/SessionContext';
import { publicClient } from '@/lib/viemClient';
import { challengeWindowExpiresMs } from '@/lib/settlement-window';

interface SettlementMarket {
  id: string;
  symbol: string;
  market_identifier: string;
  market_status?: string;
  market_address?: string;
  proposed_settlement_value: number;
  proposed_settlement_at: string;
  proposed_settlement_by: string;
  settlement_date?: string;
  alternative_settlement_value?: number;
  alternative_settlement_at?: string;
  alternative_settlement_by?: string;
  settlement_disputed: boolean;
  ai_source_locator?: {
    url?: string;
    primary_source_url?: string;
    [key: string]: unknown;
  } | null;
  market_config?: {
    expires_at?: string;
    challenge_window_seconds?: number;
    challenge_duration_seconds?: number;
    settlement_wayback_url?: string;
    settlement_wayback_page_url?: string;
    settlement_screenshot_url?: string;
    uma_assertion_id?: string;
    uma_escalated_at?: string;
    uma_escalation_tx?: string;
    uma_resolved?: boolean;
    uma_challenger_won?: boolean;
    uma_winning_price?: number;
    uma_resolution_tx?: string;
    uma_resolved_at?: string;
    challenger_evidence?: {
      source_url?: string;
      image_url?: string;
      submitted_at?: string;
    };
  };
}

interface OnChainSettlementState {
  lifecycleState: number;
  challengeBondAmount: number;
  slashRecipient: string;
  challengeActive: boolean;
  challenger: string;
  challengedPrice: number;
  bondEscrowed: number;
  challengeResolved: boolean;
  challengerWon: boolean;
  evidenceHash: string;
  evidenceUrl: string;
}

const LIFECYCLE_LABELS: Record<number, string> = {
  0: 'Unsettled',
  1: 'Rollover',
  2: 'Challenge Window',
  3: 'Settled',
};

const LIFECYCLE_STATE_ABI = [{ type: 'function' as const, name: 'getLifecycleState' as const, stateMutability: 'view' as const, inputs: [], outputs: [{ type: 'uint8', name: '' }] }] as const;
const CHALLENGE_BOND_CONFIG_ABI = [{ type: 'function' as const, name: 'getChallengeBondConfig' as const, stateMutability: 'view' as const, inputs: [], outputs: [{ type: 'uint256', name: 'bondAmount' }, { type: 'address', name: 'slashRecipient' }] }] as const;
const ACTIVE_CHALLENGE_ABI = [{ type: 'function' as const, name: 'getActiveChallengeInfo' as const, stateMutability: 'view' as const, inputs: [], outputs: [{ type: 'bool', name: 'active' }, { type: 'address', name: 'challengerAddr' }, { type: 'uint256', name: 'challengedPriceVal' }, { type: 'uint256', name: 'bondEscrowed' }, { type: 'bool', name: 'resolved' }, { type: 'bool', name: 'won' }] }] as const;
const PROPOSED_EVIDENCE_ABI = [{ type: 'function' as const, name: 'getProposedEvidence' as const, stateMutability: 'view' as const, inputs: [], outputs: [{ type: 'bytes32', name: 'evidenceHash' }, { type: 'string', name: 'evidenceUrl' }] }] as const;
const BOND_EXEMPT_ABI = [{ type: 'function' as const, name: 'isProposalBondExempt' as const, stateMutability: 'view' as const, inputs: [{ type: 'address', name: 'account' }], outputs: [{ type: 'bool', name: '' }] }] as const;

interface SettlementInterfaceProps {
  market?: SettlementMarket;
  className?: string;
  onChallengeSaved?: () => void;
}

const formatAddress = (addr?: string | null) => {
  if (!addr || typeof addr !== 'string') return '—';
  return addr.length <= 10 ? addr : `${addr.slice(0, 6)}...${addr.slice(-4)}`;
};

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function SettlementInterface({
  market,
  className = '',
  onChallengeSaved,
}: SettlementInterfaceProps) {
  const { walletData } = useWallet();
  const { availableBalance, fetchBalances: refreshVaultBalance } = useCoreVault();
  const { sessionId, sessionActive, enableTrading, loading: sessionLoading } = useSession();
  const [challengePrice, setChallengePrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState<string>('');
  const [challengeTxHash, setChallengeTxHash] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<string>('');
  const walletLabel = walletData?.address ? formatAddress(walletData.address) : 'Connect wallet';
  const [challengeNotice, setChallengeNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [onChain, setOnChain] = useState<OnChainSettlementState | null>(null);
  const [onChainError, setOnChainError] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const evidenceFileInputRef = useRef<HTMLInputElement | null>(null);
  const [screenshotExpanded, setScreenshotExpanded] = useState(true);
  const [evidenceSourceUrl, setEvidenceSourceUrl] = useState('');
  const [evidenceImageFile, setEvidenceImageFile] = useState<File | null>(null);
  const [uploadedEvidenceImageUrl, setUploadedEvidenceImageUrl] = useState<string | null>(null);
  const [isBondExempt, setIsBondExempt] = useState(false);

  const fetchOnChainState = useCallback(async (addr: `0x${string}`) => {
    try {
      const [lcRaw, bcRaw, acRaw, evRaw] = await Promise.all([
        publicClient.readContract({ address: addr, abi: LIFECYCLE_STATE_ABI, functionName: 'getLifecycleState', args: [] }).catch(() => null),
        publicClient.readContract({ address: addr, abi: CHALLENGE_BOND_CONFIG_ABI, functionName: 'getChallengeBondConfig', args: [] }).catch(() => null),
        publicClient.readContract({ address: addr, abi: ACTIVE_CHALLENGE_ABI, functionName: 'getActiveChallengeInfo', args: [] }).catch(() => null),
        publicClient.readContract({ address: addr, abi: PROPOSED_EVIDENCE_ABI, functionName: 'getProposedEvidence', args: [] }).catch(() => null),
      ]);

      if (lcRaw == null && bcRaw == null && acRaw == null && evRaw == null) {
        setOnChainError(true);
        return;
      }

      const lc = lcRaw as any;
      const bc = bcRaw as any;
      const ac = acRaw as any;
      const ev = evRaw as any;

      setOnChain({
        lifecycleState: lc != null ? Number(lc) : 0,
        challengeBondAmount: bc ? Number(bc[0] ?? 0n) / 1e6 : 0,
        slashRecipient: bc ? String(bc[1] || '') : '',
        challengeActive: ac ? Boolean(ac[0]) : false,
        challenger: ac ? String(ac[1] || '') : '',
        challengedPrice: ac ? Number(ac[2] ?? 0n) / 1e6 : 0,
        bondEscrowed: ac ? Number(ac[3] ?? 0n) / 1e6 : 0,
        challengeResolved: ac ? Boolean(ac[4]) : false,
        challengerWon: ac ? Boolean(ac[5]) : false,
        evidenceHash: ev ? String(ev[0] || '') : '',
        evidenceUrl: ev ? String(ev[1] || '') : '',
      });
      setOnChainError(false);
    } catch {
      setOnChainError(true);
    }
  }, []);

  useEffect(() => {
    const addr = market?.market_address;
    if (!addr || typeof addr !== 'string' || !addr.startsWith('0x') || addr.length !== 42) return;
    let cancelled = false;
    const poll = async () => {
      await fetchOnChainState(addr as `0x${string}`);
      if (!cancelled) pollRef.current = setTimeout(poll, 15_000);
    };
    void poll();
    return () => { cancelled = true; if (pollRef.current) clearTimeout(pollRef.current); };
  }, [market?.market_address, fetchOnChainState]);

  useEffect(() => {
    const marketAddr = market?.market_address;
    const userAddr = walletData?.address;
    if (!marketAddr || !userAddr || typeof marketAddr !== 'string' || !marketAddr.startsWith('0x') || marketAddr.length !== 42) {
      setIsBondExempt(false);
      return;
    }
    let cancelled = false;
    publicClient.readContract({
      address: marketAddr as `0x${string}`,
      abi: BOND_EXEMPT_ABI,
      functionName: 'isProposalBondExempt',
      args: [userAddr as `0x${string}`],
    }).then((result) => {
      if (!cancelled) setIsBondExempt(Boolean(result));
    }).catch(() => {
      if (!cancelled) setIsBondExempt(false);
    });
    return () => { cancelled = true; };
  }, [market?.market_address, walletData?.address]);

  useEffect(() => {
    const addr = market?.market_address;
    const sym = market?.symbol;
    if (!addr || typeof window === 'undefined') return;

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const eventSymbol = String(detail.symbol || '').toUpperCase();
      const ourSymbol = String(sym || '').toUpperCase();
      if (eventSymbol && ourSymbol && eventSymbol !== ourSymbol) return;

      if (pollRef.current) clearTimeout(pollRef.current);
      void fetchOnChainState(addr as `0x${string}`).then(() => {
        pollRef.current = setTimeout(() => {
          void fetchOnChainState(addr as `0x${string}`);
        }, 15_000);
      });
    };

    window.addEventListener('settlementUpdated', handler);
    return () => window.removeEventListener('settlementUpdated', handler);
  }, [market?.market_address, market?.symbol, fetchOnChainState]);

  const windowExpiresMs = useMemo(() => {
    if (!market) return 0;
    return challengeWindowExpiresMs(market) ?? 0;
  }, [
    market?.settlement_date,
    market?.market_config?.expires_at,
    market?.market_config?.challenge_window_seconds,
    market?.market_config?.challenge_duration_seconds,
  ]);

  const evidencePreviewUrl = useMemo(() => {
    if (!evidenceImageFile) return null;
    return URL.createObjectURL(evidenceImageFile);
  }, [evidenceImageFile]);

  useEffect(() => {
    return () => {
      if (evidencePreviewUrl) URL.revokeObjectURL(evidencePreviewUrl);
    };
  }, [evidencePreviewUrl]);

  const isExpired = Boolean(windowExpiresMs && windowExpiresMs <= Date.now());

  useEffect(() => {
    if (!windowExpiresMs) return;
    const updateTimer = () => {
      const diff = windowExpiresMs - Date.now();
      if (diff <= 0) { setTimeRemaining('Expired'); return; }
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeRemaining(`${hours}h ${minutes}m ${seconds}s`);
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [windowExpiresMs]);

  const availableBalanceNum = parseFloat(availableBalance || '0');
  const bondRequired = isBondExempt ? 0 : (onChain?.challengeBondAmount ?? 0);
  const hasSufficientBalance = bondRequired <= 0 || availableBalanceNum >= bondRequired;

  const evidenceUrlTrim = evidenceSourceUrl.trim();
  const evidenceUrlFieldOk = evidenceUrlTrim === '' || isValidHttpUrl(evidenceUrlTrim);
  const hasEvidenceSource = evidenceUrlTrim !== '' && isValidHttpUrl(evidenceUrlTrim);
  const hasEvidenceImage = Boolean(uploadedEvidenceImageUrl) || Boolean(evidenceImageFile);
  const evidenceComplete = hasEvidenceSource || hasEvidenceImage;

  const handleEnableSession = async () => {
    setChallengeNotice(null);
    const result = await enableTrading();
    if (result.success) {
      setChallengeNotice({ type: 'success', text: 'Gasless session enabled.' });
    } else {
      setChallengeNotice({ type: 'error', text: result.error || 'Failed to create session.' });
    }
  };

  const hasSession = Boolean(sessionActive && sessionId);

  const handleChallenge = async () => {
    if (!challengePrice) return;
    const price = Number(challengePrice);
    if (price <= 0 || !Number.isFinite(price)) { setChallengeNotice({ type: 'error', text: 'Enter a valid positive price.' }); return; }
    if (!walletData?.address) { setChallengeNotice({ type: 'error', text: 'Connect a wallet to propose a settlement price.' }); return; }
    if (!market?.id) { setChallengeNotice({ type: 'error', text: 'Market unavailable.' }); return; }
    if (!market?.market_address) { setChallengeNotice({ type: 'error', text: 'Market contract address not available.' }); return; }
    if (isExpired) { setChallengeNotice({ type: 'error', text: 'Settlement window already expired.' }); return; }
    if (!hasSufficientBalance) { setChallengeNotice({ type: 'error', text: `Insufficient balance. Need ${bondRequired.toLocaleString()} USDC.` }); return; }
    if (!evidenceUrlFieldOk) { setChallengeNotice({ type: 'error', text: 'Evidence URL must be a valid http(s) link.' }); return; }
    if (!evidenceComplete) { setChallengeNotice({ type: 'error', text: 'Provide evidence: a source URL and/or a screenshot.' }); return; }
    if (!hasSession) { setChallengeNotice({ type: 'error', text: 'Enable gasless trading first.' }); return; }

    try {
      setIsSubmitting(true);
      setChallengeNotice(null);
      setChallengeTxHash(null);

      let imagePublicUrl = uploadedEvidenceImageUrl;
      if (evidenceImageFile && !imagePublicUrl) {
        setSubmitStep('Uploading evidence...');
        const fd = new FormData();
        fd.append('file', evidenceImageFile);
        fd.append('market_id', market.id);
        const upRes = await fetch('/api/settlements/challenge-evidence', { method: 'POST', body: fd });
        const upJson = await upRes.json().catch(() => ({}));
        if (!upRes.ok) {
          setChallengeNotice({ type: 'error', text: upJson.error || 'Could not upload evidence.' });
          return;
        }
        imagePublicUrl = typeof upJson.publicUrl === 'string' ? upJson.publicUrl : null;
        if (!imagePublicUrl) {
          setChallengeNotice({ type: 'error', text: 'Upload succeeded but no URL returned.' });
          return;
        }
        setUploadedEvidenceImageUrl(imagePublicUrl);
      }

      setSubmitStep('Submitting proposal...');
      const apiRes = await fetch('/api/gasless/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          trader: walletData.address,
          market_id: market.id,
          market_address: market.market_address,
          price,
          evidence_source_url: hasEvidenceSource ? evidenceUrlTrim : undefined,
          evidence_image_url: imagePublicUrl || undefined,
        }),
      });
      const apiData = await apiRes.json();

      if (!apiRes.ok) {
        setChallengeNotice({ type: 'error', text: apiData.error || 'Proposal failed.' });
        return;
      }

      if (apiData.txHash) setChallengeTxHash(apiData.txHash);

      setChallengePrice('');
      setEvidenceSourceUrl('');
      setEvidenceImageFile(null);
      setUploadedEvidenceImageUrl(null);
      setChallengeNotice({ type: 'success', text: 'Proposal submitted successfully.' });
      refreshVaultBalance();
      onChallengeSaved?.();
    } catch (err: any) {
      const msg = err?.reason || err?.message || 'Submission failed';
      setChallengeNotice({ type: 'error', text: msg.length > 100 ? msg.slice(0, 100) + '...' : msg });
    } finally {
      setIsSubmitting(false);
      setSubmitStep('');
    }
  };

  const sourceUrl = market?.ai_source_locator?.url || market?.ai_source_locator?.primary_source_url;
  const settlementScreenshotUrl = market?.market_config?.settlement_screenshot_url || null;

  const formattedProposed = useMemo(() => {
    if (typeof market?.proposed_settlement_value === 'number') return market.proposed_settlement_value.toFixed(4);
    if (market?.proposed_settlement_value == null) return '0.0000';
    const v = Number(market.proposed_settlement_value);
    return Number.isFinite(v) ? v.toFixed(4) : '0.0000';
  }, [market?.proposed_settlement_value]);

  const formattedChallenge = useMemo(() => {
    if (typeof market?.alternative_settlement_value === 'number') return market.alternative_settlement_value.toFixed(4);
    if (market?.alternative_settlement_value == null) return null;
    const v = Number(market.alternative_settlement_value);
    return Number.isFinite(v) ? v.toFixed(4) : null;
  }, [market?.alternative_settlement_value]);

  const windowProgress = useMemo(() => {
    if (!market?.proposed_settlement_at || !windowExpiresMs) return 0;
    const start = new Date(market.proposed_settlement_at).getTime();
    const now = Date.now();
    if (now >= windowExpiresMs) return 100;
    if (now <= start) return 0;
    return Math.round(((now - start) / (windowExpiresMs - start)) * 100);
  }, [market?.proposed_settlement_at, windowExpiresMs]);

  if (!market) {
    return (
      <div className={`min-h-[50vh] flex items-center justify-center ${className}`}>
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 animate-pulse" />
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 opacity-20 blur-lg animate-pulse" />
          </div>
          <span className="text-xs text-t-fg-muted">Loading settlement data...</span>
        </div>
      </div>
    );
  }

  const isSettled = market?.market_status === 'SETTLED';
  const umaResolved = market?.market_config?.uma_resolved === true;
  const isUmaDispute = Boolean(market?.market_config?.uma_assertion_id);
  const proposedSettlementNum = Number(market?.proposed_settlement_value);
  const hasProposedPrice = Number.isFinite(proposedSettlementNum) && proposedSettlementNum > 0;

  const statusGradient = isSettled 
    ? 'from-blue-500 via-indigo-500 to-violet-500'
    : umaResolved 
      ? 'from-emerald-400 via-teal-500 to-cyan-500'
      : isExpired 
        ? 'from-rose-500 via-red-500 to-orange-500'
        : market?.settlement_disputed 
          ? 'from-amber-400 via-orange-500 to-rose-500'
          : 'from-emerald-400 via-cyan-500 to-blue-500';

  const statusLabel = isSettled 
    ? 'Finalized'
    : umaResolved 
      ? 'Verdict Reached'
      : isExpired 
        ? 'Expired'
        : market?.settlement_disputed 
          ? 'Disputed'
          : 'Active';

  return (
    <div className={`space-y-4 ${className}`}>
      
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-t-card via-t-card to-t-page">
        <div className={`absolute inset-0 bg-gradient-to-br ${statusGradient} opacity-[0.03]`} />
        <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r ${statusGradient}`} />
        
        <div className="relative p-6">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full bg-gradient-to-br ${statusGradient} shadow-lg`} 
                   style={{ boxShadow: `0 0 12px var(--tw-gradient-from)` }} />
              <div>
                <h2 className="text-sm font-medium text-t-fg">
                  {isSettled ? 'Settlement Complete' : 'Settlement Window'}
                </h2>
                <p className="text-xs text-t-fg-muted mt-0.5">{market.symbol}</p>
              </div>
            </div>
            <div className={`px-3 py-1.5 rounded-full bg-gradient-to-r ${statusGradient} bg-opacity-10`}>
              <span className={`text-[10px] font-semibold uppercase tracking-wider bg-gradient-to-r ${statusGradient} bg-clip-text text-transparent`}>
                {statusLabel}
              </span>
            </div>
          </div>

          <div className="flex items-end justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-t-fg-muted mb-1">
                {isSettled ? 'Final Price' : hasProposedPrice ? 'Proposed Price' : 'Awaiting Proposal'}
              </p>
              <p className={`text-3xl font-light tracking-tight ${hasProposedPrice || isSettled ? 'text-t-fg' : 'text-t-fg-muted'}`}>
                {hasProposedPrice || isSettled ? `$${formattedProposed}` : '—'}
              </p>
            </div>
            
            {!isSettled && !isUmaDispute && timeRemaining && (
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-t-fg-muted mb-1">Time Remaining</p>
                <p className={`text-lg font-mono ${isExpired ? 'text-rose-400' : 'text-t-fg'}`}>{timeRemaining}</p>
              </div>
            )}
            
            {isUmaDispute && !umaResolved && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                <span className="text-xs text-indigo-300">Awaiting DVM</span>
              </div>
            )}
          </div>

          {!isSettled && !isUmaDispute && (
            <div className="mt-6">
              <div className="flex items-center justify-between text-[10px] text-t-fg-muted mb-2">
                <span>Window Progress</span>
                <span className="font-mono">{windowProgress}%</span>
              </div>
              <div className="h-1.5 bg-t-inset rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full bg-gradient-to-r ${statusGradient} transition-all duration-1000`}
                  style={{ width: `${windowProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Evidence Screenshot */}
      {settlementScreenshotUrl && (
        <div className="relative overflow-hidden rounded-2xl bg-t-card">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-500/50 to-transparent" />
          
          <button
            onClick={() => setScreenshotExpanded(!screenshotExpanded)}
            className="w-full flex items-center justify-between p-4 hover:bg-t-card-hover transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 flex items-center justify-center">
                <svg className="w-4 h-4 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-t-fg">Evidence Screenshot</p>
                <p className="text-[10px] text-t-fg-muted">AI-captured at settlement time</p>
              </div>
            </div>
            <svg 
              className={`w-4 h-4 text-t-fg-muted transition-transform duration-300 ${screenshotExpanded ? 'rotate-180' : ''}`} 
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          <div className={`transition-all duration-300 ease-out ${screenshotExpanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'} overflow-hidden`}>
            <div className="px-4 pb-4">
              <a
                href={settlementScreenshotUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block relative rounded-xl overflow-hidden group"
              >
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={settlementScreenshotUrl}
                  alt="Settlement evidence"
                  className="w-full h-auto max-h-[500px] object-contain bg-black/20 group-hover:scale-[1.02] transition-transform duration-500"
                  loading="lazy"
                />
                <div className="absolute bottom-3 left-3 right-3 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-[10px] text-white/80">Click to view full resolution</span>
                </div>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Price Cards Grid */}
      <div className="grid gap-3 md:grid-cols-2">
        {/* Proposed Settlement */}
        <div className="relative overflow-hidden rounded-2xl bg-t-card p-4">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />
          
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-medium text-t-fg">{isSettled ? 'Final Price' : 'Proposed Settlement'}</p>
              <p className="text-[10px] text-t-fg-muted">
                {market.proposed_settlement_at ? new Date(market.proposed_settlement_at).toLocaleDateString() : 'Pending'}
              </p>
            </div>
          </div>
          
          <p className={`text-2xl font-light ${hasProposedPrice || isSettled ? 'text-t-fg' : 'text-t-fg-muted'}`}>
            {hasProposedPrice || isSettled ? `$${formattedProposed}` : '—'}
          </p>
        </div>

        {/* Evidence Source */}
        <div className="relative overflow-hidden rounded-2xl bg-t-card p-4">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
          
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-medium text-t-fg">Evidence Source</p>
              <p className="text-[10px] text-t-fg-muted">Primary data reference</p>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2">
            {sourceUrl && (
              <a 
                href={sourceUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 text-[11px] hover:bg-blue-500/20 transition-colors"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                Source
              </a>
            )}
            {market?.market_config?.settlement_wayback_url && (
              <a 
                href={market.market_config.settlement_wayback_url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-[11px] hover:bg-emerald-500/20 transition-colors"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                Archive
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Challenge Proposal (if disputed) */}
      {formattedChallenge && (
        <div className="relative overflow-hidden rounded-2xl bg-t-card">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-rose-500 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-br from-rose-500/[0.02] to-orange-500/[0.02]" />
          
          <div className="relative p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500/20 to-orange-500/20 flex items-center justify-center">
                  <svg className="w-4 h-4 text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-medium text-t-fg">Challenge Proposal</p>
                  <p className="text-[10px] text-t-fg-muted">Alternative price submitted</p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 text-[10px] font-medium">
                Disputed
              </span>
            </div>
            
            <p className="text-2xl font-light text-t-fg">${formattedChallenge}</p>
            
            <div className="mt-3 pt-3 border-t border-t-stroke-sub flex items-center justify-between text-[10px] text-t-fg-muted">
              <span>Challenged by {formatAddress(market.alternative_settlement_by)}</span>
              {market.alternative_settlement_at && (
                <span>{new Date(market.alternative_settlement_at).toLocaleString()}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* On-Chain Status */}
      {onChain && !onChainError && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="relative overflow-hidden rounded-2xl bg-t-card p-4">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/50 to-transparent" />
            
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/20 to-violet-500/20 flex items-center justify-center">
                <svg className="w-4 h-4 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-medium text-t-fg">On-Chain State</p>
                <p className="text-[10px] text-t-fg-muted">Lifecycle status</p>
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-sm text-t-fg">{LIFECYCLE_LABELS[onChain.lifecycleState] ?? `State ${onChain.lifecycleState}`}</span>
              {onChain.challengeBondAmount > 0 && (
                <span className={`text-[10px] ${isBondExempt ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {isBondExempt ? 'Bond Exempt' : `Bond: $${onChain.challengeBondAmount.toLocaleString()}`}
                </span>
              )}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl bg-t-card p-4">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
            
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                <svg className="w-4 h-4 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-medium text-t-fg">Evidence Hash</p>
                <p className="text-[10px] text-t-fg-muted">On-chain commitment</p>
              </div>
            </div>
            
            {onChain.evidenceHash && onChain.evidenceHash !== '0x0000000000000000000000000000000000000000000000000000000000000000' ? (
              <p className="text-[10px] font-mono text-t-fg-sub truncate">{onChain.evidenceHash}</p>
            ) : (
              <p className="text-xs text-t-fg-muted">No evidence committed</p>
            )}
          </div>
        </div>
      )}

      {/* UMA Dispute Status */}
      {market?.market_config?.uma_assertion_id && (market?.settlement_disputed || market?.market_config?.uma_resolved) && (
        <div className="relative overflow-hidden rounded-2xl bg-t-card">
          <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r ${
            market.market_config.uma_resolved
              ? market.market_config.uma_challenger_won
                ? 'from-transparent via-emerald-500 to-transparent'
                : 'from-transparent via-blue-500 to-transparent'
              : 'from-transparent via-indigo-500 to-transparent'
          }`} />
          
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  market.market_config.uma_resolved
                    ? market.market_config.uma_challenger_won
                      ? 'bg-gradient-to-br from-emerald-500/20 to-teal-500/20'
                      : 'bg-gradient-to-br from-blue-500/20 to-indigo-500/20'
                    : 'bg-gradient-to-br from-indigo-500/20 to-purple-500/20'
                }`}>
                  <div className={`w-2 h-2 rounded-full ${
                    market.market_config.uma_resolved
                      ? market.market_config.uma_challenger_won ? 'bg-emerald-400' : 'bg-blue-400'
                      : 'bg-indigo-400 animate-pulse'
                  }`} />
                </div>
                <div>
                  <p className="text-xs font-medium text-t-fg">
                    {market.market_config.uma_resolved ? 'UMA Resolved' : 'UMA Dispute'}
                  </p>
                  <p className="text-[10px] text-t-fg-muted">
                    {market.market_config.uma_resolved
                      ? market.market_config.uma_challenger_won ? 'Challenger won' : 'Proposer won'
                      : 'Awaiting DVM vote'}
                  </p>
                </div>
              </div>
              
              {market.market_config.uma_resolved && (
                <p className="text-lg font-light text-t-fg">
                  ${Number(market.market_config.uma_winning_price || market.proposed_settlement_value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                </p>
              )}
            </div>

            {!market.market_config.uma_resolved && (
              <p className="text-[10px] text-indigo-400/80">
                Dispute being resolved by UMA DVM vote. Typically 48-96 hours.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Proposal Form */}
      {!isSettled && (
        <div className="relative overflow-hidden rounded-2xl bg-t-card">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-fuchsia-500/50 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-500/[0.02] to-violet-500/[0.02]" />
          
          <div className="relative p-5">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-fuchsia-500/20 to-violet-500/20 flex items-center justify-center">
                  <svg className="w-4 h-4 text-fuchsia-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 19l7-7 3 3-7 7-3-3z" />
                    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                    <path d="M2 2l7.586 7.586" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-t-fg">Submit Proposal</p>
                  <p className="text-[10px] text-t-fg-muted">Propose a settlement price</p>
                </div>
              </div>
              
              {onChain && onChain.challengeBondAmount > 0 && (
                <span className={`text-[10px] px-2.5 py-1 rounded-full ${
                  isBondExempt ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                }`}>
                  {isBondExempt ? 'Bond Exempt' : `Bond: $${onChain.challengeBondAmount.toLocaleString()}`}
                </span>
              )}
            </div>

            <div className="space-y-4">
              {/* Price Input */}
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-t-fg-muted mb-2">
                  Settlement Price (USDC)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-t-fg-muted">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.0000"
                    value={challengePrice}
                    onChange={(e) => setChallengePrice(e.target.value)}
                    disabled={isSubmitting || isExpired || !hasSufficientBalance}
                    className="w-full bg-t-inset text-t-fg text-sm rounded-xl pl-8 pr-4 py-3 border border-t-stroke focus:border-fuchsia-500/50 focus:ring-1 focus:ring-fuchsia-500/20 outline-none font-mono placeholder-t-fg-muted disabled:opacity-50 transition-all"
                  />
                </div>
              </div>

              {/* Evidence Section */}
              <div className="space-y-3">
                <label className="block text-[10px] uppercase tracking-wider text-t-fg-muted">
                  Supporting Evidence
                </label>
                
                <input
                  type="url"
                  placeholder="https://source-url.com/..."
                  value={evidenceSourceUrl}
                  onChange={(e) => setEvidenceSourceUrl(e.target.value)}
                  disabled={isSubmitting || isExpired || !hasSufficientBalance}
                  className={`w-full bg-t-inset text-t-fg text-sm rounded-xl px-4 py-3 border outline-none font-mono placeholder-t-fg-muted disabled:opacity-50 transition-all ${
                    evidenceUrlTrim !== '' && !isValidHttpUrl(evidenceUrlTrim)
                      ? 'border-rose-500/50 focus:border-rose-500'
                      : 'border-t-stroke focus:border-fuchsia-500/50'
                  }`}
                />

                <div className="relative">
                  <input
                    ref={evidenceFileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    disabled={isSubmitting || isExpired || !hasSufficientBalance}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setEvidenceImageFile(f);
                      setUploadedEvidenceImageUrl(null);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    disabled={isSubmitting || isExpired || !hasSufficientBalance}
                    onClick={() => evidenceFileInputRef.current?.click()}
                    className="w-full rounded-xl border border-dashed border-t-stroke hover:border-fuchsia-500/30 bg-t-inset px-4 py-4 text-center transition-colors disabled:opacity-50 group"
                  >
                    {evidenceImageFile ? (
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-xs text-t-fg">{evidenceImageFile.name}</span>
                        {evidencePreviewUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={evidencePreviewUrl} alt="Preview" className="max-h-20 rounded-lg border border-t-stroke object-contain" />
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1.5">
                        <div className="w-10 h-10 rounded-xl bg-t-card-hover flex items-center justify-center group-hover:bg-fuchsia-500/10 transition-colors">
                          <svg className="w-5 h-5 text-t-fg-muted group-hover:text-fuchsia-400 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
                            <path d="M12 12v9" />
                            <path d="m16 16-4-4-4 4" />
                          </svg>
                        </div>
                        <span className="text-[10px] text-t-fg-muted">Upload screenshot (max 4MB)</span>
                      </div>
                    )}
                  </button>
                  {evidenceImageFile && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => {
                        setEvidenceImageFile(null);
                        setUploadedEvidenceImageUrl(null);
                      }}
                      className="mt-2 text-[10px] text-t-fg-muted hover:text-rose-400 transition-colors"
                    >
                      Remove image
                    </button>
                  )}
                </div>
              </div>

              {/* Balance indicator */}
              {onChain && onChain.challengeBondAmount > 0 && walletData?.address && !isBondExempt && (
                <div className={`flex items-center justify-between px-3 py-2 rounded-xl ${
                  hasSufficientBalance ? 'bg-emerald-500/5 border border-emerald-500/20' : 'bg-rose-500/5 border border-rose-500/20'
                }`}>
                  <span className="text-[10px] text-t-fg-muted">
                    Required: <span className="text-t-fg font-mono">${onChain.challengeBondAmount.toLocaleString()}</span>
                  </span>
                  <span className={`text-[10px] font-mono ${hasSufficientBalance ? 'text-emerald-400' : 'text-rose-400'}`}>
                    Balance: ${availableBalanceNum.toFixed(2)}
                  </span>
                </div>
              )}

              {/* Notice */}
              {challengeNotice && (
                <div className={`px-3 py-2.5 rounded-xl text-xs ${
                  challengeNotice.type === 'error' 
                    ? 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                    : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                }`}>
                  {challengeNotice.text}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3">
                {walletData?.address && !hasSession ? (
                  <button
                    type="button"
                    onClick={handleEnableSession}
                    disabled={sessionLoading || isExpired}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-all"
                  >
                    {sessionLoading ? 'Creating session...' : 'Enable Gasless Trading'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleChallenge}
                    disabled={
                      !challengePrice ||
                      !evidenceComplete ||
                      !evidenceUrlFieldOk ||
                      isSubmitting ||
                      !walletData?.address ||
                      isExpired ||
                      !hasSufficientBalance ||
                      !hasSession
                    }
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-fuchsia-500 to-violet-500 text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:from-t-skeleton disabled:to-t-skeleton transition-all"
                  >
                    {isSubmitting ? (submitStep || 'Submitting...') : 'Submit Proposal'}
                  </button>
                )}
              </div>

              {challengeTxHash && (
                <p className="text-[10px] text-emerald-400 font-mono truncate">
                  Tx: {challengeTxHash}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settlement Info */}
      <div className="relative overflow-hidden rounded-2xl bg-t-card">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-t-fg-muted/20 to-transparent" />
        
        <div className="p-4">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-t-fg-muted/10 to-t-fg-muted/5 flex items-center justify-center">
              <svg className="w-4 h-4 text-t-fg-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </div>
            <p className="text-xs font-medium text-t-fg">How Settlement Works</p>
          </div>
          
          <div className="space-y-2 text-[10px] text-t-fg-muted leading-relaxed">
            {isSettled ? (
              <>
                <p>This market has been settled. The final price is locked and all positions have been resolved.</p>
                <p>Archived evidence and screenshots are preserved for reference.</p>
              </>
            ) : (
              <>
                <p>Anyone can propose a settlement price with supporting evidence. The AI worker proposes first and is bond-exempt.</p>
                <p>A bond is required to propose. It is returned when settlement finalizes unopposed.</p>
                <p>Evidence hash is committed on-chain for tamper-proof verification.</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettlementInterface;
