## Gasless Deposits — End-to-End Deployment Steps (Wormhole, Hub/Spoke)

This guide assumes NOTHING is deployed yet. It walks you through every environment variable and the exact commands to deploy and configure gasless deposits using Wormhole, with HyperLiquid as the hub and Polygon as the first spoke. A second section shows how to add Arbitrum later.

### 0) Prerequisites
- Node.js, pnpm/npm, Hardhat installed
- Private keys funded on each chain you deploy to
- RPC URLs/API keys for the chains you use
- You have access to deploy contracts on the hub and spoke chains

### 1) Environment variables (minimal set)
Add these to `.env.local` at the repo root (DexExtra) so both the app and Hardhat scripts can read them.

- Core accounts
  - PRIVATE_KEY or PRIVATE_KEY_DEPLOYER: EOA used to deploy
  - PRIVATE_KEY_USER1..USER4: optional extra EOAs used by the demo deploy script

- RPCs
  - POLYGON_RPC_URL or ALCHEMY_API_KEY: used by `--network polygon`
  - ARBITRUM_RPC_URL: used by `--network arbitrum` (if you expand to Arbitrum)
  - HYPERLIQUID_TESTNET_RPC_URL (optional if you use testnet)

- Hub: core contracts (leave empty now; we’ll fill after deployment)
  - CORE_VAULT_ADDRESS=
  - COLLATERAL_HUB_ADDRESS=
  - CORE_VAULT_OPERATOR_ADDRESS=

- Polygon spoke (token + vault)
  - SPOKE_POLYGON_USDC_ADDRESS=0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
  - USE_MOCK_POLYGON_USDC=0
  - POLYGON_FINALITY_BLOCKS=20
  - SPOKE_POLYGON_VAULT_ADDRESS= (filled after spoke deploy)

- Wormhole (bridge messaging)
  - BRIDGE_PROVIDER=wormhole
  - HUB_INBOX_ADDRESS= (filled after hub deploy)
  - HUB_OUTBOX_ADDRESS= (filled after hub deploy)
  - SPOKE_INBOX_ADDRESS= (filled after spoke deploy)
  - SPOKE_OUTBOX_ADDRESS= (filled after spoke deploy)
  - BRIDGE_DOMAIN_HUB=<Wormhole domain id for HyperLiquid EVM>
  - BRIDGE_DOMAIN_POLYGON=137
  - BRIDGE_REMOTE_APP_HUB= (optional; if omitted, configure script uses HUB_OUTBOX_ADDRESS)
  - BRIDGE_REMOTE_APP_POLYGON= (optional; if omitted, configure script uses SPOKE_OUTBOX_ADDRESS)
  - BRIDGE_ENDPOINT_HUB=<address allowed to call Hub inbox receiveMessage>
  - BRIDGE_ENDPOINT_POLYGON=<address allowed to call Spoke inbox receiveMessage>

Tip: remote app values are bytes32-encoded addresses (left‑padded); the configure script can derive these from the outbox/inbox addresses, so you can leave them blank initially.

### 2) Install and build
```bash
cd Dexetrav5
npx hardhat compile
```

### 3) Deploy or Redeploy Hub Core (HyperLiquid)
Pick the path that matches your need:

- Full fresh deploy (libraries + CoreVault + LiquidationManager + Factory + example market):
  ```bash
  npx hardhat run scripts/deploy.js --network hyperliquid
  ```

- Minimal CoreVault redeploy (reuse existing libraries; also deploys a new Factory; no market creation):
  ```bash
  npx hardhat run scripts/redeploy-corevault.js --network hyperliquid --allow-breaking
  ```
  Notes:
  - `--allow-breaking` acknowledges that existing markets/factory still reference the old CoreVault. This redeploy is intended to prepare a new CoreVault for future markets.
  - To keep role wiring convenient, you can also pass `--grant-ob-roles` to grant OB-related roles on the new CoreVault to known OrderBooks (this does NOT migrate their stored vault pointers).
  - The script also deploys a new FuturesMarketFactory targeting the new CoreVault and prints its address; no separate factory redeploy step is needed.

