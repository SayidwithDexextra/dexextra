/**
 * Register Arbitrum SpokeVault on Hyperliquid CollateralHub
 * 
 * Run: npx hardhat run scripts/register-arbitrum-spoke.js --network hyperliquid
 */

const { ethers } = require("hardhat");

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("🔗 REGISTER ARBITRUM SPOKE ON HYPERLIQUID COLLATERAL HUB");
  console.log("═".repeat(80));

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log(`\n🌐 Network: hyperliquid (Chain ID: ${network.chainId})`);
  console.log(`📋 Deployer: ${deployer.address}`);

  // Contract addresses
  const COLLATERAL_HUB = "0xB4d81a5093dB98de9088a061fb1b3982Fe09D3b5";
  const ARBITRUM_CHAIN_ID = 42161;
  const ARBITRUM_SPOKE_VAULT = "0x12684fE7d4b44c0Ef02AC2815742b46107E86091";
  const ARBITRUM_USDC = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8";

  console.log(`\n📋 Configuration:`);
  console.log(`   CollateralHub: ${COLLATERAL_HUB}`);
  console.log(`   Arbitrum Chain ID: ${ARBITRUM_CHAIN_ID}`);
  console.log(`   Arbitrum SpokeVault: ${ARBITRUM_SPOKE_VAULT}`);
  console.log(`   Arbitrum USDC.e: ${ARBITRUM_USDC}`);

  // Get CollateralHub contract
  const collateralHub = await ethers.getContractAt("CollateralHub", COLLATERAL_HUB);

  // Check if spoke is already registered
  console.log("\n" + "─".repeat(60));
  console.log("📦 CHECKING EXISTING REGISTRATION");
  console.log("─".repeat(60));

  const existingSpoke = await collateralHub.spokes(ARBITRUM_CHAIN_ID);
  if (existingSpoke.spokeVault !== ethers.ZeroAddress) {
    console.log(`  ⚠️  Spoke already registered for chain ${ARBITRUM_CHAIN_ID}:`);
    console.log(`     SpokeVault: ${existingSpoke.spokeVault}`);
    console.log(`     USDC: ${existingSpoke.usdc}`);
    console.log(`     Enabled: ${existingSpoke.enabled}`);
    
    if (existingSpoke.spokeVault === ARBITRUM_SPOKE_VAULT) {
      console.log(`\n  ✅ Already registered with correct address!`);
      return;
    } else {
      console.log(`\n  ⚠️  Different spoke address registered. Updating...`);
    }
  } else {
    console.log(`  No existing spoke for chain ${ARBITRUM_CHAIN_ID}`);
  }

  // Register the spoke
  console.log("\n" + "─".repeat(60));
  console.log("📦 REGISTERING ARBITRUM SPOKE");
  console.log("─".repeat(60));

  const spokeConfig = {
    spokeVault: ARBITRUM_SPOKE_VAULT,
    usdc: ARBITRUM_USDC,
    enabled: true
  };

  console.log(`  Registering spoke...`);
  const tx = await collateralHub.registerSpoke(ARBITRUM_CHAIN_ID, spokeConfig);
  console.log(`  Transaction hash: ${tx.hash}`);
  
  const receipt = await tx.wait();
  console.log(`  ✅ Spoke registered! Block: ${receipt.blockNumber}`);

  // Verify registration
  console.log("\n" + "─".repeat(60));
  console.log("📦 VERIFYING REGISTRATION");
  console.log("─".repeat(60));

  const registeredSpoke = await collateralHub.spokes(ARBITRUM_CHAIN_ID);
  console.log(`  SpokeVault: ${registeredSpoke.spokeVault}`);
  console.log(`  USDC: ${registeredSpoke.usdc}`);
  console.log(`  Enabled: ${registeredSpoke.enabled}`);

  if (registeredSpoke.spokeVault === ARBITRUM_SPOKE_VAULT && registeredSpoke.enabled) {
    console.log(`\n  ✅ Verification passed!`);
  } else {
    console.log(`\n  ❌ Verification failed!`);
  }

  // Summary
  console.log("\n" + "═".repeat(80));
  console.log("✅ ARBITRUM SPOKE REGISTRATION COMPLETE");
  console.log("═".repeat(80));
  console.log(`
📋 Registered Spoke:
   Chain ID: ${ARBITRUM_CHAIN_ID} (Arbitrum)
   SpokeVault: ${ARBITRUM_SPOKE_VAULT}
   USDC: ${ARBITRUM_USDC}
   Enabled: true

🔧 Cross-Chain Flow:
   1. User deposits USDC.e on Arbitrum → SpokeVault
   2. Bridge relayer calls CollateralHub.creditFromBridge()
   3. User's balance credited on Hyperliquid CoreVault
   4. User can trade with cross-chain collateral
`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ REGISTRATION FAILED:", error.message);
    console.error(error);
    process.exit(1);
  });
