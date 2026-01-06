export type SessionTradeMethod =
  | 'sessionPlaceLimit'
  | 'sessionPlaceMarginLimit'
  | 'sessionPlaceMarket'
  | 'sessionPlaceMarginMarket'
  | 'sessionModifyOrder'
  | 'sessionCancelOrder';

export type SessionTradeResponse = { txHash: string; blockNumber?: number };

export async function submitSessionTrade(params: {
  appUrl: string;
  orderBook: string;
  method: SessionTradeMethod;
  sessionId: string;
  // params are passed through to the server; use strings for uint256 to avoid JSON BigInt issues
  tradeParams: Record<string, any>;
}): Promise<SessionTradeResponse> {
  const url = new URL('/api/gasless/trade', params.appUrl);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderBook: params.orderBook,
      method: params.method,
      sessionId: params.sessionId,
      params: params.tradeParams,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST /api/gasless/trade failed: ${res.status} ${text}`);
  const json = JSON.parse(text);
  if (!json?.txHash) throw new Error(`Trade relay missing txHash: ${text}`);
  return { txHash: String(json.txHash), blockNumber: json?.blockNumber != null ? Number(json.blockNumber) : undefined };
}




