# Market Creator Fee Share (80/20) — Upgrade Summary (No CoreVault Changes)

## Goal
Route **80% of trading fees** from each market to the **market owner/creator**, and **20%** to the protocol/treasury, while:

- **No changes to `CoreVault`**
- **Minimum redeploys**
- Works with the existing **Diamond OrderBook** architecture

## Current behavior (what your contracts do today)

### Where fees are computed and paid
Fees are computed in `Dexetrav5/src/diamond/facets/OBTradeExecutionFacet.sol` and paid by calling:

- `CoreVault.deductFees(buyer, buyerFee, s.feeRecipient)`
- `CoreVault.deductFees(seller, sellerFee, s.feeRecipient)`

So **100% of fees go to one address**: `s.feeRecipient`.

### Where `feeRecipient` comes from
`s.feeRecipient` is set during OrderBook initialization (`OrderBookInitFacet.obInitialize`) using the `_feeRecipient` passed in by `FuturesMarketFactory` when it deploys the Diamond.

**There is no per-market creator payout or revenue split logic currently.**

## Constraints and what “minimum redeploys” means here
Because OrderBooks are Diamonds:

- You **cannot** modify a facet already deployed at an address.
- The minimal on-chain change is:
  - **deploy 1 new facet contract** (a new implementation)
  - **diamondCut** (replace selectors) on each OrderBook you want to upgrade

This avoids redeploying:
- `CoreVault`
- `FuturesMarketFactory`
- existing OrderBook Diamonds

## Recommended “least redeploy” option: upgrade ONE facet

### ✅ Option B (least redeploy + simplest): replace only the trade execution facet and split fees there
Deploy a new facet (e.g. `OBTradeExecutionFacetV2`) and replace the existing trade execution selectors on OrderBook Diamonds.

**Fee split implementation idea (conceptual):**
- Keep `s.feeRecipient` as the **protocol/treasury** address.
- Repurpose `s.leverageController` as the **market creator payout address**.
  - This is practical because `leverageController` is currently only surfaced via events/view calls, and can be changed by diamond owner using `OBAdminFacet.setLeverageController(...)`.

Then, in the upgraded trade execution facet:
- compute `buyerFee`, `sellerFee` as today
- for each fee:
  - `creatorCut = fee * 8000 / 10000`
  - `protocolCut = fee - creatorCut`  (prevents rounding loss)
  - call `deductFees(trader, creatorCut, s.leverageController)`
  - call `deductFees(trader, protocolCut, s.feeRecipient)`

### Why this is the minimum redeploy path
- **Only one new contract deployment** (the new facet)
- **No CoreVault changes**
- **No factory changes required**
- Uses existing, already-authorized `CoreVault.deductFees(...)` flow (OrderBook already has `ORDERBOOK_ROLE`)

### Operational requirement (one-time config per market)
Because new markets currently initialize `leverageController = feeRecipient`, you will need to set it to the creator:

- After each market is created, have your relayer/admin call:
  - `OBAdminFacet.setLeverageController(creatorAddress)`

This is an **admin/relayer transaction**, not a redeploy.

### Existing markets
To upgrade existing markets:

- Run **diamondCut** on each existing OrderBook to replace the trade execution selectors.
- Then call `setLeverageController(creator)` for each market.

You can adapt `Dexetrav5/scripts/upgrade-gasless-facets.js` (it already:
- deploys facets (if needed)
- computes selectors from artifacts
- calls `diamondCut` using `ADMIN_PRIVATE_KEY` signers
)

## Alternative: “creator is provable on-chain”

### Option A (still one facet, more complexity): fetch creator from `MarketBondManager` at trade time
If you want “creator” to be **cryptographically bound** to the market creation event:

- Read creator from `MarketBondManager.bondByMarket(marketId).creator`
- Split fees to that creator instead of relying on `leverageController` config

**Catch:** the trade execution facet needs to know the `MarketBondManager` address. That typically requires:
- adding a small config storage slot for the facet (set once by diamond owner), or
- another on-chain address discovery mechanism

This is still “one facet redeploy”, but it introduces extra configuration + one extra external call in the hot path.

## Security notes (important)
- **Do not** create a general-purpose “FeeSplitter” contract and grant it `FACTORY_ROLE`/`ORDERBOOK_ROLE`.
  - `CoreVault.deductFees(user, amount, recipient)` lets the caller choose **any `user`**. A privileged splitter could drain users.
- Splitting inside the OrderBook facet is safer because:
  - The OrderBook already has `ORDERBOOK_ROLE`
  - Fees are charged only in the trading flow where they are computed

## Gas / performance notes
Today each trade causes up to **2 `deductFees` calls** (buyer + seller).

With a 2-way split it becomes up to **4 `deductFees` calls** (buyer→creator + buyer→protocol + seller→creator + seller→protocol).

This increases gas for trades, but keeps all accounting inside the existing CoreVault ledger model.

## Summary recommendation
If your priority is **least redeploys** and **no CoreVault changes**:

- **Deploy one new trade execution facet**
- **diamondCut** existing OrderBooks to replace trade execution selectors
- Use **Option B** (creator payout stored in `leverageController`) + keep `feeRecipient` as protocol treasury
- Have your relayer set `leverageController = creator` during/after market creation

