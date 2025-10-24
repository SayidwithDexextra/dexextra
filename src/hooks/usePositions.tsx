import { useState, useEffect } from 'react';
import { useWallet } from './useWallet';
import { initializeContracts } from '@/lib/contracts';
import { formatUnits } from 'viem';
import { ethers } from 'ethers';
import { ensureHyperliquidWallet, getReadProvider } from '@/lib/network';
import type { Address } from 'viem';

interface Position {
  id: string;
  marketId: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  markPrice: number;
  pnl: number;
  pnlPercent: number;
  liquidationPrice: number;
  margin: number;
  leverage: number;
  timestamp: number;
  isUnderLiquidation?: boolean;
}

interface PositionState {
  positions: Position[];
  isLoading: boolean;
  error: string | null;
}

// Normalize a Position struct (named fields or tuple array) like the script
function normalizePositionStruct(positionLike: any) {
  if (!positionLike) return null;
  const p = positionLike as any;
  const isTuple = Array.isArray(p);
  const marketId = p?.marketId !== undefined ? p.marketId : (isTuple ? p[0] : undefined);
  const size = p?.size !== undefined ? p.size : (isTuple ? p[1] : undefined);
  const entryPrice = p?.entryPrice !== undefined ? p.entryPrice : (isTuple ? p[2] : undefined);
  const marginLocked = p?.marginLocked !== undefined ? p.marginLocked : (isTuple ? p[3] : undefined);
  const socializedLossAccrued6 = p?.socializedLossAccrued6 !== undefined ? p.socializedLossAccrued6 : (isTuple && p.length > 4 ? p[4] : undefined);
  const haircutUnits18 = p?.haircutUnits18 !== undefined ? p.haircutUnits18 : (isTuple && p.length > 5 ? p[5] : undefined);
  const liquidationPrice = p?.liquidationPrice !== undefined ? p.liquidationPrice : (isTuple && p.length > 6 ? p[6] : undefined);
  if (marketId === undefined || size === undefined || entryPrice === undefined) return null;
  return {
    marketId,
    size,
    entryPrice,
    marginLocked,
    socializedLossAccrued6,
    haircutUnits18,
    liquidationPrice,
  };
}

