#!/usr/bin/env node
/**
 * Revoke all active sessions for a given user address on the GlobalSessionRegistry.
 *
 * Usage:
 *   node scripts/revoke-user-session.mjs <userAddress>
 */
import { ethers } from 'ethers';

const USER = process.argv[2];
if (!USER || !ethers.isAddress(USER)) {
  console.error('Usage: node scripts/revoke-user-session.mjs <userAddress>');
  process.exit(1);
}

const RPC_URL = process.env.RPC_URL || 'https://rpc.hyperliquid.xyz/evm';
const REGISTRY = process.env.SESSION_REGISTRY_ADDRESS || '0xFad7D190180fd4c7910602D2A7bCCC715bf8454D';
const RELAYER_KEY = process.env.RELAYER_PRIVATE_KEY;

if (!RELAYER_KEY) {
  console.error('RELAYER_PRIVATE_KEY env var is required');
  process.exit(1);
}

const REGISTRY_ABI = [
  'event SessionCreated(bytes32 indexed sessionId, address indexed trader, bytes32 relayerSetRoot, uint256 expiry)',
  'event SessionRevoked(bytes32 indexed sessionId)',
  'function sessions(bytes32) view returns (address trader, bytes32 relayerSetRoot, uint256 expiry, uint256 maxNotionalPerTrade, uint256 maxNotionalPerSession, bytes32 methodsBitmap, uint256 notionalUsed, bool revoked)',
  'function revokeSession(bytes32 sessionId, bytes32[] relayerProof)',
];

// Merkle helpers (mirrors src/lib/relayerMerkle.ts)
function merkleLeaf(address) {
  return ethers.keccak256(ethers.solidityPacked(['address'], [ethers.getAddress(address)]));
}
function hashPair(a, b) {
  const [l, r] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([l, r]));
}
function computeProof(addresses, target) {
  let leaves = addresses.map(merkleLeaf).sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase()));
  const tgt = merkleLeaf(target);
  let idx = leaves.findIndex(l => l.toLowerCase() === tgt.toLowerCase());
  if (idx < 0) return [];
  const proof = [];
  while (leaves.length > 1) {
    const pairIdx = idx % 2 === 1 ? idx - 1 : idx + 1;
    proof.push(leaves[pairIdx] ?? leaves[idx]);
    const next = [];
    for (let i = 0; i < leaves.length; i += 2) {
      next.push(hashPair(leaves[i], leaves[i + 1] ?? leaves[i]));
    }
    leaves = next;
    idx = Math.floor(idx / 2);
  }
  return proof;
}

// Build relayer set from RELAYER_PRIVATE_KEYS_JSON or single key
function loadRelayerAddresses() {
  const jsonEnv = process.env.RELAYER_PRIVATE_KEYS_JSON;
  if (jsonEnv) {
    try {
      const keys = JSON.parse(jsonEnv);
      if (Array.isArray(keys)) {
        return keys
          .map(k => String(k).trim())
          .filter(Boolean)
          .map(k => {
            const pk = k.startsWith('0x') ? k : `0x${k}`;
            return new ethers.Wallet(pk).address;
          });
      }
    } catch {}
  }
  return [new ethers.Wallet(RELAYER_KEY).address];
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const net = await provider.getNetwork();
  console.log(`Connected to chain ${net.chainId}`);

  const registry = new ethers.Contract(REGISTRY, REGISTRY_ABI, provider);

  console.log(`\nLooking up SessionCreated events for trader ${USER} ...`);
  const filter = registry.filters.SessionCreated(null, USER);
  const latestBlock = await provider.getBlockNumber();
  console.log(`Latest block: ${latestBlock}`);
  // Scan last 500k blocks (sessions are a recent feature)
  const LOOKBACK = 500_000;
  const startBlock = Math.max(0, latestBlock - LOOKBACK);
  const CHUNK = 9999;
  const events = [];
  for (let from = startBlock; from <= latestBlock; from += CHUNK + 1) {
    const to = Math.min(from + CHUNK, latestBlock);
    const chunk = await registry.queryFilter(filter, from, to);
    events.push(...chunk);
    if ((from - startBlock) % 50000 < CHUNK) {
      const pct = Math.round(((from - startBlock) / (latestBlock - startBlock)) * 100);
      process.stdout.write(`\r  Scanned ${pct}%`);
    }
  }
  process.stdout.write('\r');
  console.log(`Found ${events.length} SessionCreated event(s)\n`);

  if (events.length === 0) {
    console.log('No sessions found for this user.');
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const activeSessions = [];

  for (const ev of events) {
    const sessionId = ev.args.sessionId;
    const session = await registry.sessions(sessionId);
    const expired = Number(session.expiry) < now;
    const revoked = session.revoked;
    console.log(`  Session ${sessionId}`);
    console.log(`    trader:  ${session.trader}`);
    console.log(`    expiry:  ${new Date(Number(session.expiry) * 1000).toISOString()} ${expired ? '(EXPIRED)' : ''}`);
    console.log(`    revoked: ${revoked}`);
    console.log(`    bitmap:  ${session.methodsBitmap}`);
    console.log(`    notionalUsed: ${session.notionalUsed.toString()}`);

    if (!revoked && !expired) {
      activeSessions.push(sessionId);
    }
  }

  if (activeSessions.length === 0) {
    console.log('\nNo active (non-revoked, non-expired) sessions to revoke.');
    return;
  }

  console.log(`\n${activeSessions.length} active session(s) to revoke.`);

  const wallet = new ethers.Wallet(RELAYER_KEY, provider);
  const regSigned = new ethers.Contract(REGISTRY, REGISTRY_ABI, wallet);
  const relayerAddresses = loadRelayerAddresses();
  const proof = computeProof(relayerAddresses, wallet.address);

  console.log(`Relayer: ${wallet.address}`);
  console.log(`Proof length: ${proof.length}\n`);

  for (const sessionId of activeSessions) {
    console.log(`Revoking session ${sessionId} ...`);
    try {
      const tx = await regSigned.revokeSession(sessionId, proof);
      console.log(`  tx hash: ${tx.hash}`);
      const rc = await tx.wait();
      console.log(`  mined in block ${rc.blockNumber}`);
    } catch (err) {
      console.error(`  FAILED: ${err.reason || err.shortMessage || err.message}`);
    }
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
