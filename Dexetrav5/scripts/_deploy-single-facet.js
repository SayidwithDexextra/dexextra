const { ethers } = require("hardhat");

async function main() {
  const name = process.env.FACET_NAME || "OBTradeExecutionFacet";
  console.log(`Deploying ${name}...`);
  const Factory = await ethers.getContractFactory(name);
  const facet = await Factory.deploy();
  await facet.waitForDeployment();
  const addr = await facet.getAddress();
  const tx = facet.deploymentTransaction();
  console.log(`DEPLOYED_ADDRESS=${addr}`);
  console.log(`TX_HASH=${tx ? tx.hash : "unknown"}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
