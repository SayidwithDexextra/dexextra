/**
 * dispute-relayer.ts
 *
 * Backend service that bridges settlement disputes between HyperLiquid and Sepolia/Arbitrum.
 *
 * Flow:
 *   1. Listens for SettlementChallenged events on HyperLiquid Diamond markets
 *   2. Calls DisputeRelay.escalateDisputeDirectToVote() on Sepolia/Arbitrum
 *   3. Listens for DisputeResolved events on Sepolia/Arbitrum
 *   4. Calls resolveChallenge() on HyperLiquid Diamond market
 *
 * Architecture: stateless — can be called from a cron job, API route, or standalone worker.
 * State is tracked via Supabase (dispute_relays table) and on-chain events.
 */

import { ethers } from 'ethers';

// ─── ABIs ───

const LIFECYCLE_CHALLENGE_ABI = [
  'event SettlementChallenged(address indexed market, address indexed challenger, uint256 alternativePrice, uint256 bondAmount)',
  'event ChallengeResolved(address indexed market, address indexed challenger, bool challengerWon, uint256 bondAmount, address recipient)',
  'function resolveChallenge(bool challengerWins) external',
  'function getActiveChallengeInfo() external view returns (bool active, address challengerAddr, uint256 challengedPriceVal, uint256 bondEscrowed, bool resolved, bool won)',
  'function getProposedEvidence() external view returns (bytes32 evidenceHash, string evidenceUrl)',
] as const;

const DISPUTE_RELAY_ABI = [
  'function escalateDisputeDirectToVote(address hlMarket, uint256 proposedPrice, uint256 challengedPrice, string evidenceUrl, uint256 bondAmount, uint64 liveness) external returns (bytes32)',
  'function getDispute(bytes32 assertionId) external view returns (tuple(address hlMarket, uint256 proposedPrice, uint256 challengedPrice, bool resolved, bool challengerWon, uint256 bondAmount, uint256 timestamp))',
  'function getDisputeCount() external view returns (uint256)',
  'function getAssertionIdAt(uint256 index) external view returns (bytes32)',
  'function poolBalance() external view returns (uint256)',
  'event DisputeEscalated(bytes32 indexed assertionId, address indexed hlMarket, uint256 proposedPrice, uint256 challengedPrice, uint256 bondAmount, uint256 timestamp)',
  'event DisputeResolved(bytes32 indexed assertionId, address indexed hlMarket, bool challengerWon, uint256 winningPrice)',
] as const;

// ─── Config ───

export interface DisputeRelayerConfig {
  hlRpcUrl: string;
  hlAdminPrivateKey: string;
  sepoliaRpcUrl: string;
  sepoliaPrivateKey: string;
  disputeRelayAddress: string;
  defaultBondAmount: bigint;
  defaultLiveness: number;
}

export function getRelayerConfig(): DisputeRelayerConfig {
  const hlRpc = process.env.RPC_URL || process.env.JSON_RPC_URL || '';
  const hlKey = process.env.ADMIN_PRIVATE_KEY || process.env.PRIVATE_KEY || '';
  const sepoliaRpc = process.env.SEPOLIA_RPC_URL || '';
  const sepoliaKey = process.env.SEPOLIA_PRIVATE_KEY || process.env.CREATOR_PRIVATE_KEY || '';
  const relayAddr = process.env.DISPUTE_RELAY_ADDRESS || '';
  const bondRaw = process.env.DISPUTE_BOND_AMOUNT || '100000000'; // 100 USDC (6 decimals)
  const liveness = Number(process.env.DISPUTE_LIVENESS_SECONDS || '7200'); // 2 hours

  if (!hlRpc) throw new Error('RPC_URL is required for HyperLiquid');
  if (!hlKey) throw new Error('ADMIN_PRIVATE_KEY is required');
  if (!sepoliaRpc) throw new Error('SEPOLIA_RPC_URL is required for dispute relay');
  if (!relayAddr) throw new Error('DISPUTE_RELAY_ADDRESS is required');

  return {
    hlRpcUrl: hlRpc,
    hlAdminPrivateKey: hlKey,
    sepoliaRpcUrl: sepoliaRpc,
    sepoliaPrivateKey: sepoliaKey,
    disputeRelayAddress: relayAddr,
    defaultBondAmount: BigInt(bondRaw),
    defaultLiveness: liveness,
  };
}

// ─── Core Functions ───

export interface PendingChallenge {
  marketAddress: string;
  challenger: string;
  alternativePrice: bigint;
  bondAmount: bigint;
  evidenceUrl: string;
  proposedPrice: bigint;
}

/**
 * Scan a HyperLiquid market for an active, unrelayed settlement challenge.
 */
export async function getActiveChallenge(
  hlProvider: ethers.Provider,
  marketAddress: string,
): Promise<PendingChallenge | null> {
  const market = new ethers.Contract(marketAddress, LIFECYCLE_CHALLENGE_ABI, hlProvider);

  const [active, challengerAddr, challengedPriceVal, bondEscrowed, resolved] =
    await market.getActiveChallengeInfo();

  if (!active || resolved) return null;

  const [, evidenceUrl] = await market.getProposedEvidence();

  // We need the proposed settlement price — read it from the mark price or from the evidence
  // For now we'll pass 0 and let the caller supply the proposed price
  return {
    marketAddress,
    challenger: challengerAddr,
    alternativePrice: challengedPriceVal,
    bondAmount: bondEscrowed,
    evidenceUrl: evidenceUrl || '',
    proposedPrice: 0n, // caller must supply from Supabase or CoreVault
  };
}

