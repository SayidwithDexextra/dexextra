const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("Checking all account balances...\n");

  const signers = await ethers.getSigners();
  console.log("=== Configured Signers ===");
  for (let i = 0; i < signers.length && i < 6; i++) {
    const addr = await signers[i].getAddress();
    const bal = await ethers.provider.getBalance(addr);
    console.log(`Signer ${i}: ${addr} - ${ethers.formatEther(bal)} HYPE`);
  }

  // Check relayers file
  const relayersPath = path.join(__dirname, "../../relayers.generated.json");
  if (fs.existsSync(relayersPath)) {
    const relayers = JSON.parse(fs.readFileSync(relayersPath, "utf8"));
    console.log("\n=== Relayers ===");
    let totalBal = 0n;
    for (const r of relayers) {
      const bal = await ethers.provider.getBalance(r.address);
      totalBal += bal;
      if (bal > 0n) {
        console.log(`${r.address.slice(0, 10)}...${r.address.slice(-6)}: ${ethers.formatEther(bal)} HYPE`);
      }
    }
    console.log(`Total across ${relayers.length} relayers: ${ethers.formatEther(totalBal)} HYPE`);
  }

  // Check deployment file users
  const deploymentPath = path.join(__dirname, "../deployments/hyperliquid-deployment.json");
  if (fs.existsSync(deploymentPath)) {
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    if (deployment.allUsers) {
      console.log("\n=== Deployment Users ===");
      for (const u of deployment.allUsers) {
        const bal = await ethers.provider.getBalance(u.address);
        console.log(`${u.role}: ${u.address} - ${ethers.formatEther(bal)} HYPE`);
      }
    }
  }
}

main().catch(console.error);
