import { NextRequest, NextResponse } from 'next/server';
import { getEventListener } from '@/services/eventListener';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const debug = searchParams.get('debug');
    const connectivity = searchParams.get('connectivity');
    const report = searchParams.get('report');

    const eventListener = await getEventListener();
    
    // Debug mode - return comprehensive debugging information
    if (debug === 'true') {
      const diagnostics = eventListener.getDiagnostics();
      const status = eventListener.getStatus();
      
      return NextResponse.json({
        success: true,
        debug: true,
        status,
        diagnostics,
        timestamp: new Date().toISOString()
      });
    }

    // Connectivity test mode
    if (connectivity === 'true') {
      const connectivityResults = await eventListener.testConnectivity();
      const status = eventListener.getStatus();
      
      return NextResponse.json({
        success: true,
        connectivity: connectivityResults,
        status,
        timestamp: new Date().toISOString()
      });
    }

    // Generate debug report
    if (report === 'true') {
      const debugReport = await eventListener.generateDebugReport();
      
      return NextResponse.json({
        success: true,
        report: debugReport,
        timestamp: new Date().toISOString()
      });
    }

    // Default status response
    const status = eventListener.getStatus();
    return NextResponse.json({
      success: true,
      status: {
        ...status,
        message: status.isRunning ? 'Event listener is running' : 'Event listener is stopped'
      }
    });
  } catch (error) {
    console.error('Error getting event listener status:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to get event listener status',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json();
    
    if (!action || !['start', 'stop', 'restart', 'test', 'debug'].includes(action)) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid action. Must be "start", "stop", "restart", "test", or "debug"' 
        },
        { status: 400 }
      );
    }

    const eventListener = await getEventListener();
    
    let message = '';
    let additionalData: any = {};
    
    switch (action) {
      case 'start':
        if (eventListener.getStatus().isRunning) {
          message = 'Event listener is already running';
        } else {
          try {
            await eventListener.start();
            message = 'Event listener started successfully';
          } catch (startError) {
            // Enhanced error information for startup failures
            const debugReport = await eventListener.generateDebugReport();
            return NextResponse.json({
              success: false,
              error: 'Failed to start event listener',
              details: startError instanceof Error ? startError.message : 'Unknown error',
              debugReport,
              timestamp: new Date().toISOString()
            }, { status: 500 });
          }
        }
        break;
        
      case 'stop':
        if (!eventListener.getStatus().isRunning) {
          message = 'Event listener is already stopped';
        } else {
          await eventListener.stop();
          message = 'Event listener stopped successfully';
        }
        break;
        
      case 'restart':
        await eventListener.stop();
        try {
          await eventListener.start();
          message = 'Event listener restarted successfully';
        } catch (restartError) {
          const debugReport = await eventListener.generateDebugReport();
          return NextResponse.json({
            success: false,
            error: 'Failed to restart event listener',
            details: restartError instanceof Error ? restartError.message : 'Unknown error',
            debugReport,
            timestamp: new Date().toISOString()
          }, { status: 500 });
        }
        break;

      case 'test':
        // Test connectivity without starting/stopping
        const connectivityResults = await eventListener.testConnectivity();
        message = 'Connectivity test completed';
        additionalData = { connectivity: connectivityResults };
        break;

      case 'debug':
        // Generate comprehensive debug report
        const debugReport = await eventListener.generateDebugReport();
        const diagnostics = eventListener.getDiagnostics();
        message = 'Debug information generated';
        additionalData = { 
          diagnostics,
          debugReport
        };
        break;
    }
    
    const status = eventListener.getStatus();
    
    return NextResponse.json({
      success: true,
      message,
      status,
      ...additionalData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error managing event listener:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to manage event listener',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 