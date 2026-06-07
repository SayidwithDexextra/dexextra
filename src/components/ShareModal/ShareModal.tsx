'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './ShareModal.module.css';
import SocialPreviewCard, { SocialPreviewCardData, SocialPreviewVariant } from './SocialPreviewCard';
import { 
  MarketShareData, 
  getShareText, 
  getShareSubject,
  buildMarketShareData,
  buildShareUrl 
} from '@/lib/shareUtils';

export interface ShareModalMarketData {
  symbol?: string;
  name?: string;
  /** Supabase market UUID — enables fetching real price action for the chart card. */
  market_id?: string;
  description?: string;
  last_trade_price?: number;
  mark_price?: number;
  /** Human-readable original cost (not scaled). */
  start_price?: number;
  /** Explicit PnL %; overrides the price-derived value on the preview card. */
  pnl_percent?: number;
  settlement_date?: string;
  total_volume?: number;
  category?: string;
  icon_image_url?: string;
  market_identifier?: string;
}

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  url?: string;
  imageUrl?: string;
  title?: string;
  text?: string;
  marketData?: ShareModalMarketData;
  referralCode?: string;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function TwitterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function RedditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

const PREVIEW_VARIANTS: { id: SocialPreviewVariant; label: string }[] = [
  { id: 'image', label: 'Market Card' },
  { id: 'chart', label: 'Price Chart' },
];

function ShareNodesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={styles.spinner}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

const SHARE_OPTIONS = [
  { id: 'twitter', label: 'Twitter', Icon: TwitterIcon, className: 'twitter' },
  { id: 'facebook', label: 'Facebook', Icon: FacebookIcon, className: 'facebook' },
  { id: 'reddit', label: 'Reddit', Icon: RedditIcon, className: 'reddit' },
  { id: 'discord', label: 'Discord', Icon: DiscordIcon, className: 'discord' },
  { id: 'telegram', label: 'Telegram', Icon: TelegramIcon, className: 'telegram' },
  { id: 'whatsapp', label: 'WhatsApp', Icon: WhatsAppIcon, className: 'whatsapp' },
  { id: 'email', label: 'Email', Icon: EmailIcon, className: 'email' },
  { id: 'more', label: 'More', Icon: MoreIcon, className: 'more' },
] as const;

