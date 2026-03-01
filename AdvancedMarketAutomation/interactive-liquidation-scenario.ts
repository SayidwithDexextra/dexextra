#!/usr/bin/env tsx
import fs from 'node:fs';
import readline from 'node:readline/promises';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';

import { Contract, JsonRpcProvider, ethers } from 'ethers';

import { loadAmaEnv } from './lib/env';
import {
  buildSessionPermit,
  createGaslessSessionViaApi,
  fetchRelayerSetRoot,
  fetchSessionNonce,
  signSessionPermit,
} from './lib/gaslessSession';
import { submitSessionTrade } from './lib/gaslessTrade';
import { fetchActiveMarkets, formatMarketLabel } from './lib/markets';
import { loadWalletsFromCsvFile } from './lib/wallets';

type Hex = `0x${string}`;

type TraderWallet = {
  label: string;
  envKey: string;
  privateKey: string;
  address: string;
};

type RoleWallets = {
  shortTrader: TraderWallet;
  longTrader: TraderWallet;
  liquidityMaker: TraderWallet;
  liquidityTaker: TraderWallet;
};

type SessionByAddress = Record<string, string>;

type ScenarioStateV1 = {
  version: 1;
  updatedAt: string;
  chainId: number;
  orderBook: string;
  marketId: Hex;
  marketLabel: string;
  wallets: {
    shortTrader: string;
    longTrader: string;
    liquidityMaker: string;
    liquidityTaker: string;
  };
  inputs: {
    matchUnits: number;
    makerUnits: number;
    takerChunkUnits: number;
    maxConsumeRounds: number;
    thresholdBufferPct: number;
  };
  step1: {
    shortTxHash?: string;
    longTxHash?: string;
    done: boolean;
  };
  liquidationPrice6?: string;
  askPriceAboveLiq6?: string;
  step2: {
    makerTxHash?: string;
    done: boolean;
  };
  consume: {
    roundsCompleted: number;
    pendingRound?: number;
    pendingTxHash?: string;
    txHashes: string[];
  };
  completed: boolean;
};

const SCENARIO_STATE_PATH = path.resolve(
  process.cwd(),
  'AdvancedMarketAutomation/state/interactive-liquidation-scenario.json'
);

type CliArgs = {
  resumeMode: 'ask' | 'always' | 'never';
  marketQuery?: string;
  nonInteractive: boolean;
  yes: boolean;
};

const ORDERBOOK_VIEW_ABI = [
  'function marketStatic() view returns (address vault, bytes32 marketId, bool useVWAP, uint256 vwapWindow)',
  'function calculateMarkPrice() view returns (uint256)',
  'function getMarketPriceData() view returns (uint256 midPrice,uint256 bestBidPrice,uint256 bestAskPrice,uint256 lastTradePriceReturn,uint256 markPrice,uint256 spread,uint256 spreadBps,bool isValid)',
  'function getOrderBookDepth(uint256 levels) view returns (uint256[] bidPrices, uint256[] bidAmounts, uint256[] askPrices, uint256[] askAmounts)',
] as const;

const CORE_VAULT_ABI = [
  'function getPositionSummary(address user, bytes32 marketId) view returns (int256 size, uint256 entryPrice, uint256 marginLocked)',
  'function getLiquidationPrice(address user, bytes32 marketId) view returns (uint256 liquidationPrice, bool hasPosition)',
  'function isUnderLiquidationPosition(address user, bytes32 marketId) view returns (bool)',
] as const;

function fmt6(v: bigint | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return ethers.formatUnits(v, 6);
}

function fmt18(v: bigint | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return ethers.formatUnits(v, 18);
}

function toPrice6(price: number): bigint {
  return BigInt(Math.round(price * 1_000_000));
}

function toAmount18(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000_000_000_000_000));
}

