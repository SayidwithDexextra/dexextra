'use client';

import React from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { IconSparkles } from './icons';
import { ethers } from 'ethers';
import { MetricDiscoveryResponse } from '@/types/metricDiscovery';
import { MetricSourceBubble, MetricSourceOption } from './MetricSourceBubble';
import { IconSearchBubble } from './IconSearchBubble';
import { MetricResolutionModal } from '@/components/MetricResolutionModal';
import type { MetricResolutionResponse } from '@/components/MetricResolutionModal/types';
import { runMetricAIWithPolling, getMetricAIWorkerBaseUrl, type MetricAIResult } from '@/lib/metricAiWorker';
import type { CreateMarketAssistantResponse } from '@/types/createMarketAssistant';
import { createMarketOnChain } from '@/lib/createMarketOnChain';
import { uploadImageToSupabase } from '@/lib/imageUpload';
import { useDeploymentOverlay } from '@/contexts/DeploymentOverlayContext';
import { usePusher } from '@/lib/pusher-client';

type DiscoveryState = 'idle' | 'discovering' | 'success' | 'clarify' | 'rejected' | 'error';
export type CreationStep = 'clarify_metric' | 'name' | 'similar_markets' | 'description' | 'select_source' | 'icon' | 'complete';

const PROMPT_EXAMPLE_SUGGESTIONS = [
  'Current price of Bitcoin in USD',
  'ETH/USD spot price (Coinbase or Binance)',
  'US CPI (YoY %) — monthly',
  'US unemployment rate (%) — monthly',
  'S&P 500 index level — daily close',
  'Gold spot price (XAU/USD) — daily close',
  'US 10Y Treasury yield (%) — daily close',
] as const;

type IntroHelpKey =
  | 'how_creation_works'
  | 'suggestions'
  | 'settlement'
  | 'bond_penalty'
  | 'good_prompt';

const INTRO_LEARN_BUBBLES: Array<{ key: IntroHelpKey; label: string }> = [
  { key: 'how_creation_works', label: 'How creation works' },
  { key: 'suggestions', label: 'How rewards work' },
  { key: 'settlement', label: 'How settlement works' },
  { key: 'bond_penalty', label: 'How much is my bond & penalty?' },
  { key: 'good_prompt', label: 'What makes a good market?' },
];

// Default creation penalty (when on-chain fetch is unavailable).
// 500 bps = 5%.
const DEFAULT_CREATION_PENALTY_BPS = 500;

function formatUsdc6(amount: bigint) {
  // Format a 6-decimal USDC-like integer without relying on Intl.
  const sign = amount < 0n ? '-' : '';
  const x = amount < 0n ? -amount : amount;
  const whole = x / 1_000_000n;
  const frac = x % 1_000_000n;
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
  return `${sign}${whole.toString()}${fracStr ? `.${fracStr}` : ''} USDC`;
}

