import { NextResponse } from 'next/server';

// Live crypto prices for the marquee ticker. CoinGecko is the primary source
// (keyless); if it fails or is rate-limited and a CoinMarketCap key is present,
// we fall back to CMC. Cached at the edge for 60s so we never hammer either API.
export const revalidate = 60;

interface TickerCoin {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  url: string;
  image: string;
}

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/coins/markets' +
  '?vs_currency=usd&order=market_cap_desc&per_page=20&page=1' +
  '&price_change_percentage=24h&sparkline=false';

const CMC_URL =
  'https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest' +
  '?limit=20&convert=USD';

async function fromCoinGecko(): Promise<TickerCoin[]> {
  const res = await fetch(COINGECKO_URL, {
    headers: { accept: 'application/json' },
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`coingecko ${res.status}`);
  const data = (await res.json()) as any[];
  return (Array.isArray(data) ? data : [])
    .map((c) => ({
      symbol: String(c?.symbol || '').toUpperCase(),
      name: String(c?.name || c?.symbol || ''),
      price: Number(c?.current_price) || 0,
      change24h: Number(c?.price_change_percentage_24h) || 0,
      url: `https://www.coingecko.com/en/coins/${c?.id}`,
      image: String(c?.image || ''),
    }))
    .filter((c) => c.symbol && c.price > 0);
}

async function fromCoinMarketCap(): Promise<TickerCoin[]> {
  const key = process.env.CMC_API_KEY;
  if (!key) throw new Error('no CMC key');
  const res = await fetch(CMC_URL, {
    headers: { 'X-CMC_PRO_API_KEY': key, accept: 'application/json' },
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`cmc ${res.status}`);
  const json = (await res.json()) as any;
  const data: any[] = Array.isArray(json?.data) ? json.data : [];
  return data
    .map((c) => ({
      symbol: String(c?.symbol || '').toUpperCase(),
      name: String(c?.name || c?.symbol || ''),
      price: Number(c?.quote?.USD?.price) || 0,
      change24h: Number(c?.quote?.USD?.percent_change_24h) || 0,
      url: `https://coinmarketcap.com/currencies/${c?.slug}/`,
      image: c?.id ? `https://s2.coinmarketcap.com/static/img/coins/64x64/${c.id}.png` : '',
    }))
    .filter((c) => c.symbol && c.price > 0);
}

export async function GET(): Promise<NextResponse> {
  let coins: TickerCoin[] = [];
  let source = 'coingecko';

  try {
    coins = await fromCoinGecko();
  } catch (cgErr) {
    try {
      coins = await fromCoinMarketCap();
      source = 'coinmarketcap';
    } catch (cmcErr) {
      console.warn(
        '[crypto-ticker] both sources failed:',
        (cgErr as Error)?.message,
        '|',
        (cmcErr as Error)?.message,
      );
      // Soft-fail: let the client keep its last cached payload.
      return NextResponse.json(
        { success: false, coins: [] },
        { headers: { 'Cache-Control': 'public, s-maxage=30' } },
      );
    }
  }

  return NextResponse.json(
    { success: true, source, coins },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } },
  );
}
