/**
 * Test utility for verifying real-time order updates
 * Use this in browser console or as a quick test
 */

export async function testRealtimeOrderCreation(metricId: string = 'aluminum-v1-001') {
  console.log('🧪 Testing real-time order creation...');
  
  const testOrder = {
    metricId,
    orderType: 'LIMIT',
    side: 'BUY',
    quantity: '10.0',
    price: '4.50',
    walletAddress: '0x' + Math.random().toString(16).substr(2, 40), // Random wallet for testing
    timeInForce: 'GTC',
    postOnly: false,
    reduceOnly: false
  };

  try {
    const response = await fetch('/api/orders/demo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testOrder),
    });

    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Test order created successfully:', result);
      console.log('📡 Watch your TransactionTable - it should update immediately!');
      return result;
    } else {
      console.error('❌ Test order failed:', result);
      return null;
    }
  } catch (error) {
    console.error('❌ Test order error:', error);
    return null;
  }
}

export async function createMultipleTestOrders(count: number = 3, metricId: string = 'aluminum-v1-001') {
  console.log(`🧪 Creating ${count} test orders for real-time testing...`);
  
  const results = [];
  const staggerDelay = 75; // Match the animation hook default
  
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? 'BUY' : 'SELL';
    const basePrice = 4.50;
    const price = side === 'BUY' ? basePrice - (i * 0.05) : basePrice + (i * 0.05);
    
    const testOrder = {
      metricId,
      orderType: 'LIMIT',
      side,
      quantity: (10 + i * 5).toString(),
      price: price.toFixed(2),
      walletAddress: '0x' + Math.random().toString(16).substr(2, 40),
      timeInForce: 'GTC',
      postOnly: false,
      reduceOnly: false
    };

    console.log(`Creating test order ${i + 1}/${count}:`, testOrder);
    
    const result = await fetch('/api/orders/demo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testOrder),
    });

    const data = await result.json();
    if (data.success) {
      results.push(data);
      console.log(`✅ Test order ${i + 1} created - should slide in with ${i * staggerDelay}ms delay`);
    }
    
    // Small delay between orders to see them appear sequentially
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  console.log(`✅ Created ${results.length}/${count} test orders`);
  console.log('📡 All orders should appear in your TransactionTable in real-time!');
  
  return results;
}

// Browser console helper
if (typeof window !== 'undefined') {
  (window as any).testRealtimeOrders = testRealtimeOrderCreation;
  (window as any).createMultipleTestOrders = createMultipleTestOrders;
  console.log('🧪 Real-time testing functions available:');
  console.log('- testRealtimeOrders() - Create a single test order');
  console.log('- createMultipleTestOrders() - Create multiple test orders');
}
