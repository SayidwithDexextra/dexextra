'use client';

import React, { useMemo } from 'react';

type ProgressOverlayProps = {
  messages: string[];
  activeIndex: number; // which message to show (0-based)
  percentComplete?: number; // 0..100
  visible: boolean;
  isFadingOut?: boolean;
  showSplash?: boolean;
  title?: string;
  subtitle?: string;
  onMinimize?: () => void;
};

export const ProgressOverlay: React.FC<ProgressOverlayProps> = ({
  messages,
  activeIndex,
  percentComplete = 0,
  visible,
  isFadingOut = false,
  showSplash = false,
  title = 'System Initialization',
  subtitle = 'Smart contract deployment pipeline',
  onMinimize,
}) => {
  const clampedIndex = Math.max(0, Math.min(activeIndex, Math.max(messages.length - 1, 0)));
  const completedCount = Math.max(0, clampedIndex);
  const completedMessages = messages.slice(0, completedCount);
  const remainingMessages = messages.slice(clampedIndex);

  const progressWidth = useMemo(() => {
    return `${Math.max(0, Math.min(100, percentComplete))}%`;
  }, [percentComplete]);

  const previewFinalized = completedMessages.slice(Math.max(0, completedMessages.length - 3));
  const previewPending = remainingMessages.slice(0, 6);
  const moreFinalized = Math.max(0, completedMessages.length - previewFinalized.length);
  const morePending = Math.max(0, remainingMessages.length - previewPending.length);

  if (!visible) return null;

  return (
    <div className={`fixed inset-0 z-50 transition-opacity duration-300 ${isFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Splash cross-fade */}
      <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-500 ${showSplash ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
          <div className="text-[11px] text-[#9CA3AF] uppercase tracking-wide">{title}</div>
          <div className="text-[10px] text-[#808080]">{subtitle}</div>
        </div>
      </div>

      {/* Centered Card */}
      <div className={`relative w-full h-full flex items-center justify-center px-4 transition-opacity duration-500 ${showSplash ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 w-full max-w-md">
          {/* Header */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400 animate-pulse" />
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wide truncate">{title}</div>
                <div className="text-[9px] text-[#606060] truncate">{subtitle}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-24 h-1 bg-[#2A2A2A] rounded-full overflow-hidden">
                <div className="h-full bg-blue-400 transition-all duration-300" style={{ width: progressWidth }} />
              </div>
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            </div>
          </div>

          <div className="h-px bg-gradient-to-r from-blue-500/40 via-transparent to-transparent" />

          {/* Section 1: Finalized deployments */}
          <div className="px-4 pt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Finalized deployments</div>
              <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                {completedMessages.length}/{messages.length}
              </div>
            </div>
            <div className="h-px bg-[#1A1A1A]" />

            <div className="mt-3 grid gap-2">
              {previewFinalized.length === 0 ? (
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                  <span className="text-[10px] text-[#808080] truncate">None yet</span>
                </div>
              ) : (
                previewFinalized.map((m, i) => (
                  <div key={`${i}-${m}`} className="flex items-center gap-2 min-w-0">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
                    <span className="text-[10px] text-white truncate">{m}</span>
                  </div>
                ))
              )}
              {moreFinalized > 0 ? (
                <div className="text-[9px] text-[#606060]">+{moreFinalized} more</div>
              ) : null}
            </div>
          </div>

          {/* Section divider */}
          <div className="mt-4 h-px bg-[#1A1A1A]" />

          {/* Section 2: Pipeline progression */}
          <div className="px-4 pt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Progression of the deployment pipeline</div>
              <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                {Math.max(0, Math.min(100, percentComplete))}%
              </div>
            </div>
            <div className="h-px bg-[#1A1A1A]" />

            <div className="mt-3 grid gap-2">
              {previewPending.map((m, i) => (
                <div key={`${i}-${m}`} className="flex items-center justify-between min-h-[1.5rem]">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${i === 0 ? 'bg-blue-400' : 'bg-[#404040]'}`} />
                    <span className="text-[11px] text-white truncate">{m}</span>
                  </div>
                  <span className={`text-[9px] ${i === 0 ? 'text-blue-400' : 'text-[#606060]'}`}>
                    {i === 0 ? 'In Progress' : 'Pending'}
                  </span>
                </div>
              ))}
              {morePending > 0 ? (
                <div className="text-[9px] text-[#606060]">+{morePending} more pending</div>
              ) : null}
            </div>

            {/* Expandable detail (subtle) */}
            <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
              <div className="px-0 pt-2 border-t border-[#1A1A1A]">
                <div className="text-[9px]">
                  <span className="text-[#606060]">Deployment actions executing securely on backend...</span>
                </div>
              </div>
            </div>
          </div>

          {/* Section divider */}
          <div className="mt-4 h-px bg-[#1A1A1A]" />

          {/* Section 3: Actions */}
          <div className="px-4 py-3 flex items-center justify-end">
            {typeof onMinimize === 'function' ? (
              <button
                onClick={onMinimize}
                className="text-[10px] text-white bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded px-2.5 py-1.5 transition-all duration-200"
                title="Continue in background"
                aria-label="Continue in background"
              >
                Continue in background
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};










