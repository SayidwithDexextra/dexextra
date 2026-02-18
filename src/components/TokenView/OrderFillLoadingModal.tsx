'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';

export type OrderFillStatus = 'submitting' | 'filling' | 'filled' | 'error';

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function formatPct(progress01: number) {
  const p = Math.round(clamp01(progress01) * 100);
  return `${p}%`;
}

function statusMeta(status: OrderFillStatus) {
  switch (status) {
    case 'filled':
      return {
        dot: 'bg-green-400',
        badge: 'bg-[#1A1A1A] text-green-400 border border-[#222222]',
        // subtle but apparent background fill (design-system compliant)
        water: 'from-green-400/18 via-green-400/10 to-transparent',
        label: 'FILLED',
      } as const;
    case 'error':
      return {
        dot: 'bg-red-400',
        badge: 'bg-[#1A1A1A] text-red-400 border border-[#222222]',
        water: 'from-red-400/16 via-red-400/8 to-transparent',
        label: 'ERROR',
      } as const;
    case 'submitting':
      return {
        dot: 'bg-blue-400',
        badge: 'bg-[#1A1A1A] text-blue-400 border border-[#222222]',
        water: 'from-blue-400/18 via-blue-400/10 to-transparent',
        label: 'SUBMITTING',
      } as const;
    default:
      return {
        dot: 'bg-yellow-400',
        badge: 'bg-[#1A1A1A] text-yellow-400 border border-[#222222]',
        water: 'from-blue-400/16 via-blue-400/9 to-transparent',
        label: 'FILLING',
      } as const;
  }
}

export type FillingReservoirProps = {
  /** 0..1 */
  progress: number;
  status?: OrderFillStatus;
  heightPx?: number;
};

export function FillingReservoir({
  progress,
  status = 'filling',
  heightPx = 180,
}: FillingReservoirProps) {
  const reducedMotion = useReducedMotion();
  const p = clamp01(progress);
  const meta = statusMeta(status);

  return (
    <div
      className="relative w-full overflow-hidden rounded-md border border-[#222222] bg-[#0B0B0B]"
      style={{ height: `${Math.max(120, Math.min(320, Math.floor(heightPx)))}px` }}
      aria-label="Order fill progress"
      role="img"
    >
      {/* subtle “glass” */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.04] via-transparent to-white/[0.02]" />

      {/* water fill */}
      <motion.div
        className={[
          'absolute inset-x-0 bottom-0',
          'bg-gradient-to-t',
          meta.water,
          meta.glow,
        ].join(' ')}
        style={{ height: '100%', transformOrigin: 'bottom' }}
        initial={false}
        animate={{ scaleY: p }}
        transition={
          reducedMotion
            ? { duration: 0 }
            : { type: 'tween', duration: 0.55, ease: [0.16, 1, 0.3, 1] }
        }
      />

      {/* top “lip” */}
      <div className="absolute inset-x-0 top-0 h-px bg-white/10" />

      {/* level markers */}
      <div className="absolute inset-0">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="absolute inset-x-0 border-t border-white/[0.05]"
            style={{ top: `${(i / 5) * 100}%` }}
          />
        ))}
      </div>

      {/* center label */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="rounded-md border border-white/10 bg-black/35 px-3 py-2 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
            <div className="text-[11px] font-medium text-white tracking-tight">{formatPct(p)}</div>
            <div className={`text-[10px] px-1.5 py-0.5 rounded ${meta.badge}`}>{meta.label}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export type OrderFillLoadingModalProps = {
  isOpen: boolean;
  /** Called only if allowClose is true */
  onClose?: () => void;

  /** Override the main line of text (keeps design-system styling). */
  headlineText?: string;

  /**
   * Optional secondary line of text (e.g. error detail).
   * If provided, this replaces the default "Please wait." / percent label.
   */
  detailText?: string;

  /** 0..1 */
  progress: number;
  status?: OrderFillStatus;

  /** When false, blocks escape, backdrop click, and hides close button */
  allowClose?: boolean;

  /**
   * Debug-only escape hatch to avoid trapping the UI while testing.
   * Shows a close button even when allowClose is false (but still blocks backdrop + Escape).
   */
  safetyCloseButton?: boolean;

  /** Shows a small percent label under the text (useful for debug pages) */
  showProgressLabel?: boolean;
};

export function OrderFillLoadingModal({
  isOpen,
  onClose,
  headlineText = 'Submitting your order,',
  detailText,
  progress,
  status = 'filling',
  allowClose,
  safetyCloseButton,
  showProgressLabel,
}: OrderFillLoadingModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const meta = useMemo(() => statusMeta(status), [status]);
  const canClose = Boolean(onClose);
  const showCloseButton = Boolean(onClose);
  const reducedMotion = useReducedMotion();
  const p = clamp01(progress);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setIsAnimating(false);
      return;
    }
    setIsAnimating(true);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!canClose) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, canClose, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    if (!canClose) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!modalRef.current) return;
      if (!modalRef.current.contains(e.target as Node)) onClose?.();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isOpen, canClose, onClose]);

  if (!isOpen) return null;
  if (!isMounted) return null;

  const headline = headlineText;
  const detail = detailText;

  return createPortal(
    <div
      className={`fixed inset-0 z-[15000] flex items-center justify-center p-4 transition-opacity duration-200 ${
        isAnimating ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={modalRef}
        className="relative z-10 w-full overflow-hidden bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200"
        style={{
          maxWidth: '520px',
          minHeight: '220px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label={headlineText}
      >
        {/* subtle background fill (cup fill) */}
        <motion.div
          className={[
            'absolute inset-x-0 bottom-0 h-full',
            'bg-gradient-to-t',
            meta.water,
          ].join(' ')}
          style={{ transformOrigin: 'bottom' }}
          initial={false}
          animate={{ scaleY: p }}
          transition={
            reducedMotion
              ? { duration: 0 }
              : { type: 'tween', duration: 0.55, ease: [0.16, 1, 0.3, 1] }
          }
          aria-hidden="true"
        />

        {/* soft sheen */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.04] via-transparent to-black/20" aria-hidden="true" />

        {/* content */}
        <div className="relative p-4">
          {showCloseButton ? (
            <button
              onClick={onClose}
              className="absolute right-4 top-4 p-2 rounded-md border border-[#222222] hover:border-[#333333] hover:bg-[#1A1A1A] text-[#808080] transition-all duration-200"
              aria-label="Close"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : null}

          <div className="flex min-h-[190px] flex-col items-center justify-center text-center">
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${meta.dot}`} />
              <div className="text-white text-[13px] font-medium tracking-tight">{headline}</div>
              <div className={`text-[10px] px-1.5 py-0.5 rounded ${meta.badge}`}>{meta.label}</div>
            </div>
            {detail ? (
              <div
                className={[
                  'mt-2 text-[10px] leading-snug',
                  status === 'error' ? 'text-red-300/90' : 'text-[#606060]',
                ].join(' ')}
              >
                {detail}
              </div>
            ) : showProgressLabel ? (
              <div className="mt-2 text-[10px] text-white font-mono tabular-nums">{formatPct(p)}</div>
            ) : (
              <div className="mt-2 text-[10px] text-[#606060]">Please wait.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  , document.body);
}

export default OrderFillLoadingModal;

