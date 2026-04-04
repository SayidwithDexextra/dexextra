#!/usr/bin/env node
/**
 * Quick diamondCut of MarketLifecycleFacet on a single market.
 * MARKET_ADDRESS and MARKET_LIFECYCLE_FACET must be set in env.
 */
const { ethers, artifacts } = require("hardhat");

function renderType(t) {
  const type = t.type || "";
  const arr = type.match(/(\[.*\])$/);
  const base = type.replace(/(\[.*\])$/, "");
  if (base === "tuple") return "(" + (t.components||[]).map(renderType).join(",") + ")" + (arr?arr[1]:"");
  return type;
}

async function main() {
  const market = (process.env.MARKET_ADDRESS || "").trim();
  const facetAddress = (process.env.MARKET_LIFECYCLE_FACET || "").trim();
  if (!market || !facetAddress) throw new Error("Set MARKET_ADDRESS and MARKET_LIFECYCLE_FACET");

  const [signer] = await ethers.getSigners();
  console.log("Signer:", await signer.getAddress());
  console.log("Market:", market);
  console.log("Facet:", facetAddress);

  const artifact = await artifacts.readArtifact("MarketLifecycleFacet");
  const fns = artifact.abi.filter(e => e.type === "function");
  const selectors = fns.map(f => ethers.id(f.name + "(" + (f.inputs||[]).map(renderType).join(",") + ")").slice(0,10));

  const loupe = await ethers.getContractAt(["function facetAddress(bytes4) view returns (address)"], market, ethers.provider);
  const add = [], rep = [];
  for (const sel of selectors) {
    let cur = ethers.ZeroAddress;
    try { cur = await loupe.facetAddress(sel); } catch {}
    if (!cur || cur === ethers.ZeroAddress) add.push(sel);
    else if (cur.toLowerCase() !== facetAddress.toLowerCase()) rep.push(sel);
  }
  console.log("Replace:", rep.length, "Add:", add.length);
  if (!rep.length && !add.length) { console.log("Already up to date"); return; }

  const cut = [];
  if (rep.length) cut.push({ facetAddress, action: 1, functionSelectors: rep });
  if (add.length) cut.push({ facetAddress, action: 0, functionSelectors: add });

  const diamond = await ethers.getContractAt("IDiamondCut", market, signer);
  const tx = await diamond.diamondCut(cut, ethers.ZeroAddress, "0x");
  console.log("tx:", tx.hash);
  const rc = await tx.wait();
  console.log("✅ Mined block", rc.blockNumber, "gas", rc.gasUsed.toString());
}

main().then(() => process.exit(0)).catch(e => { console.error(e?.message || e); process.exit(1); });
