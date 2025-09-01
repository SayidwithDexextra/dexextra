import { NextRequest, NextResponse } from 'next/server';
import { getSettlementProcessor } from '@/lib/settlement-processor';

/**
 * Trigger settlement processor to push trades to blockchain
 * This is an admin endpoint for manual settlement processing
 */
export async function POST(request: NextRequest) {
  try {
    // Safely parse optional JSON body; default to safe values if empty or invalid
    let force = false;
    let dryRun = false;
    try {
      const body = await request.json();
      if (body) {
        force = body.force ?? false;
        dryRun = body.dryRun ?? false;
      }
    } catch (_) {
      // Ignore empty or malformed JSON body
    }

    console.log('🚀 Manual settlement processing triggered:', { force, dryRun });

    // Get the settlement processor instance
    const processor = getSettlementProcessor();
    
    // Get current status
    const status = processor.getStatus();
    
    if (status.isProcessing && !force) {
      return NextResponse.json({
        success: false,
        message: 'Settlement processor is already running. Use force=true to override.',
        status
      });
    }

    console.log('🔄 Current settlement processor status:', status);

    // Trigger manual processing
    if (dryRun) {
      console.log('🧪 DRY RUN MODE - No actual blockchain transactions will be sent');
      
      // TODO: Implement actual dry run mode that simulates without blockchain calls
      // For now, return status info
      return NextResponse.json({
        success: true,
        message: 'Dry run completed - check logs for details',
        mode: 'dry_run',
        status
      });
    } else {
      console.log('🔗 LIVE MODE - Real blockchain transactions will be sent');
      
      // Use the new manual processing method
      const result = await processor.processSettlementManually();
      
      if (!result.success) {
        return NextResponse.json({
          success: false,
          message: result.message,
          error: result.error,
          mode: 'live'
        }, { status: 500 });
      }

      const finalStatus = processor.getStatus();
      
      return NextResponse.json({
        success: true,
        message: result.message,
        mode: 'live',
        status: finalStatus
      });
    }

  } catch (error) {
    console.error('❌ Settlement processing error:', error);
    return NextResponse.json(
      { 
        error: 'Settlement processing failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * Get settlement processor status and configuration
 */
export async function GET(request: NextRequest) {
  try {
    const processor = getSettlementProcessor();
    const status = processor.getStatus();

    // Get environment configuration status
    const envStatus = {
      supabase_url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      service_role_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      settlement_private_key: !!process.env.SETTLEMENT_PRIVATE_KEY,
      rpc_url: !!process.env.RPC_URL,
      chain_id: process.env.CHAIN_ID
    };

    return NextResponse.json({
      success: true,
      processor_status: status,
      environment: envStatus,
      endpoints: {
        force_pending: '/api/admin/settlement/force-pending',
        process_settlement: '/api/admin/settlement/process',
        start_processor: '/api/admin/settlement/start',
        stop_processor: '/api/admin/settlement/stop'
      }
    });

  } catch (error) {
    console.error('❌ Get settlement status error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get settlement status',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
