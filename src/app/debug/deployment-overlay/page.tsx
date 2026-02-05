'use client';

import React from 'react';
import { useDeploymentOverlay } from '@/contexts/DeploymentOverlayContext';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function DebugDeploymentOverlayPage() {
  const overlay = useDeploymentOverlay();

  const DEFAULT_MESSAGES = React.useMemo(
    () => [
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
    ],
    []
  );

  const [symbol, setSymbol] = React.useState('TEST-USD');
  const [title, setTitle] = React.useState('Deployment Pipeline');
  const [subtitle, setSubtitle] = React.useState('Initializing market and registering oracle');
  const [messages, setMessages] = React.useState<string[]>(DEFAULT_MESSAGES);
  const [splashMs, setSplashMs] = React.useState<number>(900);
  const [autoAdvance, setAutoAdvance] = React.useState<boolean>(true);
  const [intervalMs, setIntervalMs] = React.useState<number>(800);

  const pipelineIdRef = React.useRef<string | null>(null);
  const idxRef = React.useRef<number>(0);
  const timerRef = React.useRef<number | null>(null);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  const open = React.useCallback(() => {
    clearTimer();
    idxRef.current = 0;
    const pid =
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `dbg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    pipelineIdRef.current = pid;

    overlay.open({
      title,
      subtitle,
      messages,
      splashMs: Math.max(0, Math.floor(Number(splashMs) || 0)),
      meta: { pipelineId: pid, marketSymbol: String(symbol || '').toUpperCase() },
    });
    overlay.update({ activeIndex: 0, percentComplete: Math.round((1 / Math.max(messages.length, 1)) * 100) });
  }, [clearTimer, overlay, title, subtitle, messages, splashMs, symbol]);

  const stepOnce = React.useCallback(() => {
    const next = idxRef.current + 1;
    const maxIdx = Math.max(messages.length - 1, 0);
    idxRef.current = clamp(next, 0, maxIdx);
    const percent = Math.min(100, Math.round(((idxRef.current + 1) / Math.max(messages.length, 1)) * 100));
    overlay.update({ activeIndex: idxRef.current, percentComplete: percent });
  }, [overlay, messages.length]);

  const runAuto = React.useCallback(() => {
    clearTimer();
    timerRef.current = window.setInterval(() => {
      const maxIdx = Math.max(messages.length - 1, 0);
      if (idxRef.current >= maxIdx) {
        clearTimer();
        // Let the completion notice show (the provider hooks it on close)
        overlay.fadeOutAndClose(450);
        return;
      }
      stepOnce();
    }, clamp(Math.floor(Number(intervalMs) || 800), 150, 10_000));
  }, [clearTimer, overlay, stepOnce, intervalMs, messages.length]);

  const complete = React.useCallback(() => {
    clearTimer();
    idxRef.current = Math.max(messages.length - 1, 0);
    overlay.update({ activeIndex: idxRef.current, percentComplete: 100 });
    overlay.fadeOutAndClose(450);
  }, [clearTimer, overlay, messages.length]);

  const close = React.useCallback(() => {
    clearTimer();
    overlay.close();
  }, [clearTimer, overlay]);

  const setScenarioFast = React.useCallback(() => {
    setMessages([
      'Validate input',
      'Send tx',
      'Confirm',
      'Grant roles',
      'Save market',
      'Finalize',
    ]);
    setTitle('Deployment Pipeline');
    setSubtitle('Fast test scenario');
    setIntervalMs(500);
    setAutoAdvance(true);
  }, []);

  const setScenarioLong = React.useCallback(() => {
    setMessages(DEFAULT_MESSAGES);
    setTitle('Deployment Pipeline');
    setSubtitle('Longer scenario (more steps)');
    setIntervalMs(850);
    setAutoAdvance(true);
  }, [DEFAULT_MESSAGES]);

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="text-[12px] font-medium text-white">Debug: Deployment Overlay</div>
        <div className="mt-1 text-[11px] text-[#9CA3AF]">
          Use this page to test the “Continue in background” dock + completion notice without deploying.
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Market symbol (used by “Open market”)</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="TEST-USD"
            />
          </label>
          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Splash ms</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={String(splashMs)}
              onChange={(e) => setSplashMs(Number(e.target.value))}
              placeholder="900"
            />
          </label>
          <label className="block md:col-span-2">
            <div className="text-[10px] text-[#808080] mb-1">Title</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="block md:col-span-2">
            <div className="text-[10px] text-[#808080] mb-1">Subtitle</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
            />
          </label>
          <label className="block md:col-span-2">
            <div className="text-[10px] text-[#808080] mb-1">Auto-advance interval (ms)</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={String(intervalMs)}
              onChange={(e) => setIntervalMs(Number(e.target.value))}
              placeholder="800"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={open}
            className="rounded bg-blue-500 px-3 py-2 text-[12px] font-medium text-white hover:bg-blue-400"
          >
            Open overlay
          </button>
          <button
            onClick={() => {
              stepOnce();
            }}
            className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] text-white hover:bg-[#1A1A1A]"
          >
            Step +1
          </button>
          <button
            onClick={() => overlay.minimize()}
            className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] text-white hover:bg-[#1A1A1A]"
          >
            Minimize (show dock)
          </button>
          <button
            onClick={() => overlay.collapseToFooter()}
            className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] text-white hover:bg-[#1A1A1A]"
          >
            Reduce to footer (pip)
          </button>
          <button
            onClick={() => overlay.restore()}
            className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] text-white hover:bg-[#1A1A1A]"
          >
            Restore overlay
          </button>
          <button
            onClick={complete}
            className="rounded bg-green-500 px-3 py-2 text-[12px] font-medium text-black hover:bg-green-400"
          >
            Complete (show notice)
          </button>
          <button
            onClick={close}
            className="rounded border border-red-500/40 bg-[#141414] px-3 py-2 text-[12px] text-red-300 hover:bg-[#1A1A1A]"
          >
            Close (no notice)
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <label className="flex items-center gap-2 text-[11px] text-[#9CA3AF]">
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={(e) => setAutoAdvance(e.target.checked)}
            />
            Auto-advance
          </label>
          <button
            onClick={() => {
              if (!autoAdvance) return;
              runAuto();
            }}
            disabled={!autoAdvance}
            className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] text-white hover:bg-[#1A1A1A] disabled:opacity-50"
          >
            Start auto-run
          </button>
          <button
            onClick={clearTimer}
            className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] text-white hover:bg-[#1A1A1A]"
          >
            Stop auto-run
          </button>
        </div>

        <div className="mt-6 grid gap-2 md:grid-cols-2">
          <button
            onClick={setScenarioFast}
            className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] text-white hover:bg-[#1A1A1A]"
          >
            Load “fast scenario”
          </button>
          <button
            onClick={setScenarioLong}
            className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] text-white hover:bg-[#1A1A1A]"
          >
            Load “long scenario”
          </button>
        </div>

        <div className="mt-4 rounded border border-[#222222] bg-[#0B0B0B] p-3 text-[11px] text-[#9CA3AF]">
          Tip: Click <span className="text-white">Open overlay</span> → then use the overlay’s own{' '}
          <span className="text-white">Continue in background</span> button to verify the dock flow.
        </div>
      </div>
    </div>
  );
}

