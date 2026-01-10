// Grant DEPOSIT_SENDER_ROLE to relayer EOAs on SpokeBridgeOutboxWormhole.
// Loads env from .env.local/.env at repo root.
// Env:
//   OUTBOX_ADDRESS (or SPOKE_OUTBOX_ADDRESS_ARBITRUM / SPOKE_OUTBOX_ADDRESS)
//   PRIVATE_KEY (must have role admin on the outbox)
//   RPC_URL (spoke RPC)
//   RELAYER_ADDRESS (optional single)
//   RELAYER_PRIVATE_KEYS_JSON (optional array of {address,privateKey})
//
// Run:
//   node grant-deposit-sender.js
//   RELAYER_ADDRESS=0xRelayer... node grant-deposit-sender.js

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Load env from root
const root = path.resolve(__dirname);
const envLocal = path.join(root, ".env.local");
const envDefault = path.join(root, ".env");
if (fs.existsSync(envDefault)) dotenv.config({ path: envDefault });
if (fs.existsSync(envLocal)) dotenv.config({ path: envLocal });

console.log(
  "[env] loaded .env:",
  fs.existsSync(envDefault),
  " .env.local:",
  fs.existsSync(envLocal)
);
console.log("[env] OUTBOX_ADDRESS:", process.env.OUTBOX_ADDRESS);
console.log(
  "[env] SPOKE_OUTBOX_ADDRESS_ARBITRUM:",
  process.env.SPOKE_OUTBOX_ADDRESS_ARBITRUM
);
console.log("[env] SPOKE_OUTBOX_ADDRESS:", process.env.SPOKE_OUTBOX_ADDRESS);
console.log("[env] RELAYER_ADDRESS:", process.env.RELAYER_ADDRESS);
console.log(
  "[env] RELAYER_PRIVATE_KEYS_JSON length:",
  (process.env.RELAYER_PRIVATE_KEYS_JSON || "").length
);
console.log("[env] PRIVATE_KEY present:", !!process.env.PRIVATE_KEY);
console.log("[env] RPC_URL:", process.env.RPC_URL);
console.log("[env] ALCHEMY_ARBITRUM_HTTP:", process.env.ALCHEMY_ARBITRUM_HTTP);
console.log("[env] RPC_URL_ARBITRUM:", process.env.RPC_URL_ARBITRUM);
console.log("[env] ARBITRUM_RPC_URL:", process.env.ARBITRUM_RPC_URL);
console.log(
  "[env] NEXT_PUBLIC_ALCHEMY_ARBITRUM_HTTP:",
  process.env.NEXT_PUBLIC_ALCHEMY_ARBITRUM_HTTP
);

