/**
 * deploy-bond-exemption-wld.js
 *
 * Non-interactive deployment for the WORLDCOIN-WLD-PRICE market:
 *   1. Deploy new MarketLifecycleFacet
 *   2. Diamond cut (add new selectors, replace existing)
 *   3. Grant bond exemption to the AI worker (diamond owner / ADMIN_PRIVATE_KEY)
 *
 * Usage:
 *   npx hardhat run scripts/deploy-bond-exemption-wld.js --network hyperliquid
 */

const { ethers, artifacts } = require("hardhat");

const DIAMOND_ADDRESS = "0x7E94C2046C087Dd507D9384f8C300FfB2885d130";

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
  return { selectors: sels, abi: artifact.abi, fns };
}

async function main() {
  console.log("\n=== Bond Exemption Upgrade: WORLDCOIN-WLD-PRICE ===");
  console.log(`Diamond: ${DIAMOND_ADDRESS}\n`);

  // Resolve signer (must be diamond owner)
  const signers = await ethers.getSigners();
  const ownerView = await ethers.getContractAt(
    ["function owner() view returns (address)"],
    DIAMOND_ADDRESS,
    ethers.provider
  );
  const owner = await ownerView.owner();
  console.log("Diamond owner:", owner);

  let signer = null;
  for (const s of signers) {
    const addr = await s.getAddress();
    if (addr.toLowerCase() === owner.toLowerCase()) {
      signer = s;
      break;
    }
  }
  if (!signer) throw new Error(`No signer matches diamond owner ${owner}`);
  const signerAddr = await signer.getAddress();
  console.log("Using signer:", signerAddr);

  // 1) Deploy new MarketLifecycleFacet
  console.log("\n--- Step 1: Deploy MarketLifecycleFacet ---");
  const Factory = await ethers.getContractFactory("MarketLifecycleFacet", signer);
  const facet = await Factory.deploy();
  await facet.waitForDeployment();
  const facetAddress = await facet.getAddress();
  const depTx = facet.deploymentTransaction && facet.deploymentTransaction();
  console.log("Deployed at:", facetAddress);
  console.log("Deploy tx:", depTx?.hash || "(unknown)");

  // 2) Build diamond cut
  console.log("\n--- Step 2: Diamond Cut ---");
  const loupe = await ethers.getContractAt(
    ["function facetAddress(bytes4) view returns (address)"],
    DIAMOND_ADDRESS,
    ethers.provider
  );
  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };

  const { selectors, fns } = await selectorsFromArtifact("MarketLifecycleFacet");
  const add = [];
  const rep = [];
  const targetFacet = facetAddress.toLowerCase();

  console.log(`Total selectors in artifact: ${selectors.length}`);

  for (let i = 0; i < selectors.length; i++) {
    const sel = selectors[i];
    let cur = ethers.ZeroAddress;
    try {
      cur = await loupe.facetAddress(sel);
    } catch {
      cur = ethers.ZeroAddress;
    }
    const fnName = fns[i]?.name || "?";
    if (!cur || cur === ethers.ZeroAddress) {
      add.push(sel);
      console.log(`  ADD: ${sel} (${fnName})`);
    } else if (cur.toLowerCase() !== targetFacet) {
      rep.push(sel);
    }
  }

  console.log(`\nReplace: ${rep.length}, Add: ${add.length}`);

  const cut = [];
  if (rep.length) cut.push({ facetAddress, action: FacetCutAction.Replace, functionSelectors: rep });
  if (add.length) cut.push({ facetAddress, action: FacetCutAction.Add, functionSelectors: add });

  if (!cut.length) {
    console.log("No selector changes needed — facet already up to date.");
  } else {
    const diamond = await ethers.getContractAt("IDiamondCut", DIAMOND_ADDRESS, signer);
    console.log("Submitting diamondCut...");
    const tx = await diamond.diamondCut(cut, ethers.ZeroAddress, "0x");
    console.log("diamondCut tx:", tx.hash);
    const rc = await tx.wait();
    console.log(`diamondCut mined at block ${rc.blockNumber}, gasUsed: ${rc.gasUsed.toString()}`);
  }

  // 3) Grant bond exemption to AI worker (owner address)
  console.log("\n--- Step 3: Grant Bond Exemption ---");
  const aiWorkerAddress = signerAddr; // AI worker is the same as diamond owner

  const lifecycle = await ethers.getContractAt(
    [
      "function setProposalBondExempt(address account, bool exempt) external",
      "function isProposalBondExempt(address account) external view returns (bool)",
    ],
    DIAMOND_ADDRESS,
    signer
  );

  const alreadyExempt = await lifecycle.isProposalBondExempt(aiWorkerAddress);
  if (alreadyExempt) {
    console.log(`${aiWorkerAddress} is already bond-exempt.`);
  } else {
    console.log(`Granting bond exemption to ${aiWorkerAddress}...`);
    const tx = await lifecycle.setProposalBondExempt(aiWorkerAddress, true);
    console.log("setProposalBondExempt tx:", tx.hash);
    await tx.wait();
    console.log("Exemption granted.");

    const verified = await lifecycle.isProposalBondExempt(aiWorkerAddress);
    console.log(`Verification: isProposalBondExempt = ${verified}`);
  }

  // Summary
  console.log("\n=== Upgrade Complete ===");
  console.log(`Market:       WORLDCOIN-WLD-PRICE`);
  console.log(`Diamond:      ${DIAMOND_ADDRESS}`);
  console.log(`Facet:        ${facetAddress}`);
  console.log(`AI Worker:    ${aiWorkerAddress} (bond-exempt)`);
  console.log("\nNew functions:");
  console.log("  setProposalBondExempt(address, bool)");
  console.log("  isProposalBondExempt(address) view");
  console.log("  returnProposalBond()");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nUpgrade failed:", e?.message || String(e));
    process.exit(1);
  });
