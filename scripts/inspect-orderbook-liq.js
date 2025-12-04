#!/usr/bin/env node

/**
 * Inspect OrderBook state and recent liquidation events.
 *
 * Usage:
 *   node scripts/inspect-orderbook-liq.js --orderBook 0x... [--rpc https://...] [--blocks 200]
 *
 * Reads:
 *  - marketId from OrderBook
 *  - bestBid/bestAsk (liquidity status)
 *  - CoreVault.marketToOrderBook(marketId) mapping
 *  - CoreVault.getUsersWithPositionsInMarket(marketId).length
 *  - Recent liquidation events to see where pokeLiquidations flow stops
 */

/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
try {
  const envLocal = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envLocal)) {
    require('dotenv').config({ path: envLocal });
  } else {
    const env = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(env)) {
      require('dotenv').config({ path: env });
    } else {
      require('dotenv').config();
    }
  }
} catch (_) {}

const { createPublicClient, http, isAddress, hexToString } = require('viem');

function getArg(flag) {
  const idx = process.argv.findIndex((a) => a === flag);
  if (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) return process.argv[idx + 1];
  const pref = `${flag}=`;
  const direct = process.argv.find((a) => a.startsWith(pref));
  if (direct) return direct.slice(pref.length);
  return undefined;
}

const rpcUrl = getArg('--rpc') || process.env.RPC_URL || 'http://localhost:8545';
const orderBook = getArg('--orderBook') || process.env.ORDERBOOK_ADDRESS;
const coreVault = process.env.CORE_VAULT_ADDRESS;
const blockWindow = parseInt(getArg('--blocks') || '200', 10);

if (!orderBook || !isAddress(orderBook)) {
  console.error('❌ Provide a valid --orderBook 0x... address or set ORDERBOOK_ADDRESS in env');
  process.exit(1);
}
if (!coreVault || !isAddress(coreVault)) {
  console.error('❌ CORE_VAULT_ADDRESS not set in env (.env.local/.env)');
  process.exit(1);
}

