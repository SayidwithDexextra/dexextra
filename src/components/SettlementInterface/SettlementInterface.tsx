'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { useCoreVault } from '@/hooks/useCoreVault';
import { publicClient } from '@/lib/viemClient';
import { ethers } from 'ethers';
import { getActiveEthereumProvider, type EthereumProvider } from '@/lib/wallet';
import { getMagicProvider, switchMagicChainWithRetry } from '@/lib/magic';
import { getChainId } from '@/lib/network';
import { MarketLifecycleFacetABI } from '@/lib/contracts';
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

const LIFECYCLE_DOT_COLOR: Record<number, string> = {
  0: 'bg-[#404040]',
  1: 'bg-yellow-400',
  2: 'bg-yellow-400',
  3: 'bg-blue-400',
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

  const handleChallenge = async () => {
    if (!challengePrice) return;
    const price = Number(challengePrice);
    if (price <= 0 || !Number.isFinite(price)) { setChallengeNotice({ type: 'error', text: 'Enter a valid positive price.' }); return; }
    if (!walletData?.address) { setChallengeNotice({ type: 'error', text: 'Connect a wallet to propose a settlement price.' }); return; }
    if (!market?.id) { setChallengeNotice({ type: 'error', text: 'Market unavailable.' }); return; }
    if (!market?.market_address) { setChallengeNotice({ type: 'error', text: 'Market contract address not available.' }); return; }
    if (isExpired) { setChallengeNotice({ type: 'error', text: 'Settlement window already expired.' }); return; }
    if (!hasSufficientBalance) { setChallengeNotice({ type: 'error', text: `Insufficient balance. Need ${bondRequired.toLocaleString()} USDC, you have ${availableBalanceNum.toFixed(2)} USDC.` }); return; }
    if (!evidenceUrlFieldOk) { setChallengeNotice({ type: 'error', text: 'Evidence URL must be a valid http(s) link or left empty if you upload an image.' }); return; }
    if (!evidenceComplete) { setChallengeNotice({ type: 'error', text: 'Provide evidence: a source URL and/or a screenshot image.' }); return; }

    try {
      setIsSubmitting(true);
      setChallengeNotice(null);
      setChallengeTxHash(null);

      let imagePublicUrl = uploadedEvidenceImageUrl;
      if (evidenceImageFile && !imagePublicUrl) {
        setSubmitStep('Uploading evidence image...');
        const fd = new FormData();
        fd.append('file', evidenceImageFile);
        fd.append('market_id', market.id);
        const upRes = await fetch('/api/settlements/challenge-evidence', { method: 'POST', body: fd });
        const upJson = await upRes.json().catch(() => ({}));
        if (!upRes.ok) {
          setChallengeNotice({ type: 'error', text: upJson.error || 'Could not upload evidence image.' });
          return;
        }
        imagePublicUrl = typeof upJson.publicUrl === 'string' ? upJson.publicUrl : null;
        if (!imagePublicUrl) {
          setChallengeNotice({ type: 'error', text: 'Upload succeeded but no image URL was returned.' });
          return;
        }
        setUploadedEvidenceImageUrl(imagePublicUrl);
      }

      // Step 1: Call challengeSettlement on-chain via user's wallet
      setSubmitStep('Requesting wallet signature...');
      const alternativePriceWei = ethers.parseUnits(price.toFixed(6), 6);

      const preferred = typeof window !== 'undefined' ? window.localStorage.getItem('walletProvider') : null;
      const isMagic = preferred === 'magic';
      const eip1193: EthereumProvider | undefined =
        (isMagic ? (getMagicProvider() as any as EthereumProvider) : null) ??
        (getActiveEthereumProvider() ?? ((window as any).ethereum as EthereumProvider | undefined)) ??
        undefined;
      if (!eip1193) { setChallengeNotice({ type: 'error', text: 'No wallet provider found.' }); return; }

      if (isMagic) {
        await switchMagicChainWithRetry(getChainId(), { retries: 2 });
      }

      const browserProvider = new ethers.BrowserProvider(eip1193 as any);
      const signer = await browserProvider.getSigner();
      const marketContract = new ethers.Contract(
        market.market_address,
        MarketLifecycleFacetABI,
        signer,
      );

      setSubmitStep('Submitting on-chain proposal...');
      const tx = await marketContract.challengeSettlement(alternativePriceWei);
      setSubmitStep('Waiting for confirmation...');
      const receipt = await tx.wait();
      const txHash = receipt.hash;
      setChallengeTxHash(txHash);

      // Step 2: Record to Supabase and trigger UMA escalation via API
      setSubmitStep('Escalating to UMA...');
      const apiRes = await fetch('/api/settlements/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market_id: market.id,
          market_address: market.market_address,
          price,
          proposer_wallet: walletData.address,
          txHash,
          evidence_source_url: hasEvidenceSource ? evidenceUrlTrim : undefined,
          evidence_image_url: imagePublicUrl || undefined,
        }),
      });
      const apiData = await apiRes.json();

      if (!apiRes.ok) {
        setChallengeNotice({ type: 'error', text: apiData.error || 'Challenge recorded on-chain but API update failed.' });
        return;
      }

      setChallengePrice('');
      setEvidenceSourceUrl('');
      setEvidenceImageFile(null);
      setUploadedEvidenceImageUrl(null);
      const umaInfo = apiData.uma_assertion_id
        ? ` UMA Assertion: ${apiData.uma_assertion_id.slice(0, 10)}...`
        : '';
      setChallengeNotice({ type: 'success', text: `Proposal submitted on-chain. Escalated to UMA for verification.${umaInfo}` });
      refreshVaultBalance();
      onChallengeSaved?.();
    } catch (err: any) {
      const msg = err?.reason || err?.message || 'Transaction failed';
      if (msg.includes('user rejected') || msg.includes('ACTION_REJECTED')) {
        setChallengeNotice({ type: 'error', text: 'Transaction cancelled by user.' });
      } else {
        setChallengeNotice({ type: 'error', text: msg.length > 120 ? msg.slice(0, 120) + '...' : msg });
      }
    } finally {
      setIsSubmitting(false);
      setSubmitStep('');
    }
  };

  const sourceUrl = market?.ai_source_locator?.url || market?.ai_source_locator?.primary_source_url;
  const settlementWaybackUrl = market?.market_config?.settlement_wayback_url || null;
  const settlementWaybackPageUrl = market?.market_config?.settlement_wayback_page_url || null;
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

  const baseChallengeHelper = !walletData?.address
    ? 'Connect a wallet to propose a settlement price.'
    : isSubmitting
      ? (submitStep || 'Submitting proposal...')
      : 'Enter your proposed price, add supporting evidence, then confirm on-chain.';
  const helperText = challengeNotice?.text ?? baseChallengeHelper;
  const helperColor = challengeNotice?.type === 'error' ? 'text-red-400' : challengeNotice?.type === 'success' ? 'text-green-400' : 'text-[#606060]';

  const sourceHost = useMemo(() => {
    if (!sourceUrl) return null;
    try { return new URL(sourceUrl).hostname; } catch { return sourceUrl.replace(/^https?:\/\//, ''); }
  }, [sourceUrl]);

  const windowProgress = useMemo(() => {
    if (!market?.proposed_settlement_at || !windowExpiresMs) return 0;
    const start = new Date(market.proposed_settlement_at).getTime();
    const now = Date.now();
    if (now >= windowExpiresMs) return 100;
    if (now <= start) return 0;
    return Math.round(((now - start) / (windowExpiresMs - start)) * 100);
  }, [market?.proposed_settlement_at, windowExpiresMs]);

  /* ──────────────────────── Loading state ──────────────────────── */

  if (!market) {
    return (
      <div className={`min-h-[60vh] flex items-center justify-center ${className}`}>
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
          <div className="flex items-center justify-between p-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400 animate-pulse" />
              <span className="text-[11px] font-medium text-[#808080]">Loading settlement data</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-1 bg-[#2A2A2A] rounded-full overflow-hidden">
                <div className="h-full bg-blue-400 animate-pulse" style={{ width: '60%' }} />
              </div>
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isSettled = market?.market_status === 'SETTLED';
  const proposedSettlementNum = Number(market?.proposed_settlement_value);
  const hasProposedPrice = Number.isFinite(proposedSettlementNum) && proposedSettlementNum > 0;

  const statusDotClass = isSettled ? 'bg-blue-400'
    : isExpired ? 'bg-red-400'
    : market?.settlement_disputed ? 'bg-yellow-400'
    : 'bg-green-400';

  const statusAccent = isSettled ? 'from-blue-500 to-indigo-500'
    : isExpired ? 'from-red-500 to-rose-500'
    : market?.settlement_disputed ? 'from-yellow-400 to-amber-500'
    : 'from-green-400 to-emerald-500';

  const statusLabel = isSettled ? 'Finalized' : isExpired ? 'Expired' : market?.settlement_disputed ? 'Disputed' : 'Active';

  return (
    <div className={`space-y-1 ${className}`}>

      {/* ═══════ HERO HEADER ═══════ */}
      <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 relative overflow-hidden">
        <div className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r ${statusAccent}`} />

        <div className="flex items-start justify-between p-2.5 pt-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDotClass}`} />
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                {isSettled ? 'Settlement Result' : 'Settlement Window'}
              </span>
              <span className="text-[10px] text-[#606060]">•</span>
              <span className="text-[10px] text-white font-mono truncate">{market.symbol}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`text-[10px] font-medium px-1.5 py-0.5 rounded bg-gradient-to-r ${statusAccent} text-white`}>
              {statusLabel}
            </div>
            <div className={`w-1.5 h-1.5 rounded-full ${statusDotClass}`} />
          </div>
        </div>

        {/* Price + Timer row */}
        <div className="px-2.5 pb-2.5 border-t border-[#1A1A1A]">
          <div className="flex items-end justify-between pt-2">
            <div>
              <div className="text-[9px] uppercase tracking-wider text-[#606060] mb-0.5">
                {isSettled ? 'Final Price' : hasProposedPrice ? 'Proposed Price' : 'Awaiting Proposal'}
              </div>
              <div className={`text-lg font-mono font-semibold tracking-tight ${hasProposedPrice || isSettled ? 'text-white' : 'text-[#404040]'}`}>
                {hasProposedPrice || isSettled ? `$${formattedProposed}` : '—'}
              </div>
            </div>
            <div className="text-right">
              {!isSettled && timeRemaining && (
                <div className="flex items-center gap-1.5">
                  <svg className="w-3 h-3 text-[#606060]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span className={`text-[10px] font-mono ${isExpired ? 'text-red-400' : 'text-white'}`}>{timeRemaining}</span>
                </div>
              )}
              <div className="text-[9px] text-[#606060] font-mono mt-0.5 truncate max-w-[200px]">{market.market_identifier}</div>
            </div>
          </div>

          {/* Progress bar */}
          {!isSettled && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-[9px] text-[#606060] mb-1">
                <span>Window Progress</span>
                <span className="font-mono text-[#808080]">{windowProgress}%</span>
              </div>
              <div className="h-1 bg-[#2A2A2A] rounded-full overflow-hidden">
                <div className={`h-full rounded-full bg-gradient-to-r ${statusAccent} transition-all duration-1000 ease-out`} style={{ width: `${windowProgress}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══════ SCREENSHOT / EVIDENCE IMAGE ═══════ */}
      {settlementScreenshotUrl && (
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-blue-400 to-purple-500" />

          <div className="flex items-center justify-between p-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="text-[11px] font-medium text-[#808080]">Evidence Screenshot</span>
                <span className="text-[9px] text-[#606060]">AI-captured at settlement time</span>
              </div>
            </div>
            <button
              onClick={() => setScreenshotExpanded(!screenshotExpanded)}
              className="text-[10px] text-[#808080] hover:text-white flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#1A1A1A] hover:bg-[#2A2A2A] transition-all duration-200"
            >
              {screenshotExpanded ? 'Collapse' : 'Expand'}
              <svg className={`w-3 h-3 transition-transform duration-200 ${screenshotExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>

          <div className={`transition-all duration-300 ease-in-out ${screenshotExpanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'} overflow-hidden`}>
            <div className="px-2.5 pb-2.5 border-t border-[#1A1A1A]">
              <a
                href={settlementScreenshotUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group/img block relative rounded-md overflow-hidden border border-[#222222] hover:border-[#333333] transition-all duration-200 mt-2"
              >
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover/img:opacity-100 transition-opacity z-10" />
                <div className="absolute bottom-2 left-2 right-2 z-20 opacity-0 group-hover/img:opacity-100 transition-opacity">
                  <span className="text-[9px] text-white/80">Click to open full resolution</span>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={settlementScreenshotUrl}
                  alt="Settlement metric source screenshot"
                  className="w-full h-auto max-h-[500px] object-contain bg-black/20 group-hover/img:scale-[1.005] transition-transform duration-500"
                  loading="lazy"
                />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ PRICE & SOURCE CARDS ═══════ */}
      <div className="grid gap-1 md:grid-cols-2">

        {/* Proposed Settlement Card */}
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-green-400/50 to-emerald-500/50" />
          <div className="flex items-center justify-between p-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
              <span className="text-[11px] font-medium text-[#808080]">{isSettled ? 'Final Price' : hasProposedPrice ? 'Proposed Settlement' : 'Settlement Price'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-mono font-semibold ${hasProposedPrice || isSettled ? 'text-white' : 'text-[#404040]'}`}>{hasProposedPrice || isSettled ? `$${formattedProposed}` : '—'}</span>
              {hasProposedPrice || isSettled ? (
                <div className="text-[10px] text-green-400 bg-[#1A1A1A] px-1.5 py-0.5 rounded">Proposed</div>
              ) : (
                <div className="text-[10px] text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded">Awaiting</div>
              )}
            </div>
          </div>
          <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
            <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
              <div className="text-[9px] pt-1.5 text-[#606060] space-y-1">
                <div className="flex justify-between">
                  <span>Submitted</span>
                  <span className="text-white font-mono">{market.proposed_settlement_at ? new Date(market.proposed_settlement_at).toLocaleString() : '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Window Expires</span>
                  <span className="text-white font-mono">{windowExpiresMs ? new Date(windowExpiresMs).toLocaleString() : 'Awaiting activation'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Evidence Source Card */}
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-blue-400/50 to-indigo-500/50" />
          <div className="flex items-center justify-between p-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
              <span className="text-[11px] font-medium text-[#808080]">Evidence Source</span>
            </div>
            <div className="flex items-center gap-2">
              {sourceUrl && (
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400 hover:text-blue-300 underline truncate max-w-[140px]">{sourceHost}</a>
              )}
              {settlementWaybackUrl && (
                <a href={settlementWaybackUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
                  <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none"><path d="M2 13h12M3 3h10M4 3v10M12 3v10M8 3v10M2 8h12M5.5 3v10M10.5 3v10" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
                  <span className="underline">Snapshot</span>
                </a>
              )}
              {settlementWaybackPageUrl && (
                <a href={settlementWaybackPageUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-1">
                  <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none"><path d="M3 2h7l3 3v9H3V2z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/><path d="M10 2v3h3M5 8h6M5 10.5h6" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
                  <span className="underline">Page</span>
                </a>
              )}
              {settlementScreenshotUrl && (
                <button onClick={() => setScreenshotExpanded(!screenshotExpanded)} className="text-[10px] text-[#9CA3AF] hover:text-white flex items-center gap-1 transition-colors">
                  <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1"/><circle cx="5.5" cy="6.5" r="1" stroke="currentColor" strokeWidth="0.75"/><path d="M2 11l3-3 2 2 3-4 4 5" stroke="currentColor" strokeWidth="0.75" strokeLinejoin="round"/></svg>
                  <span>{screenshotExpanded ? 'Hide' : 'View'}</span>
                </button>
              )}
            </div>
          </div>
          <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
            <div className="text-[9px] pt-1.5 text-[#606060] space-y-0.5">
              {settlementWaybackUrl && (
                <div className="flex items-center gap-1"><div className="w-1 h-1 rounded-full bg-emerald-400/60" />Screenshot archived to Wayback Machine at settlement time.</div>
              )}
              {settlementWaybackPageUrl && (
                <div className="flex items-center gap-1"><div className="w-1 h-1 rounded-full bg-amber-400/60" />Original source page archived to Wayback Machine.</div>
              )}
              {settlementScreenshotUrl && !settlementWaybackUrl && !settlementWaybackPageUrl && (
                <div className="flex items-center gap-1"><div className="w-1 h-1 rounded-full bg-blue-400/60" />AI screenshot available. Click View to inspect.</div>
              )}
              {!settlementWaybackUrl && !settlementWaybackPageUrl && !settlementScreenshotUrl && sourceUrl && (
                <div>Live metric source. No archive available.</div>
              )}
              {!settlementWaybackUrl && !settlementWaybackPageUrl && !settlementScreenshotUrl && !sourceUrl && (
                <div>No primary source attached.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════ CHALLENGE PROPOSAL (if disputed) ═══════ */}
      {formattedChallenge && (
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-red-500/20 hover:border-red-500/30 transition-all duration-200 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-red-500 to-rose-500" />
          <div className="flex items-center justify-between p-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400 animate-pulse" />
              <span className="text-[11px] font-medium text-[#808080]">Challenge Proposal</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-white font-mono font-semibold">${formattedChallenge}</span>
              <div className="text-[10px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">Disputed</div>
            </div>
          </div>
          {(market.market_config?.challenger_evidence?.source_url || market.market_config?.challenger_evidence?.image_url) && (
            <div className="px-2.5 pb-2 flex flex-wrap gap-1.5">
              {market.market_config.challenger_evidence?.source_url && (
                <a
                  href={market.market_config.challenger_evidence.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[9px] px-2 py-0.5 rounded border border-red-500/25 bg-red-500/10 text-red-200 hover:border-red-400/40 hover:bg-red-500/15 transition-colors"
                >
                  Challenger source
                </a>
              )}
              {market.market_config.challenger_evidence?.image_url && (
                <a
                  href={market.market_config.challenger_evidence.image_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[9px] px-2 py-0.5 rounded border border-red-500/25 bg-red-500/10 text-red-200 hover:border-red-400/40 hover:bg-red-500/15 transition-colors"
                >
                  Challenger image
                </a>
              )}
            </div>
          )}
          <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
            <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
              <div className="text-[9px] pt-1.5 text-[#606060] space-y-1">
                <div className="flex justify-between">
                  <span>Challenged By</span>
                  <span className="text-white font-mono">{formatAddress(market.alternative_settlement_by)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Timestamp</span>
                  <span className="text-white font-mono">{market.alternative_settlement_at ? new Date(market.alternative_settlement_at).toLocaleString() : '—'}</span>
                </div>
                {(market.market_config?.challenger_evidence?.source_url || market.market_config?.challenger_evidence?.image_url) && (
                  <div className="pt-1 space-y-0.5 border-t border-[#222222] mt-1">
                    {market.market_config.challenger_evidence?.source_url && (
                      <div className="flex justify-between gap-2 items-start">
                        <span className="flex-shrink-0">Evidence URL</span>
                        <a
                          href={market.market_config.challenger_evidence.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-red-300 hover:text-red-200 underline truncate text-right"
                        >
                          Link
                        </a>
                      </div>
                    )}
                    {market.market_config.challenger_evidence?.image_url && (
                      <div className="flex justify-between gap-2 items-start">
                        <span className="flex-shrink-0">Screenshot</span>
                        <a
                          href={market.market_config.challenger_evidence.image_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-red-300 hover:text-red-200 underline truncate text-right"
                        >
                          Open image
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ ON-CHAIN VERIFICATION ═══════ */}
      {onChain && !onChainError && (
        <div className="grid gap-1 md:grid-cols-2">
          {/* On-Chain Lifecycle */}
          <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-purple-400/40 to-violet-500/40" />
            <div className="flex items-center justify-between p-2.5">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${LIFECYCLE_DOT_COLOR[onChain.lifecycleState] || 'bg-green-400'}`} />
                <span className="text-[11px] font-medium text-[#808080]">On-Chain Lifecycle</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white font-mono">{LIFECYCLE_LABELS[onChain.lifecycleState] ?? `State ${onChain.lifecycleState}`}</span>
                <div className="text-[10px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">On-Chain</div>
              </div>
            </div>
            <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
              <div className="text-[9px] pt-1.5 text-[#606060] space-y-1">
                {onChain.challengeBondAmount > 0 && (
                  <div className="flex justify-between">
                    <span>Proposal Bond</span>
                    {isBondExempt ? (
                      <span className="text-green-400 font-mono">Exempt</span>
                    ) : (
                      <span className="text-white font-mono">${onChain.challengeBondAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC</span>
                    )}
                  </div>
                )}
                {onChain.slashRecipient && onChain.slashRecipient !== '0x0000000000000000000000000000000000000000' && (
                  <div className="flex justify-between">
                    <span>Slash Recipient</span>
                    <span className="text-white font-mono">{formatAddress(onChain.slashRecipient)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Evidence Commitment */}
          <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-cyan-400/40 to-blue-500/40" />
            <div className="flex items-center justify-between p-2.5">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${onChain.evidenceHash && onChain.evidenceHash !== '0x0000000000000000000000000000000000000000000000000000000000000000' ? 'bg-emerald-400' : 'bg-[#404040]'}`} />
                <span className="text-[11px] font-medium text-[#808080]">Evidence Commitment</span>
              </div>
              <div className="text-[10px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">On-Chain</div>
            </div>
            <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
              <div className="text-[9px] pt-1.5 text-[#606060] space-y-1">
                {onChain.evidenceHash && onChain.evidenceHash !== '0x0000000000000000000000000000000000000000000000000000000000000000' ? (
                  <>
                    <div className="flex justify-between">
                      <span>Hash</span>
                      <span className="text-white font-mono text-[8px] truncate max-w-[180px]" title={onChain.evidenceHash}>
                        {onChain.evidenceHash.slice(0, 10)}...{onChain.evidenceHash.slice(-8)}
                      </span>
                    </div>
                    {onChain.evidenceUrl && (
                      <div className="flex justify-between items-center">
                        <span>Archived Source</span>
                        <a href={onChain.evidenceUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-2 truncate max-w-[180px]">
                          Wayback Archive
                        </a>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-[#404040]">No evidence committed on-chain yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ ON-CHAIN ACTIVE CHALLENGE ═══════ */}
      {onChain && onChain.challengeActive && (
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-red-500/30 hover:border-red-500/50 transition-all duration-200 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-red-500 via-rose-500 to-red-500 animate-pulse" />
          <div className="flex items-center justify-between p-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400 animate-pulse" />
              <span className="text-[11px] font-medium text-[#808080]">On-Chain Challenge</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-red-400 font-mono">${onChain.challengedPrice.toLocaleString(undefined, { minimumFractionDigits: 4 })}</span>
              <div className={`text-[10px] px-1.5 py-0.5 rounded ${
                onChain.challengeResolved
                  ? onChain.challengerWon ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'
                  : 'text-red-400 bg-red-500/10'
              }`}>
                {onChain.challengeResolved ? (onChain.challengerWon ? 'Won' : 'Slashed') : 'Active'}
              </div>
            </div>
          </div>
          <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
            <div className="text-[9px] pt-1.5 text-[#606060] space-y-1">
              <div className="flex justify-between">
                <span>Challenger</span>
                <span className="text-white font-mono">{formatAddress(onChain.challenger)}</span>
              </div>
              <div className="flex justify-between">
                <span>Bond Escrowed</span>
                <span className="text-white font-mono">${onChain.bondEscrowed.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC</span>
              </div>
              {onChain.challengeResolved && (
                <div className="flex justify-between">
                  <span>Outcome</span>
                  <span className={`font-mono ${onChain.challengerWon ? 'text-green-400' : 'text-red-400'}`}>
                    {onChain.challengerWon ? 'Bond refunded' : 'Bond slashed'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════ UMA DISPUTE STATUS ═══════ */}
      {market?.settlement_disputed && market?.market_config?.uma_assertion_id && (
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-indigo-500/20 hover:border-indigo-500/30 transition-all duration-200 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500" />
          <div className="flex items-center justify-between p-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                market.market_config.uma_resolved
                  ? market.market_config.uma_challenger_won ? 'bg-green-400' : 'bg-red-400'
                  : 'bg-indigo-400 animate-pulse'
              }`} />
              <span className="text-[11px] font-medium text-[#808080]">UMA Dispute Resolution</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`text-[10px] px-1.5 py-0.5 rounded ${
                market.market_config.uma_resolved
                  ? market.market_config.uma_challenger_won
                    ? 'text-green-400 bg-green-500/10'
                    : 'text-red-400 bg-red-500/10'
                  : 'text-indigo-400 bg-indigo-500/10'
              }`}>
                {market.market_config.uma_resolved
                  ? market.market_config.uma_challenger_won ? 'Challenger Won' : 'Proposer Won'
                  : 'Awaiting DVM Vote'}
              </div>
            </div>
          </div>
          <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
            <div className="text-[9px] pt-1.5 text-[#606060] space-y-1">
              <div className="flex justify-between">
                <span>Assertion ID</span>
                <span className="text-white font-mono text-[8px] truncate max-w-[200px]" title={market.market_config.uma_assertion_id}>
                  {market.market_config.uma_assertion_id.slice(0, 10)}...{market.market_config.uma_assertion_id.slice(-8)}
                </span>
              </div>
              {market.market_config.uma_escalated_at && (
                <div className="flex justify-between">
                  <span>Escalated</span>
                  <span className="text-white font-mono">{new Date(market.market_config.uma_escalated_at).toLocaleString()}</span>
                </div>
              )}
              {market.market_config.uma_escalation_tx && (
                <div className="flex justify-between">
                  <span>Escalation Tx</span>
                  <span className="text-indigo-400 font-mono text-[8px] truncate max-w-[200px]">
                    {market.market_config.uma_escalation_tx.slice(0, 10)}...{market.market_config.uma_escalation_tx.slice(-8)}
                  </span>
                </div>
              )}
              {market.market_config.uma_resolved && market.market_config.uma_resolved_at && (
                <div className="flex justify-between">
                  <span>Resolved</span>
                  <span className="text-white font-mono">{new Date(market.market_config.uma_resolved_at).toLocaleString()}</span>
                </div>
              )}
              {market.market_config.uma_resolution_tx && (
                <div className="flex justify-between">
                  <span>Resolution Tx</span>
                  <span className="text-indigo-400 font-mono text-[8px] truncate max-w-[200px]">
                    {market.market_config.uma_resolution_tx.slice(0, 10)}...{market.market_config.uma_resolution_tx.slice(-8)}
                  </span>
                </div>
              )}
              {!market.market_config.uma_resolved && (
                <div className="flex items-center gap-1 mt-1">
                  <div className="w-1 h-1 rounded-full bg-indigo-400 animate-pulse" />
                  <span className="text-indigo-400/80">Dispute is being resolved by UMA&apos;s DVM token-holder vote. This typically takes 48-96 hours.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════ CHALLENGE FORM & SETTLEMENT STATUS ═══════ */}
      <div className={`grid gap-1 ${isSettled ? 'md:grid-cols-1' : 'md:grid-cols-2'}`}>
        {!isSettled && (
          <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-red-400/40 to-orange-500/40" />
            <div className="flex items-center justify-between p-2.5">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
                <span className="text-[11px] font-medium text-[#808080]">Propose Settlement Price</span>
              </div>
              {onChain && onChain.challengeBondAmount > 0 && (
                <div className={`text-[10px] px-1.5 py-0.5 rounded ${isBondExempt ? 'text-green-400 bg-green-500/10' : 'text-yellow-400 bg-yellow-500/10'}`}>
                  {isBondExempt ? 'Bond Exempt' : `Bond: $${onChain.challengeBondAmount.toLocaleString()} USDC`}
                </div>
              )}
            </div>
            <div className="px-2.5 pb-2.5 border-t border-[#1A1A1A]">
              <div className="pt-2 space-y-3">
                {onChain && onChain.challengeBondAmount > 0 && walletData?.address && !isBondExempt && (
                  <div className={`flex items-center justify-between text-[10px] px-2 py-1.5 rounded border ${
                    hasSufficientBalance
                      ? 'border-green-500/20 bg-green-500/5'
                      : 'border-red-500/20 bg-red-500/5'
                  }`}>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${hasSufficientBalance ? 'bg-green-400' : 'bg-red-400'}`} />
                      <span className="text-[#808080]">Bond: <span className="text-white font-mono">${onChain.challengeBondAmount.toLocaleString()}</span></span>
                    </div>
                    <span className="text-[#808080]">Balance: <span className={`font-mono ${hasSufficientBalance ? 'text-green-400' : 'text-red-400'}`}>${availableBalanceNum.toFixed(2)}</span></span>
                  </div>
                )}

                <div className="rounded-md border border-[#2A2A2A] bg-[#0A0A0A] p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-[#9CA3AF]">Your proposal</span>
                    {evidenceComplete && evidenceUrlFieldOk && (
                      <span className="text-[9px] text-emerald-400/90">Evidence ready</span>
                    )}
                  </div>
                  <div>
                    <label className="text-[9px] uppercase tracking-wide text-[#606060] block mb-1">Proposed settlement price (USDC)</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-[#606060]">$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.0000"
                        value={challengePrice}
                        onChange={(e) => setChallengePrice(e.target.value)}
                        disabled={isSubmitting || isExpired || !hasSufficientBalance}
                        className="w-full bg-[#0F0F0F] text-white text-[11px] border border-[#222222] rounded-md px-4 py-2 outline-none focus:border-red-500/30 focus:ring-1 focus:ring-red-500/20 font-mono placeholder-[#404040] disabled:opacity-50 transition-all duration-200"
                      />
                    </div>
                  </div>

                  <div className="border-t border-[#222222] pt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] uppercase tracking-wide text-[#606060]">Supporting evidence</span>
                      <span className="text-[9px] text-[#505050]">required — URL and/or image</span>
                    </div>
                    <div>
                      <label className="text-[9px] text-[#707070] block mb-1">Source URL (metric page, archive, exchange, etc.)</label>
                      <input
                        type="url"
                        inputMode="url"
                        placeholder="https://…"
                        value={evidenceSourceUrl}
                        onChange={(e) => setEvidenceSourceUrl(e.target.value)}
                        disabled={isSubmitting || isExpired || !hasSufficientBalance}
                        className={`w-full bg-[#0F0F0F] text-white text-[10px] border rounded-md px-2 py-1.5 outline-none font-mono placeholder-[#404040] disabled:opacity-50 transition-all duration-200 ${
                          evidenceUrlTrim !== '' && !isValidHttpUrl(evidenceUrlTrim)
                            ? 'border-red-500/40 focus:border-red-500/50'
                            : 'border-[#222222] focus:border-red-500/30'
                        }`}
                      />
                    </div>
                    <div className="flex items-center gap-2 py-0.5">
                      <div className="h-px flex-1 bg-[#2A2A2A]" />
                      <span className="text-[8px] uppercase tracking-wider text-[#505050]">or</span>
                      <div className="h-px flex-1 bg-[#2A2A2A]" />
                    </div>
                    <div>
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
                        className="w-full rounded-md border border-dashed border-[#333333] hover:border-red-500/35 bg-[#0F0F0F] px-2 py-3 text-center transition-colors disabled:opacity-50"
                      >
                        <span className="text-[10px] text-[#808080] block">
                          {evidenceImageFile ? evidenceImageFile.name : 'Upload screenshot (JPEG, PNG, WebP, GIF · max 4MB)'}
                        </span>
                        {evidencePreviewUrl && (
                          <div className="mt-2 flex justify-center">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={evidencePreviewUrl} alt="Evidence preview" className="max-h-24 rounded border border-[#2A2A2A] object-contain" />
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
                          className="mt-1 text-[9px] text-[#606060] hover:text-red-300 transition-colors"
                        >
                          Remove image
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
                      !hasSufficientBalance
                    }
                    className="shrink-0 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-200 hover:bg-red-500/15 hover:border-red-400/40 disabled:border-[#2A2A2A] disabled:bg-transparent disabled:text-[#404040] transition-colors"
                  >
                    {isSubmitting ? (submitStep || 'Submitting…') : 'Sign & submit proposal'}
                  </button>
                  <span className={`text-[9px] ${helperColor} sm:max-w-[min(100%,280px)] sm:text-right`}>{helperText}</span>
                </div>
                {challengeTxHash && (
                  <div className="text-[9px] text-green-400/80 flex items-center gap-1 font-mono truncate">
                    On-chain tx: {challengeTxHash.slice(0, 10)}...{challengeTxHash.slice(-8)}
                  </div>
                )}
                {onChain && onChain.challengeBondAmount > 0 && (
                  <div className={`text-[9px] flex items-center gap-1 ${isBondExempt ? 'text-green-400/60' : 'text-yellow-400/60'}`}>
                    <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    {isBondExempt
                      ? 'Your address is bond-exempt. No bond will be deducted for this proposal.'
                      : `Bond of $${onChain.challengeBondAmount.toLocaleString()} USDC will be held from your CoreVault. Returned when settlement finalizes unopposed.`}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 relative overflow-hidden">
          <div className={`absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r ${isSettled ? 'from-blue-400/40 to-indigo-500/40' : 'from-green-400/40 to-emerald-500/40'}`} />
          <div className="flex items-center justify-between p-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isSettled ? 'bg-blue-400' : 'bg-green-400'}`} />
              <span className="text-[11px] font-medium text-[#808080]">{isSettled ? 'Final Settlement' : 'Settlement Status'}</span>
            </div>
            <span className="text-[10px] text-white font-mono">${formattedProposed}</span>
          </div>
          <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-[#606060]">Wallet</span>
                <span className="text-white font-mono">{walletLabel}</span>
              </div>
              <span className="text-[9px] text-[#606060] block">
                {isSettled
                  ? 'This market has been settled. The final price has been locked and positions resolved.'
                  : 'Settlement finalizes once the challenge window closes and the proposed price is accepted.'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════ SETTLEMENT PROCESS INFO ═══════ */}
      <div className="bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-indigo-400/30 to-violet-500/30" />
        <div className="flex items-center justify-between p-2.5">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
            <span className="text-[11px] font-medium text-[#808080]">Settlement Process</span>
          </div>
          <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">Info</div>
        </div>
        <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
          <div className="text-[9px] pt-1.5 space-y-1 text-[#606060]">
            {isSettled ? (
              <>
                <div className="flex items-center gap-1.5"><div className="w-1 h-1 rounded-full bg-blue-400" />Settlement finalized. Positions have been resolved at the final price.</div>
                <div className="flex items-center gap-1.5"><div className="w-1 h-1 rounded-full bg-blue-400" />Archived evidence and screenshots are preserved for the record.</div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5"><div className="w-1 h-1 rounded-full bg-green-400" />Anyone can propose a settlement price with supporting evidence. The AI worker proposes first and is bond-exempt.</div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1 h-1 rounded-full bg-blue-400" />
                  {onChain && onChain.challengeBondAmount > 0
                    ? isBondExempt
                      ? 'Your address is bond-exempt. No bond required to propose a settlement price.'
                      : `On-chain bond of $${onChain.challengeBondAmount.toLocaleString()} USDC required to propose. Bond is returned when settlement finalizes unopposed.`
                    : 'On-chain bond and archived evidence secure the process.'}
                </div>
                <div className="flex items-center gap-1.5"><div className="w-1 h-1 rounded-full bg-purple-400" />Evidence hash committed on-chain at proposal time for tamper-proof verification.</div>
                <div className="flex items-center gap-1.5"><div className="w-1 h-1 rounded-full bg-yellow-400" />If the AI worker fails to propose, any user can step in and propose a price by posting a bond and submitting evidence.</div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettlementInterface;
