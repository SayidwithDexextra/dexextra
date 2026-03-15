const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env.local") });
require("dotenv").config();
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);

  const hubAddr = process.env.COLLATERAL_HUB_ADDRESS || "0x6bD4D6A4C19c85A5C37AA02b3F0421e623D7d0Ff";
  const outboxAddr = process.env.HUB_OUTBOX_ADDRESS || "0x4c32ff22b927a134a3286d5E33212debF951AcF5";

  const hub = await ethers.getContractAt("CollateralHub", hubAddr);
  const adminRole = await hub.DEFAULT_ADMIN_ROLE();
  const hasHubAdmin = await hub.hasRole(adminRole, signer.address);
  console.log("\nCollateralHub @", hubAddr);
  console.log("  Signer has DEFAULT_ADMIN_ROLE:", hasHubAdmin);

  try {
    const outbox = await ethers.getContractAt("HubBridgeOutboxWormhole", outboxAddr);
    const outboxAdminRole = await outbox.DEFAULT_ADMIN_ROLE();
    const hasOutboxAdmin = await outbox.hasRole(outboxAdminRole, signer.address);
    console.log("\nHubBridgeOutbox @", outboxAddr);
    console.log("  Signer has DEFAULT_ADMIN_ROLE:", hasOutboxAdmin);
  } catch (e) {
    console.log("\nHubBridgeOutbox @", outboxAddr);
    console.log("  Check failed:", e.reason || e.message);
  }

  const relayerPk = (process.env.RELAYER_PRIVATE_KEY || "").trim();
  if (relayerPk) {
    const pk = relayerPk.startsWith("0x") ? relayerPk : `0x${relayerPk}`;
    const w = new ethers.Wallet(pk);
    console.log("\nRelayer address (hub_inbox fallback):", w.address);

    const withdrawRole = await hub.WITHDRAW_REQUESTER_ROLE();
    const hasWithdrawRole = await hub.hasRole(withdrawRole, w.address);
    console.log("  Has WITHDRAW_REQUESTER_ROLE on CollateralHub:", hasWithdrawRole);

    try {
      const outbox = await ethers.getContractAt("HubBridgeOutboxWormhole", outboxAddr);
      const senderRole = await outbox.WITHDRAW_SENDER_ROLE();
      const hasSenderRole = await outbox.hasRole(senderRole, w.address);
      console.log("  Has WITHDRAW_SENDER_ROLE on HubBridgeOutbox:", hasSenderRole);
    } catch {}
  } else {
    console.log("\nNo RELAYER_PRIVATE_KEY set");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
