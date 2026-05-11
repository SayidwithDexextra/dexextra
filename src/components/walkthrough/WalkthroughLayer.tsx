'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import {
  useWalkthrough,
  resolveWalkthroughStepForViewport,
  isWalkthroughMobileViewport,
  WALKTHROUGH_MOBILE_MEDIA_QUERY,
  type WalkthroughPlacement,
  type WalkthroughStep,
} from '@/contexts/WalkthroughContext';

type TargetStatus = 'idle' | 'navigating' | 'searching' | 'ready' | 'timeout';
type ResolvedPlacement = Exclude<WalkthroughPlacement, 'auto'>;
// 'docked' isn't a placement that points at the target — it's a fallback used
// on phones when the target is so large (or the viewport so small) that no
// side has comfortable room. The tooltip pins to the bottom (or top) of the
// viewport with the spotlight still highlighting the target above/below.
type DockedPosition = 'docked-bottom' | 'docked-top';
type AppliedPlacement = ResolvedPlacement | DockedPosition;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function safeQuerySelector(selector: string): Element | null {
  try {
    if (typeof document === 'undefined') return null;
    // Prefer the first *visible* match (some layouts render both mobile+desktop nodes
    // and hide one via CSS; querySelector would otherwise return a hidden element).
    const matches = Array.from(document.querySelectorAll(selector));
    for (const el of matches) {
      const r = rectFromElement(el);
      if (r) return el;
    }
    // Fall back to the first match if none are measurable yet.
    return matches[0] || null;
  } catch {
    return null;
  }
}

function rectFromElement(el: Element): DOMRect | null {
  try {
    const r = (el as HTMLElement).getBoundingClientRect?.();
    if (!r) return null;
    if (r.width <= 0 || r.height <= 0) return null;
    // Treat fully off-screen elements as not targetable yet.
    // This prevents spotlighting something the user can't see.
    if (typeof window !== 'undefined') {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const intersects = r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
      if (!intersects) return null;
    }
    return r;
  } catch {
    return null;
  }
}

function isWellCentered(r: DOMRect): boolean {
  if (typeof window === 'undefined') return true;
  const vh = window.innerHeight;
  const centerY = r.top + r.height / 2;
  const marginY = vh * 0.15;
  return r.top >= -4 && r.bottom <= vh + 4 && centerY >= marginY && centerY <= vh - marginY;
}

function pickPlacementTowardCenter(
  target: DOMRect,
  tipW: number,
  tipH: number,
  gap: number,
  opts?: { mobile?: boolean; safeAreaTop?: number; safeAreaBottom?: number }
): ResolvedPlacement {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const margin = 12;
  const safeTop = opts?.safeAreaTop ?? 0;
  const safeBottom = opts?.safeAreaBottom ?? 0;

  const viewportCenterX = vw / 2;
  const viewportCenterY = vh / 2;
  const targetCenterX = target.left + target.width / 2;
  const targetCenterY = target.top + target.height / 2;

  const dx = viewportCenterX - targetCenterX;
  const dy = viewportCenterY - targetCenterY;
  const preferHorizontal = Math.abs(dx) >= Math.abs(dy);

  const primaryH: ResolvedPlacement = dx >= 0 ? 'right' : 'left';
  const secondaryH: ResolvedPlacement = dx >= 0 ? 'left' : 'right';
  const primaryV: ResolvedPlacement = dy >= 0 ? 'bottom' : 'top';
  const secondaryV: ResolvedPlacement = dy >= 0 ? 'top' : 'bottom';

  // On phones, side placements almost never have room (viewports are
  // ~360-430px wide and our target spans most of that). Try vertical
  // first so the tooltip lands above/below where users actually expect it.
  const candidates: ResolvedPlacement[] = opts?.mobile
    ? [primaryV, secondaryV, primaryH, secondaryH]
    : preferHorizontal
      ? [primaryH, primaryV, secondaryH, secondaryV]
      : [primaryV, primaryH, secondaryV, secondaryH];

  const fits = (p: ResolvedPlacement) => {
    const spaceRight = vw - target.right;
    const spaceLeft = target.left;
    const spaceBottom = vh - target.bottom - safeBottom;
    const spaceTop = target.top - safeTop;
    if (p === 'right') return spaceRight >= tipW + gap + margin;
    if (p === 'left') return spaceLeft >= tipW + gap + margin;
    if (p === 'bottom') return spaceBottom >= tipH + gap + margin;
    return spaceTop >= tipH + gap + margin;
  };

  for (const p of candidates) {
    if (fits(p)) return p;
  }
  return candidates[0] || 'bottom';
}

