/**
 * Add native USDC to Arbitrum SpokeVault
 * 
 * Run: npx hardhat run scripts/add-native-usdc.js --network arbitrum
 */

const { ethers } = require("hardhat");

async function main() {
  console.log("\n" + "═".repeat(60));
  console.log("➕ ADD NATIVE USDC TO SPOKEVAULT");
  console.log("═".repeat(60));

  const [deployer] = await ethers.getSigners();
  console.log(`\nDeployer: ${deployer.address}`);

  const SPOKE_VAULT = "0x12684fE7d4b44c0Ef02AC2815742b46107E86091";
  const NATIVE_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
  const USDC_E = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8";

  const spokeVault = await ethers.getContractAt("SpokeVault", SPOKE_VAULT);

  // Check current status
  console.log("\n📋 Current allowed tokens:");
  const usdceAllowed = await spokeVault.isAllowedToken(USDC_E);
  const nativeAllowed = await spokeVault.isAllowedToken(NATIVE_USDC);
  console.log(`   USDC.e (${USDC_E}): ${usdceAllowed}`);
  console.log(`   Native USDC (${NATIVE_USDC}): ${nativeAllowed}`);

  if (nativeAllowed) {
    console.log("\n✅ Native USDC already allowed!");
    return;
  }

  // Add native USDC
  console.log("\n➕ Adding native USDC...");
  const tx = await spokeVault.addAllowedToken(NATIVE_USDC);
  console.log(`   Tx: ${tx.hash}`);
  await tx.wait();
  console.log("   ✅ Transaction confirmed!");

  // Verify
  const nowAllowed = await spokeVault.isAllowedToken(NATIVE_USDC);
  console.log(`\n✅ Native USDC now allowed: ${nowAllowed}`);

  console.log("\n" + "═".repeat(60));
  console.log("✅ SPOKEVAULT NOW ACCEPTS BOTH USDC TOKENS");
  console.log("═".repeat(60));
  console.log(`
   USDC.e:      ${USDC_E}
   Native USDC: ${NATIVE_USDC}
`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error.message);
    process.exit(1);
  });
