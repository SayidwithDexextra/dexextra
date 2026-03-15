/**
 * Grants DEFAULT_ADMIN_ROLE on CollateralHub and HubBridgeOutbox
 * to a target address, using ADMIN_PRIVATE_KEY_3 as the current admin signer.
 *
 * Usage:  node scripts/relayers/grant-admin-to-userd.js
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env.local") });
const { ethers } = require("ethers");

const HUB_RPC = process.env.RPC_URL;
const ADMIN_PK = process.env.ADMIN_PRIVATE_KEY_3;
const TARGET_ADDR = "0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306";

if (!HUB_RPC) { console.error("Missing RPC_URL in .env.local"); process.exit(1); }
if (!ADMIN_PK) { console.error("Missing ADMIN_PRIVATE_KEY_3 in .env.local"); process.exit(1); }

const COLLATERAL_HUB = "0x6bD4D6A4C19c85A5C37AA02b3F0421e623D7d0Ff";
const HUB_BRIDGE_OUTBOX = "0x4c32ff22b927a134a3286d5E33212debF951AcF5";

const ABI = [
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(HUB_RPC);
  const normalized = ADMIN_PK.startsWith("0x") ? ADMIN_PK : "0x" + ADMIN_PK;
  const adminWallet = new ethers.Wallet(normalized, provider);
  const targetAddr = TARGET_ADDR;

  console.log("Admin signer:", adminWallet.address);
  console.log("Granting DEFAULT_ADMIN_ROLE to:", targetAddr);

  for (const [label, addr] of [
    ["CollateralHub", COLLATERAL_HUB],
    ["HubBridgeOutbox", HUB_BRIDGE_OUTBOX],
  ]) {
    const contract = new ethers.Contract(addr, ABI, adminWallet);
    const role = await contract.DEFAULT_ADMIN_ROLE();

    const already = await contract.hasRole(role, targetAddr);
    if (already) {
      console.log(`\n${label}: ${targetAddr} already has DEFAULT_ADMIN_ROLE — skipping`);
      continue;
    }

    console.log(`\n${label}: granting DEFAULT_ADMIN_ROLE...`);
    const tx = await contract.grantRole(role, targetAddr);
    console.log(`  tx: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  confirmed in block ${receipt.blockNumber}`);

    const verify = await contract.hasRole(role, targetAddr);
    console.log(`  verified: ${verify}`);
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
