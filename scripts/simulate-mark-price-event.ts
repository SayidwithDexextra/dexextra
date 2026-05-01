/**
 * Mark Price Update Simulation Script
 * 
 * Copy and paste the simulateTrade() or simulateOrder() functions into your browser console
 * while on a market page to test the event flow.
 * 
 * Usage in browser console:
 *   simulateTrade('SYMBOL')  - Simulates a trade event (triggers quick mark price fetch)
 *   simulateOrder('SYMBOL')  - Simulates an order event (triggers slower mark price fetch)
 *   runFullSimulation('SYMBOL') - Runs a series of events with delays
 */

// Simulate a trade execution event
function simulateTrade(symbol: string, price?: number) {
  const eventSymbol = symbol.toUpperCase();
  const tradePrice = price || Math.random() * 1000 + 2000; // Random price around 2000-3000
  
  console.log(`\n🎯 [SIMULATION] Dispatching TradeExecutionCompleted for ${eventSymbol}`);
  console.log(`   Price: $${tradePrice.toFixed(4)}`);
  console.log(`   Expected logs:`);
  console.log(`   - [MarkPrice] Event received: TradeExecutionCompleted for ${eventSymbol}`);
  console.log(`   - [MarkPrice] Fetching mark price for ${eventSymbol} from 0x...`);
  console.log(`   - [MarkPrice] Updated from OrderBook: $X.XXXX for ${eventSymbol}`);
  console.log(`   - [MarkPrice] Dispatching marketMarkPrice: $X.XXXX for ${eventSymbol}`);
  console.log('');
  
  window.dispatchEvent(new CustomEvent('ordersUpdated', {
    detail: {
      symbol: eventSymbol,
      eventType: 'TradeExecutionCompleted',
      price: String(Math.round(tradePrice * 1e6)), // Raw price in 6 decimals
      amount: String(Math.round(Math.random() * 10 * 1e18)), // Random amount
      buyer: '0x1234567890123456789012345678901234567890',
      seller: '0x0987654321098765432109876543210987654321',
      timestamp: Date.now(),
      source: 'simulation',
    }
  }));
  
  return `Dispatched TradeExecutionCompleted for ${eventSymbol}`;
}

// Simulate an order placed event
function simulateOrder(symbol: string, isBuy: boolean = true, price?: number) {
  const eventSymbol = symbol.toUpperCase();
  const orderPrice = price || Math.random() * 1000 + 2000;
  const side = isBuy ? 'BUY' : 'SELL';
  
  console.log(`\n📝 [SIMULATION] Dispatching OrderPlaced (${side}) for ${eventSymbol}`);
  console.log(`   Price: $${orderPrice.toFixed(4)}`);
  console.log(`   Expected logs (after 2s debounce):`);
  console.log(`   - [MarkPrice] Event received: OrderPlaced for ${eventSymbol}`);
  console.log(`   - [MarkPrice] Fetching mark price for ${eventSymbol} from 0x...`);
  console.log('');
  
  window.dispatchEvent(new CustomEvent('ordersUpdated', {
    detail: {
      symbol: eventSymbol,
      eventType: 'OrderPlaced',
      orderId: String(Math.floor(Math.random() * 1000000)),
      price: String(Math.round(orderPrice * 1e6)),
      amount: String(Math.round(Math.random() * 10 * 1e18)),
      isBuy,
      trader: '0x1234567890123456789012345678901234567890',
      timestamp: Date.now(),
      source: 'simulation',
    }
  }));
  
  return `Dispatched OrderPlaced (${side}) for ${eventSymbol}`;
}

// Simulate positions refresh request (alternative trade event)
function simulatePositionsRefresh(symbol: string) {
  const eventSymbol = symbol.toUpperCase();
  
  console.log(`\n🔄 [SIMULATION] Dispatching positionsRefreshRequested for ${eventSymbol}`);
  console.log('');
  
  window.dispatchEvent(new CustomEvent('positionsRefreshRequested', {
    detail: {
      symbol: eventSymbol,
      timestamp: Date.now(),
      source: 'simulation',
    }
  }));
  
  return `Dispatched positionsRefreshRequested for ${eventSymbol}`;
}

// Run a full simulation with multiple events
async function runFullSimulation(symbol: string) {
  const eventSymbol = symbol.toUpperCase();
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 STARTING FULL SIMULATION FOR ${eventSymbol}`);
  console.log(`${'='.repeat(60)}\n`);
  
  // Step 1: Initial trade
  console.log('Step 1/4: Simulating initial trade...');
  simulateTrade(eventSymbol, 2550.00);
  
  await new Promise(r => setTimeout(r, 500));
  
  // Step 2: Another trade (should be debounced if within 300ms)
  console.log('\nStep 2/4: Simulating rapid follow-up trade (should coalesce)...');
  simulateTrade(eventSymbol, 2552.50);
  
  await new Promise(r => setTimeout(r, 2000));
  
  // Step 3: Order placed
  console.log('\nStep 3/4: Simulating order placed...');
  simulateOrder(eventSymbol, true, 2548.00);
  
  await new Promise(r => setTimeout(r, 3000));
  
  // Step 4: Final trade
  console.log('\nStep 4/4: Simulating final trade...');
  simulateTrade(eventSymbol, 2555.00);
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ SIMULATION COMPLETE FOR ${eventSymbol}`);
  console.log(`${'='.repeat(60)}\n`);
  console.log('Check the logs above to verify:');
  console.log('1. Events were received by TokenHeader');
  console.log('2. Mark price fetches were triggered');
  console.log('3. UI and document title updated');
  console.log('4. marketMarkPrice events were dispatched for chart');
  
  return 'Simulation complete';
}

// Get current symbol from the URL (helper)
function getCurrentSymbol(): string | null {
  const match = window.location.pathname.match(/\/token\/([^/]+)/);
  return match ? match[1].toUpperCase() : null;
}

// Quick test with current page's symbol
function quickTest() {
  const symbol = getCurrentSymbol();
  if (!symbol) {
    console.error('❌ Not on a token page. Navigate to /token/SYMBOL first.');
    return;
  }
  console.log(`\n🎯 Quick test for current market: ${symbol}`);
  return simulateTrade(symbol);
}

// Export for use in browser console
if (typeof window !== 'undefined') {
  (window as any).simulateTrade = simulateTrade;
  (window as any).simulateOrder = simulateOrder;
  (window as any).simulatePositionsRefresh = simulatePositionsRefresh;
  (window as any).runFullSimulation = runFullSimulation;
  (window as any).getCurrentSymbol = getCurrentSymbol;
  (window as any).quickTest = quickTest;
  
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║         Mark Price Simulation Tools Loaded!                    ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  Available commands:                                           ║
║                                                                ║
║  quickTest()                                                   ║
║    → Simulate a trade on the current page's market             ║
║                                                                ║
║  simulateTrade('SYMBOL')                                       ║
║    → Simulate a trade execution (triggers 100ms fetch)         ║
║                                                                ║
║  simulateOrder('SYMBOL', true/false, price?)                   ║
║    → Simulate order placed (triggers 2000ms fetch)             ║
║                                                                ║
║  runFullSimulation('SYMBOL')                                   ║
║    → Run a series of events with delays                        ║
║                                                                ║
║  getCurrentSymbol()                                            ║
║    → Get the current page's market symbol                      ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
  `);
}

export { simulateTrade, simulateOrder, simulatePositionsRefresh, runFullSimulation, getCurrentSymbol, quickTest };