/**
 * On mobile, when a target is too large or too close to the edges to leave
 * room for a tooltip on any side, dock the tooltip to the bottom (or top)
 * of the viewport. This is the same pattern used by Intercom/Stripe tours.
 *
 * Returns null if a normal placement fits — caller falls back to the
 * standard side-anchored layout.
 */
function shouldDockOnMobile(
  target: DOMRect,
  tipW: number,
  tipH: number,
  gap: number,
  opts: { safeAreaTop: number; safeAreaBottom: number }
): DockedPosition | null {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const margin = 12;

  const spaceTop = target.top - opts.safeAreaTop;
  const spaceBottom = vh - target.bottom - opts.safeAreaBottom;
  const spaceLeft = target.left;
  const spaceRight = vw - target.right;

  const fitsTop = spaceTop >= tipH + gap + margin;
  const fitsBottom = spaceBottom >= tipH + gap + margin;
  const fitsLeft = spaceLeft >= tipW + gap + margin;
  const fitsRight = spaceRight >= tipW + gap + margin;
  if (fitsTop || fitsBottom || fitsLeft || fitsRight) return null;

  // Pick the side with more room so the spotlight isn't hidden behind the
  // docked card. Add a small bias toward bottom-docking since that matches
  // the position of the OS keyboard / toolbars users are used to.
  if (spaceBottom >= spaceTop - 24) return 'docked-bottom';
  return 'docked-top';
}

function computeTooltipPosition(params: {
  placement: WalkthroughPlacement;
  target: DOMRect;
  anchor: { x: number; y: number };
  gap: number;
  tooltipW: number;
  tooltipH: number;
  mobile?: boolean;
  safeAreaTop?: number;
  safeAreaBottom?: number;
}): {
  left: number;
  top: number;
  transformOrigin: string;
  placement: AppliedPlacement;
  arrowX: number;
  arrowY: number;
  showArrow: boolean;
} {
  const { target, tooltipW, tooltipH, mobile } = params;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const margin = mobile ? 8 : 12;
  const gap = Math.max(0, params.gap);
  const safeAreaTop = params.safeAreaTop ?? 0;
  const safeAreaBottom = params.safeAreaBottom ?? 0;

  // Mobile fallback: when nothing fits, pin the card to the bottom (or top).
  if (mobile && params.placement === 'auto') {
    const docked = shouldDockOnMobile(target, tooltipW, tooltipH, gap, {
      safeAreaTop,
      safeAreaBottom,
    });
    if (docked) {
      const left = clamp(vw / 2 - tooltipW / 2, margin, Math.max(margin, vw - tooltipW - margin));
      const top =
        docked === 'docked-bottom'
          ? Math.max(margin + safeAreaTop, vh - safeAreaBottom - margin - tooltipH)
          : safeAreaTop + margin;
      return {
        left,
        top,
        transformOrigin: docked === 'docked-bottom' ? 'center bottom' : 'center top',
        placement: docked,
        arrowX: 0,
        arrowY: 0,
        showArrow: false,
      };
    }
  }

  const placement: ResolvedPlacement =
    params.placement === 'auto'
      ? pickPlacementTowardCenter(target, tooltipW, tooltipH, gap, {
          mobile,
          safeAreaTop,
          safeAreaBottom,
        })
      : params.placement;

  // Arrow should point to the actual explained element center,
  // even if we expand the target rect for positioning.
  const centerX = params.anchor.x;
  const centerY = params.anchor.y;

  let left = 0;
  let top = 0;
  let origin = 'center';

  if (placement === 'right') {
    left = target.right + gap;
    top = centerY - tooltipH / 2;
    origin = 'left center';
  } else if (placement === 'left') {
    left = target.left - gap - tooltipW;
    top = centerY - tooltipH / 2;
    origin = 'right center';
  } else if (placement === 'top') {
    left = centerX - tooltipW / 2;
    top = target.top - gap - tooltipH;
    origin = 'center bottom';
  } else {
    left = centerX - tooltipW / 2;
    top = target.bottom + gap;
    origin = 'center top';
  }

  left = clamp(left, margin, Math.max(margin, vw - tooltipW - margin));
  top = clamp(
    top,
    Math.max(margin, safeAreaTop + margin),
    Math.max(margin, vh - safeAreaBottom - tooltipH - margin)
  );

  const arrowInset = 16;
  const arrowX = clamp(centerX - left, arrowInset, Math.max(arrowInset, tooltipW - arrowInset));
  const arrowY = clamp(centerY - top, arrowInset, Math.max(arrowInset, tooltipH - arrowInset));

  return { left, top, transformOrigin: origin, placement, arrowX, arrowY, showArrow: true };
}

