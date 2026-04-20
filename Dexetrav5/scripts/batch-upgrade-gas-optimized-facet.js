#!/usr/bin/env node

/**
 * batch-upgrade-gas-optimized-facet.js
 *
 * Deploys the gas-optimized OBOrderPlacementFacet and performs diamondCut
 * on ALL active markets that don't use FacetRegistry.
 *
 * For V2 markets using FacetRegistry, update the registry instead (one tx for all).
 *
 * ENV VARS (required):
 *   ADMIN_PRIVATE_KEY          - Private key for diamond owner
 *   SUPABASE_URL               - Supabase URL for fetching markets
 *   SUPABASE_SERVICE_ROLE_KEY  - Supabase key
 *
 * ENV VARS (optional):
 *   OB_ORDER_PLACEMENT_FACET   - Use existing facet address instead of deploying
 *   ADMIN_PRIVATE_KEY_2        - Additional admin key
 *   ADMIN_PRIVATE_KEY_3        - Additional admin key
 *   DRY_RUN=1                  - Just show what would be done
 *   SKIP_MARKETS               - Comma-separated list of market addresses to skip
 *
 * USAGE:
 *   npx hardhat run scripts/batch-upgrade-gas-optimized-facet.js --network hyperliquid
 */

const { ethers, artifacts } = require("hardhat");
const fs = require("fs");
const path = require("path");

try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}
try { require("dotenv").config(); } catch (_) {}

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
  return fns.map((f) => {
    const inputsSig = (f.inputs || []).map(renderType).join(",");
    const sig = `${f.name}(${inputsSig})`;
    return ethers.id(sig).slice(0, 10);
  });
}

