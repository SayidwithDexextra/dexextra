const { ethers } = require("hardhat");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: "../.env.local" });

const CORE_VAULT_ABI = [
  "function assignMarketToOrderBook(bytes32 marketId, address orderBook) external",
  "function authorizeMarket(bytes32 marketId, address orderBook) external",
  "function marketToOrderBook(bytes32 marketId) view returns (address)",
  "function registeredOrderBooks(address) view returns (bool)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function FACTORY_ROLE() view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function grantRole(bytes32 role, address account) external",
  "function registerOrderBook(address orderBook) external",
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Using signer:", signer.address);

  const coreVaultAddress = process.env.CORE_VAULT_ADDRESS;
  if (!coreVaultAddress) {
    throw new Error("CORE_VAULT_ADDRESS not set");
  }

  console.log("CoreVault:", coreVaultAddress);

  const coreVault = new ethers.Contract(coreVaultAddress, CORE_VAULT_ABI, signer);

  // Get role hashes
  const FACTORY_ROLE = await coreVault.FACTORY_ROLE();
  const DEFAULT_ADMIN_ROLE = await coreVault.DEFAULT_ADMIN_ROLE();
  
  console.log("\nChecking roles...");
  const hasAdmin = await coreVault.hasRole(DEFAULT_ADMIN_ROLE, signer.address);
  const hasFactory = await coreVault.hasRole(FACTORY_ROLE, signer.address);
  
  console.log("  Signer has DEFAULT_ADMIN_ROLE:", hasAdmin);
  console.log("  Signer has FACTORY_ROLE:", hasFactory);

  // Grant FACTORY_ROLE to signer if needed (admin can do this)
  if (!hasFactory && hasAdmin) {
    console.log("\n🔑 Granting FACTORY_ROLE to signer for this operation...");
    const grantTx = await coreVault.grantRole(FACTORY_ROLE, signer.address);
    await grantTx.wait();
    console.log("   ✅ Granted!");
  } else if (!hasFactory && !hasAdmin) {
    console.error("\n❌ Signer has neither FACTORY_ROLE nor DEFAULT_ADMIN_ROLE");
    process.exit(1);
  }

  // Target market: TESLA
  const marketId = "0x385f306b03d718570a850d4d785c69dfe2961d44e2a80bd2cb2cb9ab2bf9df63";
  const orderBook = "0xaB69f1906114D891A6A90212a013fc1aE5A1002a";

  console.log("\n📋 Target Market:");
  console.log("  Market ID:", marketId);
  console.log("  Order Book:", orderBook);

  // Check current state
  const currentOB = await coreVault.marketToOrderBook(marketId);
  console.log("\n  Current marketToOrderBook:", currentOB);

  if (currentOB.toLowerCase() === orderBook.toLowerCase()) {
    console.log("  ✅ Already correctly set!");
    return;
  }

  // Check if order book is registered
  const isRegistered = await coreVault.registeredOrderBooks(orderBook);
  console.log("  Order book registered:", isRegistered);

  if (!isRegistered) {
    console.log("\n🔧 Registering order book...");
    try {
      const regTx = await coreVault.registerOrderBook(orderBook);
      console.log("   TX:", regTx.hash);
      await regTx.wait();
      console.log("   ✅ Registered!");
    } catch (e) {
      console.log("   ⚠️ registerOrderBook failed, trying authorizeMarket instead...");
    }
  }

  // Assign market to order book
  console.log("\n🔧 Assigning market to order book...");
  
  if (currentOB === ethers.ZeroAddress) {
    // Try authorizeMarket first (works if not already assigned)
    try {
      const authTx = await coreVault.authorizeMarket(marketId, orderBook);
      console.log("   TX (authorizeMarket):", authTx.hash);
      await authTx.wait();
      console.log("   ✅ Market authorized!");
    } catch (authErr) {
      console.log("   authorizeMarket failed:", authErr.message?.slice(0, 80));
      console.log("   Trying assignMarketToOrderBook...");
      
      const assignTx = await coreVault.assignMarketToOrderBook(marketId, orderBook);
      console.log("   TX (assignMarketToOrderBook):", assignTx.hash);
      await assignTx.wait();
      console.log("   ✅ Market assigned!");
    }
  } else {
    // Already has an order book, use assign
    const assignTx = await coreVault.assignMarketToOrderBook(marketId, orderBook);
    console.log("   TX:", assignTx.hash);
    await assignTx.wait();
    console.log("   ✅ Market re-assigned!");
  }

  // Verify
  const verifyOB = await coreVault.marketToOrderBook(marketId);
  console.log("\n✅ Verification:");
  console.log("   marketToOrderBook now returns:", verifyOB);
  
  if (verifyOB.toLowerCase() === orderBook.toLowerCase()) {
    console.log("   ✅ SUCCESS! Market is now properly registered.");
  } else {
    console.log("   ❌ FAILED! Values don't match.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
