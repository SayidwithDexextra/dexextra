import { MarketRef } from './stateStore';

type MarketsApiResponse = {
  success?: boolean;
  markets?: any[];
  pagination?: any;
  error?: string;
};

export async function fetchActiveMarkets(appUrl: string, limit = 200): Promise<MarketRef[]> {
  const url = new URL('/api/markets', appUrl);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('status', 'ACTIVE');
  const res = await fetch(url.toString(), { method: 'GET' });
  const bodyText = await res.text();
  if (!res.ok) throw new Error(`GET /api/markets failed: ${res.status} ${bodyText}`);
  let json: MarketsApiResponse;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`GET /api/markets returned non-JSON: ${bodyText.slice(0, 200)}`);
  }
  const rows = Array.isArray(json?.markets) ? json.markets : [];
  const out: MarketRef[] = [];
  for (const m of rows) {
    const symbol = String(m?.symbol || m?.name || '').trim();
    const orderBook = String(m?.market_address || '').trim();
    const mid = String(m?.market_id_bytes32 || '').trim();
    const chainId = Number(m?.chain_id ?? 0);
    if (!symbol) continue;
    if (!/^0x[a-fA-F0-9]{40}$/.test(orderBook)) continue;
    if (!/^0x[a-fA-F0-9]{64}$/.test(mid)) continue;
    if (!Number.isFinite(chainId) || chainId <= 0) continue;
    out.push({
      symbol,
      market_identifier: String(m?.market_identifier || '').trim() || undefined,
      market_address: orderBook,
      market_id_bytes32: mid,
      chain_id: chainId,
      tick_size: m?.tick_size != null ? Number(m.tick_size) : null,
    });
  }
  return out;
}

export function formatMarketLabel(m: MarketRef): string {
  const id = m.market_identifier ? ` (${m.market_identifier})` : '';
  const addr = `${m.market_address.slice(0, 6)}…${m.market_address.slice(-4)}`;
  return `${m.symbol}${id}  orderBook=${addr}  chain=${m.chain_id}`;
}




