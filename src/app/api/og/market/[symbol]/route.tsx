import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'edge';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const bebasNeueFontUrl =
  'https://unpkg.com/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff';
const interRegularFontUrl = 'https://unpkg.com/@fontsource/inter/files/inter-latin-400-normal.woff';
const interSemiBoldFontUrl = 'https://unpkg.com/@fontsource/inter/files/inter-latin-600-normal.woff';
const interBoldFontUrl = 'https://unpkg.com/@fontsource/inter/files/inter-latin-700-normal.woff';

let bebasNeueFontPromise: Promise<ArrayBuffer | null> | null = null;
let interRegularFontPromise: Promise<ArrayBuffer | null> | null = null;
let interSemiBoldFontPromise: Promise<ArrayBuffer | null> | null = null;
let interBoldFontPromise: Promise<ArrayBuffer | null> | null = null;

function loadFont(url: string): Promise<ArrayBuffer | null> {
  return fetch(url)
    .then((response) => {
      if (!response.ok) return null;
      return response.arrayBuffer();
    })
    .catch(() => null);
}

function loadBebasNeueFont(): Promise<ArrayBuffer | null> {
  bebasNeueFontPromise ??= loadFont(bebasNeueFontUrl);

  return bebasNeueFontPromise;
}

function loadInterFonts(): Promise<[ArrayBuffer | null, ArrayBuffer | null, ArrayBuffer | null]> {
  interRegularFontPromise ??= loadFont(interRegularFontUrl);
  interSemiBoldFontPromise ??= loadFont(interSemiBoldFontUrl);
  interBoldFontPromise ??= loadFont(interBoldFontUrl);

  return Promise.all([interRegularFontPromise, interSemiBoldFontPromise, interBoldFontPromise]);
}

function formatPrice(price: number): string {
  if (price >= 1000) {
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (price >= 1) {
    return `$${price.toFixed(2)}`;
  }
  if (price > 0) {
    return `$${price.toPrecision(4)}`;
  }
  return '$0.00';
}

function formatPnlPercent(percent: number): string {
  const sign = percent >= 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}

function truncateText(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

function parseStartPrice(initialOrder: unknown): number {
  if (!initialOrder || typeof initialOrder !== 'object') return 0;
  const order = initialOrder as Record<string, unknown>;
  const raw = order.startPrice ?? order.start_price ?? order.price;
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 ? price : 0;
}

function parseCategory(category: unknown): string {
  if (Array.isArray(category)) return truncateText(String(category[0] || '').toUpperCase(), 18);
  if (typeof category === 'string') return truncateText(category.toUpperCase(), 18);
  return '';
}

// Output formats. Landscape (1.91:1) is the link-unfurl standard for
// Twitter/Facebook/LinkedIn/etc; square & portrait/story are sized for
// Instagram feed and stories. The card itself is reused and scaled to fit.
const FORMATS: Record<string, { w: number; h: number; scale: number }> = {
  landscape: { w: 1200, h: 630, scale: 1 },
  square: { w: 1080, h: 1080, scale: 1.6 },
  portrait: { w: 1080, h: 1350, scale: 1.62 },
  story: { w: 1080, h: 1920, scale: 1.78 },
};

// ── Chart variant helpers (mirror SocialPreviewCard) ──
const CHART_W = 496;
const CHART_H = 296;
const CHART_PAD_X = 30;
const CHART_PAD_Y = 42;
const CHART_GRID_LINES = 5;

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) || 1;
}

function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function synthesizeSeries(start: number, end: number, seedStr: string, n = 56): number[] {
  const s = start > 0 ? start : end > 0 ? end : 1;
  const e = end > 0 ? end : s;
  const rand = seededRandom(hashString(seedStr));
  const vol = Math.max(Math.abs(e - s), Math.max(s, e) * 0.05) * 0.45;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const base = s + (e - s) * t;
    const wave = Math.sin(t * Math.PI * 3 + (rand() - 0.5)) * vol * 0.35;
    const noise = (rand() - 0.5) * vol * (1 - t * 0.5);
    out.push(Math.max(0, base + wave + noise));
  }
  out[0] = s;
  out[n - 1] = e;
  return out;
}

