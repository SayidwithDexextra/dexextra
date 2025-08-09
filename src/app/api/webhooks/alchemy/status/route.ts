import { NextRequest, NextResponse } from 'next/server';
import { getWebhookEventListener } from '@/services/webhookEventListener';
import { getAlchemyNotifyService } from '@/services/alchemyNotifyService';
import { EventDatabase } from '@/lib/eventDatabase';

/**
 * Get webhook monitoring status
 * 
 * This endpoint provides comprehensive status information about the
 * webhook-based event monitoring system that replaced the old polling system.
 */
export async function GET(request: NextRequest) {
  try {
     console.log('📊 Fetching webhook monitoring status...');

    // Get query parameters
    const url = new URL(request.url);
    const detailed = url.searchParams.get('detailed') === 'true';

    const database = new EventDatabase();
    const alchemyNotify = await getAlchemyNotifyService();

    // Basic status information
    const status = {
      timestamp: new Date().toISOString(),
      system: 'webhook-based',
      vercelCompatible: true
    };

    // Get webhook event listener status
    try {
      const webhookListener = await getWebhookEventListener();
      const listenerStatus = await webhookListener.getStatus();
      
      Object.assign(status, {
        listener: {
          isInitialized: listenerStatus.isInitialized,
          webhooksActive: listenerStatus.webhooksActive,
          contractsMonitored: listenerStatus.contractsMonitored,
          lastCheck: listenerStatus.lastCheck,
          webhookIds: listenerStatus.webhookIds,
          startupErrors: listenerStatus.startupErrors
        }
      });
    } catch (error) {
      Object.assign(status, {
        listener: {
          error: `Failed to get listener status: ${(error as Error).message}`,
          isInitialized: false,
          webhooksActive: 0,
          contractsMonitored: 0
        }
      });
    }

    // Get Alchemy service health
    try {
      const alchemyHealth = await alchemyNotify.healthCheck();
      Object.assign(status, {
        alchemy: alchemyHealth
      });
    } catch (error) {
      Object.assign(status, {
        alchemy: {
          status: 'unhealthy',
          error: (error as Error).message
        }
      });
    }

    // Get database health
    try {
      await database.healthCheck();
      Object.assign(status, {
        database: {
          status: 'healthy',
          connection: 'active'
        }
      });
    } catch (error) {
      Object.assign(status, {
        database: {
          status: 'unhealthy',
          error: (error as Error).message
        }
      });
    }

    // Get detailed information if requested
    if (detailed) {
      try {
        // Get webhook configuration from database
        const webhookConfig = await database.getWebhookConfig();
        
        // Get recent events count
        const recentEvents = await database.queryEvents({
          limit: 10
        });

        // Get event metrics
        const metrics = await database.getEventMetrics('24h');

        Object.assign(status, {
          detailed: {
            webhookConfig: webhookConfig ? {
              ...webhookConfig,
              contractCount: webhookConfig.contracts.length
            } : null,
            recentEventsCount: recentEvents.length,
            metrics: metrics,
            lastEventTimestamp: recentEvents.length > 0 ? recentEvents[0].timestamp : null
          }
        });
      } catch (error) {
        Object.assign(status, {
          detailed: {
            error: `Failed to get detailed status: ${(error as Error).message}`
          }
        });
      }
    }

    // Determine overall health status
    const overallStatus = 
      (status as any).listener?.isInitialized &&
      (status as any).listener?.webhooksActive > 0 &&
      (status as any).alchemy?.status === 'healthy' &&
      (status as any).database?.status === 'healthy'
        ? 'healthy' 
        : 'unhealthy';

    return NextResponse.json({
      status: overallStatus,
      ...status
    });

  } catch (error) {
    console.error('❌ Error getting webhook status:', error);
    
    return NextResponse.json({
      status: 'unhealthy',
      error: 'Failed to get webhook status',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
      system: 'webhook-based',
      vercelCompatible: true
    }, { status: 500 });
  }
}

/**
 * Initialize webhook monitoring
 * 
 * This endpoint can be used to initialize the webhook system
 * for new deployments or after configuration changes.
 */
export async function POST(request: NextRequest) {
  try {
     console.log('🚀 Initializing webhook monitoring...');

    const webhookListener = await getWebhookEventListener();
    await webhookListener.initialize();

    const status = await webhookListener.getStatus();

    return NextResponse.json({
      success: true,
      message: 'Webhook monitoring initialized successfully',
      status: status,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Failed to initialize webhook monitoring:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Failed to initialize webhook monitoring',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
} 