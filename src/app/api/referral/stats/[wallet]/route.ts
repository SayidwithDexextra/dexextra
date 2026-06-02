import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-admin';

const walletAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address format')
  .transform((addr) => addr.toLowerCase());

function getBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://dexetera.org').replace(/\/+$/, '');
}

// GET /api/referral/stats/[wallet]
// Returns the wallet's referral code, counts, and shareable link.
// Points/rank are placeholders until the Phase 3 points system lands.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ wallet: string }> }
) {
  try {
    const { wallet: rawWallet } = await params;
    const wallet = walletAddressSchema.parse(rawWallet);

    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .select('referral_code, referral_count, referral_volume_usd')
      .eq('wallet_address', wallet)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      console.error('Error fetching referral stats:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch referral stats' },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { success: false, error: 'Profile not found' },
        { status: 404 }
      );
    }

    // Points total + global rank from the Phase 3 points ledger.
    let totalPoints = 0;
    let rank: number | null = null;
    const { data: summary, error: summaryError } = await supabaseAdmin.rpc(
      'get_points_summary',
      { p_wallet: wallet }
    );

    if (summaryError) {
      // Non-fatal: still return referral stats even if points lookup fails.
      console.error('get_points_summary RPC error:', summaryError);
    } else if (Array.isArray(summary) && summary.length > 0) {
      totalPoints = Number(summary[0].total_points ?? 0);
      rank = summary[0].rank != null ? Number(summary[0].rank) : null;
    }

    const referralLink = data.referral_code
      ? `${getBaseUrl()}?ref=${data.referral_code}`
      : null;

    return NextResponse.json({
      success: true,
      data: {
        referral_code: data.referral_code,
        referral_count: data.referral_count ?? 0,
        referral_volume_usd: Number(data.referral_volume_usd ?? 0),
        total_points: totalPoints,
        rank,
        referral_link: referralLink,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid wallet address', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Error fetching referral stats:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch referral stats' },
      { status: 500 }
    );
  }
}