function buildChartSvg(series: number[], color: string): string {
  const pts = series.length >= 2 ? series : [series[0] ?? 0, series[0] ?? 0];
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const innerW = CHART_W - CHART_PAD_X * 2;
  const innerH = CHART_H - CHART_PAD_Y * 2;
  const coords = pts.map((v, i) => ({
    x: CHART_PAD_X + (i / (pts.length - 1)) * innerW,
    y: CHART_PAD_Y + innerH - ((v - min) / range) * innerH,
  }));
  const line = coords
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ');
  const baseY = (CHART_H - CHART_PAD_Y).toFixed(2);
  const last = coords[coords.length - 1];
  const area = `${line} L${last.x.toFixed(2)} ${baseY} L${coords[0].x.toFixed(2)} ${baseY} Z`;
  const grid = Array.from({ length: CHART_GRID_LINES }, (_, i) => {
    const y = CHART_PAD_Y + (i / (CHART_GRID_LINES - 1)) * innerH;
    return `<line x1="${CHART_PAD_X - 12}" x2="${CHART_W - CHART_PAD_X + 12}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}" stroke="#E2E2E0" stroke-width="1.5" stroke-dasharray="2 7" stroke-linecap="round"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_W}" height="${CHART_H}" viewBox="0 0 ${CHART_W} ${CHART_H}"><defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.16"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#a)"/><path d="${line}" fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="9" fill="#FFFFFF"/><circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="6.5" fill="${color}"/></svg>`;
}

async function loadChartSeries(
  origin: string,
  marketId: string | undefined,
  startPrice: number,
  currentPrice: number,
  seedStr: string
): Promise<number[]> {
  if (marketId) {
    try {
      const res = await fetch(
        `${origin}/api/charts/ohlcv?marketId=${encodeURIComponent(marketId)}&timeframe=1h&limit=120`
      );
      if (res.ok) {
        const json = (await res.json()) as { data?: Array<{ close?: number; c?: number; y?: number }> };
        const closes = Array.isArray(json?.data)
          ? json.data
              .map((d) => Number(d?.close ?? d?.c ?? d?.y))
              .filter((n) => Number.isFinite(n))
          : [];
        if (closes.length >= 2) return closes;
      }
    } catch {
      /* fall through to synthesized series */
    }
  }
  return synthesizeSeries(startPrice, currentPrice, seedStr);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    const sp = new URL(request.url).searchParams;
    const variant = sp.get('variant') === 'chart' ? 'chart' : 'image';
    const fmt = FORMATS[sp.get('format') || ''] ?? FORMATS.landscape;

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: market, error } = await supabase
      .from('markets')
      .select('id, name, symbol, description, icon_image_url, category, last_trade_price, initial_order')
      .or(`market_identifier.eq.${symbol},symbol.eq.${symbol}`)
      .eq('is_active', true)
      .single();

    if (error || !market) {
      return new ImageResponse(
        (
          <div
            style={{
              height: '100%',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#000000',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            <div style={{ color: '#A1A1A1', fontSize: 32 }}>Market not found</div>
          </div>
        ),
        { width: 1200, height: 630 }
      );
    }

    let markPriceScaled = Number(market.last_trade_price ?? 0);
    if (market.id) {
      const { data: ticker } = await supabase
        .from('market_tickers')
        .select('mark_price')
        .eq('market_id', market.id)
        .maybeSingle();

      if (ticker?.mark_price != null) {
        markPriceScaled = Number(ticker.mark_price);
      }
    }

    const currentPrice = Number.isFinite(markPriceScaled) ? markPriceScaled / 1_000_000 : 0;
    const startPrice = parseStartPrice(market.initial_order);
    const pnlPercent = startPrice > 0 ? ((currentPrice - startPrice) / startPrice) * 100 : 0;
    const pnlColor = pnlPercent >= 0 ? '#4ADE80' : '#F87171';

    let chartImageDataUri = '';
    if (variant === 'chart') {
      const origin = new URL(request.url).origin;
      const seedStr = market.symbol || market.name || symbol;
      const series = await loadChartSeries(origin, market.id, startPrice, currentPrice, seedStr);
      const chartColor = pnlPercent >= 0 ? '#16C784' : '#EA3943';
      const svg = buildChartSvg(series, chartColor);
      chartImageDataUri = `data:image/svg+xml;base64,${btoa(svg)}`;
    }
    const category = parseCategory(market.category);
    const title = truncateText(market.name || market.symbol || symbol.toUpperCase(), 28);
    const description = truncateText(
      market.description ||
        `Trade ${title} on Dexetera — decentralized metric futures with no permission needed.`,
      120
    );
    const dexeteraLogoUrl = new URL('/Dexicon/LOGO-Dexetera-04.svg', request.url).toString();
    const [bebasNeueFont, interFonts] = await Promise.all([
      loadBebasNeueFont(),
      loadInterFonts(),
    ]);
    const [interRegularFont, interSemiBoldFont, interBoldFont] = interFonts;
    const fonts = interRegularFont
      ? [
          {
            name: 'Inter',
            data: interRegularFont,
            style: 'normal' as const,
            weight: 400 as const,
          },
          ...(interSemiBoldFont
            ? [
                {
                  name: 'Inter',
                  data: interSemiBoldFont,
                  style: 'normal' as const,
                  weight: 600 as const,
                },
              ]
            : []),
          ...(interBoldFont
            ? [
                {
                  name: 'Inter',
                  data: interBoldFont,
                  style: 'normal' as const,
                  weight: 700 as const,
                },
              ]
            : []),
          ...(bebasNeueFont
            ? [
                {
                  name: 'Bebas Neue',
                  data: bebasNeueFont,
                  style: 'normal' as const,
                  weight: 400 as const,
                },
              ]
            : []),
        ]
      : undefined;

    return new ImageResponse(
      (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#F7F7F4',
            backgroundImage:
              'linear-gradient(rgba(0,0,0,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.035) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
            fontFamily: '"Inter", system-ui, sans-serif',
            padding: '18px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: '520px',
              height: '594px',
              transform: `scale(${fmt.scale})`,
              backgroundColor: '#0F0F0F',
              border: '12px solid #050505',
              borderRadius: '30px',
              padding: '0',
              gap: '0',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: '0 22px 60px rgba(0,0,0,0.22)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                height: '296px',
                backgroundColor: '#FFFFFF',
                borderRadius: '18px',
                flexShrink: 0,
                overflow: 'hidden',
                padding: variant === 'chart' ? '0' : '18px 22px',
              }}
            >
              {variant === 'chart' && chartImageDataUri ? (
                <img src={chartImageDataUri} width={CHART_W} height={CHART_H} />
              ) : market.icon_image_url ? (
                <img
                  src={market.icon_image_url}
                  width={430}
                  height={240}
                  style={{ objectFit: 'contain' }}
                />
              ) : (
                <span
                  style={{
                    color: '#000000',
                    fontSize: '150px',
                    fontWeight: 700,
                    lineHeight: 1,
                  }}
                >
                  {(market.symbol || title)[0]}
                </span>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                justifyContent: 'space-between',
                padding: '28px 30px 26px',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                  }}
                >
                  <span
                    style={{
                      color: '#FFFFFF',
                      fontSize: '32px',
                      fontWeight: 700,
                      lineHeight: 1.08,
                      letterSpacing: '-0.02em',
                      maxWidth: '330px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {title}
                  </span>
                  {category && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        backgroundColor: 'rgba(255,255,255,0.08)',
                        borderRadius: '20px',
                        padding: '7px 12px',
                        flexShrink: 0,
                      }}
                    >
                      <span
                        style={{
                          color: '#D4D4D4',
                          fontSize: '11px',
                          fontWeight: 600,
                          letterSpacing: '0.06em',
                        }}
                      >
                        {category}
                      </span>
                    </div>
                  )}
                </div>
                <span
                  style={{
                    color: '#A1A1A1',
                    fontSize: '13px',
                    fontWeight: 400,
                    lineHeight: 1.35,
                    maxWidth: '420px',
                    maxHeight: '54px',
                    overflow: 'hidden',
                  }}
                >
                  {description}
                </span>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '18px',
                    marginTop: '10px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <span
                      style={{
                        color: '#737373',
                        fontSize: '10px',
                        fontWeight: 500,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                      }}
                    >
                      Mark Price
                    </span>
                    <span style={{ color: '#FFFFFF', fontSize: '19px', fontWeight: 700 }}>
                      {formatPrice(currentPrice)}
                    </span>
                  </div>

                  {startPrice > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <span
                        style={{
                          color: '#737373',
                          fontSize: '10px',
                          fontWeight: 500,
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                        }}
                      >
                        Original Cost
                      </span>
                      <span style={{ color: '#FFFFFF', fontSize: '19px', fontWeight: 600 }}>
                        {formatPrice(startPrice)}
                      </span>
                    </div>
                  )}

                  {startPrice > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <span
                        style={{
                          color: '#737373',
                          fontSize: '10px',
                          fontWeight: 500,
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                        }}
                      >
                        PnL
                      </span>
                      <span style={{ color: pnlColor, fontSize: '19px', fontWeight: 700 }}>
                        {formatPnlPercent(pnlPercent)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <img
                    src={dexeteraLogoUrl}
                    width={30}
                    height={30}
                    style={{ opacity: 1 }}
                  />
                  <span
                    style={{
                      color: '#FFFFFF',
                      fontFamily: '"Bebas Neue", "Arial Narrow", Impact, system-ui, sans-serif',
                      fontSize: '28px',
                      fontWeight: 400,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      lineHeight: 1,
                    }}
                  >
                    DEXETERA
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ),
      {
        width: fmt.w,
        height: fmt.h,
        fonts,
        headers: {
          'Cache-Control': 'public, immutable, no-transform, max-age=300, s-maxage=600, stale-while-revalidate=86400',
        },
      }
    );
  } catch (e) {
    console.error('OG image generation error:', e);
    return new Response('Failed to generate image', { status: 500 });
  }
}
