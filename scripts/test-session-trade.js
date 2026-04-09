#!/usr/bin/env node
/**
 * Test session-based trading for optimistic order book updates
 * 
 * This script:
 * 1. Creates a trading session for the test wallet (if needed)
 * 2. Places a trade via the gasless API
 * 3. Monitors the result
 * 
 * Usage: node scripts/test-session-trade.js [symbol] [side] [price] [amount]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
const { ethers } = require('ethers');

const RPC_URL = process.env.RPC_URL;
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

let PRIVATE_KEY = process.env.OPTIMISTIC_OVERLAY_PRIVATE_KEY;
if (PRIVATE_KEY && !PRIVATE_KEY.startsWith('0x')) PRIVATE_KEY = '0x' + PRIVATE_KEY;

async function getMarketInfo(symbol) {
  console.log(`\n📊 Fetching market info for ${symbol}...`);
  const res = await fetch(`${BASE_URL}/api/markets?search=${encodeURIComponent(symbol)}&limit=1`);
  if (!res.ok) throw new Error(`Failed to fetch market: ${res.status}`);
  const data = await res.json();
  const market = data.markets?.[0];
  if (!market) throw new Error(`Market not found: ${symbol}`);
  console.log('   Market ID:', market.id);
  console.log('   OrderBook:', market.market_address);
  return market;
}

async function getOrCreateSession(wallet, orderBookAddress) {
  console.log('\n🔑 Checking/creating trading session...');
  
  // First check if session exists
  const checkRes = await fetch(`${BASE_URL}/api/gasless/session/status?trader=${wallet.address}`);
  if (checkRes.ok) {
    const status = await checkRes.json();
    if (status.active && status.sessionId) {
      console.log('   Existing session found:', status.sessionId.slice(0, 18) + '...');
      return status.sessionId;
    }
  }
  
  // Need to create a new session - this requires signing
  console.log('   Creating new session...');
  
  // Get nonce
  const nonceRes = await fetch(`${BASE_URL}/api/gasless/session/nonce?trader=${wallet.address}`);
  const { nonce } = await nonceRes.json();
  
  // Build session creation message
  const domain = {
    name: 'DexetraSessionRegistry',
    version: '1',
    chainId: Number(process.env.CHAIN_ID || 999),
    verifyingContract: process.env.SESSION_REGISTRY_ADDRESS,
  };
  
  const types = {
    CreateSession: [
      { name: 'trader', type: 'address' },
      { name: 'expiry', type: 'uint256' },
      { name: 'maxNotionalPerTrade', type: 'uint256' },
      { name: 'maxNotionalPerSession', type: 'uint256' },
      { name: 'methodsBitmap', type: 'bytes32' },
      { name: 'nonce', type: 'uint256' },
    ],
  };
  
  const expiry = Math.floor(Date.now() / 1000) + 86400; // 24 hours
  const maxNotionalPerTrade = ethers.parseUnits('10000', 6); // $10k per trade
  const maxNotionalPerSession = ethers.parseUnits('100000', 6); // $100k per session
  const methodsBitmap = '0x000000000000000000000000000000000000000000000000000000000000003f'; // All methods
  
  const message = {
    trader: wallet.address,
    expiry,
    maxNotionalPerTrade,
    maxNotionalPerSession,
    methodsBitmap,
    nonce: BigInt(nonce),
  };
  
  const signature = await wallet.signTypedData(domain, types, message);
  
  // Submit session creation
  const createRes = await fetch(`${BASE_URL}/api/gasless/session/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      trader: wallet.address,
      expiry,
      maxNotionalPerTrade: maxNotionalPerTrade.toString(),
      maxNotionalPerSession: maxNotionalPerSession.toString(),
      methodsBitmap,
      nonce: nonce.toString(),
      signature,
    }),
  });
  
  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Session creation failed: ${err}`);
  }
  
  const { sessionId } = await createRes.json();
  console.log('   Session created:', sessionId.slice(0, 18) + '...');
  return sessionId;
}

async function placeSessionTrade(orderBook, sessionId, trader, price, amount, isBuy) {
  console.log(`\n📤 Placing ${isBuy ? 'BUY' : 'SELL'} order via gasless API...`);
  console.log(`   Price: $${price}`);
  console.log(`   Amount: ${amount} tokens`);
  
  const priceWei = ethers.parseUnits(price.toString(), 6);
  const amountWei = ethers.parseUnits(amount.toString(), 18);
  
  const startTime = Date.now();
  
  const res = await fetch(`${BASE_URL}/api/gasless/trade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderBook,
      method: 'sessionPlaceMarginLimit',
      sessionId,
      params: {
        trader,
        price: priceWei.toString(),
        amount: amountWei.toString(),
        isBuy,
      },
    }),
  });
  
  const elapsed = Date.now() - startTime;
  const data = await res.json();
  
  if (!res.ok) {
    console.log(`\n❌ Trade failed (${elapsed}ms):`, data.error || data);
    return { success: false, error: data.error };
  }
  
  console.log(`\n✅ Trade submitted (${elapsed}ms)`);
  console.log(`   TX Hash: ${data.txHash}`);
  if (data.blockNumber) console.log(`   Block: ${data.blockNumber}`);
  
  return { success: true, txHash: data.txHash, elapsed };
}

async function main() {
  const args = process.argv.slice(2);
  const symbol = args[0] || 'CRUDE-OIL-PRICE';
  const side = args[1] || 'sell';
  const priceArg = parseFloat(args[2] || '114');
  const amountArg = parseFloat(args[3] || '0.009'); // ~$1 at $112
  
  console.log('🧪 Session-Based Trade Test for Optimistic Order Book');
  console.log('='.repeat(55));
  console.log(`Symbol: ${symbol}`);
  console.log(`Side: ${side}`);
  console.log(`Price: $${priceArg}`);
  console.log(`Amount: ${amountArg} tokens (~$${(amountArg * priceArg).toFixed(2)} USD)`);
  
  if (!PRIVATE_KEY) {
    console.error('❌ OPTIMISTIC_OVERLAY_PRIVATE_KEY not set');
    process.exit(1);
  }
  
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    console.log(`\n🔑 Wallet: ${wallet.address}`);
    
    // Get market info
    const market = await getMarketInfo(symbol);
    
    // Get or create session
    const sessionId = await getOrCreateSession(wallet, market.market_address);
    
    // Place trade
    const result = await placeSessionTrade(
      market.market_address,
      sessionId,
      wallet.address,
      priceArg,
      amountArg,
      side.toLowerCase() === 'buy'
    );
    
    if (result.success) {
      console.log('\n🎉 SUCCESS! Check the browser for optimistic updates.');
      console.log('   The order book should update INSTANTLY before tx confirmation.');
    }
    
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

main();
