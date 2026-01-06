import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import MetaTradeFacet from '@/lib/abis/facets/MetaTradeFacet.json';
import GlobalSessionRegistry from '@/lib/abis/GlobalSessionRegistry.json';
import { sendWithNonceRetry, withRelayer } from '@/lib/relayerRouter';
import { loadRelayerPoolFromEnv } from '@/lib/relayerKeys';
import { computeRelayerProof } from '@/lib/relayerMerkle';

class HttpError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any, message?: string) {
    super(message || (body?.error ? String(body.error) : 'http_error'));
    this.status = status;
    this.body = body;
  }
}

function parseBigintish(v: any, label: string): bigint {
  try {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(Math.trunc(v));
    if (typeof v === 'string') return BigInt(v);
  } catch {
    // fallthrough
  }
  throw new HttpError(400, { error: `invalid_${label}` });
}

function safeJsonParseArray(text: string): string[] {
  try {
    const v = JSON.parse(text);
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function decodeRevertData(data: string): { kind: string; message?: string; selector?: string; args?: any } | null {
  if (!data || typeof data !== 'string' || !data.startsWith('0x') || data.length < 10) return null;
  const selector = data.slice(0, 10).toLowerCase();
  try {
    // Error(string)
    if (selector === '0x08c379a0') {
      const abi = new ethers.AbiCoder();
      const [msg] = abi.decode(['string'], ('0x' + data.slice(10)) as any);
      return { kind: 'Error(string)', message: String(msg), selector };
    }
    // Panic(uint256)
    if (selector === '0x4e487b71') {
      const abi = new ethers.AbiCoder();
      const [code] = abi.decode(['uint256'], ('0x' + data.slice(10)) as any);
      return { kind: 'Panic(uint256)', message: String(code), selector };
    }
    // OZ AccessControl v5 custom error
    const acSel = ethers.id('AccessControlUnauthorizedAccount(address,bytes32)').slice(0, 10).toLowerCase();
    if (selector === acSel) {
      const abi = new ethers.AbiCoder();
      const [account, role] = abi.decode(['address', 'bytes32'], ('0x' + data.slice(10)) as any);
      return { kind: 'AccessControlUnauthorizedAccount', selector, args: { account, role } };
    }
    // CoreVault custom errors (no args)
    const coreNoArg = [
      'InvalidImpl()',
      'LiqImplNotSet()',
      'InvalidAmount()',
      'InvalidAddress()',
      'CollateralDecimalsMustBe6()',
      'InsufficientAvailable()',
      'InsufficientBalance()',
      'MarketNotFound()',
      'AlreadyReserved()',
      'PositionNotFound()',
      'UnauthorizedOrderBook()',
    ];
    for (const sig of coreNoArg) {
      const sel = ethers.id(sig).slice(0, 10).toLowerCase();
      if (selector === sel) return { kind: 'CoreVaultError', selector, message: sig };
    }
    return { kind: 'Unknown', selector };
  } catch {
    return { kind: 'Unknown', selector };
  }
}

function extractRevertData(err: any): string | null {
  const d =
    err?.data ||
    err?.info?.error?.data ||
    err?.error?.data ||
    err?.receipt?.revertReason ||
    err?.revert?.data;
  if (typeof d === 'string' && d.startsWith('0x')) return d;
  if (typeof d === 'object' && typeof d?.data === 'string' && d.data.startsWith('0x')) return d.data;
  return null;
}

const ALLOWED: Record<string, string> = {
  metaPlaceLimit: 'metaPlaceLimit',
  metaPlaceMarginLimit: 'metaPlaceMarginLimit',
  metaPlaceMarket: 'metaPlaceMarket',
  metaPlaceMarginMarket: 'metaPlaceMarginMarket',
  metaModifyOrder: 'metaModifyOrder',
  metaCancelOrder: 'metaCancelOrder',
  // Session-based (sign-once) calls
  sessionPlaceLimit: 'sessionPlaceLimit',
  sessionPlaceMarginLimit: 'sessionPlaceMarginLimit',
  sessionPlaceMarket: 'sessionPlaceMarket',
  sessionPlaceMarginMarket: 'sessionPlaceMarginMarket',
  sessionModifyOrder: 'sessionModifyOrder',
  sessionCancelOrder: 'sessionCancelOrder',
};

function selectorFor(method: string): string | null {
  switch (method) {
    case 'metaPlaceLimit':
      return 'metaPlaceLimit((address,uint256,uint256,bool,uint256,uint256),bytes)';
    case 'metaPlaceMarginLimit':
      return 'metaPlaceMarginLimit((address,uint256,uint256,bool,uint256,uint256),bytes)';
    case 'metaPlaceMarket':
      return 'metaPlaceMarket((address,uint256,bool,uint256,uint256),bytes)';
    case 'metaPlaceMarginMarket':
      return 'metaPlaceMarginMarket((address,uint256,bool,uint256,uint256),bytes)';
    case 'metaModifyOrder':
      return 'metaModifyOrder((address,uint256,uint256,uint256,uint256,uint256),bytes)';
    case 'metaCancelOrder':
      return 'metaCancelOrder((address,uint256,uint256,uint256),bytes)';
    case 'sessionPlaceLimit':
      return 'sessionPlaceLimit(bytes32,address,uint256,uint256,bool,bytes32[])';
    case 'sessionPlaceMarginLimit':
      return 'sessionPlaceMarginLimit(bytes32,address,uint256,uint256,bool,bytes32[])';
    case 'sessionPlaceMarket':
      return 'sessionPlaceMarket(bytes32,address,uint256,bool,bytes32[])';
    case 'sessionPlaceMarginMarket':
      return 'sessionPlaceMarginMarket(bytes32,address,uint256,bool,bytes32[])';
    case 'sessionModifyOrder':
      return 'sessionModifyOrder(bytes32,address,uint256,uint256,uint256,bytes32[])';
    case 'sessionCancelOrder':
      return 'sessionCancelOrder(bytes32,address,uint256,bytes32[])';
    default:
      return null;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const orderBook: string = body?.orderBook;
    const method: string = body?.method;
    const message = body?.message;
    const signature: string = body?.signature;
    const sessionId: string | undefined = body?.sessionId;
    const params = body?.params;
    console.log('[GASLESS][API][trade] incoming', { orderBook, method });
    console.log('[UpGas][API][trade] incoming', {
      orderBook,
      method,
      isSession: Boolean(sessionId) && String(method).startsWith('session'),
      hasMessage: !!message,
      hasSignature: typeof signature === 'string',
      hasSessionId: !!sessionId
    });
    if (!orderBook || !ethers.isAddress(orderBook)) {
      return NextResponse.json({ error: 'invalid orderBook' }, { status: 400 });
    }
    if (!ALLOWED[method]) {
      return NextResponse.json({ error: 'method not allowed' }, { status: 400 });
    }
    // Legacy meta path expects message + signature
    const isSession = Boolean(sessionId) && String(method).startsWith('session');
    if (!isSession) {
      if (!message || typeof signature !== 'string') {
        return NextResponse.json({ error: 'missing payload' }, { status: 400 });
      }
    }
    const rpcUrl = process.env.RPC_URL || process.env.RPC_URL_HYPEREVM;
    const registryAddress = process.env.SESSION_REGISTRY_ADDRESS;
    console.log('[GASLESS][API][trade] env', {
      rpcUrlUsed: rpcUrl ? (rpcUrl.includes('http') ? rpcUrl : 'set') : 'unset',
      chainIdEnv: process.env.CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID || 'unset',
    });
    console.log('[UpGas][API][trade] env', {
      rpcUrlSet: !!rpcUrl,
      chainIdEnv: process.env.CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID || 'unset'
    });
    if (!rpcUrl) {
      return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
    }
    if (isSession) {
      if (!registryAddress || !ethers.isAddress(registryAddress)) {
        return NextResponse.json({ error: 'server missing SESSION_REGISTRY_ADDRESS' }, { status: 500 });
      }
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    try {
      const net = await provider.getNetwork();
      console.log('[GASLESS][API][trade] provider network', { chainId: String(net.chainId) });
      console.log('[UpGas][API][trade] provider network', { chainId: String(net.chainId) });
    } catch {}
    // Session V2: session is authorized to a relayer *set* (Merkle root) in the registry.
    // Any relayer in our configured keyset can submit, but it must pass a valid Merkle proof.

    const tradeGasLimit = (() => {
      const raw = String(process.env.GASLESS_TRADE_GAS_LIMIT || '').trim()
      if (!raw) return 1_800_000n
      try {
        const n = BigInt(raw)
        return n > 0n ? n : 1_800_000n
      } catch {
        return 1_800_000n
      }
    })()

    // Probe selector presence to avoid opaque "Function does not exist"
    try {
      const enableProbe = String(process.env.GASLESS_PROBE_SELECTORS || 'false').toLowerCase() === 'true';
      if (enableProbe) {
        const sig = selectorFor(method);
        if (sig) {
          const sel = ethers.id(sig).slice(0, 10);
          const loupe = new ethers.Contract(orderBook, ["function facetAddress(bytes4) view returns (address)"], provider);
          const facetAddr = await loupe.facetAddress(sel as any);
          console.log('[GASLESS][API][trade] selector probe', { method, signature: sig, selector: sel, facetAddr });
          console.log('[UpGas][API][trade] selector probe', { method, signature: sig, selector: sel, facetAddr });
          if (!facetAddr || facetAddr === ethers.ZeroAddress) {
            return NextResponse.json({ error: `diamond_missing_selector:${method}`, selector: sel, signature: sig }, { status: 400 });
          }
        }
      }
    } catch (_) {
      // ignore probe errors; proceed to call
    }
    // Call corresponding method (meta or session)
    const stickyKey = isSession ? (params?.trader || sessionId || '') : '';
    const tx = await withRelayer({
      pool: 'hub_trade',
      provider,
      stickyKey,
      action: async (wallet) => {
        const meta = new ethers.Contract(orderBook, (MetaTradeFacet as any).abi, wallet);
        if (isSession) {
          if (!sessionId || typeof sessionId !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(sessionId)) {
            throw new HttpError(400, { error: 'invalid_session_id' });
          }
          if (!params?.trader || !ethers.isAddress(params.trader)) {
            throw new HttpError(400, { error: 'invalid_trader' });
          }
          // Basic numeric shape checks (keep permissive; on-chain checks still apply)
          if (
            (method === 'sessionPlaceLimit' || method === 'sessionPlaceMarginLimit' || method === 'sessionModifyOrder') &&
            (params?.price === undefined || params?.price === null)
          ) {
            throw new HttpError(400, { error: 'missing_price' });
          }
          if (
            (method === 'sessionPlaceLimit' || method === 'sessionPlaceMarginLimit' || method === 'sessionPlaceMarket' || method === 'sessionPlaceMarginMarket' || method === 'sessionModifyOrder') &&
            (params?.amount === undefined || params?.amount === null)
          ) {
            throw new HttpError(400, { error: 'missing_amount' });
          }

          // Compute Merkle proof for this relayer wallet address against the configured relayer set.
          const keys = loadRelayerPoolFromEnv({
            pool: 'global',
            globalJsonEnv: 'RELAYER_PRIVATE_KEYS_JSON',
            allowFallbackSingleKey: true,
          });
          const relayerAddrs = keys.map((k) => ethers.getAddress(k.address));
          const relayerProof = computeRelayerProof(relayerAddrs, wallet.address);
          console.log('[UpGas][API][trade] session path selected', { method, sessionId, params, relayer: wallet.address, proofLen: relayerProof.length });

          // On-chain diagnostics (helps when RPC omits revert data, producing "missing revert data")
          try {
            const registry = new ethers.Contract(registryAddress!, (GlobalSessionRegistry as any).abi, provider);
            const s = await registry.sessions(sessionId);
            const traderOnchain = String(s?.trader || ethers.ZeroAddress);
            const expiryOnchain = Number(s?.expiry || 0);
            const revokedOnchain = Boolean(s?.revoked);
            const maxNotionalPerTradeOnchain = BigInt(s?.maxNotionalPerTrade ?? 0);
            const maxNotionalPerSessionOnchain = BigInt(s?.maxNotionalPerSession ?? 0);
            const sessionNotionalUsedOnchain = BigInt(s?.sessionNotionalUsed ?? 0);
            const methodsBitmapOnchain = String(s?.methodsBitmap || ethers.ZeroHash);
            const allowed = await registry.allowedOrderbook(orderBook);
            const proofOk = await registry.isRelayerAllowed(sessionId, wallet.address, relayerProof);

            const now = Math.floor(Date.now() / 1000);
            const traderMatches =
              traderOnchain &&
              traderOnchain !== ethers.ZeroAddress &&
              traderOnchain.toLowerCase() === String(params.trader).toLowerCase();

            console.log('[UpGas][API][trade] session diagnostics', {
              sessionId,
              traderOnchain,
              traderParam: params.trader,
              traderMatches,
              expiryOnchain,
              now,
              revokedOnchain,
              maxNotionalPerTrade: maxNotionalPerTradeOnchain.toString(),
              maxNotionalPerSession: maxNotionalPerSessionOnchain.toString(),
              sessionNotionalUsed: sessionNotionalUsedOnchain.toString(),
              methodsBitmap: methodsBitmapOnchain,
              allowedOrderbook: Boolean(allowed),
              relayer: wallet.address,
              proofOk: Boolean(proofOk),
              proofLen: relayerProof.length,
            });

            if (traderOnchain === ethers.ZeroAddress) {
              throw new HttpError(400, { error: 'session_unknown', sessionId });
            }
            if (!traderMatches) {
              throw new HttpError(400, { error: 'session_bad_trader', expected: traderOnchain, got: params.trader });
            }
            if (revokedOnchain) {
              throw new HttpError(400, { error: 'session_revoked', sessionId });
            }
            if (expiryOnchain > 0 && now > expiryOnchain) {
              throw new HttpError(400, { error: 'session_expired', sessionId, now, expiry: expiryOnchain });
            }
            if (!allowed) {
              throw new HttpError(400, { error: 'session_orderbook_not_allowed', orderBook, registry: registryAddress });
            }
            if (!proofOk) {
              throw new HttpError(400, { error: 'session_bad_relayer', relayer: wallet.address, proofLen: relayerProof.length });
            }

            // Session policy checks (so we can fail fast with a useful error instead of a revert-without-data)
            const methodBitIndex =
              method === 'sessionPlaceLimit'
                ? 0n
                : method === 'sessionPlaceMarginLimit'
                ? 1n
                : method === 'sessionPlaceMarket'
                ? 2n
                : method === 'sessionPlaceMarginMarket'
                ? 3n
                : method === 'sessionModifyOrder'
                ? 4n
                : method === 'sessionCancelOrder'
                ? 5n
                : null;
            if (methodBitIndex !== null) {
              const bitmap = BigInt(methodsBitmapOnchain);
              const allowedByBitmap = (bitmap & (1n << methodBitIndex)) !== 0n;
              if (!allowedByBitmap) {
                throw new HttpError(400, {
                  error: 'session_method_denied',
                  method,
                  methodBitIndex: methodBitIndex.toString(),
                  methodsBitmap: methodsBitmapOnchain,
                });
              }
            }

            // Notional caps: registry uses "notional" computed by MetaTradeFacet: amount * price / 1e18 (6 decimals)
            const notional6 =
              method === 'sessionCancelOrder'
                ? 0n
                : method === 'sessionPlaceMarket' || method === 'sessionPlaceMarginMarket'
                ? 0n // market notional depends on book ref price; registry still enforces it at execution time
                : (() => {
                    const price = parseBigintish(params?.price, 'price');
                    const amount = parseBigintish(params?.amount, 'amount');
                    return (amount * price) / 1_000_000_000_000_000_000n;
                  })();

            if (maxNotionalPerTradeOnchain > 0n && notional6 > maxNotionalPerTradeOnchain) {
              throw new HttpError(400, {
                error: 'session_trade_cap',
                notional6: notional6.toString(),
                maxNotionalPerTrade: maxNotionalPerTradeOnchain.toString(),
              });
            }
            if (maxNotionalPerSessionOnchain > 0n && sessionNotionalUsedOnchain + notional6 > maxNotionalPerSessionOnchain) {
              throw new HttpError(400, {
                error: 'session_session_cap',
                notional6: notional6.toString(),
                sessionNotionalUsed: sessionNotionalUsedOnchain.toString(),
                maxNotionalPerSession: maxNotionalPerSessionOnchain.toString(),
              });
            }
          } catch (diagErr: any) {
            if (diagErr instanceof HttpError) throw diagErr;
            console.warn('[UpGas][API][trade] session diagnostics failed', {
              method,
              error: diagErr?.reason || diagErr?.shortMessage || diagErr?.message || String(diagErr),
            });
          }

          // Orderbook/vault prechecks for margin orders (gives a useful error even when RPC omits revert data)
          if (method === 'sessionPlaceMarginLimit' || method === 'sessionPlaceMarginMarket') {
            try {
              const view = new ethers.Contract(
                orderBook,
                [
                  'function getLeverageInfo() view returns (bool enabled,uint256 maxLev,uint256 marginReq,address controller)',
                  'function marketStatic() view returns (address vault,bytes32 marketId,bool useVWAP,uint256 vwapWindow)',
                  'function bestBid() view returns (uint256)',
                  'function bestAsk() view returns (uint256)',
                  'function buyLevels(uint256 price) view returns (tuple(uint256 totalAmount,uint256 firstOrderId,uint256 lastOrderId,bool exists))',
                  'function sellLevels(uint256 price) view returns (tuple(uint256 totalAmount,uint256 firstOrderId,uint256 lastOrderId,bool exists))',
                  'function getOrder(uint256 orderId) view returns (tuple(uint256 orderId,address trader,uint256 price,uint256 amount,bool isBuy,uint256 timestamp,uint256 nextOrderId,uint256 marginRequired,bool isMarginOrder))',
                ],
                provider
              );
              const [enabled, maxLev, marginReq] = await view.getLeverageInfo();
              const [vaultAddr, marketId] = await view.marketStatic();

              const vault = new ethers.Contract(
                vaultAddr,
                [
                  'function marketSettled(bytes32 marketId) view returns (bool)',
                  'function getAvailableCollateral(address user) view returns (uint256)',
                  'function marketToOrderBook(bytes32 marketId) view returns (address)',
                  'function hasRole(bytes32 role, address account) view returns (bool)',
                  'function getPositionSummary(address user, bytes32 marketId) view returns (int256 size, uint256 entryPrice, uint256 marginLocked)',
                ],
                provider
              );

              const settled = await vault.marketSettled(marketId);
              if (settled) throw new HttpError(400, { error: 'ob_settled', marketId });

              const assignedOb = await vault.marketToOrderBook(marketId);
              if (!assignedOb || String(assignedOb) === ethers.ZeroAddress) {
                throw new HttpError(400, { error: 'vault_market_not_assigned', marketId, vault: vaultAddr });
              }
              if (String(assignedOb).toLowerCase() !== String(orderBook).toLowerCase()) {
                throw new HttpError(400, {
                  error: 'vault_market_assigned_to_other_orderbook',
                  marketId,
                  vault: vaultAddr,
                  assignedOrderBook: assignedOb,
                  requestedOrderBook: orderBook,
                });
              }

              // reserveMargin/releaseExcessMargin/unreserveMargin are protected by ORDERBOOK_ROLE in CoreVault.
              // If this isn't granted to the orderbook diamond, margin orders will revert with an AccessControl error.
              const ORDERBOOK_ROLE = ethers.id('ORDERBOOK_ROLE');
              const hasOrderbookRole = await vault.hasRole(ORDERBOOK_ROLE, orderBook);
              if (!hasOrderbookRole) {
                throw new HttpError(400, {
                  error: 'vault_orderbook_role_missing',
                  vault: vaultAddr,
                  orderBook,
                  role: ORDERBOOK_ROLE,
                });
              }

              if (!(Boolean(enabled) || BigInt(marginReq) === 10000n)) {
                throw new HttpError(400, {
                  error: 'margin_not_enabled',
                  leverageEnabled: Boolean(enabled),
                  marginRequirementBps: marginReq?.toString?.() ?? String(marginReq),
                  maxLev: maxLev?.toString?.() ?? String(maxLev),
                });
              }

              const price = parseBigintish(params?.price, 'price');
              const amount = parseBigintish(params?.amount, 'amount');
              if (price <= 0n) throw new HttpError(400, { error: 'price_must_be_gt_0' });
              if (amount <= 0n) throw new HttpError(400, { error: 'amount_must_be_gt_0' });

              const isBuy = Boolean(params?.isBuy);

              // If this margin LIMIT order would immediately cross, ensure the top-of-book opposite order is also margin.
              // Otherwise OBTradeExecutionFacet will revert: "OrderBook: cannot mix margin and spot trades".
              try {
                const bestBid = BigInt(await view.bestBid());
                const bestAsk = BigInt(await view.bestAsk());
                const crosses = isBuy ? (bestAsk > 0n && bestAsk <= price) : (bestBid > 0n && bestBid >= price);
                console.log('[UpGas][API][trade] crossing check', {
                  isBuy,
                  limitPrice: price.toString(),
                  bestBid: bestBid.toString(),
                  bestAsk: bestAsk.toString(),
                  crosses,
                });
                if (!isBuy && bestBid > 0n && bestBid >= price) {
                  const lvl: any = await view.buyLevels(bestBid);
                  const firstId = BigInt(lvl?.firstOrderId ?? 0);
                  if (firstId > 0n) {
                    const top: any = await view.getOrder(firstId);
                    const topIsMargin = Boolean(top?.isMarginOrder);
                    if (!topIsMargin) {
                      throw new HttpError(400, {
                        error: 'crosses_spot_liquidity',
                        side: 'sell',
                        limitPrice: price.toString(),
                        bestBid: bestBid.toString(),
                        topOrderId: firstId.toString(),
                        topOrderIsMargin: false,
                      });
                    }
                  }
                }
                if (isBuy && bestAsk > 0n && bestAsk <= price) {
                  const lvl: any = await view.sellLevels(bestAsk);
                  const firstId = BigInt(lvl?.firstOrderId ?? 0);
                  if (firstId > 0n) {
                    const top: any = await view.getOrder(firstId);
                    const topIsMargin = Boolean(top?.isMarginOrder);
                    if (!topIsMargin) {
                      throw new HttpError(400, {
                        error: 'crosses_spot_liquidity',
                        side: 'buy',
                        limitPrice: price.toString(),
                        bestAsk: bestAsk.toString(),
                        topOrderId: firstId.toString(),
                        topOrderIsMargin: false,
                      });
                    }
                  }
                }

                // If we are crossing and the trader is closing an existing position at a loss,
                // OBTradeExecutionFacet can revert with "OrderBook: closing loss exceeds position margin".
                // We approximate the first execution price as bestBid/bestAsk and precheck that invariant.
                if (crosses) {
                  const [posSize, entryPriceRaw] = await vault.getPositionSummary(params.trader, marketId);
                  const currentNet = BigInt(posSize as any);
                  const entryPricePos = BigInt(entryPriceRaw as any);
                  const closing =
                    (currentNet > 0n && !isBuy) || // long closing via sell
                    (currentNet < 0n && isBuy);    // short closing via buy
                  if (closing && entryPricePos > 0n) {
                    const absDelta = amount >= 0n ? amount : -amount;
                    const posAbs = currentNet >= 0n ? currentNet : -currentNet;
                    const closeAbs = absDelta > posAbs ? posAbs : absDelta;
                    if (closeAbs > 0n) {
                      const execPrice = isBuy ? bestAsk : bestBid;
                      if (execPrice > 0n) {
                        // tradingLossClosed6 = closeAbs * (entry - exec) / 1e18 (for long) or (exec - entry) for short
                        let loss6 = 0n;
                        if (currentNet > 0n) {
                          if (execPrice < entryPricePos) loss6 = (closeAbs * (entryPricePos - execPrice)) / 1_000_000_000_000_000_000n;
                        } else {
                          if (execPrice > entryPricePos) loss6 = (closeAbs * (execPrice - entryPricePos)) / 1_000_000_000_000_000_000n;
                        }
                        if (loss6 > 0n) {
                          const marginBpsClose = currentNet > 0n ? BigInt(marginReq) : 15000n;
                          const notionalEntry6 = (closeAbs * entryPricePos) / 1_000_000_000_000_000_000n;
                          const released6 = (notionalEntry6 * marginBpsClose) / 10000n;
                          console.log('[UpGas][API][trade] closing-loss precheck', {
                            trader: params.trader,
                            currentNet: currentNet.toString(),
                            entryPrice: entryPricePos.toString(),
                            execPrice: execPrice.toString(),
                            closeAbs: closeAbs.toString(),
                            loss6: loss6.toString(),
                            released6: released6.toString(),
                            marginBpsClose: marginBpsClose.toString(),
                          });
                          if (loss6 > released6) {
                            throw new HttpError(400, {
                              error: 'closing_loss_exceeds_position_margin',
                              loss6: loss6.toString(),
                              released6: released6.toString(),
                              entryPrice: entryPricePos.toString(),
                              execPrice: execPrice.toString(),
                              closeAbs: closeAbs.toString(),
                              currentNet: currentNet.toString(),
                            });
                          }
                        }
                      }
                    }
                  }
                }
              } catch (crossErr: any) {
                if (crossErr instanceof HttpError) throw crossErr;
              }

              const adjustedAmount = amount < 1_000_000_000_000n ? 1_000_000_000_000n : amount; // 1e12
              const notional6 = (adjustedAmount * price) / 1_000_000_000_000_000_000n; // / 1e18
              const marginBps = isBuy ? BigInt(marginReq) : 15000n;
              const marginRequired6 = (notional6 * marginBps) / 10000n;
              const available6 = BigInt(await vault.getAvailableCollateral(params.trader));

              console.log('[UpGas][API][trade] margin precheck', {
                trader: params.trader,
                isBuy,
                price: price.toString(),
                amount: amount.toString(),
                notional6: notional6.toString(),
                marginBps: marginBps.toString(),
                marginRequired6: marginRequired6.toString(),
                available6: available6.toString(),
                vault: vaultAddr,
                marketId,
                assignedOrderBook: String(assignedOb),
                hasOrderbookRole,
              });

              if (available6 < marginRequired6) {
                throw new HttpError(400, {
                  error: 'insufficient_collateral',
                  available6: available6.toString(),
                  required6: marginRequired6.toString(),
                  notional6: notional6.toString(),
                  marginBps: marginBps.toString(),
                });
              }
            } catch (preErr: any) {
              if (preErr instanceof HttpError) throw preErr;
              console.warn('[UpGas][API][trade] margin precheck failed (non-fatal)', {
                method,
                error: preErr?.reason || preErr?.shortMessage || preErr?.message || String(preErr),
              });
            }
          }

          // Preflight eth_call to get a readable revert when available (some RPCs omit revert data on estimateGas)
          try {
            const fn = (meta as any)[method]
            if (typeof fn === 'function') {
              await fn.staticCall?.(
                ...(method === 'sessionPlaceLimit'
                  ? [sessionId, params?.trader, params?.price, params?.amount, params?.isBuy, relayerProof]
                  : method === 'sessionPlaceMarginLimit'
                  ? [sessionId, params?.trader, params?.price, params?.amount, params?.isBuy, relayerProof]
                  : method === 'sessionPlaceMarket'
                  ? [sessionId, params?.trader, params?.amount, params?.isBuy, relayerProof]
                  : method === 'sessionPlaceMarginMarket'
                  ? [sessionId, params?.trader, params?.amount, params?.isBuy, relayerProof]
                  : method === 'sessionModifyOrder'
                  ? [sessionId, params?.trader, params?.orderId, params?.price, params?.amount, relayerProof]
                  : method === 'sessionCancelOrder'
                  ? [sessionId, params?.trader, params?.orderId, relayerProof]
                  : [])
              )
            }
          } catch (pre: any) {
            const data = extractRevertData(pre);
            const decoded = data ? decodeRevertData(data) : null;
            // Log but do not fail the session path; some RPCs omit revert data on static calls
            console.warn('[UpGas][API][trade] session preflight failed', {
              method,
              error: pre?.reason || pre?.shortMessage || pre?.message || String(pre),
              code: pre?.code,
              hasData: Boolean(data),
              dataSelector: decoded?.selector,
              decoded: decoded?.message || decoded?.kind,
              rpcMsg: pre?.info?.error?.message,
            });
          }
          switch (method) {
            case 'sessionPlaceLimit':
              return await sendWithNonceRetry({
                provider,
                wallet,
                contract: meta,
                method: 'sessionPlaceLimit',
                args: [sessionId, params?.trader, params?.price, params?.amount, params?.isBuy, relayerProof],
                label: `trade:${method}`,
                overrides: { gasLimit: tradeGasLimit },
              });
            case 'sessionPlaceMarginLimit':
              return await sendWithNonceRetry({
                provider,
                wallet,
                contract: meta,
                method: 'sessionPlaceMarginLimit',
                args: [sessionId, params?.trader, params?.price, params?.amount, params?.isBuy, relayerProof],
                label: `trade:${method}`,
                overrides: { gasLimit: tradeGasLimit },
              });
            case 'sessionPlaceMarket':
              return await sendWithNonceRetry({
                provider,
                wallet,
                contract: meta,
                method: 'sessionPlaceMarket',
                args: [sessionId, params?.trader, params?.amount, params?.isBuy, relayerProof],
                label: `trade:${method}`,
                overrides: { gasLimit: tradeGasLimit },
              });
            case 'sessionPlaceMarginMarket':
              return await sendWithNonceRetry({
                provider,
                wallet,
                contract: meta,
                method: 'sessionPlaceMarginMarket',
                args: [sessionId, params?.trader, params?.amount, params?.isBuy, relayerProof],
                label: `trade:${method}`,
                overrides: { gasLimit: tradeGasLimit },
              });
            case 'sessionModifyOrder':
              return await sendWithNonceRetry({
                provider,
                wallet,
                contract: meta,
                method: 'sessionModifyOrder',
                args: [sessionId, params?.trader, params?.orderId, params?.price, params?.amount, relayerProof],
                label: `trade:${method}`,
                overrides: { gasLimit: tradeGasLimit },
              });
            case 'sessionCancelOrder':
              return await sendWithNonceRetry({
                provider,
                wallet,
                contract: meta,
                method: 'sessionCancelOrder',
                args: [sessionId, params?.trader, params?.orderId, relayerProof],
                label: `trade:${method}`,
                overrides: { gasLimit: tradeGasLimit },
              });
            default:
              throw new Error('method not allowed');
          }
        }

        console.log('[UpGas][API][trade] legacy meta path selected', { method, hasMessage: !!message, hasSignature: typeof signature === 'string' });
        switch (method) {
          case 'metaPlaceLimit':
            return await sendWithNonceRetry({ provider, wallet, contract: meta, method: 'metaPlaceLimit', args: [message, signature], label: `trade:${method}`, overrides: { gasLimit: tradeGasLimit } });
          case 'metaPlaceMarginLimit':
            return await sendWithNonceRetry({ provider, wallet, contract: meta, method: 'metaPlaceMarginLimit', args: [message, signature], label: `trade:${method}`, overrides: { gasLimit: tradeGasLimit } });
          case 'metaPlaceMarket':
            return await sendWithNonceRetry({ provider, wallet, contract: meta, method: 'metaPlaceMarket', args: [message, signature], label: `trade:${method}`, overrides: { gasLimit: tradeGasLimit } });
          case 'metaPlaceMarginMarket':
            return await sendWithNonceRetry({ provider, wallet, contract: meta, method: 'metaPlaceMarginMarket', args: [message, signature], label: `trade:${method}`, overrides: { gasLimit: tradeGasLimit } });
          case 'metaModifyOrder':
            return await sendWithNonceRetry({ provider, wallet, contract: meta, method: 'metaModifyOrder', args: [message, signature], label: `trade:${method}`, overrides: { gasLimit: tradeGasLimit } });
          case 'metaCancelOrder':
            return await sendWithNonceRetry({ provider, wallet, contract: meta, method: 'metaCancelOrder', args: [message, signature], label: `trade:${method}`, overrides: { gasLimit: tradeGasLimit } });
          default:
            throw new Error('method not allowed');
        }
      }
    });
    // Configurable wait policy to reduce perceived latency
    const waitConfirms = Number(process.env.GASLESS_TRADE_WAIT_CONFIRMS ?? '0');
    if (Number.isFinite(waitConfirms) && waitConfirms > 0) {
      const rc = await provider.waitForTransaction(tx.hash, waitConfirms);
      const status = (rc as any)?.status;
      console.log('[GASLESS][API][trade] relayed', { txHash: tx.hash, blockNumber: rc?.blockNumber, status });
      console.log('[UpGas][API][trade] relayed', { txHash: tx.hash, blockNumber: rc?.blockNumber, status });
      if (typeof status === 'number' && status === 0) {
        return NextResponse.json(
          { error: 'tx_reverted', txHash: tx.hash, blockNumber: rc?.blockNumber },
          { status: 500 }
        );
      }
      return NextResponse.json({ txHash: tx.hash, blockNumber: rc?.blockNumber });
    }

    // Optional short polling window for fast revert detection without waiting for confirmations.
    // Useful when RPC preflights omit revert data (e.g. "missing revert data") but we still want quick feedback.
    const pollMsRaw = String(process.env.GASLESS_TRADE_POLL_RECEIPT_MS ?? '').trim();
    const pollMs = pollMsRaw ? Number(pollMsRaw) : 0;
    if (Number.isFinite(pollMs) && pollMs > 0) {
      const deadline = Date.now() + pollMs;
      let lastRc: any = null;
      while (Date.now() < deadline) {
        try {
          const rc = await provider.getTransactionReceipt(tx.hash);
          if (rc) {
            lastRc = rc as any;
            break;
          }
        } catch {
          // ignore transient receipt fetch errors
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (lastRc) {
        const status = (lastRc as any)?.status;
        console.log('[UpGas][API][trade] polled receipt', { txHash: tx.hash, blockNumber: lastRc?.blockNumber, status });
        if (typeof status === 'number' && status === 0) {
          return NextResponse.json(
            { error: 'tx_reverted', txHash: tx.hash, blockNumber: lastRc?.blockNumber },
            { status: 500 }
          );
        }
        return NextResponse.json({ txHash: tx.hash, blockNumber: lastRc?.blockNumber });
      }
    }
    console.log('[GASLESS][API][trade] broadcasted', { txHash: tx.hash, waitConfirms });
    console.log('[UpGas][API][trade] broadcasted', { txHash: tx.hash, waitConfirms });
    return NextResponse.json({ txHash: tx.hash });
  } catch (e: any) {
    if (e instanceof HttpError) {
      return NextResponse.json(e.body, { status: e.status });
    }
    console.error('[GASLESS][API][trade] error', e?.message || e);
    console.error('[UpGas][API][trade] error', e?.stack || e?.message || String(e));
    return NextResponse.json({ error: e?.message || 'relay failed' }, { status: 500 });
  }
}


