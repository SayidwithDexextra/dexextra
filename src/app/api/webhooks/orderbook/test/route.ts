import { NextRequest, NextResponse } from 'next/server';
import OrderBookWebhookProcessor from '@/services/orderBookWebhookProcessor';

/**
 * Test the OrderBook webhook processor with real transaction data
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🧪 Testing OrderBook webhook processor...');

    const processor = new OrderBookWebhookProcessor();

    // Mock webhook data based on our real transaction
    const mockWebhookData = {
      type: 'GRAPHQL',
      event: {
        data: {
          block: {
            logs: [
              {
                account: {
                  address: '0x516a1790a04250FC6A5966A528D02eF20E1c1891' // OrderRouter
                },
                topics: [
                  '0x5b954fa335c624976b5c2dba7c7a172770d02d8b36e6da6cfcc1b79baa62bfc8', // OrderPlaced
                  '0x0000000000000000000000000000000000000000000000000000000000000002', // orderId = 2
                  '0x0000000000000000000000001bc0a803de77a004086e6010cd3f72ca7684e444', // trader
                  '0x864a895aed81431ba14df14feec24e3ac90a6dcb724fedd473ddfd2042c765d6'  // metricId hash
                ],
                data: '0x00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003b9aca00000000000000000000000000000000000000000000000000002386f26fc10000',
                index: 3,
                transaction: {
                  hash: '0xdd48a6f78df2f08596465992c0771319654c512ca293789d3f4d546d11105b1b',
                  index: 0,
                  blockNumber: '75535295',
                  blockHash: '0x123...',
                  from: {
                    address: '0x1Bc0a803de77a004086e6010cD3f72ca7684e444'
                  },
                  to: {
                    address: '0x516a1790a04250FC6A5966A528D02eF20E1c1891'
                  }
                }
              },
              {
                account: {
                  address: '0x07d317C87E6d8AF322463aCF024f1e28D38F6117' // OrderBook
                },
                topics: [
                  '0x184a980efa61c0acfeff92c0613bf2d3aceedadec9002d919c6bde9218b56c68', // OrderAdded
                  '0x0000000000000000000000000000000000000000000000000000000000000002', // orderId = 2
                  '0x0000000000000000000000001bc0a803de77a004086e6010cd3f72ca7684e444'  // trader
                ],
                data: '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003b9aca00000000000000000000000000000000000000000000000000002386f26fc10000',
                index: 2,
                transaction: {
                  hash: '0xdd48a6f78df2f08596465992c0771319654c512ca293789d3f4d546d11105b1b',
                  index: 0,
                  blockNumber: '75535295',
                  blockHash: '0x123...',
                  from: {
                    address: '0x1Bc0a803de77a004086e6010cD3f72ca7684e444'
                  },
                  to: {
                    address: '0x07d317C87E6d8AF322463aCF024f1e28D38F6117'
                  }
                }
              }
            ]
          }
        }
      }
    };

    console.log('📋 Processing mock webhook with real transaction data...');

    // Process the webhook
    const result = await processor.processWebhookEvent(mockWebhookData);

    console.log('✅ Test completed successfully');
    console.log(`📊 Results: ${result.processed} orders processed, ${result.errors.length} errors`);

    return NextResponse.json({
      success: true,
      test: 'OrderBook webhook processor',
      results: {
        processed: result.processed,
        ordersFound: result.orders.length,
        errors: result.errors.length,
        orders: result.orders.map(order => ({
          orderId: order.orderId,
          trader: order.trader,
          metricId: order.metricId,
          eventType: order.eventType,
          side: order.side === 0 ? 'BUY' : 'SELL',
          quantity: order.quantity,
          price: order.price,
          txHash: order.txHash,
          blockNumber: order.blockNumber
        })),
        errorDetails: result.errors
      },
      mockData: {
        transaction: '0xdd48a6f78df2f08596465992c0771319654c512ca293789d3f4d546d11105b1b',
        orderId: 2,
        trader: '0x1Bc0a803de77a004086e6010cD3f72ca7684e444',
        events: ['OrderPlaced', 'OrderAdded']
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Test failed:', error);
    
    return NextResponse.json({
      success: false,
      test: 'OrderBook webhook processor',
      error: 'Test failed',
      details: (error as Error).message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

/**
 * GET endpoint for test status
 */
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json({
      status: 'OrderBook webhook test endpoint',
      description: 'Tests the webhook processor with real transaction data',
      testData: {
        transaction: '0xdd48a6f78df2f08596465992c0771319654c512ca293789d3f4d546d11105b1b',
        orderId: 2,
        contracts: [
          'OrderRouter: 0x516a1790a04250FC6A5966A528D02eF20E1c1891',
          'OrderBook: 0x07d317C87E6d8AF322463aCF024f1e28D38F6117'
        ],
        events: ['OrderPlaced', 'OrderAdded']
      },
      endpoint: '/api/webhooks/orderbook/test',
      methods: ['POST', 'GET'],
      usage: 'POST to run test with mock webhook data',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return NextResponse.json({
      error: 'Failed to get test endpoint status',
      details: (error as Error).message
    }, { status: 500 });
  }
}
