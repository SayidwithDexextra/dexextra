'use client';

import React, { useState } from 'react';
import { EnableTradingModal, EnableTradingActivation, type ActivationPhase } from '@/components/EnableTrading';

type EnablePhase = 'idle' | ActivationPhase;

export default function DebugEnableTradingModalPage() {
  const debugEnabled =
    process.env.NODE_ENV !== 'production' ||
    String(process.env.NEXT_PUBLIC_ENABLE_DEBUG_PAGES || '').toLowerCase() === 'true';

  // Live-ish simulated modal (no wallet required)
  const [open, setOpen] = useState(false);
  const [forcePhase, setForcePhase] = useState<EnablePhase | null>(null);
  const [awaitingMs, setAwaitingMs] = useState(1400);
  const [finalizingMs, setFinalizingMs] = useState(1600);
  const [successHoldMs, setSuccessHoldMs] = useState(1600);

  // Inline preview of just the activation visual
  const [previewPhase, setPreviewPhase] = useState<ActivationPhase>('awaiting');

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

  const phaseButtons: { label: string; value: EnablePhase | null }[] = [
    { label: 'Live (click flow)', value: null },
    { label: 'idle', value: 'idle' },
    { label: 'awaiting', value: 'awaiting' },
    { label: 'finalizing', value: 'finalizing' },
    { label: 'success', value: 'success' },
  ];

  return (
    <div className="mx-auto max-w-5xl p-4 space-y-4">
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-[13px] font-medium text-white">Debug: Enable Trading Modal</div>
            <div className="mt-1 text-[11px] text-[#9CA3AF]">
              Fluid activation flow: <span className="text-blue-300">awaiting signature</span> →{' '}
              <span className="text-cyan-300">finalizing</span> → <span className="text-green-300">success</span>.
              Use <span className="font-mono text-white/80">simulate</span> to drive the whole thing without a wallet.
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

      {/* Controls */}
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4 space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Awaiting duration (ms)</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={String(awaitingMs)}
              onChange={(e) => setAwaitingMs(Math.max(100, Math.min(10_000, Number(e.target.value) || 1400)))}
            />
          </label>
          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Finalizing duration (ms)</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={String(finalizingMs)}
              onChange={(e) => setFinalizingMs(Math.max(100, Math.min(10_000, Number(e.target.value) || 1600)))}
            />
          </label>
          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Success hold (ms)</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={String(successHoldMs)}
              onChange={(e) => setSuccessHoldMs(Math.max(0, Math.min(10_000, Number(e.target.value) || 1600)))}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => {
              setForcePhase(null);
              setOpen(true);
            }}
            className="rounded bg-[#166534] px-4 py-2.5 text-[12px] font-medium text-white hover:bg-[#15803D] transition-colors"
          >
            Open & play full sequence
          </button>
          <button
            onClick={() => setOpen(false)}
            className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] font-medium text-white hover:bg-[#1A1A1A]"
          >
            Close modal
          </button>
        </div>

        {/* Force a specific phase to inspect each visual state */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[10px] text-[#808080] mr-1">Force phase:</div>
          {phaseButtons.map((b) => (
            <button
              key={b.label}
              onClick={() => {
                setForcePhase(b.value);
                setOpen(true);
              }}
              className={`rounded px-2.5 py-1 text-[10px] font-medium transition-colors ${
                forcePhase === b.value && open
                  ? 'bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/30'
                  : 'bg-[#1a1a1a] text-[#888] hover:bg-[#222]'
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>

        <div className="text-[10px] text-[#606060]">
          "Live (click flow)" opens the modal and runs the simulated sequence when you press the CTA. "Force phase"
          jumps straight to a state (handy for screenshots). Closing resets back to idle.
        </div>
      </div>

      {/* Inline activation preview */}
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="text-[12px] font-medium text-white mb-1">Activation visual (inline)</div>
        <div className="text-[11px] text-[#9CA3AF] mb-4">
          The fluid core on its own, without the modal chrome.
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {(['awaiting', 'finalizing', 'success'] as ActivationPhase[]).map((p) => (
            <button
              key={p}
              onClick={() => setPreviewPhase(p)}
              className={`rounded px-2.5 py-1 text-[10px] font-medium transition-colors ${
                previewPhase === p
                  ? 'bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/30'
                  : 'bg-[#1a1a1a] text-[#888] hover:bg-[#222]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="rounded-md border border-[#1A1A1A] bg-[#0B0B0B] py-6">
          <EnableTradingActivation phase={previewPhase} />
        </div>
      </div>

      <EnableTradingModal
        isOpen={open}
        onClose={() => {
          setOpen(false);
          setForcePhase(null);
        }}
        onSuccess={() => {
          setOpen(false);
          setForcePhase(null);
        }}
        simulate
        forcePhase={forcePhase}
        simulateTimings={{ awaitingMs, finalizingMs }}
        successHoldMs={successHoldMs}
      />
    </div>
  );
}
