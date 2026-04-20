const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const [signer] = await ethers.getSigners();
  const marketId = "0x385f306b03d718570a850d4d785c69dfe2961d44e2a80bd2cb2cb9ab2bf9df63";
  const wallet = "0x724cbe7b515dab1ce4b0e262990d2e3c47c6ca36";
  const orderBook = "0xaB69f1906114D891A6A90212a013fc1aE5A1002a";
  
  console.log("Testing direct liquidateShort call...");
  
  // Call liquidateShort directly on CoreVault (impersonating orderbook via staticCall)
  // This tests if the error is in LiquidationManager or in the OrderBook
  
  const cv = await ethers.getContractAt(
    ["function liquidateShort(address,bytes32,address,uint256)"],
    process.env.CORE_VAULT_ADDRESS
  );
  
  // First test: staticCall as if orderbook is calling
  console.log("\n1. Testing CoreVault.liquidateShort staticCall...");
  try {
    // Can't impersonate, but we can try with signer
    await cv.connect(signer).liquidateShort.staticCall(wallet, marketId, orderBook, 3000000n);
    console.log("   ✅ Would succeed");
  } catch (e) {
    console.log("   Error:", e.reason || e.shortMessage || e.message?.slice(0, 150));
    if (e.data) {
      console.log("   Data:", e.data.slice(0, 66));
    }
  }
  
  // Test: call via order book's liquidateDirect
  console.log("\n2. Testing OrderBook.liquidateDirect staticCall...");
  const ob = await ethers.getContractAt(
    ["function liquidateDirect(address)"],
    orderBook
  );
  
  try {
    await ob.connect(signer).liquidateDirect.staticCall(wallet);
    console.log("   ✅ Would succeed");
  } catch (e) {
    console.log("   Error:", e.reason || e.shortMessage || e.message?.slice(0, 150));
    if (e.data) {
      console.log("   Data:", e.data.slice(0, 66));
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