function isHex64(v: string): v is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(v);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function saveScenarioState(state: ScenarioStateV1) {
  fs.mkdirSync(path.dirname(SCENARIO_STATE_PATH), { recursive: true });
  const tmp = `${SCENARIO_STATE_PATH}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, SCENARIO_STATE_PATH);
}

function loadScenarioState(): ScenarioStateV1 | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(SCENARIO_STATE_PATH, 'utf8'));
    if (parsed?.version !== 1) return null;
    return parsed as ScenarioStateV1;
  } catch {
    return null;
  }
}

function sameRunContext(state: ScenarioStateV1, args: {
  chainId: number;
  orderBook: string;
  marketId: Hex;
  shortTrader: string;
  longTrader: string;
  liquidityMaker: string;
  liquidityTaker: string;
  matchUnits: number;
  makerUnits: number;
  takerChunkUnits: number;
  maxConsumeRounds: number;
  thresholdBufferPct: number;
}): boolean {
  return (
    state.chainId === args.chainId &&
    state.orderBook.toLowerCase() === args.orderBook.toLowerCase() &&
    state.marketId.toLowerCase() === args.marketId.toLowerCase() &&
    state.wallets.shortTrader.toLowerCase() === args.shortTrader.toLowerCase() &&
    state.wallets.longTrader.toLowerCase() === args.longTrader.toLowerCase() &&
    state.wallets.liquidityMaker.toLowerCase() === args.liquidityMaker.toLowerCase() &&
    state.wallets.liquidityTaker.toLowerCase() === args.liquidityTaker.toLowerCase() &&
    state.inputs.matchUnits === args.matchUnits &&
    state.inputs.makerUnits === args.makerUnits &&
    state.inputs.takerChunkUnits === args.takerChunkUnits &&
    state.inputs.maxConsumeRounds === args.maxConsumeRounds &&
    state.inputs.thresholdBufferPct === args.thresholdBufferPct
  );
}

async function waitForTxSettled(
  provider: JsonRpcProvider,
  txHash: string | undefined,
  tag: string,
  timeoutMs = 120_000
): Promise<void> {
  if (!txHash) return;
  try {
    const receipt = await provider.waitForTransaction(txHash, 1, timeoutMs);
    if (!receipt) {
      console.log(`[wait] ${tag}: timed out waiting for receipt (${txHash}).`);
      return;
    }
    console.log(`[wait] ${tag}: mined in block ${receipt.blockNumber}.`);
  } catch (e) {
    console.log(`[wait] ${tag}: waitForTransaction error (${(e as Error)?.message || 'unknown error'}).`);
  }
}

async function waitForPositionAndLiq(params: {
  vault: Contract;
  trader: string;
  marketId: Hex;
  pollMs?: number;
  timeoutMs?: number;
}): Promise<{ size: bigint; entry: bigint; margin: bigint; liqPrice: bigint }> {
  const pollMs = params.pollMs ?? 1500;
  const timeoutMs = params.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;
  let lastSize = 0n;
  let lastEntry = 0n;
  let lastMargin = 0n;
  let lastLiq = 0n;

  while (Date.now() < deadline) {
    const [size, entry, margin] = await params.vault.getPositionSummary(params.trader, params.marketId);
    lastSize = BigInt(size);
    lastEntry = BigInt(entry);
    lastMargin = BigInt(margin);
    const [liqPrice, hasPosition] = await params.vault.getLiquidationPrice(params.trader, params.marketId);
    lastLiq = BigInt(liqPrice);
    if (hasPosition && lastLiq > 0n && lastSize !== 0n) {
      return { size: lastSize, entry: lastEntry, margin: lastMargin, liqPrice: lastLiq };
    }
    console.log(
      `[wait] position not ready yet: size=${fmt18(lastSize)} liq=${fmt6(lastLiq)} hasPosition=${hasPosition ? 'YES' : 'NO'}`
    );
    await sleep(pollMs);
  }

  throw new Error(
    `Could not derive liquidation price for short trader after waiting (size=${fmt18(lastSize)} liq=${fmt6(lastLiq)}).`
  );
}

async function askNumber(
  rl: readline.Interface,
  prompt: string,
  defaultValue: number,
  min?: number
): Promise<number> {
  while (true) {
    const raw = (await rl.question(`${prompt} [${defaultValue}]: `)).trim();
    const val = raw === '' ? defaultValue : Number(raw);
    if (!Number.isFinite(val)) {
      console.log('Please enter a numeric value.');
      continue;
    }
    if (min != null && val < min) {
      console.log(`Value must be >= ${min}.`);
      continue;
    }
    return val;
  }
}

async function askIndex(
  rl: readline.Interface,
  prompt: string,
  maxExclusive: number,
  defaultValue: number
): Promise<number> {
  while (true) {
    const raw = (await rl.question(`${prompt} [${defaultValue}]: `)).trim();
    const idx = raw === '' ? defaultValue : Number(raw);
    if (Number.isInteger(idx) && idx >= 0 && idx < maxExclusive) return idx;
    console.log(`Enter an integer between 0 and ${maxExclusive - 1}.`);
  }
}

function parseCliArgs(argv: string[]): CliArgs {
  let resumeMode: CliArgs['resumeMode'] = 'ask';
  let marketQuery: string | undefined;
  let nonInteractive = false;
  let yes = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--resume') {
      resumeMode = 'always';
      continue;
    }
    if (a === '--fresh' || a === '--no-resume') {
      resumeMode = 'never';
      continue;
    }
    if (a === '--market' || a === '--market-filter') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        marketQuery = next.trim();
        i += 1;
      }
      continue;
    }
    if (a.startsWith('--market=')) {
      marketQuery = a.slice('--market='.length).trim();
      continue;
    }
    if (a.startsWith('--market-filter=')) {
      marketQuery = a.slice('--market-filter='.length).trim();
      continue;
    }
    if (a === '--non-interactive') {
      nonInteractive = true;
      continue;
    }
    if (a === '--yes' || a === '-y') {
      yes = true;
      continue;
    }
  }
  if (marketQuery === '') marketQuery = undefined;
  return { resumeMode, marketQuery, nonInteractive, yes };
}

function printWallets(wallets: TraderWallet[]) {
  console.log('\nAvailable wallets:');
  wallets.forEach((w, i) => {
    console.log(`  [${i}] ${w.label} (${w.envKey}) ${w.address}`);
  });
}

function loadWalletsFromCsvAccountsOneToFive(): TraderWallet[] {
  const csvPath = path.resolve(process.cwd(), 'AdvancedMarketAutomation/wallets.csv');
  const csvWallets = loadWalletsFromCsvFile(csvPath);
  if (csvWallets.length < 5) {
    throw new Error(`Need at least 5 wallets in ${csvPath}. Found ${csvWallets.length}.`);
  }
  return csvWallets.slice(0, 5).map((w, i) => ({
    label: w.nickname || `Account${i + 1}`,
    envKey: `wallets.csv#${i + 1}`,
    privateKey: w.privateKey,
    address: w.address,
  }));
}

