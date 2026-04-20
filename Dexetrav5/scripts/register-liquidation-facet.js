#!/usr/bin/env node
/**
 * register-liquidation-facet.js
 * 
 * Registers an already-deployed OBLiquidationFacet with the FacetRegistry.
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
  console.log("\n💎 Register OBLiquidationFacet with FacetRegistry");
  console.log("═".repeat(60));

  const registryAddress = process.env.FACET_REGISTRY_ADDRESS;
  if (!registryAddress || !ethers.isAddress(registryAddress)) {
    throw new Error("Missing or invalid FACET_REGISTRY_ADDRESS in env");
  }

  // Use the already-deployed facet from the earlier run
  const facetAddress = process.env.OB_LIQUIDATION_FACET || "0x25a0fFaC830a4B05c4DFb28dBbcD92aa4CB903D2";
  if (!ethers.isAddress(facetAddress)) {
    throw new Error("Invalid facet address");
  }

  const pk = process.env.ADMIN_PRIVATE_KEY;
  if (!pk) throw new Error("Missing ADMIN_PRIVATE_KEY in env");

  const deployer = new ethers.Wallet(pk, ethers.provider);
  console.log("\nAdmin:", deployer.address);
  console.log("FacetRegistry:", registryAddress);
  console.log("OBLiquidationFacet:", facetAddress);

  // Get selectors
  const selectors = await selectorsFromArtifact("OBLiquidationFacet");
  console.log(`\n📊 Selectors: ${selectors.length}`);
  selectors.forEach((sel, i) => console.log(`   ${i + 1}. ${sel}`));

  // Get current nonce
  const nonce = await ethers.provider.getTransactionCount(deployer.address, "pending");
  console.log("\nUsing nonce:", nonce);

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

  // Use higher gas price to ensure transaction goes through
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice ? feeData.gasPrice * 10n : ethers.parseUnits("1", "gwei");
  console.log("   Gas price:", ethers.formatUnits(gasPrice, "gwei"), "gwei");
  
  const tx = await registry.registerFacet(facetAddress, selectors, { nonce, gasPrice });
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
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Failed:", e?.message || String(e));
    process.exit(1);
  });
