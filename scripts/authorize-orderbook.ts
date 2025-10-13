import { ethers } from 'hardhat';
import { VaultRouter } from '../typechain-types';

/**
 * Authorization script for OrderBook and VaultRouter integration
 * This script grants the necessary permissions for the OrderBook to interact with VaultRouter
 */

// Contract addresses
const VAULTROUTER_ADDRESS = '0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7';
const ORDERBOOK_ADDRESS = '0xaA5662ab1bF7BA1055B8C63281b764aF65553fec'; // Aluminum V2

// Derived from our diagnostic - these are the exact values needed
const ORDERBOOK_ROLE = '0xe7d7e4bf430fa940e5a18beda68ad1833bb0bb84161df1150cd5a705786bf6e7';
const MARKET_ID = '0x88f2de2739bd614453f56cfec79f0456ef2829a0a56b36a410723613bcf2415b';

async function main() {
  console.log('🚀 OrderBook Authorization Script');
  console.log('=================================\n');

  // Get the signer (admin wallet)
  const [signer] = await ethers.getSigners();
  console.log('📋 Admin wallet:', signer.address);
  console.log('📋 Network:', (await ethers.provider.getNetwork()).name);
  console.log('📋 Chain ID:', (await ethers.provider.getNetwork()).chainId);
  console.log('');

  // Get VaultRouter contract
  console.log('🔗 Connecting to VaultRouter...');
  const vaultRouter = await ethers.getContractAt('VaultRouter', VAULTROUTER_ADDRESS) as VaultRouter;
  console.log('✅ VaultRouter connected:', VAULTROUTER_ADDRESS);
  console.log('');

  // Check current status
  console.log('🔍 Checking current authorization status...');
  
  const hasRole = await vaultRouter.hasRole(ORDERBOOK_ROLE, ORDERBOOK_ADDRESS);
  const isMarketAuthorized = await vaultRouter.authorizedMarkets(MARKET_ID);
  
  console.log(`   OrderBook has ORDERBOOK_ROLE: ${hasRole ? '✅ YES' : '❌ NO'}`);
  console.log(`   Market is authorized: ${isMarketAuthorized ? '✅ YES' : '❌ NO'}`);
  console.log('');

  let transactionsNeeded = 0;

  // 1. Grant ORDERBOOK_ROLE if not already granted
  if (!hasRole) {
    console.log('1️⃣  Granting ORDERBOOK_ROLE...');
    console.log('   Role:', ORDERBOOK_ROLE);
    console.log('   Account:', ORDERBOOK_ADDRESS);
    
    try {
      const tx1 = await vaultRouter.grantRole(ORDERBOOK_ROLE, ORDERBOOK_ADDRESS);
      console.log('   Transaction hash:', tx1.hash);
      console.log('   ⏳ Waiting for confirmation...');
      
      const receipt1 = await tx1.wait();
      console.log('   ✅ ORDERBOOK_ROLE granted! Block:', receipt1?.blockNumber);
      transactionsNeeded++;
    } catch (error: any) {
      console.error('   ❌ Failed to grant role:', error.message);
      throw error;
    }
  } else {
    console.log('1️⃣  ✅ ORDERBOOK_ROLE already granted');
  }
  console.log('');

  // 2. Authorize market if not already authorized
  if (!isMarketAuthorized) {
    console.log('2️⃣  Authorizing market...');
    console.log('   Market ID:', MARKET_ID);
    console.log('   Authorized:', true);
    
    try {
      const tx2 = await vaultRouter.setMarketAuthorization(MARKET_ID, true);
      console.log('   Transaction hash:', tx2.hash);
      console.log('   ⏳ Waiting for confirmation...');
      
      const receipt2 = await tx2.wait();
      console.log('   ✅ Market authorized! Block:', receipt2?.blockNumber);
      transactionsNeeded++;
    } catch (error: any) {
      console.error('   ❌ Failed to authorize market:', error.message);
      throw error;
    }
  } else {
    console.log('2️⃣  ✅ Market already authorized');
  }
  console.log('');

  // Final verification
  console.log('🔍 Final verification...');
  const finalHasRole = await vaultRouter.hasRole(ORDERBOOK_ROLE, ORDERBOOK_ADDRESS);
  const finalIsMarketAuthorized = await vaultRouter.authorizedMarkets(MARKET_ID);
  
  console.log(`   OrderBook has ORDERBOOK_ROLE: ${finalHasRole ? '✅ YES' : '❌ NO'}`);
  console.log(`   Market is authorized: ${finalIsMarketAuthorized ? '✅ YES' : '❌ NO'}`);
  console.log('');

  if (finalHasRole && finalIsMarketAuthorized) {
    console.log('🎉 SUCCESS! OrderBook authorization complete!');
    console.log('');
    console.log('✅ The OrderBook can now:');
    console.log('   - Reserve margin for new orders');
    console.log('   - Lock margin for filled orders');
    console.log('   - Update user positions');
    console.log('   - Process settlements');
    console.log('');
    console.log('🚀 Trading should now work on the Aluminum V2 market!');
    
    if (transactionsNeeded > 0) {
      console.log('');
      console.log('📊 Summary:');
      console.log(`   Transactions executed: ${transactionsNeeded}`);
      console.log('   Status: Complete');
    }
  } else {
    console.log('❌ FAILED: Authorization incomplete');
    console.log('   Please check admin permissions and try again');
  }
}

// Error handling
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('💥 Script failed:', error);
    process.exit(1);
  });
