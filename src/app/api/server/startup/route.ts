import { NextRequest, NextResponse } from 'next/server';
import { initializeServerServices, getInitializationStatus, forceReinitialize } from '@/lib/server-startup';

/**
 * POST /api/server/startup - Initialize server services
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { force } = body as { force?: boolean };

    if (force) {
      console.log('🔄 Force re-initializing server services...');
      forceReinitialize();
    }

    await initializeServerServices();
    const status = getInitializationStatus();

    return NextResponse.json({
      success: true,
      message: 'Server services initialized successfully',
      status,
      timestamp: new Date().toISOString()
    });

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
    const status = getInitializationStatus();

    return NextResponse.json({
      success: true,
      status,
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



