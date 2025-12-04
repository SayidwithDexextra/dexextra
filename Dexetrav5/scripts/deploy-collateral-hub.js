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
  const [deployer] = await ethers.getSigners();
  console.log(`\n🚀 Deploying CollateralHub with ${deployer.address} on ${network.name}`);

  const admin = process.env.COLLATERAL_HUB_ADMIN || deployer.address;
  const coreVault = process.env.CORE_VAULT_ADDRESS;
  const operator = process.env.CORE_VAULT_OPERATOR_ADDRESS || deployer.address;
  if (!coreVault) {
    throw new Error("CORE_VAULT_ADDRESS is required");
  }

  const CollateralHub = await ethers.getContractFactory("CollateralHub");
  const hub = await CollateralHub.deploy(admin, coreVault, operator);
  await hub.waitForDeployment();
  const hubAddress = await hub.getAddress();
  console.log(`✅ CollateralHub deployed at ${hubAddress}`);

  updateDeployment(network.name, {
    COLLATERAL_HUB: hubAddress,
    CORE_VAULT: coreVault,
    CORE_VAULT_OPERATOR: operator,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});