async function main() {
  const OUTBOX =
    process.env.OUTBOX_ADDRESS ||
    process.env.SPOKE_OUTBOX_ADDRESS_ARBITRUM ||
    process.env.SPOKE_OUTBOX_ADDRESS;
  const ADMIN_PK = process.env.PRIVATE_KEY;
  // Prefer Arbitrum RPC for spoke outbox; fall back to generic RPC_URL only if needed.
  const RPC_URL =
    process.env.ALCHEMY_ARBITRUM_HTTP ||
    process.env.RPC_URL_ARBITRUM ||
    process.env.ARBITRUM_RPC_URL ||
    process.env.NEXT_PUBLIC_ALCHEMY_ARBITRUM_HTTP ||
    process.env.RPC_URL;

  // Optional explicit relayer; otherwise derive from RELAYER_PRIVATE_KEYS_JSON
  const explicitRelayer = process.env.RELAYER_ADDRESS;
  const relayerKeysJson = process.env.RELAYER_PRIVATE_KEYS_JSON || "[]";

  if (!OUTBOX || !ethers.isAddress(OUTBOX))
    throw new Error(
      "OUTBOX_ADDRESS/SPOKE_OUTBOX_ADDRESS_ARBITRUM missing/invalid"
    );
  if (!ADMIN_PK || !ADMIN_PK.startsWith("0x"))
    throw new Error("PRIVATE_KEY missing/invalid");
  if (!RPC_URL) throw new Error("RPC_URL missing");

  // Build full set of relayer addresses:
  // - all keys in RELAYER_PRIVATE_KEYS_JSON (array of private keys or objects)
  // - plus optional RELAYER_ADDRESS override
  let relayerAddrs = [];
  try {
    const parsed = JSON.parse(relayerKeysJson);
    const addrs = new Set();
    if (explicitRelayer) {
      try {
        addrs.add(ethers.getAddress(explicitRelayer));
      } catch {
        // ignore invalid explicit relayer
      }
    }
    for (const entry of parsed) {
      try {
        let addr = null;
        if (typeof entry === "string") {
          // Entry is a private key; derive address
          const w = new ethers.Wallet(entry);
          addr = w.address;
        } else if (entry && typeof entry === "object") {
          // Entry may already contain an address field or privateKey
          if (entry.address) addr = entry.address;
          else if (entry.privateKey) {
            const w = new ethers.Wallet(entry.privateKey);
            addr = w.address;
          }
        }
        if (addr && ethers.isAddress(addr)) {
          addrs.add(ethers.getAddress(addr));
        }
      } catch {
        // ignore malformed entry
      }
    }
    relayerAddrs = [...addrs];
  } catch (e) {
    throw new Error("Failed to parse RELAYER_PRIVATE_KEYS_JSON");
  }

  if (relayerAddrs.length === 0)
    throw new Error(
      "No relayer addresses found (set RELAYER_ADDRESS or RELAYER_PRIVATE_KEYS_JSON)"
    );

  const ROLE = ethers.keccak256(ethers.toUtf8Bytes("DEPOSIT_SENDER_ROLE"));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ADMIN_PK, provider);
  const outbox = new ethers.Contract(
    OUTBOX,
    [
      "function hasRole(bytes32 role, address account) view returns (bool)",
      "function grantRole(bytes32 role, address account) external",
      "function getRoleAdmin(bytes32 role) view returns (bytes32)",
      "event RoleGranted(bytes32 indexed role,address indexed account,address indexed sender)",
    ],
    wallet
  );

  const net = await provider.getNetwork();
  console.log("Network:", net);
  console.log("Outbox:", OUTBOX);
  console.log("Admin (sender):", wallet.address);
  console.log("Role hash (DEPOSIT_SENDER_ROLE):", ROLE);
  let adminRole = null;
  try {
    adminRole = await outbox.getRoleAdmin(ROLE);
    console.log("Role admin (bytes32):", adminRole);

    // Enumerate all accounts that have ever been granted this admin role via events
    try {
      const roleGrantedTopic = ethers.id(
        "RoleGranted(bytes32,address,address)"
      );
      const filter = {
        address: OUTBOX,
        fromBlock: 0n,
        toBlock: "latest",
        topics: [roleGrantedTopic, adminRole],
      };
      const logs = await provider.getLogs(filter);
      const iface = new ethers.Interface([
        "event RoleGranted(bytes32 indexed role,address indexed account,address indexed sender)",
      ]);
      const admins = new Set();
      for (const log of logs) {
        const parsed = iface.parseLog(log);
        const account = parsed?.args?.account;
        if (account) {
          admins.add(ethers.getAddress(account));
        }
      }
      console.log("Accounts with admin role for DEPOSIT_SENDER_ROLE:", [
        ...admins,
      ]);
    } catch (e) {
      console.warn("Could not enumerate admin role holders:", e?.message || e);
    }

    const senderIsAdmin = await outbox.hasRole(adminRole, wallet.address);
    console.log("Sender has admin role?", senderIsAdmin);
    if (!senderIsAdmin) {
      throw new Error(
        `Sender ${wallet.address} lacks admin role ${adminRole}; cannot grant role.`
      );
    }
  } catch (e) {
    if (!adminRole) {
      console.warn("Could not read role admin:", e?.message || e);
    } else {
      throw e;
    }
  }

  // Optional: check BRIDGE_ENDPOINT_ROLE on the hub inbox for the same relayer addresses
  try {
    const hubInbox = String(process.env.HUB_INBOX_ADDRESS || "").trim();
    const hubRpc =
      process.env.HUB_RPC_URL ||
      process.env.ALCHEMY_HYPERLIQUID_HTTP ||
      process.env.RPC_URL_HUB ||
      process.env.RPC_URL_HYPEREVM ||
      process.env.HYPERLIQUID_RPC_URL ||
      "";
    if (hubInbox && ethers.isAddress(hubInbox) && hubRpc) {
      console.log(
        "\n[hub] checking BRIDGE_ENDPOINT_ROLE on HubBridgeInboxWormhole"
      );
      const hubProvider = new ethers.JsonRpcProvider(hubRpc);
      const hub = new ethers.Contract(
        hubInbox,
        [
          "function BRIDGE_ENDPOINT_ROLE() view returns (bytes32)",
          "function hasRole(bytes32 role, address account) view returns (bool)",
        ],
        hubProvider
      );
      const hubRole = await hub.BRIDGE_ENDPOINT_ROLE();
      console.log("[hub] BRIDGE_ENDPOINT_ROLE hash:", hubRole);
      for (const addr of relayerAddrs) {
        const has = await hub.hasRole(hubRole, addr);
        console.log("[hub] relayer BRIDGE_ENDPOINT_ROLE", {
          relayer: addr,
          hasRole: has,
        });
      }
    } else {
      console.log(
        "[hub] skipping BRIDGE_ENDPOINT_ROLE check; HUB_INBOX_ADDRESS or hub RPC envs are missing"
      );
    }
  } catch (e) {
    console.warn("[hub] failed BRIDGE_ENDPOINT_ROLE check:", e?.message || e);
  }

  for (const relayerAddr of relayerAddrs) {
    console.log("\n=== Relayer", relayerAddr, "===");
    const before = await outbox.hasRole(ROLE, relayerAddr);
    console.log("Has role before?", before);
    if (before) {
      console.log("Already has role; skipping grant.");
      continue;
    }
    console.log("Granting role...");
    const tx = await outbox.grantRole(ROLE, relayerAddr);
    console.log("Tx sent:", tx.hash);
    const rc = await tx.wait();
    console.log("Mined in block:", rc?.blockNumber);
    const after = await outbox.hasRole(ROLE, relayerAddr);
    console.log("Has role after?", after);
    if (!after)
      throw new Error(
        `Role grant did not stick for ${relayerAddr}; check admin permissions and tx status.`
      );
  }
  console.log("\n✅ Done");
}

main().catch((err) => {
  console.error("❌ Error:", err?.message || err);
  process.exit(1);
});
