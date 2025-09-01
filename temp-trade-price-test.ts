const { getServerlessMatchingEngine } = require('./src/lib/serverless-matching');

async function testTradePriceValidation() {
  try {
    console.log('🧪 Starting trade price validation test...');
    
    const engine = getServerlessMatchingEngine();
    
    // Test 1: Market order with no price history
    const marketOrder = {
      id: 'test-market-order',
      market_id: 'SILVER_V2',
      trader_wallet_address: '0xTestTrader1',
      order_type: 'MARKET' as const,
      side: 'BUY' as const,
      quantity: 10,
      filled_quantity: 0,
      order_status: 'PENDING' as const,
      time_in_force: 'GTC' as const,
      post_only: false,
      reduce_only: false,
      created_at: new Date().toISOString()
    };

    console.log('🧪 Testing market order execution...');
    const matches = await engine['executeMarketOrder'](marketOrder);
    
    console.log(`✅ Market order generated ${matches.length} matches`);
    
    // Verify each match has a valid price
    for (const match of matches) {
      if (match.price === null || match.price === undefined || isNaN(match.price)) {
        throw new Error(`Match has invalid price: ${match.price}`);
      }
      console.log(`✅ Match price verified: ${match.price}`);
    }

    console.log('🎉 All tests passed!');
    
    // Clean up - delete this test file
    const fs = require('fs');
    fs.unlinkSync(__filename);
    console.log('🧹 Test file cleaned up');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testTradePriceValidation().catch(console.error);
