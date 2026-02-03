# Replace FuturesMarketFactory (Bonded Markets) — Cutover Checklist

This runbook replaces the existing on-chain `FuturesMarketFactory` with the **bond-enforced** version and wires the separately deployed `MarketBondManager`, without redeploying `CoreVault` or existing OrderBooks.

## What changed (high level)
- **New `FuturesMarketFactory`** requires `bondManager` to be set and calls it during:
  - `createFuturesMarketDiamond(...)`
  - `metaCreateFuturesMarketDiamond(...)` (gasless)
  - `deactivateFuturesMarket(...)`
- **New `MarketBondManager`** (deployed separately) enforces:
  - **Global bond requirement** (admin configured)
  - **Creation penalty** (bps) applied to the bond principal (e.g. 2% → refund 98% of a 100 bond)
  - Bond is charged/refunded using **CoreVault internal ledger** via `deductFees` and only from **available balance** (`getAvailableCollateral`).

## Preconditions
- You control a key with **`DEFAULT_ADMIN_ROLE` on `CoreVault`** (to grant/revoke roles).
- You know your current **`CORE_VAULT_ADDRESS`** (hub chain).
- You have a deployer/admin key for factory admin functions (e.g. `ADMIN_PRIVATE_KEY` or `FACTORY_ADMIN_ADDRESS` depending on script).
- Your frontend/backend already reads **`FUTURES_MARKET_FACTORY_ADDRESS`** / `NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS`.

## Step 0 — Decide scope (“replace” semantics)
- **This cutover affects new market creation/deactivation going forward.**
- Existing markets remain tradable because trading is enforced by OrderBooks + CoreVault roles, not the factory.
- Any scripts/services that read markets from `factory.getAllMarkets()` should be pointed at the intended factory address (or updated to use your DB/supabase markets table).

## Step 1 — Build + verify contract sizes
From `Dexetrav5/`:

```bash
npx hardhat compile
npm run size:contracts
```

Confirm `FuturesMarketFactory` is **< 24,576 bytes** and compilation succeeds.

## Step 2 — Deploy the NEW `FuturesMarketFactory`
Use one of the existing deploy scripts (they also grant vault roles):

### Option A (recommended): `deploy-new-factory.js`
- Requires env:
  - `CORE_VAULT_ADDRESS` (existing vault)
  - optional: `FACTORY_ADMIN_ADDRESS`, `FACTORY_FEE_RECIPIENT`

```bash
cd Dexetrav5
CORE_VAULT_ADDRESS=0x... \
npx hardhat run scripts/deploy-new-factory.js --network <network>
```

Record the printed address as:
- **`NEW_FACTORY_ADDRESS`**

### Verify roles were granted on CoreVault
The new factory must have:
- **`FACTORY_ROLE`** (to call `registerOrderBook`, `assignMarketToOrderBook`, `deregisterOrderBook`)
- **`SETTLEMENT_ROLE`** (factory seeds start price via `updateMarkPrice`)

If you used a script that did not grant roles, grant them manually (admin-only on CoreVault):
- `grantRole(FACTORY_ROLE, NEW_FACTORY_ADDRESS)`
- `grantRole(SETTLEMENT_ROLE, NEW_FACTORY_ADDRESS)`

## Step 3 — Deploy `MarketBondManager` (separately) and wire it into the factory
Run:

```bash
cd Dexetrav5
CORE_VAULT_ADDRESS=0x... \
FUTURES_MARKET_FACTORY_ADDRESS=0x<NEW_FACTORY_ADDRESS> \
npx hardhat run scripts/deploy-market-bond-manager.js --network <network>
```

This script does three critical things:
1) Deploys `MarketBondManager`
2) Grants **`FACTORY_ROLE` on CoreVault** to the bond manager (required so it can call `CoreVault.deductFees`)
3) Calls **`factory.setBondManager(managerAddress)`**

Record:
- **`BOND_MANAGER_ADDRESS`**

## Step 4 — Configure bond + penalty (admin/owner actions)
`MarketBondManager` is owner-configured.

### Set bond requirement (6 decimals)
Call:
- `setBondConfig(defaultBondAmount, minBondAmount, maxBondAmount)`

Example (100 USDC bond, min 1 USDC, no max):
- `defaultBondAmount = 100_000_000`
- `minBondAmount = 1_000_000`
- `maxBondAmount = 0`

### Set creation penalty (bps) + recipient
Call:
- `setPenaltyConfig(penaltyBps, penaltyRecipient)`

Example (2% penalty to treasury):
- `penaltyBps = 200`
- `penaltyRecipient = 0x...`

Notes:
- If `penaltyBps > 0`, `penaltyRecipient` must be non-zero.
- The penalty is collected immediately at creation and only the net amount is refundable.

## Step 5 — Sync ABI used by the Next.js app
The Next.js app imports the factory ABI from `src/lib/abis/FuturesMarketFactory.json`.

After compile:

```bash
node Dexetrav5/scripts/sync-factory-abi.js
```

Deploy/restart the app after syncing if your runtime packages ABIs at build time.

## Step 6 — Update env vars everywhere (server + client)
Update these to the **new factory**:
- `FUTURES_MARKET_FACTORY_ADDRESS=0x<NEW_FACTORY_ADDRESS>` (server)
- `NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS=0x<NEW_FACTORY_ADDRESS>` (client)

Recommended (gasless create):
- `GASLESS_CREATE_ENABLED=true`

Optional (domain defaults; many paths also read on-chain `eip712DomainInfo()`):
- `EIP712_FACTORY_DOMAIN_NAME=DexeteraFactory`
- `EIP712_FACTORY_DOMAIN_VERSION=1`

## Step 7 — Relayer/Backend routing changes (what is required)
In your current architecture:
- The relayer submits `metaCreateFuturesMarketDiamond(...)`.
- The creator’s signature authorizes creation.

What you MUST ensure after cutover:
- The relayer/backend is using the **new factory address** (env above).
- The deployed factory has `bondManager` set (Step 3), otherwise create will revert.
- The creator has enough **CoreVault available balance** to cover:
  - factory market creation fee (if enabled) **plus**
  - the bond requirement (charged by bond manager)

What you do NOT need:
- No new on-chain roles for relayer EOAs are required for market creation; authorization remains signature-based.

## Step 8 — Optional: revoke roles from the OLD factory (only after verification)
Once the new factory is verified in production, you can prevent accidental use of the old one:
- `revokeRole(FACTORY_ROLE, OLD_FACTORY_ADDRESS)`
- `revokeRole(SETTLEMENT_ROLE, OLD_FACTORY_ADDRESS)`

Only do this after you’re sure:
- no services still point at the old address
- you don’t need the old factory for market deactivation/admin workflows

## Step 9 — Post-cutover validation checklist
1) **Smoke create (gasless)** via `/api/markets/create`:
   - should succeed
   - should show `creator` (not relayer) in the `FuturesMarketCreated` event
2) **Bond ledger check**:
   - `MarketBondManager.bondByMarket(marketId)` should store the **net refundable** amount
   - `penaltyRecipient` should receive the penalty in CoreVault ledger
3) **Deactivation check (unused market)**:
   - create a market and ensure no trades/orders/positions exist
   - call `factory.deactivateFuturesMarket(orderBook)`
   - verify bond refund occurred (net amount)
4) Re-run size check:

```bash
cd Dexetrav5
npm run size:contracts
```

## Rollback plan (fast)
- Re-point env vars back to `OLD_FACTORY_ADDRESS` (server + client) and redeploy.
- If you already revoked roles from the old factory, re-grant them.