/**
 * Reads the CSS `env(safe-area-inset-*)` values via a hidden probe so we
 * can avoid drawing the docked tooltip behind iOS Safari's bottom toolbar
 * or notch. Falls back to 0 when the API isn't available.
 */
function readSafeAreaInsets(): { top: number; bottom: number } {
  if (typeof document === 'undefined') return { top: 0, bottom: 0 };
  try {
    const probe = document.createElement('div');
    probe.style.position = 'fixed';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    probe.style.top = '0';
    probe.style.left = '0';
    probe.style.height = '0';
    probe.style.width = '0';
    probe.style.paddingTop = 'env(safe-area-inset-top, 0px)';
    probe.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
    document.body.appendChild(probe);
    const styles = getComputedStyle(probe);
    const top = parseFloat(styles.paddingTop || '0') || 0;
    const bottom = parseFloat(styles.paddingBottom || '0') || 0;
    document.body.removeChild(probe);
    return { top, bottom };
  } catch {
    return { top: 0, bottom: 0 };
  }
}

function useTargetRect(step: WalkthroughStep | null, enabled: boolean, status: TargetStatus) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [targetEl, setTargetEl] = useState<Element | null>(null);
  const scrollAttemptedRef = useRef(false);

  useEffect(() => {
    scrollAttemptedRef.current = false;
  }, [step?.id]);

  useEffect(() => {
    if (!enabled || !step || status !== 'searching') {
      setRect(null);
      setTargetEl(null);
      return;
    }

    const selector = String(step.selector || '').trim();
    if (!selector) {
      setRect(null);
      setTargetEl(null);
      return;
    }

    const startAt = Date.now();
    const timeoutMs = 12_000;
    const pollMs = 200;
    let timer: number | null = null;

    const tick = () => {
      const el = safeQuerySelector(selector);
      const rawRect = el ? (el as HTMLElement).getBoundingClientRect?.() : null;
      const hasSize = rawRect && rawRect.width > 0 && rawRect.height > 0;
      const r = el ? rectFromElement(el) : null;

      if (el && hasSize && !scrollAttemptedRef.current) {
        const centered = rawRect ? isWellCentered(rawRect) : false;
        if (!centered) {
          scrollAttemptedRef.current = true;
          const html = document.documentElement;
          const body = document.body;
          const prevHtml = html.style.overflow;
          const prevBody = body.style.overflow;
          const prevHtmlOSB = (html.style as any).overscrollBehavior || '';
          const prevBodyOSB = (body.style as any).overscrollBehavior || '';
          html.style.overflow = '';
          body.style.overflow = '';
          (html.style as any).overscrollBehavior = '';
          (body.style as any).overscrollBehavior = '';
          try {
            (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
          } catch {
            try { (el as HTMLElement).scrollIntoView(); } catch {}
          }
          setTimeout(() => {
            html.style.overflow = prevHtml;
            body.style.overflow = prevBody;
            (html.style as any).overscrollBehavior = prevHtmlOSB;
            (body.style as any).overscrollBehavior = prevBodyOSB;
          }, 900);
          timer = window.setTimeout(tick, pollMs);
          return;
        }
        scrollAttemptedRef.current = true;
      }

      if (el && r) {
        setTargetEl(el);
        setRect(r);
        return;
      }

      if (Date.now() - startAt >= timeoutMs) {
        setTargetEl(null);
        setRect(null);
        return;
      }
      timer = window.setTimeout(tick, pollMs);
    };

    // First tick ASAP (after paint).
    timer = window.setTimeout(tick, 0);

    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [enabled, status, step?.id, step?.selector]);

  // Keep rect synced on scroll/resize and element resizes.
  useEffect(() => {
    if (!enabled || !step || !targetEl || !rect) return;

    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next = rectFromElement(targetEl);
        if (!next) return;
        setRect(next);
      });
    };

    const onScroll = () => update();
    const onResize = () => update();

    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);

    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(() => update());
      ro.observe(targetEl as Element);
    } catch {}

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      try {
        ro?.disconnect();
      } catch {}
    };
  }, [enabled, rect, step, targetEl]);

  return { rect, targetEl };
}

