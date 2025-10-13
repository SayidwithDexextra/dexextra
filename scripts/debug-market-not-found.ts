#!/usr/bin/env node

/**
 * Debug Script: Market Not Found Issue
 * 
 * This script investigates why TradingRouter.placeLimitOrder() fails with "market not found"
 * and provides solutions to fix the issue.
 */

const { createPublicClient, http } = require('viem');
const { polygon } = require('viem/chains');

type Address = `0x${string}`;

// Contract addresses from contract-summary.md
const CONTRACT_ADDRESSES = {
  tradingRouter: '0x740C78Ab819a3ceeBaCC544350ef40EA1B790C2B' as Address,
  orderBookFactory: '0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75' as Address,
  aluminumOrderBook: '0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE' as Address,
  vaultRouter: '0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7' as Address,
} as const;

// Market info from contract-summary.md
const ALUMINUM_V1_MARKET = {
  marketId: '0x0ec5e3d580bc0eed6b9c47dc4f8b142f8b72a1ca1b87e4caa8b3ae2b0fd90b08' as const,
  symbol: 'Aluminum V1' as const,
  orderBookAddress: '0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE' as Address,
} as const;

// Create public client
const publicClient = createPublicClient({
  chain: polygon,
  transport: http('https://polygon-rpc.com/'),
});

