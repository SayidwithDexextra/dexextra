import { Metadata } from 'next';
import Script from 'next/script';

interface TokenLayoutProps {
  params: Promise<{ symbol: string }>;
  children: React.ReactNode;
}

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const { symbol } = await params;
  
  return {
    title: `${symbol.toUpperCase()} Token | Dexetera`,
    description: `Trade ${symbol.toUpperCase()} on Dexetera's decentralized trading platform. View real-time prices, charts, and trading data.`,
  };
}

export default function TokenLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* 
        MetaMask in-app browser blocks automatic external-app opens.
        Install a guard BEFORE any third-party scripts run.
      */}
      <Script id="metamask-external-open-guard" strategy="beforeInteractive">
        {`(function () {
  try {
    if (typeof window === 'undefined') return;
    if (window.__DEXEXTRA_EXTERNAL_OPEN_GUARD_INSTALLED__) return;
    window.__DEXEXTRA_EXTERNAL_OPEN_GUARD_INSTALLED__ = true;

    var ua = String((navigator && navigator.userAgent) || '');
    var looksLikeMetaMask = /metamask/i.test(ua) || !!(window.ethereum && window.ethereum.isMetaMask);
    if (!looksLikeMetaMask) return;

    var ALLOW_WINDOW_MS = 1200;
    var lastGestureAt = 0;
    var markGesture = function () { lastGestureAt = Date.now(); };

    window.addEventListener('pointerdown', markGesture, true);
    window.addEventListener('touchstart', markGesture, true);
    window.addEventListener('keydown', markGesture, true);

    var hasUserGesture = function () {
      try {
        var uaObj = navigator && navigator.userActivation;
        if (uaObj && typeof uaObj.isActive === 'boolean') return !!uaObj.isActive;
      } catch (e) {}
      return (Date.now() - lastGestureAt) <= ALLOW_WINDOW_MS;
    };

    var origin = String(window.location && window.location.origin) || '';
    var safeResolveUrl = function (raw) {
      try {
        var s = String(raw == null ? '' : raw).trim();
        if (!s) return null;
        return new URL(s, window.location && window.location.href);
      } catch (e) {
        return null;
      }
    };
    var isHttp = function (protocol) { return protocol === 'http:' || protocol === 'https:'; };
    var shouldBlock = function (urlLike) {
      var u = safeResolveUrl(urlLike);
      if (!u) return false;
      if (!isHttp(u.protocol)) return !hasUserGesture();
      if (origin && u.origin !== origin) return !hasUserGesture();
      return false;
    };

    // window.open
    try {
      var originalOpen = window.open && window.open.bind(window);
      if (typeof originalOpen === 'function') {
        window.open = function (url, target, features) {
          if (shouldBlock(url)) return null;
          return originalOpen(url, target, features);
        };
      }
    } catch (e) {}

    // Programmatic anchor clicks
    try {
      var originalAnchorClick = HTMLAnchorElement && HTMLAnchorElement.prototype && HTMLAnchorElement.prototype.click;
      if (originalAnchorClick) {
        HTMLAnchorElement.prototype.click = function () {
          try {
            var href = (this && (this.getAttribute && this.getAttribute('href'))) || (this && this.href) || '';
            var u = safeResolveUrl(href);
            if (u && (!isHttp(u.protocol) || (origin && u.origin !== origin)) && !hasUserGesture()) return;
          } catch (e) {}
          return originalAnchorClick.apply(this);
        };
      }
    } catch (e) {}

    // location.assign / replace (best-effort; may be read-only in some engines)
    try {
      var loc = window.location;
      if (loc && typeof loc.assign === 'function') {
        var origAssign = loc.assign.bind(loc);
        loc.assign = function (url) {
          if (shouldBlock(url)) return;
          return origAssign(url);
        };
      }
      if (loc && typeof loc.replace === 'function') {
        var origReplace = loc.replace.bind(loc);
        loc.replace = function (url) {
          if (shouldBlock(url)) return;
          return origReplace(url);
        };
      }
    } catch (e) {}
  } catch (e) {}
})();`}
      </Script>

      {/* Preload TradingView scripts for faster chart initialization */}
      <Script
        id="tradingview-charting-library-preload"
        src="/charting_library/charting_library.js"
        strategy="beforeInteractive"
      />
      <Script
        id="tradingview-udf-datafeed-preload"
        src="/charting_library/datafeeds/udf/dist/bundle.js"
        strategy="beforeInteractive"
      />
      {children}
    </>
  );
} 