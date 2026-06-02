import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-admin';

const walletAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address format')
  .transform((addr) => addr.toLowerCase());

const TrackReferralSchema = z.object({
  wallet_address: walletAddressSchema,
  // 8-char hex code (case-insensitive); the DB lowercases for comparison.
  referral_code: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{8}$/, 'Invalid referral code format')
    .transform((code) => code.toLowerCase()),
});

// Maps the DB function's error codes to HTTP statuses + friendly messages.
const ERROR_RESPONSES: Record<string, { status: number; message: string }> = {
  invalid_code: { status: 404, message: 'Referral code not found' },
  self_referral: { status: 400, message: 'You cannot refer yourself' },
  already_referred: { status: 409, message: 'This wallet already has a referrer' },
};

// POST /api/referral/track
// Body: { wallet_address: string, referral_code: string }
// Records (once) which user referred this wallet.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { wallet_address, referral_code } = TrackReferralSchema.parse(body);

    const { data, error } = await supabaseAdmin.rpc('track_referral', {
      p_wallet_address: wallet_address,
      p_referral_code: referral_code,
    });

    if (error) {
      console.error('track_referral RPC error:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to track referral' },
        { status: 500 }
      );
    }

    // The function returns a JSONB status object.
    const result = (data ?? {}) as {
      success?: boolean;
      error?: string;
      referrer?: string;
    };

    if (!result.success) {
      const mapped = ERROR_RESPONSES[result.error ?? ''] ?? {
        status: 400,
        message: 'Unable to track referral',
      };
      return NextResponse.json(
        { success: false, error: mapped.message, code: result.error },
        { status: mapped.status }
      );
    }

    return NextResponse.json({
      success: true,
      data: { referrer: result.referrer },
      message: 'Referral recorded',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Error tracking referral:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to track referral' },
      { status: 500 }
    );
  }
}
