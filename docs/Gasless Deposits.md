## Gasless Deposits — Hub/Spoke Collateral via Trusted Bridge Messaging (Implementation Guide)

Objective
- Let users deposit/withdraw USDC on many chains while your app (on the hub chain) stays fully gasless. Users never need HYPE. CoreVault v2 supports math‑only cross‑chain credits; we add an adapter and spoke vaults, and use a trusted bridge (Wormhole/LayerZero/Hyperlane) for cross‑chain messages.

Glossary (plain)
- Hub: your main chain (Hyperliquid EVM). It holds the global ledger (balances used by trading). Your dapp and relayer interact here and are gasless for users.
- CoreVault v2: custodial hub ledger that separates backedCollateral (withdrawable on hub) from crossChainCredits (math‑only). Trading uses both; hub withdraws only use backed collateral.
- CollateralHub (adapter): hub contract that credits/debits CoreVault via crossChainCredits and emits WithdrawIntent. It now accepts credits exclusively from a bridge inbox (no ZK proofing).
- SpokeVault: per‑chain USDC vault which accepts token custody and releases funds only when a trusted bridge delivers a valid WithdrawIntent from the hub (no on‑chain ZK verification).
- Bridge (Wormhole/LayerZero/Hyperlane): delivers authenticated cross‑chain messages between your apps. App‑level allowlists restrict which remote app/domain your contracts accept.
- Message (deposit): “Credit user, amount, depositId from chain X.” Sent from the spoke to the hub.
- Message (withdraw): “Release user, amount, withdrawId for chain X.” Sent from the hub to the spoke.
- Relayer: your existing EIP‑712 server that submits hub transactions so users never need HYPE. No ERC‑4337 Paymaster required at this time.

Design Overview
- Users deposit USDC on a spoke chain to the SpokeVault (they pay that chain’s native gas). Option A: passive ERC‑20 transfer + watcher calls SpokeOutbox; Option B: `depositAndSend` that calls Outbox on‑chain.
- The bridge delivers a deposit message to the hub. CollateralHub’s HubBridgeInbox validates the sender/domain and calls `creditExternal(user, amount)`, idempotent on `depositId`.
- Users trade gaslessly on the hub as before.
- For withdrawals, the hub emits `WithdrawIntent` and immediately calls HubBridgeOutbox; the spoke’s SpokeBridgeInbox validates the sender/domain and calls `SpokeVault.releaseToUser(user, amount, withdrawId)`.

Why this meets your constraints
- No HYPE for users: all hub interactions are relayed gaslessly (reuse your current EIP‑712 relayer).
- CoreVault v2: trading can use cross‑chain credits; hub withdrawals remain backed only by custodial collateral.
- Trusted cross‑chain: rely on a battle‑tested bridge with strict app‑level allowlists, pausability, and idempotency. You can keep interfaces modular to swap to ZK later if needed.

Implementation Plan (step‑by‑step)

0) Prerequisites
- Pick the first spoke chain (e.g., Polygon or Arbitrum).
- Identify official USDC address on that chain.
- Choose a bridge (Wormhole/LayerZero/Hyperlane) and configure endpoints/domains/app addresses.
- Confirm hub chain RPC and relayer infra are healthy.

1) Contracts — Spoke (new)
- Deploy a SpokeVault on the chosen spoke chain:
  - Holds USDC.
  - Accepts deposits by USDC transfer to its address (passive) or via a `depositAndSend` helper.
  - Deposit identification: `depositId = keccak256(chainId, txHash, logIndex)` (if passive) or `keccak256(chainId, sender, nonce)` (if active).
  - Releases funds only when a trusted SpokeBridgeInbox (bridge receiver) calls `releaseToUser(user, amount, withdrawId)`. Store processed withdrawIds to prevent replays.
  - Admin setters to configure the SpokeBridgeInbox (authorized caller) and USDC address.

Illustrative interface
```solidity
interface ISpokeVault {
    // bridge‑authorized release: verified message of hub WithdrawIntent
    function releaseToUser(
        address user,
        uint256 amount,
        bytes32 withdrawId
    ) external;

    event Released(address indexed user, uint256 amount, bytes32 withdrawId);
}
```

2) Contracts — Hub (adapter beside CoreVault)
- Deploy CollateralHub on the hub:
  - Registry: `registerSpoke(chainId, spokeVault, usdc, enabled)`.
  - Credit on inbound bridge message: `creditFromBridge(user, amount, depositId)` callable only by HubBridgeInbox; idempotent on depositId; credits CoreVault via `creditExternal`.
  - Withdraw flow: `requestWithdraw(user, targetChainId, amount)` emits `WithdrawIntent` and calls HubBridgeOutbox to send a withdraw message to the spoke; idempotent on `withdrawId`; debits CoreVault via `debitExternal`.
  - Access control: `EXTERNAL_CREDITOR_ROLE` on CoreVault; `BRIDGE_INBOX_ROLE` for authorized inbox; admin can pause/toggle spokes.

