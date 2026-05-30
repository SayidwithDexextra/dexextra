import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'edge';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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

function formatVolume(volume: number): string {
  if (volume >= 1_000_000) {
    return `$${(volume / 1_000_000).toFixed(1)}M`;
  }
  if (volume >= 1_000) {
    return `$${(volume / 1_000).toFixed(1)}K`;
  }
  return `$${volume.toFixed(0)}`;
}

function formatSettlementDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return 'TBD';
  }
}

function getDaysUntil(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffTime = date.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return 'Settled';
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return '1 day';
    return `${diffDays} days`;
  } catch {
    return '';
  }
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
      .select('*')
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
              backgroundColor: '#0F0F0F',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            <div style={{ color: '#9CA3AF', fontSize: 32 }}>
              Market not found
            </div>
          </div>
        ),
        { width: 1200, height: 630 }
      );
    }

    const price = (market.mark_price ?? market.last_trade_price ?? 0) / 1_000_000;
    const priceFormatted = formatPrice(price);
    const volume = market.total_volume ? formatVolume(Number(market.total_volume)) : null;
    const settlementDate = market.settlement_date ? formatSettlementDate(market.settlement_date) : 'TBD';
    const daysUntil = market.settlement_date ? getDaysUntil(market.settlement_date) : '';
    
    // category can be string or array
    const categoryRaw = market.category;
    const category = Array.isArray(categoryRaw) 
      ? (categoryRaw[0] || '').toUpperCase()
      : (typeof categoryRaw === 'string' ? categoryRaw.toUpperCase() : '');

    return new ImageResponse(
      (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#0A0A0A',
            fontFamily: 'system-ui, sans-serif',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Background gradient accent */}
          <div
            style={{
              position: 'absolute',
              top: '-200px',
              right: '-200px',
              width: '600px',
              height: '600px',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(0,212,255,0.15) 0%, rgba(0,212,255,0.05) 40%, transparent 70%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: '-100px',
              left: '-100px',
              width: '400px',
              height: '400px',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(0,212,255,0.08) 0%, transparent 60%)',
            }}
          />

          {/* Content container */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              padding: '56px',
              height: '100%',
              position: 'relative',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '48px',
              }}
            >
              {/* Logo */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    background: 'linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 4px 24px rgba(0,212,255,0.3)',
                  }}
                >
                  <span style={{ color: '#0A0A0A', fontWeight: 800, fontSize: '24px' }}>D</span>
                </div>
                <span
                  style={{
                    color: 'white',
                    fontSize: '20px',
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                  }}
                >
                  DEXETERA
                </span>
              </div>
              
              {/* Category badge */}
              {category && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    backgroundColor: 'rgba(0,212,255,0.1)',
                    border: '1px solid rgba(0,212,255,0.2)',
                    borderRadius: '20px',
                    padding: '8px 16px',
                  }}
                >
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: '#00D4FF',
                    }}
                  />
                  <span style={{ color: '#00D4FF', fontSize: '14px', fontWeight: 600, letterSpacing: '0.05em' }}>
                    {category}
                  </span>
                </div>
              )}
            </div>

            {/* Main content */}
            <div style={{ display: 'flex', flex: 1, gap: '48px' }}>
              {/* Left side - Market info */}
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                {/* Icon and name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginBottom: '32px' }}>
                  <div
                    style={{
                      width: '80px',
                      height: '80px',
                      backgroundColor: '#1A1A1A',
                      borderRadius: '16px',
                      border: '1px solid #2A2A2A',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {market.icon_image_url ? (
                      <img
                        src={market.icon_image_url}
                        width={60}
                        height={60}
                        style={{ borderRadius: '12px', objectFit: 'cover' }}
                      />
                    ) : (
                      <span style={{ color: '#00D4FF', fontSize: '36px', fontWeight: 700 }}>
                        {(market.symbol || 'M')[0]}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span
                      style={{
                        color: 'white',
                        fontSize: '42px',
                        fontWeight: 700,
                        lineHeight: 1.1,
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {market.name || market.symbol}
                    </span>
                    <span style={{ color: '#606060', fontSize: '18px', fontWeight: 500 }}>
                      {market.symbol}
                    </span>
                  </div>
                </div>

                {/* Price display */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '40px' }}>
                  <span style={{ color: '#808080', fontSize: '14px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    Mark Price
                  </span>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                    <span
                      style={{
                        color: 'white',
                        fontSize: '72px',
                        fontWeight: 700,
                        fontFamily: 'system-ui, sans-serif',
                        letterSpacing: '-0.03em',
                        lineHeight: 1,
                      }}
                    >
                      {priceFormatted}
                    </span>
                  </div>
                </div>

                {/* Stats row */}
                <div style={{ display: 'flex', gap: '48px' }}>
                  {volume && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ color: '#606060', fontSize: '12px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        Volume
                      </span>
                      <span style={{ color: 'white', fontSize: '24px', fontWeight: 600 }}>
                        {volume}
                      </span>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ color: '#606060', fontSize: '12px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                      Settlement
                    </span>
                    <span style={{ color: 'white', fontSize: '24px', fontWeight: 600 }}>
                      {settlementDate}
                    </span>
                  </div>
                  {daysUntil && daysUntil !== 'Settled' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ color: '#606060', fontSize: '12px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        Remaining
                      </span>
                      <span style={{ color: '#00D4FF', fontSize: '24px', fontWeight: 600 }}>
                        {daysUntil}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: '24px',
                borderTop: '1px solid #1A1A1A',
              }}
            >
              <span style={{ color: '#606060', fontSize: '16px' }}>
                Trade any metric. No permission needed.
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: '#00D4FF',
                  }}
                />
                <span style={{ color: '#808080', fontSize: '16px', fontWeight: 500 }}>
                  dexetera.org
                </span>
              </div>
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    );
  } catch (e) {
    console.error('OG image generation error:', e);
    return new Response('Failed to generate image', { status: 500 });
  }
}
