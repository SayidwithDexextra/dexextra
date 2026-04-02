const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  // Deploy MarketLifecycleFacet
  console.log("\n--- Deploying MarketLifecycleFacet ---");
  const MLF = await ethers.getContractFactory("MarketLifecycleFacet");
  const mlf = await MLF.deploy({ gasLimit: 5_000_000n });
  await mlf.waitForDeployment();
  const mlfAddr = await mlf.getAddress();
  console.log("MarketLifecycleFacet deployed to:", mlfAddr);

  // Deploy OBSettlementFacet
  console.log("\n--- Deploying OBSettlementFacet ---");
  const OSF = await ethers.getContractFactory("OBSettlementFacet");
  const osf = await OSF.deploy({ gasLimit: 1_000_000n });
  await osf.waitForDeployment();
  const osfAddr = await osf.getAddress();
  console.log("OBSettlementFacet deployed to:", osfAddr);

  console.log("\n=== DEPLOYMENT SUMMARY ===");
  console.log("MARKET_LIFECYCLE_FACET=" + mlfAddr);
  console.log("OB_SETTLEMENT_FACET=" + osfAddr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
