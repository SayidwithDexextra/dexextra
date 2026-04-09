#!/usr/bin/env node
/**
 * Direct trade script for testing optimistic order book updates
 * Places limit orders directly using the relayer key
 * 
 * Usage: node scripts/test-direct-trade.js [symbol] [side] [price] [amount]
 * Example: node scripts/test-direct-trade.js CRUDE-OIL-PRICE sell 113 0.01
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
const { ethers } = require('ethers');

const RPC_URL = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL;
let PRIVATE_KEY = process.env.OPTIMISTIC_OVERLAY_PRIVATE_KEY; // Dedicated key for testing optimistic overlay
if (PRIVATE_KEY && !PRIVATE_KEY.startsWith('0x')) PRIVATE_KEY = '0x' + PRIVATE_KEY;

// OrderBook ABI for placing orders
const ORDER_BOOK_ABI = [
  'function placeLimit(uint256 price, uint256 amount, bool isBuy) external returns (uint256 orderId)',
  'function placeMarginLimit(uint256 price, uint256 amount, bool isBuy) external returns (uint256 orderId)',
  'function bestBid() view returns (uint256)',
  'function bestAsk() view returns (uint256)',
  'function getOrder(uint256 orderId) view returns (tuple(uint256 orderId, address trader, uint256 price, uint256 amount, bool isBuy, uint256 timestamp, uint256 nextOrderId, uint256 marginRequired, bool isMarginOrder))',
  'function marketStatic() view returns (address vault, bytes32 marketId, bool useVWAP, uint256 vwapWindow)',
];

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

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

async function getOrderBookState(provider, orderBookAddress) {
  const ob = new ethers.Contract(orderBookAddress, ORDER_BOOK_ABI, provider);
  const [bestBid, bestAsk] = await Promise.all([
    ob.bestBid().catch(() => 0n),
    ob.bestAsk().catch(() => 0n),
  ]);
  return {
    bestBid: Number(bestBid) / 1e6,
    bestAsk: Number(bestAsk) / 1e6,
  };
}

async function placeLimitOrder(wallet, orderBookAddress, price, amount, isBuy) {
  const ob = new ethers.Contract(orderBookAddress, ORDER_BOOK_ABI, wallet);
  
  // Convert to contract units
  const priceWei = ethers.parseUnits(price.toString(), 6); // 6 decimals for USDC price
  const amountWei = ethers.parseUnits(amount.toString(), 18); // 18 decimals for token amount
  
  console.log(`\n📤 Placing ${isBuy ? 'BUY' : 'SELL'} MARGIN limit order...`);
  console.log(`   Price: $${price} (${priceWei.toString()} wei)`);
  console.log(`   Amount: ${amount} tokens (${amountWei.toString()} wei)`);
  console.log(`   Side: ${isBuy ? 'BUY (bid)' : 'SELL (ask)'}`);
  
  const startTime = Date.now();
  
  try {
    // Use placeMarginLimit since existing orders are margin orders
    const tx = await ob.placeMarginLimit(priceWei, amountWei, isBuy, {
      gasLimit: 800000,
    });
    
    console.log(`\n⏳ Transaction sent: ${tx.hash}`);
    console.log(`   Waiting for confirmation...`);
    
    const receipt = await tx.wait();
    const elapsed = Date.now() - startTime;
    
    console.log(`\n✅ Order placed in ${elapsed}ms`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
    
    return { success: true, txHash: tx.hash, elapsed };
  } catch (err) {
    console.error(`\n❌ Order failed:`, err.message);
    
    // Try to decode error
    if (err.data) {
      console.error('   Revert data:', err.data);
    }
    
    return { success: false, error: err.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const symbol = args[0] || 'CRUDE-OIL-PRICE';
  const side = args[1] || 'sell';
  const priceArg = parseFloat(args[2] || '0'); // 0 means use current best price + offset
  const amountArg = parseFloat(args[3] || '0.01'); // Small test amount
  
  console.log('🧪 Direct Trade Test for Optimistic Order Book');
  console.log('='.repeat(50));
  console.log(`Symbol: ${symbol}`);
  console.log(`Side: ${side}`);
  console.log(`Amount: ${amountArg} tokens (~$${(amountArg * 112).toFixed(2)} USD)`);
  
  if (!RPC_URL) {
    console.error('❌ RPC_URL not set in .env.local');
    process.exit(1);
  }
  
  if (!PRIVATE_KEY) {
    console.error('❌ PRIVATE_KEY not set in .env.local');
    process.exit(1);
  }
  
  try {
    // Setup provider and wallet
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    console.log(`\n🔑 Using wallet: ${wallet.address}`);
    
    // Get market info
    const market = await getMarketInfo(symbol);
    const orderBookAddress = market.market_address;
    
    // Get current order book state
    const obState = await getOrderBookState(provider, orderBookAddress);
    console.log(`\n📖 Current Order Book State:`);
    console.log(`   Best Bid: $${obState.bestBid || 'none'}`);
    console.log(`   Best Ask: $${obState.bestAsk || 'none'}`);
    
    // Determine price
    let price = priceArg;
    const isBuy = side.toLowerCase() === 'buy';
    
    if (price === 0) {
      // Use a price that won't immediately execute (for testing order placement)
      if (isBuy) {
        // Place bid below current best bid
        price = obState.bestBid > 0 ? obState.bestBid - 1 : 110;
      } else {
        // Place ask above current best ask (or above best bid if no asks)
        price = obState.bestAsk > 0 ? obState.bestAsk + 1 : (obState.bestBid > 0 ? obState.bestBid + 1 : 114);
      }
    }
    
    console.log(`\n💰 Order Price: $${price}`);
    
    // Place the order
    const result = await placeLimitOrder(wallet, orderBookAddress, price, amountArg, isBuy);
    
    if (result.success) {
      console.log('\n🎉 SUCCESS! Order placed.');
      console.log('   Now check the browser - the order book should update INSTANTLY');
      console.log('   via the optimistic lightweight order book state.');
      console.log(`\n   Transaction: ${result.txHash}`);
    } else {
      console.log('\n💔 Order placement failed. See error above.');
    }
    
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

main();
