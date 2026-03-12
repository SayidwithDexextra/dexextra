'use client';

import { useEffect } from 'react';

function isProbablyMetaMaskInAppBrowser(): boolean {
  try {
    const ua = String(globalThis.navigator?.userAgent || '');
    const uaLooksLikeMetaMask = /metamask/i.test(ua);
    const injectedLooksLikeMetaMask = Boolean((globalThis as any)?.window?.ethereum?.isMetaMask);
    return uaLooksLikeMetaMask || injectedLooksLikeMetaMask;
  } catch {
    return false;
  }
}

function safeResolveUrl(raw: unknown): URL | null {
  try {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    return new URL(s, globalThis.window?.location?.href || undefined);
  } catch {
    return null;
  }
}

function isHttpProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:';
}

/**
 * MetaMask mobile/in-app browser may show an interstitial:
 * "This website has been blocked from automatically opening an external application"
 * when any script attempts to open an external app/link without a user gesture.
 *
 * We defensively block *non-user-initiated* external opens only when running inside MetaMask.
 * User clicks (and short async follow-ups) are still allowed.
 */
export default function ExternalAppOpenGuard() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // If the token layout already installed the early (beforeInteractive) guard, don't patch again.
    if ((window as any).__DEXEXTRA_EXTERNAL_OPEN_GUARD_INSTALLED__) return;
    if (!isProbablyMetaMaskInAppBrowser()) return;

    const ALLOW_WINDOW_MS = 1200;
    let lastGestureAt = 0;

    const markGesture = () => {
      lastGestureAt = Date.now();
    };

    // Capture user gestures early so async handlers can still be considered "user initiated".
    window.addEventListener('pointerdown', markGesture, true);
    window.addEventListener('touchstart', markGesture, true);
    window.addEventListener('keydown', markGesture, true);

    const hasUserGesture = () => {
      try {
        const ua = (navigator as any)?.userActivation;
        if (ua && typeof ua.isActive === 'boolean') return Boolean(ua.isActive);
      } catch {
        // fall back to timestamp window
      }
      return Date.now() - lastGestureAt <= ALLOW_WINDOW_MS;
    };

    const origin = window.location.origin;

    const shouldBlockExternalOpen = (urlLike: unknown) => {
      const u = safeResolveUrl(urlLike);
      if (!u) return false;
      // Always block non-http(s) protocols without a gesture (mailto:, tel:, wc:, metamask:, etc.)
      if (!isHttpProtocol(u.protocol)) return !hasUserGesture();
      // For http(s), block cross-origin opens without a gesture (covers universal-link attempts too).
      if (u.origin !== origin) return !hasUserGesture();
      return false;
    };

    const originalOpen = window.open?.bind(window);
    if (typeof originalOpen === 'function') {
      window.open = ((url?: string | URL, target?: string, features?: string) => {
        if (shouldBlockExternalOpen(url)) {
          try {
            const u = safeResolveUrl(url);
            // eslint-disable-next-line no-console
            console.warn('[ExternalAppOpenGuard] Blocked window.open without user gesture', {
              url: u?.href ?? String(url ?? ''),
              target,
            });
          } catch {
            // ignore
          }
          return null;
        }
        return originalOpen(url as any, target as any, features as any);
      }) as any;
    }

    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patchedAnchorClick(this: HTMLAnchorElement) {
      // Only guard programmatic clicks that would open something external.
      try {
        const href = this.getAttribute('href') || this.href;
        const u = safeResolveUrl(href);
        if (u && (!isHttpProtocol(u.protocol) || u.origin !== origin) && !hasUserGesture()) {
          // eslint-disable-next-line no-console
          console.warn('[ExternalAppOpenGuard] Blocked programmatic <a>.click without user gesture', {
            href: u.href,
            target: this.target,
          });
          return;
        }
      } catch {
        // ignore and fall through
      }
      return originalAnchorClick.apply(this);
    };

    return () => {
      window.removeEventListener('pointerdown', markGesture, true);
      window.removeEventListener('touchstart', markGesture, true);
      window.removeEventListener('keydown', markGesture, true);

      // Restore patched globals
      try {
        if (typeof originalOpen === 'function') window.open = originalOpen as any;
      } catch {}
      try {
        HTMLAnchorElement.prototype.click = originalAnchorClick;
      } catch {}
    };
  }, []);

  return null;
}