/**
 * Escalate a challenge to UMA via the DisputeRelay on Sepolia.
 * Returns the assertionId.
 */
export async function escalateToUMA(
  config: DisputeRelayerConfig,
  challenge: PendingChallenge & { proposedPrice: bigint },
): Promise<{ assertionId: string; txHash: string }> {
  const sepoliaProvider = new ethers.JsonRpcProvider(config.sepoliaRpcUrl);
  const sepoliaWallet = new ethers.Wallet(config.sepoliaPrivateKey, sepoliaProvider);
  const relay = new ethers.Contract(config.disputeRelayAddress, DISPUTE_RELAY_ABI, sepoliaWallet);

  const poolBal = await relay.poolBalance();
  const needed = config.defaultBondAmount * 2n;
  if (poolBal < needed) {
    throw new Error(
      `DisputeRelay pool has ${ethers.formatUnits(poolBal, 6)} but needs ${ethers.formatUnits(needed, 6)} (2x bond)`
    );
  }

  const tx = await relay.escalateDisputeDirectToVote(
    challenge.marketAddress,
    challenge.proposedPrice,
    challenge.alternativePrice,
    challenge.evidenceUrl,
    config.defaultBondAmount,
    config.defaultLiveness,
  );

  const receipt = await tx.wait();

  // Parse assertionId from DisputeEscalated event
  const iface = new ethers.Interface(DISPUTE_RELAY_ABI);
  let assertionId = '';
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === 'DisputeEscalated') {
        assertionId = parsed.args.assertionId;
        break;
      }
    } catch {}
  }

  if (!assertionId) {
    throw new Error('DisputeEscalated event not found in tx receipt');
  }

  return { assertionId, txHash: receipt.hash };
}

/**
 * Check if a dispute on Sepolia has been resolved by the DVM.
 */
export async function checkDisputeResolution(
  config: DisputeRelayerConfig,
  assertionId: string,
): Promise<{ resolved: boolean; challengerWon: boolean; winningPrice: bigint } | null> {
  const sepoliaProvider = new ethers.JsonRpcProvider(config.sepoliaRpcUrl);
  const relay = new ethers.Contract(config.disputeRelayAddress, DISPUTE_RELAY_ABI, sepoliaProvider);

  const dispute = await relay.getDispute(assertionId);
  if (!dispute.resolved) return null;

  return {
    resolved: true,
    challengerWon: dispute.challengerWon,
    winningPrice: dispute.challengerWon ? dispute.challengedPrice : dispute.proposedPrice,
  };
}

/**
 * Relay a resolved UMA dispute back to HyperLiquid by calling resolveChallenge().
 */
export async function relayResolutionToHL(
  config: DisputeRelayerConfig,
  marketAddress: string,
  challengerWon: boolean,
): Promise<string> {
  const hlProvider = new ethers.JsonRpcProvider(config.hlRpcUrl);
  const hlWallet = new ethers.Wallet(config.hlAdminPrivateKey, hlProvider);
  const market = new ethers.Contract(marketAddress, LIFECYCLE_CHALLENGE_ABI, hlWallet);

  const tx = await market.resolveChallenge(challengerWon);
  const receipt = await tx.wait();
  return receipt.hash;
}

// ─── Full Relay Tick ───

export interface RelayTickResult {
  action: 'none' | 'escalated' | 'resolved' | 'error';
  marketAddress?: string;
  assertionId?: string;
  challengerWon?: boolean;
  txHash?: string;
  error?: string;
}

/**
 * Full relay tick for a single market:
 *   1. Check if there's an active challenge on HL that hasn't been escalated
 *   2. If yes, escalate to UMA
 *   3. Check if any pending UMA disputes have resolved
 *   4. If yes, relay result back to HL
 */
export async function relayTick(
  config: DisputeRelayerConfig,
  marketAddress: string,
  proposedPrice: bigint,
  pendingAssertionId?: string,
): Promise<RelayTickResult> {
  try {
    // Phase 1: Check for resolved disputes that need relaying back
    if (pendingAssertionId) {
      const resolution = await checkDisputeResolution(config, pendingAssertionId);
      if (resolution?.resolved) {
        const txHash = await relayResolutionToHL(config, marketAddress, resolution.challengerWon);
        return {
          action: 'resolved',
          marketAddress,
          assertionId: pendingAssertionId,
          challengerWon: resolution.challengerWon,
          txHash,
        };
      }
      return { action: 'none', marketAddress };
    }

    // Phase 2: Check for new challenges to escalate
    const hlProvider = new ethers.JsonRpcProvider(config.hlRpcUrl);
    const challenge = await getActiveChallenge(hlProvider, marketAddress);
    if (!challenge) return { action: 'none', marketAddress };

    challenge.proposedPrice = proposedPrice;
    const { assertionId, txHash } = await escalateToUMA(config, challenge);
    return {
      action: 'escalated',
      marketAddress,
      assertionId,
      txHash,
    };
  } catch (err: any) {
    return {
      action: 'error',
      marketAddress,
      error: err?.message || String(err),
    };
  }
}
