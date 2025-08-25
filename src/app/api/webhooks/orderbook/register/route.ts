import { NextRequest, NextResponse } from 'next/server';
import { getAlchemyNotifyService } from '@/services/alchemyNotifyService';

/**
 * Register OrderBook webhook with Alchemy
 * This creates a webhook that monitors all order book contract events
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🎯 Registering OrderBook webhook with Alchemy...');

    const alchemyService = await getAlchemyNotifyService();
    
    // Create the OrderBook webhook
    const webhookId = await alchemyService.createOrderBookWebhook();
    
    console.log('✅ OrderBook webhook registered successfully:', webhookId);

    return NextResponse.json({
      success: true,
      webhookId,
      message: 'OrderBook webhook registered successfully',
      endpoint: '/api/webhooks/orderbook',
      contracts: [
        'OrderRouter: 0x516a1790a04250FC6A5966A528D02eF20E1c1891',
        'OrderBook: 0x07d317C87E6d8AF322463aCF024f1e28D38F6117'
      ],
      events: [
        'OrderPlaced',
        'OrderCancelled', 
        'OrderExecuted',
        'OrderAdded',
        'OrderMatched'
      ],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Failed to register OrderBook webhook:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Failed to register OrderBook webhook',
      details: (error as Error).message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

/**
 * Get webhook registration status
 */
export async function GET(request: NextRequest) {
  try {
    const alchemyService = await getAlchemyNotifyService();
    
    // List existing webhooks
    const webhooks = await alchemyService.listWebhooks();
    
    // Filter for OrderBook webhooks
    const orderBookWebhooks = webhooks.data.filter((webhook: any) => 
      webhook.webhook_url && webhook.webhook_url.includes('/orderbook')
    );

    return NextResponse.json({
      status: 'OrderBook webhook registration endpoint',
      activeWebhooks: orderBookWebhooks.length,
      webhooks: orderBookWebhooks.map((webhook: any) => ({
        id: webhook.id,
        url: webhook.webhook_url,
        type: webhook.webhook_type,
        network: webhook.network,
        isActive: webhook.is_active,
        createdAt: webhook.time_created
      })),
      endpoint: '/api/webhooks/orderbook/register',
      methods: ['POST', 'GET'],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Failed to get webhook status:', error);
    
    return NextResponse.json({
      error: 'Failed to get webhook registration status',
      details: (error as Error).message
    }, { status: 500 });
  }
}
