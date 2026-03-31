# Pre-Production Upgrades

Three issues must be resolved before mainnet launch.

---

## 1. UUPS Proxy for CoreVault

CoreVault is deployed as a standalone (non-upgradeable) contract. Any bug fix requires a full redeploy and state migration — manually snapshotting every user's collateral, credit, positions, and realized P&L, deploying a new contract, replaying that state, transferring USDC, and rewiring every OrderBook, Factory, and CollateralHub.

**Fix:** Redeploy CoreVault behind an OpenZeppelin UUPS proxy. Future upgrades become a single `upgradeToAndCall` transaction with zero state migration.

**Scope:** New `CoreVaultV2` inheriting `UUPSUpgradeable` + `AccessControlUpgradeable`, deploy via `ERC1967Proxy`, add `_authorizeUpgrade` restricted to `DEFAULT_ADMIN_ROLE`.

---

## 2. Settlement Solvency Bug (CoreVault.settleMarket)

The `settleMarket` function caps loser seizures using only `userCollateral`, ignoring `userCrossChainCredit`. When a loser's funds are entirely in cross-chain credit, the system sees their balance as $0, sets `scaleRay = 0`, and distributes zero P&L to all participants.

**Two-line fix** in `settleMarket`:

Line 1208 — first solvency scan (computing `losersCapacity6`):
```solidity
// BEFORE
uint256 balance = userCollateral[user];
// AFTER
uint256 balance = userCollateral[user] + userCrossChainCredit[user];
```

Line 1272 — second pass (actual debit execution):
```solidity
// BEFORE
uint256 balance2 = userCollateral[user2];
// AFTER
uint256 balance2 = userCollateral[user2] + userCrossChainCredit[user2];
```

Both lines are sanity caps on `seizeCap`. The debit logic below line 1272 already correctly splits the deduction across `userCrossChainCredit` then `userCollateral`, so no other changes are needed.

---

## 3. Session-Based Top-Ups

Top-ups currently use a per-action EIP-712 signature verified directly by CoreVault (`metaTopUpPositionMargin` + `topUpNonces`). The session registry covers order-book actions (place/cancel/modify) via `submitSessionTrade`, but CoreVault top-ups are not wired to that flow. The vault does not expose a session-based entrypoint.

**Fix:** Add a CoreVault function (or OrderBook facet) that accepts a session credential instead of a user signature, allowing top-ups to go through the same session auth path as trades. This requires:

- A new entrypoint on CoreVault (e.g. `sessionTopUpPositionMargin`) that validates via the SessionRegistry instead of `ecrecover`.
- Or a new OrderBook facet that calls `vault.topUpPositionMargin` on behalf of the user after verifying the session key.
