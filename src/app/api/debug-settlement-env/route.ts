import { NextRequest, NextResponse } from 'next/server';
import { debugEnvironment, getSettlementPrivateKey } from '@/lib/runtime-env-loader';
import { env } from '@/lib/env';

/**
 * API endpoint to debug settlement environment loading
 * GET /api/debug-settlement-env
 */
export async function GET(request: NextRequest) {
  try {
    console.log('🔍 Debug Settlement Environment API called');
    
    // Capture console output
    const logs: string[] = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    
    console.log = (...args: any[]) => {
      logs.push(`[LOG] ${args.join(' ')}`);
      originalLog(...args);
    };
    
    console.warn = (...args: any[]) => {
      logs.push(`[WARN] ${args.join(' ')}`);
      originalWarn(...args);
    };
    
    // Run debug
    debugEnvironment();
    const settlementKey = getSettlementPrivateKey();
    
    // Restore console
    console.log = originalLog;
    console.warn = originalWarn;
    
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
        keyPreview: settlementKey ? `${settlementKey.substring(0, 6)}...${settlementKey.substring(62)}` : null
      },
      logs,
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
