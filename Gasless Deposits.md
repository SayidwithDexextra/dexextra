## Gasless Deposits — Hub/Spoke Collateral without HYPE (Implementation Guide)

Objective
- Let users deposit/withdraw USDC on many chains while your app (on the hub chain) stays fully gasless. Users never need HYPE. CoreVault remains unchanged; we add an adapter and spoke vaults around it.

Glossary (plain)
- Hub: your main chain (Hyperliquid EVM). It holds the global ledger (balances used by trading). Your dapp and relayer interact here and are gasless for users.
- CoreVault: your existing vault system. We do not redeploy it; we authorize a new adapter to credit/debit balances.
- CollateralHub (adapter): a new contract/facet on the hub that verifies deposits from spokes, credits balances, and emits withdraw intents. Pluggable to avoid touching CoreVault.
- SpokeVault: per-chain USDC vault which accepts deposits and releases funds only when presented with a verified proof of a hub withdraw intent.
- ZK light client/verifier: on-chain verifier of another chain’s block headers (finality) and event inclusion. It lets one chain verify facts about another chain without trusting a bridge.
- Proof (deposit): “This specific USDC Transfer(from=user, to=SpokeVault, amount) occurred in block B on chain X.”
- Proof (withdraw): “This specific WithdrawIntent(user, amount, targetChain) event occurred on the hub.”
- Relayer: your existing EIP‑712 server that submits hub transactions so users never need HYPE. No ERC‑4337 Paymaster required at this time.

Design Overview
- Users deposit USDC on a spoke chain by sending USDC directly to the SpokeVault address (they pay that chain’s native gas). ERC‑20 transfers are passive; no deposit function is required.
- A proof of that USDC Transfer (to SpokeVault) is verified on the hub. The CollateralHub credits the user’s global balance in the hub/CoreVault.
- Users trade gaslessly on the hub (existing EIP‑712 relayer).
- For withdrawals, the hub emits a WithdrawIntent event. The SpokeVault verifies a proof of that event, then transfers USDC to the user on the target chain (user pays that chain’s gas, or you optionally relay).

Why this meets your constraints
- No HYPE for users: all hub interactions are relayed gaslessly (reuse your current EIP‑712 relayer).
- No CoreVault redeploy: CollateralHub/adapter is added beside it and given the proper role/authority.
- Trust-minimized cross-chain: use ZK light clients to verify events across chains on-chain (no trusted bridge). If ZK clients aren’t available for a chain yet, you can temporarily plug a battle-tested messaging layer and swap later.


Implementation Plan (step-by-step)

0) Prerequisites
- Pick the first spoke chain (e.g., Polygon or Base).
- Identify official USDC address on that chain.
- Confirm hub chain RPC and relayer infra are healthy.

1) Contracts — Spoke (new)
- Deploy a SpokeVault on the chosen spoke chain:
  - Holds USDC.
  - Accepts deposits by simple USDC transfer to its address (no function call required). Users call USDC `transfer(SpokeVault, amount)` from their wallet.
  - Deposit identification is derived from the USDC `Transfer` log into the SpokeVault: `depositId = keccak256(chainId, txHash, logIndex)`.
  - Releases funds only after verifying a ZK/light-client proof of a hub WithdrawIntent. Store processed withdrawIds to prevent replays.
  - Admin setters to configure hub verifier address and allowed hub contract (adapter).

Illustrative interface
```solidity
interface ISpokeVault {
    // hub-authorized release: verified proof of hub WithdrawIntent
    function releaseToUser(
        address user,
        uint256 amount,
        bytes calldata hubProof,      // proof that hub emitted WithdrawIntent(user, amount, thisChainId, withdrawId)
        bytes32 withdrawId
    ) external;

    event Released(address indexed user, uint256 amount, bytes32 withdrawId);
}
```

2) Contracts — Hub (new, no CoreVault redeploy)
- Deploy CollateralHub (adapter) on the hub beside CoreVault:
  - Registry: registerSpoke(chainId, spokeVault, headerVerifier, receiptsVerifier, usdc, finalityBlocks).
  - Credit on valid deposit proof: verify spoke block/header finality, verify inclusion of a USDC `Transfer` with `to == SpokeVault` and `token == configured USDC`, then credit user in CoreVault. Store processed depositIds.
  - Withdraw intent: emit WithdrawIntent(user, amount, targetChain, withdrawId), debit user balance (or mark reserved), store processed withdrawIds to prevent double-withdraw.
  - Access control: only-owner/guardian for registerSpoke, adjustable finality blocks per chain; has role to modify CoreVault balances as needed.

