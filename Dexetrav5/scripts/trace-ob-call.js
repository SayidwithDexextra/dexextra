const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const orderBook = "0xaB69f1906114D891A6A90212a013fc1aE5A1002a";
  const wallet = "0x724cbe7b515dab1ce4b0e262990d2e3c47c6ca36";
  
  console.log("Order Book:", orderBook);
  console.log("Wallet:", wallet);
  
  const ob = await ethers.getContractAt(
    [
      "function marketStatic() view returns (address vault, bytes32 marketId, bool useVWAP, uint256 vwapWindow)",
      "function liquidateDirect(address)",
    ],
    orderBook
  );
  
  const [vault, marketId] = await ob.marketStatic();
  console.log("\nOrder book's vault:", vault);
  console.log("Order book's marketId:", marketId);
  
  // Try simulating liquidateDirect directly on the order book
  console.log("\n=== Simulating OB.liquidateDirect directly ===");
  try {
    await ob.liquidateDirect.staticCall(wallet);
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
  
  // Let's also check if the order book can call vault.liquidateShort directly
  console.log("\n=== Simulating vault.liquidateShort from deployer ===");
  const [signer] = await ethers.getSigners();
  const vaultContract = await ethers.getContractAt(
    [
      "function liquidateShort(address,bytes32,address,uint256)",
      "function hasRole(bytes32,address) view returns (bool)",
      "function ORDERBOOK_ROLE() view returns (bytes32)",
    ],
    vault,
    signer
  );
  
  // Check if order book has the role
  const role = await vaultContract.ORDERBOOK_ROLE();
  const hasRole = await vaultContract.hasRole(role, orderBook);
  console.log("Order book hasRole on vault:", hasRole);
  
  // Check if signer has the role
  const signerHasRole = await vaultContract.hasRole(role, signer.address);
  console.log("Signer hasRole on vault:", signerHasRole);
  
  // Try calling liquidateShort as signer (should fail unless signer has role)
  try {
    await vaultContract.liquidateShort.staticCall(wallet, marketId, signer.address, 1000000);
    console.log("✅ Signer can call liquidateShort!");
  } catch (e) {
    console.log("Signer cannot call liquidateShort (expected):", e.reason || e.shortMessage || "error");
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
