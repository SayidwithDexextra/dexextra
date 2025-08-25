import { NextRequest, NextResponse } from 'next/server';
// Removed RealTimePriceService imports - smart contract functionality disabled

export async function POST(request: NextRequest) {
  try {
     console.log('🚀 Starting real-time price service via API...');
    
    // Start the real-time price service
    await startRealTimePriceService();
    
    // Get service status
    const service = getRealTimePriceService();
    const status = service.getStatus();
    
    return NextResponse.json({
      success: true,
      message: 'Real-time price service started successfully',
      status,
    });

  } catch (error) {
    console.error('❌ Failed to start real-time price service:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to start real-time price service',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {

     console.log('🚀 Getting real-time price service status via API...');


    // Get service status
    const service = getRealTimePriceService();
    const status = service.getStatus();
    
    return NextResponse.json({
      success: true,
      status,
    });

  } catch (error) {
    console.error('❌ Failed to get service status:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to get service status',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 