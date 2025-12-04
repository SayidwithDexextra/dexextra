#!/usr/bin/env node

/**
 * Call SpokeBridgeOutboxWormhole.sendDeposit(...) on a spoke chain.
 *
 * Usage:
 *   # Configure values in .env.local (and/or environment), then run:
 *   npx hardhat run scripts/send-deposit.js --network polygon
 *
 * Required env (spoke send):
 *   - SPOKE_OUTBOX_ADDRESS
 *   - BRIDGE_DOMAIN_HUB (e.g., 999)
 *   - DEPOSIT_AMOUNT (string/number)
 *   - DEPOSIT_TOKEN (fallbacks to SPOKE_POLYGON_USDC_ADDRESS on polygon, SPOKE_ARBITRUM_USDC_ADDRESS on arbitrum)
 * Optional env:
 *   - DEPOSIT_USER (defaults to signer address)
 *   - DEPOSIT_DECIMALS (defaults to 6)
 *   - DEPOSIT_ID (auto-generated if omitted)
 *
 * Optional hub delivery (set DELIVER_TO_HUB=1):
 *   - HUB_INBOX_ADDRESS
 *   - BRIDGE_DOMAIN_<SPOKE> (e.g., BRIDGE_DOMAIN_POLYGON=137)
 *   - BRIDGE_REMOTE_APP_<SPOKE> (bytes32 address) OR SPOKE_OUTBOX_ADDRESS (used to derive bytes32)
 *   - RELAYER_PRIVATE_KEY (EOA with BRIDGE_ENDPOINT_ROLE on hub inbox)
 *   - HUB_RPC_URL or RPC_URL_HUB or RPC_URL_HYPEREVM
 */

const { ethers } = require("hardhat");
const hre = require("hardhat");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
require("dotenv").config();

async function feeOverridesForNetwork(networkName) {
  let fee;
  try {
    fee = await Promise.race([
      ethers.provider.getFeeData(),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("feeDataTimeout")), 8000)
      ),
    ]);
  } catch (e) {
    fee = {};
    console.log(
      `  ℹ️ feeData unavailable (${e?.message || e}), using default overrides`
    );
  }
  const isPolygon = String(networkName || "")
    .toLowerCase()
    .includes("polygon");
  const defaultTip = ethers.parseUnits(isPolygon ? "35" : "3", "gwei");
  const maxPriorityFeePerGas = fee?.maxPriorityFeePerGas || defaultTip;
  const base = fee?.maxFeePerGas || fee?.gasPrice || defaultTip * 2n;
  const maxFeePerGas = base + maxPriorityFeePerGas * 2n;
  return { maxFeePerGas, maxPriorityFeePerGas };
}

async function feeOverridesForProvider(provider, networkHint) {
  let fee;
  try {
    fee = await Promise.race([
      provider.getFeeData(),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("feeDataTimeout")), 8000)
      ),
    ]);
  } catch (e) {
    fee = {};
    console.log(
      `  ℹ️ hub feeData unavailable (${
        e?.message || e
      }), using default overrides`
    );
  }
  const isPolygon = String(networkHint || "")
    .toLowerCase()
    .includes("polygon");
  const defaultTip = ethers.parseUnits(isPolygon ? "35" : "3", "gwei");
  const maxPriorityFeePerGas = fee?.maxPriorityFeePerGas || defaultTip;
  const base = fee?.maxFeePerGas || fee?.gasPrice || defaultTip * 2n;
  const maxFeePerGas = base + maxPriorityFeePerGas * 2n;
  return { maxFeePerGas, maxPriorityFeePerGas };
}

