#!/usr/bin/env tsx
/**
 * Quick test trade for optimistic order book updates
 * Uses the existing AdvancedMarketAutomation infrastructure
 * 
 * Usage: tsx scripts/quick-test-trade.ts [symbol] [side] [price] [amount]
 * Example: tsx scripts/quick-test-trade.ts CRUDE-OIL-PRICE sell 114 0.009
 */

import path from 'node:path';
import { Wallet } from 'ethers';

// Use the AMA lib
import { loadAmaEnv } from '../AdvancedMarketAutomation/lib/env';
import { fetchActiveMarkets } from '../AdvancedMarketAutomation/lib/markets';
import { 
  buildSessionPermit, 
  createGaslessSessionViaApi, 
  fetchRelayerSetRoot, 
  fetchSessionNonce, 
  signSessionPermit 
} from '../AdvancedMarketAutomation/lib/gaslessSession';
import { submitSessionTrade } from '../AdvancedMarketAutomation/lib/gaslessTrade';

async function main() {
  const args = process.argv.slice(2);
  const symbol = args[0] || 'CRUDE-OIL-PRICE';
  const side = args[1] || 'sell';
  const priceArg = parseFloat(args[2] || '114');
  const amountArg = parseFloat(args[3] || '0.009');
  
  console.log('🧪 Quick Test Trade for Optimistic Order Book');
  console.log('='.repeat(50));
  console.log(`Symbol: ${symbol}`);
  console.log(`Side: ${side}`);
  console.log(`Price: $${priceArg}`);
  console.log(`Amount: ${amountArg} tokens (~$${(amountArg * priceArg).toFixed(2)} USD)`);
  
  const env = loadAmaEnv();
  
  // Load the test wallet
  let pk = process.env.OPTIMISTIC_OVERLAY_PRIVATE_KEY;
  if (!pk) throw new Error('OPTIMISTIC_OVERLAY_PRIVATE_KEY not set');
  if (!pk.startsWith('0x')) pk = '0x' + pk;
  
  const wallet = new Wallet(pk);
  console.log(`\n🔑 Wallet: ${wallet.address}`);
  
  // Find market
  console.log(`\n📊 Fetching markets from ${env.appUrl}...`);
  const markets = await fetchActiveMarkets(env.appUrl, 200);
  const market = markets.find(m => m.symbol?.toUpperCase() === symbol.toUpperCase());
  if (!market) throw new Error(`Market not found: ${symbol}`);
  
  console.log(`   Found: ${market.symbol}`);
  console.log(`   OrderBook: ${market.market_address}`);
  
  const orderBook = market.market_address;
  const chainId = env.chainId;
  
  // Create session
  console.log('\n🔑 Creating trading session...');
  const nowSec = Math.floor(Date.now() / 1000);
  const expiry = nowSec + 3600; // 1 hour
  
  const nonce = await fetchSessionNonce(env.appUrl, wallet.address);
  const relayerSetRoot = await fetchRelayerSetRoot(env.appUrl);
  
  const permit = buildSessionPermit({
    trader: wallet.address,
    relayerSetRoot,
    expirySec: expiry,
    nonce,
    allowedMarkets: [market.market_id_bytes32 as `0x${string}`],
  });
  
  const sig = await signSessionPermit({
    privateKey: pk,
    chainId,
    registryAddress: env.sessionRegistryAddress,
    permit,
  });
  
  const session = await createGaslessSessionViaApi({
    appUrl: env.appUrl,
    orderBook,
    permit,
    signature: sig,
  });
  
  console.log(`   Session created: ${session.sessionId.slice(0, 18)}...`);
  
  // Place trade
  const isBuy = side.toLowerCase() === 'buy';
  const price6 = BigInt(Math.round(priceArg * 1_000_000));
  const amount18 = BigInt(Math.round(amountArg * 1_000_000_000_000_000_000));
  
  console.log(`\n📤 Placing ${isBuy ? 'BUY' : 'SELL'} MARGIN limit order...`);
  console.log(`   Price: $${priceArg} (${price6.toString()})`);
  console.log(`   Amount: ${amountArg} tokens (${amount18.toString()})`);
  
  const startTime = Date.now();
  
  const result = await submitSessionTrade({
    appUrl: env.appUrl,
    orderBook,
    method: 'sessionPlaceMarginLimit',
    sessionId: session.sessionId,
    tradeParams: {
      trader: wallet.address,
      price: price6.toString(),
      amount: amount18.toString(),
      isBuy,
    },
  });
  
  const elapsed = Date.now() - startTime;
  
  console.log(`\n✅ Trade submitted in ${elapsed}ms`);
  console.log(`   TX Hash: ${result.txHash}`);
  if (result.blockNumber) console.log(`   Block: ${result.blockNumber}`);
  
  console.log('\n🎉 SUCCESS! Check the browser for optimistic updates.');
  console.log('   The order book should have updated INSTANTLY before tx confirmation.');
}

main().catch((e) => {
  console.error('\n❌ Error:', e?.message || e);
  process.exit(1);
});