// ABIs for investigation
const TRADING_ROUTER_ABI = [
  {
    inputs: [],
    name: 'factory',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'vaultRouter',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const;

const FACTORY_ABI = [
  {
    inputs: [{ name: 'symbol', type: 'string' }],
    name: 'getMarketBySymbol',
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    name: 'getOrderBook',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    name: 'marketExists',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'getAllMarkets',
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const;

const ORDERBOOK_ABI = [
  {
    inputs: [],
    name: 'market',
    outputs: [
      {
        components: [
          { name: 'marketId', type: 'bytes32' },
          { name: 'symbol', type: 'string' },
          { name: 'isActive', type: 'bool' }
        ],
        name: '',
        type: 'tuple'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  }
] as const;

async function investigateMarketNotFound() {
  console.log('🔍 Investigating "TradingRouter: market not found" error...\n');

  try {
    // 1. Check TradingRouter configuration
    console.log('📋 Step 1: Checking TradingRouter Configuration');
    console.log('='.repeat(50));
    
    const factoryAddress = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.tradingRouter,
      abi: TRADING_ROUTER_ABI,
      functionName: 'factory',
      args: [],
    });
    
    const vaultAddress = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.tradingRouter,
      abi: TRADING_ROUTER_ABI,
      functionName: 'vaultRouter',
      args: [],
    });
    
    console.log(`✅ TradingRouter.factory(): ${factoryAddress}`);
    console.log(`✅ TradingRouter.vaultRouter(): ${vaultAddress}`);
    console.log(`📍 Expected factory: ${CONTRACT_ADDRESSES.orderBookFactory}`);
    console.log(`📍 Expected vault: ${CONTRACT_ADDRESSES.vaultRouter}`);
    
    const factoryMatches = factoryAddress.toLowerCase() === CONTRACT_ADDRESSES.orderBookFactory.toLowerCase();
    const vaultMatches = vaultAddress.toLowerCase() === CONTRACT_ADDRESSES.vaultRouter.toLowerCase();
    
    console.log(`${factoryMatches ? '✅' : '❌'} Factory address matches: ${factoryMatches}`);
    console.log(`${vaultMatches ? '✅' : '❌'} Vault address matches: ${vaultMatches}\n`);

    // 2. Check if market exists in factory
    console.log('📋 Step 2: Checking Market Registration in Factory');
    console.log('='.repeat(50));
    
    try {
      const marketExists = await publicClient.readContract({
        address: factoryAddress as Address,
        abi: FACTORY_ABI,
        functionName: 'marketExists',
        args: [ALUMINUM_V1_MARKET.marketId],
      });
      
      console.log(`✅ Market exists in factory: ${marketExists}`);
      
      if (marketExists) {
        const orderBookFromFactory = await publicClient.readContract({
          address: factoryAddress as Address,
          abi: FACTORY_ABI,
          functionName: 'getOrderBook',
          args: [ALUMINUM_V1_MARKET.marketId],
        });
        
        console.log(`✅ OrderBook from factory: ${orderBookFromFactory}`);
        console.log(`📍 Expected OrderBook: ${ALUMINUM_V1_MARKET.orderBookAddress}`);
        
        const orderBookMatches = orderBookFromFactory.toLowerCase() === ALUMINUM_V1_MARKET.orderBookAddress.toLowerCase();
        console.log(`${orderBookMatches ? '✅' : '❌'} OrderBook address matches: ${orderBookMatches}`);
      }
      
    } catch (error: any) {
      console.log(`❌ Error checking market existence: ${error.message}`);
      
      // Try alternative methods
      try {
        console.log('🔄 Trying getMarketBySymbol...');
        const marketIdFromSymbol = await publicClient.readContract({
          address: factoryAddress as Address,
          abi: FACTORY_ABI,
          functionName: 'getMarketBySymbol',
          args: [ALUMINUM_V1_MARKET.symbol],
        });
        
        console.log(`✅ Market ID from symbol: ${marketIdFromSymbol}`);
        console.log(`📍 Expected market ID: ${ALUMINUM_V1_MARKET.marketId}`);
        
        const marketIdMatches = marketIdFromSymbol.toLowerCase() === ALUMINUM_V1_MARKET.marketId.toLowerCase();
        console.log(`${marketIdMatches ? '✅' : '❌'} Market ID matches: ${marketIdMatches}`);
        
      } catch (symbolError: any) {
        console.log(`❌ getMarketBySymbol also failed: ${symbolError.message}`);
      }
    }
    
    // 3. Check all available markets
    console.log('\n📋 Step 3: Listing All Available Markets');
    console.log('='.repeat(50));
    
    try {
      const allMarkets = await publicClient.readContract({
        address: factoryAddress as Address,
        abi: FACTORY_ABI,
        functionName: 'getAllMarkets',
        args: [],
      });
      
      console.log(`✅ Total markets in factory: ${allMarkets.length}`);
      
      if (allMarkets.length > 0) {
        console.log('📋 Available markets:');
        for (let i = 0; i < allMarkets.length; i++) {
          const marketId = allMarkets[i];
          console.log(`  ${i + 1}. ${marketId}`);
          
          if (marketId.toLowerCase() === ALUMINUM_V1_MARKET.marketId.toLowerCase()) {
            console.log(`     ✅ This is our target market!`);
          }
        }
      } else {
        console.log(`❌ No markets found in factory!`);
      }
      
    } catch (error: any) {
      console.log(`❌ Error getting all markets: ${error.message}`);
    }
    
    // 4. Check OrderBook directly
    console.log('\n📋 Step 4: Checking OrderBook Contract Directly');
    console.log('='.repeat(50));
    
    try {
      const marketInfo = await publicClient.readContract({
        address: ALUMINUM_V1_MARKET.orderBookAddress,
        abi: ORDERBOOK_ABI,
        functionName: 'market',
        args: [],
      });
      
      console.log('✅ OrderBook market info:', {
        marketId: marketInfo.marketId,
        symbol: marketInfo.symbol,
        isActive: marketInfo.isActive
      });
      
      const directMarketIdMatches = marketInfo.marketId.toLowerCase() === ALUMINUM_V1_MARKET.marketId.toLowerCase();
      console.log(`${directMarketIdMatches ? '✅' : '❌'} Direct market ID matches: ${directMarketIdMatches}`);
      console.log(`${marketInfo.isActive ? '✅' : '❌'} Market is active: ${marketInfo.isActive}`);
      
    } catch (error: any) {
      console.log(`❌ Error reading OrderBook directly: ${error.message}`);
    }
    
    // 5. Provide diagnosis and solutions
    console.log('\n📋 Step 5: Diagnosis & Solutions');
    console.log('='.repeat(50));
    
    await provideSolutions();
    
  } catch (error: any) {
    console.error('❌ Investigation failed:', error.message);
  }
}

async function provideSolutions() {
  console.log('🎯 DIAGNOSIS:');
  console.log('The "TradingRouter: market not found" error occurs when:');
  console.log('1. The market ID is not registered in the OrderBookFactory');
  console.log('2. The TradingRouter._getOrderBook() function cannot find the market');
  console.log('3. The factory is not properly configured or initialized\n');
  
  console.log('💡 POTENTIAL SOLUTIONS:');
  console.log('');
  
  console.log('Solution 1: Register the market in the factory');
  console.log('- The Aluminum V1 market may not be properly registered');
  console.log('- Need to call factory.createMarket() or similar registration function');
  console.log('');
  
  console.log('Solution 2: Use direct OrderBook interaction');
  console.log('- Bypass TradingRouter and call OrderBook directly');
  console.log('- More reliable but loses unified interface benefits');
  console.log('');
  
  console.log('Solution 3: Fix TradingRouter._getOrderBook() implementation');
  console.log('- The function may not be properly implemented');
  console.log('- May need contract upgrade or configuration fix');
  console.log('');
  
  console.log('Solution 4: Alternative market ID resolution');
  console.log('- Try different market ID formats or resolution methods');
  console.log('- Use string-based symbol lookup instead of bytes32 ID');
  console.log('');
}

// Test different market ID formats
async function testMarketIdFormats() {
  console.log('\n🔬 Testing Different Market ID Formats');
  console.log('='.repeat(50));
  
  const testIds = [
    ALUMINUM_V1_MARKET.marketId,
    '0x' + ALUMINUM_V1_MARKET.marketId.slice(2).toLowerCase(),
    '0x' + ALUMINUM_V1_MARKET.marketId.slice(2).toUpperCase(),
    // Try encoding "Aluminum V1" as bytes32
    '0x' + Buffer.from('Aluminum V1').toString('hex').padEnd(64, '0'),
    // Try keccak256 hash of symbol
    // This would need actual keccak256 implementation
  ];
  
  for (const testId of testIds) {
    console.log(`Testing market ID: ${testId}`);
    // Would test each format here
  }
}

// Generate fix implementation
async function generateFixImplementation() {
  console.log('\n🛠️  IMPLEMENTATION FIXES');
  console.log('='.repeat(50));
  
  console.log(`
// Fix 1: Update useTradingRouter to use direct OrderBook calls
const placeLimitOrderDirect = useCallback(async (params: LimitOrderParams): Promise<OrderResult> => {
  if (!walletClient) {
    return { success: false, error: 'Wallet not connected' };
  }

  try {
    // Use OrderBook directly instead of TradingRouter
    const orderBookAddress = '${ALUMINUM_V1_MARKET.orderBookAddress}';
    
    const sideValue = params.side === 'long' ? 0 : 1; // BUY = 0, SELL = 1
    const sizeFormatted = parseEther(params.size.toString());
    const priceFormatted = parseEther(params.price.toString());

    const { request } = await publicClient.simulateContract({
      address: orderBookAddress,
      abi: ORDERBOOK_DIRECT_ABI,
      functionName: 'placeLimitOrder',
      args: [sideValue, sizeFormatted, priceFormatted],
      account: walletData.address as Address,
    });

    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return {
      success: true,
      transactionHash: hash,
      orderId: hash
    };

  } catch (error: any) {
    return { success: false, error: error?.shortMessage || error?.message };
  }
}, [walletClient, walletData.address]);

// Fix 2: Alternative market registration check
const ensureMarketRegistered = useCallback(async (marketId: string): Promise<boolean> => {
  try {
    const factoryAddress = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.tradingRouter,
      abi: TRADING_ROUTER_ABI,
      functionName: 'factory',
      args: [],
    });

    const marketExists = await publicClient.readContract({
      address: factoryAddress as Address,
      abi: FACTORY_ABI,
      functionName: 'marketExists',
      args: [marketId],
    });

    if (!marketExists) {
      console.warn('Market not registered in factory:', marketId);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error checking market registration:', error);
    return false;
  }
}, []);
  `);
}

// Main execution
async function main() {
  console.log('🚀 Starting Market Not Found Investigation\n');
  
  await investigateMarketNotFound();
  await testMarketIdFormats();
  await generateFixImplementation();
  
  console.log('\n✅ Investigation complete! Check the solutions above.');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { investigateMarketNotFound, provideSolutions };