Illustrative interface
```solidity
interface ICollateralHub {
    struct SpokeConfig {
        address spokeVault;
        address usdc;
        bool    enabled;
    }

    function registerSpoke(uint64 chainId, SpokeConfig calldata cfg) external;

    // credit user on hub via bridge receiver
    function creditFromBridge(uint64 chainId, address user, uint256 amount, bytes32 depositId) external;

    // emit hub intent and dispatch bridge message
    function requestWithdraw(address user, uint64 targetChainId, uint256 amount) external returns (bytes32 withdrawId);

    event SpokeRegistered(uint64 indexed chainId, address spokeVault);
    event Credited(address indexed user, uint256 amount, uint64 chainId, bytes32 depositId);
    event WithdrawIntent(address indexed user, uint64 indexed targetChainId, uint256 amount, bytes32 withdrawId);
}
```

3) Contracts — Bridge adapters (new)
- On hub: HubBridgeInbox (bridge receiver) and HubBridgeOutbox (bridge sender).
- On spoke: SpokeBridgeInbox (receiver) and optional SpokeBridgeOutbox (sender if deposits are initiated on‑chain).
- All inbox contracts strictly validate remote app address and domain; only inboxes can call CollateralHub/SpokeVault privileged entrypoints.

4) Off‑chain services (optional)
- Optional deposits watcher (if you choose passive deposits):
  - Watch USDC `Transfer` logs where `to == SpokeVault` on each spoke.
  - After sufficient confirmations, call SpokeBridgeOutbox to publish the deposit message.
- If you use on‑chain `depositAndSend`, no watcher is required.
- Fail‑safes: idempotent depositIds; retry/backoff; alerts on message failures.

Webhook transport
- Event sources (what to listen for):
  - On spokes: USDC `Transfer(address from, address to, uint256 amount)` logs filtered to `to == SpokeVault`.
  - On hub: `WithdrawIntent(address user, uint64 targetChainId, uint256 amount, bytes32 withdrawId)`.
- Integration modes:
  1) Webhooks (recommended): Notify → HTTPS POST to your Edge Function per chain. The Edge Function verifies the signature, decodes logs, and (if needed) calls Outbox.
  2) WebSocket (optional): Long‑lived worker; not required if webhooks are configured.
- Use distinct project keys per network; apply per‑chain confirmation windows before acting.
- Event decoding specifics:
  - Topic0: `Transfer(address,address,uint256)`.
  - Indexed topics: `from`, `to`; data: `amount`. Validate `token == configured USDC` and `to == configured SpokeVault`.

5) Edge‑only operation (no backend hop)
- Receive webhook → validate → decode.
- Check idempotency in DB.
- Broadcast Outbox tx (if used); otherwise no off‑chain action is required.
- Update DB status for observability and retries.
- Optional: emit Realtime events for the frontend to show progress.

6) Frontend (minimal)
- Deposit flow: let user choose source chain; show the SpokeVault address and guide approve+deposit (or permit). Show “credited” status once message is delivered on hub.
- Withdraw flow: choose target chain; show ETA based on delivery latency; optionally offer “we relay for you” on the spoke.
- Trading stays unchanged: gasless via current relayer.

7) Configuration (.env + DB)
- .env.local (client) and server env:
  - HUB chain: CORE_VAULT_ADDRESS, COLLATERAL_HUB_ADDRESS, HUB_RPC_URL
  - SPOKE[CHAIN]: SPOKE_VAULT_ADDRESS, USDC_ADDRESS, SPOKE_RPC_URL
  - BRIDGE: BRIDGE_PROVIDER, HUB_INBOX_ADDRESS, HUB_OUTBOX_ADDRESS, SPOKE_INBOX_ADDRESS, SPOKE_OUTBOX_ADDRESS, BRIDGE_ENDPOINT_[HUB|CHAIN], BRIDGE_REMOTE_APP_[HUB|CHAIN], BRIDGE_DOMAIN_[HUB|CHAIN]
  - EDGE (optional): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ACCESS_TOKEN, RELAYER_PRIVATE_KEY, RPC_URL_HUB, RPC_URL_[CHAIN]
  - WEBHOOK: WEBHOOK_SECRET, WEBHOOK_URL_[CHAIN]
- DB tables:
  - spoke_vaults(chainId, spokeVault, usdc, inbox, outbox, domain, enabled)
  - deposits(id, user, chainId, amount, txHash, logIndex, depositId, token, to, status, creditedAt)
  - withdrawals(id, user, targetChainId, amount, withdrawId, status, releasedAt)
  - ledger_balances(user, balance, reserved, updatedAt)
  - watchers(chainId, lastDeliveryId, healthyAt, errorCount, lastError)