function formatBpsPct(bps: number) {
  const pct = bps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`;
}

function clampText(input: string, maxLen: number) {
  const trimmed = input.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function toConciseMarketIdentifier(input: string, opts?: { maxLen?: number }) {
  const maxLen = Math.max(8, Math.min(48, opts?.maxLen ?? 28));
  const raw = String(input || '').toUpperCase();
  const words = raw
    // Drop punctuation/parentheses entirely (they tend to create ugly identifiers).
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return 'MARKET';

  // Scope / currency hints.
  const hasUs =
    words.includes('US') ||
    words.includes('USA') ||
    (words.includes('UNITED') && words.includes('STATES')) ||
    words.includes('AMERICA');
  const currency =
    words.includes('USD')
      ? 'USD'
      : words.includes('EUR')
        ? 'EUR'
        : words.includes('GBP')
          ? 'GBP'
          : words.includes('JPY')
            ? 'JPY'
            : words.includes('CAD')
              ? 'CAD'
              : null;

  // Measurement hint.
  const measure =
    // Prefer "INDEX"/"RATE" when present; many prompts include the word "price" even for index-like series.
    words.includes('INDEX')
      ? 'INDEX'
      : words.includes('RATE')
        ? 'RATE'
        : words.includes('RATIO')
          ? 'RATIO'
          : words.includes('PRICE')
            ? 'PRICE'
            : null;

  const STOP = new Set([
    'A',
    'AN',
    'THE',
    'OF',
    'IN',
    'ON',
    'AT',
    'BY',
    'FOR',
    'AND',
    'OR',
    'PER',
    'TO',
    'FROM',
    'AS',
    'IS',
    'ARE',
    // Common "verbose metric" words we don't want as the core identifier.
    'AVERAGE',
    'RETAIL',
    'MEAN',
    'MEDIAN',
    'CURRENT',
    'LATEST',
    'GRADE',
    'LARGE',
    'SMALL',
    'MEDIUM',
    // Location words (handled via `US`), and currency tokens.
    'UNITED',
    'STATES',
    'AMERICA',
    'US',
    'USA',
    'USD',
    'EUR',
    'GBP',
    'JPY',
    'CAD',
  ]);

  const subject = words.filter((w) => w.length >= 3 && !STOP.has(w));

  const build = (subjectCount: number) => {
    const parts: string[] = [];
    const picked = subject.slice(0, Math.max(0, subjectCount));
    for (const p of picked) {
      if (!parts.includes(p)) parts.push(p);
    }
    if (measure && !parts.includes(measure)) parts.push(measure);
    if (currency && !parts.includes(currency)) parts.push(currency);
    else if (hasUs && !parts.includes('US')) parts.push('US');
    return parts.join('-');
  };

  // Try to keep it short while preserving meaning.
  let out = build(2);
  if (!out) out = build(1);
  if (!out) out = words[0] || 'MARKET';

  // If still too long, reduce subject tokens and then hard-trim.
  if (out.length > maxLen) out = build(1);
  if (out.length > maxLen) {
    const sliced = out.slice(0, maxLen);
    // Avoid ending in a partial token when possible.
    const lastDash = sliced.lastIndexOf('-');
    out = lastDash >= 8 ? sliced.slice(0, lastDash) : sliced;
  }
  // Final hard-sanitize: never allow parentheses, periods, or any punctuation.
  out = out.replace(/[^A-Z0-9-]/g, '');
  // Normalize repeated separators and strip any trailing punctuation-like artifacts.
  out = out.replace(/-+/g, '-').replace(/-+$/g, '').replace(/^-+/g, '');
  out = out.replace(/\.+$/g, '');
  return out || 'MARKET';
}

function suggestMarketName(params: { metricName?: string; sourceLabel?: string }) {
  const base = params.metricName?.trim() || 'New Market';
  const sourceLabel = params.sourceLabel?.trim();
  const includeSourceLabel =
    Boolean(sourceLabel) && !/custom\s*url/i.test(String(sourceLabel || ''));
  const withSource = includeSourceLabel ? `${base} • ${sourceLabel}` : base;
  return clampText(withSource, 56);
}

function suggestMarketDescription(params: {
  metricName?: string;
  measurementMethod?: string;
  sourceLabel?: string;
}) {
  const name = params.metricName?.trim() || 'this metric';
  const source = params.sourceLabel ? ` using ${params.sourceLabel}` : '';
  const method = params.measurementMethod?.trim();
  const body = method
    ? `A market tracking ${name}${source}. Measurement: ${method}.`
    : `A market tracking ${name}${source}.`;
  return clampText(body, 160);
}

function randomDevCode4() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function toModalResponse(ai: MetricAIResult, metric: string, processingMs: number): MetricResolutionResponse {
  const rawSources = Array.isArray(ai?.sources) ? ai.sources : [];
  const sources = rawSources
    .map((s: any) => ({
      url: String(s?.url || ''),
      screenshot_url: String(s?.screenshot_url || ''),
      quote: String(s?.quote || ''),
      match_score: typeof s?.match_score === 'number' ? s.match_score : 0.5,
      css_selector: s?.css_selector,
      xpath: s?.xpath,
      html_snippet: s?.html_snippet,
      js_extractor: s?.js_extractor,
    }))
    .filter((s: any) => Boolean(s?.url));

  return {
    status: 'completed',
    processingTime: `${processingMs}ms`,
    cached: false,
    data: {
      metric: String(ai?.metric || metric || ''),
      value: String(ai?.value || ''),
      unit: String(ai?.unit || ''),
      as_of: String(ai?.as_of || new Date().toISOString()),
      confidence: typeof ai?.confidence === 'number' ? ai.confidence : 0.5,
      asset_price_suggestion: String(ai?.asset_price_suggestion || ai?.value || ''),
      reasoning: String(ai?.reasoning || ''),
      sources,
    },
    performance: {
      totalTime: processingMs,
      breakdown: {
        cacheCheck: '0ms',
        scraping: '0ms',
        processing: `${processingMs}ms`,
        aiAnalysis: '0ms',
      },
    },
  };
}

function AssistantResponseBubble({
  text,
  isLoading,
}: {
  text: string;
  isLoading: boolean;
}) {
  const [displayedText, setDisplayedText] = React.useState('');
  const [isTyping, setIsTyping] = React.useState(false);
  const typingTimerRef = React.useRef<number | null>(null);
  const prevTextRef = React.useRef<string>('');

  // Clear stale text synchronously before paint to prevent flash of old text on step transitions.
  React.useLayoutEffect(() => {
    if (text !== prevTextRef.current) {
      setDisplayedText('');
      setIsTyping(true);
    }
  }, [text]);

  React.useEffect(() => {
    if (text === prevTextRef.current) return;
    prevTextRef.current = text;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (typingTimerRef.current) {
      window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }

    if (prefersReducedMotion) {
      setIsTyping(false);
      setDisplayedText(text);
      return;
    }

    let i = 0;

    const tick = () => {
      i += 1;
      setDisplayedText(text.slice(0, i));

      if (i >= text.length) {
        setIsTyping(false);
        return;
      }

      const ch = text[i - 1];
      // Typewriter cadence: steady with slight jitter, slower on punctuation/newlines.
      const base = 18 + Math.floor(Math.random() * 14); // 18–31ms
      const extra =
        ch === '\n' ? 120 : ch === '.' || ch === '!' || ch === '?' ? 90 : ch === ',' ? 50 : 0;

      typingTimerRef.current = window.setTimeout(tick, base + extra);
    };

    // Start with a tiny delay for “AI thinking” feel.
    typingTimerRef.current = window.setTimeout(tick, 220);

    return () => {
      if (typingTimerRef.current) {
        window.clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    };
  }, [text]);

  return (
    <div className="rounded-2xl border border-white/8 bg-[#0F0F0F] px-4 py-3 text-[13px] leading-relaxed text-white/85 shadow-lg whitespace-pre-wrap w-full sm:w-[520px]">
      {isLoading && !displayedText ? (
        <span className="text-white/65">
          Thinking<span className="inline-block w-[1ch] animate-pulse">.</span>
          <span className="inline-block w-[1ch] animate-pulse [animation-delay:120ms]">.</span>
          <span className="inline-block w-[1ch] animate-pulse [animation-delay:240ms]">.</span>
        </span>
      ) : (
        <>
          {displayedText}
          {isTyping ? <span className="ml-[2px] inline-block w-[8px] animate-pulse">▍</span> : null}
        </>
      )}
    </div>
  );
}

function StepPanel({
  step,
  isAnimating,
  message,
  isAssistantLoading,
  userPrompt,
  metricClarification,
  onChangeMetricClarification,
  onSubmitMetricClarification,
  marketName,
  onChangeName,
  onConfirmName,
  marketDescription,
  onChangeDescription,
  onConfirmDescription,
  iconPreviewUrl,
  onConfirmIcon,
  isIconSaving,
  onStartOver,
  devTools,
}: {
  step: CreationStep;
  isAnimating: boolean;
  message: string;
  isAssistantLoading: boolean;
  userPrompt: string;
  metricClarification: string;
  onChangeMetricClarification: (v: string) => void;
  onSubmitMetricClarification: () => void;
  marketName: string;
  onChangeName: (v: string) => void;
  onConfirmName: () => void;
  marketDescription: string;
  onChangeDescription: (v: string) => void;
  onConfirmDescription: () => void;
  iconPreviewUrl: string | null;
  onConfirmIcon: () => void | Promise<void>;
  isIconSaving: boolean;
  onStartOver: () => void;
  devTools?: React.ReactNode;
}) {
  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && marketName.trim()) {
      e.preventDefault();
      onConfirmName();
    }
  };

  const handleDescriptionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && marketDescription.trim()) {
      e.preventDefault();
      onConfirmDescription();
    }
  };

  const handleClarificationKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && metricClarification.trim()) {
      e.preventDefault();
      onSubmitMetricClarification();
    }
  };

  const clarificationRef = React.useRef<HTMLTextAreaElement>(null);
  const descriptionRef = React.useRef<HTMLTextAreaElement>(null);

  const resizeTextarea = React.useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    // Hide scrollbar even if OS is set to always show scrollbars.
    el.style.overflowY = 'hidden';
    // Reset, then grow to content height.
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  React.useLayoutEffect(() => {
    if (step === 'clarify_metric') resizeTextarea(clarificationRef.current);
  }, [metricClarification, resizeTextarea, step]);

  React.useLayoutEffect(() => {
    if (step === 'description') resizeTextarea(descriptionRef.current);
  }, [marketDescription, resizeTextarea, step]);

  const showUserRow = (step !== 'select_source' && step !== 'similar_markets') || Boolean(userPrompt.trim());
  const isInteractiveUserInput =
    step === 'clarify_metric' || step === 'name' || step === 'description' || step === 'icon';

  return (
    <div className={step === 'select_source' ? 'space-y-2' : 'space-y-3 sm:space-y-4'}>
      {/* Row 1: AI message on left side of page (top) */}
      <div
        className={[
          'flex justify-start transition-all duration-200 ease-out',
          isAnimating ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0',
        ].join(' ')}
      >
        <div className="flex items-start gap-3 w-full sm:max-w-[520px]">
          <AssistantResponseBubble text={message} isLoading={isAssistantLoading} />
        </div>
      </div>

      {/* Row 2: User input on right side of page (below) */}
      {showUserRow ? (
        <div
          className={[
            'flex flex-col sm:flex-row sm:justify-end transition-all duration-200 ease-out delay-75',
            isAnimating ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0',
          ].join(' ')}
        >
          <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3 w-full sm:w-auto">
            <div className="rounded-2xl border border-white/8 bg-[#0A0A0A] px-4 py-3 shadow-lg w-full sm:w-[520px] sm:max-w-[520px] order-1">
              {!isInteractiveUserInput && step === 'select_source' ? (
                <div>
                  <div className="text-[10px] font-medium text-white/40 uppercase tracking-wider">
                    Your prompt
                  </div>
                  <div className="mt-2 text-sm text-white/85 whitespace-pre-wrap">
                    {userPrompt.trim()}
                  </div>
                </div>
              ) : null}

              {step === 'clarify_metric' ? (
                <div>
                  <textarea
                    ref={clarificationRef}
                    value={metricClarification}
                    onChange={(e) => onChangeMetricClarification(e.target.value)}
                    onInput={() => resizeTextarea(clarificationRef.current)}
                    onKeyDown={handleClarificationKeyDown}
                    className="scrollbar-none w-full resize-none bg-transparent text-sm text-white placeholder:text-white/35 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 border-none !outline-none overflow-y-hidden"
                    style={{ outline: 'none', boxShadow: 'none', minHeight: '2.5rem' }}
                    rows={2}
                    placeholder="Reply with a clarification (Shift+Enter for a new line)"
                    autoFocus
                  />
                  <div className="mt-2 text-[11px] text-white/45">
                    Press Enter to submit clarification
                  </div>
                </div>
              ) : null}

              {step === 'name' ? (
                <div>
                  <input
                    value={marketName}
                    onChange={(e) => onChangeName(e.target.value)}
                    onKeyDown={handleNameKeyDown}
                    className="w-full bg-transparent text-sm text-white placeholder:text-white/35 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 border-none !outline-none"
                    style={{ outline: 'none', boxShadow: 'none' }}
                    placeholder="Market name"
                    autoFocus
                  />
                  <div className="mt-2 text-[11px] text-white/45">
                    Press Enter to continue
                  </div>
                </div>
              ) : null}

              {step === 'description' ? (
                <div>
                  <textarea
                    ref={descriptionRef}
                    value={marketDescription}
                    onChange={(e) => onChangeDescription(e.target.value)}
                    onInput={() => resizeTextarea(descriptionRef.current)}
                    onKeyDown={handleDescriptionKeyDown}
                    className="scrollbar-none w-full resize-none bg-transparent text-sm text-white placeholder:text-white/35 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 border-none !outline-none overflow-y-hidden"
                    style={{ outline: 'none', boxShadow: 'none', minHeight: '2.5rem' }}
                    rows={2}
                    placeholder="Market description"
                    autoFocus
                  />
                  <div className="mt-2 text-[11px] text-white/45">
                    Press Enter to continue
                  </div>
                </div>
              ) : null}

              {step === 'icon' ? (
                <div className="flex items-center gap-3">
                  {/* Preview */}
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border border-white/8 bg-black/40">
                    {iconPreviewUrl ? (
                      <Image
                        src={iconPreviewUrl}
                        alt="Market icon preview"
                        width={48}
                        height={48}
                        className="h-full w-full object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-white/10 to-white/5" />
                    )}
                  </div>

                  <div className="flex-1 text-sm text-white/60">
                    {iconPreviewUrl ? 'Icon selected' : 'Select an icon below'}
                  </div>

                  <button
                    type="button"
                    onClick={() => void onConfirmIcon()}
                    disabled={!iconPreviewUrl || isIconSaving}
                    className="inline-flex h-10 items-center justify-center rounded-xl bg-white px-4 text-sm font-medium text-black transition-opacity disabled:opacity-50"
                  >
                    {isIconSaving ? 'Uploading…' : 'Done'}
                  </button>
                </div>
              ) : null}

              {step === 'complete' ? (
                <div className="text-[12px] text-white/55">
                  Review your market configuration below. When ready, confirm to generate the market parameters.
                </div>
              ) : null}
            </div>
            <div className="order-2 shrink-0 flex flex-row sm:flex-col items-center sm:items-end gap-2 sm:mt-1">
              <button
                type="button"
                onClick={onStartOver}
                className="text-[12px] text-white/55 hover:text-white/80 transition-colors"
              >
                Start over
              </button>
              {devTools ? <div className="relative">{devTools}</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MarketDetailsReview({
  marketName,
  marketDescription,
  selectedSource,
  iconPreviewUrl,
  metricDefinition,
  onEdit,
  onStartOver,
  onCreateMarket,
  isCreating,
  showImmediateSettlementToggle,
  useImmediateSettlement,
  onToggleImmediateSettlement,
}: {
  marketName: string;
  marketDescription: string;
  selectedSource: MetricSourceOption | null;
  iconPreviewUrl: string | null;
  metricDefinition?: {
    metric_name?: string;
    unit?: string;
    scope?: string;
    time_basis?: string;
    measurement_method?: string;
  } | null;
  onEdit: (step: CreationStep) => void;
  onStartOver: () => void;
  onCreateMarket: () => void;
  isCreating: boolean;
  showImmediateSettlementToggle?: boolean;
  useImmediateSettlement?: boolean;
  onToggleImmediateSettlement?: (value: boolean) => void;
}) {
  const [hasAnimated, setHasAnimated] = React.useState(false);
  const [bondConfig, setBondConfig] = React.useState<{
    status: 'idle' | 'loading' | 'success' | 'error';
    defaultBondAmount?: bigint;
    penaltyBps?: number;
    error?: string;
  }>({ status: 'idle', penaltyBps: DEFAULT_CREATION_PENALTY_BPS });

  const bondManagerAddress =
    (process.env.NEXT_PUBLIC_MARKET_BOND_MANAGER_ADDRESS || '').trim() || null;
  const rpcUrl = (process.env.NEXT_PUBLIC_RPC_URL || '').trim() || null;

  React.useEffect(() => {
    const t = window.setTimeout(() => setHasAnimated(true), 50);
    return () => window.clearTimeout(t);
  }, []);

  React.useEffect(() => {
    if (!bondManagerAddress || !ethers.isAddress(bondManagerAddress) || !rpcUrl) {
      // Still show the bond notice in the UI, but skip on-chain fetch.
      return;
    }
    let cancelled = false;
    setBondConfig({ status: 'loading' });
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const abi = [
      'function defaultBondAmount() view returns (uint256)',
      'function creationPenaltyBps() view returns (uint16)',
    ] as const;
    const c = new ethers.Contract(bondManagerAddress, abi, provider);
    (async () => {
      const [bondRaw, bpsRaw] = await Promise.all([c.defaultBondAmount(), c.creationPenaltyBps()]);
      const bond = BigInt(bondRaw.toString());
      const bps = Number(bpsRaw.toString());
      if (cancelled) return;
      setBondConfig({
        status: 'success',
        defaultBondAmount: bond,
        penaltyBps: Number.isFinite(bps) ? bps : DEFAULT_CREATION_PENALTY_BPS,
      });
    })().catch((e: any) => {
      if (cancelled) return;
      setBondConfig((prev) => ({
        status: 'error',
        defaultBondAmount: prev?.defaultBondAmount,
        penaltyBps: prev?.penaltyBps ?? DEFAULT_CREATION_PENALTY_BPS,
        error: String(e?.message || e || 'Failed to load bond config'),
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [bondManagerAddress, rpcUrl]);

  const bondSummary = React.useMemo(() => {
    const amount = bondConfig.defaultBondAmount;
    const bps = bondConfig.penaltyBps;
    if (amount == null || bps == null) return null;
    const fee = (amount * BigInt(bps)) / 10_000n;
    const refundable = amount - fee;
    const pct = bps / 100;
    const pctStr = Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`;
    return { amount, bps, fee, refundable, pctStr };
  }, [bondConfig.defaultBondAmount, bondConfig.penaltyBps]);

  return (
    <div className="mt-4 w-full max-w-[900px] px-1 sm:px-0">
      {/* Compact single-view layout */}
      <div
        className="rounded-2xl border border-white/8 bg-[#0A0A0A] overflow-visible"
        style={{
          opacity: hasAnimated ? 1 : 0,
          transform: hasAnimated ? 'translateY(0)' : 'translateY(16px)',
          transition: 'opacity 0.4s ease-out, transform 0.4s ease-out',
        }}
      >
        {/* Header bar */}
        <div className="flex flex-col gap-3 px-4 py-3 border-b border-white/5 bg-black/40 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 text-green-400"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
              </svg>
              <span className="text-sm font-medium text-white/90">Market Configuration</span>
            </div>
            <button
              type="button"
              onClick={onStartOver}
              className="text-[11px] text-white/40 hover:text-white/60 transition-colors"
            >
              Start over
            </button>
          </div>
          <div className="flex flex-col items-start gap-1 sm:items-end">
            {showImmediateSettlementToggle ? (
              <label className="mb-1 flex items-center gap-1.5 text-[10px] text-white/55">
                <input
                  type="checkbox"
                  checked={Boolean(useImmediateSettlement)}
                  onChange={(e) => onToggleImmediateSettlement?.(e.target.checked)}
                  className="h-3 w-3 rounded border-white/20 bg-[#111111]"
                />
                Immediate settlement (dev)
              </label>
            ) : null}
            <button
              type="button"
              onClick={onCreateMarket}
              disabled={isCreating}
              className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium shadow transition-all active:scale-[0.98] sm:w-auto sm:py-1.5 ${
                isCreating
                  ? 'bg-white/50 text-black/50 cursor-not-allowed'
                  : 'bg-white text-black hover:bg-white/90'
              }`}
            >
              {isCreating ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border border-black/20 border-t-black" />
                  Creating...
                </>
              ) : (
                <>
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                  Create Market
                </>
              )}
            </button>
            <div className="text-[10px] text-white/35">
              Market creation requires a bond.
            </div>
          </div>
        </div>

        {/* Main content - 2 column grid (stacks on mobile) */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.2fr] sm:divide-x divide-white/5">
          {/* Left column - Identity */}
          <div className="p-4 space-y-3">
            {/* Icon + Name row */}
            <div className="flex items-start gap-3">
              {/* Icon */}
              <button
                type="button"
                onClick={() => onEdit('icon')}
                className="group relative shrink-0"
              >
                {iconPreviewUrl ? (
                  <div className="h-12 w-12 rounded-xl border border-white/8 bg-black/40 overflow-hidden shadow-lg transition-all group-hover:border-white/15">
                    <Image
                      src={iconPreviewUrl}
                      alt="Market icon"
                      width={48}
                      height={48}
                      className="h-full w-full object-cover"
                      unoptimized
                    />
                  </div>
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-white/15 bg-black/40 transition-all group-hover:border-white/25 group-hover:bg-black/60">
                    <svg viewBox="0 0 24 24" className="h-5 w-5 text-white/40" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                    </svg>
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-[10px] text-white font-medium">Edit</span>
                </div>
              </button>

              {/* Name + Description */}
              <div className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => onEdit('name')}
                  className="group w-full text-left"
                >
                  <div className="text-base font-medium text-white leading-tight truncate group-hover:text-white/80 transition-colors">
                    {marketName || <span className="text-white/40 italic text-sm">Untitled market</span>}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onEdit('description')}
                  className="group w-full text-left mt-1"
                >
                  <div className="text-xs text-white/60 leading-relaxed line-clamp-2 group-hover:text-white/70 transition-colors">
                    {marketDescription || <span className="text-white/40 italic">No description</span>}
                  </div>
                </button>
              </div>
            </div>

            {/* Data Source */}
            <button
              type="button"
              onClick={() => onEdit('select_source')}
              className="group w-full rounded-xl border border-white/5 bg-black/30 p-3 text-left transition-all hover:border-white/10 hover:bg-black/40"
            >
              <div className="text-[10px] font-medium text-white/40 uppercase tracking-wider mb-2">Data Source</div>
              {selectedSource ? (
                <div className="flex items-center gap-2.5">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white shadow ${selectedSource.iconBg}`}>
                    {selectedSource.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">
                      {selectedSource.label}
                    </div>
                    <div className="text-[10px] text-white/40 truncate">
                      {selectedSource.sublabel || new URL(selectedSource.url).hostname}
                    </div>
                  </div>
                  {selectedSource.badge && (
                    <span className="shrink-0 rounded-full bg-blue-500/20 border border-blue-500/30 px-1.5 py-0.5 text-[9px] font-medium text-blue-300">
                      {selectedSource.badge}
                    </span>
                  )}
                </div>
              ) : (
                <div className="text-xs text-white/40 italic">No source selected</div>
              )}
            </button>

            {/* Source confidence bar */}
            {selectedSource && (
              <div className="flex items-center gap-4 px-1">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-white/40">Confidence</span>
                    <span className="text-[10px] text-white font-medium">{Math.round(selectedSource.confidence * 100)}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-black/60 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.round(selectedSource.confidence * 100)}%`,
                        backgroundColor:
                          selectedSource.confidence >= 0.85
                            ? '#22c55e'
                            : selectedSource.confidence >= 0.7
                            ? '#eab308'
                            : '#ef4444',
                      }}
                    />
                  </div>
                </div>
                <div className="text-[10px]">
                  <span className="text-white/40">Type: </span>
                  <span className="text-white/70">{selectedSource.tooltip?.dataType || 'Web'}</span>
                </div>
              </div>
            )}
          </div>

          {/* Right column - Metric details */}
          <div className="p-4 bg-black/20 border-t border-white/5 sm:border-t-0">
            <button
              type="button"
              onClick={() => onEdit('clarify_metric')}
              className="group w-full text-left"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] font-medium text-white/40 uppercase tracking-wider">Metric Definition</div>
                <span className="text-[10px] text-white/30 opacity-0 group-hover:opacity-100 transition-opacity">Edit</span>
              </div>
            </button>

            {metricDefinition?.metric_name ? (
              <div className="space-y-3">
                {/* Metric name */}
                <div className="text-sm font-medium text-white">{metricDefinition.metric_name}</div>

                {/* Grid of metric properties */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
                  {metricDefinition.unit && (
                    <div className="rounded-lg bg-black/40 border border-white/5 px-2.5 py-2">
                      <div className="text-[9px] text-white/40 uppercase tracking-wider mb-0.5">Unit</div>
                      <div className="text-xs text-white truncate">{metricDefinition.unit}</div>
                    </div>
                  )}
                  {metricDefinition.scope && (
                    <div className="rounded-lg bg-black/40 border border-white/5 px-2.5 py-2">
                      <div className="text-[9px] text-white/40 uppercase tracking-wider mb-0.5">Scope</div>
                      <div className="text-xs text-white truncate">{metricDefinition.scope}</div>
                    </div>
                  )}
                  {metricDefinition.time_basis && (
                    <div className="rounded-lg bg-black/40 border border-white/5 px-2.5 py-2">
                      <div className="text-[9px] text-white/40 uppercase tracking-wider mb-0.5">Time Basis</div>
                      <div className="text-xs text-white truncate">{metricDefinition.time_basis}</div>
                    </div>
                  )}
                </div>

                {/* Measurement method */}
                {metricDefinition.measurement_method && (
                  <div className="rounded-lg bg-black/40 border border-white/5 px-2.5 py-2">
                    <div className="text-[9px] text-white/40 uppercase tracking-wider mb-1">Measurement Method</div>
                    <div className="text-xs text-white/70 leading-relaxed line-clamp-3">
                      {metricDefinition.measurement_method}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-24 text-xs text-white/30 italic">
                No metric definition available
              </div>
            )}

            {/* Bond + penalty notice */}
            <div className="mt-4 rounded-xl border border-white/5 bg-black/40 p-3">
              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-[10px] font-medium text-white/40 uppercase tracking-wider">
                  Bond &amp; Penalty
                </div>
                <div className="text-[10px] text-white/30">
                  Charged from CoreVault available balance
                </div>
              </div>

              <div className="mt-2 space-y-1.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-1 sm:gap-3">
                  <span className="text-white/55">Bond required</span>
                  <span className="text-white/85 font-medium tabular-nums">
                    {bondSummary ? formatUsdc6(bondSummary.amount) : bondConfig.status === 'loading' ? 'Loading…' : 'Configured by protocol'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-1 sm:gap-3">
                  <span className="text-white/55">Creation penalty</span>
                  <span className="text-white/80 font-medium tabular-nums">
                    {bondSummary
                      ? `${bondSummary.pctStr} (${formatUsdc6(bondSummary.fee)})`
                      : bondConfig.status === 'loading'
                        ? 'Loading…'
                        : bondConfig.penaltyBps != null
                          ? `${formatBpsPct(bondConfig.penaltyBps)} (applies on refund)`
                          : 'Applies on refund'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-1 sm:gap-3">
                  <span className="text-white/55">Refund if market is unused</span>
                  <span className="text-white/80 font-medium tabular-nums">
                    {bondSummary ? formatUsdc6(bondSummary.refundable) : 'Net of penalty'}
                  </span>
                </div>

                <div className="pt-2 text-[11px] text-white/40 leading-relaxed">
                  You can deactivate an unused market and reclaim the bond only if there have been no trades, no open orders, and no active positions.
                </div>

                {bondConfig.status === 'error' ? (
                  <div className="pt-2 text-[11px] text-red-300/80">
                    Could not load bond config on this network. {bondConfig.error ? `(${bondConfig.error})` : null}
                  </div>
                ) : null}

                {!bondManagerAddress ? (
                  <div className="pt-2 text-[11px] text-white/35">
                    Tip: set <span className="font-mono">NEXT_PUBLIC_MARKET_BOND_MANAGER_ADDRESS</span> to display exact bond values here.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import type { CreationStateSnapshot } from '@/lib/marketDraftSerializer';

export interface InteractiveMarketCreationProps {
  initialState?: CreationStateSnapshot | null;
  onStateChange?: (snap: CreationStateSnapshot) => void;
  onDeploySuccess?: (symbol: string, marketId: string) => void;
}

export function InteractiveMarketCreation({
  initialState,
  onStateChange,
  onDeploySuccess,
}: InteractiveMarketCreationProps = {}) {
  const devToolsEnabled =
    process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DEV_TOOLS === 'true';
  const [devToolsOpen, setDevToolsOpen] = React.useState(false);
  const [useImmediateSettlement, setUseImmediateSettlement] = React.useState(false);

  const DEV_REVIEW_PRESET = {
    marketName: 'AVERAGE-RETAIL-PRICE-OF-BANANAS-IN-THE-USA',
    marketDescription:
      'Tracks the U.S. average retail price of bananas (USD per lb) using FRED series APU0000711311. Updated monthly.',
    startPrice: '0.62',
    iconUrl:
      'https://images.unsplash.com/photo-1528825871115-3581a5387919?w=256&h=256&fit=crop&auto=format',
    sourceUrl: 'https://fred.stlouisfed.org/series/APU0000711311',
    sourceDomain: 'fred.stlouisfed.org',
    sourceLabel: 'FRED',
    sourceAuthority: 'Federal Reserve Bank of St. Louis (FRED)',
  } as const;

  const DEV_SELECT_SOURCE_PRESET: NonNullable<MetricDiscoveryResponse['sources']> = {
    primary_source: {
      url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      authority: 'CoinGecko',
      confidence: 0.95,
    },
    secondary_sources: [
      {
        url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
        authority: 'Binance',
        confidence: 0.92,
      },
      {
        url: 'https://data.chain.link/ethereum/mainnet/crypto-usd/btc-usd',
        authority: 'Chainlink',
        confidence: 0.94,
      },
      {
        url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
        authority: 'Coinbase',
        confidence: 0.91,
      },
      {
        url: 'https://pyth.network/price-feeds',
        authority: 'Pyth',
        confidence: 0.89,
      },
    ],
  };

  const DEV_SELECT_SOURCE_MANY_PRESET: NonNullable<MetricDiscoveryResponse['sources']> = {
    primary_source: {
      url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      authority: 'CoinGecko',
      confidence: 0.95,
    },
    secondary_sources: [
      {
        url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
        authority: 'Binance',
        confidence: 0.92,
      },
      {
        url: 'https://data.chain.link/ethereum/mainnet/crypto-usd/btc-usd',
        authority: 'Chainlink',
        confidence: 0.94,
      },
      {
        url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
        authority: 'Coinbase',
        confidence: 0.91,
      },
      {
        url: 'https://pyth.network/price-feeds',
        authority: 'Pyth Network',
        confidence: 0.89,
      },
      {
        url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
        authority: 'Kraken',
        confidence: 0.90,
      },
      {
        url: 'https://www.bitstamp.net/api/v2/ticker/btcusd/',
        authority: 'Bitstamp',
        confidence: 0.88,
      },
      {
        url: 'https://api.gemini.com/v1/pubticker/btcusd',
        authority: 'Gemini',
        confidence: 0.87,
      },
      {
        url: 'https://api.huobi.pro/market/detail/merged?symbol=btcusdt',
        authority: 'Huobi',
        confidence: 0.85,
      },
      {
        url: 'https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=BTC-USDT',
        authority: 'KuCoin',
        confidence: 0.84,
      },
    ],
  };

  const promptTextareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [prompt, setPrompt] = React.useState(initialState?.prompt ?? '');
  const [isFocused, setIsFocused] = React.useState(false);
  const [promptPlaceholderIdx, setPromptPlaceholderIdx] = React.useState(0);
  const [introHelpKey, setIntroHelpKey] = React.useState<IntroHelpKey | null>(null);

  // Bond config (used for the intro "bond & penalty" explainer bubble)
  const bondManagerAddress =
    (process.env.NEXT_PUBLIC_MARKET_BOND_MANAGER_ADDRESS || '').trim() || null;
  const rpcUrl = (process.env.NEXT_PUBLIC_RPC_URL || '').trim() || null;
  const [introBondConfig, setIntroBondConfig] = React.useState<{
    status: 'idle' | 'loading' | 'success' | 'error';
    defaultBondAmount?: bigint;
    penaltyBps?: number;
    error?: string;
  }>({ status: 'idle', penaltyBps: DEFAULT_CREATION_PENALTY_BPS });
  React.useEffect(() => {
    if (introHelpKey !== 'bond_penalty') return;
    if (!bondManagerAddress || !ethers.isAddress(bondManagerAddress) || !rpcUrl) {
      // Still show the explainer, but skip on-chain fetch.
      return;
    }
    let cancelled = false;
    setIntroBondConfig({ status: 'loading' });
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const abi = [
      'function defaultBondAmount() view returns (uint256)',
      'function creationPenaltyBps() view returns (uint16)',
    ] as const;
    const c = new ethers.Contract(bondManagerAddress, abi, provider);
    (async () => {
      const [bondRaw, bpsRaw] = await Promise.all([c.defaultBondAmount(), c.creationPenaltyBps()]);
      const bond = BigInt(bondRaw.toString());
      const bps = Number(bpsRaw.toString());
      if (cancelled) return;
      setIntroBondConfig({
        status: 'success',
        defaultBondAmount: bond,
        penaltyBps: Number.isFinite(bps) ? bps : DEFAULT_CREATION_PENALTY_BPS,
      });
    })().catch((e: any) => {
      if (cancelled) return;
      setIntroBondConfig((prev) => ({
        status: 'error',
        defaultBondAmount: prev?.defaultBondAmount,
        penaltyBps: prev?.penaltyBps ?? DEFAULT_CREATION_PENALTY_BPS,
        error: String(e?.message || e || 'Failed to load bond config'),
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [introHelpKey, bondManagerAddress, rpcUrl]);
  const introBondSummary = React.useMemo(() => {
    const amount = introBondConfig.defaultBondAmount;
    const bps = introBondConfig.penaltyBps;
    if (amount == null || bps == null) return null;
    const fee = (amount * BigInt(bps)) / 10_000n;
    const refundable = amount - fee;
    const pct = bps / 100;
    const pctStr = Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`;
    return { amount, bps, fee, refundable, pctStr };
  }, [introBondConfig.defaultBondAmount, introBondConfig.penaltyBps]);

  const promptSuggestion = React.useMemo(() => {
    return (
      PROMPT_EXAMPLE_SUGGESTIONS[promptPlaceholderIdx] ??
      PROMPT_EXAMPLE_SUGGESTIONS[0] ??
      'Current price of Bitcoin in USD'
    );
  }, [promptPlaceholderIdx]);
  const [discoveryState, setDiscoveryState] = React.useState<DiscoveryState>(initialState?.discoveryState ?? 'idle');
  const [discoveryResult, setDiscoveryResult] = React.useState<MetricDiscoveryResponse | null>(initialState?.discoveryResult ?? null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [sourcesFetchState, setSourcesFetchState] = React.useState<'idle' | 'loading' | 'success' | 'error'>(
    initialState?.discoveryResult && initialState?.discoveryState === 'success' ? 'success' : 'idle'
  );
  const [sourcesFetchNonce, setSourcesFetchNonce] = React.useState(0);
  const [selectedSource, setSelectedSource] = React.useState<MetricSourceOption | null>(initialState?.selectedSource ?? null);
  const [marketName, setMarketName] = React.useState(initialState?.marketName ?? '');
  const [marketDescription, setMarketDescription] = React.useState(initialState?.marketDescription ?? '');
  const [isNameConfirmed, setIsNameConfirmed] = React.useState(initialState?.isNameConfirmed ?? false);
  const [isDescriptionConfirmed, setIsDescriptionConfirmed] = React.useState(initialState?.isDescriptionConfirmed ?? false);
  const [iconFile, setIconFile] = React.useState<File | null>(null);
  const [iconPreviewUrl, setIconPreviewUrl] = React.useState<string | null>(initialState?.iconPreviewUrl ?? null);
  const [iconStoredUrl, setIconStoredUrl] = React.useState<string | null>(initialState?.iconStoredUrl ?? null);
  const [isIconSaving, setIsIconSaving] = React.useState(false);
  const [isIconConfirmed, setIsIconConfirmed] = React.useState(initialState?.isIconConfirmed ?? false);
  const [nameTouched, setNameTouched] = React.useState(initialState?.nameTouched ?? false);
  const [descriptionTouched, setDescriptionTouched] = React.useState(initialState?.descriptionTouched ?? false);

  // Validation state
  const [isValidating, setIsValidating] = React.useState(false);
  const [validationResult, setValidationResult] = React.useState<MetricResolutionResponse | null>(initialState?.validationResult ?? null);
  const [showValidationModal, setShowValidationModal] = React.useState(false);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  // Cache the most recently validated source so accidental navigation back to Step 3
  // doesn't force a re-fetch + re-run of the AI metric tool.
  const [cachedValidatedSelection, setCachedValidatedSelection] = React.useState<{
    key: string;
    source: MetricSourceOption;
    validation: MetricResolutionResponse;
  } | null>(null);

  const normalizeUrlForCache = React.useCallback((url: string) => {
    try {
      const u = new URL(url);
      u.hash = '';
      return u.toString().replace(/\/$/, '');
    } catch {
      return (url || '').trim().replace(/\/$/, '');
    }
  }, []);

  const makeValidationCacheKey = React.useCallback(
    (metric: string, url: string) => `${(metric || '').trim()}::${normalizeUrlForCache(url)}`,
    [normalizeUrlForCache]
  );

  // Source denial/re-search state
  const [deniedSourceUrls, setDeniedSourceUrls] = React.useState<string[]>(initialState?.deniedSourceUrls ?? []);
  const [searchVariation, setSearchVariation] = React.useState(0);

  // Duplicate market detection state
  type SimilarMarketMatch = {
    id: string;
    market_identifier: string;
    symbol: string;
    name: string;
    description: string;
    score: number;
    market_status: string;
    icon_image_url?: string | null;
  };
  type MetricUrlDuplicate = {
    id: string;
    market_identifier: string;
    symbol: string;
    name: string;
    metric_url: string | null;
  };
  const [similarMarkets, setSimilarMarkets] = React.useState<SimilarMarketMatch[]>([]);
  const [similarMarketsLoading, setSimilarMarketsLoading] = React.useState(false);
  const [similarMarketsAcknowledged, setSimilarMarketsAcknowledged] = React.useState(initialState?.similarMarketsAcknowledged ?? false);
  const [metricUrlDuplicates, setMetricUrlDuplicates] = React.useState<MetricUrlDuplicate[]>([]);
  const [metricUrlBlockedSource, setMetricUrlBlockedSource] = React.useState<string | null>(null);

  // Market creation state
  const [isCreatingMarket, setIsCreatingMarket] = React.useState(false);
  const router = useRouter();
  const deploymentOverlay = useDeploymentOverlay();
  const pusher = usePusher();

  React.useEffect(() => {
    if (discoveryState !== 'idle') return;
    if (isFocused) return;
    if (prompt.trim().length > 0) return;
    if (PROMPT_EXAMPLE_SUGGESTIONS.length <= 1) return;

    const id = window.setInterval(() => {
      setPromptPlaceholderIdx((i) => (i + 1) % PROMPT_EXAMPLE_SUGGESTIONS.length);
    }, 3200);
    return () => window.clearInterval(id);
  }, [discoveryState, isFocused, prompt]);

  // Create Market assistant state
  const [assistantMessage, setAssistantMessage] = React.useState<string>('');
  const [assistantIsLoading, setAssistantIsLoading] = React.useState(false);
  const [assistantHistory, setAssistantHistory] = React.useState<Array<{ role: 'system' | 'user' | 'assistant'; content: string }>>(
    (initialState?.assistantHistory as any) ?? []
  );

  const [metricClarification, setMetricClarification] = React.useState(initialState?.metricClarification ?? '');

  const [visibleStep, setVisibleStep] = React.useState<CreationStep>(initialState?.visibleStep ?? 'clarify_metric');
  const [isStepAnimating, setIsStepAnimating] = React.useState(false);
  const stepTimerRef = React.useRef<number | null>(null);

  const metricName = discoveryResult?.metric_definition?.metric_name;

  const promptRef = React.useRef(prompt);
  const marketNameRef = React.useRef(marketName);
  const marketDescriptionRef = React.useRef(marketDescription);
  const lastAssistantRequestKeyRef = React.useRef<string>('');

  React.useEffect(() => {
    promptRef.current = prompt;
  }, [prompt]);

  React.useEffect(() => {
    marketNameRef.current = marketName;
  }, [marketName]);

  React.useEffect(() => {
    marketDescriptionRef.current = marketDescription;
  }, [marketDescription]);

  // Report state changes to parent for draft auto-save
  const onStateChangeRef = React.useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  React.useEffect(() => {
    if (!onStateChangeRef.current) return;
    const snap: CreationStateSnapshot = {
      prompt,
      metricClarification,
      marketName,
      marketDescription,
      isNameConfirmed,
      nameTouched,
      isDescriptionConfirmed,
      descriptionTouched,
      isIconConfirmed,
      similarMarketsAcknowledged,
      discoveryResult,
      discoveryState,
      selectedSource,
      validationResult,
      deniedSourceUrls,
      iconStoredUrl,
      iconPreviewUrl,
      assistantHistory,
      visibleStep,
    };
    onStateChangeRef.current(snap);
  }, [
    prompt, metricClarification, marketName, marketDescription,
    isNameConfirmed, nameTouched, isDescriptionConfirmed, descriptionTouched,
    isIconConfirmed, similarMarketsAcknowledged, discoveryResult, discoveryState,
    selectedSource, validationResult, deniedSourceUrls, iconStoredUrl,
    iconPreviewUrl, assistantHistory, visibleStep,
  ]);

  const assistantRequestKey = React.useMemo(() => {
    if ((discoveryState !== 'success' && discoveryState !== 'clarify') || !discoveryResult) return '';
    // Avoid premature assistant conclusions while Step 3 source discovery is still running.
    // The assistant prompt may otherwise see empty `search_results` (define_only mode) and claim "no sources"
    // even though the UI is still actively searching.
    if (visibleStep === 'select_source' && (sourcesFetchState === 'idle' || sourcesFetchState === 'loading')) {
      return '';
    }
    return JSON.stringify({
      step: visibleStep,
      discoveryState,
      measurable: Boolean(discoveryResult.measurable),
      rejection: discoveryResult.rejection_reason ?? '',
      metricName: discoveryResult.metric_definition?.metric_name ?? '',
      selectedUrl: selectedSource?.url ?? '',
      sourcesFetchState,
    });
    // Intentionally exclude `discoveryResult.sources/search_results` so source fetching doesn't retrigger typing.
  }, [
    discoveryResult?.measurable,
    discoveryResult?.rejection_reason,
    discoveryResult?.metric_definition?.metric_name,
    discoveryState,
    selectedSource?.url,
    sourcesFetchState,
    visibleStep,
  ]);

  React.useEffect(() => {
    if (visibleStep !== 'select_source') return;
    if (sourcesFetchState !== 'idle' && sourcesFetchState !== 'loading') return;
    // Clear any stale assistant message so the fallback can display a consistent loading state.
    setAssistantMessage('');
    setAssistantIsLoading(false);
    lastAssistantRequestKeyRef.current = '';
  }, [sourcesFetchState, visibleStep]);

  const ensureDevDiscovery = React.useCallback((): MetricDiscoveryResponse => {
    if (discoveryResult?.metric_definition) return discoveryResult;

    const idea = (promptRef.current || prompt || 'Example metric').trim() || 'Example metric';
    const stub: MetricDiscoveryResponse = {
      measurable: true,
      metric_definition: {
        metric_name: idea,
        unit: '',
        scope: '',
        time_basis: '',
        measurement_method: '',
      },
      search_query: null,
      sources: null,
      rejection_reason: null,
      search_results: [],
      processing_time_ms: 0,
    };

    setDiscoveryResult(stub);
    return stub;
  }, [discoveryResult, prompt]);

  const devEnsureSelectedSource = React.useCallback(() => {
    if (selectedSource?.url) return selectedSource;
    const d = discoveryResult || ensureDevDiscovery();
    const primary = d.sources?.primary_source;
    const url = primary?.url || 'https://example.com';
    const host = (() => {
      try {
        return new URL(url).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    })();

    const devSource: MetricSourceOption = {
      id: 'dev-source',
      icon: (
        <div className="relative h-7 w-7">
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/15 text-white/90">
            <span className="text-[14px] font-semibold">D</span>
          </div>
        </div>
      ),
      label: primary?.authority || 'Dev Source',
      sublabel: host || undefined,
      url,
      confidence: primary?.confidence ?? 0,
      authority: primary?.authority || 'Dev',
      badge: 'Dev',
      iconBg: 'bg-gradient-to-br from-gray-500 to-gray-700',
      tooltip: {
        name: 'Dev Source',
        description: 'Developer-injected source (skip control).',
        reliability: 'Dev',
        updateFrequency: 'Unknown',
        dataType: 'Web/API',
      },
    };

    setSelectedSource(devSource);
    return devSource;
  }, [discoveryResult, ensureDevDiscovery, selectedSource]);

  const devJumpToStep = React.useCallback(
    (step: CreationStep) => {
      // Ensure we can render the chat UI.
      ensureDevDiscovery();
      setErrorMessage(null);
      setDiscoveryState(step === 'clarify_metric' ? 'clarify' : 'success');

      // Reset the "downstream" state so desiredStep matches the jump target.
      if (step === 'clarify_metric') {
        setIsNameConfirmed(false);
        setSimilarMarketsAcknowledged(false);
        setIsDescriptionConfirmed(false);
        setSelectedSource(null);
        setIsIconConfirmed(false);
        setSourcesFetchState('idle');
        return;
      }

      if (step === 'name') {
        setIsNameConfirmed(false);
        setSimilarMarketsAcknowledged(false);
        setIsDescriptionConfirmed(false);
        setSelectedSource(null);
        setIsIconConfirmed(false);
        setSourcesFetchState('idle');
        return;
      }

      // Ensure name exists (helps render).
      const metric = discoveryResult?.metric_definition?.metric_name || promptRef.current;
      if (!marketNameRef.current?.trim() && metric) {
        setMarketName(suggestMarketName({ metricName: metric }));
      }

      if (step === 'similar_markets') {
        setIsNameConfirmed(true);
        setSimilarMarketsAcknowledged(false);
        setIsDescriptionConfirmed(false);
        setSelectedSource(null);
        setIsIconConfirmed(false);
        setSourcesFetchState('idle');
        return;
      }

      if (step === 'description') {
        setIsNameConfirmed(true);
        setSimilarMarketsAcknowledged(true);
        setIsDescriptionConfirmed(false);
        setSelectedSource(null);
        setIsIconConfirmed(false);
        setSourcesFetchState('idle');
        return;
      }

      // Ensure description exists (helps render).
      const method = discoveryResult?.metric_definition?.measurement_method;
      if (!marketDescriptionRef.current?.trim() && metric) {
        setMarketDescription(
          suggestMarketDescription({
            metricName: metric,
            measurementMethod: method,
          })
        );
      }

      if (step === 'select_source') {
        setIsNameConfirmed(true);
        setSimilarMarketsAcknowledged(true);
        setIsDescriptionConfirmed(true);
        setSelectedSource(null);
        setIsIconConfirmed(false);
        // Dev track: do NOT make any searches. Provide a deterministic, hardcoded set of sources.
        if (devToolsEnabled) {
          setDiscoveryResult((prev) => {
            const base = prev || ensureDevDiscovery();
            return {
              ...base,
              measurable: true,
              rejection_reason: null,
              sources: DEV_SELECT_SOURCE_PRESET,
              search_results: [],
            };
          });
          setSourcesFetchState('success');
        } else {
          // Non-dev: trigger source fetch.
          setSourcesFetchState('idle');
          setSourcesFetchNonce((n) => n + 1);
        }
        return;
      }

      if (step === 'icon') {
        setIsNameConfirmed(true);
        setSimilarMarketsAcknowledged(true);
        setIsDescriptionConfirmed(true);
        devEnsureSelectedSource();
        setIsIconConfirmed(false);
        return;
      }

      if (step === 'complete') {
        setIsNameConfirmed(true);
        setSimilarMarketsAcknowledged(true);
        setIsDescriptionConfirmed(true);
        devEnsureSelectedSource();
        setIsIconConfirmed(true);
      }
    },
    [
      devEnsureSelectedSource,
      discoveryResult,
      ensureDevDiscovery,
      marketDescriptionRef,
      marketNameRef,
      promptRef,
      setSourcesFetchNonce,
    ]
  );

  const devSkipToReviewWithPreset = React.useCallback(() => {
    // Ensure we can render the flow, then fill everything required for the review screen.
    setErrorMessage(null);
    setDiscoveryState('success');

    // Fill core form fields
    setMarketName(DEV_REVIEW_PRESET.marketName);
    setMarketDescription(DEV_REVIEW_PRESET.marketDescription);
    setNameTouched(true);
    setDescriptionTouched(true);
    setIsNameConfirmed(true);
    setSimilarMarketsAcknowledged(true);
    setIsDescriptionConfirmed(true);

    // Pick an icon immediately
    setIconFile(null);
    setIconPreviewUrl(DEV_REVIEW_PRESET.iconUrl);
    setIsIconConfirmed(true);

    // Preselect a source immediately
    const devSource: MetricSourceOption = {
      id: 'dev-banana-source',
      icon: (
        <div className="relative h-7 w-7">
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/15 text-white/90">
            <span className="text-[14px] font-semibold">B</span>
          </div>
        </div>
      ),
      label: DEV_REVIEW_PRESET.sourceLabel,
      sublabel: DEV_REVIEW_PRESET.sourceDomain,
      url: DEV_REVIEW_PRESET.sourceUrl,
      confidence: 0.88,
      authority: DEV_REVIEW_PRESET.sourceAuthority,
      badge: 'Dev',
      iconBg: 'bg-gradient-to-br from-yellow-400 to-orange-500',
      tooltip: {
        name: DEV_REVIEW_PRESET.sourceLabel,
        description:
          'Official public time series page for average banana retail price in the U.S. (FRED APU0000711311).',
        reliability: 'High (Dev preset)',
        updateFrequency: 'Monthly',
        dataType: 'Web',
      },
    };
    setSelectedSource(devSource);
    setSourcesFetchState('success');

    // Make sure discoveryResult exists and is aligned with the preset (helps downstream UI + assistant context).
    setDiscoveryResult((prev) => {
      const base: MetricDiscoveryResponse =
        prev?.metric_definition
          ? prev
          : {
              measurable: true,
              metric_definition: {
                metric_name: DEV_REVIEW_PRESET.marketName,
                unit: 'USD per lb',
                scope: 'United States',
                time_basis: 'Monthly',
                measurement_method:
                  'Average retail price of bananas per pound as published by FRED (series APU0000711311).',
              },
              search_query: null,
              sources: null,
              rejection_reason: null,
              search_results: [],
              processing_time_ms: 0,
            };

      return {
        ...base,
        measurable: true,
        rejection_reason: null,
        metric_definition: base.metric_definition || {
          metric_name: DEV_REVIEW_PRESET.marketName,
          unit: 'USD per lb',
          scope: 'United States',
          time_basis: 'Monthly',
          measurement_method:
            'Average retail price of bananas per pound as published by FRED (series APU0000711311).',
        },
      };
    });

    // Pre-fill a validated start price so Create Market can proceed immediately.
    const nowIso = new Date().toISOString();
    setValidationResult({
      status: 'completed',
      processingTime: '0ms',
      cached: true,
      data: {
        metric: DEV_REVIEW_PRESET.marketName,
        value: DEV_REVIEW_PRESET.startPrice,
        unit: 'USD',
        as_of: nowIso,
        confidence: 0.88,
        asset_price_suggestion: DEV_REVIEW_PRESET.startPrice,
        reasoning: 'Dev preset value for fast end-to-end market creation.',
        sources: [
          {
            url: DEV_REVIEW_PRESET.sourceUrl,
            screenshot_url: '',
            quote: DEV_REVIEW_PRESET.startPrice,
            match_score: 0.9,
          },
        ],
      },
      performance: {
        totalTime: 0,
        breakdown: {
          cacheCheck: '0ms',
          scraping: '0ms',
          processing: '0ms',
          aiAnalysis: '0ms',
        },
      },
    });

    // Jump immediately to review step.
    if (stepTimerRef.current) {
      window.clearTimeout(stepTimerRef.current);
      stepTimerRef.current = null;
    }
    setIsStepAnimating(false);
    setVisibleStep('complete');

    // Close menu + ensure we land on the end screen.
    setDevToolsOpen(false);
  }, [DEV_REVIEW_PRESET]);

  const devQuickFillTestMarket = React.useCallback(() => {
    const code = randomDevCode4();
    setErrorMessage(null);
    setDiscoveryState('success');
    setUseImmediateSettlement(true);

    // Fill core fields with minimal test-friendly values.
    setMarketName(code);
    setMarketDescription('Development test market for settlement pipeline validation.');
    setNameTouched(true);
    setDescriptionTouched(true);
    setIsNameConfirmed(true);
    setSimilarMarketsAcknowledged(true);
    setIsDescriptionConfirmed(true);

    setIconFile(null);
    setIconPreviewUrl(null);
    setIconStoredUrl(null);
    setIsIconConfirmed(true);

    const devSource: MetricSourceOption = {
      id: `dev-quick-${code.toLowerCase()}`,
      icon: (
        <div className="relative h-7 w-7">
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/15 text-white/90">
            <span className="text-[12px] font-semibold">T</span>
          </div>
        </div>
      ),
      label: 'Dev Source',
      sublabel: 'example.com',
      url: 'https://example.com',
      confidence: 0.8,
      authority: 'Development',
      badge: 'Dev',
      iconBg: 'bg-gradient-to-br from-indigo-400 to-cyan-500',
    };
    setSelectedSource(devSource);
    setSourcesFetchState('success');
    setDiscoveryResult({
      measurable: true,
      metric_definition: {
        metric_name: code,
        unit: 'USD',
        scope: 'Development',
        time_basis: 'Spot',
        measurement_method: 'Development test metric from a generic source.',
      },
      search_query: null,
      sources: null,
      rejection_reason: null,
      search_results: [],
      processing_time_ms: 0,
    });

    const nowIso = new Date().toISOString();
    setValidationResult({
      status: 'completed',
      processingTime: '0ms',
      cached: true,
      data: {
        metric: code,
        value: '1',
        unit: 'USD',
        as_of: nowIso,
        confidence: 0.8,
        asset_price_suggestion: '1',
        reasoning: 'Dev quick-fill preset for test market creation.',
        sources: [
          {
            url: 'https://example.com',
            screenshot_url: '',
            quote: '1',
            match_score: 0.8,
          },
        ],
      },
      performance: {
        totalTime: 0,
        breakdown: {
          cacheCheck: '0ms',
          scraping: '0ms',
          processing: '0ms',
          aiAnalysis: '0ms',
        },
      },
    });

    // Jump immediately to review step.
    if (stepTimerRef.current) {
      window.clearTimeout(stepTimerRef.current);
      stepTimerRef.current = null;
    }
    setIsStepAnimating(false);
    setVisibleStep('complete');

    setDevToolsOpen(false);
  }, []);

  const devJumpToSelectSourceWithManySources = React.useCallback(() => {
    // Ensure we have a base discovery result first
    const base = ensureDevDiscovery();
    setErrorMessage(null);
    setDiscoveryState('success');

    // Ensure name and description are set (required for render)
    const metric = base.metric_definition?.metric_name || promptRef.current || 'Bitcoin Price';
    if (!marketNameRef.current?.trim()) {
      setMarketName(suggestMarketName({ metricName: metric }));
    }
    const method = base.metric_definition?.measurement_method;
    if (!marketDescriptionRef.current?.trim()) {
      setMarketDescription(
        suggestMarketDescription({
          metricName: metric,
          measurementMethod: method,
        })
      );
    }

    setIsNameConfirmed(true);
    setIsDescriptionConfirmed(true);
    setSelectedSource(null);
    setIsIconConfirmed(false);

    setDiscoveryResult({
      ...base,
      measurable: true,
      rejection_reason: null,
      sources: DEV_SELECT_SOURCE_MANY_PRESET,
      search_results: [],
    });
    setSourcesFetchState('success');
    setDevToolsOpen(false);
  }, [ensureDevDiscovery]);

  const runDefineOnlyDiscovery = async (description: string) => {
    setDiscoveryState('discovering');
    setErrorMessage(null);
    setSourcesFetchState('idle');
    setSelectedSource(null);
    setIsValidating(false);
    setValidationResult(null);
    setShowValidationModal(false);
    setValidationError(null);

    try {
      const response = await fetch('/api/metric-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, mode: 'define_only' }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Discovery failed');

      setDiscoveryResult(data);

      if (data.measurable) {
        setMetricClarification('');
        setDiscoveryState('success');
      } else {
        // Enter clarification loop rather than hard reject.
        setDiscoveryState('clarify');
      }
    } catch (error) {
      console.error('Discovery error:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to discover metric');
      setDiscoveryState('error');
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setMarketName('');
    setMarketDescription('');
    setIsNameConfirmed(false);
    setIsDescriptionConfirmed(false);
    setIconFile(null);
    setIconPreviewUrl(null);
    setIconStoredUrl(null);
    setIsIconSaving(false);
    setIsIconConfirmed(false);
    setNameTouched(false);
    setDescriptionTouched(false);
    // Reset assistant state
    setAssistantMessage('');
    setAssistantIsLoading(false);
    setAssistantHistory([{ role: 'user', content: prompt.trim() }]);
    setCachedValidatedSelection(null);
    // Reset duplicate detection state
    setSimilarMarkets([]);
    setSimilarMarketsLoading(false);
    setSimilarMarketsAcknowledged(false);
    setMetricUrlDuplicates([]);
    setMetricUrlBlockedSource(null);

    await runDefineOnlyDiscovery(prompt);
  };

  const handleReset = () => {
    setDiscoveryState('idle');
    setDiscoveryResult(null);
    setErrorMessage(null);
    setPrompt('');
    setSourcesFetchState('idle');
    setSelectedSource(null);
    setMarketName('');
    setMarketDescription('');
    setIsNameConfirmed(false);
    setIsDescriptionConfirmed(false);
    setIconFile(null);
    setIconPreviewUrl(null);
    setIconStoredUrl(null);
    setIsIconSaving(false);
    setIsIconConfirmed(false);
    setNameTouched(false);
    setDescriptionTouched(false);
    setMetricClarification('');
    // Reset validation state
    setIsValidating(false);
    setValidationResult(null);
    setShowValidationModal(false);
    setValidationError(null);
    setCachedValidatedSelection(null);
    // Reset source denial/re-search state
    setDeniedSourceUrls([]);
    setSearchVariation(0);
    // Reset duplicate detection state
    setSimilarMarkets([]);
    setSimilarMarketsLoading(false);
    setSimilarMarketsAcknowledged(false);
    setMetricUrlDuplicates([]);
    setMetricUrlBlockedSource(null);
    // Reset assistant state
    setAssistantMessage('');
    setAssistantIsLoading(false);
    setAssistantHistory([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleGenerate();
    }
  };

  // Gasless market creation pipeline (mirrors CreateMarketPage logic)
  const gaslessEnabled = String(
    (process.env as any).NEXT_PUBLIC_GASLESS_CREATE_ENABLED ||
    (globalThis as any)?.process?.env?.NEXT_PUBLIC_GASLESS_CREATE_ENABLED ||
    ''
  ).toLowerCase() === 'true';

  const pipelineMessages: string[] = gaslessEnabled
    ? [
        'Fetch facet cut configuration',
        'Build initializer and selectors',
        'Prepare meta-create',
        'Sign meta request',
        'Submit to relayer',
        'Wait for confirmation',
        'Parse FuturesMarketCreated event',
        'Verify required selectors',
        'Patch missing selectors if needed',
        'Attach session registry',
        'Grant admin roles on CoreVault',
        'Saving market metadata',
        'Finalize deployment',
      ]
    : [
        'Fetch facet cut configuration',
        'Build initializer and selectors',
        'Preflight validation (static call)',
        'Submit create transaction',
        'Wait for confirmation',
        'Parse FuturesMarketCreated event',
        'Verify required selectors',
        'Patch missing selectors if needed',
        'Grant admin roles on CoreVault',
        'Saving market metadata',
        'Finalize deployment',
      ];

  const stepIndexMap: Record<string, number> = {
    cut_fetch: 0,
    cut_build: 1,
    static_call: 2,
    send_tx: 3,
    confirm: gaslessEnabled ? 5 : 4,
    parse_event: gaslessEnabled ? 6 : 5,
    verify_selectors: gaslessEnabled ? 7 : 6,
    diamond_cut: gaslessEnabled ? 8 : 7,
    meta_prepare: 2,
    meta_signature: 3,
    relayer_submit: 4,
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

  const updateOverlayIndex = React.useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(idx, pipelineMessages.length - 1));
    const percent = Math.min(100, Math.round(((clamped + 1) / Math.max(pipelineMessages.length, 1)) * 100));
    deploymentOverlay.update({ activeIndex: clamped, percentComplete: percent });
  }, [deploymentOverlay, pipelineMessages.length]);

  const handleCreateMarket = React.useCallback(async () => {
    if (!selectedSource || !marketName.trim()) return;

    setIsCreatingMarket(true);
    let unsubscribePusher: (() => void) | null = null;

    try {
      const INITIAL_SPLASH_MS = 1200;
      const symbol = toConciseMarketIdentifier(marketName, { maxLen: 28 });
      const metricUrl = selectedSource.url;
      const dataSource = selectedSource.authority || selectedSource.label || 'User Provided';
      const tags: string[] = [];
      // Keep a safety buffer so create tx doesn't revert if block time catches up.
      const settlementDateTs = useImmediateSettlement
        ? Math.floor(Date.now() / 1000) + 10 * 60
        : Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
      let sourceLocator: { url: string; css_selector?: string; xpath?: string; html_snippet?: string; js_extractor?: string } | null = null;
      let startPrice = validationResult?.data?.asset_price_suggestion || validationResult?.data?.value || '1';

      // Try to get start price from AI worker if not already available
      const workerUrl = getMetricAIWorkerBaseUrl();
      const hasValidatedPrice = (() => {
        const raw = String(validationResult?.data?.asset_price_suggestion || validationResult?.data?.value || '').trim();
        if (!raw) return false;
        const n = Number(raw.replace(/,/g, '').replace(/[^0-9.]/g, ''));
        return Number.isFinite(n) && n > 0;
      })();

      // If we already have a validated price (normal flow) or a dev preset value, don't override it.
      if (!hasValidatedPrice && workerUrl && metricUrl) {
        try {
          const ai = await runMetricAIWithPolling(
            {
              metric: symbol,
              urls: [metricUrl],
              related_market_identifier: symbol,
              context: 'create',
            },
            { intervalMs: 2000, timeoutMs: 60000 } // Increased for screenshot + vision analysis
          );
          if (ai) {
            const suggested = ai.asset_price_suggestion || ai.value;
            if (suggested && !Number.isNaN(Number(suggested))) {
              startPrice = String(suggested);
            }
            if (!sourceLocator && Array.isArray(ai.sources) && ai.sources.length > 0) {
              const primary = ai.sources[0];
              if (primary && primary.url) {
                sourceLocator = { url: primary.url };
              }
            }
          }
        } catch {
          // Soft-fail; continue without AI prefill
        }
      }

      // Generate pipeline ID for tracking
      const pipelineId =
        (typeof crypto !== 'undefined' && (crypto as any).randomUUID)
          ? (crypto as any).randomUUID()
          : `cm-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

      // Subscribe to Pusher progress
      if (pusher) {
        try {
          unsubscribePusher = pusher.subscribeToChannel(`deploy-${pipelineId}`, {
            progress: (evt: any) => {
              const s = evt?.step;
              if (typeof s === 'string') {
                const idx = stepIndexMap[s];
                if (typeof idx === 'number') updateOverlayIndex(idx);
                if (s === 'factory_confirm_meta_mined' || s === 'factory_confirm_mined') {
                  deploymentOverlay.update({ transactionSigned: true });
                }
                if (s === 'save_market') {
                  const st = String(evt?.status || '').toLowerCase();
                  if (st === 'success') {
                    setTimeout(() => deploymentOverlay.fadeOutAndClose(300), 200);
                  }
                }
              }
            },
          });
        } catch {}
      }

      // Open global deployment overlay and navigate to token page
      deploymentOverlay.open({
        title: 'Deployment Pipeline',
        subtitle: 'Initializing market and registering oracle',
        messages: pipelineMessages,
        splashMs: INITIAL_SPLASH_MS,
        meta: { pipelineId, marketSymbol: symbol },
      });

      await new Promise(resolve => setTimeout(resolve, INITIAL_SPLASH_MS));
      router.replace(`/token/${encodeURIComponent(symbol)}?deploying=1`);

      // Optional Wayback Machine snapshot
      if (metricUrl) {
        void fetch('/api/archives/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: metricUrl,
            captureOutlinks: false,
            captureScreenshot: true,
            skipIfRecentlyArchived: true,
          }),
        }).catch(() => {});
      }

      // Ensure the icon is persisted in Supabase Storage (never save blob: URLs).
      const iconUrl =
        iconStoredUrl ||
        (iconPreviewUrl && !iconPreviewUrl.startsWith('blob:') ? iconPreviewUrl : null) ||
        (await ensureIconStored());

      // Create market on chain
      const { orderBook, marketId, chainId, transactionHash } = await createMarketOnChain({
        symbol,
        metricUrl,
        startPrice: String(startPrice),
        dataSource,
        tags,
        name: marketName.trim(),
        description: String(marketDescription || '').trim(),
        bannerImageUrl: iconUrl || null,
        iconImageUrl: iconUrl || null,
        aiSourceLocator: sourceLocator,
        settlementDate: settlementDateTs,
        pipelineId,
        onProgress: ({ step, status }) => {
          const idx = stepIndexMap[step];
          if (typeof idx === 'number') updateOverlayIndex(idx);
          if (
            (step === 'meta_signature' && status === 'success') ||
            (step === 'send_tx' && status === 'sent') ||
            (step === 'confirm' && status === 'mined')
          ) {
            deploymentOverlay.update({ transactionSigned: true });
          }
        },
      });

      if (!gaslessEnabled) {
        // Legacy: grant roles via server endpoint
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
        updateOverlayIndex(9);

        // Save market metadata
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
            name: marketName.trim(),
            description: String(marketDescription || '').trim() || `OrderBook market for ${symbol}`,
            category: ['CUSTOM'],
            decimals: 6,
            minimumOrderSize: Number(process.env.DEFAULT_MINIMUM_ORDER_SIZE || 0.1),
            settlementDate: settlementDateTs,
            tradingEndDate: null,
            dataRequestWindowSeconds: Number(process.env.DEFAULT_DATA_REQUEST_WINDOW_SECONDS || 3600),
            autoSettle: true,
            oracleProvider: null,
            initialOrder: {
              metricUrl,
              startPrice: String(startPrice),
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
            bannerImageUrl: iconUrl || null,
            iconImageUrl: iconUrl || null,
          }),
        });
        if (!saveRes.ok) {
          const sErr = await saveRes.json().catch(() => ({} as any));
          throw new Error(sErr?.error || 'Save failed');
        }
        updateOverlayIndex(10);
      }

      // Trigger post-deploy inspection
      void fetch('/api/markets/inspect-gasless', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderBook, autoFix: false, pipelineId }),
      }).catch(() => {});

      // Notify and navigate
      try {
        window.dispatchEvent(new CustomEvent('marketDeployed', { detail: { symbol } }));
      } catch {}
      onDeploySuccess?.(symbol, marketId);
      router.replace(`/token/${encodeURIComponent(symbol)}`);
      deploymentOverlay.fadeOutAndClose(500);
    } catch (error) {
      console.error('Error creating market:', error);
      deploymentOverlay.close();
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create market');
    } finally {
      setIsCreatingMarket(false);
      if (typeof unsubscribePusher === 'function') {
        try { unsubscribePusher(); } catch {}
      }
    }
  }, [
    selectedSource,
    marketName,
    marketDescription,
    validationResult,
    iconPreviewUrl,
    iconStoredUrl,
    deploymentOverlay,
    useImmediateSettlement,
    pusher,
    router,
    pipelineMessages,
    stepIndexMap,
    updateOverlayIndex,
    gaslessEnabled,
    onDeploySuccess,
  ]);

  React.useEffect(() => {
    if (discoveryState !== 'success' || !discoveryResult?.metric_definition) return;
    if (!marketName && !nameTouched) {
      setMarketName(suggestMarketName({ metricName: discoveryResult.metric_definition.metric_name }));
    }
    if (!marketDescription && !descriptionTouched) {
      setMarketDescription(
        suggestMarketDescription({
          metricName: discoveryResult.metric_definition.metric_name,
          measurementMethod: discoveryResult.metric_definition.measurement_method,
        })
      );
    }
  }, [discoveryState, discoveryResult]);

  // Check for similar existing markets as soon as the user types a market name.
  // Debounced to avoid hammering the API on every keystroke.
  const similarSearchTimerRef = React.useRef<number | null>(null);
  const lastSimilarQueryRef = React.useRef<string>(initialState?.marketName?.trim() || '');

  React.useEffect(() => {
    console.log('[SimilarMarkets] effect fired', JSON.stringify({ discoveryState, marketName, lastQuery: lastSimilarQueryRef.current }));
    if (discoveryState !== 'success' && discoveryState !== 'clarify') {
      console.log('[SimilarMarkets] skipped: discoveryState is', discoveryState);
      return;
    }
    const query = (marketName || '').trim();
    if (query.length < 2) {
      console.log('[SimilarMarkets] skipped: query too short', JSON.stringify(query));
      setSimilarMarkets([]);
      setSimilarMarketsLoading(false);
      lastSimilarQueryRef.current = '';
      return;
    }

    if (query === lastSimilarQueryRef.current) {
      console.log('[SimilarMarkets] skipped: same query as last time', JSON.stringify(query));
      return;
    }

    if (similarSearchTimerRef.current) {
      window.clearTimeout(similarSearchTimerRef.current);
    }

    console.log('[SimilarMarkets] scheduling search for', JSON.stringify(query));
    setSimilarMarketsLoading(true);
    setSimilarMarketsAcknowledged(false);

    const controller = new AbortController();

    similarSearchTimerRef.current = window.setTimeout(() => {
      lastSimilarQueryRef.current = query;
      console.log('[SimilarMarkets] fetching /api/markets/similar', JSON.stringify({ intent: promptRef.current, name: query }));
      void (async () => {
        try {
          const res = await fetch('/api/markets/similar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              intent: promptRef.current,
              name: query,
              limit: 5,
            }),
          });
          const json = await res.json().catch(() => ({}));
          console.log('[SimilarMarkets] API response', JSON.stringify({ status: res.status, matchCount: json?.matches?.length, matches: json?.matches?.map((m: any) => ({ name: m.name, symbol: m.symbol, score: m.score })) }));
          if (!controller.signal.aborted && Array.isArray(json?.matches)) {
            const relevant = (json.matches as SimilarMarketMatch[]).filter(
              (m) => m.score >= 0.08
            );
            console.log('[SimilarMarkets] relevant matches (score >= 0.08):', relevant.length, relevant.map((m) => ({ name: m.name, score: m.score })));
            setSimilarMarkets(relevant);
          }
        } catch (err) {
          console.warn('[SimilarMarkets] fetch error:', err);
        } finally {
          if (!controller.signal.aborted) setSimilarMarketsLoading(false);
        }
      })();
    }, 350);

    return () => {
      controller.abort();
      if (similarSearchTimerRef.current) {
        window.clearTimeout(similarSearchTimerRef.current);
        similarSearchTimerRef.current = null;
      }
    };
  }, [marketName, discoveryState]);

  React.useEffect(() => {
    // Important: `iconPreviewUrl` is the source of truth for remote selections.
    // This effect should ONLY derive a preview URL from an uploaded File (blob:)
    // or swap in the persisted Storage URL after import/upload.
    //
    // Previous behavior reset the preview to `null` whenever `iconFile` was null,
    // which overwrote remote selections and caused the preview square to stay black.
    if (iconFile) {
      const url = URL.createObjectURL(iconFile);
      setIconPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }

    // If we already uploaded/imported an icon into Supabase Storage, keep showing that.
    if (iconStoredUrl) setIconPreviewUrl(iconStoredUrl);
  }, [iconFile, iconStoredUrl]);

  const ensureIconStored = React.useCallback(async (): Promise<string | null> => {
    // Prefer a previously persisted URL.
    if (iconStoredUrl) return iconStoredUrl;
    const current = iconPreviewUrl;
    if (!current) return null;

    // Already a Supabase public object URL.
    if (current.includes('/storage/v1/object/public/market-images/')) {
      setIconStoredUrl(current);
      return current;
    }

    setIsIconSaving(true);
    try {
      // Local upload: store the selected file.
      if (current.startsWith('blob:') && iconFile) {
        const uploaded = await uploadImageToSupabase(iconFile, 'markets/icon');
        if (!uploaded.success || !uploaded.url) {
          throw new Error(uploaded.error || 'Icon upload failed');
        }
        setIconStoredUrl(uploaded.url);
        // Drop the local file to avoid keeping large blobs in memory.
        setIconFile(null);
        return uploaded.url;
      }

      // Remote URL selection: import to Storage via server (avoids CORS).
      if (/^https?:\/\//i.test(current)) {
        const res = await fetch('/api/market-images/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: current, kind: 'icon' }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json?.error || `Icon import failed (${res.status})`);
        }
        const publicUrl = typeof json?.publicUrl === 'string' ? json.publicUrl : null;
        if (!publicUrl) throw new Error('Icon import did not return a URL');
        setIconStoredUrl(publicUrl);
        return publicUrl;
      }

      return null;
    } finally {
      setIsIconSaving(false);
    }
  }, [iconFile, iconPreviewUrl, iconStoredUrl]);

  // Step 3: After name + description are confirmed, fetch sources (SERP + AI ranking) for MetricSourceBubble.
  // Includes searchVariation and deniedSourceUrls to support re-searching after user denies a source.
  React.useEffect(() => {
    if (discoveryState !== 'success' || !discoveryResult) return;
    if (visibleStep !== 'select_source') return;
    if (!isNameConfirmed || !isDescriptionConfirmed) return;
    if (sourcesFetchState === 'loading' || sourcesFetchState === 'success') return;

    const controller = new AbortController();
    setSourcesFetchState('loading');

    const query = `${marketNameRef.current || ''}\n\n${marketDescriptionRef.current || ''}`.trim() || promptRef.current;

    void (async () => {
      try {
        const res = await fetch('/api/metric-discovery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ 
            description: query, 
            mode: 'full',
            search_query: discoveryResult.search_query || undefined,
            searchVariation,
            excludeUrls: deniedSourceUrls.length > 0 ? deniedSourceUrls : undefined,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.message || 'Failed to fetch sources');

        if (!controller.signal.aborted) {
          // IMPORTANT: Step 1 (define_only) already produced a metric definition that powers the UI.
          // Step 3 (full) is *source discovery*. If SERP returns no results, the API may respond with
          // { measurable:false, metric_definition:null } which would blank out the UI. Preserve the
          // existing metric definition in that case so the user can still proceed via Custom URL.
          setDiscoveryResult((prev) => {
            const base = prev || discoveryResult;
            // If there's no prior state, just accept the payload.
            if (!base) return json as any;

            const incoming = json as Partial<MetricDiscoveryResponse>;
            const merged: MetricDiscoveryResponse = {
              ...base,
              ...incoming,
              metric_definition: incoming.metric_definition || base.metric_definition,
              search_query: incoming.search_query || base.search_query,
            };

            // Treat "no sources found" as a discovery limitation, not a measurability rejection.
            // Keep the original measurable flag when we already have a definition.
            if (base.metric_definition && incoming.measurable === false) {
              merged.measurable = true;
              merged.rejection_reason = base.rejection_reason ?? null;
            }

            return merged;
          });
          setSourcesFetchState('success');
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setSourcesFetchState('error');
        }
      }
    })();

    return () => controller.abort();
  }, [discoveryResult, discoveryState, isDescriptionConfirmed, isNameConfirmed, visibleStep, sourcesFetchNonce, searchVariation, deniedSourceUrls]);

  const desiredStep = React.useMemo<CreationStep>(() => {
    const step = (() => {
      if (!discoveryResult) return 'clarify_metric' as const;
      if (discoveryState === 'clarify') return 'clarify_metric' as const;
      if (discoveryState !== 'success') return 'clarify_metric' as const;
      if (!isNameConfirmed) return 'name' as const;
      if (similarMarkets.length > 0 && !similarMarketsAcknowledged) return 'similar_markets' as const;
      if (!isDescriptionConfirmed) return 'description' as const;
      if (!selectedSource) return 'select_source' as const;
      if (!isIconConfirmed) return 'icon' as const;
      return 'complete' as const;
    })();
    console.log('[DesiredStep]', step, { isNameConfirmed, similarMarketsCount: similarMarkets.length, similarMarketsAcknowledged, similarMarketsLoading, isDescriptionConfirmed });
    return step;
  }, [discoveryResult, discoveryState, isDescriptionConfirmed, isIconConfirmed, isNameConfirmed, selectedSource, similarMarkets.length, similarMarketsAcknowledged]);

  React.useEffect(() => {
    if ((discoveryState !== 'success' && discoveryState !== 'clarify') || !discoveryResult) {
      setAssistantMessage('');
      setAssistantIsLoading(false);
      lastAssistantRequestKeyRef.current = '';
      return;
    }

    // Prevent repeated assistant calls (and typewriter restarts) when unrelated state changes,
    // e.g. `discoveryResult` updating after sources are fetched.
    if (!assistantRequestKey || assistantRequestKey === lastAssistantRequestKeyRef.current) return;
    lastAssistantRequestKeyRef.current = assistantRequestKey;

    const controller = new AbortController();
    setAssistantIsLoading(true);

    void (async () => {
      try {
        const res = await fetch('/api/create-market-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            step: visibleStep,
            context: {
              metricPrompt: promptRef.current,
              discovery: {
                measurable: discoveryResult.measurable,
                rejection_reason: discoveryResult.rejection_reason ?? null,
                metric_definition: discoveryResult.metric_definition ?? null,
                search_query: discoveryResult.search_query ?? null,
                sources: discoveryResult.sources ?? null,
                // Include SERP candidates so the assistant doesn't incorrectly claim none exist.
                search_results: discoveryResult.search_results ?? [],
              },
              marketName: marketNameRef.current,
              marketDescription: marketDescriptionRef.current,
              selectedSource: selectedSource
                ? {
                    url: selectedSource.url,
                    label: selectedSource.label,
                    authority: selectedSource.authority,
                    confidence: selectedSource.confidence,
                  }
                : null,
            },
            history: assistantHistory,
          }),
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.message || 'Assistant request failed');

        const data = json as CreateMarketAssistantResponse;
        if (controller.signal.aborted) return;

        if (typeof data?.message === 'string' && data.message.trim()) {
          setAssistantMessage(data.message.trim());
          setAssistantHistory((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && last.content === data.message.trim()) return prev;
            return [...prev, { role: 'assistant' as const, content: data.message.trim() }].slice(-24);
          });
        }

        // Optional: let the assistant provide suggestions into the LEFT input bubbles,
        // but never overwrite user edits.
        if (visibleStep === 'name' && data?.suggestions?.marketName && !nameTouched) {
          setMarketName(data.suggestions.marketName);
        }
        if (visibleStep === 'description' && data?.suggestions?.marketDescription && !descriptionTouched) {
          setMarketDescription(data.suggestions.marketDescription);
        }
      } catch (e) {
        // Keep the last assistant message on transient errors to prevent UI "blinking".
      } finally {
        if (!controller.signal.aborted) {
          setAssistantIsLoading(false);
        }
      }
    })();

    return () => controller.abort();
    // We intentionally only refresh on step / source changes (not per keystroke).
  }, [
    assistantRequestKey,
    discoveryResult,
    discoveryState,
    visibleStep,
    selectedSource?.url,
    nameTouched,
    descriptionTouched,
    assistantHistory,
  ]);

  React.useEffect(() => {
    console.log('[StepTransition]', { visibleStep, desiredStep });
    if (visibleStep === desiredStep) return;
    console.log('[StepTransition] transitioning from', visibleStep, 'to', desiredStep);
    setIsStepAnimating(true);

    if (stepTimerRef.current) {
      window.clearTimeout(stepTimerRef.current);
    }

    stepTimerRef.current = window.setTimeout(() => {
      console.log('[StepTransition] setting visibleStep to', desiredStep);
      setAssistantMessage('');
      setAssistantIsLoading(true);
      setVisibleStep(desiredStep);
      requestAnimationFrame(() => setIsStepAnimating(false));
    }, 160);
  }, [desiredStep, visibleStep]);

  React.useEffect(() => {
    return () => {
      if (stepTimerRef.current) {
        window.clearTimeout(stepTimerRef.current);
      }
    };
  }, []);

  const fallbackAssistantResponseText = React.useMemo(() => {
    if ((discoveryState !== 'success' && discoveryState !== 'clarify') || !discoveryResult) return '';

    if (discoveryState === 'clarify' || !discoveryResult.measurable) {
      const reason = discoveryResult.rejection_reason ? ` ${discoveryResult.rejection_reason}` : '';
      return `I need one quick clarification to make this metric objectively measurable.${reason}`;
    }

    if (!isNameConfirmed) {
      return `Great — now pick a market name. I suggested one, but you can edit it.`;
    }

    if (similarMarkets.length > 0 && !similarMarketsAcknowledged) {
      return `I found ${similarMarkets.length} similar market${similarMarkets.length > 1 ? 's' : ''} that already exist. Take a look — if none of these match what you need, you can continue creating yours.`;
    }

    if (!isDescriptionConfirmed) {
      return `Next, add a short description. I suggested one, but you can edit it.`;
    }

    if (!selectedSource) {
      if (visibleStep === 'select_source' && (sourcesFetchState === 'idle' || sourcesFetchState === 'loading')) {
        return `Searching the web for reliable data sources…`;
      }
      if (visibleStep === 'select_source' && sourcesFetchState === 'error') {
        return `I couldn’t fetch data sources right now. Retry, or paste a public URL as a custom endpoint.`;
      }

      const hasCandidates =
        Boolean(discoveryResult?.sources?.primary_source?.url) ||
        (Array.isArray(discoveryResult?.search_results) && discoveryResult.search_results.length > 0) ||
        (Array.isArray(discoveryResult?.sources?.secondary_sources) && discoveryResult.sources.secondary_sources.length > 0);

      if (!hasCandidates) {
        return `I couldn’t find reliable public data sources for this metric. If you know a specific dataset or publisher, paste a public URL and we’ll use it.`;
      }

      return `Now pick a data source for this market.`;
    }

    if (!isIconConfirmed) {
      return `Last step — upload an icon image for your market.`;
    }

    return `Perfect. Your market setup is ready.`;
  }, [discoveryResult, discoveryState, isDescriptionConfirmed, isIconConfirmed, isNameConfirmed, selectedSource, similarMarkets.length, similarMarketsAcknowledged, sourcesFetchState, visibleStep]);

  return (
    <div
      className="relative w-full max-w-[90vw] sm:w-[702px] sm:max-w-[702px]"
      data-walkthrough="market-creator"
    >
      {/* Step panel - full page width chat layout with equal visual margins from edges */}
      {/* Left bubble: 40px from content edge (navbar 60px + 40px = 100px from screen edge) */}
      {/* Right bubble: 100px from screen edge */}
      {/* Hide when at 'complete' step - we show the MarketDetailsReview instead */}
      {(discoveryState === 'success' || discoveryState === 'clarify') && discoveryResult && visibleStep !== 'complete' ? (
        <div className="mt-6 w-full px-1 sm:px-0 lg:w-[calc(100vw-60px)] lg:ml-[calc(50%-50vw+60px)] lg:pl-[40px] lg:pr-[100px]">
          <StepPanel
                step={visibleStep}
                isAnimating={isStepAnimating}
                message={assistantMessage || (assistantIsLoading ? '' : fallbackAssistantResponseText)}
                isAssistantLoading={assistantIsLoading}
                userPrompt={
                  (assistantHistory.find((m) => m.role === 'user')?.content || promptRef.current || '').trim()
                }
                metricClarification={metricClarification}
                onChangeMetricClarification={setMetricClarification}
                onSubmitMetricClarification={async () => {
                  const reply = metricClarification.trim();
                  if (!reply) return;
                  setAssistantHistory((prev) => [...prev, { role: 'user' as const, content: reply }].slice(-24));
                  setMetricClarification('');
                  // Re-try metric definition using the original prompt + latest clarification.
                  const combined = `${promptRef.current}\n\nClarification: ${reply}`.trim();
                  await runDefineOnlyDiscovery(combined);
                }}
                marketName={marketName}
                onChangeName={(v) => {
                  setNameTouched(true);
                  setMarketName(v);
                }}
                onConfirmName={() => {
                  console.log('[onConfirmName] confirming name', { marketName, similarMarketsCount: similarMarkets.length, similarMarketsLoading, similarMarketsAcknowledged });
                  setIsNameConfirmed(true);
                }}
                marketDescription={marketDescription}
                onChangeDescription={(v) => {
                  setDescriptionTouched(true);
                  setMarketDescription(v);
                }}
                onConfirmDescription={() => setIsDescriptionConfirmed(true)}
                iconPreviewUrl={iconPreviewUrl}
                isIconSaving={isIconSaving}
                onConfirmIcon={async () => {
                  try {
                    setErrorMessage(null);
                    const stored = await ensureIconStored();
                    if (!stored) throw new Error('Please select an icon image.');
                    // Ensure we’re now using the persisted (Supabase) URL everywhere.
                    setIconStoredUrl(stored);
                    setIconPreviewUrl(stored);
                    setIsIconConfirmed(true);
                  } catch (e: any) {
                    setErrorMessage(e?.message || 'Icon upload failed');
                  }
                }}
                onStartOver={handleReset}
            devTools={
              devToolsEnabled ? (
                <button
                  type="button"
                  onClick={() => setDevToolsOpen((v) => !v)}
                  className="rounded-md border border-dashed border-purple-500/40 bg-purple-500/10 px-2 py-1 text-[11px] font-medium text-purple-300 hover:bg-purple-500/20"
                >
                  Dev
                </button>
              ) : null
            }
          />
        </div>
      ) : null}

      {/* Prompt composer (removed after discovery/clarification to transition to chat) */}
      {discoveryState !== 'success' && discoveryState !== 'clarify' && (
        <div
          className={`relative space-y-1 rounded-3xl border-[0.5px] bg-[#0F0F0F] p-3 pt-1.5 shadow-lg transition-shadow duration-200 ease-out ${
            isFocused
              ? 'shadow-[0px_0px_0px_3px_rgb(35,35,35)] border-white/15'
              : 'border-white/8'
          }`}
        >
          {/* Input area */}
          <div className="relative px-1 py-2">
            <textarea
              ref={promptTextareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder=""
              aria-label="Metric prompt"
              className="w-full resize-none border-0 bg-transparent text-sm text-white placeholder:text-white/40 outline-none focus:outline-none focus:ring-0 focus:border-0 sm:text-base leading-relaxed"
              style={{ outline: 'none', boxShadow: 'none' }}
              rows={2}
              disabled={discoveryState === 'discovering'}
            />
            {!prompt.trim() ? (
              <div
                key={`${discoveryState}:${promptPlaceholderIdx}`}
                className="pointer-events-none absolute inset-0 flex items-start text-sm text-white/40 sm:text-base leading-relaxed px-0 py-0"
              >
                <div className="placeholderSlideUp px-0 py-0">
                  {promptSuggestion}
                </div>
              </div>
            ) : null}
          </div>

          {/* Bottom toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-1.5 sm:gap-3">
            <div className="flex items-center gap-2 text-xs text-white/70 sm:gap-3">
              {discoveryState === 'idle' && (
                <>
                  {/* Dev-only toggle */}
                  {devToolsEnabled ? (
                    <button
                      type="button"
                      onClick={() => setDevToolsOpen((v) => !v)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-purple-500/40 bg-purple-500/10 px-2 py-1 text-purple-300 hover:bg-purple-500/20 transition-colors"
                      aria-label="Dev tools"
                    >
                      <span className="text-xs">Dev</span>
                    </button>
                  ) : null}
                </>
              )}
              {discoveryState === 'discovering' && (
                <div className="flex items-center gap-1.5" aria-live="polite" aria-label="Loading">
                  <span className="sr-only">Loading</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-white/45 animate-bounce" />
                  <span className="h-1.5 w-1.5 rounded-full bg-white/45 animate-bounce [animation-delay:120ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-white/45 animate-bounce [animation-delay:240ms]" />
                </div>
              )}
              {(discoveryState === 'rejected' || discoveryState === 'error') && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-white/70 text-sm hover:text-white transition-colors"
                >
                  ← Start over
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={!prompt.trim() || discoveryState === 'discovering'}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-xs font-medium text-black shadow-sm transition-all hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-50 disabled:cursor-not-allowed sm:gap-2 sm:px-4 sm:py-2 sm:text-sm"
            >
              {discoveryState === 'discovering' ? (
                <span
                  className="h-4 w-4 animate-spin rounded-full border border-black/20 border-t-black"
                  aria-hidden="true"
                />
              ) : (
                <IconSparkles className="h-3.5 w-3.5 text-black sm:h-4 sm:w-4" />
              )}
              <span>Create</span>
            </button>
          </div>
        </div>
      )}

      {/* Helpful bubbles under the prompt (replaces carousel) */}
      {discoveryState === 'idle' && !prompt.trim() && (
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2 px-1 bubblesSlideUp">
          <div className="w-full max-w-[860px] space-y-3">
            <div className="w-full text-center text-[11px] font-medium text-white/35">
              Learn how this works
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {INTRO_LEARN_BUBBLES.map((b) => {
                const selected = introHelpKey === b.key;
                return (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => setIntroHelpKey((k) => (k === b.key ? null : b.key))}
                    className={[
                      'group inline-flex items-center rounded-full border px-3 py-1.5 text-[12px] transition-colors',
                      selected
                        ? 'border-white/20 bg-white/[0.08] text-white'
                        : 'border-white/10 bg-white/[0.03] text-white/75 hover:bg-white/[0.06] hover:text-white',
                    ].join(' ')}
                    aria-label={b.label}
                  >
                    <span
                      className={[
                        'mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full border text-[11px] leading-none',
                        selected ? 'border-white/25 text-white/90' : 'border-white/15 text-white/55 group-hover:text-white/70',
                      ].join(' ')}
                      aria-hidden="true"
                    >
                      ?
                    </span>
                    <span>{b.label}</span>
                  </button>
                );
              })}
            </div>

            {introHelpKey ? (
              <div className="mx-auto w-full max-w-[760px] rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-left">
                {introHelpKey === 'how_creation_works' ? (
                  <>
                    <div className="text-[12px] font-medium text-white/85">How creation works</div>
                    <div className="mt-1 text-[12px] text-white/60">
                      Describe a metric in plain English. We draft a measurable definition, find candidate sources, and you
                      confirm details before creating the market on-chain.
                    </div>
                  </>
                ) : introHelpKey === 'suggestions' ? (
                  <>
                    <div className="text-[12px] font-medium text-white/85">How rewards work</div>
                    <div className="mt-1 text-[12px] text-white/60">
                      Rewards are protocol fees generated by activity in your market. For the first{' '}
                      <span className="text-white/85">12 months</span> after a market is created, rewards are split{' '}
                      <span className="text-white/85">80%</span> to the market creator address and{' '}
                      <span className="text-white/85">20%</span> to Dexetera to support operations and growth.
                      <br />
                      <br />
                      After that first-year period ends, rewards from the market go{' '}
                      <span className="text-white/85">100%</span> to Dexetera. The split is enforced by the protocol and is
                      attributed to the creator address used at market creation.
                    </div>
                  </>
                ) : introHelpKey === 'settlement' ? (
                  <>
                    <div className="text-[12px] font-medium text-white/85">How settlement works</div>
                    <div className="mt-1 text-[12px] text-white/60">
                      Markets settle against a single, verifiable number derived from the source you choose. We validate the
                      URL and definition so settlement is unambiguous.
                    </div>
                  </>
                ) : introHelpKey === 'bond_penalty' ? (
                  <>
                    <div className="text-[12px] font-medium text-white/85">Bond &amp; penalty</div>
                    <div className="mt-1 text-[12px] text-white/60">
                      Creating a market requires a bond set by the protocol. If you deactivate an unused market, the bond can be
                      reclaimed only if there have been no trades, no open orders, and no active positions (net of any penalty).
                    </div>

                    <div className="mt-3 grid gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[12px] text-white/70 sm:grid-cols-3">
                      <div>
                        <div className="text-[11px] text-white/45">Bond</div>
                        <div className="mt-0.5 text-white/85">
                          {introBondSummary
                            ? formatUsdc6(introBondSummary.amount)
                            : introBondConfig.status === 'loading'
                              ? 'Loading…'
                              : 'Configured by protocol'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-white/45">Creation penalty</div>
                        <div className="mt-0.5 text-white/85">
                          {introBondSummary
                            ? `${introBondSummary.pctStr} (${formatUsdc6(introBondSummary.fee)})`
                            : introBondConfig.status === 'loading'
                              ? 'Loading…'
                              : introBondConfig.penaltyBps != null
                                ? `${formatBpsPct(introBondConfig.penaltyBps)} (applies on refund)`
                                : 'Applies on refund'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-white/45">Refundable</div>
                        <div className="mt-0.5 text-white/85">
                          {introBondSummary ? formatUsdc6(introBondSummary.refundable) : 'Net of penalty'}
                        </div>
                      </div>
                    </div>

                    {introBondConfig.status === 'error' ? (
                      <div className="mt-2 text-[11px] text-white/40">
                        Could not load bond config on this network. {introBondConfig.error ? `(${introBondConfig.error})` : null}
                      </div>
                    ) : null}
                    {!bondManagerAddress ? (
                      <div className="mt-2 text-[11px] text-white/35">
                        Tip: set <span className="font-mono">NEXT_PUBLIC_MARKET_BOND_MANAGER_ADDRESS</span> to display exact bond values here.
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className="text-[12px] font-medium text-white/85">What makes a good market?</div>
                    <div className="mt-1 text-[12px] text-white/60">
                      Pick one number, one unit, and one source. Add scope (who/where) and a cadence (daily, monthly, etc.) so
                      settlement is verifiable and repeatable.
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      <style jsx>{`
        .placeholderSlideUp {
          animation: placeholder-rise-fade 3200ms ease-in-out both;
          will-change: transform, opacity;
          padding-top: 0.5rem; /* matches textarea visual offset */
          padding-left: 0.25rem; /* matches input area's px-1 */
          padding-right: 0.25rem;
        }

        .bubblesSlideUp {
          animation: bubbles-slide-up 260ms ease-out both;
        }

        @keyframes placeholder-rise-fade {
          from {
            transform: translateY(10px);
            opacity: 0;
          }
          6% {
            transform: translateY(0);
            opacity: 1;
          }
          85% {
            transform: translateY(0);
            opacity: 1;
          }
          to {
            transform: translateY(-10px);
            opacity: 0;
          }
        }

        /* Legacy name kept for safety in case of cached styles */
        @keyframes placeholder-slide-up {
          from {
            transform: translateY(10px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }

        @keyframes bubbles-slide-up {
          from {
            transform: translateY(10px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }

        @keyframes similar-market-in {
          from {
            transform: translateY(24px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>

      {/* Similar markets bubble display (gate between name → description) */}
      {(() => { console.log('[SimilarMarketsRender] gate check', { discoveryState, visibleStep, similarMarketsLength: similarMarkets.length }); return null; })()}
      {discoveryState === 'success' &&
        visibleStep === 'similar_markets' &&
        similarMarkets.length > 0 && (
        <div className="mt-8 w-full sm:w-[calc(100%+320px)] sm:max-w-[calc(100vw-120px)] sm:-ml-[280px]">
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:gap-4">
              {similarMarkets.map((m, index) => (
                <a
                  key={m.id}
                  href={`/token/${encodeURIComponent(m.symbol || m.market_identifier)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative flex items-center gap-3 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 transition-all duration-200 hover:bg-white/5"
                  style={{
                    opacity: 1,
                    transform: 'translateY(0)',
                    animation: `similar-market-in 0.5s ease-out ${index * 80 + 100}ms both`,
                  }}
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl overflow-hidden shadow-lg bg-gradient-to-br from-amber-400 to-orange-500">
                    {m.icon_image_url ? (
                      <img
                        src={m.icon_image_url}
                        alt={m.name || m.symbol}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          const el = e.currentTarget;
                          el.style.display = 'none';
                          const fallback = el.nextElementSibling as HTMLElement | null;
                          if (fallback) fallback.style.display = '';
                        }}
                      />
                    ) : null}
                    <span
                      className="text-[16px] font-semibold text-white"
                      style={m.icon_image_url ? { display: 'none' } : undefined}
                    >
                      {(m.name || m.symbol || '?')[0].toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <div className="flex min-w-0 items-baseline gap-1">
                        <div className="shrink-0 text-sm font-medium text-white">{m.name || m.market_identifier}</div>
                        <div className="min-w-0 truncate text-sm font-medium text-white/60">{m.symbol}</div>
                      </div>
                      <span className="ml-auto shrink-0 rounded-full bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium text-amber-200 pointer-events-none">
                        {Math.round(m.score * 100)}% match
                      </span>
                    </div>
                    <div className="text-xs text-white/40 mt-0.5 truncate max-w-[200px] sm:max-w-[320px]">{m.description}</div>
                  </div>
                </a>
              ))}
            </div>

            <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:gap-3">
              <button
                type="button"
                onClick={() => setSimilarMarketsAcknowledged(true)}
                className="inline-flex h-9 items-center justify-center rounded-xl bg-white px-5 text-sm font-medium text-black hover:bg-white/90 transition-colors"
              >
                Continue anyway
              </button>
              <span className="text-[11px] text-white/40">
                These markets look similar — you can still create yours.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Discovery Results - Source Selection Tiles (Step 3) */}
      {discoveryState === 'success' &&
        discoveryResult &&
        discoveryResult.metric_definition &&
        visibleStep === 'select_source' && (
        <MetricSourceBubble
          primarySource={discoveryResult?.sources?.primary_source ?? null}
          secondarySources={discoveryResult?.sources?.secondary_sources ?? []}
          metricName={discoveryResult.metric_definition.metric_name}
          searchResults={discoveryResult.search_results ?? []}
          validatedSourceUrl={cachedValidatedSelection?.source?.url ?? null}
          fetchState={sourcesFetchState}
          onRetry={() => {
            // Force a re-fetch (effect runs when fetchState returns to idle).
            setSourcesFetchState('idle');
            setSourcesFetchNonce((n) => n + 1);
          }}
          isVisible={true}
          onBack={() => {
            setIsDescriptionConfirmed(false);
          }}
          onSelectSource={async (source) => {
            const md = discoveryResult.metric_definition;
            if (!md) return;

            // Clear any previous metric URL block state.
            setMetricUrlBlockedSource(null);
            setMetricUrlDuplicates([]);

            // Hard block: check if this exact metric URL is already used by an existing market.
            try {
              const dupRes = await fetch('/api/markets/similar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ metric_url: source.url }),
              });
              const dupJson = await dupRes.json().catch(() => ({}));
              if (Array.isArray(dupJson?.metric_url_duplicates) && dupJson.metric_url_duplicates.length > 0) {
                setMetricUrlDuplicates(dupJson.metric_url_duplicates);
                setMetricUrlBlockedSource(source.url);
                return;
              }
            } catch {
              // Non-critical; allow proceeding if the check fails.
            }

            const nextKey = makeValidationCacheKey(md.metric_name, source.url);
            const canReuseValidation =
              Boolean(cachedValidatedSelection?.validation) && cachedValidatedSelection?.key === nextKey;

            if (canReuseValidation) {
              setSelectedSource(source);
              setIsValidating(false);
              setValidationError(null);
              setShowValidationModal(false);
              setValidationResult(cachedValidatedSelection!.validation);
              return;
            }

            setSelectedSource(source);
            // Changing the source invalidates downstream confirmation (icon + validation).
            setIsIconConfirmed(false);
            
            // Optionally enrich defaults with source if user hasn't edited.
            if (!nameTouched) {
              setMarketName(
                suggestMarketName({
                  metricName: md.metric_name,
                  sourceLabel: source.label,
                })
              );
            }
            if (!descriptionTouched) {
              setMarketDescription(
                suggestMarketDescription({
                  metricName: md.metric_name,
                  measurementMethod: md.measurement_method,
                  sourceLabel: source.label,
                })
              );
            }

            // Trigger AI validation with the selected source
            setIsValidating(true);
            setValidationError(null);
            setShowValidationModal(true);
            setValidationResult(null);

            try {
              const started = Date.now();
              const ai = await runMetricAIWithPolling(
                {
                  metric: marketName || md.metric_name,
                  description: marketDescription || `Resolve current value for ${md.metric_name}`,
                  urls: [source.url],
                  context: 'create',
                },
                { intervalMs: 2000, timeoutMs: 60000 } // Increased for screenshot + vision analysis
              );

              if (!ai) throw new Error('AI analysis did not return a result in time');

              const processingMs = Math.max(0, Date.now() - started);
              const result = toModalResponse(ai, marketName || md.metric_name, processingMs);
              const numericCandidate = String(
                result?.data?.asset_price_suggestion || result?.data?.value || ''
              )
                .trim()
                .replace(/,/g, '')
                .replace(/[^0-9.]/g, '');
              const parsed = Number(numericCandidate);
              if (!numericCandidate || !Number.isFinite(parsed) || parsed <= 0) {
                throw new Error(
                  "We couldn’t extract a numeric metric price from that URL. Please pick another suggested source, or use Custom URL to paste a different public endpoint."
                );
              }
              
              setValidationResult(result);
              setCachedValidatedSelection({ key: nextKey, source, validation: result });
              setIsValidating(false);
            } catch (error) {
              console.error('Validation Error:', error);
              setValidationError(error instanceof Error ? error.message : 'Validation failed');
              setIsValidating(false);
              // Keep the user on source selection so they can choose another source / custom URL.
              setSelectedSource(null);
            }
          }}
        />
      )}

      {/* Hard block: duplicate metric URL */}
      {metricUrlBlockedSource && metricUrlDuplicates.length > 0 && visibleStep === 'select_source' && (
        <div className="mt-4 w-full max-w-[560px]">
          <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.08] px-4 py-3 shadow-lg">
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-red-400" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              <span className="text-[13px] font-medium text-red-200">
                This metric source is already in use
              </span>
            </div>
            <div className="mt-2 text-[12px] text-white/60">
              The URL you selected is already used by {metricUrlDuplicates.length === 1 ? 'an existing market' : `${metricUrlDuplicates.length} existing markets`}. You cannot create a new market with the same metric source. Please choose a different data source.
            </div>
            <div className="mt-2 space-y-1.5">
              {metricUrlDuplicates.map((m) => (
                <a
                  key={m.id}
                  href={`/token/${encodeURIComponent(m.symbol || m.market_identifier)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-left transition-colors hover:bg-white/8 group"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-white/85 truncate">{m.name || m.market_identifier}</div>
                    <div className="text-[11px] text-white/45 truncate">{m.symbol}</div>
                  </div>
                  <span className="shrink-0 text-[10px] text-white/30 group-hover:text-white/50 transition-colors">View</span>
                </a>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setMetricUrlBlockedSource(null);
                setMetricUrlDuplicates([]);
              }}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[12px] font-medium text-white/80 hover:bg-white/[0.08] transition-colors"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
              </svg>
              Choose a different source
            </button>
          </div>
        </div>
      )}

      {/* Icon Selection Tiles (Step: Icon) */}
      {discoveryState === 'success' &&
        discoveryResult &&
        discoveryResult.metric_definition &&
        visibleStep === 'icon' && (
        <IconSearchBubble
          query={marketName || discoveryResult.metric_definition.metric_name || prompt}
          description={marketDescription || undefined}
          onSelectIcon={(url) => {
            setIconFile(null);
            setIconStoredUrl(null);
            setIconPreviewUrl(url);
            setIsIconConfirmed(false);
          }}
          onUploadIcon={(file) => {
            setIconFile(file);
            setIconStoredUrl(null);
            setIsIconConfirmed(false);
          }}
          selectedIconUrl={iconPreviewUrl}
          isVisible={true}
          onBack={() => {
            setSelectedSource(null);
          }}
        />
      )}

      {/* Market Details Review (Step: Complete) */}
      {discoveryState === 'success' &&
        discoveryResult &&
        visibleStep === 'complete' && (
        <MarketDetailsReview
          marketName={marketName}
          marketDescription={marketDescription}
          selectedSource={selectedSource}
          iconPreviewUrl={iconPreviewUrl}
          metricDefinition={discoveryResult.metric_definition}
          onEdit={(step) => {
            if (step === 'name') {
              setIsNameConfirmed(false);
              setSimilarMarketsAcknowledged(false);
              setIsDescriptionConfirmed(false);
              setSelectedSource(null);
              setIsIconConfirmed(false);
            } else if (step === 'description') {
              setIsDescriptionConfirmed(false);
              setSelectedSource(null);
              setIsIconConfirmed(false);
            } else if (step === 'select_source') {
              setSelectedSource(null);
            } else if (step === 'icon') {
              setIsIconConfirmed(false);
            } else if (step === 'clarify_metric') {
              setIsNameConfirmed(false);
              setSimilarMarketsAcknowledged(false);
              setIsDescriptionConfirmed(false);
              setSelectedSource(null);
              setIsIconConfirmed(false);
              setDiscoveryState('clarify');
            }
          }}
          onStartOver={handleReset}
          onCreateMarket={handleCreateMarket}
          isCreating={isCreatingMarket}
          showImmediateSettlementToggle={devToolsEnabled}
          useImmediateSettlement={useImmediateSettlement}
          onToggleImmediateSettlement={setUseImmediateSettlement}
        />
      )}

      {/* Rejection Notice */}
      {discoveryState === 'rejected' && discoveryResult && (
        <div className="mt-4 rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-4 sm:p-6">
          <h3 className="text-lg font-medium text-yellow-400 mb-3">⚠ Metric Not Measurable</h3>
          <p className="text-sm text-white/80 mb-4">{discoveryResult.rejection_reason}</p>
          <div className="text-xs text-white/60">
            Try refining your metric to be more specific and objectively measurable using public data sources.
          </div>
        </div>
      )}

      {/* Error Notice */}
      {discoveryState === 'error' && (
        <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/5 p-4 sm:p-6">
          <h3 className="text-lg font-medium text-red-400 mb-3">✗ Discovery Failed</h3>
          <p className="text-sm text-white/80">{errorMessage || 'An unexpected error occurred'}</p>
        </div>
      )}

      {/* AI Validation Modal */}
      <MetricResolutionModal
        isOpen={showValidationModal}
        onClose={() => {
          setShowValidationModal(false);
          setValidationResult(null);
          setValidationError(null);
        }}
        response={validationResult}
        error={validationError}
        onAccept={() => {
          setShowValidationModal(false);
        }}
        onPickAnotherSource={() => {
          setSelectedSource(null);
          setShowValidationModal(false);
          setValidationResult(null);
          setValidationError(null);
          setCachedValidatedSelection(null);
        }}
        onDeny={() => {
          if (selectedSource?.url) {
            setDeniedSourceUrls((prev) => [...prev, selectedSource.url]);
          }
          setSelectedSource(null);
          setSearchVariation((prev) => prev + 1);
          setSourcesFetchState('idle');
          setSourcesFetchNonce((n) => n + 1);
          setShowValidationModal(false);
          setValidationResult(null);
          setValidationError(null);
          setCachedValidatedSelection(null);
        }}
      />

      {/* Fixed dev tools panel */}
      {devToolsEnabled && devToolsOpen && (
        <div className="fixed bottom-4 left-4 z-[9999] w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-purple-500/25 bg-[#111] shadow-2xl shadow-purple-900/20 ring-1 ring-black">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <span className="text-[11px] font-semibold tracking-wide text-purple-300 uppercase">Dev Tools</span>
            <button
              type="button"
              onClick={() => setDevToolsOpen(false)}
              className="flex h-5 w-5 items-center justify-center rounded text-white/40 hover:bg-white/10 hover:text-white/80 transition-colors"
              aria-label="Close dev tools"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto overscroll-contain p-2 space-y-1">
            <div className="px-1.5 pt-1 pb-0.5 text-[10px] font-medium text-white/35 uppercase tracking-wider">Quick fill</div>
            <button
              type="button"
              onClick={() => { devQuickFillTestMarket(); setDevToolsOpen(false); }}
              className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-green-300 hover:bg-green-500/10 transition-colors"
            >
              Test market (4-char + immediate)
            </button>

            <div className="px-1.5 pt-2 pb-0.5 text-[10px] font-medium text-white/35 uppercase tracking-wider">Jump to step</div>
            <div className="flex flex-wrap gap-1 px-1">
              {(['clarify_metric', 'name', 'description', 'select_source', 'icon', 'complete'] as CreationStep[]).map(
                (s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => { devJumpToStep(s); setDevToolsOpen(false); }}
                    className={[
                      'rounded-md border px-2 py-1 text-[11px] transition-colors',
                      visibleStep === s
                        ? 'border-purple-500/40 bg-purple-500/15 text-purple-200'
                        : 'border-white/8 bg-white/[0.03] text-white/60 hover:bg-white/[0.07] hover:text-white/80',
                    ].join(' ')}
                  >
                    {s.replace(/_/g, ' ')}
                  </button>
                )
              )}
            </div>

            <div className="px-1.5 pt-2 pb-0.5 text-[10px] font-medium text-white/35 uppercase tracking-wider">Presets</div>
            <div className="flex flex-wrap gap-1 px-1">
              <button
                type="button"
                onClick={() => { devSkipToReviewWithPreset(); setDevToolsOpen(false); }}
                className="rounded-md border border-white/8 bg-white/[0.03] px-2 py-1 text-[11px] text-white/60 hover:bg-white/[0.07] hover:text-white/80 transition-colors"
              >
                Bananas preset
              </button>
              <button
                type="button"
                onClick={() => { devJumpToSelectSourceWithManySources(); setDevToolsOpen(false); }}
                className="rounded-md border border-white/8 bg-white/[0.03] px-2 py-1 text-[11px] text-white/60 hover:bg-white/[0.07] hover:text-white/80 transition-colors"
              >
                10 sources
              </button>
            </div>

            <div className="px-1.5 pt-2 pb-0.5 text-[10px] font-medium text-white/35 uppercase tracking-wider">Modals</div>
            <div className="flex flex-wrap gap-1 px-1">
              <button
                type="button"
                onClick={() => {
                  setValidationResult({
                    status: 'completed',
                    processingTime: '1,234ms',
                    cached: false,
                    data: {
                      metric: marketName || 'Bitcoin Price',
                      value: '97,245.50',
                      unit: 'USD',
                      as_of: new Date().toISOString(),
                      confidence: 0.92,
                      asset_price_suggestion: '97,245.50',
                      reasoning: 'The current Bitcoin price was retrieved from the CoinGecko API endpoint.',
                      sources: [{
                        url: selectedSource?.url || 'https://api.coingecko.com/api/v3/simple/price',
                        screenshot_url: '',
                        quote: 'BTC: $97,245.50 USD',
                        match_score: 0.95,
                      }],
                    },
                    performance: {
                      totalTime: 1234,
                      breakdown: { cacheCheck: '12ms', scraping: '456ms', processing: '234ms', aiAnalysis: '532ms' },
                    },
                  });
                  setShowValidationModal(true);
                  setDevToolsOpen(false);
                }}
                className="rounded-md border border-white/8 bg-white/[0.03] px-2 py-1 text-[11px] text-white/60 hover:bg-white/[0.07] hover:text-white/80 transition-colors"
              >
                Validation
              </button>
              <button
                type="button"
                onClick={() => {
                  setValidationResult(null);
                  setShowValidationModal(true);
                  setDevToolsOpen(false);
                }}
                className="rounded-md border border-white/8 bg-white/[0.03] px-2 py-1 text-[11px] text-white/60 hover:bg-white/[0.07] hover:text-white/80 transition-colors"
              >
                Validation (loading)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
