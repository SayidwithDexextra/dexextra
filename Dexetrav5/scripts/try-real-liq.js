const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const marketId = "0x385f306b03d718570a850d4d785c69dfe2961d44e2a80bd2cb2cb9ab2bf9df63";
  const wallet = "0x724cbe7b515dab1ce4b0e262990d2e3c47c6ca36";
  
  // Use the deployer account which should have some funds
  const pk = process.env.PRIVATE_KEY;
  const signer = new ethers.Wallet(pk, ethers.provider);
  console.log("Using signer:", signer.address);
  
  const balance = await ethers.provider.getBalance(signer.address);
  console.log("Balance:", ethers.formatEther(balance), "HYPE");
  
  if (balance < ethers.parseEther("0.0001")) {
    console.log("Insufficient funds, trying with default signer...");
    const [defaultSigner] = await ethers.getSigners();
    const defaultBal = await ethers.provider.getBalance(defaultSigner.address);
    console.log("Default signer:", defaultSigner.address, "Balance:", ethers.formatEther(defaultBal), "HYPE");
  }
  
  const coreVault = await ethers.getContractAt(
    ["function liquidateDirect(bytes32,address)"],
    process.env.CORE_VAULT_ADDRESS,
    signer
  );
  
  console.log("\n=== Attempting actual liquidation transaction ===");
  console.log("CoreVault:", process.env.CORE_VAULT_ADDRESS);
  console.log("Market ID:", marketId);
  console.log("Wallet:", wallet);
  
  try {
    // Estimate gas first
    const gasEstimate = await coreVault.liquidateDirect.estimateGas(marketId, wallet);
    console.log("\nGas estimate:", gasEstimate.toString());
    
    const tx = await coreVault.liquidateDirect(marketId, wallet, {
      gasLimit: gasEstimate + 100000n,
    });
    console.log("TX hash:", tx.hash);
    const receipt = await tx.wait();
    console.log("✅ Transaction succeeded!");
    console.log("Gas used:", receipt.gasUsed.toString());
  } catch (e) {
    console.log("\n❌ Transaction failed!");
    console.log("Error:", e.message?.slice(0, 300));
    
    if (e.data) {
      console.log("Error data:", e.data);
      if (e.data.startsWith("0xe2517d3f")) {
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
          ["address", "bytes32"],
          "0x" + e.data.slice(10)
        );
        console.log("\nAccessControlUnauthorizedAccount:");
        console.log("  Account:", decoded[0]);
        console.log("  Role:", decoded[1]);
      }
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
