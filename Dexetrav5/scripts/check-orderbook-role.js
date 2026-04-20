const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const marketId = "0x385f306b03d718570a850d4d785c69dfe2961d44e2a80bd2cb2cb9ab2bf9df63";
  
  const liqManager = await ethers.getContractAt(
    ["function marketToOrderBook(bytes32) view returns (address)"],
    process.env.LIQUIDATION_MANAGER_ADDRESS
  );
  
  const coreVault = await ethers.getContractAt(
    ["function hasRole(bytes32,address) view returns (bool)", "function ORDERBOOK_ROLE() view returns (bytes32)"],
    process.env.CORE_VAULT_ADDRESS
  );
  
  const onchainOB = await liqManager.marketToOrderBook(marketId);
  console.log("Market ID:", marketId);
  console.log("marketToOrderBook returns:", onchainOB);
  
  const role = await coreVault.ORDERBOOK_ROLE();
  const hasRole = await coreVault.hasRole(role, onchainOB);
  console.log("\nOn-chain order book has ORDERBOOK_ROLE:", hasRole);
  
  // Also check the Supabase address
  const supabaseOB = "0xaB69f1906114D891A6A90212a013fc1aE5A1002a";
  const hasRoleSupabase = await coreVault.hasRole(role, supabaseOB);
  console.log("\nSupabase order book (", supabaseOB, ") has ORDERBOOK_ROLE:", hasRoleSupabase);
  
  if (onchainOB.toLowerCase() !== supabaseOB.toLowerCase()) {
    console.log("\n⚠️  MISMATCH! On-chain and Supabase order books differ!");
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
