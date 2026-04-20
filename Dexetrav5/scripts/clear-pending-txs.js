const { ethers } = require("hardhat");
const path = require("path");

require("dotenv").config({ path: path.join(process.cwd(), ".env.local") });

async function main() {
  const [signer] = await ethers.getSigners();
  const addr = await signer.getAddress();
  
  const confirmedNonce = await ethers.provider.getTransactionCount(addr, "latest");
  const pendingNonce = await ethers.provider.getTransactionCount(addr, "pending");
  
  console.log("Address:", addr);
  console.log("Confirmed nonce:", confirmedNonce);
  console.log("Pending nonce:", pendingNonce);
  
  if (pendingNonce <= confirmedNonce) {
    console.log("No pending transactions to clear!");
    return;
  }
  
  const stuckCount = pendingNonce - confirmedNonce;
  console.log(`Found ${stuckCount} stuck transactions (nonces ${confirmedNonce} to ${pendingNonce - 1})`);
  
  // Get current gas price and bump it significantly
  const feeData = await ethers.provider.getFeeData();
  const bumpedGasPrice = (feeData.gasPrice || ethers.parseUnits("50", "gwei")) * 10n;
  
  console.log(`Using bumped gas price: ${ethers.formatUnits(bumpedGasPrice, "gwei")} gwei`);
  
  // Send self-transfers to replace stuck txs
  for (let nonce = confirmedNonce; nonce < pendingNonce; nonce++) {
    console.log(`Clearing nonce ${nonce}...`);
    try {
      const tx = await signer.sendTransaction({
        to: addr,
        value: 0,
        nonce: nonce,
        gasPrice: bumpedGasPrice,
        gasLimit: 21000,
      });
      console.log(`  Tx: ${tx.hash}`);
      await tx.wait();
      console.log(`  ✅ Nonce ${nonce} cleared`);
    } catch (e) {
      console.log(`  ❌ Failed: ${e.message?.slice(0, 50)}`);
    }
  }
  
  console.log("\nDone! New nonce:", await signer.getNonce());
}

main().catch(console.error);
