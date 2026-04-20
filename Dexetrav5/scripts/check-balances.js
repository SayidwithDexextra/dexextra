const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Default signer:", signer.address);
  const balance = await ethers.provider.getBalance(signer.address);
  console.log("Balance:", ethers.formatEther(balance), "HYPE");
  
  // Check deployer from PRIVATE_KEY
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, ethers.provider);
  console.log("\nDeployer from PRIVATE_KEY:", deployer.address);
  const deployerBal = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(deployerBal), "HYPE");
  
  // Check some relayers
  const relayerKeys = [
    process.env.SMALL_RELAYER_1_PK,
    process.env.BIG_RELAYER_1_PK,
    process.env.RELAYER_PRIVATE_KEY,
  ].filter(Boolean);
  
  for (let i = 0; i < relayerKeys.length; i++) {
    try {
      const w = new ethers.Wallet(relayerKeys[i], ethers.provider);
      const b = await ethers.provider.getBalance(w.address);
      console.log(`\nRelayer ${i+1}:`, w.address);
      console.log("Balance:", ethers.formatEther(b), "HYPE");
    } catch (e) {}
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