async function pickRoleWallets(rl: readline.Interface, wallets: TraderWallet[]): Promise<RoleWallets> {
  if (wallets.length < 4) {
    throw new Error('Need at least 4 wallets in env (PRIVATE_KEY_USERD/1/2/3/4/5).');
  }
  printWallets(wallets);

  const used = new Set<number>();
  const pickUnique = async (title: string, defaultIdx: number) => {
    while (true) {
      const idx = await askIndex(rl, title, wallets.length, defaultIdx);
      if (used.has(idx)) {
        console.log('This wallet is already assigned. Pick a different one.');
        continue;
      }
      used.add(idx);
      return wallets[idx];
    }
  };

  const shortTrader = await pickUnique('Pick SHORT trader wallet index', 0);
  const longTrader = await pickUnique('Pick LONG counterparty wallet index', 1);
  const liquidityMaker = await pickUnique('Pick LIQUIDITY MAKER wallet index', 2);
  const liquidityTaker = await pickUnique('Pick LIQUIDITY TAKER wallet index', 3);

  return { shortTrader, longTrader, liquidityMaker, liquidityTaker };
}

async function pickMarketAfterAzure(
  rl: readline.Interface,
  appUrl: string,
  initialFilter?: string,
  nonInteractive = false
) {
  const markets = await fetchActiveMarkets(appUrl, 300);
  if (!markets.length) throw new Error('No active markets returned by /api/markets.');

  let filter = initialFilter?.trim() || '';
  if (!filter) {
    filter = (await rl.question('Filter term after Azure selection [azure]: ')).trim();
    if (!filter) filter = 'azure';
  } else {
    console.log(`Using market filter from CLI: "${filter}"`);
  }

  let filtered = markets.filter((m) => {
    const hay = `${m.symbol || ''} ${m.market_identifier || ''} ${m.market_address}`.toLowerCase();
    return hay.includes(filter.toLowerCase());
  });
  if (!filtered.length) {
    console.log(`No markets matched "${filter}". Showing all active markets.`);
    filtered = markets.slice();
  }

  if (initialFilter) {
    const exact = filtered.find((m) => {
      const symbol = String(m.symbol || '').toLowerCase();
      const ident = String(m.market_identifier || '').toLowerCase();
      const addr = String(m.market_address || '').toLowerCase();
      const f = filter.toLowerCase();
      return symbol === f || ident === f || addr === f;
    });
    if (exact) {
      console.log(`Auto-selected market by exact CLI match: ${formatMarketLabel(exact)}`);
      return exact;
    }
    if (filtered.length === 1) {
      console.log(`Auto-selected only market matching CLI filter: ${formatMarketLabel(filtered[0])}`);
      return filtered[0];
    }
    if (nonInteractive) {
      throw new Error(
        `--non-interactive requires an exact/unique market match for "${filter}" (matches=${filtered.length}).`
      );
    }
  }

  while (true) {
    console.log('\nMarkets:');
    filtered.slice(0, 50).forEach((m, i) => console.log(`  [${i}] ${formatMarketLabel(m)}`));
    if (filtered.length > 50) {
      console.log(`  ... ${filtered.length - 50} more (refine filter to narrow down)`);
    }
    const raw = (await rl.question('Select market index (or type new filter text): ')).trim();
    const idx = Number(raw);
    if (Number.isInteger(idx) && idx >= 0 && idx < Math.min(50, filtered.length)) {
      return filtered[idx];
    }
    if (raw !== '') {
      filter = raw;
      filtered = markets.filter((m) => {
        const hay = `${m.symbol || ''} ${m.market_identifier || ''} ${m.market_address}`.toLowerCase();
        return hay.includes(filter.toLowerCase());
      });
      if (!filtered.length) {
        console.log('No matches. Try another filter.');
        filtered = markets.slice();
      }
    }
  }
}

