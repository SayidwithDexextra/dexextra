/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

function loadDeployment(networkName) {
  const file = path.join(__dirname, "..", "deployments", `${networkName}-deployment.json`);
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (_) {
      return { contracts: {} };
    }
  }
  return { contracts: {} };
}

async function main() {
  const [signer] = await ethers.getSigners();
  console.log(`\n🔗 Registering Polygon spoke from ${signer.address} on ${network.name}`);

  const hubAddr = process.env.COLLATERAL_HUB_ADDRESS;
  if (!hubAddr) throw new Error("COLLATERAL_HUB_ADDRESS is required");

  // Prefer env, fall back to polygon deployment file
  let spokeVault = process.env.SPOKE_POLYGON_VAULT_ADDRESS;
  let usdc = process.env.SPOKE_POLYGON_USDC_ADDRESS;
  let headerVerifier = process.env.POLYGON_HEADER_VERIFIER_ADDRESS || ethers.ZeroAddress;
  let receiptsVerifier = process.env.POLYGON_RECEIPTS_VERIFIER_ADDRESS || ethers.ZeroAddress;
  const polygonDeployment = loadDeployment("polygon");
  if (!spokeVault && polygonDeployment.contracts?.SPOKE_POLYGON_VAULT) {
    spokeVault = polygonDeployment.contracts.SPOKE_POLYGON_VAULT;
  }
  if (!usdc && polygonDeployment.contracts?.SPOKE_POLYGON_USDC) {
    usdc = polygonDeployment.contracts.SPOKE_POLYGON_USDC;
  }
  if (!spokeVault || !usdc) {
    throw new Error("Missing SPOKE_POLYGON_VAULT_ADDRESS or SPOKE_POLYGON_USDC_ADDRESS");
  }

  const chainId = 137; // Polygon mainnet
  const finalityBlocks = Number(process.env.POLYGON_FINALITY_BLOCKS || 20);

  const CollateralHub = await ethers.getContractFactory("CollateralHub");
  const hub = CollateralHub.attach(hubAddr);

  const tx = await hub.registerSpoke(chainId, {
    spokeVault,
    headerVerifier,
    receiptsVerifier,
    usdc,
    finalityBlocks,
    enabled: true,
  });
  const receipt = await tx.wait();
  console.log(`✅ Spoke registered (Polygon) in tx ${receipt.hash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});






