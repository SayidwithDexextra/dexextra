#!/usr/bin/env node
/**
 * upgrade-lifecycle-operators.js
 *
 * Deploys an updated MarketLifecycleFacet with lifecycle operator support,
 * performs a diamondCut on the specified market(s), then registers
 * small-block relayer addresses as lifecycle operators.
 *
 * Env required:
 *   ADMIN_PRIVATE_KEY — diamond owner key (big-block)
 *   RELAYER_PRIVATE_KEYS_HUB_TRADE_SMALL_JSON — JSON array of small-block relayer keys
 *
 * Usage:
 *   MARKET_ADDRESS=0x... npx hardhat run scripts/upgrade-lifecycle-operators.js --network hyperliquid
 */

const { ethers, artifacts } = require("hardhat");
const path = require("path");
const fs = require("fs");

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
  return { selectors: sels, abi: artifact.abi };
}

function loadSmallBlockAddresses() {
  const raw = String(process.env.RELAYER_PRIVATE_KEYS_HUB_TRADE_SMALL_JSON || "").trim();
  if (!raw) return [];
  let keys;
  try {
    keys = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(keys)) return [];
  const addrs = [];
  for (const k of keys) {
    const pk = normalizePk(k);
    if (!pk) continue;
    try {
      addrs.push(new ethers.Wallet(pk).address);
    } catch {}
  }
  return addrs;
}

async function main() {
  const marketAddress = (process.env.MARKET_ADDRESS || "").trim();
  if (!marketAddress || !/^0x[a-fA-F0-9]{40}$/.test(marketAddress)) {
    throw new Error("Set MARKET_ADDRESS env var to the target diamond address.");
  }

  console.log("\n💎 Upgrade MarketLifecycleFacet — Lifecycle Operators");
  console.log("═".repeat(80));

  // 1) Resolve signer (must be diamond owner)
  const pk = normalizePk(process.env.ADMIN_PRIVATE_KEY);
  if (!pk) throw new Error("Missing ADMIN_PRIVATE_KEY");
  const signer = new ethers.Wallet(pk, ethers.provider);
  const signerAddr = await signer.getAddress();
  console.log("👤 Signer:", signerAddr);
  console.log("🎯 Target market:", marketAddress);

  // Verify ownership
  const ownerView = await ethers.getContractAt(
    ["function owner() view returns (address)"],
    marketAddress,
    ethers.provider,
  );
  const owner = await ownerView.owner();
  if (owner.toLowerCase() !== signerAddr.toLowerCase()) {
    throw new Error(`Signer ${signerAddr} is not the diamond owner (${owner}).`);
  }
  console.log("✅ Signer matches diamond owner");

  // 2) Deploy new MarketLifecycleFacet
  console.log("\n🚀 Deploying updated MarketLifecycleFacet...");
  const Factory = await ethers.getContractFactory("MarketLifecycleFacet", signer);
  const facet = await Factory.deploy();
  await facet.waitForDeployment();
  const facetAddress = await facet.getAddress();
  const depTx = facet.deploymentTransaction && facet.deploymentTransaction();
  console.log("✅ Deployed at:", facetAddress);
  console.log("   tx:", depTx?.hash || "(unknown)");

  // Record in deployment file
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const netName = chainId === 999 ? "hyperliquid" : chainId === 998 ? "hyperliquid_testnet" : "unknown";
  const deploymentPath = path.join(__dirname, `../deployments/${netName}-deployment.json`);
  let deployment = {};
  try {
    if (fs.existsSync(deploymentPath)) {
      deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    }
  } catch {}
  deployment.contracts = deployment.contracts || {};
  deployment.contracts.MARKET_LIFECYCLE_FACET = facetAddress;
  deployment.timestamp = new Date().toISOString();
  fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));

  // 3) Build selector plan
  const { selectors } = await selectorsFromArtifact("MarketLifecycleFacet");
  console.log(`\n📋 Total selectors: ${selectors.length}`);

  const loupe = await ethers.getContractAt(
    ["function facetAddress(bytes4) view returns (address)"],
    marketAddress,
    ethers.provider,
  );
  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
  const add = [];
  const rep = [];
  const targetFacetLc = facetAddress.toLowerCase();

  for (const sel of selectors) {
    let cur = ethers.ZeroAddress;
    try {
      cur = await loupe.facetAddress(sel);
    } catch {
      cur = ethers.ZeroAddress;
    }
    if (!cur || cur === ethers.ZeroAddress) add.push(sel);
    else if (cur.toLowerCase() !== targetFacetLc) rep.push(sel);
  }

  console.log(`   Replace: ${rep.length}  Add: ${add.length}`);
  if (add.length) console.log(`   New selectors: ${add.join(", ")}`);

  // 4) Execute diamondCut
  if (!add.length && !rep.length) {
    console.log("   ⏭️  All selectors already point to this facet.");
  } else {
    const cut = [];
    if (rep.length) cut.push({ facetAddress, action: FacetCutAction.Replace, functionSelectors: rep });
    if (add.length) cut.push({ facetAddress, action: FacetCutAction.Add, functionSelectors: add });

    console.log("\n🧩 Submitting diamondCut...");
    const diamond = await ethers.getContractAt("IDiamondCut", marketAddress, signer);
    const tx = await diamond.diamondCut(cut, ethers.ZeroAddress, "0x");
    console.log("   tx:", tx.hash);
    const rc = await tx.wait();
    console.log(`   ✅ Mined at block ${rc.blockNumber}, gasUsed ${rc.gasUsed.toString()}`);
  }

  // 5) Register small-block relayers as lifecycle operators
  const operatorAddrs = loadSmallBlockAddresses();
  if (!operatorAddrs.length) {
    console.log("\n⚠️  No small-block relayer keys found in RELAYER_PRIVATE_KEYS_HUB_TRADE_SMALL_JSON.");
    console.log("   Skipping operator registration. Add them manually later via setLifecycleOperator.");
  } else {
    console.log(`\n🔑 Registering ${operatorAddrs.length} lifecycle operator(s)...`);
    const lifecycle = await ethers.getContractAt(
      [
        "function setLifecycleOperator(address operator, bool authorized) external",
        "function isLifecycleOperator(address account) external view returns (bool)",
      ],
      marketAddress,
      signer,
    );

    for (const addr of operatorAddrs) {
      const already = await lifecycle.isLifecycleOperator(addr);
      if (already) {
        console.log(`   ⏭️  ${addr} already registered`);
        continue;
      }
      const tx = await lifecycle.setLifecycleOperator(addr, true);
      console.log(`   tx: ${tx.hash} → ${addr}`);
      await tx.wait();
      console.log(`   ✅ ${addr} registered`);
    }
  }

  // 6) Summary
  console.log("\n" + "═".repeat(80));
  console.log("📊 Summary:");
  console.log(`   Facet deployed:  ${facetAddress}`);
  console.log(`   Market upgraded: ${marketAddress}`);
  console.log(`   Operators:       ${operatorAddrs.length > 0 ? operatorAddrs.join(", ") : "(none)"}`);
  console.log("\n   Update .env.local:");
  console.log(`   MARKET_LIFECYCLE_FACET=${facetAddress}`);
  console.log(`   NEXT_PUBLIC_MARKET_LIFECYCLE_FACET=${facetAddress}`);
  console.log("\n✅ Done.\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ upgrade-lifecycle-operators failed:", e?.message || String(e));
    process.exit(1);
  });
