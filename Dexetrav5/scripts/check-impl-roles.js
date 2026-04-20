const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const proxyAddr = process.env.CORE_VAULT_ADDRESS;
  const implAddr = "0xfc97a46b56b810d1fcc6417c338ac142d639856c";
  const orderBook = "0xaB69f1906114D891A6A90212a013fc1aE5A1002a";
  const ORDERBOOK_ROLE = "0xe7d7e4bf430fa940e5a18beda68ad1833bb0bb84161df1150cd5a705786bf6e7";
  
  console.log("Proxy:", proxyAddr);
  console.log("Implementation:", implAddr);
  console.log("Order Book:", orderBook);
  console.log("ORDERBOOK_ROLE:", ORDERBOOK_ROLE);
  
  const proxyContract = await ethers.getContractAt(
    ["function hasRole(bytes32,address) view returns (bool)"],
    proxyAddr
  );
  
  const implContract = await ethers.getContractAt(
    ["function hasRole(bytes32,address) view returns (bool)"],
    implAddr
  );
  
  console.log("\n=== Role checks ===");
  const hasOnProxy = await proxyContract.hasRole(ORDERBOOK_ROLE, orderBook);
  console.log("hasRole on PROXY:", hasOnProxy);
  
  try {
    const hasOnImpl = await implContract.hasRole(ORDERBOOK_ROLE, orderBook);
    console.log("hasRole on IMPL:", hasOnImpl);
  } catch (e) {
    console.log("hasRole on IMPL: error -", e.message?.slice(0, 80));
  }
  
  // Also check LiquidationManager's own storage
  const liqManager = await ethers.getContractAt(
    ["function hasRole(bytes32,address) view returns (bool)"],
    process.env.LIQUIDATION_MANAGER_ADDRESS
  );
  
  try {
    const hasOnLiqManager = await liqManager.hasRole(ORDERBOOK_ROLE, orderBook);
    console.log("hasRole on LiquidationManager:", hasOnLiqManager);
  } catch (e) {
    console.log("hasRole on LiquidationManager: error -", e.message?.slice(0, 80));
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
