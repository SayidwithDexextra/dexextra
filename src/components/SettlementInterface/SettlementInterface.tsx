'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { useCoreVault } from '@/hooks/useCoreVault';
import { useSession } from '@/contexts/SessionContext';
import { publicClient } from '@/lib/viemClient';
import { challengeWindowExpiresMs } from '@/lib/settlement-window';
import { useAllTrades } from '@/hooks/useAllTrades';
import EarningsPieChart, { type EarningsPieSlice } from '@/components/ui/EarningsPieChart';

interface SettlementMarket {
  id: string;
  symbol: string;
  market_identifier: string;
  market_status?: string;
  market_address?: string;
  icon_image_url?: string;
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

interface SettledPosition {
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  size: number;
  entryValue: number;
  exitValue: number;
  pnl: number;
  pnlPercent: number;
  totalFees: number;
  entryTime: number;
  exitTime: number;
  settledViaSettlement?: boolean;
}

interface SettlementPnLData {
  totalPnl: number;
  returnOnMargin: number;
  totalMarginUsed: number;
  totalFees: number;
  longCount: number;
  shortCount: number;
  longPnl: number;
  shortPnl: number;
  settledPositions?: SettledPosition[];
}

interface SettlementInterfaceProps {
  market?: SettlementMarket;
  className?: string;
  onChallengeSaved?: () => void;
  settlementPnl?: SettlementPnLData | null;
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

const styles = {
  surface: 'bg-[#0d0f14]',
  surface2: 'bg-[#14161e]',
  border: 'border-[#1a1d28]',
  borderAccent: 'border-[#282c3a]',
  text: 'text-[#d8dae2]',
  textDim: 'text-[#5c6178]',
  textMuted: 'text-[#505672]',
  green: '#00ff88',
  red: '#ff2a4a',
  accent: '#7c4dff',
  cyan: '#00e5ff',
  yellow: '#ffab00',
};

export function SettlementInterface({
  market,
  className = '',
  onChallengeSaved,
  settlementPnl,
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

  // Fetch all trades for market participant breakdown
  const { trades: allTrades, stats: tradeStats, loadInitial: loadAllTrades, isLoading: tradesLoading } = useAllTrades(market?.market_address);
  
  // Load trades when market address is available
  useEffect(() => {
    if (market?.market_address) {
      loadAllTrades();
    }
  }, [market?.market_address, loadAllTrades]);

  // Compute unique users breakdown from trades
  const userBreakdown = useMemo((): EarningsPieSlice[] => {
    if (!allTrades || allTrades.length === 0) return [];
    
    const volumeByUser = new Map<string, number>();
    
    for (const trade of allTrades) {
      const buyer = trade.buyer.toLowerCase();
      const seller = trade.seller.toLowerCase();
      const tradeVol = trade.tradeValue || 0;
      
      volumeByUser.set(buyer, (volumeByUser.get(buyer) || 0) + tradeVol);
      volumeByUser.set(seller, (volumeByUser.get(seller) || 0) + tradeVol);
    }
    
    // Sort by volume and take top users
    const sorted = Array.from(volumeByUser.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    
    // Group remaining into "Others" if more than 8 users
    const totalUsers = volumeByUser.size;
    const topVolume = sorted.reduce((s, [, v]) => s + v, 0);
    const totalVolume = Array.from(volumeByUser.values()).reduce((s, v) => s + v, 0);
    const othersVolume = totalVolume - topVolume;
    
    const slices: EarningsPieSlice[] = sorted.map(([addr, vol]) => ({
      label: `${addr.slice(0, 6)}...${addr.slice(-4)}`,
      value: vol,
    }));
    
    if (othersVolume > 0 && totalUsers > 8) {
      slices.push({
        label: `Others (${totalUsers - 8})`,
        value: othersVolume,
      });
    }
    
    return slices;
  }, [allTrades]);

  const uniqueUserCount = useMemo(() => {
    if (!allTrades || allTrades.length === 0) return 0;
    const users = new Set<string>();
    for (const trade of allTrades) {
      users.add(trade.buyer.toLowerCase());
      users.add(trade.seller.toLowerCase());
    }
    return users.size;
  }, [allTrades]);

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
      setTimeRemaining(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
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
    if (typeof market?.proposed_settlement_value === 'number') return String(market.proposed_settlement_value);
    if (market?.proposed_settlement_value == null) return '0';
    const v = Number(market.proposed_settlement_value);
    return Number.isFinite(v) ? String(market.proposed_settlement_value) : '0';
  }, [market?.proposed_settlement_value]);

  const formattedChallenge = useMemo(() => {
    if (typeof market?.alternative_settlement_value === 'number') return String(market.alternative_settlement_value);
    if (market?.alternative_settlement_value == null) return null;
    const v = Number(market.alternative_settlement_value);
    return Number.isFinite(v) ? String(market.alternative_settlement_value) : null;
  }, [market?.alternative_settlement_value]);

  const umaResolved = market?.market_config?.uma_resolved === true;
  const umaChallengerWon = market?.market_config?.uma_challenger_won === true;
  const umaWinningPrice = market?.market_config?.uma_winning_price;
  
  const { finalPrice, finalPriceFormatted, priceSource } = useMemo(() => {
    if (umaResolved && umaChallengerWon) {
      const winningVal = umaWinningPrice ?? market?.alternative_settlement_value;
      if (winningVal != null && Number.isFinite(Number(winningVal)) && Number(winningVal) > 0) {
        return { finalPrice: Number(winningVal), finalPriceFormatted: String(winningVal), priceSource: 'challenger' as const };
      }
    }
    if (umaResolved && !umaChallengerWon) {
      const proposedVal = market?.proposed_settlement_value;
      if (proposedVal != null && Number.isFinite(Number(proposedVal)) && Number(proposedVal) > 0) {
        return { finalPrice: Number(proposedVal), finalPriceFormatted: String(proposedVal), priceSource: 'proposer' as const };
      }
    }
    const proposedVal = market?.proposed_settlement_value;
    if (proposedVal != null && Number.isFinite(Number(proposedVal)) && Number(proposedVal) > 0) {
      return { finalPrice: Number(proposedVal), finalPriceFormatted: String(proposedVal), priceSource: 'proposed' as const };
    }
    return { finalPrice: 0, finalPriceFormatted: '0', priceSource: 'none' as const };
  }, [umaResolved, umaChallengerWon, umaWinningPrice, market?.alternative_settlement_value, market?.proposed_settlement_value]);

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
        <div className="flex items-center gap-3">
          <div 
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ background: styles.yellow, boxShadow: `0 0 8px ${styles.yellow}` }}
          />
          <span className="font-mono text-xs text-[#505672]">Loading settlement data...</span>
        </div>
      </div>
    );
  }

  const isSettled = market?.market_status === 'SETTLED';
  const isUmaDispute = Boolean(market?.market_config?.uma_assertion_id);
  const proposedSettlementNum = Number(market?.proposed_settlement_value);
  const hasProposedPrice = Number.isFinite(proposedSettlementNum) && proposedSettlementNum > 0;
  const hasFinalPrice = finalPrice > 0;

  const isDown = market?.settlement_disputed || (umaResolved && umaChallengerWon);
  const neonColor = isDown ? styles.red : styles.green;
  const neonGlow = isDown 
    ? '0 0 12px rgba(255,42,74,0.6), 0 0 40px rgba(255,42,74,0.3)' 
    : '0 0 20px rgba(0,255,136,0.4), 0 0 60px rgba(0,255,136,0.15)';

  const statusLabel = (isSettled || umaResolved)
    ? 'SETTLED'
    : isExpired 
      ? 'EXPIRED'
      : market?.settlement_disputed 
        ? 'DISPUTED'
        : 'ACTIVE';

  const userAddress = walletData?.address;
  const hasUserTrades = settlementPnl && (settlementPnl.longCount > 0 || settlementPnl.shortCount > 0);

  return (
    <div className={`font-sans ${className}`} style={{ fontFamily: "'Instrument Sans', sans-serif" }}>
      
      {/* Two Column Layout */}
      <div className="grid grid-cols-2 gap-4">
        
        {/* LEFT COLUMN - Settlement Result & Your Position */}
        <div className="space-y-3">
          
          {/* Settlement Hero Card */}
          <div 
            className="bg-[#0d0f14] border rounded-xl overflow-hidden"
            style={{ borderColor: '#1a1d28' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1a1d28]">
              <div className="flex items-center gap-2">
                <div 
                  className="w-[5px] h-[5px] rounded-full animate-pulse"
                  style={{ 
                    background: isExpired ? styles.red : isSettled ? styles.cyan : styles.green,
                    boxShadow: `0 0 6px ${isExpired ? styles.red : isSettled ? styles.cyan : styles.green}`
                  }}
                />
                <span className="font-mono text-[9px] uppercase tracking-[2px] text-[#505672] font-semibold">
                  {market.symbol}
                </span>
              </div>
              <span 
                className="font-mono text-[9px] uppercase tracking-[1px] px-2 py-0.5 rounded"
                style={{ 
                  color: isDown ? styles.red : isSettled ? styles.cyan : styles.green,
                  background: isDown ? 'rgba(255,42,74,0.08)' : isSettled ? 'rgba(0,229,255,0.06)' : 'rgba(0,255,136,0.08)',
                  border: `1px solid ${isDown ? 'rgba(255,42,74,0.15)' : isSettled ? 'rgba(0,229,255,0.12)' : 'rgba(0,255,136,0.15)'}`
                }}
              >
                {statusLabel}
              </span>
            </div>

            {/* Price Display */}
            <div className="text-center py-6 px-4">
              <div className="mb-1">
                <span className="font-mono text-[9px] uppercase tracking-[2px] text-[#505672] font-semibold">
                  {isSettled || umaResolved ? 'Final Settlement' : hasProposedPrice ? 'Proposed Price' : 'Settlement Price'}
                </span>
                {umaResolved && umaChallengerWon && (
                  <span className="ml-2 font-mono text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded text-[#00ff88] bg-[rgba(0,255,136,0.08)] border border-[rgba(0,255,136,0.15)]">
                    Challenger Won
                  </span>
                )}
              </div>
              
              <div 
                className="font-mono text-[28px] font-bold tracking-tight"
                style={{ 
                  color: neonColor,
                  textShadow: neonGlow,
                  animation: 'neonPulse 3s ease-in-out infinite'
                }}
              >
                {hasFinalPrice || isSettled ? `$${finalPriceFormatted}` : '—'}
              </div>

              {umaResolved && umaChallengerWon && formattedProposed && (
                <div className="mt-1 font-mono text-[11px] text-[#505672]">
                  <span className="line-through opacity-60">${formattedProposed}</span>
                  <span className="mx-2 text-[#5c6178]">→</span>
                  <span style={{ color: styles.green }}>${finalPriceFormatted}</span>
                </div>
              )}

              {!isSettled && !isUmaDispute && timeRemaining && (
                <div className="mt-3 flex items-center justify-center gap-2">
                  <span className="font-mono text-[9px] text-[#505672]">Expires in</span>
                  <span className={`font-mono text-xs font-semibold ${isExpired ? 'text-[#ff2a4a]' : 'text-[#d8dae2]'}`}>
                    {timeRemaining}
                  </span>
                </div>
              )}
            </div>

            {/* Progress bar */}
            {!isSettled && !isUmaDispute && windowProgress > 0 && (
              <div className="px-4 pb-4">
                <div className="h-1 bg-[#14161e] rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full transition-all duration-1000"
                    style={{ 
                      width: `${windowProgress}%`,
                      background: isExpired ? styles.red : styles.green,
                      boxShadow: `0 0 8px ${isExpired ? styles.red : styles.green}`
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* User Settlement Card */}
          {hasUserTrades && settlementPnl && (() => {
            const positions = settlementPnl.settledPositions || [];
            const direction = settlementPnl.longCount > 0 ? 'LONG' : 'SHORT';
            
            // Aggregate all positions to get total size and weighted average entry price
            const totalSize = positions.reduce((sum, p) => sum + p.size, 0);
            const weightedEntryPrice = totalSize > 0
              ? positions.reduce((sum, p) => sum + (p.entryPrice * p.size), 0) / totalSize
              : 0;
            // Exit price is the settlement price, same for all
            const exitPrice = positions[0]?.exitPrice ?? 0;
            
            const aggregatedPos = totalSize > 0 ? {
              size: totalSize,
              entryPrice: weightedEntryPrice,
              exitPrice,
            } : null;
            return (
              <div 
                className="bg-[#0d0f14] border rounded-xl overflow-hidden"
                style={{ 
                  borderColor: settlementPnl.totalPnl >= 0 ? 'rgba(0,255,136,0.2)' : 'rgba(255,42,74,0.2)',
                }}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1a1d28]">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-[#505672] font-semibold">
                    Your Position
                  </span>
                  <span 
                    className="font-mono text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                    style={{ 
                      color: direction === 'LONG' ? styles.green : styles.red,
                      background: direction === 'LONG' ? 'rgba(0,255,136,0.1)' : 'rgba(255,42,74,0.1)'
                    }}
                  >
                    {direction}
                  </span>
                </div>

                {/* Content */}
                <div className="p-4">
                  <div className="flex items-center gap-3 mb-4">
                    {/* Stacked Icons - User icon in front (larger), Market icon behind */}
                    <div className="relative w-12 h-12 flex-shrink-0">
                      {/* Market Icon (behind, smaller) */}
                      <div 
                        className="absolute top-0 left-0 w-7 h-7 rounded-md overflow-hidden border"
                        style={{ borderColor: '#282c3a', background: '#14161e' }}
                      >
                        {market.icon_image_url ? (
                          <img 
                            src={market.icon_image_url}
                            alt={market.symbol}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              const fallback = (e.target as HTMLImageElement).nextElementSibling;
                              if (fallback) fallback.classList.remove('hidden');
                            }}
                          />
                        ) : null}
                        <div className={`w-full h-full flex items-center justify-center text-[8px] font-bold text-[#5c6178] ${market.icon_image_url ? 'hidden' : ''}`}>
                          {market.symbol?.slice(0, 2) || '??'}
                        </div>
                      </div>
                      {/* User Icon (in front, larger) */}
                      <div 
                        className="absolute bottom-0 right-0 w-9 h-9 rounded-full overflow-hidden border-2 flex items-center justify-center"
                        style={{ 
                          borderColor: settlementPnl.totalPnl >= 0 ? 'rgba(0,255,136,0.4)' : 'rgba(255,42,74,0.4)',
                          background: '#1a1d28',
                          boxShadow: settlementPnl.totalPnl >= 0 
                            ? '0 0 8px rgba(0,255,136,0.2)' 
                            : '0 0 8px rgba(255,42,74,0.2)'
                        }}
                      >
                        {walletData?.userProfile?.profile_image_url ? (
                          <img 
                            src={walletData.userProfile.profile_image_url}
                            alt="Profile"
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              const fallback = (e.target as HTMLImageElement).nextElementSibling;
                              if (fallback) fallback.classList.remove('hidden');
                            }}
                          />
                        ) : null}
                        <svg className={`w-4 h-4 text-[#5c6178] ${walletData?.userProfile?.profile_image_url ? 'hidden' : ''}`} fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                        </svg>
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="font-mono text-[9px] text-[#505672] mb-0.5">
                        {userAddress ? `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}` : 'Trader'}
                      </div>
                      {aggregatedPos && (
                        <div className="font-mono text-[11px] text-[#d8dae2]">
                          {aggregatedPos.size.toFixed(4)} units
                        </div>
                      )}
                    </div>
                  </div>

                  {/* P&L Display */}
                  <div 
                    className="text-center py-3 rounded-lg mb-3"
                    style={{ background: settlementPnl.totalPnl >= 0 ? 'rgba(0,255,136,0.05)' : 'rgba(255,42,74,0.05)' }}
                  >
                    <div className="font-mono text-[9px] uppercase tracking-wider text-[#505672] mb-1">
                      {settlementPnl.totalPnl >= 0 ? 'Profit' : 'Loss'}
                    </div>
                    <div 
                      className="font-mono text-2xl font-bold"
                      style={{ color: settlementPnl.totalPnl >= 0 ? styles.green : styles.red }}
                    >
                      {settlementPnl.totalPnl >= 0 ? '+' : ''}${settlementPnl.totalPnl.toFixed(2)}
                    </div>
                    <div 
                      className="font-mono text-[11px] mt-0.5"
                      style={{ color: settlementPnl.returnOnMargin >= 0 ? 'rgba(0,255,136,0.7)' : 'rgba(255,42,74,0.7)' }}
                    >
                      {settlementPnl.returnOnMargin >= 0 ? '+' : ''}{settlementPnl.returnOnMargin.toFixed(1)}% ROI
                    </div>
                  </div>

                  {/* Trade Details */}
                  {aggregatedPos && (
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="bg-[#14161e] rounded-lg py-2 px-3">
                        <div className="font-mono text-[8px] uppercase tracking-wider text-[#505672] mb-1">Entry</div>
                        <div className="font-mono text-[12px] text-[#d8dae2]">${aggregatedPos.entryPrice.toFixed(2)}</div>
                      </div>
                      <div className="bg-[#14161e] rounded-lg py-2 px-3">
                        <div className="font-mono text-[8px] uppercase tracking-wider text-[#505672] mb-1">Exit</div>
                        <div className="font-mono text-[12px] text-[#d8dae2]">${aggregatedPos.exitPrice.toFixed(2)}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Evidence Screenshot */}
          {settlementScreenshotUrl && (
            <div className="bg-[#0d0f14] border border-[#1a1d28] rounded-xl overflow-hidden">
              <button
                onClick={() => setScreenshotExpanded(!screenshotExpanded)}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#14161e] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#7c4dff]" style={{ boxShadow: '0 0 6px #7c4dff' }} />
                  <span className="font-mono text-[9px] uppercase tracking-wider text-[#5c6178] font-semibold">
                    Evidence
                  </span>
                </div>
                <span className="font-mono text-[10px] text-[#505672]">
                  {screenshotExpanded ? '−' : '+'}
                </span>
              </button>

              <div className={`transition-all duration-300 ${screenshotExpanded ? 'max-h-[400px]' : 'max-h-0'} overflow-hidden`}>
                <div className="p-3 pt-0">
                  <a
                    href={settlementScreenshotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block relative rounded-lg overflow-hidden border border-[#1a1d28] hover:border-[#282c3a] transition-colors"
                  >
                    <img
                      src={settlementScreenshotUrl}
                      alt="Settlement evidence"
                      className="w-full h-auto max-h-[300px] object-contain bg-black/20"
                      loading="lazy"
                    />
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN - Settlement Details & Actions */}
        <div className="space-y-3">
          
          {/* Settlement Details Card */}
          <div className="bg-[#0d0f14] border border-[#1a1d28] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#1a1d28]">
              <span className="font-mono text-[9px] uppercase tracking-wider text-[#505672] font-semibold">
                Settlement Details
              </span>
            </div>
            
            <div className="p-4 space-y-3">
              {/* Asset & Status */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-mono text-[8px] uppercase tracking-wider text-[#505672] mb-1">Asset</div>
                  <div className="font-semibold text-[13px] text-[#d8dae2] tracking-tight">{market.symbol}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[8px] uppercase tracking-wider text-[#505672] mb-1">Final Price</div>
                  <div 
                    className="font-mono text-sm font-bold"
                    style={{ color: hasFinalPrice ? (umaResolved && umaChallengerWon ? styles.green : '#d8dae2') : '#505672' }}
                  >
                    {hasFinalPrice ? `$${finalPriceFormatted}` : '—'}
                  </div>
                </div>
              </div>

              {/* Challenge Info */}
              {formattedChallenge && (
                <div className="pt-3 border-t border-[#1a1d28]">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="font-mono text-[8px] uppercase tracking-wider text-[#505672] mb-1">Challenge Price</div>
                      <div 
                        className="font-mono text-sm font-semibold"
                        style={{ 
                          color: umaResolved && umaChallengerWon ? styles.green : umaResolved ? '#505672' : styles.yellow,
                          textDecoration: umaResolved && !umaChallengerWon ? 'line-through' : 'none'
                        }}
                      >
                        ${formattedChallenge}
                      </div>
                    </div>
                    <span 
                      className="font-mono text-[9px] font-bold uppercase px-2 py-0.5 rounded"
                      style={{ 
                        color: umaResolved && umaChallengerWon ? styles.green : umaResolved ? styles.red : styles.yellow,
                        background: umaResolved && umaChallengerWon ? 'rgba(0,255,136,0.08)' : umaResolved ? 'rgba(255,42,74,0.08)' : 'rgba(255,171,0,0.08)',
                        border: `1px solid ${umaResolved && umaChallengerWon ? 'rgba(0,255,136,0.15)' : umaResolved ? 'rgba(255,42,74,0.15)' : 'rgba(255,171,0,0.15)'}`
                      }}
                    >
                      {umaResolved && umaChallengerWon ? 'ACCEPTED' : umaResolved ? 'REJECTED' : 'PENDING'}
                    </span>
                  </div>
                  <div className="font-mono text-[9px] text-[#505672]">
                    Challenger: {formatAddress(market.alternative_settlement_by)}
                  </div>
                </div>
              )}

              {/* Original Proposal (if overturned) */}
              {umaResolved && umaChallengerWon && (
                <div className="pt-3 border-t border-[#1a1d28] opacity-60">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-mono text-[8px] uppercase tracking-wider text-[#505672] mb-1">Original Proposal</div>
                      <div className="font-mono text-sm text-[#505672] line-through">${formattedProposed}</div>
                    </div>
                    <span className="font-mono text-[9px] text-[#ff2a4a]">OVERTURNED</span>
                  </div>
                  <div className="font-mono text-[9px] text-[#505672] mt-1">
                    Proposer: {formatAddress(market.proposed_settlement_by)}
                  </div>
                </div>
              )}

              {/* On-Chain State */}
              {onChain && !onChainError && (
                <div className="pt-3 border-t border-[#1a1d28]">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="font-mono text-[8px] uppercase tracking-wider text-[#505672] mb-1">Lifecycle</div>
                      <div className="font-mono text-[11px] text-[#d8dae2]">
                        {LIFECYCLE_LABELS[onChain.lifecycleState] ?? `State ${onChain.lifecycleState}`}
                      </div>
                    </div>
                    <div>
                      <div className="font-mono text-[8px] uppercase tracking-wider text-[#505672] mb-1">Bond</div>
                      <div 
                        className="font-mono text-[11px]"
                        style={{ color: isBondExempt ? styles.green : styles.yellow }}
                      >
                        {isBondExempt ? 'EXEMPT' : `$${onChain.challengeBondAmount.toLocaleString()}`}
                      </div>
                    </div>
                  </div>
                  {sourceUrl && (
                    <div className="mt-2">
                      <a 
                        href={sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[10px] hover:underline inline-flex items-center gap-1"
                        style={{ color: styles.cyan }}
                      >
                        View Source →
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Market Participants Pie Chart */}
          <div className="bg-[#0d0f14] border border-[#1a1d28] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#1a1d28] flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-wider text-[#505672] font-semibold">
                Market Participants
              </span>
              {uniqueUserCount > 0 && (
                <span className="font-mono text-[9px] text-[#5c6178]">
                  {uniqueUserCount} trader{uniqueUserCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            
            <div className="p-4">
              {tradesLoading ? (
                <div className="flex items-center justify-center py-6">
                  <div className="w-4 h-4 border-2 border-[#282c3a] border-t-[#5c6178] rounded-full animate-spin" />
                  <span className="ml-2 font-mono text-[10px] text-[#505672]">Loading trades...</span>
                </div>
              ) : userBreakdown.length > 0 ? (
                <EarningsPieChart
                  slices={userBreakdown}
                  size={140}
                  compact
                  formatValue={(v) => `$${v.toFixed(0)}`}
                />
              ) : (
                <div className="text-center py-6">
                  <span className="font-mono text-[10px] text-[#505672]">No trade data available</span>
                </div>
              )}
              
              {tradeStats && (
                <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-[#1a1d28]">
                  <div className="text-center">
                    <div className="font-mono text-[8px] uppercase tracking-wider text-[#505672] mb-1">Total Trades</div>
                    <div className="font-mono text-sm font-semibold text-[#d8dae2]">
                      {tradeStats.totalTrades.toLocaleString()}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="font-mono text-[8px] uppercase tracking-wider text-[#505672] mb-1">Volume</div>
                    <div className="font-mono text-sm font-semibold text-[#d8dae2]">
                      ${tradeStats.totalVolume >= 1000 ? `${(tradeStats.totalVolume / 1000).toFixed(1)}k` : tradeStats.totalVolume.toFixed(0)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Proposal Form */}
          {!isSettled && (
            <div className="bg-[#0d0f14] border border-[#1a1d28] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1a1d28]">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: styles.accent, boxShadow: `0 0 6px ${styles.accent}` }} />
                  <span className="font-mono text-[9px] uppercase tracking-wider text-[#5c6178] font-semibold">
                    Submit Proposal
                  </span>
                </div>
                {onChain && onChain.challengeBondAmount > 0 && (
                  <span 
                    className="font-mono text-[9px] px-2 py-0.5 rounded"
                    style={{ 
                      color: isBondExempt ? styles.green : styles.yellow,
                      background: isBondExempt ? 'rgba(0,255,136,0.08)' : 'rgba(255,171,0,0.08)',
                      border: `1px solid ${isBondExempt ? 'rgba(0,255,136,0.15)' : 'rgba(255,171,0,0.12)'}`
                    }}
                  >
                    {isBondExempt ? 'EXEMPT' : `BOND: $${onChain.challengeBondAmount.toLocaleString()}`}
                  </span>
                )}
              </div>

              <div className="p-4 space-y-3">
            {/* Price Input */}
            <div>
              <label className="block font-mono text-[8px] uppercase tracking-wider text-[#505672] mb-2">
                Settlement Price (USDC)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[#505672]">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.0000"
                  value={challengePrice}
                  onChange={(e) => setChallengePrice(e.target.value)}
                  disabled={isSubmitting || isExpired || !hasSufficientBalance}
                  className="w-full bg-transparent text-[#d8dae2] font-mono text-sm rounded-lg pl-7 pr-4 py-3 border border-[#1a1d28] focus:border-[#7c4dff] focus:outline-none placeholder-[#505672] disabled:opacity-50 transition-colors"
                />
              </div>
            </div>

            {/* Evidence */}
            <div className="space-y-3">
              <label className="block font-mono text-[8px] uppercase tracking-wider text-[#505672]">
                Supporting Evidence
              </label>
              
              <input
                type="url"
                placeholder="https://source-url.com/..."
                value={evidenceSourceUrl}
                onChange={(e) => setEvidenceSourceUrl(e.target.value)}
                disabled={isSubmitting || isExpired || !hasSufficientBalance}
                className={`w-full bg-transparent text-[#d8dae2] font-mono text-xs rounded-lg px-4 py-2.5 border focus:outline-none placeholder-[#505672] disabled:opacity-50 transition-colors ${
                  evidenceUrlTrim !== '' && !isValidHttpUrl(evidenceUrlTrim)
                    ? 'border-[#ff2a4a] focus:border-[#ff2a4a]'
                    : 'border-[#1a1d28] focus:border-[#7c4dff]'
                }`}
              />

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
                  className="w-full rounded-lg border border-dashed border-[#1a1d28] hover:border-[#282c3a] bg-transparent px-4 py-3 text-center transition-colors disabled:opacity-50"
                >
                  {evidenceImageFile ? (
                    <div className="flex flex-col items-center gap-2">
                      <span className="font-mono text-[10px] text-[#d8dae2]">{evidenceImageFile.name}</span>
                      {evidencePreviewUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={evidencePreviewUrl} alt="Preview" className="max-h-16 rounded border border-[#1a1d28] object-contain" />
                      )}
                    </div>
                  ) : (
                    <span className="font-mono text-[10px] text-[#505672]">Upload screenshot (max 4MB)</span>
                  )}
                </button>
                {evidenceImageFile && (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => { setEvidenceImageFile(null); setUploadedEvidenceImageUrl(null); }}
                    className="mt-1 font-mono text-[9px] text-[#505672] hover:text-[#ff2a4a] transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            {/* Balance Check */}
            {onChain && onChain.challengeBondAmount > 0 && walletData?.address && !isBondExempt && (
              <div 
                className="flex items-center justify-between px-3 py-2 rounded-lg font-mono text-[10px]"
                style={{ 
                  background: hasSufficientBalance ? 'rgba(0,255,136,0.04)' : 'rgba(255,42,74,0.04)',
                  border: `1px solid ${hasSufficientBalance ? 'rgba(0,255,136,0.12)' : 'rgba(255,42,74,0.12)'}`
                }}
              >
                <span className="text-[#505672]">
                  Required: <span className="text-[#d8dae2]">${onChain.challengeBondAmount.toLocaleString()}</span>
                </span>
                <span style={{ color: hasSufficientBalance ? styles.green : styles.red }}>
                  Balance: ${availableBalanceNum.toFixed(2)}
                </span>
              </div>
            )}

            {/* Notice */}
            {challengeNotice && (
              <div 
                className="px-3 py-2.5 rounded-lg font-mono text-[11px]"
                style={{ 
                  background: challengeNotice.type === 'error' ? 'rgba(255,42,74,0.08)' : 'rgba(0,255,136,0.08)',
                  border: `1px solid ${challengeNotice.type === 'error' ? 'rgba(255,42,74,0.2)' : 'rgba(0,255,136,0.2)'}`,
                  color: challengeNotice.type === 'error' ? styles.red : styles.green
                }}
              >
                {challengeNotice.text}
              </div>
            )}

            {/* Submit Button */}
            <div>
              {walletData?.address && !hasSession ? (
                <button
                  type="button"
                  onClick={handleEnableSession}
                  disabled={sessionLoading || isExpired}
                  className="w-full py-3 rounded-lg font-mono text-xs font-semibold uppercase tracking-wider transition-all disabled:opacity-50"
                  style={{ 
                    background: `linear-gradient(135deg, ${styles.cyan}, ${styles.accent})`,
                    color: '#0d0f14'
                  }}
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
                  className="w-full py-3 rounded-lg font-mono text-xs font-semibold uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ 
                    background: `linear-gradient(135deg, ${styles.accent}, #9c4dff)`,
                    color: '#fff',
                    boxShadow: !isSubmitting && challengePrice && evidenceComplete ? `0 0 20px rgba(124,77,255,0.3)` : 'none'
                  }}
                >
                  {isSubmitting ? (submitStep || 'Submitting...') : 'Submit Proposal'}
                </button>
              )}
            </div>

              {challengeTxHash && (
                <p className="font-mono text-[10px] text-[#00ff88] truncate">
                  Tx: {challengeTxHash}
                </p>
              )}
            </div>
          </div>
          )}

        </div>
        {/* END RIGHT COLUMN */}

      </div>
      {/* END Two Column Layout */}

      {/* Info Footer */}
      <div className="text-center py-3 mt-4 border-t border-[#1a1d28]">
        <p className="font-mono text-[9px] text-[#505672]">
          {isSettled 
            ? 'Settlement finalized. Positions resolved at final price.'
            : 'Settlement secured by on-chain evidence hash and UMA DVM dispute resolution.'}
        </p>
      </div>

      <style jsx>{`
        @keyframes neonPulse {
          0%, 100% { opacity: 1; filter: brightness(1); }
          50% { opacity: 0.88; filter: brightness(1.15); }
        }
      `}</style>
    </div>
  );
}

export default SettlementInterface;
