import { NextRequest, NextResponse } from 'next/server';
import { debugEnvironment, getSettlementPrivateKey } from '@/lib/runtime-env-loader';
import { env } from '@/lib/env';

/**
 * API endpoint to debug settlement environment loading
 * GET /api/debug-settlement-env
 */
export async function GET(request: NextRequest) {
  try {
    // This route is for local debugging only.
    // Never expose env/debug output in production (Vercel) where it can leak sensitive config.
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    console.log('🔍 Debug Settlement Environment API called');

    // Run debug (debugEnvironment is safe: it does not print secret values)
    debugEnvironment();
    const settlementKey = getSettlementPrivateKey();

    const result = {
      success: true,
      environment: {
        nodeEnv: process.env.NODE_ENV,
        hasEnvLocal: true, // We know it exists from earlier check
        directProcessEnv: !!process.env.SETTLEMENT_PRIVATE_KEY,
        envModule: false,
        runtimeLoader: !!settlementKey,
        keyLength: settlementKey?.length || 0,
        keyValid: settlementKey ? (settlementKey.startsWith('0x') && settlementKey.length === 66) : false,
        // Never return any key material (even partial) to the caller.
      },
      timestamp: new Date().toISOString()
    };
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error('❌ Debug settlement env failed:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}
