const { ethers, network } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const orderBook = "0xaB69f1906114D891A6A90212a013fc1aE5A1002a";
  const marketId = "0x385f306b03d718570a850d4d785c69dfe2961d44e2a80bd2cb2cb9ab2bf9df63";
  const wallet = "0x724cbe7b515dab1ce4b0e262990d2e3c47c6ca36";
  
  console.log("Testing direct liquidateShort call from order book via impersonation");
  console.log("Order Book:", orderBook);
  console.log("Wallet:", wallet);
  
  // Impersonate the order book
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [orderBook],
  });
  
  // Fund the impersonated account for gas
  const [funder] = await ethers.getSigners();
  await funder.sendTransaction({
    to: orderBook,
    value: ethers.parseEther("0.1")
  });
  
  const obSigner = await ethers.getSigner(orderBook);
  
  const coreVault = await ethers.getContractAt(
    [
      "function liquidateShort(address,bytes32,address,uint256)",
      "function hasRole(bytes32,address) view returns (bool)",
      "function ORDERBOOK_ROLE() view returns (bytes32)",
    ],
    process.env.CORE_VAULT_ADDRESS,
    obSigner
  );
  
  // Check role
  const role = await coreVault.ORDERBOOK_ROLE();
  const hasRole = await coreVault.hasRole(role, orderBook);
  console.log("\nhasRole check:", hasRole);
  
  // Try calling liquidateShort directly as order book
  console.log("\n=== Calling liquidateShort as order book ===");
  try {
    // Use a price of $3 (3000000 in 6 decimals)
    const execPrice = 3000000;
    await coreVault.liquidateShort.staticCall(wallet, marketId, orderBook, execPrice);
    console.log("✅ staticCall succeeded!");
  } catch (e) {
    console.log("❌ staticCall failed!");
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
  
  // Stop impersonating
  await network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [orderBook],
  });
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
