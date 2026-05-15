'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { OrderFillLoadingModal, type OrderFillStatus } from '@/components/TokenView/OrderFillLoadingModal';

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

const ERROR_PRESETS = [
  {
    name: 'Insufficient Collateral',
    headline: 'Insufficient Collateral',
    detail: 'Insufficient collateral. Please deposit more USDC using the "Deposit" button in the header.',
  },
  {
    name: 'Order Rejected',
    headline: 'Order Rejected',
    detail: 'Cannot execute a margin trade against spot-only liquidity at the top of the book.',
  },
  {
    name: 'Session Expired',
    headline: 'Session Error',
    detail: 'Gasless session expired. Please re-enable gasless trading and retry.',
  },
  {
    name: 'Market Order Failed',
    headline: 'Market Order Failed',
    detail: 'Failed to create market order. Please try again.',
  },
  {
    name: 'Limit Order Failed',
    headline: 'Limit Order Failed',
    detail: 'Failed to create limit order. Please try again.',
  },
];

export default function DebugOrderFillModalPage() {
  const debugEnabled =
    process.env.NODE_ENV !== 'production' ||
    String(process.env.NEXT_PUBLIC_ENABLE_DEBUG_PAGES || '').toLowerCase() === 'true';

  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<OrderFillStatus>('processing');
  const [progress, setProgress] = useState(0.22);
  const [allowClose, setAllowClose] = useState(true);
  const [autoCloseOnSuccess, setAutoCloseOnSuccess] = useState(false);
  const [durationMs, setDurationMs] = useState(5200);
  const [headline, setHeadline] = useState('Submitting your order');
  const [detail, setDetail] = useState('');

  const rafRef = useRef<number | null>(null);

  const stopSim = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  useEffect(() => stopSim, [stopSim]);

  const startSim = useCallback(
    (opts?: { from?: number; to?: number; ms?: number }) => {
      stopSim();
      const from = clamp01(opts?.from ?? 0);
      const to = clamp01(opts?.to ?? 1);
      const ms = Math.max(300, Math.min(30_000, Math.floor(opts?.ms ?? durationMs)));

      setOpen(true);
      setStatus('submitting');
      setProgress(from);

      const t0 = performance.now();

      const loop = () => {
        // Use performance.now() to avoid timestamp origin mismatches in some environments.
        const t = performance.now();
        const elapsed = t - t0;
        const k = clamp01(elapsed / ms);

        // small "submit" phase (first 12%)
        if (k < 0.12) {
          setStatus('submitting');
          const submitK = k / 0.12;
          setProgress(from + (to - from) * (submitK * 0.15));
        } else {
          setStatus('processing');
          const fillK = (k - 0.12) / 0.88;
          const eased = 1 - Math.pow(1 - fillK, 2.2); // ease-out-ish
          setProgress(from + (to - from) * (0.15 + 0.85 * eased));
        }

        if (k >= 1) {
          setProgress(to);
          setStatus('success');
          rafRef.current = null;
          return;
        }

        rafRef.current = requestAnimationFrame(loop);
      };

      rafRef.current = requestAnimationFrame(loop);
    },
    [durationMs, stopSim]
  );

  useEffect(() => {
    if (!open) return;
    if (status !== 'success') return;
    if (!autoCloseOnSuccess) return;
    const id = window.setTimeout(() => setOpen(false), 750);
    return () => window.clearTimeout(id);
  }, [autoCloseOnSuccess, open, status]);

  if (!debugEnabled) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
          <div className="text-[12px] font-medium text-white">Debug pages disabled</div>
          <div className="mt-1 text-[11px] text-[#9CA3AF]">
            Set <span className="font-mono text-white/80">NEXT_PUBLIC_ENABLE_DEBUG_PAGES=true</span> to enable in production.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-4 space-y-4">
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-[13px] font-medium text-white">Debug: Order Fill Loader Modal</div>
            <div className="mt-1 text-[11px] text-[#9CA3AF]">
              Simple centered modal where the background fills bottom → top like a cup.
            </div>
          </div>
          <a
            href="/debug"
            className="rounded border border-[#333333] bg-[#141414] px-3 py-1.5 text-[11px] text-white hover:bg-[#1A1A1A]"
          >
            Back to Debug Hub
          </a>
        </div>
      </div>

      {/* Error Presets Section */}
      <div className="rounded-md border border-red-500/20 bg-red-500/5 p-4 space-y-3">
        <div className="text-[12px] font-medium text-red-300">Error Modal Presets</div>
        <div className="flex flex-wrap gap-2">
          {ERROR_PRESETS.map((preset) => (
            <button
              key={preset.name}
              onClick={() => {
                stopSim();
                setHeadline(preset.headline);
                setDetail(preset.detail);
                setStatus('error');
                setProgress(1);
                setOpen(true);
              }}
              className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] font-medium text-red-300 hover:bg-red-500/20 transition-colors"
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      {/* Controls Section */}
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4 space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Headline Text</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="Submitting your order"
            />
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Detail Text</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Please wait..."
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Progress (0–100)</div>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(clamp01(progress) * 100)}
              onChange={(e) => {
                stopSim();
                setStatus('processing');
                setProgress(clamp01(Number(e.target.value) / 100));
              }}
              className="w-full"
            />
            <div className="mt-1 text-[11px] text-white font-mono tabular-nums">
              {Math.round(clamp01(progress) * 100)}%
            </div>
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Sim duration (ms)</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={String(durationMs)}
              onChange={(e) => setDurationMs(Math.max(300, Math.min(30_000, Number(e.target.value) || 5200)))}
            />
            <div className="mt-1 text-[10px] text-[#606060]">Used by the "Simulate fill" button.</div>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => {
              stopSim();
              setHeadline('Submitting your order');
              setDetail('');
              setStatus('processing');
              setOpen(true);
            }}
            className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] font-medium text-white hover:bg-[#1A1A1A]"
          >
            Open modal (processing)
          </button>

          <button
            onClick={() => setOpen(false)}
            className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] font-medium text-white hover:bg-[#1A1A1A]"
          >
            Close modal
          </button>

          <button
            onClick={() => {
              setHeadline('Submitting your order');
              setDetail('');
              startSim({ from: 0, to: 1, ms: durationMs });
            }}
            className="rounded bg-white px-3 py-2 text-[12px] font-medium text-black hover:bg-white/90"
          >
            Simulate progress
          </button>

          <button
            onClick={() => {
              stopSim();
              setHeadline('Error');
              setDetail('Something went wrong. Please try again.');
              setStatus('error');
              setProgress(1);
              setOpen(true);
            }}
            className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-300 hover:bg-red-500/15"
          >
            Show error
          </button>

          <button
            onClick={() => {
              stopSim();
              setHeadline('Order Placed');
              setDetail('Your order has been submitted successfully.');
              setStatus('success');
              setProgress(1);
              setOpen(true);
            }}
            className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12px] font-medium text-emerald-300 hover:bg-emerald-500/15"
          >
            Show success
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-[11px] text-[#9CA3AF]">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allowClose}
              onChange={(e) => setAllowClose(e.target.checked)}
              className="accent-white"
            />
            Allow close (esc/backdrop/OK)
          </label>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoCloseOnSuccess}
              onChange={(e) => setAutoCloseOnSuccess(e.target.checked)}
              className="accent-white"
            />
            Auto-close on success
          </label>
        </div>

        {/* Status selector */}
        <div className="flex items-center gap-2">
          <div className="text-[10px] text-[#808080]">Status:</div>
          {(['submitting', 'processing', 'canceling', 'success', 'error'] as OrderFillStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => {
                stopSim();
                setStatus(s);
                if (!open) setOpen(true);
              }}
              className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                status === s
                  ? s === 'error'
                    ? 'bg-red-500/20 text-red-300 ring-1 ring-red-500/30'
                    : s === 'success'
                    ? 'bg-green-500/20 text-green-300 ring-1 ring-green-500/30'
                    : 'bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/30'
                  : 'bg-[#1a1a1a] text-[#888] hover:bg-[#222]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <OrderFillLoadingModal
        isOpen={open}
        onClose={allowClose ? () => setOpen(false) : undefined}
        headlineText={headline}
        detailText={detail || undefined}
        showProgressLabel={status !== 'error' && status !== 'success'}
        progress={progress}
        status={status}
      />
    </div>
  );
}