Copy from the output and update `.env.local`:
- CORE_VAULT_ADDRESS=0x...
  - FUTURES_MARKET_FACTORY_ADDRESS=0x...
  - (Optional for reference) LIQUIDATION_MANAGER_ADDRESS=0x...
  - (Optional for reference) VAULT_ANALYTICS_ADDRESS=0x...

### 4) Deploy the Spoke (Polygon)
Pick your USDC option:
- Real USDC: ensure `SPOKE_POLYGON_USDC_ADDRESS` is set and `USE_MOCK_POLYGON_USDC=0`
- Mock USDC: set `USE_MOCK_POLYGON_USDC=1` (script will deploy a mock)

Deploy:
```bash
npx hardhat run scripts/deploy-spoke-wormhole.js --network polygon
```
Script output → copy these into `.env.local`:
- SPOKE_POLYGON_VAULT_ADDRESS=0x...
- SPOKE_INBOX_ADDRESS=0x...
- SPOKE_OUTBOX_ADDRESS=0x...
- SPOKE_POLYGON_USDC_ADDRESS=0x... (if mock deployed)

Optional (multi-token on spoke):
After deploy, you can allow more tokens:
```bash
npx hardhat console --network polygon
```
Then in console:
```js
const vault = await ethers.getContractAt("SpokeVault", process.env.SPOKE_POLYGON_VAULT_ADDRESS);
await vault.addAllowedToken("0x<tokenAddress>");
```

### 5) Deploy the Hub adapters (HyperLiquid)
Requires `CORE_VAULT_ADDRESS` set. The script deploys CollateralHub if missing, Hub inbox/outbox, and grants roles.
```bash
npx hardhat run scripts/deploy-hub-wormhole.js --network hyperliquid
```
Script output → copy into `.env.local`:
- COLLATERAL_HUB_ADDRESS=0x...
- HUB_INBOX_ADDRESS=0x...
- HUB_OUTBOX_ADDRESS=0x...

If you just redeployed CoreVault and did NOT redeploy the hub adapters, update the CollateralHub to point at the new CoreVault and operator:
```bash
npx hardhat console --network hyperliquid
```
```js
const hub = await ethers.getContractAt("CollateralHub", process.env.COLLATERAL_HUB_ADDRESS);
await hub.setCoreVaultParams(process.env.CORE_VAULT_ADDRESS, process.env.CORE_VAULT_OPERATOR_ADDRESS);
```
Make sure the new CoreVault granted `EXTERNAL_CREDITOR_ROLE` to `COLLATERAL_HUB_ADDRESS` (the CoreVault redeploy script handles this; otherwise grant it manually).

### 6) Register the Polygon spoke on the Hub
```bash
TARGET_SPOKE=POLYGON npx hardhat run scripts/register-spoke-on-hub.js --network hyperliquid
```
Prereqs:
- COLLATERAL_HUB_ADDRESS
- SPOKE_POLYGON_VAULT_ADDRESS
- SPOKE_POLYGON_USDC_ADDRESS
- (Optional) `SPOKE_CHAIN_ID` (defaults to 137)

### 7) Configure allowlists and endpoint roles
Set trusted remote apps and bridge endpoints. You can do this via the helper script:

Hub side (HyperLiquid):
```bash
npx hardhat run scripts/configure-wormhole-allowlists.js --network hyperliquid
```
Spoke side (Polygon):
```bash
npx hardhat run scripts/configure-wormhole-allowlists.js --network polygon
```
Notes:
- If `BRIDGE_REMOTE_APP_*` are unset, the script will derive them: hub inbox trusts `SPOKE_OUTBOX_ADDRESS`; spoke inbox trusts `HUB_OUTBOX_ADDRESS`.
- Set `BRIDGE_ENDPOINT_HUB` and `BRIDGE_ENDPOINT_POLYGON` to the account/contract that will call `receiveMessage` on each inbox. The script grants `BRIDGE_ENDPOINT_ROLE` accordingly.

