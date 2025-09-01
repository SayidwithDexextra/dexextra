import { NextRequest, NextResponse } from 'next/server';
import { SettlementConfigTest } from '@/lib/settlement-config-test';

/**
 * API endpoint to test settlement configuration
 * GET /api/test-settlement
 */
export async function GET(request: NextRequest) {
  try {
    console.log('🧪 Settlement Configuration Test API called');
    
    // Capture console output for API response
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(' '));
      originalLog(...args);
    };
    
    // Run the test
    await SettlementConfigTest.runFullTest();
    
    // Restore console.log
    console.log = originalLog;
    
    const isReady = SettlementConfigTest.isSettlementReady();
    const walletAddress = SettlementConfigTest.getSettlementWalletAddress();
    
    return NextResponse.json({
      success: true,
      settlementReady: isReady,
      walletAddress,
      testLogs: logs,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Settlement test failed:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      settlementReady: false,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}