// Minimal ABIs
const OB_VIEW_ABI = [
  { type: 'function', stateMutability: 'view', name: 'getMarketId', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', stateMutability: 'view', name: 'marketStatic', inputs: [], outputs: [{ type: 'address' }, { type: 'bytes32' }, { type: 'bool' }, { type: 'uint256' }] },
  { type: 'function', stateMutability: 'view', name: 'bestBid', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', stateMutability: 'view', name: 'bestAsk', inputs: [], outputs: [{ type: 'uint256' }] },
];

const CORE_VAULT_ABI = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'marketToOrderBook',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [{ type: 'address' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getUsersWithPositionsInMarket',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [{ type: 'address[]' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getPositionSummary',
    inputs: [{ name: 'user', type: 'address' }, { name: 'marketId', type: 'bytes32' }],
    outputs: [{ type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }]
  },
];

// OBLiquidationFacet events (subset)
const OBLiqEvents = [
  { type: 'event', name: 'LiquidationCheckStarted', inputs: [
    { indexed: false, name: 'markPrice', type: 'uint256' },
    { indexed: false, name: 'tradersLength', type: 'uint256' },
    { indexed: false, name: 'startIndex', type: 'uint256' },
    { indexed: false, name: 'endIndex', type: 'uint256' },
  ]},
  { type: 'event', name: 'LiquidationRecursionGuardSet', inputs: [
    { indexed: false, name: 'inProgress', type: 'bool' }
  ]},
  { type: 'event', name: 'LiquidationTraderBeingChecked', inputs: [
    { indexed: true, name: 'trader', type: 'address' },
    { indexed: false, name: 'index', type: 'uint256' },
    { indexed: false, name: 'totalTraders', type: 'uint256' },
  ]},
  { type: 'event', name: 'LiquidationLiquidatableCheck', inputs: [
    { indexed: true, name: 'trader', type: 'address' },
    { indexed: false, name: 'isLiquidatable', type: 'bool' },
    { indexed: false, name: 'markPrice', type: 'uint256' },
  ]},
  { type: 'event', name: 'LiquidationLiquidityCheck', inputs: [
    { indexed: false, name: 'isBuy', type: 'bool' },
    { indexed: false, name: 'bestOppositePrice', type: 'uint256' },
    { indexed: false, name: 'hasLiquidity', type: 'bool' },
  ]},
  { type: 'event', name: 'LiquidationMarketOrderResult', inputs: [
    { indexed: true, name: 'trader', type: 'address' },
    { indexed: false, name: 'success', type: 'bool' },
    { indexed: false, name: 'reason', type: 'string' },
  ]},
  { type: 'event', name: 'LiquidationCheckFinished', inputs: [
    { indexed: false, name: 'tradersChecked', type: 'uint256' },
    { indexed: false, name: 'liquidationsTriggered', type: 'uint256' },
    { indexed: false, name: 'nextStartIndex', type: 'uint256' },
  ]},
];

async function main() {
  console.log('🔎 Inspecting OrderBook liquidation state\n');
  console.log('RPC URL   :', rpcUrl);
  console.log('OrderBook :', orderBook);
  console.log('CoreVault :', coreVault, '\n');

  const client = createPublicClient({ transport: http(rpcUrl) });

  // Read basic state
  const [marketIdTry, marketStatic, bid, ask] = await Promise.all([
    client.readContract({ address: orderBook, abi: OB_VIEW_ABI, functionName: 'getMarketId', args: [] }).catch(() => '0x'),
    client.readContract({ address: orderBook, abi: OB_VIEW_ABI, functionName: 'marketStatic', args: [] }).catch(() => null),
    client.readContract({ address: orderBook, abi: OB_VIEW_ABI, functionName: 'bestBid', args: [] }).catch(() => 0n),
    client.readContract({ address: orderBook, abi: OB_VIEW_ABI, functionName: 'bestAsk', args: [] }).catch(() => 0n),
  ]);

  const marketId = marketStatic && Array.isArray(marketStatic) && marketStatic.length >= 2
    ? marketStatic[1]
    : marketIdTry;

  const vaultAddr = marketStatic && Array.isArray(marketStatic) && marketStatic.length >= 1
    ? marketStatic[0]
    : '0x0000000000000000000000000000000000000000';

  console.log('MarketId  :', marketId);
  console.log('OB Vault  :', vaultAddr);
  console.log('bestBid   :', bid.toString());
  console.log('bestAsk   :', ask.toString());

  // Cross-check vault mapping and users
  let mappedOB = '0x0000000000000000000000000000000000000000';
  let users = [];
  if (marketId && marketId !== '0x') {
    [mappedOB, users] = await Promise.all([
      client.readContract({ address: coreVault, abi: CORE_VAULT_ABI, functionName: 'marketToOrderBook', args: [marketId] }).catch(() => '0x0000000000000000000000000000000000000000'),
      client.readContract({ address: coreVault, abi: CORE_VAULT_ABI, functionName: 'getUsersWithPositionsInMarket', args: [marketId] }).catch(() => []),
    ]);
  }
  console.log('Vault mapping -> OrderBook:', mappedOB);
  console.log('Users with positions       :', Array.isArray(users) ? users.length : 0);

  const latest = await client.getBlockNumber();
  const fromBlock = latest > BigInt(blockWindow) ? latest - BigInt(blockWindow) : 0n;
  console.log(`\nScanning events from block ${fromBlock} to ${latest} ...\n`);

  const logs = await client.getLogs({
    address: orderBook,
    fromBlock,
    toBlock: latest,
    events: OBLiqEvents
  }).catch(() => []);

  if (!logs || logs.length === 0) {
    console.log('No liquidation-related events found in the window.');
  } else {
    let summary = {
      started: 0,
      finished: 0,
      recursionGuardTrue: 0,
      recursionGuardFalse: 0,
      tradersChecked: 0,
      liquidatableChecks: 0,
      liqSuccess: 0,
      liqNone: 0,
      noLiquidity: 0,
    };
  
    for (const log of logs) {
      const name = log.eventName;
      if (name === 'LiquidationCheckStarted') {
        summary.started++;
        const { markPrice, tradersLength, startIndex, endIndex } = log.args || {};
        console.log(`Start: mark=${markPrice} traders=${tradersLength} range=[${startIndex},${endIndex}) @${log.blockNumber}`);
      } else if (name === 'LiquidationRecursionGuardSet') {
        if (log.args?.inProgress) summary.recursionGuardTrue++; else summary.recursionGuardFalse++;
      } else if (name === 'LiquidationLiquidatableCheck') {
        summary.liquidatableChecks++;
      } else if (name === 'LiquidationLiquidityCheck') {
        if (log.args && log.args.hasLiquidity === false) summary.noLiquidity++;
      } else if (name === 'LiquidationMarketOrderResult') {
        const { success, reason } = log.args || {};
        if (success) summary.liqSuccess++; else summary.liqNone++;
        console.log(`Result: success=${success} reason=${reason ? (typeof reason === 'string' ? reason : hexToString(reason)) : ''} @${log.blockNumber}`);
      } else if (name === 'LiquidationCheckFinished') {
        summary.finished++;
        const { tradersChecked, liquidationsTriggered, nextStartIndex } = log.args || {};
        console.log(`Finish: checked=${tradersChecked} triggered=${liquidationsTriggered} next=${nextStartIndex} @${log.blockNumber}`);
      }
    }
  
    console.log('\nSummary (recent window):');
    console.table(summary);
  
    if (summary.recursionGuardTrue > 0 && summary.started === 0) {
      console.log('\n⚠️ Recursion guard triggered without a scan starting. The contract may be stuck in liquidationInProgress from a prior failure.');
    }
  }

  // Derived user set by scanning CoreVault PositionUpdated events, then verifying current non-zero positions
  console.log('\nDeriving users with positions from CoreVault PositionUpdated events (same window)...\n');
  const positionUpdatedEvent = {
    type: 'event',
    name: 'PositionUpdated',
    inputs: [
      { indexed: true, name: 'user', type: 'address' },
      { indexed: true, name: 'marketId', type: 'bytes32' },
      { indexed: false, name: 'oldSize', type: 'int256' },
      { indexed: false, name: 'newSize', type: 'int256' },
      { indexed: false, name: 'entryPrice', type: 'uint256' },
      { indexed: false, name: 'marginLocked', type: 'uint256' },
    ],
  };
  const posLogs = await client.getLogs({
    address: coreVault,
    fromBlock,
    toBlock: latest,
    events: [positionUpdatedEvent],
    args: { marketId }
  }).catch(() => []);

  const seen = new Set();
  for (const l of posLogs) {
    if (l.args?.user) seen.add(l.args.user.toLowerCase());
  }
  const candidates = Array.from(seen);
  console.log('Candidates from PositionUpdated:', candidates.length);

  let activeNow = [];
  for (const u of candidates) {
    try {
      const [size] = await client.readContract({
        address: coreVault,
        abi: CORE_VAULT_ABI,
        functionName: 'getPositionSummary',
        args: [u, marketId]
      });
      if (typeof size === 'bigint' && size !== 0n) {
        activeNow.push(u);
      }
    } catch (_) {}
  }
  console.log('Active positions now (derived):', activeNow.length);
  if (activeNow.length && users && Array.isArray(users)) {
    const missing = activeNow.filter((u) => !users.some((x) => x && x.toLowerCase() === u));
    if (missing.length) {
      console.log('\n⚠️ Detected users with positions not reported by CoreVault.getUsersWithPositionsInMarket:');
      for (const m of missing) console.log(' -', m);
    }
  }

  if (users && users.length === 0) {
    console.log('\nℹ️ No users reported with positions for this marketId; poke will not perform liquidations.');
  }
  if (bid === 0n || ask === 0n) {
    console.log('\nℹ️ One side of the book is empty; liquidation may skip due to NO_BIDS/NO_ASKS or hasLiquidity=false.');
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('❌ Inspection error:', e?.shortMessage || e?.message || String(e));
    process.exit(1);
  });
}