function usage(msg) {
  if (msg) console.error(`Error: ${msg}\n`);
  console.log(`Usage:
  # 1) Set required envs in .env.local:
  #    SPOKE_OUTBOX_ADDRESS=0x...
  #    BRIDGE_DOMAIN_HUB=999
  #    DEPOSIT_TOKEN=0x...   # or SPOKE_POLYGON_USDC_ADDRESS on Polygon networks
  #    DEPOSIT_AMOUNT=1
  #    [optional] DEPOSIT_USER=0x... (defaults to signer)
  #    [optional] DEPOSIT_DECIMALS=6
  #    [optional] DEPOSIT_ID=0x... (auto-generated if omitted)
  #
  # 2) (Optional) Delivery to hub:
  #    DELIVER_TO_HUB=1
  #    HUB_INBOX_ADDRESS=0x...
  #    BRIDGE_DOMAIN_POLYGON=137  # or BRIDGE_DOMAIN_<SPOKE>
  #    BRIDGE_REMOTE_APP_POLYGON=0x...bytes32 OR SPOKE_OUTBOX_ADDRESS=0x...
  #    RELAYER_PRIVATE_KEY=0x...
  #    HUB_RPC_URL=https://...     # or RPC_URL_HUB / RPC_URL_HYPEREVM
  #
  # 3) Run:
  #    npx hardhat run scripts/send-deposit.js --network polygon
  `);
  process.exit(1);
}

function isHex32(v) {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}

function toBytes32Address(addr) {
  if (!addr) return "0x" + "00".repeat(32);
  const hex = addr.toLowerCase().replace(/^0x/, "");
  if (hex.length !== 40) throw new Error(`Invalid EVM address: ${addr}`);
  return "0x" + "0".repeat(24) + hex;
}

function domainKeyFromNetwork(networkName) {
  const n = String(networkName || "").toLowerCase();
  if (n.includes("polygon") || n.includes("mumbai"))
    return "BRIDGE_DOMAIN_POLYGON";
  if (n.includes("arbitrum")) return "BRIDGE_DOMAIN_ARBITRUM";
  return null;
}

function remoteAppKeyFromNetwork(networkName) {
  const n = String(networkName || "").toLowerCase();
  if (n.includes("polygon") || n.includes("mumbai"))
    return "BRIDGE_REMOTE_APP_POLYGON";
  if (n.includes("arbitrum")) return "BRIDGE_REMOTE_APP_ARBITRUM";
  return null;
}

