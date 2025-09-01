import { NextRequest, NextResponse } from 'next/server';
import { getSettlementProcessor } from '@/lib/settlement-processor';

/**
 * Stop the settlement processor daemon
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🛑 Stopping settlement processor daemon');

    const processor = getSettlementProcessor();
    const currentStatus = processor.getStatus();

    if (!currentStatus.isRunning) {
      return NextResponse.json({
        success: false,
        message: 'Settlement processor is not running',
        status: currentStatus
      });
    }

    // Stop the processor
    processor.stop();

    const newStatus = processor.getStatus();

    console.log('✅ Settlement processor stopped successfully');

    return NextResponse.json({
      success: true,
      message: 'Settlement processor stopped',
      status: newStatus
    });

  } catch (error) {
    console.error('❌ Error stopping settlement processor:', error);
    return NextResponse.json(
      { 
        error: 'Failed to stop settlement processor',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}