export default function ShareModal({ 
  isOpen, 
  onClose, 
  url, 
  imageUrl,
  title, 
  text, 
  marketData,
  referralCode 
}: ShareModalProps) {
  const [isExiting, setIsExiting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [animationKey, setAnimationKey] = useState(0);
  const [isSharing, setIsSharing] = useState(false);
  const [canShareFiles, setCanShareFiles] = useState(false);
  const [savedImage, setSavedImage] = useState(false);
  const [previewVariant, setPreviewVariant] = useState<SocialPreviewVariant>('image');
  const [chartSeries, setChartSeries] = useState<number[] | null>(null);
  const imageFileCache = useRef<{ url: string; promise: Promise<File | null> } | null>(null);

  const baseUrl = url || (typeof window !== 'undefined' ? window.location.href : '');
  // Link-based platforms unfurl an image from page metadata, not from the share
  // action. Route those links through /s/<symbol>?variant=… so the unfurled
  // preview matches the selected card (chart vs market). Humans get redirected
  // to the market page; crawlers read the variant-aware OG tags.
  const shareSymbol = marketData?.market_identifier || marketData?.symbol;
  const shareOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'https://dexetera.org';
  const linkBase = shareSymbol
    ? `${shareOrigin}/s/${encodeURIComponent(shareSymbol)}?variant=${previewVariant}`
    : baseUrl;
  const shareUrl = buildShareUrl(linkBase, referralCode);
  
  const marketShareData: MarketShareData | null = useMemo(() => {
    if (!marketData) return null;
    return buildMarketShareData(marketData, typeof window !== 'undefined' ? window.location.origin : 'https://dexetera.org');
  }, [marketData]);

  const previewData: SocialPreviewCardData | null = useMemo(() => {
    if (!marketData) return null;
    const scaledMark = marketData.mark_price ?? marketData.last_trade_price;
    const markPrice =
      typeof scaledMark === 'number' && Number.isFinite(scaledMark)
        ? scaledMark / 1_000_000
        : undefined;
    return {
      title: marketData.name || marketData.symbol || title || 'Market',
      symbol: marketData.symbol,
      category: marketData.category,
      description: marketData.description,
      iconUrl: marketData.icon_image_url,
      markPrice,
      startPrice: marketData.start_price,
      pnlPercent: marketData.pnl_percent,
      series: chartSeries ?? undefined,
    };
  }, [marketData, title, chartSeries]);

  const shareTitle = title || marketShareData?.name || 'Check this out';
  const shareText = text || '';

  // The image actually shared/downloaded reflects the selected preview variant.
  // We request the square (1080×1080) format here because this file is sent
  // straight into apps (Instagram, iMessage, Mail) via the native share sheet,
  // and a square image is the universally safe, Instagram-friendly aspect.
  const variantImageUrl = useMemo(() => {
    if (!imageUrl) return imageUrl;
    const sep = imageUrl.includes('?') ? '&' : '?';
    const parts: string[] = [];
    if (previewVariant === 'chart') parts.push('variant=chart');
    parts.push('format=square');
    return `${imageUrl}${sep}${parts.join('&')}`;
  }, [imageUrl, previewVariant]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Replay the card assembly animation each time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setAnimationKey((k) => k + 1);
    }
  }, [isOpen]);

  // Reset cached price-action whenever the target market changes.
  useEffect(() => {
    setChartSeries(null);
  }, [marketData?.market_id, marketData?.symbol]);

  // Replay the assembly animation when switching preview variants.
  const handleVariantChange = useCallback((variant: SocialPreviewVariant) => {
    setPreviewVariant((cur) => {
      if (cur !== variant) setAnimationKey((k) => k + 1);
      return variant;
    });
  }, []);

  // Carousel navigation across the available shareable card types.
  const stepVariant = useCallback((dir: 1 | -1) => {
    setPreviewVariant((cur) => {
      const idx = PREVIEW_VARIANTS.findIndex((v) => v.id === cur);
      const nextIdx = (idx + dir + PREVIEW_VARIANTS.length) % PREVIEW_VARIANTS.length;
      const next = PREVIEW_VARIANTS[nextIdx].id;
      if (next !== cur) setAnimationKey((k) => k + 1);
      return next;
    });
  }, []);

  // Lazily fetch the real price action (candle closes) the first time the user
  // opens the chart card. Falls back to a synthesized trend if unavailable.
  useEffect(() => {
    if (!isOpen || previewVariant !== 'chart' || chartSeries !== null) return;
    const marketId = marketData?.market_id;
    if (!marketId) {
      setChartSeries([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/charts/ohlcv?marketId=${encodeURIComponent(marketId)}&timeframe=1h&limit=120`,
          { cache: 'force-cache' }
        );
        const json = await res.json();
        const closes: number[] = Array.isArray(json?.data)
          ? json.data
              .map((d: { close?: number; c?: number; y?: number }) => Number(d?.close ?? d?.c ?? d?.y))
              .filter((n: number) => Number.isFinite(n))
          : [];
        if (!cancelled) setChartSeries(closes);
      } catch {
        if (!cancelled) setChartSeries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, previewVariant, chartSeries, marketData?.market_id]);

  // Warm the server-rendered OG image lazily so social scrapers get a cached
  // PNG the moment a user actually shares (we don't pay for it on page load).
  const warmOgImage = useCallback(() => {
    if (!variantImageUrl) return;
    try {
      fetch(variantImageUrl, { mode: 'no-cors', cache: 'force-cache' }).catch(() => {});
    } catch {
      /* best-effort prefetch */
    }
  }, [variantImageUrl]);

  // Detect whether this device can share actual image files via the native
  // share sheet (the iMessage / Instagram / Mail path). Safari iOS, Android
  // Chrome, and some desktops support it; we fall back gracefully otherwise.
  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return;
    try {
      const probe = new File([new Blob(['x'], { type: 'image/png' })], 'probe.png', {
        type: 'image/png',
      });
      setCanShareFiles(navigator.canShare({ files: [probe] }));
    } catch {
      setCanShareFiles(false);
    }
  }, []);

  // Fetch the real OG PNG and wrap it as a File (cached per image URL) so it can
  // be handed directly to the OS share sheet or downloaded for manual attach.
  const getShareImageFile = useCallback(async (): Promise<File | null> => {
    if (!variantImageUrl) return null;
    if (imageFileCache.current?.url === variantImageUrl) return imageFileCache.current.promise;
    const promise = (async () => {
      try {
        const res = await fetch(variantImageUrl, { cache: 'force-cache' });
        if (!res.ok) return null;
        const blob = await res.blob();
        const sym = String(marketData?.symbol || marketData?.market_identifier || 'market')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-');
        return new File([blob], `dexetera-${sym}.png`, { type: blob.type || 'image/png' });
      } catch {
        return null;
      }
    })();
    imageFileCache.current = { url: variantImageUrl, promise };
    return promise;
  }, [variantImageUrl, marketData]);

  // Pre-fetch the actual image File while the modal is open so a platform/Share
  // tap can hand it to the native sheet immediately. Awaiting an already-resolved
  // promise preserves the tap's user activation (iOS requires this for files).
  useEffect(() => {
    if (isOpen && canShareFiles && variantImageUrl) {
      void getShareImageFile();
    }
  }, [isOpen, canShareFiles, variantImageUrl, getShareImageFile]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleClose = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      onClose();
      setIsExiting(false);
    }, 200);
  }, [onClose]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [shareUrl]);

  // The Kalshi / Polymarket-style action: push the actual image file + link into
  // the native OS share sheet so the user can send it straight to iMessage,
  // Instagram, Mail, etc. Falls back to link-only share, then clipboard.
  const handleNativeShare = useCallback(async (platform?: string) => {
    if (isSharing) return;
    setIsSharing(true);
    try {
      const platformText = marketShareData
        ? getShareText(platform || 'more', { ...marketShareData, url: shareUrl })
        : shareText || shareTitle;
      const file = await getShareImageFile();

      if (file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: shareTitle, text: platformText, url: shareUrl });
      } else if (typeof navigator.share === 'function') {
        await navigator.share({ title: shareTitle, text: platformText, url: shareUrl });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (err) {
      // Swallow user-cancelled shares (AbortError); surface nothing intrusive.
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('Native share failed:', err);
      }
    } finally {
      setIsSharing(false);
    }
  }, [isSharing, marketShareData, shareUrl, shareText, shareTitle, getShareImageFile]);

  const handleDownloadImage = useCallback(async () => {
    const file = await getShareImageFile();
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    setSavedImage(true);
    setTimeout(() => setSavedImage(false), 2000);
  }, [getShareImageFile]);

  const handleShare = useCallback((platform: string) => {
    // Generate / cache the real social image on demand, right as the user shares.
    warmOgImage();

    // On devices that can share files (i.e. mobile), every platform tap opens the
    // native share sheet with the actual image attached — the web can't push a
    // file to a specific app, so the user picks the target (WhatsApp, IG, …) from
    // the sheet. 'more' always uses the sheet.
    if (
      platform === 'more' ||
      (canShareFiles && typeof navigator !== 'undefined' && typeof navigator.share === 'function')
    ) {
      void handleNativeShare(platform === 'more' ? undefined : platform);
      return;
    }

    // Desktop / no file-share: fall back to web intents. The shared link unfurls
    // to the OG image preview via the page's meta tags.
    const encodedUrl = encodeURIComponent(shareUrl);
    const platformText = marketShareData
      ? getShareText(platform, { ...marketShareData, url: shareUrl })
      : shareText || shareTitle;
    const encodedText = encodeURIComponent(platformText);
    const encodedTitle = encodeURIComponent(
      marketShareData ? getShareSubject(marketShareData) : shareTitle
    );

    if (platform === 'discord') {
      const discordText = marketShareData
        ? `${getShareText('discord', { ...marketShareData, url: shareUrl })}\n${shareUrl}`
        : shareUrl;
      navigator.clipboard.writeText(discordText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return;
    }

    const shareUrls: Record<string, string> = {
      twitter: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      reddit: `https://reddit.com/submit?url=${encodedUrl}&title=${encodedTitle}`,
      telegram: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`,
      whatsapp: `https://wa.me/?text=${encodedText}%20${encodedUrl}`,
      email: `mailto:?subject=${encodedTitle}&body=${encodedText}%0A%0A${encodedUrl}`,
    };

    const targetUrl = shareUrls[platform];
    if (targetUrl) {
      window.open(targetUrl, '_blank', 'noopener,noreferrer,width=600,height=400');
    }
  }, [shareUrl, shareTitle, shareText, marketShareData, warmOgImage, handleNativeShare, canShareFiles]);

  if (!isOpen || !mounted) return null;

  const modalContent = (
    <div className={styles.overlay}>
      <div 
        className={`${styles.backdrop} ${isExiting ? styles.backdropExit : styles.backdropEnter}`}
        onClick={handleClose}
      />
      <div className={`${styles.modal} ${isExiting ? styles.modalExit : styles.modalEnter}`}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Share</h2>
          <button className={styles.closeBtn} onClick={handleClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {previewData && (
            <div className={styles.previewSection}>
              <div className={styles.previewHeader}>
                <div className={styles.previewLabel}>Social Preview Card</div>
                <div className={styles.previewTypeName}>
                  {PREVIEW_VARIANTS.find((v) => v.id === previewVariant)?.label}
                </div>
              </div>
              <div className={styles.carouselRow}>
                {PREVIEW_VARIANTS.length > 1 && (
                  <button
                    type="button"
                    className={styles.carouselArrow}
                    onClick={() => stepVariant(-1)}
                    aria-label="Previous card type"
                  >
                    <ChevronLeftIcon />
                  </button>
                )}
                <div className={styles.carousel}>
                  <SocialPreviewCard
                    data={previewData}
                    animationKey={animationKey}
                    variant={previewVariant}
                    shape="square"
                  />
                </div>
                {PREVIEW_VARIANTS.length > 1 && (
                  <button
                    type="button"
                    className={styles.carouselArrow}
                    onClick={() => stepVariant(1)}
                    aria-label="Next card type"
                  >
                    <ChevronRightIcon />
                  </button>
                )}
              </div>
              {PREVIEW_VARIANTS.length > 1 && (
                <div className={styles.carouselDots}>
                  {PREVIEW_VARIANTS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className={`${styles.carouselDot} ${previewVariant === v.id ? styles.carouselDotActive : ''}`}
                      onClick={() => handleVariantChange(v.id)}
                      aria-label={`Show ${v.label}`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Primary action: native share sheet with the image attached */}
          {imageUrl && (
            <div className={styles.primaryShareRow}>
              <button
                className={styles.primaryShareBtn}
                onClick={() => handleNativeShare()}
                disabled={isSharing}
                aria-label="Share post with image"
              >
                {isSharing ? <SpinnerIcon /> : <ShareNodesIcon />}
                <span>
                  {isSharing
                    ? 'Preparing image…'
                    : canShareFiles
                      ? 'Share post'
                      : 'Share'}
                </span>
              </button>
              <button
                className={`${styles.secondaryShareBtn} ${savedImage ? styles.copyBtnSuccess : ''}`}
                onClick={handleDownloadImage}
                aria-label="Save image"
                title="Save image"
              >
                {savedImage ? <CheckIcon /> : <DownloadIcon />}
              </button>
            </div>
          )}
          {imageUrl && (
            <div className={styles.primaryShareHint}>
              {canShareFiles
                ? 'Tap a platform (or “Share post”) to send the card image + link straight to Messages, Instagram, WhatsApp and more.'
                : 'Save the card image, or use a platform below to post your link.'}
            </div>
          )}

          {/* Share Options Grid */}
          <div className={styles.shareGrid}>
            {SHARE_OPTIONS.map(({ id, label, Icon, className }) => (
              <button
                key={id}
                className={`${styles.shareOption} ${styles[className]}`}
                onClick={() => handleShare(id)}
                aria-label={`Share on ${label}`}
              >
                <div className={styles.iconCircle}>
                  <Icon />
                </div>
                <span className={styles.shareLabel}>{label}</span>
              </button>
            ))}
          </div>

          {/* Link Copy Section */}
          <div className={styles.linkSection}>
            <div className={styles.linkLabel}>Page Link</div>
            <div className={styles.linkBox}>
              <span className={styles.linkText}>{shareUrl}</span>
              <button 
                className={`${styles.copyBtn} ${copied ? styles.copyBtnSuccess : ''}`}
                onClick={handleCopy}
                aria-label="Copy link"
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
