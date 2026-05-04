#!/usr/bin/env npx tsx
/**
 * Diagnostic script to test order book depth queries
 * Usage: npx tsx scripts/test-orderbook-depth.ts [symbol] [orderBookAddress]
 */

import { createPublicClient, http, parseAbi, defineChain, type Address } from 'viem';

// Hardcoded chain config for script use
const hyperliquid = defineChain({
  id: 998,
  name: 'HyperEVM',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.hyperliquid.xyz/evm'] },
    public: { http: ['https://rpc.hyperliquid.xyz/evm'] },
  },
});

const RPC_URL = 'https://rpc.hyperliquid.xyz/evm';

const OB_ABI = parseAbi([
  'function getOrderBookDepth(uint256 levels) external view returns (uint256[] bidPrices, uint256[] bidAmounts, uint256[] askPrices, uint256[] askAmounts)',
  'function getOrderBookDepthFromPointers(uint256 levels) external view returns (uint256[] bidPrices, uint256[] bidAmounts, uint256[] askPrices, uint256[] askAmounts)',
  'function getActiveOrdersCount() external view returns (uint256 buyCount, uint256 sellCount)',
  'function bestBid() external view returns (uint256)',
  'function bestAsk() external view returns (uint256)',
  'function getUserOrders(address user) external view returns (uint256[] orderIds)',
  'function getOrder(uint256 orderId) external view returns (uint256 orderId_, address trader, uint256 price, uint256 amount, bool isBuy, uint256 timestamp, uint256 nextOrderId, uint256 marginRequired, bool isMarginOrder)',
]);

const PRICE_DECIMALS = 6;
const AMOUNT_DECIMALS = 18;

function formatPrice(raw: bigint): number {
  return Number(raw) / Math.pow(10, PRICE_DECIMALS);
}

function formatAmount(raw: bigint): number {
  return Number(raw) / Math.pow(10, AMOUNT_DECIMALS);
}