export default function WalkthroughLayer() {
  const { state, currentStep, progress, next, prev, stop } = useWalkthrough();
  const pathname = usePathname();

  // Track viewport so we can swap in mobile-specific copy / selectors and
  // adapt the tooltip layout (smaller width, vertical-first placement,
  // bottom-dock fallback when nothing fits).
  const [isMobile, setIsMobile] = useState<boolean>(() => isWalkthroughMobileViewport());
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(WALKTHROUGH_MOBILE_MEDIA_QUERY);
    const update = () => setIsMobile(mq.matches);
    update();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', update);
      return () => mq.removeEventListener('change', update);
    }
    mq.addListener(update);
    return () => mq.removeListener(update);
  }, []);

  const [safeArea, setSafeArea] = useState<{ top: number; bottom: number }>({ top: 0, bottom: 0 });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const measure = () => setSafeArea(readSafeAreaInsets());
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);

  const enabled = state.active && Boolean(currentStep);
  // Apply any `mobile*` overrides BEFORE the rest of the layer reads the
  // step. From here on, `step.selector`, `step.placement`, etc. are already
  // the right values for the current viewport.
  const step = useMemo<WalkthroughStep | null>(
    () => (currentStep ? resolveWalkthroughStepForViewport(currentStep, isMobile) : null),
    [currentStep, isMobile]
  );

  // Dispatch step enter events (e.g. open a modal) exactly once per step.
  const lastEnteredStepIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !step) {
      lastEnteredStepIdRef.current = null;
      return;
    }
    // If this step is route-scoped, only run enter events once we're on that route.
    if (step.route && pathname !== step.route) return;
    if (lastEnteredStepIdRef.current === step.id) return;
    lastEnteredStepIdRef.current = step.id;

    const events = Array.isArray((step as any).enterEvents) ? ((step as any).enterEvents as any[]) : [];
    if (!events.length) return;

    try {
      if (typeof window === 'undefined') return;
      // Defer a tick so the UI can mount before handlers run.
      window.setTimeout(() => {
        for (const evt of events) {
          const name = String(evt?.name || '').trim();
          if (!name) continue;
          try {
            window.dispatchEvent(new CustomEvent(name, { detail: evt?.detail }));
          } catch {}
        }
      }, 0);
    } catch {}
  }, [enabled, pathname, step?.id, step?.route]);

  // Allow walkthrough steps to request a scroll into view via a custom event.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const handler = (e: any) => {
      const selector = String(e?.detail?.selector || '').trim();
      if (!selector) return;

      const behavior = (String(e?.detail?.behavior || 'smooth') as ScrollBehavior) || 'smooth';
      const block = (String(e?.detail?.block || 'center') as ScrollLogicalPosition) || 'center';

      let attempts = 0;
      const maxAttempts = 20;
      const tick = () => {
        attempts++;
        const el = safeQuerySelector(selector) as HTMLElement | null;
        if (el) {
          try {
            el.scrollIntoView({ behavior, block, inline: 'nearest' });
          } catch {
            // Fallback
            try {
              el.scrollIntoView();
            } catch {}
          }
          return;
        }
        if (attempts < maxAttempts) {
          window.setTimeout(tick, 50);
        }
      };
      tick();
    };

    window.addEventListener('walkthrough:scrollToSelector', handler as any);
    return () => window.removeEventListener('walkthrough:scrollToSelector', handler as any);
  }, []);

  const status: TargetStatus = useMemo(() => {
    if (!enabled || !step) return 'idle';
    if (step.route && pathname !== step.route) return 'navigating';
    return 'searching';
  }, [enabled, pathname, step]);

  const { rect } = useTargetRect(step, enabled, status);

  const resolvedStatus: TargetStatus = useMemo(() => {
    if (!enabled || !step) return 'idle';
    if (status === 'navigating') return 'navigating';
    if (rect) return 'ready';
    // If we're searching and rect isn't present, we might be timing out; keep it simple for now.
    return 'searching';
  }, [enabled, rect, status, step]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Prevent any page scroll while the demo is active (no vertical/horizontal scrollbars).
  useEffect(() => {
    if (!enabled) return;
    if (step?.allowDocumentScroll) return;
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const html = document.documentElement;
    const body = document.body;

    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPaddingRight: body.style.paddingRight,
      htmlOverscroll: (html.style as any).overscrollBehavior,
      bodyOverscroll: (body.style as any).overscrollBehavior,
    };

    const scrollbarWidth = Math.max(0, window.innerWidth - html.clientWidth);

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    (html.style as any).overscrollBehavior = 'none';
    (body.style as any).overscrollBehavior = 'none';
    if (scrollbarWidth > 0) {
      // Compensate for scrollbar removal to avoid layout shift.
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    const preventScroll = (e: Event) => {
      e.preventDefault();
    };
    // Block wheel/touch scroll so the walkthrough never scrolls the page.
    window.addEventListener('wheel', preventScroll, { passive: false });
    window.addEventListener('touchmove', preventScroll, { passive: false });

    return () => {
      window.removeEventListener('wheel', preventScroll as any);
      window.removeEventListener('touchmove', preventScroll as any);
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
      body.style.paddingRight = prev.bodyPaddingRight;
      (html.style as any).overscrollBehavior = prev.htmlOverscroll;
      (body.style as any).overscrollBehavior = prev.bodyOverscroll;
    };
  }, [enabled, step?.allowDocumentScroll]);

  // Keyboard shortcuts.
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stop();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        next();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, next, prev, stop]);

  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipStyle, setTooltipStyle] = useState<{
    left: number;
    top: number;
    transformOrigin: string;
    placement: AppliedPlacement;
    arrowX: number;
    arrowY: number;
    showArrow: boolean;
  } | null>(null);

  // Spotlight inset / bubble gap defaults are tighter on mobile so the
  // tooltip card fits without crowding the highlighted element.
  const paddingPx = step?.paddingPx ?? (isMobile ? 6 : 10);
  const radiusPx = step?.radiusPx ?? 12;
  const gapPx =
    typeof step?.gapPx === 'number' && Number.isFinite(step.gapPx)
      ? Math.max(0, step.gapPx)
      : isMobile
        ? 12
        : 18;

  const spotlightRect = useMemo(() => {
    if (!enabled || !rect) return null;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

    const left = rect.left - paddingPx;
    const top = rect.top - paddingPx;
    const right = rect.right + paddingPx;
    const bottom = rect.bottom + paddingPx;

    // Clamp highlight within the viewport to avoid any spill-off.
    const cl = clamp(left, 0, vw);
    const ct = clamp(top, 0, vh);
    const cr = clamp(right, 0, vw);
    const cb = clamp(bottom, 0, vh);

    const w = Math.max(0, cr - cl);
    const h = Math.max(0, cb - ct);
    if (w <= 0 || h <= 0) return null;

    return { left: cl, top: ct, width: w, height: h };
  }, [enabled, paddingPx, rect]);

  useLayoutEffect(() => {
    if (!enabled || !step || !rect) {
      setTooltipStyle(null);
      return;
    }
    // Add the highlight padding to the effective target rect so the tooltip
    // has consistent "breathing room" from the explained component.
    const expandedTarget = new DOMRect(
      rect.left - paddingPx,
      rect.top - paddingPx,
      rect.width + paddingPx * 2,
      rect.height + paddingPx * 2
    );
    const anchor = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const tip = tooltipRef.current?.getBoundingClientRect?.();
    if (!tip) return;
    setTooltipStyle(
      computeTooltipPosition({
        placement: step.placement || 'auto',
        target: expandedTarget,
        anchor,
        gap: gapPx,
        tooltipW: tip.width,
        tooltipH: tip.height,
        mobile: isMobile,
        safeAreaTop: safeArea.top,
        safeAreaBottom: safeArea.bottom,
      })
    );
  }, [
    enabled,
    gapPx,
    isMobile,
    paddingPx,
    rect,
    safeArea.bottom,
    safeArea.top,
    step?.id,
    step?.placement,
    step?.title,
    step?.description,
  ]);

  const isLast = Boolean(progress && progress.total > 0 && progress.index >= progress.total - 1);
  const nextLabel = step?.nextLabel || (isLast ? 'Finish' : 'Next');

  if (!mounted || !enabled || !step) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        key={`walkthrough:${state.definition?.id || 'unknown'}`}
        className="fixed inset-0 z-[20000]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        aria-live="polite"
      >
        {/* Click blocker */}
        <div className="absolute inset-0" style={{ cursor: 'default' }} />

        {/* Spotlight */}
        {resolvedStatus === 'ready' && rect ? (
          <motion.div
            aria-hidden="true"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute pointer-events-none"
            style={{
              left: spotlightRect?.left ?? rect.left,
              top: spotlightRect?.top ?? rect.top,
              width: spotlightRect?.width ?? rect.width,
              height: spotlightRect?.height ?? rect.height,
              borderRadius: radiusPx,
              // Darken everything outside the spotlight.
              // Add a tight inset border (no "outside" outline that can spill off-screen).
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.66), inset 0 0 0 1px rgba(74,158,255,0.55)',
            }}
          />
        ) : (
          <div className="absolute inset-0 bg-black/70" aria-hidden="true" />
        )}

        {/* Tooltip card */}
        <motion.div
          ref={tooltipRef}
          className={`fixed rounded-xl border border-[#222222] bg-[#0F0F0F] shadow-2xl ${
            isMobile
              ? 'w-[min(340px,calc(100vw-16px))]'
              : 'w-[360px] max-w-[calc(100vw-24px)]'
          }`}
          style={{
            left: tooltipStyle?.left ?? '50%',
            top: tooltipStyle?.top ?? '50%',
            transform: tooltipStyle ? 'translate3d(0,0,0)' : 'translate(-50%, -50%)',
            transformOrigin: tooltipStyle?.transformOrigin ?? 'center',
          }}
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.18 }}
        >
          {/* Arrow (always points inward / toward viewport center via placement logic).
              Skipped when the bubble is docked to a viewport edge — the
              arrow would just hang off into the dimmed area without a
              meaningful target. */}
          {tooltipStyle && tooltipStyle.showArrow ? (
            <>
              {/* Border layer */}
              <div
                aria-hidden="true"
                className="absolute"
                style={(() => {
                  const p = tooltipStyle.placement;
                  const x = tooltipStyle.arrowX;
                  const y = tooltipStyle.arrowY;
                  const s = 7;
                  if (p === 'right') {
                    return {
                      left: -s,
                      top: y - s,
                      width: 0,
                      height: 0,
                      borderTop: `${s}px solid transparent`,
                      borderBottom: `${s}px solid transparent`,
                      borderRight: `${s}px solid #222222`,
                    } as React.CSSProperties;
                  }
                  if (p === 'left') {
                    return {
                      right: -s,
                      top: y - s,
                      width: 0,
                      height: 0,
                      borderTop: `${s}px solid transparent`,
                      borderBottom: `${s}px solid transparent`,
                      borderLeft: `${s}px solid #222222`,
                    } as React.CSSProperties;
                  }
                  if (p === 'top') {
                    return {
                      left: x - s,
                      bottom: -s,
                      width: 0,
                      height: 0,
                      borderLeft: `${s}px solid transparent`,
                      borderRight: `${s}px solid transparent`,
                      borderTop: `${s}px solid #222222`,
                    } as React.CSSProperties;
                  }
                  return {
                    left: x - s,
                    top: -s,
                    width: 0,
                    height: 0,
                    borderLeft: `${s}px solid transparent`,
                    borderRight: `${s}px solid transparent`,
                    borderBottom: `${s}px solid #222222`,
                  } as React.CSSProperties;
                })()}
              />
              {/* Fill layer */}
              <div
                aria-hidden="true"
                className="absolute"
                style={(() => {
                  const p = tooltipStyle.placement;
                  const x = tooltipStyle.arrowX;
                  const y = tooltipStyle.arrowY;
                  const s = 6;
                  if (p === 'right') {
                    return {
                      left: -s,
                      top: y - s,
                      width: 0,
                      height: 0,
                      borderTop: `${s}px solid transparent`,
                      borderBottom: `${s}px solid transparent`,
                      borderRight: `${s}px solid #0F0F0F`,
                    } as React.CSSProperties;
                  }
                  if (p === 'left') {
                    return {
                      right: -s,
                      top: y - s,
                      width: 0,
                      height: 0,
                      borderTop: `${s}px solid transparent`,
                      borderBottom: `${s}px solid transparent`,
                      borderLeft: `${s}px solid #0F0F0F`,
                    } as React.CSSProperties;
                  }
                  if (p === 'top') {
                    return {
                      left: x - s,
                      bottom: -s,
                      width: 0,
                      height: 0,
                      borderLeft: `${s}px solid transparent`,
                      borderRight: `${s}px solid transparent`,
                      borderTop: `${s}px solid #0F0F0F`,
                    } as React.CSSProperties;
                  }
                  return {
                    left: x - s,
                    top: -s,
                    width: 0,
                    height: 0,
                    borderLeft: `${s}px solid transparent`,
                    borderRight: `${s}px solid transparent`,
                    borderBottom: `${s}px solid #0F0F0F`,
                  } as React.CSSProperties;
                })()}
              />
            </>
          ) : null}
          <div className={isMobile ? 'p-2.5' : 'p-3'}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wide">
                  {progress ? `Step ${progress.index + 1} of ${progress.total}` : 'Walkthrough'}
                </div>
                <div className={`mt-1 font-semibold text-white leading-snug ${isMobile ? 'text-[13px]' : 'text-sm'}`}>
                  {step.title}
                </div>
              </div>
              <button
                onClick={() => stop()}
                className="h-7 w-7 flex-shrink-0 rounded-md border border-[#222222] bg-[#111111] text-[#9CA3AF] hover:text-white hover:border-[#333333] transition-all duration-200 flex items-center justify-center"
                aria-label="Close walkthrough"
                title="Close"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div
              className={`mt-2 text-[#b3b3b3] leading-relaxed ${isMobile ? 'text-[11.5px]' : 'text-[12px]'}`}
            >
              {resolvedStatus === 'navigating'
                ? 'Navigating to the next section…'
                : resolvedStatus === 'searching'
                  ? 'Loading this section…'
                  : step.description}
            </div>

            <div className={`flex items-center justify-between ${isMobile ? 'mt-2.5' : 'mt-3'}`}>
              <button
                onClick={() => prev()}
                disabled={!progress || progress.index <= 0}
                className={`text-white bg-transparent border border-[#222222] hover:border-[#333333] hover:bg-[#1A1A1A] rounded transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
                  isMobile ? 'text-[12px] px-3 py-1.5' : 'text-[12px] px-3 py-2'
                }`}
              >
                Back
              </button>

              <button
                onClick={() => next()}
                className={`font-medium text-black bg-[#4a9eff] hover:bg-[#3d8ae6] rounded transition-all duration-200 ${
                  isMobile ? 'text-[12px] px-3 py-1.5' : 'text-[12px] px-3 py-2'
                }`}
              >
                {nextLabel}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