### 8) Frontend wiring (DepositModal)
- Show `SPOKE_POLYGON_VAULT_ADDRESS` as the deposit address for Polygon tokens.
- If you list multiple tokens on Polygon, users transfer any allowed token to the single SpokeVault address.
- On the hub, trading remains gasless; no user action required there.

### 9) Off-chain services (transfer-only deposits)
To keep UX “transfer-only”, run a minimal watcher:
- Listen for `Transfer` logs where `to == SPOKE_POLYGON_VAULT_ADDRESS` and `token` is allowlisted.
- Wait `POLYGON_FINALITY_BLOCKS` confirmations.
- Compute `depositId = keccak256(chainId, txHash, logIndex)`.
- Call `SpokeBridgeOutboxWormhole.sendDeposit(dstDomain=BRIDGE_DOMAIN_HUB, user, token, amount, depositId)` using a signer that has `DEPOSIT_SENDER_ROLE` on the spoke outbox.
- Gas-top the signer and monitor retries.

Withdraw delivery:
- Watch hub `HubBridgeOutboxWormhole.WithdrawSent(...)` events, and deliver payload to `SpokeBridgeInboxWormhole.receiveMessage(...)` on Polygon from `BRIDGE_ENDPOINT_POLYGON` (must have `BRIDGE_ENDPOINT_ROLE`).

### 10) End-to-end smoke test
1) Deposit (Polygon):
   - Transfer USDC (or allowed token) to `SPOKE_POLYGON_VAULT_ADDRESS`.
   - Watcher publishes deposit; hub inbox credits via `CollateralHub.creditFromBridge`.
   - Verify hub `Credited(user, amount, chainId, depositId)` event.
2) Trade (Hub):
   - Confirm `CoreVault.getAvailableCollateral(user)` reflects cross-chain credit.
3) Withdraw:
   - Call `CollateralHub.requestWithdraw(user, 137, amount)` from your relayer (has `WITHDRAW_REQUESTER_ROLE` or is the user).
   - Hub outbox emits `WithdrawSent(...)`. Your relay delivers to spoke inbox.
   - Spoke inbox calls `SpokeVault.releaseToUser(user, token, amount, withdrawId)`.
   - Verify `Released(user, amount, withdrawId)` on Polygon.

---

## Add a second spoke: Arbitrum

### Env additions
- ARBITRUM RPC + keys:
  - ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc (or provider URL)
  - PRIVATE_KEY (same deployer can be reused)
- Spoke (token + vault)
  - SPOKE_ARBITRUM_USDC_ADDRESS=0xaf88d065e77c8cC2239327C5EDb3A432268e5831
  - USE_MOCK_ARBITRUM_USDC=0
  - SPOKE_ARBITRUM_VAULT_ADDRESS= (filled after deploy)
- Wormhole
  - BRIDGE_DOMAIN_ARBITRUM=42161
  - BRIDGE_ENDPOINT_ARBITRUM=<address with BRIDGE_ENDPOINT_ROLE on Arbitrum inbox>
  - (Optional) BRIDGE_REMOTE_APP_ARBITRUM= (or derive via script)

### Deploy on Arbitrum
```bash
npx hardhat run scripts/deploy-spoke-wormhole.js --network arbitrum
```
Copy outputs to env:
- SPOKE_ARBITRUM_VAULT_ADDRESS
- SPOKE_INBOX_ADDRESS (Arbitrum)
- SPOKE_OUTBOX_ADDRESS (Arbitrum)

