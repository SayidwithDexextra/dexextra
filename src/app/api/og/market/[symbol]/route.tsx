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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;

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
                padding: '18px 22px',
              }}
            >
              {market.icon_image_url ? (
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
        width: 1200,
        height: 630,
        fonts,
      }
    );
  } catch (e) {
    console.error('OG image generation error:', e);
    return new Response('Failed to generate image', { status: 500 });
  }
}