async function main() {
  const symbol = process.argv[2] || 'GOLD';
  const orderBookAddress = process.argv[3] as Address | undefined;

  console.log(`\n🔍 Testing order book depth for: ${symbol}\n`);

  if (!orderBookAddress) {
    console.log('Usage: npx tsx scripts/test-orderbook-depth.ts <symbol> <orderBookAddress>');
    console.log('Example: npx tsx scripts/test-orderbook-depth.ts GOLD 0x1234...');
    console.log('\nTo find the order book address, check your browser console for logs like:');
    console.log('  [orderbook/live] Depth from scan for GOLD: ...');
    process.exit(1);
  }

  // Create client
  const client = createPublicClient({
    chain: hyperliquid,
    transport: http(RPC_URL),
  });

  console.log(`📍 Order Book Address: ${orderBookAddress}\n`);

  // Test 1: Get active order counts
  console.log('═══════════════════════════════════════════════════');
  console.log('TEST 1: getActiveOrdersCount()');
  console.log('═══════════════════════════════════════════════════');
  try {
    const [buyCount, sellCount] = await client.readContract({
      address: orderBookAddress,
      abi: OB_ABI,
      functionName: 'getActiveOrdersCount',
    });
    console.log(`✅ Buy orders: ${buyCount}`);
    console.log(`✅ Sell orders: ${sellCount}`);
    console.log(`   Total: ${Number(buyCount) + Number(sellCount)}`);
  } catch (err) {
    console.error('❌ Failed:', err);
  }

  // Test 2: Get best bid/ask
  console.log('\n═══════════════════════════════════════════════════');
  console.log('TEST 2: bestBid() / bestAsk()');
  console.log('═══════════════════════════════════════════════════');
  try {
    const [bestBid, bestAsk] = await Promise.all([
      client.readContract({ address: orderBookAddress, abi: OB_ABI, functionName: 'bestBid' }),
      client.readContract({ address: orderBookAddress, abi: OB_ABI, functionName: 'bestAsk' }),
    ]);
    console.log(`✅ Best Bid: $${formatPrice(bestBid)}`);
    console.log(`✅ Best Ask: $${formatPrice(bestAsk)}`);
    console.log(`   Spread: $${formatPrice(bestAsk - bestBid)}`);
  } catch (err) {
    console.error('❌ Failed:', err);
  }

  // Test 3: getOrderBookDepth (full scan)
  console.log('\n═══════════════════════════════════════════════════');
  console.log('TEST 3: getOrderBookDepth(25) - Full Scan');
  console.log('═══════════════════════════════════════════════════');
  try {
    const result = await client.readContract({
      address: orderBookAddress,
      abi: OB_ABI,
      functionName: 'getOrderBookDepth',
      args: [25n],
    });
    const [bidPrices, bidAmounts, askPrices, askAmounts] = result;
    console.log(`✅ Bid levels returned: ${bidPrices.length}`);
    console.log(`✅ Ask levels returned: ${askPrices.length}`);
    
    if (bidPrices.length > 0) {
      console.log('\n   Bids:');
      bidPrices.forEach((p, i) => {
        console.log(`     ${i + 1}. $${formatPrice(p).toFixed(4)} x ${formatAmount(bidAmounts[i]).toFixed(6)}`);
      });
    }
    
    if (askPrices.length > 0) {
      console.log('\n   Asks:');
      askPrices.forEach((p, i) => {
        console.log(`     ${i + 1}. $${formatPrice(p).toFixed(4)} x ${formatAmount(askAmounts[i]).toFixed(6)}`);
      });
    }
  } catch (err) {
    console.error('❌ Failed:', err);
  }

  // Test 4: getOrderBookDepthFromPointers
  console.log('\n═══════════════════════════════════════════════════');
  console.log('TEST 4: getOrderBookDepthFromPointers(25) - Pointer Walk');
  console.log('═══════════════════════════════════════════════════');
  try {
    const result = await client.readContract({
      address: orderBookAddress,
      abi: OB_ABI,
      functionName: 'getOrderBookDepthFromPointers',
      args: [25n],
    });
    const [bidPrices, bidAmounts, askPrices, askAmounts] = result;
    console.log(`✅ Bid levels returned: ${bidPrices.length}`);
    console.log(`✅ Ask levels returned: ${askPrices.length}`);
    
    if (bidPrices.length > 0) {
      console.log('\n   Bids:');
      bidPrices.forEach((p, i) => {
        console.log(`     ${i + 1}. $${formatPrice(p).toFixed(4)} x ${formatAmount(bidAmounts[i]).toFixed(6)}`);
      });
    }
    
    if (askPrices.length > 0) {
      console.log('\n   Asks:');
      askPrices.forEach((p, i) => {
        console.log(`     ${i + 1}. $${formatPrice(p).toFixed(4)} x ${formatAmount(askAmounts[i]).toFixed(6)}`);
      });
    }
  } catch (err) {
    console.error('❌ Failed:', err);
  }

  // Test 5: Get user's orders via getUserOrders
  const userWallet = process.argv[4] as Address | undefined;
  
  if (userWallet) {
    console.log('\n═══════════════════════════════════════════════════');
    console.log(`TEST 5: getUserOrders(${userWallet.slice(0, 10)}...)`);
    console.log('═══════════════════════════════════════════════════');
    try {
      const orderIds = await client.readContract({
        address: orderBookAddress,
        abi: OB_ABI,
        functionName: 'getUserOrders',
        args: [userWallet],
      });
      
      console.log(`✅ User has ${orderIds.length} order IDs:`, orderIds.map(String));
      
      if (orderIds.length > 0) {
        console.log('\n   Fetching order details...');
        const orders: { id: bigint; price: number; amount: number; isBuy: boolean; nextOrderId: bigint }[] = [];
        
        for (const orderId of orderIds) {
          try {
            const result = await client.readContract({
              address: orderBookAddress,
              abi: OB_ABI,
              functionName: 'getOrder',
              args: [orderId],
            });
            const [id, trader, price, amount, isBuy, timestamp, nextOrderId] = result as [bigint, string, bigint, bigint, boolean, bigint, bigint, bigint, boolean];
            
            orders.push({
              id,
              price: formatPrice(price),
              amount: formatAmount(amount),
              isBuy,
              nextOrderId,
            });
          } catch (err) {
            console.log(`   ❌ Failed to fetch order ${orderId}:`, err);
          }
        }
        
        const buyOrders = orders.filter(o => o.isBuy).sort((a, b) => b.price - a.price);
        const sellOrders = orders.filter(o => !o.isBuy).sort((a, b) => a.price - b.price);
        
        if (buyOrders.length > 0) {
          console.log('\n   Buy Orders (sorted by price desc):');
          buyOrders.forEach(o => {
            console.log(`     ID ${o.id}: $${o.price.toFixed(4)} x ${o.amount.toFixed(6)} (nextOrderId: ${o.nextOrderId})`);
          });
          
          const uniqueBidPrices = new Set(buyOrders.map(o => o.price.toFixed(4)));
          console.log(`\n   📊 Unique bid price levels: ${uniqueBidPrices.size}`);
          console.log(`   📊 Total bid orders: ${buyOrders.length}`);
          console.log(`   📊 Depth function returned: 1 level`);
          if (uniqueBidPrices.size > 1) {
            console.log(`   ⚠️  BUG CONFIRMED: ${uniqueBidPrices.size} unique prices but depth returns only 1 level!`);
          }
        }
        
        if (sellOrders.length > 0) {
          console.log('\n   Sell Orders (sorted by price asc):');
          sellOrders.forEach(o => {
            console.log(`     ID ${o.id}: $${o.price.toFixed(4)} x ${o.amount.toFixed(6)} (nextOrderId: ${o.nextOrderId})`);
          });
          
          const uniqueAskPrices = new Set(sellOrders.map(o => o.price.toFixed(4)));
          console.log(`\n   📊 Unique ask price levels: ${uniqueAskPrices.size}`);
          console.log(`   📊 Total ask orders: ${sellOrders.length}`);
        }
      }
    } catch (err) {
      console.error('❌ getUserOrders failed:', err);
    }
  } else {
    console.log('\n═══════════════════════════════════════════════════');
    console.log('TEST 5: Skipped (no wallet address provided)');
    console.log('═══════════════════════════════════════════════════');
    console.log('   Usage: npx tsx scripts/test-orderbook-depth.ts <symbol> <orderBookAddress> <walletAddress>');
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('DIAGNOSIS');
  console.log('═══════════════════════════════════════════════════');
  console.log('If active order count is higher than depth levels returned,');
  console.log('there is likely a bug in the contract depth aggregation functions.');
  console.log('\nPossible causes:');
  console.log('  1. Orders not being properly indexed by price level');
  console.log('  2. Linked list pointers not correctly linking price levels');
  console.log('  3. Depth function only returning best bid/ask instead of all levels');
  console.log('═══════════════════════════════════════════════════\n');
}

main().catch(console.error);
