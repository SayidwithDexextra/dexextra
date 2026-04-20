const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const orderBook = "0xaB69f1906114D891A6A90212a013fc1aE5A1002a";
  const marketId = "0x385f306b03d718570a850d4d785c69dfe2961d44e2a80bd2cb2cb9ab2bf9df63";
  const wallet = "0x724cbe7b515dab1ce4b0e262990d2e3c47c6ca36";
  
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);
  
  const coreVault = await ethers.getContractAt(
    [
      "function hasRole(bytes32,address) view returns (bool)",
      "function ORDERBOOK_ROLE() view returns (bytes32)",
      "function grantRole(bytes32,address)",
      "function revokeRole(bytes32,address)",
      "function liquidateDirect(bytes32,address)",
    ],
    process.env.CORE_VAULT_ADDRESS,
    signer
  );
  
  const ORDERBOOK_ROLE = await coreVault.ORDERBOOK_ROLE();
  console.log("\nORDERBOOK_ROLE:", ORDERBOOK_ROLE);
  
  // Check current state
  const hasRole = await coreVault.hasRole(ORDERBOOK_ROLE, orderBook);
  console.log("Current hasRole:", hasRole);
  
  // Force re-grant (revoke then grant)
  console.log("\n🔧 Force re-granting ORDERBOOK_ROLE...");
  
  if (hasRole) {
    console.log("   Revoking first...");
    const revokeTx = await coreVault.revokeRole(ORDERBOOK_ROLE, orderBook);
    await revokeTx.wait();
    console.log("   Revoked. TX:", revokeTx.hash);
    
    // Verify revoked
    const hasAfterRevoke = await coreVault.hasRole(ORDERBOOK_ROLE, orderBook);
    console.log("   hasRole after revoke:", hasAfterRevoke);
  }
  
  console.log("   Granting...");
  const grantTx = await coreVault.grantRole(ORDERBOOK_ROLE, orderBook);
  await grantTx.wait();
  console.log("   Granted. TX:", grantTx.hash);
  
  // Verify granted
  const hasAfterGrant = await coreVault.hasRole(ORDERBOOK_ROLE, orderBook);
  console.log("   hasRole after grant:", hasAfterGrant);
  
  // Now test liquidation
  console.log("\n=== Testing liquidateDirect simulation ===");
  try {
    await coreVault.liquidateDirect.staticCall(marketId, wallet);
    console.log("✅ Simulation succeeded!");
  } catch (e) {
    console.log("❌ Simulation failed!");
    console.log("   Reason:", e.reason || e.shortMessage || e.message?.slice(0, 200));
    
    if (e.data && e.data.startsWith("0xe2517d3f")) {
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ["address", "bytes32"],
        "0x" + e.data.slice(10)
      );
      console.log("\n   AccessControlUnauthorizedAccount:");
      console.log("   Account:", decoded[0]);
      console.log("   Role:", decoded[1]);
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
