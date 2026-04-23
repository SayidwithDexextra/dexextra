#!/usr/bin/env node
/**
 * Register already-deployed OBViewFacet and OBPricingFacet to FacetRegistry
 */
const { ethers, artifacts } = require("hardhat");
const path = require("path");
try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}

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
  // Already deployed facets
  const OB_VIEW_FACET = "0xa3b5c5dfd49141Da9a10EB87AE504E6E5D160604";
  const OB_PRICING_FACET = "0x77b55319ec9A279Cf262DD4cc86C91DeF07b64A1";
  const FACET_REGISTRY = "0xdcbbD419f642c9b0481384f46E52f660AE8acEc9";

  console.log("\nRegistering view facets to FacetRegistry...");
  console.log(`  OBViewFacet:    ${OB_VIEW_FACET}`);
  console.log(`  OBPricingFacet: ${OB_PRICING_FACET}`);
  console.log(`  FacetRegistry:  ${FACET_REGISTRY}\n`);

  const registry = await ethers.getContractAt(
    ["function updateFacets(bytes4[] calldata _selectors, address[] calldata _facets) external"],
    FACET_REGISTRY
  );

  const [signer] = await ethers.getSigners();
  const nonce = await ethers.provider.getTransactionCount(signer.address, "pending");
  console.log(`  Current nonce: ${nonce}`);

  // Register OBViewFacet
  console.log("Registering OBViewFacet...");
  const viewSelectors = await selectorsFromArtifact("OBViewFacet");
  console.log(`  ${viewSelectors.length} selectors`);
  const tx1 = await registry.updateFacets(viewSelectors, viewSelectors.map(() => OB_VIEW_FACET), { nonce });
  console.log(`  tx: ${tx1.hash}`);
  await tx1.wait();
  console.log("  ✓ Done");

  // Register OBPricingFacet
  console.log("\nRegistering OBPricingFacet...");
  const pricingSelectors = await selectorsFromArtifact("OBPricingFacet");
  console.log(`  ${pricingSelectors.length} selectors`);
  const tx2 = await registry.updateFacets(pricingSelectors, pricingSelectors.map(() => OB_PRICING_FACET), { nonce: nonce + 1 });
  console.log(`  tx: ${tx2.hash}`);
  await tx2.wait();
  console.log("  ✓ Done");

  console.log("\n✓ All facets registered. Order book should now display correctly.\n");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
