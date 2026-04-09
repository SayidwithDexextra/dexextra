#!/usr/bin/env node
/**
 * Test script for optimistic order book updates
 * Sends a trade via the gasless API and monitors the response
 * 
 * Usage: node scripts/test-optimistic-trade.js [symbol] [side] [amount]
 * Example: node scripts/test-optimistic-trade.js CRUDE-OIL-PRICE sell 0.1
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

async function getMarketInfo(symbol) {
  const res = await fetch(`${BASE_URL}/api/markets?search=${encodeURIComponent(symbol)}&limit=1`);
  if (!res.ok) throw new Error(`Failed to fetch market: ${res.status}`);
  const data = await res.json();
  const market = data.markets?.[0];
  if (!market) throw new Error(`Market not found: ${symbol}`);
  return market;
}

async function getOrderBookData(symbol, orderBookAddress) {
  const res = await fetch(`${BASE_URL}/api/orderbook/live?symbol=${encodeURIComponent(symbol)}&orderBookAddress=${orderBookAddress}&levels=10`);
  if (!res.ok) throw new Error(`Failed to fetch orderbook: ${res.status}`);
  return res.json();
}

async function placeTestTrade(orderBook, method, params) {
  console.log('\n📤 Sending trade request...');
  console.log('   OrderBook:', orderBook);
  console.log('   Method:', method);
  console.log('   Params:', JSON.stringify(params, null, 2));
  
  const startTime = Date.now();
  
  const res = await fetch(`${BASE_URL}/api/gasless/trade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderBook,
      method,
      params,
      // For session-based trades, we need sessionId
      // For meta trades, we need message + signature
      // This script uses session trades which require an active session
    }),
  });
  
  const elapsed = Date.now() - startTime;
  const data = await res.json();
  
  console.log(`\n📥 Response (${elapsed}ms):`, JSON.stringify(data, null, 2));
  return { data, elapsed, status: res.status };
}

async function main() {
  const args = process.argv.slice(2);
  const symbol = args[0] || 'CRUDE-OIL-PRICE';
  const side = args[1] || 'sell';
  const amountArg = parseFloat(args[2] || '0.01');
  
  console.log('🧪 Optimistic Trade Test');
  console.log('========================');
  console.log(`Symbol: ${symbol}`);
  console.log(`Side: ${side}`);
  console.log(`Amount: ${amountArg}`);
  console.log(`Base URL: ${BASE_URL}`);
  
  try {
    // Step 1: Get market info
    console.log('\n📊 Fetching market info...');
    const market = await getMarketInfo(symbol);
    console.log('   Market ID:', market.id);
    console.log('   OrderBook:', market.market_address);
    console.log('   Symbol:', market.symbol);
    
    // Step 2: Get current order book state
    console.log('\n📖 Fetching order book...');
    const obData = await getOrderBookData(symbol, market.market_address);
    console.log('   Best Bid:', obData.bestBid);
    console.log('   Best Ask:', obData.bestAsk);
    console.log('   Bids:', obData.depth?.bids?.length || 0);
    console.log('   Asks:', obData.depth?.asks?.length || 0);
    
    const price = side === 'buy' ? obData.bestAsk : obData.bestBid;
    if (!price || price === 0) {
      console.log('\n⚠️  No liquidity on the', side === 'buy' ? 'ask' : 'bid', 'side');
      console.log('   Cannot place market order without opposing liquidity');
      
      // Show what liquidity exists
      if (obData.depth?.bids?.length > 0) {
        console.log('\n   Available bids:');
        obData.depth.bids.slice(0, 3).forEach(b => {
          console.log(`     $${b.price} - ${b.amount} units`);
        });
      }
      if (obData.depth?.asks?.length > 0) {
        console.log('\n   Available asks:');
        obData.depth.asks.slice(0, 3).forEach(a => {
          console.log(`     $${a.price} - ${a.amount} units`);
        });
      }
      return;
    }
    
    console.log(`\n💰 Using price: $${price}`);
    
    // Note: To actually execute a trade, you need either:
    // 1. A valid session (sessionId) for session-based trades
    // 2. A signed message for meta trades
    // 
    // This script demonstrates the API structure but won't execute 
    // without proper authentication.
    
    console.log('\n⚠️  This script shows the API structure but requires authentication.');
    console.log('   To test optimistic updates:');
    console.log('   1. Open the token page in browser: ' + BASE_URL + '/token/' + symbol);
    console.log('   2. Connect wallet and place a trade');
    console.log('   3. Watch the console for [OptimisticUI] and [LightweightOB] logs');
    console.log('   4. The order book should update INSTANTLY before tx confirmation');
    
    // Show expected API payload structure
    console.log('\n📋 Expected API payload for sessionPlaceMarket:');
    const examplePayload = {
      orderBook: market.market_address,
      method: 'sessionPlaceMarket',
      sessionId: '0x...your_session_id...',
      params: {
        trader: '0x...your_wallet...',
        amount: (BigInt(Math.floor(amountArg * 1e18))).toString(),
        isBuy: side === 'buy',
      }
    };
    console.log(JSON.stringify(examplePayload, null, 2));
    
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }
}

main();
