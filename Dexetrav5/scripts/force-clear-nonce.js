const { ethers } = require("hardhat");
const path = require("path");

require("dotenv").config({ path: path.join(process.cwd(), ".env.local") });

async function main() {
  const [signer] = await ethers.getSigners();
  const addr = await signer.getAddress();
  
  const nonce = await signer.getNonce();
  console.log("Address:", addr);
  console.log("Current nonce:", nonce);
  
  // Send a self-transfer with higher gas price
  const gasPrice = ethers.parseUnits("50", "gwei"); // 50 gwei
  
  console.log(`Sending self-transfer with ${ethers.formatUnits(gasPrice, "gwei")} gwei gas price...`);
  console.log(`Using nonce: ${nonce}`);
  
  try {
    const tx = await signer.sendTransaction({
      to: addr,
      value: 0,
      nonce: nonce,
      gasPrice: gasPrice,
      gasLimit: 21000,
    });
    console.log("Tx hash:", tx.hash);
    console.log("Waiting for confirmation...");
    const receipt = await tx.wait();
    console.log("✅ Confirmed in block:", receipt.blockNumber);
    console.log("New nonce:", await signer.getNonce());
  } catch (e) {
    console.error("Failed:", e.message);
  }
}

main().catch(console.error);
