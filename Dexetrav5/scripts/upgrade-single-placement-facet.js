#!/usr/bin/env node
/**
 * upgrade-single-placement-facet.js
 *
 * Performs diamondCut on a SINGLE market to upgrade OBOrderPlacementFacet.
 *
 * Usage:
 *   OB_ORDER_PLACEMENT_FACET=0x... MARKET_ADDRESS=0x... npx hardhat run scripts/upgrade-single-placement-facet.js --network hyperliquid
 */
const { ethers, artifacts } = require("hardhat");

function isAddress(v) {
  return typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v.trim());
}

function normalizePk(v) {
  let raw = String(v || "").trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1).trim();
  }
  if (!raw) return "";
  const pk = raw.startsWith("0x") ? raw : `0x${raw}`;
  return /^0x[a-fA-F0-9]{64}$/.test(pk) ? pk : "";
}

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
  const sels = fns.map((f) => {
    const inputsSig = (f.inputs || []).map(renderType).join(",");
    const sig = `${f.name}(${inputsSig})`;
    return ethers.id(sig).slice(0, 10);
  });
  return sels;
}

async function main() {
  console.log("\n💎 Single Market OBOrderPlacementFacet Upgrade");
  console.log("═".repeat(80));

  // Get facet and market addresses from env
  const facetAddress = process.env.OB_ORDER_PLACEMENT_FACET;
  const marketAddress = process.env.MARKET_ADDRESS;

  if (!facetAddress || !isAddress(facetAddress)) {
    throw new Error("Missing or invalid OB_ORDER_PLACEMENT_FACET in env.");
  }
  if (!marketAddress || !isAddress(marketAddress)) {
    throw new Error("Missing or invalid MARKET_ADDRESS in env.");
  }

  console.log(`Facet: ${facetAddress}`);
  console.log(`Market: ${marketAddress}`);

  // Resolve admin keys
  const pk1 = normalizePk(process.env.ADMIN_PRIVATE_KEY);
  const pk2 = normalizePk(process.env.ADMIN_PRIVATE_KEY_2);
  const pk3 = normalizePk(process.env.ADMIN_PRIVATE_KEY_3);
  if (!pk1) throw new Error("Missing/invalid ADMIN_PRIVATE_KEY in env.");

  const w1 = new ethers.Wallet(pk1, ethers.provider);
  const w2 = pk2 ? new ethers.Wallet(pk2, ethers.provider) : null;
  const w3 = pk3 ? new ethers.Wallet(pk3, ethers.provider) : null;

  // Get selectors
  const selectors = await selectorsFromArtifact("OBOrderPlacementFacet");
  console.log(`${selectors.length} selectors from facet`);

  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };

  try {
    // Resolve diamond owner -> pick matching signer
    const ownerView = await ethers.getContractAt(
      ["function owner() view returns (address)"],
      marketAddress,
      ethers.provider
    );
    const owner = (await ownerView.owner()).toLowerCase();
    console.log(`Diamond owner: ${owner}`);

    const candidates = [
      { w: w1, addr: (await w1.getAddress()).toLowerCase() },
      ...(w2 ? [{ w: w2, addr: (await w2.getAddress()).toLowerCase() }] : []),
      ...(w3 ? [{ w: w3, addr: (await w3.getAddress()).toLowerCase() }] : []),
    ];
    const picked = candidates.find((c) => c.addr === owner);
    if (!picked) {
      throw new Error(`No admin key matches owner ${owner}`);
    }
    const signer = picked.w;
    console.log(`Using signer: ${picked.addr}`);

    // Build diamond cut (add new selectors, replace existing ones)
    const loupe = await ethers.getContractAt(
      ["function facetAddress(bytes4) view returns (address)"],
      marketAddress,
      ethers.provider
    );
    const add = [];
    const rep = [];
    const targetLc = facetAddress.toLowerCase();
    
    console.log("\nChecking selectors...");
    for (const sel of selectors) {
      let cur = ethers.ZeroAddress;
      try {
        cur = await loupe.facetAddress(sel);
      } catch {
        cur = ethers.ZeroAddress;
      }
      if (!cur || cur === ethers.ZeroAddress) {
        add.push(sel);
      } else if (cur.toLowerCase() !== targetLc) {
        rep.push(sel);
      }
    }

    const cut = [];
    if (rep.length) cut.push({ facetAddress, action: FacetCutAction.Replace, functionSelectors: rep });
    if (add.length) cut.push({ facetAddress, action: FacetCutAction.Add, functionSelectors: add });

    if (!cut.length) {
      console.log("ℹ️ Already up-to-date, no changes needed.");
      return;
    }

    console.log(`\nDiamond cut: replace=${rep.length} add=${add.length}`);
    const diamond = await ethers.getContractAt("IDiamondCut", marketAddress, signer);
    const tx = await diamond.diamondCut(cut, ethers.ZeroAddress, "0x");
    console.log(`tx: ${tx.hash}`);
    const rc = await tx.wait();
    console.log(`✅ Mined in block ${rc.blockNumber}, gas used: ${rc.gasUsed.toString()}`);
    console.log("\n" + "═".repeat(80));
    console.log("SUCCESS! Market upgraded to new OBOrderPlacementFacet");
  } catch (e) {
    console.error(`\n❌ FAILED: ${e.message}`);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Upgrade failed:", e?.message || String(e));
    process.exit(1);
  });
