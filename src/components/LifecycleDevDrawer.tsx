'use client';

import React, { useState } from 'react';
import { useLifecycleDevStatus, type LifecyclePhase } from '@/hooks/useLifecycleDevStatus';

interface LifecycleDevDrawerProps {
  marketId: string | null;
}

const PHASE_LABELS: Record<string, string> = {
  trading: 'Trading',
  rollover: 'Rollover',
  challenge: 'Challenge',
  settled: 'Settled',
};

function formatCountdown(seconds: number | null): string {
  if (seconds === null) return '--';
  if (seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTime(unix: number | null): string {
  if (unix === null) return '--';
  const d = new Date(unix * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function StatusDot({ status }: { status: LifecyclePhase['status'] }) {
  if (status === 'active') {
    return (
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400" />
      </span>
    );
  }
  if (status === 'complete') {
    return <span className="inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />;
  }
  return <span className="inline-flex h-2.5 w-2.5 rounded-full bg-white/20" />;
}

function QStashBadge({ qstash }: { qstash: LifecyclePhase['qstash'] }) {
  if (!qstash) return <span className="text-white/20">--</span>;

  const colors: Record<string, string> = {
    pending: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
    delivered: 'bg-green-500/15 text-green-300 border-green-500/25',
    not_found: 'bg-white/5 text-white/30 border-white/10',
    error: 'bg-red-500/15 text-red-300 border-red-500/25',
  };

  const labels: Record<string, string> = {
    pending: 'Pending',
    delivered: 'Fired',
    not_found: 'Gone',
    error: 'Error',
  };

  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-medium ${colors[qstash.status] || colors.error}`}>
      {labels[qstash.status] || qstash.status}
    </span>
  );
}

function MarketStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const colors: Record<string, string> = {
    ACTIVE: 'bg-green-500/15 text-green-300 border-green-500/25',
    SETTLEMENT_REQUESTED: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
    SETTLED: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
  };
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${colors[status] || 'bg-white/5 text-white/40 border-white/10'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export function LifecycleDevDrawer({ marketId }: LifecycleDevDrawerProps) {
  const [expanded, setExpanded] = useState(false);
  const { phases, marketStatus, speedRun, isLoading, error } = useLifecycleDevStatus(marketId, true);

  const activePhase = phases.find((p) => p.status === 'active');
  const activeLabel = activePhase ? PHASE_LABELS[activePhase.name] || activePhase.name : 'Idle';

  return (
    <div className="fixed bottom-4 right-4 z-[9998] flex flex-col items-end">
      {/* Expanded panel */}
      <div
        className={`mb-1 w-[min(20rem,calc(100vw-2rem))] origin-bottom-right overflow-hidden rounded-2xl border border-amber-500/20 bg-[#0d0d0d] shadow-2xl shadow-amber-900/10 ring-1 ring-black transition-all duration-300 ease-in-out ${
          expanded ? 'max-h-[28rem] scale-100 opacity-100' : 'max-h-0 scale-95 opacity-0 pointer-events-none'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold tracking-wide text-amber-300 uppercase">
              Lifecycle
            </span>
            {speedRun && (
              <span className="rounded bg-amber-500/15 border border-amber-500/25 px-1.5 py-0.5 text-[9px] font-medium text-amber-300">
                Speed Run
              </span>
            )}
          </div>
          <MarketStatusBadge status={marketStatus} />
        </div>

        {/* Body */}
        <div className="max-h-[24rem] overflow-y-auto overscroll-contain p-3">
          {error && (
            <div className="mb-2 rounded-lg bg-red-500/10 border border-red-500/20 px-2.5 py-1.5 text-[11px] text-red-300">
              {error}
            </div>
          )}

          {isLoading && phases.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-[11px] text-white/30">
              Loading...
            </div>
          ) : (
            <div className="relative space-y-0">
              {/* Vertical timeline line */}
              <div className="absolute left-[4.5px] top-1 bottom-1 w-px bg-white/8" />

              {phases.map((phase, i) => {
                const label = PHASE_LABELS[phase.name] || phase.name;
                const isActive = phase.status === 'active';
                return (
                  <div
                    key={phase.name}
                    className={`relative pl-5 py-2 ${isActive ? 'bg-amber-500/[0.04] rounded-lg -mx-1 px-6' : ''}`}
                  >
                    {/* Dot on timeline */}
                    <div className="absolute left-0 top-[11px]">
                      <StatusDot status={phase.status} />
                    </div>

                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className={`text-[12px] font-medium ${isActive ? 'text-amber-200' : phase.status === 'complete' ? 'text-white/60' : 'text-white/35'}`}>
                          {label}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-white/30">
                          {phase.startsAt !== null && (
                            <span>{formatTime(phase.startsAt)}</span>
                          )}
                          {phase.endsAt !== null && (
                            <>
                              <span className="text-white/15">→</span>
                              <span>{formatTime(phase.endsAt)}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {/* Countdown */}
                        {phase.status === 'active' && phase.countdown !== null && (
                          <span className="font-mono text-[13px] font-semibold text-amber-300 tabular-nums">
                            {formatCountdown(phase.countdown)}
                          </span>
                        )}
                        {phase.status === 'upcoming' && phase.countdown !== null && (
                          <span className="font-mono text-[11px] text-white/30 tabular-nums">
                            in {formatCountdown(phase.countdown)}
                          </span>
                        )}
                        {phase.status === 'complete' && (
                          <span className="text-[10px] text-green-400/60">Done</span>
                        )}

                        {/* QStash badge */}
                        {phase.name !== 'trading' && (
                          <QStashBadge qstash={phase.qstash} />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Toggle tab */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[11px] font-medium shadow-lg transition-all ${
          expanded
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15'
            : 'border-white/10 bg-[#111] text-white/50 hover:bg-white/[0.06] hover:text-white/70'
        }`}
      >
        <span className="relative flex h-2 w-2">
          {activePhase ? (
            <>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-50" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
            </>
          ) : (
            <span className="inline-flex h-2 w-2 rounded-full bg-white/20" />
          )}
        </span>
        <span>Lifecycle</span>
        <span className="text-white/25">·</span>
        <span className={activePhase ? 'text-amber-200' : ''}>{activeLabel}</span>
        {activePhase?.countdown !== null && activePhase?.countdown !== undefined && (
          <>
            <span className="text-white/25">·</span>
            <span className="font-mono tabular-nums text-amber-300">{formatCountdown(activePhase.countdown)}</span>
          </>
        )}
        <svg
          className={`ml-1 h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M3 5l3-3 3 3" />
          <path d="M3 9l3-3 3 3" />
        </svg>
      </button>
    </div>
  );
}

export default LifecycleDevDrawer;
