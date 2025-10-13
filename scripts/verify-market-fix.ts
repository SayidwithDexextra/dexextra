#!/usr/bin/env node

/**
 * Verification Script: Test Market ID Fix
 * 
 * This script verifies that using the correct market ID resolves the "market not found" error
 */

const { createPublicClient, http } = require('viem');
const { polygon } = require('viem/chains');

type Address = `0x${string}`;

// Updated contract addresses and market ID
const CONTRACT_ADDRESSES = {
  tradingRouter: '0x740C78Ab819a3ceeBaCC544350ef40EA1B790C2B' as Address,
  orderBookFactory: '0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75' as Address,
} as const;

// CORRECTED market ID (discovered from debug script)
const CORRECTED_ALUMINUM_MARKET_ID = '0x41e77fd5318a7e3c379ff8fe985be494211c1b2a0a0fa1fa2f99ac7d5060892a';

// Create public client
const publicClient = createPublicClient({
  chain: polygon,
  transport: http('https://polygon-rpc.com/'),
});

// Minimal ABIs for testing
const FACTORY_ABI = [
  {
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    name: 'getOrderBook',
    outputs: [{ name: '', type: 'address' }],
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

async function verifyMarketFix() {
  console.log('🔧 Verifying Market ID Fix...\n');

  try {
    // 1. Get factory address from TradingRouter
    const factoryAddress = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.tradingRouter,
      abi: TRADING_ROUTER_ABI,
      functionName: 'factory',
      args: [],
    });
    
    console.log(`✅ Factory address: ${factoryAddress}`);

    // 2. Test if corrected market ID resolves to an OrderBook
    console.log('\n📋 Testing Corrected Market ID...');
    console.log('='.repeat(50));
    
    try {
      const orderBookAddress = await publicClient.readContract({
        address: factoryAddress as Address,
        abi: FACTORY_ABI,
        functionName: 'getOrderBook',
        args: [CORRECTED_ALUMINUM_MARKET_ID],
      });
      
      console.log(`✅ SUCCESS! Market ID resolves to OrderBook: ${orderBookAddress}`);
      
      // Verify it's not zero address
      if (orderBookAddress !== '0x0000000000000000000000000000000000000000') {
        console.log('✅ OrderBook address is valid (not zero address)');
        console.log('✅ TradingRouter._getOrderBook() should now work!');
        
        return {
          success: true,
          orderBookAddress,
          marketId: CORRECTED_ALUMINUM_MARKET_ID
        };
      } else {
        console.log('❌ OrderBook address is zero - market not properly configured');
        return { success: false, error: 'Zero address returned' };
      }
      
    } catch (error: any) {
      console.log(`❌ FAILED: ${error.message}`);
      return { success: false, error: error.message };
    }
    
  } catch (error: any) {
    console.error('❌ Verification failed:', error.message);
    return { success: false, error: error.message };
  }
}

async function simulateTradingRouterCall() {
  console.log('\n🎯 Simulating TradingRouter Call...');
  console.log('='.repeat(50));
  
  // Simulate what happens inside TradingRouter._getOrderBook()
  try {
    const factoryAddress = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.tradingRouter,
      abi: TRADING_ROUTER_ABI,
      functionName: 'factory',
      args: [],
    });
    
    const orderBookAddress = await publicClient.readContract({
      address: factoryAddress as Address,
      abi: FACTORY_ABI,
      functionName: 'getOrderBook',
      args: [CORRECTED_ALUMINUM_MARKET_ID],
    });
    
    console.log('✅ TradingRouter flow simulation:');
    console.log(`   1. TradingRouter.factory() → ${factoryAddress}`);
    console.log(`   2. Factory.getOrderBook(${CORRECTED_ALUMINUM_MARKET_ID}) → ${orderBookAddress}`);
    console.log('   3. ✅ No "market not found" error!');
    
    return true;
  } catch (error: any) {
    console.log(`❌ Simulation failed: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Starting Market ID Fix Verification\n');
  
  const result = await verifyMarketFix();
  const simulationSuccess = await simulateTradingRouterCall();
  
  console.log('\n📊 VERIFICATION RESULTS');
  console.log('='.repeat(50));
  
  if (result.success && simulationSuccess) {
    console.log('✅ FIX CONFIRMED! The corrected market ID resolves the issue.');
    console.log('✅ TradingRouter.placeLimitOrder() should now work.');
    console.log('✅ TradingRouter.placeMarketOrder() should now work.');
    console.log('\n🎯 Next Steps:');
    console.log('   1. Deploy the updated code with corrected market ID');
    console.log('   2. Test trading operations in the UI');
    console.log('   3. Both market and limit orders should work without errors');
  } else {
    console.log('❌ Fix verification failed. Additional investigation needed.');
    console.log(`   Error: ${result.error}`);
  }
  
  console.log('\n✅ Verification complete!');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { verifyMarketFix };