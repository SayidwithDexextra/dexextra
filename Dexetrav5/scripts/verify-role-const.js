const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  // Check CoreVault's ORDERBOOK_ROLE
  const coreVault = await ethers.getContractAt(
    ["function ORDERBOOK_ROLE() view returns (bytes32)"],
    process.env.CORE_VAULT_ADDRESS
  );
  
  const coreVaultRole = await coreVault.ORDERBOOK_ROLE();
  console.log("CoreVault ORDERBOOK_ROLE:", coreVaultRole);
  
  // Check LiquidationManager's ORDERBOOK_ROLE (direct call, not delegatecall)
  const liqManager = await ethers.getContractAt(
    ["function ORDERBOOK_ROLE() view returns (bytes32)"],
    process.env.LIQUIDATION_MANAGER_ADDRESS
  );
  
  const liqManagerRole = await liqManager.ORDERBOOK_ROLE();
  console.log("LiquidationManager ORDERBOOK_ROLE:", liqManagerRole);
  
  // Compute expected value
  const expected = ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE"));
  console.log("Expected keccak256('ORDERBOOK_ROLE'):", expected);
  
  console.log("\nAll match:", coreVaultRole === liqManagerRole && liqManagerRole === expected);
  
  // Check what hasRole returns from LiquidationManager directly
  const orderBook = "0xaB69f1906114D891A6A90212a013fc1aE5A1002a";
  const liqMgr2 = await ethers.getContractAt(
    ["function hasRole(bytes32,address) view returns (bool)"],
    process.env.LIQUIDATION_MANAGER_ADDRESS
  );
  
  try {
    const hasRoleLiqMgr = await liqMgr2.hasRole(coreVaultRole, orderBook);
    console.log("\nhasRole on LiquidationManager (direct):", hasRoleLiqMgr);
  } catch (e) {
    console.log("\nhasRole on LiquidationManager failed:", e.message?.slice(0, 100));
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
