'use client';

import React from 'react';

/**
 * Fallback icon used when a market does not have `markets.icon_image_url` set in Supabase.
 *
 * Change this value later if you want a different placeholder icon everywhere
 * these widgets render market icons.
 */
export const DEFAULT_MARKET_ICON_URL = '/placeholder-market.svg';

export function MarketIconBadge({
  iconUrl,
  alt,
  sizePx = 20,
}: {
  iconUrl?: string | null;
  alt: string;
  sizePx?: number;
}) {
  const src = typeof iconUrl === 'string' && iconUrl.trim() ? iconUrl.trim() : DEFAULT_MARKET_ICON_URL;

  return (
    <div
      className="rounded-full bg-[#1A1A1A] border border-[#222222] flex items-center justify-center overflow-hidden flex-shrink-0"
      style={{ width: sizePx, height: sizePx }}
      data-icon-src={src}
    >
      <img
        src={src}
        alt={alt}
        width={sizePx}
        height={sizePx}
        className="w-full h-full object-cover"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={(e) => {
          // If the Supabase URL is missing/invalid or blocked, fall back to placeholder.
          const el = e.currentTarget;
          if (el.src.endsWith(DEFAULT_MARKET_ICON_URL)) return;
          el.src = DEFAULT_MARKET_ICON_URL;
        }}
      />
    </div>
  );
}

