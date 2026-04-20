const { ethers } = require("hardhat");
const path = require("path");
require("dotenv").config({ path: path.join(process.cwd(), ".env.local") });

async function main() {
  const relayerKey = process.env.RELAYER_PRIVATE_KEY;
  const relayer = new ethers.Wallet(relayerKey, ethers.provider);
  const balance = await ethers.provider.getBalance(relayer.address);
  
  console.log("Relayer:", relayer.address);
  console.log("Balance:", ethers.formatEther(balance), "HYPE");
  console.log("Balance (wei):", balance.toString());
  
  // Calculate cost: started with ~0.002333788426135815, funded 27+1 txs (28 including role grant)
  const startBalance = ethers.parseEther("0.002333788426135815");
  const spent = startBalance - balance;
  const txCount = 28; // 27 credits + 1 role grant
  const perTx = spent / BigInt(txCount);
  
  console.log("\n--- Cost Analysis ---");
  console.log("Started with:", ethers.formatEther(startBalance), "HYPE");
  console.log("Spent:", ethers.formatEther(spent), "HYPE");
  console.log("Transactions:", txCount);
  console.log("Cost per tx:", ethers.formatEther(perTx), "HYPE");
  console.log("Cost per tx (gwei):", ethers.formatUnits(perTx, "gwei"), "gwei worth");
}

main().catch(console.error);