Illustrative interface
```solidity
interface ICollateralHub {
    struct SpokeConfig {
        address spokeVault;
        address headerVerifier;   // light client for the spoke chain
        address receiptsVerifier; // event inclusion proof verifier
        address usdc;
        uint64  finalityBlocks;
        bool    enabled;
    }

    function registerSpoke(
        uint64 chainId,
        SpokeConfig calldata cfg
    ) external;

    // verify spoke deposit and credit user on hub
    function creditFromSpoke(
        uint64 chainId,
        address user,
        uint256 amount,
        bytes32 depositId,
        bytes calldata proofBundle // header proof + receipts proof
    ) external;

    // emit hub intent for spoke to release USDC
    function requestWithdraw(
        address user,
        uint64 targetChainId,
        uint256 amount
    ) external returns (bytes32 withdrawId);

    event SpokeRegistered(uint64 indexed chainId, address spokeVault);
    event Credited(address indexed user, uint256 amount, uint64 chainId, bytes32 depositId);
    event WithdrawIntent(address indexed user, uint64 indexed targetChainId, uint256 amount, bytes32 withdrawId);
}
```

3) Contracts — Verifiers (new)
- On hub: deploy or link the spoke chain’s light client + receipts/trie inclusion verifier. The adapter calls these to validate deposit proofs (USDC Transfer inclusion).
- On spoke: deploy or link the hub light client verifier, used by SpokeVault to validate withdraw intents.
- Make verifiers pluggable so you can replace implementations or switch messaging layers without redeploying CollateralHub/SpokeVault.

4) Off-chain services (new processes)
- Deposits watcher/prover:
  - Watch USDC `Transfer` logs where `to == SpokeVault` on each spoke.
  - After finalityBlocks, build proofBundle (header finality + receipts inclusion of the Transfer) and call CollateralHub.creditFromSpoke(...).
- Withdraws watcher/prover:
  - Watch WithdrawIntent events on the hub.
  - Build proof for the hub event and call SpokeVault.releaseToUser(...).
- Fail-safes: retry with idempotent ids; alert on proof failures; backoff on RPC issues.

Supabase Edge Functions (webhook-only, created via MCP automation)
- Watchers run as Supabase Edge Functions, invoked by Alchemy Notify (no polling/cron).
- Flow in the Edge Function:
  - Verify Alchemy webhook signature.
  - Decode the event logs to extract user, amount, and the canonical id (depositId or withdrawId).
  - Enforce idempotency by recording the id in DB; skip if already processed.
  - Build/obtain proofs as needed and submit on-chain directly:
    - For deposits: call `CollateralHub.creditFromSpoke(...)` on the hub.
    - For withdrawals: call `SpokeVault.releaseToUser(...)` on the spoke.
    - Use a relayer private key stored in Supabase secrets; sign and broadcast from the Edge Function.
- MCP usage (automation only):
  - Use MCP to script Supabase CLI or management API calls to create, update, and deploy Edge Functions (no MCP servers to run).
  - Examples (conceptual): “create function deposits-webhook”, “deploy deposits-webhook”, “set secrets ALCHEMY_WEBHOOK_SECRET/RELAYER_PRIVATE_KEY/RPC_URL_HUB/RPC_URL_[CHAIN]”. MCP only automates creation/deployment and secret management.

Alchemy as watcher transport
- Event sources (what to listen for):
  - On spokes: USDC `Transfer(address from, address to, uint256 amount)` logs filtered to `to == SpokeVault`.
  - On hub: `WithdrawIntent(address user, uint64 targetChainId, uint256 amount, bytes32 withdrawId)` emitted by `CollateralHub`.
- Integration modes:
  1) Webhooks (recommended): Alchemy Notify → HTTPS POST to your Supabase Edge Function endpoint per chain. The Edge Function verifies the signature, decodes logs, builds/obtains proofs, and submits on-chain (no cron, no polling, no backend hop).
  2) WebSocket (optional, non-Edge): Long-lived worker with Alchemy WSS `eth_subscribe` to `logs`; not required if webhooks are configured.
 - Use distinct Alchemy apps per network (hub, Polygon, Base, Ethereum). Apply per-chain finality offsets before acting.
 - Event decoding specifics:
   - Topic0: `Transfer(address,address,uint256)`.
   - Indexed topics: `from`, `to`; data: `amount`. Validate `token == configured USDC` and `to == configured SpokeVault`.

5) Edge-only operation (no backend hop)
- All steps occur inside the Edge Function:
  - Receive Alchemy webhook → validate → decode.
  - Check idempotency in DB.
  - Build/obtain proof artifacts and broadcast on-chain transactions directly to hub/spoke RPC endpoints using the relayer key from secrets.
  - Update DB status for observability and retries.
  - Optional: emit Supabase Realtime events for the frontend to show progress.

