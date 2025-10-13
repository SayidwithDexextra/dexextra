#!/usr/bin/env node

/**
 * Final Market Debug: Find the EXACT working solution
 * 
 * This script will test the actual market that exists and give us the exact fix
 */

const { createPublicClient, http } = require('viem');
const { polygon } = require('viem/chains');

type Address = `0x${string}`;

const CONTRACT_ADDRESSES = {
  tradingRouter: '0x740C78Ab819a3ceeBaCC544350ef40EA1B790C2B' as Address,
  orderBookFactory: '0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75' as Address,
} as const;

const publicClient = createPublicClient({
  chain: polygon,
  transport: http('https://polygon-rpc.com/'),
});

const FACTORY_ABI = [
  {
    inputs: [],
    name: 'getAllMarkets',
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    name: 'getMarket',
    outputs: [
      {
        components: [
          { name: 'orderBookAddress', type: 'address' },
          { name: 'symbol', type: 'string' },
          { name: 'isActive', type: 'bool' },
          { name: 'creator', type: 'address' }
        ],
        name: '',
        type: 'tuple'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'symbol', type: 'string' }],
    name: 'getMarketBySymbol',
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const;

const TRADING_ROUTER_ABI = [
  {
    inputs: [],
    name: 'factory',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const;

async function findWorkingMarket() {
  console.log('🔍 Finding the EXACT working market configuration...\n');

  try {
    // Get factory
    const factoryAddress = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.tradingRouter,
      abi: TRADING_ROUTER_ABI,
      functionName: 'factory',
      args: [],
    });
    
    console.log(`✅ Factory: ${factoryAddress}`);

    // Get all markets
    const allMarkets = await publicClient.readContract({
      address: factoryAddress as Address,
      abi: FACTORY_ABI,
      functionName: 'getAllMarkets',
      args: [],
    });
    
    console.log(`✅ Total markets: ${allMarkets.length}`);
    
    if (allMarkets.length === 0) {
      console.log('❌ No markets found! This is the root issue.');
      console.log('🛠️  SOLUTION: Need to create a market first using factory.createTraditionalMarket()');
      return;
    }

    // Test each market
    console.log('\n📋 Testing Each Market:');
    console.log('='.repeat(60));
    
    for (let i = 0; i < allMarkets.length; i++) {
      const marketId = allMarkets[i];
      console.log(`\n${i + 1}. Market ID: ${marketId}`);
      
      try {
        const marketInfo = await publicClient.readContract({
          address: factoryAddress as Address,
          abi: FACTORY_ABI,
          functionName: 'getMarket',
          args: [marketId],
        });
        
        console.log(`   ✅ OrderBook Address: ${marketInfo.orderBookAddress}`);
        console.log(`   ✅ Symbol: "${marketInfo.symbol}"`);
        console.log(`   ✅ Is Active: ${marketInfo.isActive}`);
        console.log(`   ✅ Creator: ${marketInfo.creator}`);
        
        // Check if this is a working market
        const isWorking = marketInfo.orderBookAddress !== '0x0000000000000000000000000000000000000000' && marketInfo.isActive;
        
        if (isWorking) {
          console.log(`   🎯 ✅ THIS MARKET WORKS! Use this market ID.`);
          
          return {
            marketId,
            symbol: marketInfo.symbol,
            orderBookAddress: marketInfo.orderBookAddress,
            isActive: marketInfo.isActive
          };
        } else {
          console.log(`   ❌ This market is not working (zero address or inactive)`);
        }
        
      } catch (error: any) {
        console.log(`   ❌ Error reading market: ${error.message}`);
      }
    }
    
    // If we get here, no markets are working
    console.log('\n❌ NO WORKING MARKETS FOUND!');
    console.log('🛠️  ROOT CAUSE: All markets have zero addresses or are inactive');
    
  } catch (error: any) {
    console.error('❌ Investigation failed:', error.message);
  }
}

async function testAluminumSymbolLookup() {
  console.log('\n🔍 Testing Aluminum Symbol Lookup...');
  console.log('='.repeat(50));
  
  try {
    const factoryAddress = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.tradingRouter,
      abi: TRADING_ROUTER_ABI,
      functionName: 'factory',
      args: [],
    });
    
    const marketId = await publicClient.readContract({
      address: factoryAddress as Address,
      abi: FACTORY_ABI,
      functionName: 'getMarketBySymbol',
      args: ['Aluminum V1'],
    });
    
    console.log(`✅ getMarketBySymbol("Aluminum V1") = ${marketId}`);
    
    // Now test if this market ID works
    const marketInfo = await publicClient.readContract({
      address: factoryAddress as Address,
      abi: FACTORY_ABI,
      functionName: 'getMarket',
      args: [marketId],
    });
    
    console.log('✅ Market Info for symbol lookup:');
    console.log(`   OrderBook: ${marketInfo.orderBookAddress}`);
    console.log(`   Symbol: "${marketInfo.symbol}"`);
    console.log(`   Active: ${marketInfo.isActive}`);
    
    const isWorking = marketInfo.orderBookAddress !== '0x0000000000000000000000000000000000000000' && marketInfo.isActive;
    
    if (isWorking) {
      console.log('🎯 ✅ SYMBOL LOOKUP WORKS! Use getMarketBySymbol instead of hardcoded ID.');
      return { marketId, ...marketInfo };
    } else {
      console.log('❌ Symbol lookup returns non-working market');
    }
    
  } catch (error: any) {
    console.log(`❌ Symbol lookup failed: ${error.message}`);
  }
}

async function main() {
  console.log('🚀 Final Market Debug - Finding the Real Solution\n');
  
  const workingMarket = await findWorkingMarket();
  const symbolMarket = await testAluminumSymbolLookup();
  
  console.log('\n📊 FINAL DIAGNOSIS');
  console.log('='.repeat(60));
  
  if (workingMarket || symbolMarket) {
    const market = workingMarket || symbolMarket;
    console.log('✅ SOLUTION FOUND!');
    console.log(`📍 Working Market ID: ${market.marketId}`);
    console.log(`📍 Symbol: "${market.symbol}"`);
    console.log(`📍 OrderBook: ${market.orderBookAddress}`);
    
    console.log('\n🛠️  IMPLEMENTATION FIX:');
    console.log(`// Use this exact market ID in contractConfig.ts:`);
    console.log(`marketId: '${market.marketId}',`);
    console.log(`symbol: '${market.symbol}',`);
    console.log(`orderBookAddress: '${market.orderBookAddress}',`);
    
  } else {
    console.log('❌ NO SOLUTION FOUND');
    console.log('🛠️  ROOT ISSUE: Factory has no working markets');
    console.log('🔧 REQUIRED ACTION: Create a market using factory.createTraditionalMarket("Aluminum V1")');
  }
  
  console.log('\n✅ Final debug complete!');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { findWorkingMarket };


