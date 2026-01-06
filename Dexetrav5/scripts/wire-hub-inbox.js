// Wires a freshly deployed HubInbox to CollateralHub/CoreVault and existing spokes.
// Usage:
//   NETWORK=hyperliquid npx hardhat run scripts/wire-hub-inbox.js --network hyperliquid
// Required env (examples):
//   HUB_INBOX_ADDRESS=0x...
//   COLLATERAL_HUB_ADDRESS=0x...
//   CORE_VAULT_ADDRESS=0x...
//   CORE_VAULT_OPERATOR_ADDRESS=0x...
//   BRIDGE_ENDPOINT_HUB=0x...             (relayer that calls HubInbox.receiveMessage)
//   SPOKE_OUTBOX_ADDRESS_POLYGON=0x...    (or SPOKE_OUTBOX_ADDRESS if single spoke)
//   SPOKE_POLYGON_VAULT_ADDRESS=0x...
//   SPOKE_POLYGON_USDC_ADDRESS=0x...
//   BRIDGE_DOMAIN_POLYGON=137
//   SPOKE_OUTBOX_ADDRESS_ARBITRUM=0x...
//   SPOKE_ARBITRUM_VAULT_ADDRESS=0x...
//   SPOKE_ARBITRUM_USDC_ADDRESS=0x...
//   BRIDGE_DOMAIN_ARBITRUM=42161
//
// What it does (idempotent-ish):
// - Grants HubInbox.BRIDGE_ENDPOINT_ROLE to BRIDGE_ENDPOINT_HUB.
// - Grants CollateralHub.BRIDGE_INBOX_ROLE to HubInbox.
// - Grants CoreVault.EXTERNAL_CREDITOR_ROLE to CollateralHub.
// - Points CollateralHub at the current CoreVault/operator (setCoreVaultParams).
// - Registers/enables each spoke on CollateralHub.
// - Sets HubInbox.remoteAppByDomain to each spoke outbox (bytes32 padded address).

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
require("dotenv").config();

const hre = require("hardhat");
const { ethers } = hre;

