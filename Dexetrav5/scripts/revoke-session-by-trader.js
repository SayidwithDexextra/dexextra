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
 *   RELAYER=0x...         // If provided, only revoke sessions created for this relayer
 *   SESSION_ID=0x...      // If provided, revokes exactly this sessionId (skips discovery)
 *   FROM_BLOCK=0          // Override fromBlock for log scanning (default: 0)
 *   LATEST_ONLY=true      // If set, revoke only the most recent active session
 *
 * Requirements:
 *   - The signer (private key in hardhat config) must be either the trader or the relayer stored in the session (as required by the registry).
 */

const { ethers, artifacts } = require("hardhat");

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

async function main() {
  const net = await ethers.provider.getNetwork();
  const networkName = process.env.HARDHAT_NETWORK || String(net.chainId);
  const registryAddress =
    process.env.REGISTRY || process.env.SESSION_REGISTRY_ADDRESS || "";
  const trader = (process.env.TRADER || "").toLowerCase();
  const relayerFilter = (process.env.RELAYER || "").toLowerCase();
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
  info("[UpGas][script][revoke-session] Target", {
    registry: registryAddress,
    trader,
    relayerFilter: relayerFilter || "(any)",
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
    const canRevoke =
      signerAddr === (s.trader || "").toLowerCase() ||
      signerAddr === (s.relayer || "").toLowerCase();
    if (!canRevoke) {
      throw new Error(
        `Signer ${signerAddr} is not authorized to revoke this session (requires trader or relayer).`
      );
    }
    const tx = await registry.revokeSession(directSessionId);
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
      const evRelayer = (parsed.relayer || "").toLowerCase();
      const expiry = parsed.expiry;
      if (evTrader !== trader) continue;
      if (relayerFilter && evRelayer !== relayerFilter) continue;
      candidates.push({
        sessionId,
        relayer: evRelayer,
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
      relayer: c.relayer,
      expiry: c.expiry.toString(),
      block: c.blockNumber,
    }))
  );

  const now = BigInt(Math.floor(Date.now() / 1000));
  let revoked = 0;
  for (const c of candidates) {
    const s = await registry.sessions(c.sessionId);
    const sTrader = (s.trader || "").toLowerCase?.() || "";
    const sRelayer = (s.relayer || "").toLowerCase?.() || "";
    const sExpiry = BigInt(s.expiry?.toString?.() || s.expiry || 0n);
    const sRevoked = Boolean(s.revoked);
    const active = !sRevoked && sExpiry >= now;
    info("[UpGas][script][revoke-session] Inspect", {
      sessionId: c.sessionId,
      trader: sTrader,
      relayer: sRelayer,
      expiry: sExpiry.toString(),
      revoked: sRevoked,
      active,
    });

    if (!active) {
      continue;
    }
    const canRevoke = signerAddr === sTrader || signerAddr === sRelayer;
    if (!canRevoke) {
      warn(
        "[UpGas][script][revoke-session] Skipping: signer not authorized for session",
        {
          sessionId: c.sessionId,
          signer: signerAddr,
          trader: sTrader,
          relayer: sRelayer,
        }
      );
      continue;
    }
    info("[UpGas][script][revoke-session] Revoking session", {
      sessionId: c.sessionId,
    });
    const tx = await registry.revokeSession(c.sessionId);
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
