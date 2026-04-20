const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(process.cwd(), "..", ".env.local") });

async function main() {
  const deployerAddress = "0x428d7cBd7feccf01a80dACE3d70b8eCf06451500";
  const amountToSend = ethers.parseEther("0.025"); // Send enough for deployment
  
  // Load relayers
  const relayersPath = path.join(__dirname, "../../relayers.generated.json");
  const relayers = JSON.parse(fs.readFileSync(relayersPath, "utf8"));
  
  // Find the relayer with highest balance
  let bestRelayer = null;
  let highestBalance = 0n;
  
  for (const r of relayers) {
    const bal = await ethers.provider.getBalance(r.address);
    if (bal > highestBalance) {
      highestBalance = bal;
      bestRelayer = r;
    }
  }
  
  if (!bestRelayer || highestBalance < amountToSend + ethers.parseEther("0.01")) {
    console.log("❌ No relayer with sufficient balance");
    process.exit(1);
  }
  
  console.log("💰 Funding deployer address");
  console.log("   From:", bestRelayer.address);
  console.log("   Balance:", ethers.formatEther(highestBalance), "HYPE");
  console.log("   To:", deployerAddress);
  console.log("   Amount:", ethers.formatEther(amountToSend), "HYPE");
  
  const wallet = new ethers.Wallet(bestRelayer.privateKey, ethers.provider);
  const tx = await wallet.sendTransaction({
    to: deployerAddress,
    value: amountToSend,
    gasLimit: 21000,
  });
  
  console.log("\n   TX:", tx.hash);
  await tx.wait();
  
  const newBal = await ethers.provider.getBalance(deployerAddress);
  console.log("   ✅ Deployer new balance:", ethers.formatEther(newBal), "HYPE");
}

main().catch(e => { console.error(e); process.exit(1); });
