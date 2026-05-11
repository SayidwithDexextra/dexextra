'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

export type WalkthroughStartPromptProps = {
  /**
   * Heading shown at the top of the card. Keep this short (~3-5 words)
   * so it reads as an invitation, not a wall of copy.
   */
  title: string;
  /**
   * One-sentence description of what the tour will cover. Sets the
   * expectation so users understand what they're agreeing to.
   */
  description: string;
  /**
   * Tour duration hint shown in the header chip (e.g. "60 sec"). Optional
   * because callers without a meaningful duration can omit it.
   */
  durationLabel?: string;
  /**
   * Label for the primary CTA. Defaults to "Start tour".
   */
  acceptLabel?: string;
  /**
   * Label for the dismiss CTA. Defaults to "Maybe later".
   */
  dismissLabel?: string;

  /** Fired when the user opts in. The provider then runs `start(force)`. */
  onAccept: () => void;
  /**
   * Fired when the user opts out (Skip, X, Esc, or backdrop click). The
   * provider should mark the tour as completed so we don't re-prompt.
   */
  onDismiss: () => void;
};

/**
 * Pre-tour confirmation dialog. Sits BELOW the walkthrough overlay
 * (z-index 19000 vs the overlay's 20000) so even if a tour somehow ends
 * up rendering at the same time, the spotlight wins.
 *
 * Renders into `document.body` via a portal to escape any ancestor
 * `transform` / `overflow: hidden` constraints (e.g. the navbar wrapper).
 */
export default function WalkthroughStartPrompt({
  title,
  description,
  durationLabel,
  acceptLabel = 'Start tour',
  dismissLabel = 'Maybe later',
  onAccept,
  onDismiss,
}: WalkthroughStartPromptProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Keyboard shortcuts mirror the walkthrough overlay's: Esc cancels,
  // Enter accepts. We attach to `window` so focus elsewhere on the page
  // doesn't swallow the keypress.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        onAccept();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onAccept, onDismiss]);

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="walkthrough-start-prompt"
        className="fixed inset-0 z-[19000] flex items-end sm:items-center justify-center p-3 sm:p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="walkthrough-start-prompt-title"
        aria-describedby="walkthrough-start-prompt-description"
      >
        {/* Subtle backdrop — not as dark as the walkthrough's spotlight
            scrim so the page stays legible, but dim enough to focus
            attention on the prompt. Click-to-dismiss matches modal norms. */}
        <button
          type="button"
          aria-label="Dismiss tour prompt"
          className="absolute inset-0 bg-black/40"
          onClick={onDismiss}
        />

        <motion.div
          className="relative w-full sm:w-[380px] max-w-[calc(100vw-16px)] rounded-xl border border-[#222222] bg-[#0F0F0F] shadow-2xl"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.2 }}
        >
          <div className="p-4 sm:p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex items-center gap-2">
                {/* Status dot styled like the rest of the design system —
                    green to read as "available", consistent with the
                    "ready" indicators in the deposit modal etc. */}
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                <span className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wide">
                  Product tour
                </span>
                {durationLabel ? (
                  <span className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                    {durationLabel}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss tour prompt"
                title="Dismiss"
                className="h-7 w-7 flex-shrink-0 rounded-md border border-[#222222] bg-[#111111] text-[#9CA3AF] hover:text-white hover:border-[#333333] transition-all duration-200 flex items-center justify-center"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <h3
              id="walkthrough-start-prompt-title"
              className="mt-2 text-[15px] font-semibold text-white leading-snug"
            >
              {title}
            </h3>

            <p
              id="walkthrough-start-prompt-description"
              className="mt-1.5 text-[12px] text-[#b3b3b3] leading-relaxed"
            >
              {description}
            </p>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onDismiss}
                className="text-[12px] text-white bg-transparent border border-[#222222] hover:border-[#333333] hover:bg-[#1A1A1A] rounded px-3 py-1.5 transition-all duration-200"
              >
                {dismissLabel}
              </button>
              <button
                type="button"
                onClick={onAccept}
                autoFocus
                className="text-[12px] font-medium text-black bg-[#4a9eff] hover:bg-[#3d8ae6] rounded px-3 py-1.5 transition-all duration-200"
              >
                {acceptLabel}
              </button>
            </div>

            <div className="mt-2 text-[10px] text-[#606060] leading-snug">
              You can replay any tour later from the Support menu in the
              bottom right.
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
