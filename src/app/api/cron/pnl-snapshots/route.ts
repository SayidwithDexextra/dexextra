import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import { getClickHouseDataPipeline } from '@/lib/clickhouse-client';
import { CoreVaultABI } from '@/lib/contracts';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface VaultMarginSummary {
  realizedPnL: bigint;
  unrealizedPnL: bigint;
  totalPositionValue: bigint;
  availableMargin: bigint;
  totalMargin: bigint;
  marginHealth: bigint;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function getRpcProvider(): ethers.JsonRpcProvider | null {
  const rpc = process.env.RPC_URL || process.env.JSON_RPC_URL;
  if (!rpc) return null;
  return new ethers.JsonRpcProvider(rpc);
}

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  const startTime = Date.now();
  const snapshotDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  
  console.log(`[pnl-snapshots] Starting daily snapshot for ${snapshotDate}`);

  // Verify cron secret for security
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.error('[pnl-snapshots] Invalid authorization');
    return json(401, { error: 'Unauthorized' });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return json(500, { error: 'Supabase not configured' });
  }

  const provider = getRpcProvider();
  if (!provider) {
    return json(500, { error: 'RPC provider not configured' });
  }

  const coreVaultAddress = process.env.NEXT_PUBLIC_CORE_VAULT_ADDRESS || process.env.CORE_VAULT_ADDRESS;
  if (!coreVaultAddress) {
    return json(500, { error: 'Core vault address not configured' });
  }

  try {
    // Step 1: Get all unique wallet addresses from trading_fees
    console.log('[pnl-snapshots] Fetching unique wallet addresses...');
    
    const { data: wallets, error: walletsError } = await supabase
      .from('trading_fees')
      .select('user_address')
      .not('user_address', 'is', null);

    if (walletsError) {
      console.error('[pnl-snapshots] Error fetching wallets:', walletsError);
      return json(500, { error: 'Failed to fetch wallets', details: walletsError.message });
    }

    const uniqueWallets = [...new Set(
      (wallets || []).map(w => w.user_address?.toLowerCase()).filter(Boolean)
    )];

    console.log(`[pnl-snapshots] Found ${uniqueWallets.length} unique wallets`);

    if (uniqueWallets.length === 0) {
      return json(200, { 
        success: true, 
        snapshotDate,
        walletsProcessed: 0,
        message: 'No wallets found' 
      });
    }

    // Step 2: Create CoreVault contract instance
    const coreVault = new ethers.Contract(coreVaultAddress, CoreVaultABI, provider);

    // Step 3: Process each wallet and get their margin summary
    const clickhouse = getClickHouseDataPipeline();
    const snapshots: Array<{
      walletAddress: string;
      snapshotDate: string;
      realizedPnl: number;
      unrealizedPnl: number;
      totalFees: number;
      tradeCount: number;
      totalVolume: number;
      buyCount: number;
      sellCount: number;
    }> = [];

    const errors: string[] = [];
    const BATCH_SIZE = 20; // Process in batches to avoid rate limiting

    for (let i = 0; i < uniqueWallets.length; i += BATCH_SIZE) {
      const batch = uniqueWallets.slice(i, i + BATCH_SIZE);
      
      await Promise.all(batch.map(async (wallet) => {
        try {
          // Get margin summary from contract
          let marginSummary: VaultMarginSummary | null = null;
          try {
            const result = await coreVault.getUserMarginSummary(wallet);
            marginSummary = {
              realizedPnL: result.realizedPnL || result[0] || 0n,
              unrealizedPnL: result.unrealizedPnL || result[1] || 0n,
              totalPositionValue: result.totalPositionValue || result[2] || 0n,
              availableMargin: result.availableMargin || result[3] || 0n,
              totalMargin: result.totalMargin || result[4] || 0n,
              marginHealth: result.marginHealth || result[5] || 0n,
            };
          } catch (e: any) {
            // User may not have any positions
            console.log(`[pnl-snapshots] No margin data for ${wallet}: ${e?.message}`);
          }

          // Get trading stats from Supabase
          const { data: feeStats, error: feeError } = await supabase
            .from('trading_fees')
            .select('fee_amount_usdc, trade_notional, fee_role')
            .ilike('user_address', wallet);

          if (feeError) {
            console.error(`[pnl-snapshots] Error fetching fees for ${wallet}:`, feeError);
            errors.push(`${wallet}: ${feeError.message}`);
            return;
          }

          const totalFees = (feeStats || []).reduce((sum, f) => sum + (Number(f.fee_amount_usdc) || 0), 0);
          const totalVolume = (feeStats || []).reduce((sum, f) => sum + (Number(f.trade_notional) || 0), 0);
          const tradeCount = feeStats?.length || 0;
          const buyCount = (feeStats || []).filter(f => f.fee_role === 'taker').length;
          const sellCount = tradeCount - buyCount;

          // Format P&L values (6 decimals for USDC)
          const realizedPnl = marginSummary 
            ? Number(ethers.formatUnits(marginSummary.realizedPnL, 6))
            : 0;
          const unrealizedPnl = marginSummary
            ? Number(ethers.formatUnits(marginSummary.unrealizedPnL, 6))
            : 0;

          snapshots.push({
            walletAddress: wallet,
            snapshotDate,
            realizedPnl,
            unrealizedPnl,
            totalFees,
            tradeCount,
            totalVolume,
            buyCount,
            sellCount,
          });

        } catch (e: any) {
          console.error(`[pnl-snapshots] Error processing ${wallet}:`, e?.message);
          errors.push(`${wallet}: ${e?.message || 'Unknown error'}`);
        }
      }));

      // Small delay between batches
      if (i + BATCH_SIZE < uniqueWallets.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // Step 4: Insert all snapshots into ClickHouse
    if (snapshots.length > 0) {
      console.log(`[pnl-snapshots] Inserting ${snapshots.length} snapshots to ClickHouse...`);
      await clickhouse.insertPnlSnapshots(snapshots);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[pnl-snapshots] Complete. Processed ${snapshots.length} wallets in ${elapsed}ms`);

    return json(200, {
      success: true,
      snapshotDate,
      walletsProcessed: snapshots.length,
      walletsSkipped: errors.length,
      elapsedMs: elapsed,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    });

  } catch (error: any) {
    console.error('[pnl-snapshots] Fatal error:', error);
    return json(500, { 
      error: 'Failed to create P&L snapshots',
      details: error?.message || String(error),
    });
  }
}

// Also support GET for manual testing
export async function GET(request: Request) {
  // Only allow GET in development
  if (process.env.NODE_ENV === 'production') {
    return json(405, { error: 'Method not allowed' });
  }
  
  return POST(request);
}
