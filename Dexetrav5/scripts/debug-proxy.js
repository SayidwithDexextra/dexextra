const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const coreVaultAddr = process.env.CORE_VAULT_ADDRESS;
  const orderBook = "0xaB69f1906114D891A6A90212a013fc1aE5A1002a";
  
  console.log("CoreVault proxy:", coreVaultAddr);
  
  const provider = ethers.provider;
  
  // Check implementation slot (EIP-1967)
  const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const implSlotValue = await provider.getStorage(coreVaultAddr, IMPL_SLOT);
  console.log("Implementation slot value:", implSlotValue);
  
  if (implSlotValue !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
    const impl = "0x" + implSlotValue.slice(26);
    console.log("Implementation address:", impl);
  }
  
  // Read the _roles mapping directly
  // AccessControlUpgradeable stores roles at a specific slot
  // The mapping is: mapping(bytes32 => RoleData) private _roles
  // RoleData contains: mapping(address => bool) members, bytes32 adminRole
  
  const ORDERBOOK_ROLE = "0xe7d7e4bf430fa940e5a18beda68ad1833bb0bb84161df1150cd5a705786bf6e7";
  
  // For AccessControlUpgradeable, _roles is at slot calculated from its position
  // This is complex due to mapping of mapping, let me use a different approach
  
  // Instead, let's trace what's happening by calling the actual liquidation
  console.log("\n=== Attempting actual liquidation (not simulation) ===");
  
  const [signer] = await ethers.getSigners();
  const coreVault = await ethers.getContractAt(
    ["function liquidateDirect(bytes32,address)"],
    coreVaultAddr,
    signer
  );
  
  const marketId = "0x385f306b03d718570a850d4d785c69dfe2961d44e2a80bd2cb2cb9ab2bf9df63";
  const wallet = "0x724cbe7b515dab1ce4b0e262990d2e3c47c6ca36";
  
  try {
    console.log("Sending actual transaction...");
    const tx = await coreVault.liquidateDirect(marketId, wallet, { gasLimit: 5000000 });
    console.log("TX hash:", tx.hash);
    const receipt = await tx.wait();
    console.log("✅ Transaction succeeded!");
    console.log("Gas used:", receipt.gasUsed.toString());
  } catch (e) {
    console.log("❌ Transaction failed!");
    console.log("Error:", e.reason || e.shortMessage || e.message?.slice(0, 300));
    
    if (e.data) {
      console.log("Error data:", e.data);
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