### Configure allowlists
- Hub (HyperLiquid):
```bash
npx hardhat run scripts/configure-wormhole-allowlists.js --network hyperliquid
```
- Spoke (Arbitrum):
```bash
npx hardhat run scripts/configure-wormhole-allowlists.js --network arbitrum
```

### Register spoke on hub
```bash
TARGET_SPOKE=ARBITRUM SPOKE_CHAIN_ID=42161 npx hardhat run scripts/register-spoke-on-hub.js --network hyperliquid
```

### Allow tokens
```bash
npx hardhat console --network arbitrum
```
Then:
```js
const vault = await ethers.getContractAt("SpokeVault", process.env.SPOKE_ARBITRUM_VAULT_ADDRESS);
await vault.addAllowedToken(process.env.SPOKE_ARBITRUM_USDC_ADDRESS);
```

---

## Quick reference: Commands
- Build:
```bash
cd Dexetrav5 && npx hardhat compile
```
- Deploy Hub core (full):
```bash
npx hardhat run scripts/deploy.js --network hyperliquid
```
- Redeploy CoreVault (also deploys new Factory; no market creation):
```bash
npx hardhat run scripts/redeploy-corevault.js --network hyperliquid --allow-breaking
```
- Deploy Spoke (Polygon):
```bash
npx hardhat run scripts/deploy-spoke-wormhole.js --network polygon
```
- Deploy Hub adapters:
```bash
npx hardhat run scripts/deploy-hub-wormhole.js --network hyperliquid
```
- Register Spoke on Hub:
```bash
TARGET_SPOKE=POLYGON npx hardhat run scripts/register-spoke-on-hub.js --network hyperliquid
```
- Configure allowlists (Hub/Spoke):
```bash
npx hardhat run scripts/configure-wormhole-allowlists.js --network hyperliquid
npx hardhat run scripts/configure-wormhole-allowlists.js --network polygon
```

---

## Notes
- BRIDGE_ENDPOINT_* must be granted `BRIDGE_ENDPOINT_ROLE` on each chain’s inbox; this is the account or endpoint contract that will call `receiveMessage`.
- If you prefer on-chain “depositAndSend” instead of a watcher, publish deposit messages from the spoke outbox in the same transaction as the user deposit flow (user pays the extra gas on the spoke).
- For production on Vercel, store secrets in Vercel env and keep `.env.local` in your local dev only. Use separate envs per environment (preview, prod).*** End Patch


### Plain English: Add an Arbitrum spoke (step‑by‑step for a junior dev)

This is the human, no‑mystery version of how to add an Arbitrum “spoke” to our hub‑and‑spoke gasless deposits system. The “hub” lives on HyperLiquid EVM. The “spoke” on Arbitrum is where users actually transfer their USDC; we credit them on the hub via messages.

- What you’ll do:
  - Configure env values for Arbitrum.
  - Deploy the Arbitrum spoke contracts (SpokeVault + Wormhole inbox/outbox).
  - Tell the hub to trust this new spoke and token.
  - Set “who is allowed to deliver bridge messages” on both sides.
  - Allow USDC on the spoke vault.
  - Run a tiny watcher to publish deposit messages (transfer‑only UX).
  - Smoke test deposit → trade → withdraw.

Why each part exists:
- The vault on Arbitrum is the single deposit address for users’ tokens.
- The inbox/outbox are the “mail slots” that receive/send cross‑chain messages.
- The hub must know which spokes and tokens are legit to prevent fake credits.
- Roles keep message delivery and deposit publication restricted to trusted actors.

1) Quick prereqs
- You have RPC + funded key for Arbitrum.
- Hub core is deployed or at least reachable (CoreVault + CollateralHub).
- You can edit `.env.local` at the repo root with the values below.

