#!/usr/bin/env tsx
/**
 * fund-wallets.ts
 *
 * Interactive funding tool:
 * - Reads wallets from AdvancedMarketAutomation/wallets.csv (nickname,address,privateKey)
 * - Asks how many wallets to fund (first N by default)
 * - Supports funding with either:
 *    - native ETH (gas) OR
 *    - "Spook" collateral token on Arbitrum (SPOKE_ARBITRUM_USDC_ADDRESS)
 * - Interactive per-wallet loop lets you toggle ETH <-> token at any time
 *
 * Usage:
 *   tsx AdvancedMarketAutomation/fund-wallets.ts
 *
 * Options:
 *   --csv <path>           CSV path (default AdvancedMarketAutomation/wallets.csv)
 *   --start <n>            Start index (0-based, default 0)
 *   --count <n>            Count to fund (if provided, skips prompt)
 *   --mode <eth|spook>     Starting mode (default: prompt)
 *   --amount <eth>         ETH amount per wallet (if provided, skips prompt for ETH amount)
 *   --token-amount <amt>   Token amount per wallet (human units, e.g. 1000)
 *   --dry-run              Print planned transfers but do not send
 *   --yes                  Skip confirmation prompt
 *
 * Env (.env.local preferred):
 *   ARBITRUM_RPC_URL        Arbitrum RPC URL (preferred)
 *   RPC_URL_ARBITRUM        Fallback Arbitrum RPC URL
 *   RPC_URL                Last-resort fallback (must still be Arbitrum)
 *   RELAYER_PRIVATE_KEY     Private key used as the funder (relayer)
 *   SPOKE_ARBITRUM_USDC_ADDRESS  Spook token address (or TOKEN_ADDRESS override)
 *   TOKEN_ADDRESS           Optional override for token address
 *
 * Notes:
 * - This script funds wallets on Arbitrum One (42161).
 * - It never prints private keys.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ethers } from 'ethers';

import { loadWalletsFromCsvFile } from './lib/wallets';

function loadDotEnvPreferred() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dotenv = require('dotenv');
    const candidates = [
      path.resolve(process.cwd(), '.env.local'),
      path.resolve(process.cwd(), '.env'),
      path.resolve(process.cwd(), '..', '.env.local'),
      path.resolve(process.cwd(), '..', '.env'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        dotenv.config({ path: p, override: true });
        break;
      }
    }
  } catch {
    // ignore
  }
}

function requireEnv(name: string): string {
  const v = String(process.env[name] || '').trim();
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function parseArgs(argv: string[]) {
  const args: {
    csv: string;
    start: number;
    count?: number;
    mode?: 'eth' | 'spook' | 'deposit';
    amountEth?: string;
    tokenAmount?: string;
    dryRun: boolean;
    yes: boolean;
  } = {
    csv: 'AdvancedMarketAutomation/wallets.csv',
    start: 0,
    dryRun: false,
    yes: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--csv' && argv[i + 1]) args.csv = argv[++i];
    else if (a === '--start' && argv[i + 1]) args.start = Number(argv[++i]);
    else if (a === '--count' && argv[i + 1]) args.count = Number(argv[++i]);
    else if (a === '--mode' && argv[i + 1]) {
      const m = String(argv[++i]).trim().toLowerCase();
      if (m === 'eth' || m === 'spook' || m === 'deposit') args.mode = m as any;
      else throw new Error(`--mode must be "eth", "spook", or "deposit". Got: ${m}`);
    }
    else if (a === '--amount' && argv[i + 1]) args.amountEth = String(argv[++i]);
    else if (a === '--token-amount' && argv[i + 1]) args.tokenAmount = String(argv[++i]);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--help' || a === '-h') {
      console.log(
        [
          'Fund wallets (ETH or Spook token) from wallets.csv',
          '',
          'Usage:',
          '  tsx AdvancedMarketAutomation/fund-wallets.ts',
          '',
          'Options:',
          '  --csv <path>       CSV path (default AdvancedMarketAutomation/wallets.csv)',
          '  --start <n>        Start index (0-based, default 0)',
          '  --count <n>        Count to fund (skip prompt)',
          '  --mode <eth|spook|deposit> Starting mode',
          '  --amount <eth>     ETH amount per wallet (skip prompt)',
          '  --token-amount <n> Token amount per wallet (human units)',
          '  --dry-run          Do not send; just print planned transfers',
          '  --yes              Skip confirmation prompt',
          '',
          'Env:',
          '  ARBITRUM_RPC_URL (or RPC_URL_ARBITRUM/RPC_URL)',
          '  RELAYER_PRIVATE_KEY',
          '  SPOKE_ARBITRUM_USDC_ADDRESS (or TOKEN_ADDRESS)',
        ].join('\n')
      );
      process.exit(0);
    }
  }

  if (!Number.isInteger(args.start) || args.start < 0) throw new Error('--start must be >= 0');
  if (args.count !== undefined && (!Number.isInteger(args.count) || args.count <= 0)) {
    throw new Error('--count must be > 0');
  }
  if (args.amountEth !== undefined) {
    const n = Number(args.amountEth);
    if (!Number.isFinite(n) || n <= 0) throw new Error('--amount must be a positive number (ETH)');
  }
  if (args.tokenAmount !== undefined) {
    const n = Number(args.tokenAmount);
    if (!Number.isFinite(n) || n <= 0) throw new Error('--token-amount must be a positive number');
  }
  return args;
}

function shortAddr(a: string) {
  const s = String(a);
  return s.length === 42 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

type FundMode = 'eth' | 'spook';
type DepositMode = 'deposit';
type Mode = FundMode | DepositMode;

const SPOOK_TOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  // mint helpers (mock)
  'function faucet(uint256) external',
  'function owner() view returns (address)',
  'function mint(address,uint256) external',
] as const;

async function main() {
  loadDotEnvPreferred();
  const args = parseArgs(process.argv.slice(2));

  const rpcUrl = (
    process.env.ARBITRUM_RPC_URL ||
    process.env.RPC_URL_ARBITRUM ||
    process.env.RPC_URL ||
    ''
  ).trim();
  if (!rpcUrl) throw new Error('Missing ARBITRUM_RPC_URL (or RPC_URL_ARBITRUM/RPC_URL)');

  // Use relayer key as the funder (per user requirement). Never print this key.
  const funderPk = requireEnv('RELAYER_PRIVATE_KEY');
  if (!/^0x[a-fA-F0-9]{64}$/.test(funderPk)) {
    throw new Error('RELAYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key');
  }
  // Optional: use a distinct hub relayer key to avoid nonce collisions with other processes
  // (e.g. webhook relayer). Defaults to RELAYER_PRIVATE_KEY.
  const hubRelayerPkRaw = String(
    process.env.HUB_RELAYER_PRIVATE_KEY ||
      process.env.RELAYER_PRIVATE_KEY_HUB ||
      process.env.HUB_PRIVATE_KEY ||
      ''
  ).trim();
  const hubRelayerPk = hubRelayerPkRaw ? (hubRelayerPkRaw.startsWith('0x') ? hubRelayerPkRaw : `0x${hubRelayerPkRaw}`) : funderPk;
  if (hubRelayerPk && !/^0x[a-fA-F0-9]{64}$/.test(hubRelayerPk)) {
    throw new Error('HUB_RELAYER_PRIVATE_KEY (or RELAYER_PRIVATE_KEY_HUB) must be a 0x-prefixed 32-byte hex key');
  }

  const csvPath = path.resolve(process.cwd(), args.csv);
  if (!fs.existsSync(csvPath)) throw new Error(`CSV not found: ${csvPath}`);
  const wallets = loadWalletsFromCsvFile(csvPath);

  const rl = readline.createInterface({ input, output });
  const start = args.start;

  const maxCount = Math.max(0, wallets.length - start);
  if (maxCount <= 0) throw new Error(`No wallets available starting at index ${start}. Total wallets: ${wallets.length}`);

  const count =
    args.count ??
    Number((await rl.question(`How many wallets to fund? (1-${maxCount}) [${Math.min(10, maxCount)}]: `)).trim() || Math.min(10, maxCount));

  if (!Number.isInteger(count) || count <= 0 || count > maxCount) {
    throw new Error(`Invalid count: ${count}. Must be in 1..${maxCount}`);
  }

  // Choose initial mode AFTER count, and only prompt for the amount of the chosen mode.
  // "deposit" mode deposits the wallet's entire Spook balance into the hub via the gasless deposit pipeline.
  let mode: Mode = (args.mode ?? 'eth') as Mode;
  if (!args.mode) {
    const m = ((await rl.question(`Mode? [eth/spook/deposit] [eth]: `)).trim().toLowerCase() ||
      'eth') as Mode;
    mode = m === 'spook' || m === 'deposit' ? m : 'eth';
  }

  const selected = wallets.slice(start, start + count);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const net = await provider.getNetwork();
  const chainId = Number(net.chainId);
  // Safety: ensure we're actually connected to Arbitrum One (42161).
  // If you intend Arbitrum Sepolia, update this check accordingly.
  if (chainId !== 42161) {
    throw new Error(`Refusing to fund: connected chainId=${chainId}, expected Arbitrum One (42161). Check ARBITRUM_RPC_URL.`);
  }

  const funder = new ethers.Wallet(funderPk, provider);
  const funderEthBal = await provider.getBalance(funder.address);

  const tokenAddrRaw = (process.env.TOKEN_ADDRESS || process.env.SPOKE_ARBITRUM_USDC_ADDRESS || '').trim();
  const tokenAddr = tokenAddrRaw && ethers.isAddress(tokenAddrRaw) ? ethers.getAddress(tokenAddrRaw) : '';
  const token = tokenAddr ? new ethers.Contract(tokenAddr, SPOOK_TOKEN_ABI, funder) : null;

  // Amounts are mode-specific; only prompt for the active mode (and remember if toggled later).
  let amountWei: bigint | null = null;
  let tokenAmountUnits: bigint | null = null;
  let tokenDecimals: number = 6;
  let tokenSymbol: string = 'USDC';
  const spokeVaultAddrRaw = (process.env.SPOKE_ARBITRUM_VAULT_ADDRESS || process.env.SPOKE_VAULT_ADDRESS || '').trim();
  const spokeVaultAddr =
    spokeVaultAddrRaw && ethers.isAddress(spokeVaultAddrRaw) ? ethers.getAddress(spokeVaultAddrRaw) : '';
  const spokeOutboxAddrRaw = (
    process.env.SPOKE_OUTBOX_ADDRESS_ARBITRUM ||
    process.env.SPOKE_OUTBOX_ADDRESS ||
    ''
  ).trim();
  const spokeOutboxAddr =
    spokeOutboxAddrRaw && ethers.isAddress(spokeOutboxAddrRaw) ? ethers.getAddress(spokeOutboxAddrRaw) : '';
  const dstDomainHub = Number((process.env.BRIDGE_DOMAIN_HUB || '0').trim());

  const hubInboxAddrRaw = (process.env.HUB_INBOX_ADDRESS || '').trim();
  const hubInboxAddr =
    hubInboxAddrRaw && ethers.isAddress(hubInboxAddrRaw) ? ethers.getAddress(hubInboxAddrRaw) : '';
  const hubRpcUrl =
    (process.env.HUB_RPC_URL ||
      process.env.ALCHEMY_HYPERLIQUID_HTTP ||
      process.env.RPC_URL_HUB ||
      process.env.RPC_URL_HYPEREVM ||
      process.env.RPC_URL ||
      '').trim();
  const remoteAppArb =
    (process.env.BRIDGE_REMOTE_APP_ARBITRUM || '').trim() ||
    (spokeOutboxAddr ? ('0x' + '0'.repeat(24) + spokeOutboxAddr.toLowerCase().replace(/^0x/, '')) : '');
  const canAutoDeliverToHub = !!(hubInboxAddr && hubRpcUrl && /^0x[0-9a-fA-F]{64}$/.test(remoteAppArb));

  async function getEthAmountWei(): Promise<bigint> {
    if (amountWei !== null) return amountWei;
    const ethStr =
      args.amountEth ??
      ((await rl.question(`ETH per wallet (example: 0.01) [0.01]: `)).trim() || '0.01');
    const wei = ethers.parseEther(ethStr);
    if (wei <= 0n) throw new Error('ETH amount must be > 0');
    amountWei = wei;
    return wei;
  }

  async function ensureTokenReady(): Promise<void> {
    if (!token) {
      throw new Error('Token mode selected but SPOKE_ARBITRUM_USDC_ADDRESS/TOKEN_ADDRESS is missing.');
    }
    // Load metadata once
    if (tokenAmountUnits === null) {
      tokenDecimals = Number(await token.decimals().catch(() => 6));
      tokenSymbol = String(await token.symbol().catch(() => 'USDC'));
    }
  }

  async function getTokenAmountUnits(): Promise<bigint> {
    if (tokenAmountUnits !== null) return tokenAmountUnits;
    await ensureTokenReady();
    const tStr =
      args.tokenAmount ??
      ((await rl.question(`Spook token per wallet (example: 1000) [1000]: `)).trim() || '1000');
    const n = Number(tStr);
    if (!Number.isFinite(n) || n <= 0) throw new Error('Token amount must be a positive number');
    const units = ethers.parseUnits(String(tStr), tokenDecimals);
    if (units <= 0n) throw new Error('Token amount must be > 0');
    tokenAmountUnits = units;
    return units;
  }

  // Token mint helper: used only if balance is insufficient and contract supports faucet/mint
  let allowAutoMint = false;
  async function ensureTokenBalance(required: bigint) {
    if (!token) throw new Error('Missing token contract. Set SPOKE_ARBITRUM_USDC_ADDRESS (or TOKEN_ADDRESS).');
    let bal = (await token.balanceOf(funder.address)) as bigint;
    if (bal >= required) return;
    const shortfall = required - bal;

    // Prefer faucet (mint to caller) if present; else owner-only mint
    const canFaucet = await token.faucet.staticCall(1n).then(() => true).catch(() => false);
    let canOwnerMint = false;
    if (!canFaucet) {
      const owner = await token.owner().then((x: string) => x).catch(() => '');
      const isOwner = owner && ethers.isAddress(owner) && ethers.getAddress(owner) === ethers.getAddress(funder.address);
      if (isOwner) {
        canOwnerMint = await token.mint.staticCall(funder.address, 1n).then(() => true).catch(() => false);
      }
    }
    if (!canFaucet && !canOwnerMint) {
      throw new Error(
        `Insufficient ${tokenSymbol} balance for funder and token cannot be minted by this signer. Need +${ethers.formatUnits(
          shortfall,
          tokenDecimals
        )} ${tokenSymbol}.`
      );
    }

    if (!allowAutoMint && !args.yes) {
      const ans = (await rl.question(
        `Funder is short ${ethers.formatUnits(shortfall, tokenDecimals)} ${tokenSymbol}. Mint to funder now? (y/N) `
      ))
        .trim()
        .toLowerCase();
      if (ans !== 'y' && ans !== 'yes') {
        throw new Error('Aborted (token shortfall not minted).');
      }
      allowAutoMint = true;
    } else {
      allowAutoMint = true;
    }

    const tx = canFaucet ? await token.faucet(shortfall) : await token.mint(funder.address, shortfall);
    await tx.wait(1);
    bal = (await token.balanceOf(funder.address)) as bigint;
    if (bal < required) {
      throw new Error('Mint attempted but funder token balance is still insufficient.');
    }
  }

  // In spook mode, prefer minting once for the remaining wallets so we don't mint per-wallet.
  async function ensureTokenBudgetForRemaining(fromIndex: number): Promise<void> {
    if (!token) throw new Error('Missing token contract. Set SPOKE_ARBITRUM_USDC_ADDRESS (or TOKEN_ADDRESS).');
    const unitsEach = await getTokenAmountUnits();
    const remaining = Math.max(0, selected.length - fromIndex);
    const requiredTotal = unitsEach * BigInt(remaining);
    await ensureTokenBalance(requiredTotal);
  }

  const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)',
  ] as const;
  const OUTBOX_ABI = [
    'function sendDeposit(uint64 dstDomain, address user, address token, uint256 amount, bytes32 depositId) external',
  ] as const;
  const HUB_INBOX_ABI = [
    'function receiveMessage(uint64 srcDomain, bytes32 srcApp, bytes payload) external',
  ] as const;

  function toBytes32Address(addr: string): string {
    const hex = addr.toLowerCase().replace(/^0x/, '');
    return '0x' + '0'.repeat(24) + hex;
  }

  function encodeDepositId(chainId: number, txHash: string, logIndex: number): string {
    const abi = ethers.AbiCoder.defaultAbiCoder();
    return ethers.keccak256(abi.encode(['uint64', 'bytes32', 'uint32'], [chainId, txHash, logIndex]));
  }

  async function depositAllSpookForWallet(params: { walletPk: string; walletAddr: string; nickname: string }) {
    if (!tokenAddr) throw new Error('Missing SPOKE_ARBITRUM_USDC_ADDRESS/TOKEN_ADDRESS for deposit mode.');
    if (!spokeVaultAddr) throw new Error('Missing SPOKE_ARBITRUM_VAULT_ADDRESS for deposit mode.');
    if (!spokeOutboxAddr) throw new Error('Missing SPOKE_OUTBOX_ADDRESS_ARBITRUM (or SPOKE_OUTBOX_ADDRESS) for deposit mode.');
    if (!Number.isFinite(dstDomainHub) || dstDomainHub <= 0) throw new Error('Missing/invalid BRIDGE_DOMAIN_HUB.');

    const userSigner = new ethers.Wallet(params.walletPk, provider);
    const userAddr = ethers.getAddress(params.walletAddr);
    if (ethers.getAddress(userSigner.address) !== userAddr) {
      throw new Error(`Wallet CSV mismatch for ${params.nickname}: private key address != csv address`);
    }

    const erc20 = new ethers.Contract(tokenAddr, ERC20_ABI, userSigner);
    let bal: bigint = 0n;
    try {
      bal = (await erc20.balanceOf(userAddr)) as bigint;
    } catch (e: any) {
      // Non-fatal: if we cannot read balance, treat as skipped and continue.
      const msg = String(e?.reason || e?.shortMessage || e?.message || e);
      return { status: 'skipped_read_error' as const, message: msg };
    }
    if (bal <= 0n) return { status: 'skipped_zero' as const };

    // 1) User transfers entire balance to SpokeVault (transfer-only deposit UX)
    const tx1 = await erc20.transfer(spokeVaultAddr, bal);
    const rc1 = await tx1.wait(1);

    // Find the Transfer log index for (from=user,to=spokeVault) emitted by token
    const transferTopic = ethers.id('Transfer(address,address,uint256)').toLowerCase();
    const fromTopic = toBytes32Address(userAddr).toLowerCase();
    const toTopic = toBytes32Address(spokeVaultAddr).toLowerCase();
    const logs: any[] = Array.isArray((rc1 as any)?.logs) ? (rc1 as any).logs : [];
    const lg = logs.find(
      (l: any) =>
        String(l?.address || '').toLowerCase() === tokenAddr.toLowerCase() &&
        Array.isArray(l?.topics) &&
        l.topics.length >= 3 &&
        String(l.topics[0]).toLowerCase() === transferTopic &&
        String(l.topics[1]).toLowerCase() === fromTopic &&
        String(l.topics[2]).toLowerCase() === toTopic
    );
    const logIndex = Number(lg?.index ?? lg?.logIndex ?? 0);
    const depositId = encodeDepositId(chainId, tx1.hash, logIndex);

    // 2) Relayer publishes deposit message on Spoke outbox (requires DEPOSIT_SENDER_ROLE)
    const outbox = new ethers.Contract(spokeOutboxAddr, OUTBOX_ABI, funder);
    async function sendWithNonceRetry<T>(
      label: string,
      provider: ethers.Provider,
      signerAddress: string,
      send: (overrides: { nonce: number }) => Promise<T>,
      attempts = 5
    ): Promise<T> {
      let lastErr: any = null;
      for (let i = 0; i < attempts; i++) {
        const nonce = await (provider as any).getTransactionCount(signerAddress, 'pending');
        try {
          return await send({ nonce });
        } catch (e: any) {
          lastErr = e;
          const msg = String(e?.reason || e?.shortMessage || e?.message || e);
          const m = msg.toLowerCase();
          const isNonce =
            m.includes('nonce has already been used') ||
            m.includes('nonce too low') ||
            m.includes('already known') ||
            m.includes('known transaction') ||
            m.includes('replacement transaction underpriced');
          if (!isNonce) throw e;
          console.warn(`[nonce-retry] ${label} attempt ${i + 1}/${attempts} failed (${msg}); retrying with refreshed pending nonce…`);
          // small delay to let mempool/provider catch up
          await new Promise((r) => setTimeout(r, 750));
        }
      }
      throw lastErr;
    }

    const tx2: any = await sendWithNonceRetry(
      'outbox.sendDeposit',
      provider,
      funder.address,
      ({ nonce }) => (outbox as any).sendDeposit(BigInt(dstDomainHub), userAddr, tokenAddr, bal, depositId, { nonce })
    );
    await tx2.wait(1);

    // 3) (Optional) auto-deliver to hub inbox to credit CoreVault immediately
    let hubTxHash: string | null = null;
    if (canAutoDeliverToHub) {
      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint8', 'address', 'address', 'uint256', 'bytes32'],
        [1, userAddr, tokenAddr, bal, depositId]
      );
      try {
        const hubProvider = new ethers.JsonRpcProvider(hubRpcUrl);
        const hubSigner = new ethers.Wallet(hubRelayerPk, hubProvider);
        const hub = new ethers.Contract(hubInboxAddr, HUB_INBOX_ABI, hubSigner);

        // Preflight simulate; treat "deposit processed" as idempotent success
        try {
          await (hub as any).receiveMessage.staticCall(42161, remoteAppArb, payload);
        } catch (simErr: any) {
          const simMsg = String(simErr?.reason || simErr?.shortMessage || simErr?.message || simErr);
          if (simMsg.toLowerCase().includes('deposit processed')) {
            return {
              status: 'ok' as const,
              amount: bal,
              depositId,
              userTransferTx: tx1.hash,
              outboxTx: (tx2 as any).hash,
              hubTx: null,
            };
          }
          // For other errors, fall through to send attempt (but keep it best-effort)
        }

        const tx3: any = await sendWithNonceRetry(
          'hub.receiveMessage',
          hubProvider,
          hubSigner.address,
          ({ nonce }) => (hub as any).receiveMessage(42161, remoteAppArb, payload, { nonce })
        );
        const rc3 = await tx3.wait(1);
        hubTxHash = (tx3 as any).hash || (rc3 as any)?.hash || null;
      } catch (hubErr: any) {
        const hubMsg = String(hubErr?.reason || hubErr?.shortMessage || hubErr?.message || hubErr);
        if (hubMsg.toLowerCase().includes('deposit processed')) {
          hubTxHash = null; // idempotent success
        } else {
          // Best-effort: don't fail the whole run if hub delivery is misconfigured or already handled elsewhere
          console.warn(`[deposit] hub delivery skipped/failed for ${params.nickname}: ${hubMsg}`);
          hubTxHash = null;
        }
      }
    }

    return {
      status: 'ok' as const,
      amount: bal,
      depositId,
      userTransferTx: tx1.hash,
      outboxTx: (tx2 as any).hash,
      hubTx: hubTxHash,
    };
  }

  console.log('\nFunding setup:');
  console.log(`- chainId: ${chainId}`);
  console.log(`- funder: ${funder.address} (ETH bal=${ethers.formatEther(funderEthBal)})`);
  console.log(`- wallets: ${selected.length} (from index ${start})`);
  console.log(`- start mode: ${mode}`);
  console.log(`- ETH each: ${args.amountEth ? `${args.amountEth} ETH` : '<prompt when using ETH>'}`);
  console.log(
    `- Spook each: ${
      args.tokenAmount ? `${args.tokenAmount} ${tokenSymbol}` : '<prompt when using Spook>'
    }${tokenAddr ? ` (token=${tokenAddr})` : ''}`
  );
  console.log(
    `- Deposit mode: ${
      spokeVaultAddr ? `vault=${spokeVaultAddr}` : 'vault=<missing SPOKE_ARBITRUM_VAULT_ADDRESS>'
    }, outbox=${spokeOutboxAddr || '<missing outbox>'}, dstDomainHub=${dstDomainHub || '<missing>'}, autoDeliver=${
      canAutoDeliverToHub ? 'yes' : 'no'
    }`
  );
  console.log(`- mode: ${args.dryRun ? 'DRY_RUN' : 'SEND'}`);
  console.log('');

  if (!args.dryRun && !args.yes) {
    const confirm = (await rl.question('Proceed to interactive funding? (yes/no) [no]: ')).trim().toLowerCase();
    if (confirm !== 'yes') {
      console.log('Aborted.');
      rl.close();
      return;
    }
  }

  if (args.dryRun) {
    console.log('Dry-run complete. No transactions sent.');
    rl.close();
    return;
  }

  console.log('Interactive funding controls:');
  console.log('- [y] send using current mode');
  console.log('- [s] skip this wallet');
  console.log('- [m] toggle mode (eth <-> spook <-> deposit)');
  console.log('- [e] switch mode to eth');
  console.log('- [t] switch mode to spook');
  console.log('- [d] switch mode to deposit (deposit all spook to CoreVault)');
  console.log('- [a] send all remaining with current mode (no more per-wallet prompts)');
  console.log('- [q] quit');
  console.log('');

  let sendAll = args.yes;

  // If starting in spook mode, pre-mint once for all wallets in the selection.
  if (mode === 'spook') {
    await ensureTokenReady();
    await ensureTokenBudgetForRemaining(0);
  }

  for (let i = 0; i < selected.length; i++) {
    const w = selected[i];
    const to = ethers.getAddress(w.address);

    let action = 'y';
    if (!sendAll) {
      let modeHint = mode;
      if (mode === 'eth' && amountWei !== null) modeHint = `eth(${ethers.formatEther(amountWei)})` as any;
      if (mode === 'spook' && tokenAmountUnits !== null) {
        modeHint = `spook(${ethers.formatUnits(tokenAmountUnits, tokenDecimals)} ${tokenSymbol})` as any;
      }
      const prompt = `[${start + i}] ${w.nickname} ${shortAddr(to)} | mode=${modeHint} | send? (y/s/m/e/t/d/a/q) `;
      action = (await rl.question(prompt)).trim().toLowerCase() || 's';
    }

    if (action === 'q') break;
    if (action === 'm') {
      mode = mode === 'eth' ? 'spook' : mode === 'spook' ? 'deposit' : 'eth';
      if (mode === 'spook') {
        await ensureTokenReady();
        await ensureTokenBudgetForRemaining(i);
      }
      i--; // re-prompt same wallet
      continue;
    }
    if (action === 'e') {
      mode = 'eth';
      i--; // re-prompt same wallet
      continue;
    }
    if (action === 't') {
      mode = 'spook';
      await ensureTokenReady();
      await ensureTokenBudgetForRemaining(i);
      i--; // re-prompt same wallet
      continue;
    }
    if (action === 'd') {
      mode = 'deposit';
      i--; // re-prompt same wallet
      continue;
    }
    if (action === 'a') {
      sendAll = true;
      if (mode === 'spook') {
        await ensureTokenReady();
        await ensureTokenBudgetForRemaining(i);
      }
      action = 'y';
    }
    if (action === 's' || action === 'n' || action === '') continue;
    if (action !== 'y') continue;

    if (args.dryRun) {
      const amtLabel =
        mode === 'eth'
          ? `+${ethers.formatEther(await getEthAmountWei())} ETH`
          : mode === 'spook'
          ? `+${ethers.formatUnits(await getTokenAmountUnits(), tokenDecimals)} ${tokenSymbol}`
          : `deposit ALL ${tokenSymbol}`;
      console.log(`  [dry-run] ${w.nickname} ${shortAddr(to)} ${amtLabel} (mode=${mode})`);
      continue;
    }

    try {
      if (mode === 'eth') {
        const bal = await provider.getBalance(funder.address);
        const wei = await getEthAmountWei();
        if (bal < wei) {
          throw new Error(`Insufficient ETH balance for funder. Need ${ethers.formatEther(wei)} ETH.`);
        }
        const tx = await funder.sendTransaction({ to, value: wei });
        console.log(`  sent ETH -> ${w.nickname} ${shortAddr(to)} tx=${tx.hash}`);
        await tx.wait(1);
      } else if (mode === 'spook') {
        await ensureTokenReady();
        const units = await getTokenAmountUnits();
        // Budget is prefunded once for remaining wallets; this should not mint per-wallet.
        const tx = await token!.transfer(to, units);
        console.log(`  sent ${tokenSymbol} -> ${w.nickname} ${shortAddr(to)} tx=${tx.hash}`);
        await tx.wait(1);
      } else {
        // deposit mode: move ALL spook from user's wallet into the spoke vault and publish bridge credit
        const pk = w.privateKey;
        try {
          const res = await depositAllSpookForWallet({
            walletPk: pk,
            walletAddr: w.address,
            nickname: w.nickname,
          });
          if (res.status === 'skipped_zero') {
            console.log(`  deposit -> ${w.nickname} ${shortAddr(to)} skipped (0 ${tokenSymbol})`);
          } else if (res.status === 'skipped_read_error') {
            console.log(
              `  deposit -> ${w.nickname} ${shortAddr(to)} skipped (balance read error: ${res.message})`
            );
          } else {
            console.log(
              `  deposit -> ${w.nickname} ${shortAddr(to)} amount=${ethers.formatUnits(
                res.amount,
                tokenDecimals
              )} ${tokenSymbol} depositId=${res.depositId}`
            );
            console.log(`    userTransferTx=${res.userTransferTx}`);
            console.log(`    outboxTx=${res.outboxTx}`);
            if (res.hubTx) console.log(`    hubTx=${res.hubTx}`);
            else console.log(`    hubTx=<skipped> (autoDeliver=${canAutoDeliverToHub ? 'yes' : 'no'})`);
          }
        } catch (e: any) {
          // Non-fatal for deposit mode: log and continue.
          console.error(
            `  deposit FAILED -> ${w.nickname} ${shortAddr(to)}: ${e?.reason || e?.shortMessage || e?.message || String(e)}`
          );
        }
      }
    } catch (e: any) {
      console.error(`  FAILED -> ${w.nickname} ${shortAddr(to)}: ${e?.message || String(e)}`);
      throw e;
    }
  }

  const funderBalAfter = await provider.getBalance(funder.address);
  console.log(`\nDone. Funder ETH balance now: ${ethers.formatEther(funderBalAfter)} ETH`);
  rl.close();
}

main().catch((e) => {
  console.error(e?.stack || e?.message || String(e));
  process.exit(1);
});


