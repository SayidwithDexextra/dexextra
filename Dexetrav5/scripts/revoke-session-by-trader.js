#!/usr/bin/env node

/**
 * revoke-session-by-trader.js
 *
 * Revokes active session(s) for a given trader using the GlobalSessionRegistry (shared across markets).
 *
 * Usage:
 *   HARDHAT_NETWORK=hyperliquid REGISTRY=0x... TRADER=0x... npx hardhat run Dexetrav5/scripts/revoke-session-by-trader.js --network hyperliquid
 *
 * Optional:
 *   RELAYER_SET_ROOT=0x... // If provided, only revoke sessions created for this relayer set root
 *   SESSION_ID=0x...      // If provided, revokes exactly this sessionId (skips discovery)
 *   FROM_BLOCK=0          // Override fromBlock for log scanning (default: 0)
 *   LATEST_ONLY=true      // If set, revoke only the most recent active session
 *
 * Requirements:
 *   - The signer must be either:
 *       - the trader (no Merkle proof required), or
 *       - a relayer address that is part of the session's relayer set (when RELAYER_PRIVATE_KEYS_JSON / RELAYER_PRIVATE_KEY is configured; this script will compute the Merkle proof automatically).
 */

const { ethers, artifacts } = require("hardhat");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
require("dotenv").config();

function sep() {
  console.log("────────────────────────────────────────────────────────────");
}
function info(msg, extra) {
  console.log(`ℹ️  ${msg}`, extra ?? "");
}
function ok(msg, extra) {
  console.log(`✅ ${msg}`, extra ?? "");
}
function warn(msg, extra) {
  console.log(`⚠️  ${msg}`, extra ?? "");
}
function err(msg, extra) {
  console.error(`❌ ${msg}`, extra ?? "");
}
function isAddress(v) {
  return typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v);
}

// ============ Merkle helpers (mirror src/lib/relayerMerkle.ts) ============
function merkleLeafForRelayer(address) {
  const a = ethers.getAddress(address);
  return ethers.keccak256(ethers.solidityPacked(["address"], [a]));
}

function hashPair(a, b) {
  const aa = a.toLowerCase();
  const bb = b.toLowerCase();
  const [left, right] = aa <= bb ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([left, right]));
}

function computeRelayerProof(relayerAddresses, relayerAddress) {
  const leaves = relayerAddresses.map(merkleLeafForRelayer);
  const targetLeaf = merkleLeafForRelayer(relayerAddress);
  if (leaves.length === 0) return [];

  let level = [...leaves].sort((x, y) =>
    x.toLowerCase().localeCompare(y.toLowerCase())
  );
  let idx = level.findIndex(
    (x) => x.toLowerCase() === targetLeaf.toLowerCase()
  );
  if (idx < 0) return [];

  const proof = [];
  while (level.length > 1) {
    const isRight = idx % 2 === 1;
    const pairIdx = isRight ? idx - 1 : idx + 1;
    const sibling = level[pairIdx] ?? level[idx];
    proof.push(sibling);

    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? level[i];
      next.push(hashPair(left, right));
    }
    level = next;
    idx = Math.floor(idx / 2);
  }

  return proof;
}

function parseJsonArray(json) {
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizePk(pk) {
  const raw = String(pk || "").trim();
  if (!raw) return "";
  const v = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(v)) return "";
  return v;
}

function loadRelayerAddressesForProof(explicitPk) {
  const addrs = [];

  const json = String(process.env.RELAYER_PRIVATE_KEYS_JSON || "").trim();
  if (json) {
    const raw = parseJsonArray(json);
    for (const pkRaw of raw) {
      const pk = normalizePk(pkRaw);
      if (!pk) continue;
      try {
        const w = new ethers.Wallet(pk);
        addrs.push(ethers.getAddress(w.address));
      } catch {
        // skip invalid keys
      }
    }
  }

  // Backward-compatible: include single RELAYER_PRIVATE_KEY when provided
  if (explicitPk) {
    try {
      const w = new ethers.Wallet(explicitPk);
      addrs.push(ethers.getAddress(w.address));
    } catch {
      // ignore
    }
  }

  // De-duplicate (case-insensitive)
  const uniq = Array.from(new Set(addrs.map((a) => a.toLowerCase()))).map((a) =>
    ethers.getAddress(a)
  );
  return uniq;
}