function mustEnv(name) {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function optEnv(name) {
  return (process.env[name] || "").trim();
}

function asAddress(name, required = true) {
  const v = (process.env[name] || "").trim();
  if (!v) {
    if (required) throw new Error(`Missing address env: ${name}`);
    return "";
  }
  try {
    return ethers.getAddress(v);
  } catch {
    throw new Error(`Invalid address for ${name}: ${v}`);
  }
}

function encodeRemoteApp(addr) {
  // bytes32 left-padded address ( Wormhole-style representation )
  const normalized = ethers.getAddress(addr);
  return ethers.hexlify(ethers.zeroPadValue(normalized, 32));
}

async function ensureRole(contract, role, account, label) {
  const has = await contract.hasRole(role, account);
  if (has) {
    console.log(`[wire] ${label} already set -> ${account}`);
    return;
  }
  const tx = await contract.grantRole(role, account);
  await tx.wait();
  console.log(`[wire] granted ${label} to ${account} (tx ${tx.hash})`);
}

async function setIfDifferent(contract, fn, args, label) {
  // Best-effort diff: caller supplies current state checks externally if needed.
  const tx = await contract[fn](...args);
  await tx.wait();
  console.log(`[wire] ${label} (tx ${tx.hash})`);
}

function loadSpokes() {
  const spokes = [];
  const maybeAdd = (name, domainEnv, vaultEnv, usdcEnv, outboxEnvFallbacks) => {
    const domainRaw = optEnv(domainEnv);
    const outbox = outboxEnvFallbacks.map(optEnv).find((v) => v) || "";
    const vault = optEnv(vaultEnv);
    const usdc = optEnv(usdcEnv);
    if (!domainRaw || !outbox || !vault || !usdc) return;
    const domain = Number(domainRaw);
    if (!Number.isFinite(domain) || domain <= 0) {
      throw new Error(`Invalid domain for ${name}: ${domainRaw}`);
    }
    spokes.push({
      name,
      domain,
      outbox: ethers.getAddress(outbox),
      vault: ethers.getAddress(vault),
      usdc: ethers.getAddress(usdc),
    });
  };

  maybeAdd(
    "polygon",
    "BRIDGE_DOMAIN_POLYGON",
    "SPOKE_POLYGON_VAULT_ADDRESS",
    "SPOKE_POLYGON_USDC_ADDRESS",
    ["SPOKE_OUTBOX_ADDRESS_POLYGON", "SPOKE_OUTBOX_ADDRESS"]
  );
  maybeAdd(
    "arbitrum",
    "BRIDGE_DOMAIN_ARBITRUM",
    "SPOKE_ARBITRUM_VAULT_ADDRESS",
    "SPOKE_ARBITRUM_USDC_ADDRESS",
    ["SPOKE_OUTBOX_ADDRESS_ARBITRUM", "SPOKE_OUTBOX_ADDRESS"]
  );
  return spokes;
}

async function main() {
  const hubInboxAddr = asAddress("HUB_INBOX_ADDRESS");
  const collateralHubAddr = asAddress("COLLATERAL_HUB_ADDRESS");
  const coreVaultAddr = asAddress("CORE_VAULT_ADDRESS");
  const coreVaultOperator = asAddress("CORE_VAULT_OPERATOR_ADDRESS");
  const relayer = asAddress("BRIDGE_ENDPOINT_HUB");

  const spokes = loadSpokes();
  if (!spokes.length) {
    console.warn(
      "[wire] No spokes found in env; set BRIDGE_DOMAIN_* + SPOKE_* + SPOKE_OUTBOX_*"
    );
  }

  const [signer] = await ethers.getSigners();
  console.log("[wire] using signer", await signer.getAddress());

  const hubInbox = new ethers.Contract(
    hubInboxAddr,
    [
      "function BRIDGE_ENDPOINT_ROLE() view returns (bytes32)",
      "function grantRole(bytes32,address)",
      "function hasRole(bytes32,address) view returns (bool)",
      "function collateralHub() view returns (address)",
      "function setCollateralHub(address)",
      "function remoteAppByDomain(uint64) view returns (bytes32)",
      "function setRemoteApp(uint64,bytes32)",
    ],
    signer
  );

  const collateralHub = new ethers.Contract(
    collateralHubAddr,
    [
      "function BRIDGE_INBOX_ROLE() view returns (bytes32)",
      "function grantRole(bytes32,address)",
      "function hasRole(bytes32,address) view returns (bool)",
      "function setCoreVaultParams(address,address)",
      "function registerSpoke(uint64,(address,address,bool))",
      "function setSpokeEnabled(uint64,bool)",
      "function spokes(uint64) view returns (address spokeVault, address usdc, bool enabled)",
    ],
    signer
  );

  const coreVault = new ethers.Contract(
    coreVaultAddr,
    [
      "function EXTERNAL_CREDITOR_ROLE() view returns (bytes32)",
      "function grantRole(bytes32,address)",
      "function hasRole(bytes32,address) view returns (bool)",
    ],
    signer
  );

  // Roles wiring
  await ensureRole(
    hubInbox,
    await hubInbox.BRIDGE_ENDPOINT_ROLE(),
    relayer,
    "HubInbox.BRIDGE_ENDPOINT_ROLE"
  );
  await ensureRole(
    collateralHub,
    await collateralHub.BRIDGE_INBOX_ROLE(),
    hubInboxAddr,
    "CollateralHub.BRIDGE_INBOX_ROLE"
  );
  await ensureRole(
    coreVault,
    await coreVault.EXTERNAL_CREDITOR_ROLE(),
    collateralHubAddr,
    "CoreVault.EXTERNAL_CREDITOR_ROLE"
  );

  // Ensure HubInbox points to the expected CollateralHub (new configurability)
  try {
    const currentHub = await hubInbox.collateralHub();
    if (ethers.getAddress(currentHub) !== collateralHubAddr) {
      const tx = await hubInbox.setCollateralHub(collateralHubAddr);
      await tx.wait();
      console.log(
        `[wire] HubInbox.setCollateralHub -> ${collateralHubAddr} (tx ${tx.hash})`
      );
    } else {
      console.log("[wire] HubInbox collateralHub already set");
    }
  } catch (e) {
    console.warn(
      "[wire] Could not verify/set HubInbox.collateralHub",
      e?.message || e
    );
  }

  // Point CollateralHub to the active CoreVault/operator
  await setIfDifferent(
    collateralHub,
    "setCoreVaultParams",
    [coreVaultAddr, coreVaultOperator],
    "CollateralHub.setCoreVaultParams"
  );

  // Register spokes + enable + remote app allowlist
  for (const s of spokes) {
    console.log(`[wire] configuring spoke ${s.name} domain=${s.domain}`);
    await setIfDifferent(
      collateralHub,
      "registerSpoke",
      [s.domain, [s.vault, s.usdc, true]],
      `CollateralHub.registerSpoke(${s.domain})`
    );
    await setIfDifferent(
      collateralHub,
      "setSpokeEnabled",
      [s.domain, true],
      `CollateralHub.setSpokeEnabled(${s.domain})`
    );

    const desired = encodeRemoteApp(s.outbox);
    let current = "0x";
    try {
      current = await hubInbox.remoteAppByDomain(s.domain);
    } catch {}
    if (String(current).toLowerCase() === String(desired).toLowerCase()) {
      console.log(
        `[wire] remoteAppByDomain already set for domain ${s.domain}`
      );
    } else {
      await setIfDifferent(
        hubInbox,
        "setRemoteApp",
        [s.domain, desired],
        `HubInbox.setRemoteApp(${s.domain})`
      );
    }
  }

  console.log("[wire] done");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});