async function readMarketState(ob: Contract, depthLevels = 8) {
  let markPrice: bigint = 0n;
  let bestBid: bigint = 0n;
  let bestAsk: bigint = 0n;
  let midPrice: bigint = 0n;
  let valid = false;

  try {
    markPrice = (await ob.calculateMarkPrice()) as bigint;
  } catch {
    // fallback below
  }

  try {
    const pd = await ob.getMarketPriceData();
    midPrice = BigInt(pd?.midPrice ?? pd?.[0] ?? 0n);
    bestBid = BigInt(pd?.bestBidPrice ?? pd?.[1] ?? 0n);
    bestAsk = BigInt(pd?.bestAskPrice ?? pd?.[2] ?? 0n);
    const markFromData = BigInt(pd?.markPrice ?? pd?.[4] ?? 0n);
    valid = Boolean(pd?.isValid ?? pd?.[7] ?? false);
    if (markPrice <= 0n) markPrice = markFromData;
  } catch {
    // keep defaults
  }

  let bidPrices: bigint[] = [];
  let bidAmounts: bigint[] = [];
  let askPrices: bigint[] = [];
  let askAmounts: bigint[] = [];
  try {
    const depth = await ob.getOrderBookDepth(depthLevels);
    bidPrices = (depth?.bidPrices ?? depth?.[0] ?? []).map((x: any) => BigInt(x));
    bidAmounts = (depth?.bidAmounts ?? depth?.[1] ?? []).map((x: any) => BigInt(x));
    askPrices = (depth?.askPrices ?? depth?.[2] ?? []).map((x: any) => BigInt(x));
    askAmounts = (depth?.askAmounts ?? depth?.[3] ?? []).map((x: any) => BigInt(x));
  } catch {
    // optional, do not fail full flow
  }

  return { markPrice, midPrice, bestBid, bestAsk, valid, bidPrices, bidAmounts, askPrices, askAmounts };
}

function printMarketState(state: Awaited<ReturnType<typeof readMarketState>>, title: string) {
  console.log(`\n=== ${title} ===`);
  console.log(`Mark: ${fmt6(state.markPrice)} | Mid: ${fmt6(state.midPrice)} | Bid: ${fmt6(state.bestBid)} | Ask: ${fmt6(state.bestAsk)} | Valid: ${state.valid}`);
  console.log('\nTop bids:');
  if (!state.bidPrices.length) console.log('  (none)');
  for (let i = 0; i < Math.min(8, state.bidPrices.length); i++) {
    console.log(`  [${i}] ${fmt6(state.bidPrices[i])} x ${fmt18(state.bidAmounts[i])}`);
  }
  console.log('Top asks:');
  if (!state.askPrices.length) console.log('  (none)');
  for (let i = 0; i < Math.min(8, state.askPrices.length); i++) {
    console.log(`  [${i}] ${fmt6(state.askPrices[i])} x ${fmt18(state.askAmounts[i])}`);
  }
}

