'use client';

import React, { useState } from 'react';
import { MarketPreviewModal } from '@/components/MarketPreviewModal';
import type { PreviewTemplate } from '@/components/MarketPreviewModal/types';

const SAMPLE_TEMPLATES: PreviewTemplate[] = [
  {
    id: 'tmpl-1',
    title: 'Bitcoin Price Chart',
    image: 'https://images.unsplash.com/photo-1639762681057-408e52192e55?w=800&q=80',
    category: 'Crypto',
  },
  {
    id: 'tmpl-2',
    title: 'Trading Dashboard',
    image: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&q=80',
    category: 'Finance',
  },
  {
    id: 'tmpl-3',
    title: 'Market Analytics',
    image: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&q=80',
    category: 'Analytics',
  },
  {
    id: 'tmpl-4',
    title: 'Portfolio View',
    image: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&q=80',
    category: 'Finance',
  },
];

const PRESETS: Record<string, {
  productTitle: string;
  author: string;
  price: number;
  currency: string;
  description: string;
  category: string;
  templates: PreviewTemplate[];
}> = {
  crypto: {
    productTitle: 'Bitcoin Price Tracker',
    author: 'CryptoMetrics',
    price: 67_450,
    currency: 'USD',
    description:
      'Track the real-time price of Bitcoin across major exchanges. This market resolves based on the CoinGecko BTC/USD spot price at the settlement date. Includes 24h volume, market cap, and historical price data for informed trading decisions.',
    category: 'Cryptocurrency',
    templates: SAMPLE_TEMPLATES,
  },
  sports: {
    productTitle: 'Premier League: Man City vs Arsenal',
    author: 'SportsOracle',
    price: 1.85,
    currency: 'USD',
    description:
      'Will Manchester City defeat Arsenal in their upcoming Premier League match? Market resolves YES if Man City wins in regulation time. Draw and Arsenal win both resolve NO.',
    category: 'Sports',
    templates: [
      { id: 's1', title: 'Match Preview', image: '', category: 'Sports' },
      { id: 's2', title: 'Head to Head', image: '', category: 'Sports' },
    ],
  },
  weather: {
    productTitle: 'NYC Temperature Above 90°F This Week',
    author: 'WeatherDAO',
    price: 0.42,
    currency: 'USD',
    description:
      'Will the temperature in New York City exceed 90°F (32.2°C) at any point during the current calendar week? Resolves based on the official NWS Central Park weather station readings.',
    category: 'Weather',
    templates: [],
  },
};

export default function DebugMarketPreviewModalPage() {
  const debugEnabled =
    process.env.NODE_ENV !== 'production' ||
    String(process.env.NEXT_PUBLIC_ENABLE_DEBUG_PAGES || '').toLowerCase() === 'true';

  const [open, setOpen] = useState(false);
  const [productTitle, setProductTitle] = useState(PRESETS.crypto.productTitle);
  const [author, setAuthor] = useState(PRESETS.crypto.author);
  const [price, setPrice] = useState(PRESETS.crypto.price);
  const [currency, setCurrency] = useState(PRESETS.crypto.currency);
  const [description, setDescription] = useState(PRESETS.crypto.description);
  const [category, setCategory] = useState(PRESETS.crypto.category);
  const [templates, setTemplates] = useState<PreviewTemplate[]>(PRESETS.crypto.templates);

  const applyPreset = (key: string) => {
    const p = PRESETS[key];
    if (!p) return;
    setProductTitle(p.productTitle);
    setAuthor(p.author);
    setPrice(p.price);
    setCurrency(p.currency);
    setDescription(p.description);
    setCategory(p.category);
    setTemplates(p.templates);
  };

  if (!debugEnabled) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
          <div className="text-[12px] font-medium text-white">Debug pages disabled</div>
          <div className="mt-1 text-[11px] text-[#9CA3AF]">
            Set <span className="font-mono text-white/80">NEXT_PUBLIC_ENABLE_DEBUG_PAGES=true</span> to enable in
            production.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-4 space-y-4">
      {/* Header */}
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-[13px] font-medium text-white">Debug: Market Preview Modal</div>
            <div className="mt-1 text-[11px] text-[#9CA3AF]">
              Full-screen slide-up modal for previewing market details, pricing, and template images.
            </div>
          </div>
          <a
            href="/debug"
            className="rounded border border-[#333333] bg-[#141414] px-3 py-1.5 text-[11px] text-white hover:bg-[#1A1A1A]"
          >
            Back to Debug Hub
          </a>
        </div>
      </div>

      {/* Presets */}
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4 space-y-3">
        <div className="text-[10px] text-[#808080] uppercase tracking-wider">Quick Presets</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(PRESETS).map(([key, preset]) => (
            <button
              key={key}
              onClick={() => applyPreset(key)}
              className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] text-white hover:bg-[#1A1A1A] capitalize"
            >
              {key} &mdash; {preset.category}
            </button>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4 space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Product Title</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={productTitle}
              onChange={(e) => setProductTitle(e.target.value)}
            />
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Author</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Price</div>
            <input
              type="number"
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={price}
              onChange={(e) => setPrice(Number(e.target.value) || 0)}
            />
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Currency</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            />
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Category</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Templates ({templates.length})</div>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  setTemplates((t) => [
                    ...t,
                    { id: `tmpl-${Date.now()}`, title: `Template ${t.length + 1}`, image: '', category: '' },
                  ])
                }
                className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[11px] text-white hover:bg-[#1A1A1A]"
              >
                + Add empty
              </button>
              <button
                onClick={() => setTemplates(SAMPLE_TEMPLATES)}
                className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[11px] text-white hover:bg-[#1A1A1A]"
              >
                Reset to samples
              </button>
              <button
                onClick={() => setTemplates([])}
                className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[11px] text-white hover:bg-[#1A1A1A]"
              >
                Clear all
              </button>
            </div>
          </label>
        </div>

        <label className="block">
          <div className="text-[10px] text-[#808080] mb-1">Description</div>
          <textarea
            className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setOpen(true)}
            className="rounded bg-white px-4 py-2 text-[12px] font-medium text-black hover:bg-white/90"
          >
            Open Modal
          </button>

          <button
            onClick={() => setOpen(false)}
            className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] font-medium text-white hover:bg-[#1A1A1A]"
          >
            Close Modal
          </button>
        </div>
      </div>

      {/* Current props preview */}
      <details className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <summary className="cursor-pointer text-[11px] text-white/60">Current props (JSON)</summary>
        <pre className="mt-2 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-[11px] text-white/80">
          {JSON.stringify({ productTitle, author, price, currency, description, category, templates }, null, 2)}
        </pre>
      </details>

      <MarketPreviewModal
        isOpen={open}
        onClose={() => setOpen(false)}
        productTitle={productTitle}
        author={author}
        price={price}
        currency={currency}
        description={description}
        category={category}
        templates={templates}
        onGoToProduct={() => {
          alert('onGoToProduct fired');
          setOpen(false);
        }}
      />
    </div>
  );
}
