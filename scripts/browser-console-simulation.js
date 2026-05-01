// ============================================================
// PASTE THIS ENTIRE BLOCK INTO YOUR BROWSER CONSOLE
// While on a market page (e.g., /token/DAILY-ETH-PRICE)
// ============================================================

// Get current symbol from URL
const getSymbol = () => {
  const m = window.location.pathname.match(/\/token\/([^/]+)/);
  return m ? m[1].toUpperCase() : null;
};

// Simulate a trade event
window.simTrade = (sym, price) => {
  const s = (sym || getSymbol() || 'UNKNOWN').toUpperCase();
  const p = price || 2550;
  console.log(`🎯 Simulating TradeExecutionCompleted for ${s} @ $${p}`);
  window.dispatchEvent(new CustomEvent('ordersUpdated', {
    detail: {
      symbol: s,
      eventType: 'TradeExecutionCompleted',
      price: String(Math.round(p * 1e6)),
      amount: String(1e18),
      timestamp: Date.now(),
      source: 'simulation',
    }
  }));
};

// Simulate an order event
window.simOrder = (sym, price) => {
  const s = (sym || getSymbol() || 'UNKNOWN').toUpperCase();
  const p = price || 2548;
  console.log(`📝 Simulating OrderPlaced for ${s} @ $${p}`);
  window.dispatchEvent(new CustomEvent('ordersUpdated', {
    detail: {
      symbol: s,
      eventType: 'OrderPlaced',
      price: String(Math.round(p * 1e6)),
      amount: String(1e18),
      isBuy: true,
      timestamp: Date.now(),
      source: 'simulation',
    }
  }));
};

// Quick test
window.test = () => {
  const s = getSymbol();
  if (!s) { console.error('Not on a token page!'); return; }
  simTrade(s);
};

console.log(`
✅ Simulation tools loaded!

Commands:
  test()              - Quick trade simulation on current market
  simTrade('SYM')     - Simulate trade (fast fetch, 100ms)
  simOrder('SYM')     - Simulate order (slow fetch, 2000ms)
  
Current market: ${getSymbol() || '(not on token page)'}
`);
