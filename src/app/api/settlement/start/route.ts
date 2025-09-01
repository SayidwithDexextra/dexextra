import { NextRequest, NextResponse } from 'next/server';
import { settlementProcessor } from '@/lib/settlement-processor';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { intervalMs } = body as { intervalMs?: number };

    const status = settlementProcessor.getStatus();
    
    if (status.isRunning) {
      return NextResponse.json({ 
        message: 'Settlement processor is already running',
        status: status
      }, { status: 200 });
    }

    // Start the settlement processor
    settlementProcessor.start(intervalMs || 30000); // Default 30 seconds

    return NextResponse.json({ 
      message: 'Settlement processor started successfully',
      intervalMs: intervalMs || 30000,
      status: settlementProcessor.getStatus()
    }, { status: 200 });

  } catch (error) {
    console.error('Failed to start settlement processor:', error);
    return NextResponse.json({ 
      error: 'Failed to start settlement processor', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const status = settlementProcessor.getStatus();
    
    return NextResponse.json({ 
      status: status,
      message: status.isRunning ? 'Settlement processor is running' : 'Settlement processor is stopped'
    }, { status: 200 });

  } catch (error) {
    console.error('Failed to get settlement processor status:', error);
    return NextResponse.json({ 
      error: 'Failed to get status', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
