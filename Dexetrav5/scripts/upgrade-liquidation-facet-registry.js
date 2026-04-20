#!/usr/bin/env node
/**
 * upgrade-liquidation-facet-registry.js
 * 
 * Deploys a new OBLiquidationFacet and registers it with the FacetRegistry.
 * All markets using DiamondRegistry will automatically use the new facet.
 */
const { ethers, artifacts } = require("hardhat");

function renderType(t) {
  const type = t.type || "";
  const arraySuffixMatch = type.match(/(\[.*\])$/);
  const arraySuffix = arraySuffixMatch ? arraySuffixMatch[1] : "";
  const base = type.replace(/(\[.*\])$/, "");
  if (base === "tuple") {
    const comps = (t.components || []).map(renderType).join(",");
    return `(${comps})${arraySuffix}`;
  }
  return `${base}${arraySuffix}`;
}

async function selectorsFromArtifact(contractName) {
  const artifact = await artifacts.readArtifact(contractName);
  const fns = (artifact.abi || []).filter((e) => e && e.type === "function");
  return fns.map((f) => {
    const inputsSig = (f.inputs || []).map(renderType).join(",");
    const sig = `${f.name}(${inputsSig})`;
    return ethers.id(sig).slice(0, 10);
  });
}

async function main() {
  console.log("\n💎 OBLiquidationFacet Registry Upgrade");
  console.log("═".repeat(60));

  const registryAddress = process.env.FACET_REGISTRY_ADDRESS;
  if (!registryAddress || !ethers.isAddress(registryAddress)) {
    throw new Error("Missing or invalid FACET_REGISTRY_ADDRESS in env");
  }

  const pk = process.env.ADMIN_PRIVATE_KEY;
  if (!pk) throw new Error("Missing ADMIN_PRIVATE_KEY in env");

  const deployer = new ethers.Wallet(pk, ethers.provider);
  console.log("\nDeployer:", deployer.address);
  console.log("FacetRegistry:", registryAddress);

  // Get current nonce
  const confirmedNonce = await ethers.provider.getTransactionCount(deployer.address, "latest");
  const pendingNonce = await ethers.provider.getTransactionCount(deployer.address, "pending");
  console.log("Confirmed nonce:", confirmedNonce, "Pending nonce:", pendingNonce);
  
  // Use confirmed nonce + 1 if there's a gap (stuck tx)
  const useNonce = pendingNonce;

  // Deploy new OBLiquidationFacet with higher gas price to replace stuck tx
  console.log("\n📦 Deploying OBLiquidationFacet...");
  const Factory = await ethers.getContractFactory("OBLiquidationFacet", deployer);
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice ? feeData.gasPrice * 2n : undefined;
  console.log("   Gas price:", gasPrice ? ethers.formatUnits(gasPrice, "gwei") + " gwei" : "default");
  
  const facet = await Factory.deploy({ nonce: useNonce, gasPrice });
  await facet.waitForDeployment();
  const facetAddress = await facet.getAddress();
  console.log("   ✅ Deployed to:", facetAddress);

  // Get selectors
  const selectors = await selectorsFromArtifact("OBLiquidationFacet");
  console.log(`\n📊 Selectors: ${selectors.length}`);
  selectors.forEach((sel, i) => console.log(`   ${i + 1}. ${sel}`));

  // Register with FacetRegistry
  console.log("\n🔧 Registering with FacetRegistry...");
  const registry = await ethers.getContractAt(
    [
      "function registerFacet(address _facet, bytes4[] calldata _selectors) external",
      "function selectorToFacet(bytes4) view returns (address)",
      "function version() view returns (uint256)",
    ],
    registryAddress,
    deployer
  );

  const regNonce = await ethers.provider.getTransactionCount(deployer.address, "pending");
  const regFeeData = await ethers.provider.getFeeData();
  const regGasPrice = regFeeData.gasPrice ? regFeeData.gasPrice * 2n : undefined;
  const tx = await registry.registerFacet(facetAddress, selectors, { nonce: regNonce, gasPrice: regGasPrice });
  console.log("   tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("   ✅ Mined block", receipt.blockNumber, "gas", receipt.gasUsed.toString());

  // Verify
  const version = await registry.version();
  const verifyFacet = await registry.selectorToFacet(selectors[0]);
  console.log("\n✓ Registry version:", version.toString());
  console.log("✓ Selector", selectors[0], "→", verifyFacet);

  console.log("\n" + "═".repeat(60));
  console.log("Done! All DiamondRegistry markets now use the new facet.");
  console.log("\nNew facet address:", facetAddress);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Failed:", e?.message || String(e));
    process.exit(1);
  });