8) Security & invariants
- Idempotency: store processed depositId/withdrawId and always check before mutating state.
- Finality: apply per‑chain confirmation windows before calling Outbox (if used).
- Replay protection: unique ids from (chainId, txHash, logIndex) or (chainId, sender, nonce) for deposits; and from hub tx for withdraws.
- Access control: CollateralHub must be authorized to credit/debit via CoreVault roles; SpokeVault only accepts release from SpokeBridgeInbox; Hub only credits from HubBridgeInbox.
- Circuit breakers: pausable flags on adapter and spokes; per‑chain enable toggles.
- Auditing: log all credits/withdraws with ids; export to monitoring.

9) Deployment checklist (first spoke)
- Deploys (5 total; redeploys 0):
  1. SpokeVault on the spoke chain.
  2. SpokeBridgeInbox (and optional SpokeBridgeOutbox) on the spoke chain.
  3. CollateralHub/adapter on the hub (one‑time; grant CoreVault roles).
  4. HubBridgeInbox and HubBridgeOutbox on the hub.
  5. Optional Edge Functions for passive deposit watcher.
- Register spoke via `CollateralHub.registerSpoke(...)`.
- Add env vars and DB entries; deploy Edge Functions (if used) and set secrets.

10) Adding more spokes later
- Deploys (3–4 per spoke; redeploys 0):
  1. SpokeVault on the new chain.
  2. SpokeBridgeInbox (+ optional SpokeBridgeOutbox).
  3. Hub already has HubBridgeInbox/Outbox; just add spoke config.
- Call `registerSpoke(...)`. Update env/DB. Extend indexers to the new chain.
- CoreVault and CollateralHub need no redeploy as long as `registerSpoke` exists.

11) Testing plan (essentials)
- Unit: idempotency, replay protection, revert on bad messages, role checks.
- Integration (local chains):
  - Spoke deposit → Outbox (or watcher) → HubBridgeInbox.creditFromBridge → hub balance increments.
  - Hub withdraw request → Outbox → SpokeBridgeInbox.releaseToUser → transfer succeeds.
- Adversarial: invalid sender/domain, early message (pre‑confirmation for watcher), mismatched amount/user, double‑submit attempts.

Practical Notes
- Gasless UX: your current EIP‑712 relayer is sufficient; ERC‑4337 Paymaster optional.
- Circle CCTP (optional): add later for native USDC rebalancing; not required for accounting/crediting.
- Non‑EVM spokes: use ecosystem bridges and adapt inbox/outbox patterns when available.

Appendix A — Minimal SpokeVault skeleton
```solidity
contract SpokeVault {
    IERC20 public immutable usdc;
    address public bridgeInbox; // authorized receiver
    mapping(bytes32 => bool) public processedWithdrawIds;
    event Released(address indexed user, uint256 amount, bytes32 withdrawId);
    constructor(address _usdc, address _inbox) { usdc = IERC20(_usdc); bridgeInbox = _inbox; }
    function setBridgeInbox(address _inbox) external /* onlyAdmin */ { bridgeInbox = _inbox; }
    function releaseToUser(address user, uint256 amount, bytes32 withdrawId) external {
        require(msg.sender == bridgeInbox, "only inbox");
        require(!processedWithdrawIds[withdrawId], "processed");
        processedWithdrawIds[withdrawId] = true;
        require(usdc.transfer(user, amount), "transfer failed");
        emit Released(user, amount, withdrawId);
    }
}
```

Appendix B — Minimal CollateralHub skeleton
```solidity
contract CollateralHub {
    struct SpokeConfig {
        address spokeVault;
        address usdc;
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

    function creditFromBridge(uint64 chainId, address user, uint256 amount, bytes32 depositId) external {
        require(!processedDepositIds[depositId], "deposit processed");
        SpokeConfig memory cfg = spokes[chainId];
        require(cfg.enabled, "spoke disabled");
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

    function _creditCoreVault(address user, uint256 amount) internal {}
    function _debitCoreVault(address user, uint256 amount) internal {}
}
```

FAQ
- Do we need a Paymaster? No. Your current relayer-based gasless trading is sufficient. Consider 4337/Paymaster later if you want permissionless bundlers and on‑chain USDC fee capture.
- Do we redeploy CoreVault? Yes, CoreVault v2 provides a separate cross‑chain credit ledger while retaining hub withdrawal rules and trading logic.
- How many deploys? First spoke: 5 (4 on‑chain + optional watcher). Each additional spoke: 3–4 (on‑chain). Redeploys: 0.

Execution Notes
- Keep all addresses and chain params in .env and DB (config-first).
- Start with one spoke; measure message times and UX; then expand.
- Add monitoring (delivery queues, fees, retries) and safe toggles before mainnet traffic.






