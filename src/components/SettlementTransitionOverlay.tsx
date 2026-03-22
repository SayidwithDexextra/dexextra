'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface SettlementTransitionOverlayProps {
  show: boolean;
  marketSymbol: string;
  onComplete: () => void;
}

const TOTAL_DURATION_MS = 4000;
const FADE_IN_MS = 500;
const FADE_OUT_MS = 800;
const HOLD_MS = TOTAL_DURATION_MS - FADE_IN_MS - FADE_OUT_MS;

export function SettlementTransitionOverlay({
  show,
  marketSymbol,
  onComplete,
}: SettlementTransitionOverlayProps) {
  const [phase, setPhase] = useState<'hidden' | 'fade-in' | 'hold' | 'fade-out'>('hidden');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const startSequence = useCallback(() => {
    setPhase('fade-in');

    const holdTimer = setTimeout(() => setPhase('hold'), FADE_IN_MS);
    const fadeOutTimer = setTimeout(() => setPhase('fade-out'), FADE_IN_MS + HOLD_MS);
    const completeTimer = setTimeout(() => {
      setPhase('hidden');
      onComplete();
    }, TOTAL_DURATION_MS);

    return () => {
      clearTimeout(holdTimer);
      clearTimeout(fadeOutTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  useEffect(() => {
    if (!show) return;
    return startSequence();
  }, [show, startSequence]);

  if (!mounted || phase === 'hidden') return null;

  const opacity =
    phase === 'fade-in' ? 'opacity-100' :
    phase === 'hold' ? 'opacity-100' :
    phase === 'fade-out' ? 'opacity-0' : 'opacity-0';

  const scale =
    phase === 'fade-in' ? 'scale-100' :
    phase === 'hold' ? 'scale-100' : 'scale-95';

  const progressWidth =
    phase === 'fade-in' ? 'w-[10%]' :
    phase === 'hold' ? 'w-[90%]' :
    phase === 'fade-out' ? 'w-full' : 'w-0';

  return createPortal(
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center transition-opacity duration-700 ease-in-out ${opacity}`}
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.25)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
    >
      <div className={`flex flex-col items-center gap-6 transition-all duration-700 ease-out ${scale}`}>
        {/* Pulsing settlement indicator */}
        <div className="relative flex items-center justify-center">
          <div className="absolute w-16 h-16 rounded-full bg-amber-500/10 animate-ping" style={{ animationDuration: '2s' }} />
          <div className="absolute w-12 h-12 rounded-full bg-amber-500/20 animate-ping" style={{ animationDuration: '1.5s' }} />
          <div className="w-6 h-6 rounded-full bg-amber-400 shadow-[0_0_24px_rgba(245,158,11,0.6)]" />
        </div>

        {/* Market symbol */}
        <div className="text-[13px] font-mono tracking-[0.4em] uppercase text-amber-400/60">
          {marketSymbol}
        </div>

        {/* Announcement text */}
        <div className="text-center space-y-2">
          <h2 className="text-xl md:text-2xl font-medium text-white tracking-tight">
            Entering Settlement Challenge Phase
          </h2>
          <p className="text-sm text-[#808080] max-w-md">
            The market has reached its settlement date. A challenge window is now
            open for price verification.
          </p>
        </div>

        {/* Progress bar */}
        <div className="w-64 h-[2px] bg-[#222222] rounded-full overflow-hidden mt-2">
          <div
            className={`h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full transition-all ease-linear ${progressWidth}`}
            style={{
              transitionDuration:
                phase === 'fade-in' ? `${FADE_IN_MS}ms` :
                phase === 'hold' ? `${HOLD_MS}ms` :
                phase === 'fade-out' ? `${FADE_OUT_MS}ms` : '0ms',
            }}
          />
        </div>

        <div className="text-[10px] text-[#606060] tracking-wider uppercase">
          Transitioning to Settlement Window
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default SettlementTransitionOverlay;
