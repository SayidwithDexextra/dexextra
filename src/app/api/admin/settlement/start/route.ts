import { NextRequest, NextResponse } from 'next/server';
import { getSettlementProcessor } from '@/lib/settlement-processor';

/**
 * Start the settlement processor daemon
 */
export async function POST(request: NextRequest) {
  try {
    // Safely parse optional JSON body; default interval if empty or invalid
    let intervalMs = 30000;
    try {
      const body = await request.json();
      if (body && typeof body.intervalMs === 'number') {
        intervalMs = body.intervalMs;
      }
    } catch (_) {
      // Ignore empty or malformed JSON body
    }

    console.log('🚀 Starting settlement processor daemon with interval:', intervalMs);

    const processor = getSettlementProcessor();
    const currentStatus = processor.getStatus();

    if (currentStatus.isRunning) {
      return NextResponse.json({
        success: false,
        message: 'Settlement processor is already running',
        status: currentStatus
      });
    }

    // Start the processor
    processor.start(intervalMs);

    const newStatus = processor.getStatus();

    console.log('✅ Settlement processor started successfully');

    return NextResponse.json({
      success: true,
      message: `Settlement processor started with ${intervalMs}ms interval`,
      status: newStatus
    });

  } catch (error) {
    console.error('❌ Error starting settlement processor:', error);
    return NextResponse.json(
      { 
        error: 'Failed to start settlement processor',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}