6) Frontend (minimal)
- Deposit flow: let user choose source chain; show the SpokeVault address and guide approve+deposit (or permit). Show “credited” status once proof confirms.
- Withdraw flow: choose target chain; show ETA based on finality and proof time; optionally offer “we relay for you” on the spoke.
- Trading stays unchanged: gasless via current relayer.

7) Configuration (.env + DB)
- .env.local (client) and server env:
  - HUB chain: CORE_VAULT_ADDRESS, COLLATERAL_HUB_ADDRESS, HUB_WITHDRAW_FINALITY, HUB_RPC_URL
  - SPOKE[CHAIN]: SPOKE_VAULT_ADDRESS, USDC_ADDRESS, SPOKE_FINALITY_BLOCKS, SPOKE_RPC_URL
  - VERIFIERS: HUB_VERIFIER_FOR_[CHAIN], SPOKE_VERIFIER_FOR_HUB
  - EDGE: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ACCESS_TOKEN, RELAYER_PRIVATE_KEY, RPC_URL_HUB, RPC_URL_[CHAIN]
  - ALCHEMY: ALCHEMY_API_KEY_[HUB|POLYGON|BASE|ETHEREUM], ALCHEMY_WEBHOOK_SECRET, ALCHEMY_WEBHOOK_URL_[CHAIN]
- DB tables (Supabase or similar):
  - spoke_vaults(chainId, spokeVault, usdc, headerVerifier, receiptsVerifier, finalityBlocks, enabled)
  - deposits(id, user, chainId, amount, txHash, logIndex, depositId, token, to, status, creditedAt)
  - withdrawals(id, user, targetChainId, amount, withdrawId, status, releasedAt)
  - ledger_balances(user, balance, reserved, updatedAt) — or reuse CoreVault views
  - proofs(depositId/withdrawId, type, submittedTxHash, verifiedAt, error)
  - watchers(chainId, lastDeliveryId, healthyAt, errorCount, lastError)

8) Security & invariants
- Idempotency: store processed depositId/withdrawId and always check before mutating state.
- Finality: per-chain confirmation windows; do not accept proofs before finalityBlocks.
- Replay protection: unique ids from (chainId, txHash, logIndex) for deposits; and from hub tx for withdraws.
- Access control: CollateralHub must be authorized to credit/debit via CoreVault roles; SpokeVault only accepts release when proof verifies a hub intent.
- Circuit breakers: pausable flags on adapter and spokes; per-chain enable toggles.
- Auditing: log all credits/withdraws with ids; export to monitoring.
- Edge functions: verify Alchemy webhook signatures; rate-limit; store minimal state; sign and broadcast on-chain txs using a relayer key in Supabase secrets; rotate keys and restrict access. MCP is used only to automate function creation/deployment; secure the Supabase access token.

9) Deployment checklist (first spoke)
- Deploys (5 total; redeploys 0):
  1. SpokeVault on the spoke chain.
  2. Hub‑intent verifier on the spoke chain.
  3. CollateralHub/adapter on the hub (one-time; grant CoreVault role).
  4. Spoke chain light client + receipts verifier on the hub.
  5. Supabase Edge Functions for watchers (Alchemy Webhooks; created/deployed via MCP automation) that also submit on-chain txs directly.
- Register spoke via CollateralHub.registerSpoke(...).
- Add env vars and DB entries; deploy Edge Functions and set secrets.

10) Adding more spokes later
- Deploys (3 per spoke; redeploys 0):
  1. SpokeVault on the new chain.
  2. Hub‑intent verifier on that spoke.
  3. That chain’s verifier (light client + receipts) on the hub (if not already deployed/shared).
- Call registerSpoke(...). Update env/DB. Extend indexers to the new chain.
- CoreVault and CollateralHub need no redeploy as long as registerSpoke exists.

11) Testing plan (essentials)
- Unit: idempotency, replay protection, revert on bad proofs, role checks.
- Integration (local chains):
  - Spoke deposit → event → proof → creditFromSpoke → hub balance increments.
  - Hub withdraw request → intent event → proof → spoke releaseToUser → transfer succeeds.
- Adversarial: invalid proof bundle, early proof (pre-finality), mismatched amount/user, double-submit attempts.


Practical Notes
- Gasless UX: Your current EIP‑712 server relayer is sufficient; a Paymaster is optional (only if you later prefer permissionless bundlers and on‑chain USDC fee capture).
- Circle CCTP (optional): add later when you want native USDC movement for rebalancing; not required for accounting/crediting.
- Non‑EVM spokes: use native IBC/bridges within those ecosystems and connect via a ZK or trusted light‑client layer when available.