async function fetchMarkets() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/ANON_KEY");
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from("markets")
    .select("id, symbol, market_identifier, market_address, market_status, is_active")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data || []).filter((r) => isAddress(r.market_address));
}

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  Batch OBOrderPlacementFacet Upgrade (Gas Optimized)");
  console.log("═".repeat(70) + "\n");

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  console.log(`Network: ${networkName} (chainId ${chainId})`);

  // Resolve admin keys
  const pk1 = normalizePk(process.env.ADMIN_PRIVATE_KEY);
  const pk2 = normalizePk(process.env.ADMIN_PRIVATE_KEY_2);
  const pk3 = normalizePk(process.env.ADMIN_PRIVATE_KEY_3);
  if (!pk1) throw new Error("Missing/invalid ADMIN_PRIVATE_KEY");

  const w1 = new ethers.Wallet(pk1, ethers.provider);
  const w2 = pk2 ? new ethers.Wallet(pk2, ethers.provider) : null;
  const w3 = pk3 ? new ethers.Wallet(pk3, ethers.provider) : null;
  const deployer = w1;

  console.log(`Deployer: ${await deployer.getAddress()}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH\n`);

  const dryRun = !!process.env.DRY_RUN;
  if (dryRun) console.log("⚠ DRY_RUN mode\n");

  // Parse skip list
  const skipAddresses = new Set(
    (process.env.SKIP_MARKETS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0)
  );

  // Deploy or reuse facet
  let facetAddress = process.env.OB_ORDER_PLACEMENT_FACET;
  
  if (facetAddress && isAddress(facetAddress)) {
    console.log(`Using existing OBOrderPlacementFacet: ${facetAddress}`);
  } else {
    console.log("Deploying new OBOrderPlacementFacet...");
    const OBOrderPlacementFacet = await ethers.getContractFactory("OBOrderPlacementFacet", deployer);
    const facet = await OBOrderPlacementFacet.deploy();
    await facet.waitForDeployment();
    facetAddress = await facet.getAddress();
    console.log(`✓ Deployed: ${facetAddress}`);
  }

  // Get selectors
  const selectors = await selectorsFromArtifact("OBOrderPlacementFacet");
  console.log(`${selectors.length} selectors\n`);

  // Fetch markets
  console.log("Fetching markets from Supabase...");
  const allMarkets = await fetchMarkets();
  const markets = allMarkets.filter(
    (m) => m.is_active && !skipAddresses.has(m.market_address.trim().toLowerCase())
  );
  console.log(`${allMarkets.length} total, ${markets.length} active markets to upgrade\n`);

  if (markets.length === 0) {
    console.log("No markets to upgrade");
    return;
  }

  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
  let success = 0;
  let skipped = 0;
  let failed = 0;

  const results = [];

  for (let i = 0; i < markets.length; i++) {
    const m = markets[i];
    const orderBook = m.market_address.trim();
    const label = `[${i + 1}/${markets.length}] ${m.symbol || m.market_identifier}`;
    console.log(`\n${label}`);
    console.log(`  ${orderBook}`);

    try {
      // Get diamond owner
      const ownerView = await ethers.getContractAt(
        ["function owner() view returns (address)"],
        orderBook,
        ethers.provider
      );
      const owner = (await ownerView.owner()).toLowerCase();

      // Find matching signer
      const candidates = [
        { w: w1, addr: (await w1.getAddress()).toLowerCase() },
        ...(w2 ? [{ w: w2, addr: (await w2.getAddress()).toLowerCase() }] : []),
        ...(w3 ? [{ w: w3, addr: (await w3.getAddress()).toLowerCase() }] : []),
      ];
      const picked = candidates.find((c) => c.addr === owner);
      
      if (!picked) {
        console.log(`  ⚠ SKIP: no admin key matches owner ${owner}`);
        skipped++;
        results.push({ market: m.symbol, address: orderBook, status: "skipped", reason: "no matching admin" });
        continue;
      }
      const signer = picked.w;

      // Check current facet state via loupe
      const loupe = await ethers.getContractAt(
        ["function facetAddress(bytes4) view returns (address)"],
        orderBook,
        ethers.provider
      );

      const add = [];
      const rep = [];
      const targetLc = facetAddress.toLowerCase();

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
        console.log(`  ℹ Already up-to-date`);
        skipped++;
        results.push({ market: m.symbol, address: orderBook, status: "skipped", reason: "already upgraded" });
        continue;
      }

      console.log(`  replace=${rep.length} add=${add.length}`);

      if (dryRun) {
        console.log(`  [DRY_RUN] Would perform diamondCut`);
        skipped++;
        results.push({ market: m.symbol, address: orderBook, status: "dry_run" });
        continue;
      }

      const diamond = await ethers.getContractAt("IDiamondCut", orderBook, signer);
      const tx = await diamond.diamondCut(cut, ethers.ZeroAddress, "0x");
      console.log(`  tx: ${tx.hash}`);
      const rc = await tx.wait();
      console.log(`  ✓ mined block ${rc.blockNumber}, gas ${rc.gasUsed.toString()}`);
      success++;
      results.push({ market: m.symbol, address: orderBook, status: "success", tx: tx.hash });

    } catch (e) {
      console.log(`  ✗ FAILED: ${e.message?.slice(0, 100)}`);
      failed++;
      results.push({ market: m.symbol, address: orderBook, status: "failed", error: e.message });
    }
  }

  // Save results
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  const outFile = path.join(
    deploymentsDir,
    `facet-upgrade-${chainId}-${Date.now()}.json`
  );
  fs.writeFileSync(outFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    network: networkName,
    chainId,
    facetAddress,
    summary: { success, skipped, failed },
    results,
  }, null, 2));
  console.log(`\n✓ Results saved: ${outFile}`);

  // Summary
  console.log("\n" + "═".repeat(70));
  console.log("  Batch Upgrade Complete");
  console.log("═".repeat(70));
  console.log(`  Facet: ${facetAddress}`);
  console.log(`  Success: ${success}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Failed: ${failed}`);
  console.log("═".repeat(70) + "\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nBatch upgrade failed:", error);
    process.exit(1);
  });