async function createSessionsForWallets(params: {
  appUrl: string;
  chainId: number;
  sessionRegistryAddress: string;
  orderBook: string;
  marketId: Hex;
  wallets: TraderWallet[];
}): Promise<SessionByAddress> {
  const relayerSetRoot = await fetchRelayerSetRoot(params.appUrl);
  const now = Math.floor(Date.now() / 1000);
  const out: SessionByAddress = {};

  for (const wallet of params.wallets) {
    const nonce = await fetchSessionNonce(params.appUrl, wallet.address);
    const permit = buildSessionPermit({
      trader: wallet.address,
      relayerSetRoot,
      expirySec: now + 86400,
      nonce,
      allowedMarkets: [params.marketId],
    });
    const signature = await signSessionPermit({
      privateKey: wallet.privateKey,
      chainId: params.chainId,
      registryAddress: params.sessionRegistryAddress,
      permit,
    });
    const session = await createGaslessSessionViaApi({
      appUrl: params.appUrl,
      orderBook: params.orderBook,
      permit,
      signature,
    });
    out[wallet.address.toLowerCase()] = session.sessionId;
    console.log(`[session] ${wallet.label} => ${session.sessionId} tx=${session.txHash || '(pending)'}`);
  }

  return out;
}

async function relayTrade(params: {
  appUrl: string;
  orderBook: string;
  method: 'sessionPlaceLimit' | 'sessionPlaceMarginLimit' | 'sessionPlaceMarket' | 'sessionPlaceMarginMarket';
  sessionId: string;
  trader: string;
  amount18: bigint;
  isBuy: boolean;
  price6?: bigint;
  tag: string;
}) {
  const tradeParams: Record<string, string | boolean> = {
    trader: params.trader,
    amount: params.amount18.toString(),
    isBuy: params.isBuy,
  };
  if (params.price6 != null) tradeParams.price = params.price6.toString();

  const tx = await submitSessionTrade({
    appUrl: params.appUrl,
    orderBook: params.orderBook,
    method: params.method,
    sessionId: params.sessionId,
    tradeParams,
  });
  console.log(`[trade] ${params.tag} => tx=${tx.txHash}`);
  return tx;
}