Appendix A — Minimal SpokeVault skeleton
```solidity
contract SpokeVault {
    IERC20 public immutable usdc;
    address public hubVerifier; // hub light client / proof verifier
    address public hub;         // hub adapter address

    mapping(bytes32 => bool) public processedWithdrawIds;

    event Released(address indexed user, uint256 amount, bytes32 withdrawId);

    constructor(address _usdc, address _hub, address _hubVerifier) {
        usdc = IERC20(_usdc);
        hub = _hub;
        hubVerifier = _hubVerifier;
    }

    function releaseToUser(address user, uint256 amount, bytes calldata hubProof, bytes32 withdrawId) external {
        require(!processedWithdrawIds[withdrawId], "withdraw processed");
        // verify hub proof (WithdrawIntent for user, amount, this chainId, withdrawId)
        require(verifyHubIntent(hubProof, user, amount, withdrawId), "invalid hub proof");
        processedWithdrawIds[withdrawId] = true;
        require(usdc.transfer(user, amount), "usdc transfer failed");
        emit Released(user, amount, withdrawId);
    }

    function verifyHubIntent(bytes calldata, address, uint256, bytes32) internal view returns (bool) {
        // integrate hub light client here
        return true;
    }
}
```

Appendix B — Minimal CollateralHub skeleton
```solidity
contract CollateralHub {
    struct SpokeConfig {
        address spokeVault;
        address headerVerifier;
        address receiptsVerifier;
        address usdc;
        uint64  finalityBlocks;
        bool    enabled;
    }

    mapping(uint64 => SpokeConfig) public spokes;
    mapping(bytes32 => bool) public processedDepositIds;
    mapping(bytes32 => bool) public processedWithdrawIds;

    event SpokeRegistered(uint64 indexed chainId, address spokeVault);
    event Credited(address indexed user, uint256 amount, uint64 chainId, bytes32 depositId);
    event WithdrawIntent(address indexed user, uint64 indexed targetChainId, uint256 amount, bytes32 withdrawId);

    function registerSpoke(uint64 chainId, SpokeConfig calldata cfg) external {
        spokes[chainId] = cfg;
        emit SpokeRegistered(chainId, cfg.spokeVault);
    }

    function creditFromSpoke(
        uint64 chainId,
        address user,
        uint256 amount,
        bytes32 depositId,
        bytes calldata proofBundle
    ) external {
        require(!processedDepositIds[depositId], "deposit processed");
        SpokeConfig memory cfg = spokes[chainId];
        require(cfg.enabled, "spoke disabled");
        require(_verifySpokeDeposit(cfg, user, amount, depositId, proofBundle), "invalid proof");
        processedDepositIds[depositId] = true;
        _creditCoreVault(user, amount);
        emit Credited(user, amount, chainId, depositId);
    }

    function requestWithdraw(address user, uint64 targetChainId, uint256 amount) external returns (bytes32 withdrawId) {
        withdrawId = keccak256(abi.encodePacked(block.chainid, user, targetChainId, amount, block.number));
        require(!processedWithdrawIds[withdrawId], "withdraw exists");
        processedWithdrawIds[withdrawId] = true;
        _debitCoreVault(user, amount);
        emit WithdrawIntent(user, targetChainId, amount, withdrawId);
    }

    function _verifySpokeDeposit(
        SpokeConfig memory cfg,
        address user,
        uint256 amount,
        bytes32 depositId,
        bytes calldata proofBundle
    ) internal view returns (bool) {
        // integrate headerVerifier + receiptsVerifier here to prove:
        // - token == cfg.usdc
        // - log is Transfer(from=user, to=cfg.spokeVault, value=amount)
        // - inclusion in a finalized block for chainId
        return true;
    }

    function _creditCoreVault(address user, uint256 amount) internal {
        // call into existing CoreVault (authorized role) to credit user balance
    }

    function _debitCoreVault(address user, uint256 amount) internal {
        // call into existing CoreVault (authorized role) to debit user balance
    }
}
```


FAQ
- Do we need a Paymaster? No. Your current relayer-based gasless trading is sufficient. Consider 4337/Paymaster later if you want permissionless bundlers and on-chain USDC fee capture.
- Do we redeploy CoreVault? No. We add CollateralHub/adapter and grant it the proper role to credit/debit. CoreVault stays intact.
- How many deploys? First spoke: 5 (4 on-chain + 1 off-chain). Each additional spoke: 3 (on-chain). Redeploys: 0.


Execution Notes
- Keep all addresses and chain params in .env and DB (config-first).
- Start with one spoke; measure proof times and UX; then expand.
- Add monitoring (proof queues, verifier gas, payables) and safe toggles before mainnet traffic.


