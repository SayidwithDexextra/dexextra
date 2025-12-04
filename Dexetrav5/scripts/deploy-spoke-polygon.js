/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

function updateDeployment(networkName, partial) {
  const file = path.join(__dirname, "..", "deployments", `${networkName}-deployment.json`);
  let current = { network: networkName, timestamp: Date.now(), contracts: {} };
  if (fs.existsSync(file)) {
    try {
      current = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (_) {}
  }
  current.contracts = { ...(current.contracts || {}), ...partial };
  fs.writeFileSync(file, JSON.stringify(current, null, 2));
  console.log(`📝 wrote ${file}`);
}

async function main() {
  if (!["polygon", "mumbai", "localhost", "ganache"].includes(network.name)) {
    console.warn(`⚠️ This script is intended for Polygon networks. Running on: ${network.name}`);
  }
  const [deployer] = await ethers.getSigners();
  console.log(`\n🚀 Deploying Polygon Spoke with ${deployer.address} on ${network.name}`);

  // Determine USDC: deploy mock if not provided or explicitly requested
  let usdc = process.env.SPOKE_POLYGON_USDC_ADDRESS;
  const useMock = !usdc || process.env.USE_MOCK_POLYGON_USDC === "1";
  if (useMock) {
    const MockUSDCPolygon = await ethers.getContractFactory("MockUSDCPolygon");
    const mock = await MockUSDCPolygon.deploy(deployer.address);
    await mock.waitForDeployment();
    usdc = await mock.getAddress();
    console.log(`✅ MockUSDCPolygon deployed at ${usdc}`);
  } else {
    console.log(`ℹ️ Using existing USDC at ${usdc}`);
  }

  const hub = process.env.COLLATERAL_HUB_ADDRESS;
  const hubVerifier = process.env.HUB_VERIFIER_FOR_POLYGON_ADDRESS || ethers.ZeroAddress;
  if (!hub) {
    throw new Error("COLLATERAL_HUB_ADDRESS (hub on main chain) is required");
  }

  const SpokeVaultPolygon = await ethers.getContractFactory("SpokeVaultPolygon");
  const spoke = await SpokeVaultPolygon.deploy(usdc, hub, hubVerifier, deployer.address);
  await spoke.waitForDeployment();
  const spokeAddress = await spoke.getAddress();
  console.log(`✅ SpokeVaultPolygon deployed at ${spokeAddress}`);

  updateDeployment(network.name, {
    SPOKE_POLYGON_USDC: usdc,
    SPOKE_POLYGON_VAULT: spokeAddress,
    HUB_FOR_SPOKES: hub,
    HUB_VERIFIER_FOR_POLYGON: hubVerifier,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});






