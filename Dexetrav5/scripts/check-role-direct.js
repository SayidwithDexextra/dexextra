const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const orderBook = "0xaB69f1906114D891A6A90212a013fc1aE5A1002a";
  const ORDERBOOK_ROLE = "0xe7d7e4bf430fa940e5a18beda68ad1833bb0bb84161df1150cd5a705786bf6e7";
  
  const coreVault = await ethers.getContractAt(
    ["function hasRole(bytes32,address) view returns (bool)"],
    process.env.CORE_VAULT_ADDRESS
  );
  
  console.log("CoreVault:", process.env.CORE_VAULT_ADDRESS);
  console.log("Order Book:", orderBook);
  console.log("ORDERBOOK_ROLE:", ORDERBOOK_ROLE);
  
  const hasRole = await coreVault.hasRole(ORDERBOOK_ROLE, orderBook);
  console.log("\nhasRole result:", hasRole);
  
  if (!hasRole) {
    console.log("\n❌ Order book does NOT have ORDERBOOK_ROLE!");
    console.log("\nGranting role...");
    
    const coreVaultSigner = await ethers.getContractAt(
      ["function grantRole(bytes32,address)"],
      process.env.CORE_VAULT_ADDRESS
    );
    
    const tx = await coreVaultSigner.grantRole(ORDERBOOK_ROLE, orderBook);
    console.log("TX:", tx.hash);
    await tx.wait();
    console.log("✅ Role granted!");
    
    // Verify
    const hasRoleNow = await coreVault.hasRole(ORDERBOOK_ROLE, orderBook);
    console.log("\nhasRole after grant:", hasRoleNow);
  } else {
    console.log("\n✅ Order book already has ORDERBOOK_ROLE");
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