async function main() {
  const rl = readline.createInterface({ input, output });
  try {
    const cli = parseCliArgs(process.argv.slice(2));
    console.log('Interactive liquidation scenario runner');
    console.log('Flow: Azure-filtered market -> read state -> 10-unit matched trade -> place liquidity above liq threshold -> consume until mark crosses threshold.\n');

    const env = loadAmaEnv();
    const provider = new JsonRpcProvider(env.rpcUrl);
    const net = await provider.getNetwork();
    const chainId = Number(net.chainId);
    if (chainId !== env.chainId) {
      console.log(`Warning: env CHAIN_ID=${env.chainId} but RPC chainId=${chainId}. Using RPC chainId for signatures.`);
    }

    const wallets = loadWalletsFromCsvAccountsOneToFive();
    console.log(`Loaded ${wallets.length} wallets from AdvancedMarketAutomation/wallets.csv (accounts 1-5).`);
    const picked = cli.nonInteractive
      ? {
          shortTrader: wallets[0],
          longTrader: wallets[1],
          liquidityMaker: wallets[2],
          liquidityTaker: wallets[3],
        }
      : await pickRoleWallets(rl, wallets);
    console.log('\nRole assignment:');
    console.log(`  SHORT trader:    ${picked.shortTrader.label} ${picked.shortTrader.address}`);
    console.log(`  LONG trader:     ${picked.longTrader.label} ${picked.longTrader.address}`);
    console.log(`  Liquidity maker: ${picked.liquidityMaker.label} ${picked.liquidityMaker.address}`);
    console.log(`  Liquidity taker: ${picked.liquidityTaker.label} ${picked.liquidityTaker.address}`);

    const market = await pickMarketAfterAzure(rl, env.appUrl, cli.marketQuery, cli.nonInteractive);
    console.log(`\nSelected market: ${formatMarketLabel(market)}`);

    const ob = new Contract(market.market_address, ORDERBOOK_VIEW_ABI, provider);
    const marketStatic = await ob.marketStatic();
    const vaultAddress = String(marketStatic?.vault || '');
    const marketId = String(marketStatic?.marketId || market.market_id_bytes32 || '');
    if (!ethers.isAddress(vaultAddress)) throw new Error(`Invalid vault from marketStatic(): ${vaultAddress}`);
    if (!isHex64(marketId)) throw new Error(`Invalid marketId (bytes32): ${marketId}`);
    const vault = new Contract(vaultAddress, CORE_VAULT_ABI, provider);

    const initialState = await readMarketState(ob, 8);
    printMarketState(initialState, 'Initial market state');

    if (initialState.markPrice <= 0n) {
      throw new Error('Mark price is zero/unavailable. Cannot run scenario safely.');
    }

    const matchUnits = cli.nonInteractive ? 10 : await askNumber(rl, 'Units to match between SHORT/LONG traders', 10, 0.000001);
    const makerUnits = cli.nonInteractive ? 10 : await askNumber(rl, 'Liquidity units to place above liquidation threshold', 10, 0.000001);
    const takerChunkUnits = cli.nonInteractive ? 2 : await askNumber(rl, 'Per-take market-buy units', 2, 0.000001);
    const maxConsumeRounds = cli.nonInteractive ? 12 : await askNumber(rl, 'Max consume rounds', 12, 1);
    const thresholdBufferPct = cli.nonInteractive ? 0.5 : await askNumber(rl, 'Place liquidity this % above liquidation price', 0.5, 0);
    if (cli.nonInteractive) {
      console.log(
        `Using non-interactive defaults: matchUnits=${matchUnits}, makerUnits=${makerUnits}, takerChunkUnits=${takerChunkUnits}, maxConsumeRounds=${maxConsumeRounds}, thresholdBufferPct=${thresholdBufferPct}`
      );
    }

    const go = cli.nonInteractive ? (cli.yes ? 'y' : 'n') : (await rl.question('\nProceed with scenario? (y/N): ')).trim().toLowerCase();
    if (go !== 'y') {
      console.log('Aborted.');
      return;
    }

    const markForEntry = initialState.markPrice;
    const matchAmount18 = toAmount18(matchUnits);
    const existing = loadScenarioState();
    const canResume =
      existing &&
      !existing.completed &&
      sameRunContext(existing, {
        chainId,
        orderBook: market.market_address,
        marketId,
        shortTrader: picked.shortTrader.address,
        longTrader: picked.longTrader.address,
        liquidityMaker: picked.liquidityMaker.address,
        liquidityTaker: picked.liquidityTaker.address,
        matchUnits,
        makerUnits,
        takerChunkUnits,
        maxConsumeRounds,
        thresholdBufferPct,
      });
    let state: ScenarioStateV1;
    if (canResume) {
      const shouldResume =
        cli.resumeMode === 'always'
          ? true
          : cli.resumeMode === 'never'
            ? false
            : (() => {
                return null;
              })();
      if (shouldResume == null && cli.nonInteractive) {
        state = existing!;
        console.log(
          `Resuming from ${SCENARIO_STATE_PATH} (roundsCompleted=${state.consume.roundsCompleted}, step1Done=${state.step1.done}, step2Done=${state.step2.done}).`
        );
      } else if (shouldResume == null) {
        const resume = (await rl.question('Found an unfinished saved scenario. Resume it? (Y/n): ')).trim().toLowerCase();
        if (resume === '' || resume === 'y') {
          state = existing!;
          console.log(
            `Resuming from ${SCENARIO_STATE_PATH} (roundsCompleted=${state.consume.roundsCompleted}, step1Done=${state.step1.done}, step2Done=${state.step2.done}).`
          );
        } else {
          state = {
            version: 1,
            updatedAt: new Date().toISOString(),
            chainId,
            orderBook: market.market_address,
            marketId,
            marketLabel: formatMarketLabel(market),
            wallets: {
              shortTrader: picked.shortTrader.address,
              longTrader: picked.longTrader.address,
              liquidityMaker: picked.liquidityMaker.address,
              liquidityTaker: picked.liquidityTaker.address,
            },
            inputs: { matchUnits, makerUnits, takerChunkUnits, maxConsumeRounds, thresholdBufferPct },
            step1: { done: false },
            step2: { done: false },
            consume: { roundsCompleted: 0, txHashes: [] },
            completed: false,
          };
        }
      } else if (shouldResume) {
        state = existing!;
        console.log(
          `Resuming from ${SCENARIO_STATE_PATH} (roundsCompleted=${state.consume.roundsCompleted}, step1Done=${state.step1.done}, step2Done=${state.step2.done}).`
        );
      } else {
        console.log('Ignoring saved scenario because --fresh/--no-resume was provided.');
        state = {
          version: 1,
          updatedAt: new Date().toISOString(),
          chainId,
          orderBook: market.market_address,
          marketId,
          marketLabel: formatMarketLabel(market),
          wallets: {
            shortTrader: picked.shortTrader.address,
            longTrader: picked.longTrader.address,
            liquidityMaker: picked.liquidityMaker.address,
            liquidityTaker: picked.liquidityTaker.address,
          },
          inputs: { matchUnits, makerUnits, takerChunkUnits, maxConsumeRounds, thresholdBufferPct },
          step1: { done: false },
          step2: { done: false },
          consume: { roundsCompleted: 0, txHashes: [] },
          completed: false,
        };
      }
    } else {
      state = {
        version: 1,
        updatedAt: new Date().toISOString(),
        chainId,
        orderBook: market.market_address,
        marketId,
        marketLabel: formatMarketLabel(market),
        wallets: {
          shortTrader: picked.shortTrader.address,
          longTrader: picked.longTrader.address,
          liquidityMaker: picked.liquidityMaker.address,
          liquidityTaker: picked.liquidityTaker.address,
        },
        inputs: { matchUnits, makerUnits, takerChunkUnits, maxConsumeRounds, thresholdBufferPct },
        step1: { done: false },
        step2: { done: false },
        consume: { roundsCompleted: 0, txHashes: [] },
        completed: false,
      };
    }
    state.updatedAt = new Date().toISOString();
    saveScenarioState(state);
    console.log(`Checkpoint file: ${SCENARIO_STATE_PATH}`);

    const roleWallets = [picked.shortTrader, picked.longTrader, picked.liquidityMaker, picked.liquidityTaker];
    const sessions = await createSessionsForWallets({
      appUrl: env.appUrl,
      chainId,
      sessionRegistryAddress: env.sessionRegistryAddress,
      orderBook: market.market_address,
      marketId,
      wallets: roleWallets,
    });

    console.log('\nStep 1/3: Matching 10-unit style trade at current mark');
    if (!state.step1.shortTxHash) {
      const shortTx = await relayTrade({
        appUrl: env.appUrl,
        orderBook: market.market_address,
        method: 'sessionPlaceMarginLimit',
        sessionId: sessions[picked.shortTrader.address.toLowerCase()],
        trader: picked.shortTrader.address,
        amount18: matchAmount18,
        isBuy: false,
        price6: markForEntry,
        tag: `SHORT open ${matchUnits} @ ${fmt6(markForEntry)}`,
      });
      state.step1.shortTxHash = shortTx.txHash;
      state.updatedAt = new Date().toISOString();
      saveScenarioState(state);
    }
    if (!state.step1.longTxHash) {
      const longTx = await relayTrade({
        appUrl: env.appUrl,
        orderBook: market.market_address,
        method: 'sessionPlaceMarginLimit',
        sessionId: sessions[picked.longTrader.address.toLowerCase()],
        trader: picked.longTrader.address,
        amount18: matchAmount18,
        isBuy: true,
        price6: markForEntry,
        tag: `LONG open ${matchUnits} @ ${fmt6(markForEntry)}`,
      });
      state.step1.longTxHash = longTx.txHash;
      state.updatedAt = new Date().toISOString();
      saveScenarioState(state);
    }

    await waitForTxSettled(provider, state.step1.shortTxHash, 'step1 short');
    await waitForTxSettled(provider, state.step1.longTxHash, 'step1 long');

    const ready = await waitForPositionAndLiq({
      vault,
      trader: picked.shortTrader.address,
      marketId,
      pollMs: 1500,
      timeoutMs: 120_000,
    });
    const shortSize = ready.size;
    const shortEntry = ready.entry;
    const shortMargin = ready.margin;
    const liqPrice = ready.liqPrice;
    state.step1.done = true;
    state.liquidationPrice6 = liqPrice.toString();
    state.updatedAt = new Date().toISOString();
    saveScenarioState(state);

    console.log('\nShort trader position:');
    console.log(`  size=${fmt18(shortSize)} entry=${fmt6(shortEntry)} marginLocked=${fmt6(shortMargin)}`);
    console.log(`  liquidationPrice=${fmt6(liqPrice)}`);

    const liqBufferBps = BigInt(Math.round(thresholdBufferPct * 100));
    const askPriceAboveLiq = (liqPrice * (10_000n + liqBufferBps)) / 10_000n;
    const makerAmount18 = toAmount18(makerUnits);

    console.log('\nStep 2/3: Place sell liquidity above liquidation threshold');
    if (!state.step2.makerTxHash) {
      const makerTx = await relayTrade({
        appUrl: env.appUrl,
        orderBook: market.market_address,
        method: 'sessionPlaceLimit',
        sessionId: sessions[picked.liquidityMaker.address.toLowerCase()],
        trader: picked.liquidityMaker.address,
        amount18: makerAmount18,
        isBuy: false,
        price6: askPriceAboveLiq,
        tag: `Maker ASK ${makerUnits} @ ${fmt6(askPriceAboveLiq)} (liq=${fmt6(liqPrice)})`,
      });
      state.step2.makerTxHash = makerTx.txHash;
      state.askPriceAboveLiq6 = askPriceAboveLiq.toString();
      state.updatedAt = new Date().toISOString();
      saveScenarioState(state);
    }
    await waitForTxSettled(provider, state.step2.makerTxHash, 'step2 maker');
    state.step2.done = true;
    state.askPriceAboveLiq6 = askPriceAboveLiq.toString();
    state.updatedAt = new Date().toISOString();
    saveScenarioState(state);

    await sleep(1200);
    let marketState = await readMarketState(ob, 8);
    printMarketState(marketState, 'Post-maker state');

    console.log('\nStep 3/3: Consume liquidity until mark > liquidation threshold');
    const takeAmount18 = toAmount18(takerChunkUnits);
    let crossed = marketState.markPrice > liqPrice;
    let round = state.consume.roundsCompleted;
    while (!crossed && round < maxConsumeRounds) {
      const targetRound = round + 1;
      if (!state.consume.pendingTxHash || state.consume.pendingRound !== targetRound) {
        const consumeTx = await relayTrade({
          appUrl: env.appUrl,
          orderBook: market.market_address,
          method: 'sessionPlaceMarginMarket',
          sessionId: sessions[picked.liquidityTaker.address.toLowerCase()],
          trader: picked.liquidityTaker.address,
          amount18: takeAmount18,
          isBuy: true,
          tag: `Taker BUY round ${targetRound} size=${takerChunkUnits}`,
        });
        state.consume.pendingRound = targetRound;
        state.consume.pendingTxHash = consumeTx.txHash;
        state.updatedAt = new Date().toISOString();
        saveScenarioState(state);
      }
      await waitForTxSettled(provider, state.consume.pendingTxHash, `consume round ${targetRound}`);
      round = targetRound;
      state.consume.roundsCompleted = round;
      state.consume.txHashes[round - 1] = state.consume.pendingTxHash!;
      state.consume.pendingRound = undefined;
      state.consume.pendingTxHash = undefined;
      state.updatedAt = new Date().toISOString();
      saveScenarioState(state);
      await sleep(1200);
      marketState = await readMarketState(ob, 8);
      crossed = marketState.markPrice > liqPrice;
      console.log(
        `[consume] round=${round} mark=${fmt6(marketState.markPrice)} liq=${fmt6(liqPrice)} crossed=${crossed ? 'YES' : 'NO'}`
      );
    }

    const underLiq = await vault.isUnderLiquidationPosition(picked.shortTrader.address, marketId).catch(() => false);
    const [endSize, endEntry, endMargin] = await vault.getPositionSummary(picked.shortTrader.address, marketId);

    printMarketState(marketState, 'Final market state');
    console.log('\nFinal short trader status:');
    console.log(`  size=${fmt18(endSize)} entry=${fmt6(endEntry)} marginLocked=${fmt6(endMargin)}`);
    console.log(`  liqPrice=${fmt6(liqPrice)} mark=${fmt6(marketState.markPrice)} underLiquidation=${underLiq}`);
    console.log(
      `\nScenario result: ${marketState.markPrice > liqPrice ? 'SUCCESS (mark moved above liq threshold)' : 'NOT CROSSED (increase rounds/liquidity or reduce buffer)'}`
    );
    state.completed = true;
    state.updatedAt = new Date().toISOString();
    saveScenarioState(state);
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error('Fatal:', e?.stack || e?.message || String(e));
  process.exit(1);
});