async function main() {
  const [sender] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  const outboxAddr = process.env.SPOKE_OUTBOX_ADDRESS;
  const dstDomain = Number(process.env.BRIDGE_DOMAIN_HUB || "999");
  const user =
    (process.env.DEPOSIT_USER && process.env.DEPOSIT_USER.trim()) ||
    sender.address;
  // Token resolution: prefer explicit DEPOSIT_TOKEN, else infer from network
  let token =
    (process.env.DEPOSIT_TOKEN && process.env.DEPOSIT_TOKEN.trim()) ||
    (String(networkName).toLowerCase().includes("polygon") ||
    String(network.chainId) === "137"
      ? process.env.SPOKE_POLYGON_USDC_ADDRESS &&
        process.env.SPOKE_POLYGON_USDC_ADDRESS.trim()
      : String(networkName).toLowerCase().includes("arbitrum")
      ? process.env.SPOKE_ARBITRUM_USDC_ADDRESS &&
        process.env.SPOKE_ARBITRUM_USDC_ADDRESS.trim()
      : undefined);
  const amountStr = "5";
  const decimals = Number(process.env.DEPOSIT_DECIMALS || "6");
  let depositId = process.env.DEPOSIT_ID;
  const doDeliver =
    process.env.DELIVER_TO_HUB === "1" ||
    String(process.env.DELIVER_TO_HUB || "").toLowerCase() === "true";

  console.log("\n🚀 sendDeposit()");
  console.log("─".repeat(60));
  console.log(`Network: ${networkName} (chainId ${network.chainId})`);
  console.log(`Sender:  ${sender.address}`);
  console.log(`Outbox:  ${outboxAddr || "<unset>"}`);
  console.log(
    `Params:  dstDomain=${dstDomain}, user=${user}, token=${token}, amount=${amountStr}, decimals=${decimals}`
  );
  if (depositId) console.log(`depositId: ${depositId}`);

  if (!outboxAddr) usage("SPOKE_OUTBOX_ADDRESS env is required");
  if (!ethers.isAddress(user))
    usage("Invalid user address (set DEPOSIT_USER or ensure signer is valid)");
  if (!ethers.isAddress(token))
    usage("Invalid token address (set DEPOSIT_TOKEN or SPOKE_*_USDC_ADDRESS)");
  if (!amountStr || isNaN(Number(amountStr))) usage("Invalid DEPOSIT_AMOUNT");
  if (!Number.isFinite(decimals) || decimals < 0 || decimals > 36)
    usage("Invalid DEPOSIT_DECIMALS");

  const amount = ethers.parseUnits(String(amountStr), decimals);

  // Auto-generate a depositId if not provided
  if (!depositId) {
    const abi = ethers.AbiCoder.defaultAbiCoder();
    const salt = BigInt(Math.floor(Date.now() / 1000));
    depositId = ethers.keccak256(
      abi.encode(
        ["address", "address", "uint256", "uint32", "uint256"],
        [user, token, amount, dstDomain, salt]
      )
    );
    console.log(`Generated depositId: ${depositId}`);
  } else if (!isHex32(depositId)) {
    usage("DEPOSIT_ID must be a 32-byte hex string (0x…64 hex chars)");
  }

  // Contract call
  const outbox = await ethers.getContractAt(
    "SpokeBridgeOutboxWormhole",
    outboxAddr
  );
  const feeOv = await feeOverridesForNetwork(networkName);
  console.log(
    `  ↳ fee overrides: maxPriorityFeePerGas=${feeOv.maxPriorityFeePerGas?.toString?.()} maxFeePerGas=${feeOv.maxFeePerGas?.toString?.()}`
  );

  try {
    const tx = await outbox.sendDeposit(
      dstDomain,
      user,
      token,
      amount,
      depositId,
      {
        ...feeOv,
        gasLimit: 250000n,
      }
    );
    console.log(`  ⛽ tx: ${tx.hash}`);
    const rc = await tx.wait();
    console.log(`  ✅ sendDeposit mined in block ${rc?.blockNumber}`);
  } catch (e) {
    console.error("❌ sendDeposit failed:", e);
    process.exit(1);
  }

  if (!doDeliver) {
    console.log(
      "\nℹ️ Skipping hub delivery. Set DELIVER_TO_HUB=1 to auto-deliver."
    );
    console.log(
      "   Required env for delivery: HUB_INBOX_ADDRESS, BRIDGE_DOMAIN_<SPOKE>, BRIDGE_REMOTE_APP_<SPOKE> or SPOKE_OUTBOX_ADDRESS, and relayer RPC/key."
    );
    return;
  }

  // ========== Deliver to Hub inbox (complete the deposit) ==========
  console.log("\n📨 deliverToHub()");
  console.log("─".repeat(60));
  const hubInboxAddr = process.env.HUB_INBOX_ADDRESS;
  if (!hubInboxAddr || !ethers.isAddress(hubInboxAddr)) {
    usage("HUB_INBOX_ADDRESS env is required for delivery");
  }
  // Determine srcDomain/srcApp (spoke domain + outbox-as-bytes32)
  const domainKey = domainKeyFromNetwork(networkName);
  const remoteKey = remoteAppKeyFromNetwork(networkName);
  const srcDomain = Number(
    (domainKey ? process.env[domainKey] : "") ||
      process.env.BRIDGE_DOMAIN_SPOKE ||
      0
  );
  if (!Number.isFinite(srcDomain) || srcDomain <= 0) {
    usage(
      `Missing/invalid srcDomain. Set ${domainKey || "BRIDGE_DOMAIN_<SPOKE>"}`
    );
  }
  let srcApp = (remoteKey ? process.env[remoteKey] : "") || null;
  if (!srcApp) {
    const spokeOutbox = process.env.SPOKE_OUTBOX_ADDRESS;
    if (!spokeOutbox || !ethers.isAddress(spokeOutbox)) {
      usage(
        `Missing ${
          remoteKey || "BRIDGE_REMOTE_APP_<SPOKE>"
        } and SPOKE_OUTBOX_ADDRESS; set env`
      );
    }
    srcApp = toBytes32Address(spokeOutbox);
  }
  if (!isHex32(srcApp))
    usage(
      "BRIDGE_REMOTE_APP_<SPOKE> must be a 32-byte hex string (0x…64 hex chars)"
    );

  // Encode payload: (uint8 msgType=1, address user, address token, uint256 amount, bytes32 depositId)
  const TYPE_DEPOSIT = 1;
  const msgType = Number(process.env.DEPOSIT_MSG_TYPE || TYPE_DEPOSIT);
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const payload = abi.encode(
    ["uint8", "address", "address", "uint256", "bytes32"],
    [msgType, user, token, amount, depositId]
  );
  console.log(`Hub Inbox: ${hubInboxAddr}`);
  console.log(`Src Domain: ${srcDomain}`);
  console.log(`Src App:    ${srcApp}`);

  // Connect to hub RPC with relayer key (must have BRIDGE_ENDPOINT_ROLE)
  const hubRpc =
    process.env.HUB_RPC_URL ||
    process.env.RPC_URL_HUB ||
    process.env.RPC_URL_HYPEREVM ||
    hre?.config?.networks?.hyperliquid?.url ||
    null;
  let relayerPk = (
    process.env.RELAYER_PRIVATE_KEY ||
    process.env.PRIVATE_KEY_DEPLOYER ||
    process.env.PRIVATE_KEY ||
    ""
  ).trim();
  if (relayerPk && !relayerPk.startsWith("0x")) relayerPk = "0x" + relayerPk;
  if (!hubRpc)
    usage("Missing hub RPC. Set HUB_RPC_URL/RPC_URL_HUB/RPC_URL_HYPEREVM");
  if (!relayerPk)
    usage("Missing relayer key. Set RELAYER_PRIVATE_KEY/PRIVATE_KEY_DEPLOYER");

  const hubProvider = new ethers.JsonRpcProvider(hubRpc);
  const hubSigner = new ethers.Wallet(relayerPk, hubProvider);

  // Build contract instance with correct ABI bound to hub signer
  const HubInboxFactory = await ethers.getContractFactory(
    "HubBridgeInboxWormhole"
  );
  const hubInbox = new ethers.Contract(
    hubInboxAddr,
    HubInboxFactory.interface,
    hubSigner
  );

  // Optional role check
  const BRIDGE_ENDPOINT_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("BRIDGE_ENDPOINT_ROLE")
  );
  try {
    const has = await hubInbox.hasRole(BRIDGE_ENDPOINT_ROLE, hubSigner.address);
    if (!has) {
      console.log(
        `  ⚠️ Relayer ${hubSigner.address} does not have BRIDGE_ENDPOINT_ROLE on HUB_INBOX`
      );
    }
  } catch {
    // ignore if call fails on non-ACL-like chains
  }

  const feeOvHub = await feeOverridesForProvider(hubProvider, "hyperliquid");
  console.log(
    `  ↳ hub fee overrides: maxPriorityFeePerGas=${feeOvHub.maxPriorityFeePerGas?.toString?.()} maxFeePerGas=${feeOvHub.maxFeePerGas?.toString?.()}`
  );

  try {
    const tx = await hubInbox.receiveMessage(
      Number(srcDomain),
      srcApp,
      payload,
      {
        ...feeOvHub,
        gasLimit: 300000n,
      }
    );
    console.log(`  ⛽ hub tx: ${tx.hash}`);
    const rc = await tx.wait();
    console.log(`  ✅ deposit delivered on hub in block ${rc?.blockNumber}`);
  } catch (e) {
    console.error("❌ hub delivery failed:", e);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
