const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const orderBook = "0xaB69f1906114D891A6A90212a013fc1aE5A1002a";
  const expectedVault = process.env.CORE_VAULT_ADDRESS;
  
  console.log("Order Book:", orderBook);
  console.log("Expected CoreVault:", expectedVault);
  
  const ob = await ethers.getContractAt(
    ["function marketStatic() view returns (address vault, bytes32 marketId, bool useVWAP, uint256 vwapWindow)"],
    orderBook
  );
  
  const [actualVault, marketId, useVWAP, vwapWindow] = await ob.marketStatic();
  console.log("\nOrder book's vault:", actualVault);
  console.log("Order book's marketId:", marketId);
  
  if (actualVault.toLowerCase() !== expectedVault.toLowerCase()) {
    console.log("\n❌ VAULT MISMATCH!");
    console.log("   Order book is using:", actualVault);
    console.log("   But env var points to:", expectedVault);
    
    // Check if the order book has ORDERBOOK_ROLE on the ACTUAL vault it's using
    const actualVaultContract = await ethers.getContractAt(
      ["function hasRole(bytes32,address) view returns (bool)", "function ORDERBOOK_ROLE() view returns (bytes32)"],
      actualVault
    );
    
    const role = await actualVaultContract.ORDERBOOK_ROLE();
    const hasRole = await actualVaultContract.hasRole(role, orderBook);
    console.log("\n   Does order book have ORDERBOOK_ROLE on actual vault?", hasRole);
    
    if (!hasRole) {
      console.log("\n   🔧 Granting ORDERBOOK_ROLE on the actual vault...");
      const [signer] = await ethers.getSigners();
      const actualVaultSigner = await ethers.getContractAt(
        ["function grantRole(bytes32,address)", "function hasRole(bytes32,address) view returns (bool)"],
        actualVault,
        signer
      );
      
      try {
        const tx = await actualVaultSigner.grantRole(role, orderBook);
        console.log("   TX:", tx.hash);
        await tx.wait();
        console.log("   ✅ Role granted!");
        
        // Verify
        const hasRoleNow = await actualVaultSigner.hasRole(role, orderBook);
        console.log("   hasRole after grant:", hasRoleNow);
      } catch (e) {
        console.log("   ❌ Failed to grant role:", e.reason || e.message?.slice(0, 100));
      }
    }
  } else {
    console.log("\n✅ Vault addresses match");
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
