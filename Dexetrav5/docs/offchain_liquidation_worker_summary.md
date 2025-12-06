# Off-Chain Liquidation Worker — Summary

Goal: cut on-chain gas for liquidations by moving “finding” off-chain, keeping “executing” on-chain and trustless.

## Roles
- **Worker (off-chain)**: indexes positions, streams prices, computes health factors, selects liquidatable users, submits candidates.
- **Contract (on-chain)**: verifies liquidation condition with its own mark price, executes liquidation, and pays rewards/penalties.

## Trustless `liquidateDirect` Flow
1. Inputs: `user`, `marketId` (no price trusted from caller).
2. On-chain fetch:
   - current `markPrice` from pricing facet/oracle
   - position + cached `liquidationPrice`
3. Condition:
   - long: `markPrice <= liquidationPrice`
   - short: `markPrice >= liquidationPrice`
   - optional small tolerance to avoid threshold flapping
4. If not liquidatable: revert early (cheap).
5. If liquidatable: run existing liquidation path (market order first, fallback to vault), distribute penalty/rewards, socialize any excess loss beyond locked margin.

## Off-Chain Worker Responsibilities
- Maintain position index via events.
- Continuously compute health factors from streamed prices.
- Build a priority queue of liquidatable users.
- Submit `liquidateDirect` or `batchLiquidate` transactions (Flashbots/private mempool recommended).

## Batching
- `batchLiquidate(users[], marketIds[])` with a single on-chain price fetch per market to amortize base gas.

## Security Notes
- No trusted caller price: contract always pulls mark price.
- Price recency enforced by oracle/pricing facet.
- Mitigate MEV with private mempool/Flashbots.
- Keep legacy scan (`pokeLiquidations`) as a safety fallback for liveness.

## Implementation Phases
1) Add `liquidateDirect` with on-chain price fetch and threshold check.  
2) Add batching.  
3) Deploy off-chain worker (index + health monitor + submitter).  
4) Optional: price proof verification if a different oracle path is added later.  


