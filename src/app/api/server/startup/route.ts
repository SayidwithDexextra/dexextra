import { NextRequest, NextResponse } from 'next/server';
// Server startup utilities removed

/**
 * POST /api/server/startup - Initialize server services
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { force } = body as { force?: boolean };

    return NextResponse.json({
      error: 'Server startup utilities removed (on-chain only).',
      timestamp: new Date().toISOString()
    }, { status: 410 });

  } catch (error) {
    console.error('❌ Server startup failed:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Failed to initialize server services',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

/**
 * GET /api/server/startup - Get server initialization status
 */
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json({
      success: true,
      status: { isInitialized: true, services: { settlementProcessor: false } },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Failed to get startup status:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Failed to get startup status',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}



