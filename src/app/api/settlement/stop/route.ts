import { NextRequest, NextResponse } from 'next/server';
import { settlementProcessor } from '@/lib/settlement-processor';

export async function POST(request: NextRequest) {
  try {
    const status = settlementProcessor.getStatus();
    
    if (!status.isRunning) {
      return NextResponse.json({ 
        message: 'Settlement processor is not running',
        status: status
      }, { status: 200 });
    }

    // Stop the settlement processor
    settlementProcessor.stop();

    return NextResponse.json({ 
      message: 'Settlement processor stopped successfully',
      status: settlementProcessor.getStatus()
    }, { status: 200 });

  } catch (error) {
    console.error('Failed to stop settlement processor:', error);
    return NextResponse.json({ 
      error: 'Failed to stop settlement processor', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