async function main() {
  const net = await ethers.provider.getNetwork();
  const networkName = process.env.HARDHAT_NETWORK || String(net.chainId);
  const registryAddress =
    process.env.REGISTRY || process.env.SESSION_REGISTRY_ADDRESS || "";
  const trader = (process.env.TRADER || "").toLowerCase();
  const relayerSetRootFilter = String(process.env.RELAYER_SET_ROOT || "").toLowerCase();
  const directSessionId = process.env.SESSION_ID || "";
  const fromBlock = process.env.FROM_BLOCK ? Number(process.env.FROM_BLOCK) : 0;
  const latestOnly =
    String(process.env.LATEST_ONLY || "").toLowerCase() === "true";

  sep();
  console.log("🔎 Revoke Session By Trader");
  sep();
  info("[UpGas][script][revoke-session] Network", {
    name: networkName,
    chainId: String(net.chainId),
  });

  if (!isAddress(registryAddress))
    throw new Error(
      "Set REGISTRY (or SESSION_REGISTRY_ADDRESS) to the GlobalSessionRegistry address."
    );
  if (!isAddress(trader))
    throw new Error(
      "Set TRADER to the user address whose sessions you want to revoke."
    );

  // Prefer explicit RELAYER_PRIVATE_KEY when set; fallback to first configured signer
  let signer;
  let relayerPk = (
    process.env.RELAYER_PRIVATE_KEY ||
    process.env.NEXT_PUBLIC_RELAYER_PRIVATE_KEY ||
    ""
  ).trim();
  if (relayerPk) {
    // Normalize to 0x-prefixed 64-hex
    const hex = relayerPk.startsWith("0x") ? relayerPk.slice(2) : relayerPk;
    if (/^[0-9a-fA-F]{64}$/.test(hex)) {
      relayerPk = "0x" + hex;
    } else {
      relayerPk = "";
    }
  }
  if (relayerPk) {
    const provider = ethers.provider;
    signer = new ethers.Wallet(relayerPk, provider);
  } else {
    [signer] = await ethers.getSigners();
  }
  const signerAddr = (await signer.getAddress()).toLowerCase();
  info("[UpGas][script][revoke-session] Signer", signerAddr);

  // Derive relayer set (if configured) and Merkle proof for signer when acting as relayer
  const relayerAddresses = loadRelayerAddressesForProof(relayerPk);
  const signerInRelayerSet = relayerAddresses.some(
    (a) => a.toLowerCase() === signerAddr
  );
  const relayerProofForSigner = signerInRelayerSet
    ? computeRelayerProof(relayerAddresses, signerAddr)
    : [];
  if (relayerProofForSigner.length) {
    info("[UpGas][script][revoke-session] Relayer Merkle proof ready for signer", {
      relayerCount: relayerAddresses.length,
      proofLength: relayerProofForSigner.length,
    });
  } else if (relayerAddresses.length) {
    info(
      "[UpGas][script][revoke-session] Signer not found in relayer set; revocation will require trader authority",
      {
        signer: signerAddr,
        relayerCount: relayerAddresses.length,
      }
    );
  }

  info("[UpGas][script][revoke-session] Target", {
    registry: registryAddress,
    trader,
    relayerSetRootFilter: relayerSetRootFilter || "(any)",
    directSessionId: directSessionId || "(auto-discover)",
  });

  const registry = await ethers.getContractAt(
    "GlobalSessionRegistry",
    registryAddress,
    signer
  );

  // If SESSION_ID is provided, revoke it directly
  if (directSessionId && ethers.isHexString(directSessionId)) {
    info(
      "[UpGas][script][revoke-session] Direct mode: revoking provided sessionId",
      directSessionId
    );
    const s = await registry.sessions(directSessionId);
    const sTrader = (s.trader || "").toLowerCase();
    const canRevokeAsTrader = signerAddr === sTrader;
    const canRevokeAsRelayer =
      !canRevokeAsTrader && relayerProofForSigner.length > 0;
    if (!canRevokeAsTrader && !canRevokeAsRelayer) {
      throw new Error(
        `Signer ${signerAddr} is not authorized to revoke this session (requires trader or relayer with Merkle proof).`
      );
    }
    const proofToUse = canRevokeAsTrader ? [] : relayerProofForSigner;
    info("[UpGas][script][revoke-session] Revoking via", {
      mode: canRevokeAsTrader ? "trader" : "relayer",
    });
    const tx = await registry.revokeSession(directSessionId, proofToUse);
    info("[UpGas][script][revoke-session] tx submitted", { hash: tx.hash });
    const rc = await tx.wait();
    ok("[UpGas][script][revoke-session] tx mined", {
      blockNumber: rc?.blockNumber,
    });
    return;
  }

  // Otherwise discover sessions from SessionCreated events on the registry
  const artifact = await artifacts.readArtifact("GlobalSessionRegistry");
  const iface = new ethers.Interface(artifact.abi);
  const topicSessionCreated = iface.getEvent("SessionCreated").topicHash;
  const traderTopic = ethers.zeroPadValue(trader, 32);

  info("[UpGas][script][revoke-session] Scanning logs for SessionCreated...", {
    fromBlock,
  });
  const latestBlock = await ethers.provider.getBlockNumber();
  if (fromBlock > latestBlock) {
    warn(
      "[UpGas][script][revoke-session] fromBlock is greater than latest block, nothing to scan",
      {
        fromBlock,
        latestBlock,
      }
    );
    return;
  }
  let span = Number(process.env.BLOCK_SPAN || "10000");
  if (!Number.isFinite(span) || span <= 0) span = 10000;
  if (span > 10000) span = 10000;
  let logs = [];
  for (let start = fromBlock; start <= latestBlock; start += span) {
    const end = Math.min(start + span - 1, latestBlock);
    info("[UpGas][script][revoke-session] getLogs window", {
      fromBlock: start,
      toBlock: end,
    });
    const chunk = await ethers.provider.getLogs({
      address: registryAddress,
      topics: [topicSessionCreated, null, traderTopic],
      fromBlock: start,
      toBlock: end,
    });
    logs.push(...chunk);
  }
  info("[UpGas][script][revoke-session] Found logs", { count: logs.length });

  // Decode and collect candidates
  const candidates = [];
  for (const log of logs) {
    try {
      const parsed = iface.decodeEventLog(
        "SessionCreated",
        log.data,
        log.topics
      );
      const sessionId = parsed.sessionId;
      const evTrader = (parsed.trader || "").toLowerCase();
      const evRelayerSetRoot = String(parsed.relayerSetRoot || "").toLowerCase();
      const expiry = parsed.expiry;
      if (evTrader !== trader) continue;
      if (relayerSetRootFilter && evRelayerSetRoot !== relayerSetRootFilter) continue;
      candidates.push({
        sessionId,
        relayerSetRoot: evRelayerSetRoot,
        expiry: BigInt(expiry.toString()),
        blockNumber: log.blockNumber,
      });
    } catch (e) {
      warn("[UpGas][script][revoke-session] Failed to decode log", {
        txHash: log.transactionHash,
      });
    }
  }
  if (!candidates.length) {
    warn(
      "[UpGas][script][revoke-session] No sessions discovered for trader (and relayer filter, if any)."
    );
    return;
  }
  // Sort newest first by blockNumber
  candidates.sort((a, b) => b.blockNumber - a.blockNumber);
  info(
    "[UpGas][script][revoke-session] Candidate sessions (newest first):",
    candidates.map((c) => ({
      sessionId: c.sessionId,
      relayerSetRoot: c.relayerSetRoot,
      expiry: c.expiry.toString(),
      block: c.blockNumber,
    }))
  );

  const now = BigInt(Math.floor(Date.now() / 1000));
  let revoked = 0;
  for (const c of candidates) {
    const s = await registry.sessions(c.sessionId);
    const sTrader = (s.trader || "").toLowerCase?.() || "";
    const sExpiry = BigInt(s.expiry?.toString?.() || s.expiry || 0n);
    const sRevoked = Boolean(s.revoked);
    const active = !sRevoked && sExpiry >= now;
    info("[UpGas][script][revoke-session] Inspect", {
      sessionId: c.sessionId,
      trader: sTrader,
      relayerSetRoot: String(s.relayerSetRoot || ""),
      expiry: sExpiry.toString(),
      revoked: sRevoked,
      active,
    });

    if (!active) {
      continue;
    }
    const canRevokeAsTrader = signerAddr === sTrader;
    const canRevokeAsRelayer =
      !canRevokeAsTrader && relayerProofForSigner.length > 0;
    if (!canRevokeAsTrader && !canRevokeAsRelayer) {
      warn(
        "[UpGas][script][revoke-session] Skipping: signer not authorized for session",
        {
          sessionId: c.sessionId,
          signer: signerAddr,
          trader: sTrader,
        }
      );
      continue;
    }
    const proofToUse = canRevokeAsTrader ? [] : relayerProofForSigner;
    info("[UpGas][script][revoke-session] Revoking session", {
      sessionId: c.sessionId,
      as: canRevokeAsTrader ? "trader" : "relayer",
    });
    const tx = await registry.revokeSession(c.sessionId, proofToUse);
    info("[UpGas][script][revoke-session] tx submitted", { hash: tx.hash });
    const rc = await tx.wait();
    ok("[UpGas][script][revoke-session] tx mined", {
      blockNumber: rc?.blockNumber,
    });
    revoked++;
    if (latestOnly) break;
  }

  if (revoked === 0) {
    warn(
      "[UpGas][script][revoke-session] No active sessions revoked (none active or signer unauthorized)."
    );
  } else {
    ok("[UpGas][script][revoke-session] Done", { revoked });
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    err("[UpGas][script][revoke-session] failed", e?.message || String(e));
    process.exit(1);
  });
