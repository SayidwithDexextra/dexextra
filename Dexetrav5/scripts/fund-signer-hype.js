const { ethers } = require("hardhat");
const path = require("path");

require("dotenv").config({ path: path.join(process.cwd(), ".env.local") });

async function main() {
  const [signer] = await ethers.getSigners();
  const signerAddr = signer.address;
  
  // Load funder wallet (try multiple keys)
  const funderKey = process.env.PRIVATE_KEY_DEPLOYER || process.env.PRIVATE_KEY || process.env.FUNDER_PRIVATE_KEY;
  if (!funderKey) {
    console.error("No funder key found");
    process.exit(1);
  }
  
  const funder = new ethers.Wallet(funderKey, ethers.provider);
  
  const funderBal = await ethers.provider.getBalance(funder.address);
  const signerBal = await ethers.provider.getBalance(signerAddr);
  
  console.log("Funder:", funder.address);
  console.log("Funder balance:", ethers.formatEther(funderBal), "HYPE");
  console.log("");
  console.log("Signer:", signerAddr);
  console.log("Signer balance:", ethers.formatEther(signerBal), "HYPE");
  
  // Send 0.1 HYPE to signer (enough for 100 txs)
  const amount = ethers.parseEther("0.1");
  
  if (funderBal < amount + ethers.parseEther("0.001")) { // Keep some for gas
    console.error("Funder doesn't have enough HYPE! Has:", ethers.formatEther(funderBal));
    // List all accounts with balances
    const keys = [
      process.env.PRIVATE_KEY,
      process.env.PRIVATE_KEY_DEPLOYER,
      process.env.FUNDER_PRIVATE_KEY,
      process.env.ADMIN_PRIVATE_KEY,
      process.env.RELAYER_PRIVATE_KEY,
    ].filter(Boolean);
    
    console.log("\nChecking other accounts...");
    for (const k of [...new Set(keys)]) {
      const w = new ethers.Wallet(k, ethers.provider);
      const b = await ethers.provider.getBalance(w.address);
      console.log(`  ${w.address.slice(0,10)}...: ${ethers.formatEther(b)} HYPE`);
    }
    process.exit(1);
  }
  
  console.log("\nSending", ethers.formatEther(amount), "HYPE to signer...");
  
  const tx = await funder.sendTransaction({
    to: signerAddr,
    value: amount,
  });
  console.log("Tx:", tx.hash);
  await tx.wait();
  
  const newBal = await ethers.provider.getBalance(signerAddr);
  console.log("✅ New signer balance:", ethers.formatEther(newBal), "HYPE");
}

main().catch(console.error);