export function usePositions(marketSymbol?: string): PositionState {
  const wallet = useWallet() as any;
  const walletAddress: string | null = wallet?.walletData?.address ?? wallet?.address ?? null;
  const walletSigner = wallet?.walletData?.signer ?? wallet?.signer ?? null;
  const walletIsConnected: boolean = !!(wallet?.walletData?.isConnected ?? wallet?.isConnected);
  const [contracts, setContracts] = useState<any>(null);
  const [state, setState] = useState<PositionState>({
    positions: [],
    isLoading: true,
    error: null
  });

  // Initialize contracts when wallet is connected
  useEffect(() => {
    const init = async () => {
      try {
        let runner: ethers.Signer | ethers.Provider | undefined = undefined;
        if (walletSigner) {
          runner = walletSigner as ethers.Signer;
        } else if (typeof window !== 'undefined' && (window as any).ethereum) {
          try {
            runner = await ensureHyperliquidWallet();
          } catch (e) {
            runner = getReadProvider();
          }
        }
        if (!runner) {
          setState(prev => ({ ...prev, error: 'Wallet/provider not available', isLoading: false }));
          return;
        }
        const contractInstances = await initializeContracts({ providerOrSigner: runner });
        setContracts(contractInstances);
      } catch (error: any) {
        console.error('Failed to initialize contracts:', error);
        setState(prev => ({ ...prev, error: 'Failed to initialize contracts', isLoading: false }));
      }
    };

    if (walletIsConnected) {
      init();
    } else {
      setState(prev => ({ ...prev, isLoading: false, error: 'Wallet not connected' }));
    }
  }, [walletIsConnected, walletSigner]);

  // Fetch positions data
  useEffect(() => {
    if (!contracts || !walletAddress) {
      setState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    const fetchPositions = async () => {
      try {
        setState(prev => ({ ...prev, isLoading: true }));
        const positionsData = await contracts.vault.getUserPositions(walletAddress);
        try { console.log('[usePositions] raw positions count:', Array.isArray(positionsData) ? positionsData.length : positionsData); } catch {}
        const processedPositions: Position[] = [];

        for (const raw of positionsData) {
          try {
            const pos = normalizePositionStruct(raw);
            if (!pos) continue;

            const marketId = pos.marketId;
            const symbol = marketSymbol ? marketSymbol.toUpperCase() : 'UNKNOWN';

            // Signed size in 18 decimals
            const positionSizeBig = (() => {
              try { return ethers.toBigInt(pos.size ?? 0); } catch { return 0n; }
            })();
            const absSizeBig = positionSizeBig >= 0n ? positionSizeBig : -positionSizeBig;
            const displaySize = parseFloat(ethers.formatUnits(absSizeBig, 18));
            const side = positionSizeBig >= 0n ? 'LONG' : 'SHORT';

            // Entry price as BigInt (6 decimals) and display number
            const entryPriceBig = (() => {
              try { return ethers.toBigInt(pos.entryPrice ?? 0); } catch { return 0n; }
            })();
            const entryPrice = parseFloat(ethers.formatUnits(entryPriceBig, 6));

            // Margin locked (6 decimals)
            const marginLockedBig = (() => {
              try { return ethers.toBigInt(pos.marginLocked ?? 0); } catch { return 0n; }
            })();
            const margin = parseFloat(ethers.formatUnits(marginLockedBig, 6));

            // Fetch mark price (6 decimals) and compute P&L using BigInt math
            let markPrice = entryPrice;
            let pnl = 0;
            let pnlPercent = 0;
            let liquidationPrice = 0;
            let isUnderLiquidation = false;

            try {
              let markPriceBigInt: bigint = 0n;
              try {
                if (contracts?.obPricing?.calculateMarkPrice) {
                  markPriceBigInt = await contracts.obPricing.calculateMarkPrice();
                } else if (contracts?.obPricing?.getMarketPriceData) {
                  const mp = await contracts.obPricing.getMarketPriceData();
                  markPriceBigInt = (mp?.markPrice ?? (Array.isArray(mp) ? mp[0] : 0n)) as bigint;
                }
              } catch (_) {
                markPriceBigInt = 0n;
              }

              if (markPriceBigInt > 0n) {
                markPrice = parseFloat(ethers.formatUnits(markPriceBigInt, 6));

                const priceDiffBig = markPriceBigInt - entryPriceBig; // 6 decimals
                const pnlBig = (priceDiffBig * positionSizeBig) / 1000000n; // -> 18 decimals
                pnl = parseFloat(ethers.formatUnits(pnlBig, 18));

                const notionalBig = (entryPriceBig * absSizeBig) / 1000000n; // 18 decimals
                const notional = parseFloat(ethers.formatUnits(notionalBig, 18));
                pnlPercent = notional > 0 ? (pnl / notional) * 100 : 0;

                pnl = parseFloat(pnl.toFixed(2));
                pnlPercent = parseFloat(pnlPercent.toFixed(2));
              }

              // Liquidation price (6 decimals) from vault view
              try {
                const [liqPrice, hasPos] = await contracts.vault.getLiquidationPrice(walletAddress, marketId);
                if (hasPos) {
                  let liqBn: bigint = 0n;
                  try { liqBn = ethers.toBigInt(liqPrice); } catch { liqBn = 0n; }
                  liquidationPrice = liqBn > 0n ? parseFloat(ethers.formatUnits(liqBn, 6)) : 0;
                }
              } catch (e) {
                // ignore
              }

              // Check if position is currently under liquidation
              try {
                if (contracts?.vault?.isUnderLiquidationPosition) {
                  isUnderLiquidation = await contracts.vault.isUnderLiquidationPosition(walletAddress, marketId);
                }
              } catch (_) {
                isUnderLiquidation = false;
              }
            } catch (e) {
              // ignore
            }

            processedPositions.push({
              id: String(marketId),
              marketId: String(marketId),
              symbol,
              side,
              size: displaySize,
              entryPrice,
              markPrice,
              pnl,
              pnlPercent,
              liquidationPrice,
              margin,
              leverage: 1,
              timestamp: Date.now(),
              isUnderLiquidation
            });
          } catch (e) {
            console.error('Error processing position', e);
          }
        }

        try { console.log('[usePositions] processedPositions:', processedPositions); } catch {}
        setState({
          positions: processedPositions,
          isLoading: false,
          error: processedPositions.length === 0 ? 'No open positions found' : null
        });
      } catch (error: any) {
        console.error('Failed to fetch positions:', error);
        setState(prev => ({ ...prev, error: 'Failed to fetch positions', isLoading: false }));
      }
    };

    fetchPositions();

    const interval = setInterval(fetchPositions, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [contracts, walletAddress, marketSymbol]);

  return state;
}
