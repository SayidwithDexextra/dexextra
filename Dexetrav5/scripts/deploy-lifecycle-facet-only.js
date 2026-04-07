#!/usr/bin/env node
const { ethers } = require("hardhat");

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Deploying MarketLifecycleFacet with signer:", signer.address);
  
  const Factory = await ethers.getContractFactory("MarketLifecycleFacet");
  const facet = await Factory.deploy();
  await facet.waitForDeployment();
  
  const addr = await facet.getAddress();
  console.log("MarketLifecycleFacet deployed to:", addr);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Error:", e.message || e);
    process.exit(1);
  });