2) Add/confirm env for Arbitrum
- In `.env.local`, add:
  - `ARBITRUM_RPC_URL=...`
  - `SPOKE_ARBITRUM_USDC_ADDRESS=0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (real USDC on Arbitrum One) or set `USE_MOCK_ARBITRUM_USDC=1` if you want a mock.
  - Leave `SPOKE_ARBITRUM_VAULT_ADDRESS=` empty for now (the script will print it).
  - Wormhole bits:
    - `BRIDGE_DOMAIN_ARBITRUM=42161`
    - `BRIDGE_ENDPOINT_ARBITRUM=<your relayer address on Arbitrum>`
  - Hub bits should already be set (e.g., `CORE_VAULT_ADDRESS`, `COLLATERAL_HUB_ADDRESS`, `HUB_INBOX_ADDRESS`, `HUB_OUTBOX_ADDRESS`, `BRIDGE_ENDPOINT_HUB`).

3) Build contracts (once)

```bash
cd Dexetrav5
npx hardhat compile
```

4) Deploy the Arbitrum spoke (this gives you the vault + inbox/outbox)
- Why: We need a vault address for users to transfer USDC to, and the spoke’s outbox/inbox to send/receive messages with the hub.

```bash
npx hardhat run scripts/deploy-spoke-wormhole.js --network arbitrum
```

- Copy from the output into `.env.local`:
  - `SPOKE_ARBITRUM_VAULT_ADDRESS=0x...`
  - `SPOKE_INBOX_ADDRESS=0x...` (Arbitrum)
  - `SPOKE_OUTBOX_ADDRESS=0x...` (Arbitrum)
  - If you deployed a mock: `SPOKE_ARBITRUM_USDC_ADDRESS=0x...`

5) Configure allowlists on both chains
- Why: Each inbox must trust the other chain’s outbox (so only legit messages are accepted). Also, only specific accounts/relayers should be allowed to call `receiveMessage`.

Hub (HyperLiquid):
```bash
npx hardhat run scripts/configure-wormhole-allowlists.js --network hyperliquid
```

Spoke (Arbitrum):
```bash
npx hardhat run scripts/configure-wormhole-allowlists.js --network arbitrum
```

Notes:
- If you didn’t set `BRIDGE_REMOTE_APP_*`, the script will derive trust from the outbox addresses.
- Make sure `BRIDGE_ENDPOINT_HUB` and `BRIDGE_ENDPOINT_ARBITRUM` are set to the account/endpoint that will actually call `receiveMessage` on each inbox; the script grants `BRIDGE_ENDPOINT_ROLE` to those.

Arbitrum-specific hub example (only apply ARBITRUM, leave Polygon untouched):
```bash
BRIDGE_DOMAIN_POLYGON= \
BRIDGE_DOMAIN_ARBITRUM=42161 \
SPOKE_OUTBOX_ADDRESS_ARBITRUM=$SPOKE_OUTBOX_ADDRESS \
SPOKE_INBOX_ADDRESS_ARBITRUM=$SPOKE_INBOX_ADDRESS \
npx hardhat run scripts/configure-wormhole-allowlists.js --network hyperliquid
```

6) Register the Arbitrum spoke on the hub
- Why: The hub won’t credit deposits from a spoke it doesn’t know. This binds the spoke vault + token to a known chain ID on the hub.

```bash
TARGET_SPOKE=ARBITRUM SPOKE_CHAIN_ID=42161 npx hardhat run scripts/register-spoke-on-hub.js --network hyperliquid
```

Prereqs on the hub:
- `COLLATERAL_HUB_ADDRESS` is set and points to the correct hub adapter.
- CollateralHub has `EXTERNAL_CREDITOR_ROLE` on `CORE_VAULT_ADDRESS` (so it can credit users from bridge messages). The hub deploy scripts handle this.

7) Allow USDC on the Arbitrum vault
- Why: The SpokeVault only releases/accepts tokens that are allowlisted. This prevents random assets from being considered valid collateral.

```bash
npx hardhat console --network arbitrum
```

Inside the console:
```js
const vault = await ethers.getContractAt("SpokeVault", process.env.SPOKE_ARBITRUM_VAULT_ADDRESS);
await vault.addAllowedToken(process.env.SPOKE_ARBITRUM_USDC_ADDRESS);
```

8) Frontend: show the right deposit address
- Why: On Arbitrum, users will transfer USDC to a single address (the spoke vault). In the UI, show `SPOKE_ARBITRUM_VAULT_ADDRESS` as the deposit destination for Arbitrum.

9) Run the minimal deposit watcher (transfer‑only UX)
- Why: We want users to only do a simple token transfer; our service will publish the cross‑chain deposit message.
- What it does:
  - Watches `Transfer` logs where `to == SPOKE_ARBITRUM_VAULT_ADDRESS` and `token == SPOKE_ARBITRUM_USDC_ADDRESS`.
  - Waits for finality, computes `depositId = keccak256(chainId, txHash, logIndex)`.
  - Calls `SpokeBridgeOutboxWormhole.sendDeposit(dstDomain=BRIDGE_DOMAIN_HUB, user, token, amount, depositId)` with a signer that has `DEPOSIT_SENDER_ROLE` on the Arbitrum outbox.

Implementation detail:
- Gas‑top the outbox sender and retry on failures. For production, run this watcher as a small service.

10) Withdraw delivery path (later, when users withdraw)
- Hub emits `WithdrawSent(...)` from its outbox.
- Your relayer on Arbitrum (the one holding `BRIDGE_ENDPOINT_ROLE` on the Arbitrum inbox) calls `receiveMessage(...)` with the payload.
- The Arbitrum inbox triggers the vault to release tokens: `SpokeVault.releaseToUser(user, token, amount, withdrawId)`.

11) Smoke test end‑to‑end
1. Deposit: Transfer USDC on Arbitrum to `SPOKE_ARBITRUM_VAULT_ADDRESS`. Watcher should publish to the hub. On the hub, verify a `Credited(user, amount, chainId, depositId)`.
2. Trade: On the hub, confirm `CoreVault.getAvailableCollateral(user)` reflects the deposit and you can open a position.
3. Withdraw: Request a withdraw on the hub (relayer has `WITHDRAW_REQUESTER_ROLE` or user calls directly). Confirm the outbox event is delivered to Arbitrum and tokens are released to the user.

How the roles fit together (plain English)
- `BRIDGE_ENDPOINT_ROLE` (on inboxes): Who is allowed to deliver a cross‑chain message to `receiveMessage`. Think “mail carrier allowed to push envelopes through the slot.”
- `DEPOSIT_SENDER_ROLE` (on spoke outboxes): Which off‑chain service is allowed to publish deposit messages after seeing a user’s transfer. Think “authorized clerk who prepares and sends the envelope.”
- `EXTERNAL_CREDITOR_ROLE` (on hub CoreVault): Grants `CollateralHub` permission to credit user balances when a valid deposit message arrives. Think “accountant allowed to update the ledger after verifying stamped mail.”
- `WITHDRAW_REQUESTER_ROLE` (on hub): Optional; lets a relayer request withdrawals for users if you want a completely gasless UX on the hub.

Common foot‑guns
- Mismatched trusted apps: If the hub inbox doesn’t trust the Arbitrum outbox (or vice‑versa), messages will be rejected. Re‑run the allowlist script on both chains.
- Missing roles: If your relayer can’t call `receiveMessage`, check `BRIDGE_ENDPOINT_ROLE`. If your watcher can’t publish deposits, check `DEPOSIT_SENDER_ROLE` on the spoke outbox.
- Token not allowlisted: If credits happen but withdrawals fail on Arbitrum, make sure the token is added via `addAllowedToken(...)`.
- Env not loaded: Commands read from `.env.local`. Restart shells or `source` envs if values seem ignored.

That’s it. Once this is in place, Arbitrum behaves just like Polygon in this doc: one vault address for deposits, messages carried over Wormhole, and trading stays gasless on the hub.