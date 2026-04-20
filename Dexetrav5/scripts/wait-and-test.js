const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const orderBook = "0xaB69f1906114D891A6A90212a013fc1aE5A1002a";
  const marketId = "0x385f306b03d718570a850d4d785c69dfe2961d44e2a80bd2cb2cb9ab2bf9df63";
  const wallet = "0x724cbe7b515dab1ce4b0e262990d2e3c47c6ca36";
  
  const [signer] = await ethers.getSigners();
  const coreVault = await ethers.getContractAt(
    [
      "function hasRole(bytes32,address) view returns (bool)",
      "function ORDERBOOK_ROLE() view returns (bytes32)",
      "function grantRole(bytes32,address)",
      "function liquidateDirect(bytes32,address)",
    ],
    process.env.CORE_VAULT_ADDRESS,
    signer
  );
  
  const ORDERBOOK_ROLE = await coreVault.ORDERBOOK_ROLE();
  
  // Grant role
  console.log("Granting ORDERBOOK_ROLE...");
  const grantTx = await coreVault.grantRole(ORDERBOOK_ROLE, orderBook);
  console.log("TX:", grantTx.hash);
  const receipt = await grantTx.wait(2);  // Wait for 2 confirmations
  console.log("Confirmed in block:", receipt.blockNumber);
  
  // Wait a bit more
  console.log("\nWaiting 5 seconds...");
  await new Promise(r => setTimeout(r, 5000));
  
  // Check role with explicit block tag
  const block = await ethers.provider.getBlockNumber();
  console.log("\nCurrent block:", block);
  
  const hasRole = await coreVault.hasRole(ORDERBOOK_ROLE, orderBook);
  console.log("hasRole:", hasRole);
  
  // Try simulation with explicit block
  console.log("\n=== Testing liquidateDirect ===");
  try {
    await coreVault.liquidateDirect.staticCall(marketId, wallet, { blockTag: block });
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
