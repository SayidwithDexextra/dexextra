## Upgraded Gasless — One‑Time Signing (Session-Based Trades)

This document describes the minimal, additive changes required to enable “sign once, trade many” using a session permit model. The goal is to keep current per‑action meta methods working while introducing a new path that uses a single initial signature to authorize subsequent relayed trades without further end‑user signatures.

Key constraints:
- Keep existing contracts intact; add a session flow as an additive feature (no core vault changes).
- Use configured addresses from environment files, not hardcoded values.
- Maintain production safety (replay protection, expiry, budgets, revocation).


### High‑Level Flow
1) User signs a single EIP‑712 SessionPermit off‑chain.
2) Relayer verifies the permit and submits one on‑chain transaction to create the session.
3) Subsequent trade requests reference the `sessionId`; the relayer validates constraints and calls session methods on the facet with no new user signatures.
4) User or relayer can revoke the session at any time; sessions also expire automatically by time or budget.

---

## Contract Changes (Facet)

You can extend the existing `MetaTradeFacet` or introduce a new facet (e.g., `SessionTradeFacet`) that is added to the diamond. Below assumes edits are made in `MetaTradeFacet` for compactness.

### New Storage
- `mapping(bytes32 => Session) public sessions;`
- `struct Session { address trader; uint256 expiry; uint256 maxNotionalPerTrade; uint256 maxNotionalPerSession; uint256 sessionNotionalUsed; bytes32 methodsBitmap; /* allowlist bitmask */ bytes32[] allowedMarkets; address relayer; bool revoked; }`
- `event SessionCreated(bytes32 indexed sessionId, address indexed trader, address relayer, uint256 expiry);`
- `event SessionRevoked(bytes32 indexed sessionId, address indexed trader);`
- `event SessionUsage(bytes32 indexed sessionId, uint256 notionalUsed, uint256 sessionTotalUsed);`

Notes:
- `sessionId = keccak256(abi.encode(trader, relayer, sessionSalt))` to ensure uniqueness.
- `methodsBitmap` is an efficient allowlist (e.g., bit 0 = placeLimit, bit 1 = placeMarket, …).

### EIP‑712 Types (Additive)
Add a SessionPermit type and domain reuse (same domain as current facet; verifyingContract = diamond).

```solidity
// EIP-712 type hash
bytes32 private constant TYPEHASH_SESSION_PERMIT =
  keccak256("SessionPermit(address trader,address relayer,uint256 expiry,uint256 maxNotionalPerTrade,uint256 maxNotionalPerSession,bytes32 methodsBitmap,bytes32 sessionSalt,bytes32[] allowedMarkets,uint256 nonce)");
```

Message fields:
- `trader`, `relayer`
- `expiry`
- `maxNotionalPerTrade`, `maxNotionalPerSession`
- `methodsBitmap`
- `sessionSalt`
- `allowedMarkets` (array of `bytes32` market identifiers)
- `nonce` (reuse `metaNonce[trader]` to gate session creation)

### New Entry Points
- `function createSession(SessionPermit calldata p, bytes calldata signature) external returns (bytes32 sessionId);`
  - Verifies EIP‑712 signature from `p.trader`.
  - Consumes `metaNonce[p.trader]` like other meta calls.
  - Derives `sessionId` from `trader`, `relayer`, `sessionSalt`.
  - Writes `sessions[sessionId]` with constraints and emits `SessionCreated`.

- `function revokeSession(bytes32 sessionId) external;`
  - `require(msg.sender == sessions[sessionId].trader || msg.sender == sessions[sessionId].relayer, "not authorized");`
  - Sets `revoked = true`; emits `SessionRevoked`.

- Session dispatchers (no per‑action signatures):
  - `sessionPlaceLimit(bytes32 sessionId, address trader, uint256 price, uint256 amount, bool isBuy)`
  - `sessionPlaceMarginLimit(bytes32 sessionId, address trader, uint256 price, uint256 amount, bool isBuy)`
  - `sessionPlaceMarket(bytes32 sessionId, address trader, uint256 amount, bool isBuy)`
  - `sessionPlaceMarginMarket(bytes32 sessionId, address trader, uint256 amount, bool isBuy)`
  - `sessionModifyOrder(bytes32 sessionId, address trader, uint256 orderId, uint256 price, uint256 amount)`
  - `sessionCancelOrder(bytes32 sessionId, address trader, uint256 orderId)`

Each session method MUST:
1) Validate session: exists, not `revoked`, `block.timestamp <= expiry`.
2) Enforce `msg.sender == sessions[sessionId].relayer` if you want a strict relayer allowlist; otherwise require `msg.sender == address(this)` and call via a relay facet—pick one policy.
3) Check method allowlist via `methodsBitmap`.
4) If applicable, check market in `allowedMarkets`.
5) Compute trade notional and enforce `<= maxNotionalPerTrade` and `sessionNotionalUsed + notional <= maxNotionalPerSession`.
6) Increment `sessionNotionalUsed` and emit `SessionUsage`.
7) Self‑call the existing “…By” functions in `OBOrderPlacementFacet` to run current logic unchanged.

### ABI Additions (Selectors)
Add new function selectors so the relayer (and API) can route calls:
- `createSession((...),bytes)`
- `revokeSession(bytes32)`
- `sessionPlaceLimit((bytes32,address,uint256,uint256,bool))`
- `sessionPlaceMarginLimit((bytes32,address,uint256,uint256,bool))`
- `sessionPlaceMarket((bytes32,address,uint256,bool))`
- `sessionPlaceMarginMarket((bytes32,address,uint256,bool))`
- `sessionModifyOrder((bytes32,address,uint256,uint256,uint256))`
- `sessionCancelOrder((bytes32,address,uint256))`

Keep existing `meta*` functions for backward compatibility.

---

## Relayer Changes

The relayer currently forwards per‑action EIP‑712 messages (`message + signature`) to `meta*` methods. To support one‑time signing, add session lifecycle endpoints and route to `session*` methods.

### Endpoints
- `POST /api/gasless/session/init`
  - Body: `{ orderBook, permit, signature }`
  - Steps:
    1) Verify the EIP‑712 signature off‑chain (domain matches, signer = `permit.trader`).
    2) Optional: enforce policy caps off‑chain (min/max expiry, notional limits).
    3) Submit on‑chain tx: `MetaTradeFacet.createSession(permit, signature)`.
    4) Return `{ sessionId, txHash }`.

- `POST /api/gasless/trade` (extended)
  - Accept both legacy and session forms:
    - Legacy: `{ orderBook, method, message, signature }` → calls `meta*`.
    - Session: `{ orderBook, method: "sessionPlaceLimit" | ..., sessionId, params }`.
  - For session requests:
    1) Read `sessions[sessionId]` via JSON‑RPC; verify not `revoked`, not expired, `relayer` matches relayer signer (if enforced).
    2) Validate `method` against `methodsBitmap`; validate market if present.
    3) Enforce off‑chain rate limits and per‑address safety caps.
    4) Submit on‑chain tx invoking `session*` with provided `params`.
    5) Return `{ txHash, blockNumber }`.

- `POST /api/gasless/session/revoke`
  - Body: `{ orderBook, sessionId }`
  - Action: Relayer submits `revokeSession(sessionId)` from the configured relayer signer; alternatively allow user to call directly if desired by UX/policy.

### API Router Updates (Node/Next.js)
In `src/app/api/gasless/trade/route.ts`:
- Extend `ALLOWED` to include `sessionPlaceLimit`, `sessionPlaceMarginLimit`, `sessionPlaceMarket`, `sessionPlaceMarginMarket`, `sessionModifyOrder`, `sessionCancelOrder`.
- Extend `selectorFor(method)` to return the new ABI signatures for session functions.
- Branch the handler:
  - If `body.sessionId` is present → call session path; else → legacy meta path.
- Add a small on‑chain read helper to fetch `sessions[sessionId]` and validate status before sending the tx (optional but recommended defense‑in‑depth).

Example additions:
```ts
// ALLOWED additions
sessionPlaceLimit: 'sessionPlaceLimit',
sessionPlaceMarginLimit: 'sessionPlaceMarginLimit',
sessionPlaceMarket: 'sessionPlaceMarket',
sessionPlaceMarginMarket: 'sessionPlaceMarginMarket',
sessionModifyOrder: 'sessionModifyOrder',
sessionCancelOrder: 'sessionCancelOrder',
```
```ts
// selectorFor additions (signatures must match facet ABI)
'sessionPlaceLimit((bytes32,address,uint256,uint256,bool))',
'sessionPlaceMarginLimit((bytes32,address,uint256,uint256,bool))',
'sessionPlaceMarket((bytes32,address,uint256,bool))',
'sessionPlaceMarginMarket((bytes32,address,uint256,bool))',
'sessionModifyOrder((bytes32,address,uint256,uint256,uint256))',
'sessionCancelOrder((bytes32,address,uint256))',
```

### Environment & Configuration
Use environment variables; do not hardcode:
- `RPC_URL_HYPEREVM` (or `RPC_URL`)
- `RELAYER_PRIVATE_KEY`
- `NEXT_PUBLIC_CHAIN_ID` (client), `CHAIN_ID` (server)
- `NEXT_PUBLIC_DIAMOND_ADDRESS` (verifying contract address)
- `EIP712_DOMAIN_NAME`, `EIP712_DOMAIN_VERSION`
- Optional: `RELAYER_ADDRESS` (must match `sessions[sessionId].relayer` if enforced)

Production tips:
- Cache ABI once per process.
- Add per‑user and global QPS/rate limits.
- Log structured payloads, tx hashes, and reverts for supportability.

---

## Frontend Notes (FYI)
- Add a “Create Session” button that signs `SessionPermit` once and calls `/api/gasless/session/init`.
- During a session, send `{ sessionId, method, params }` to `/api/gasless/trade` (no user signature).
- Display session status (active/expired/revoked) and a “Revoke” option.
- Fallback to legacy “per‑action sign” if session creation fails or is disabled.

---

## Security & Policy
- Expiry: enforce strict maximum session lifetime on both contract and relayer.
- Budgets: cap per‑trade and per‑session notional; track and emit `SessionUsage`.
- Revocation: implement fast revocation callable by trader or relayer.
- Allowlist: optionally pin a specific `relayer` in the session for MEV and risk control.
- Markets/Methods: restrict with bitmaps and arrays; validate before execution.
- Backward Compatibility: legacy `meta*` flow remains functional.

---

## Deployment & Rollout Checklist
1) Implement and deploy facet changes (diamond cut).
2) Regenerate and publish the facet ABI; update the relayer import.
3) Update `route.ts` to add new methods and selectors; add session endpoints.
4) Set environment variables in `.env.local` and server env.
5) Fund relayer wallet and set `RELAYER_ADDRESS` if enforcing allowlist.
6) Ship behind a feature flag; monitor usage and errors.
7) Document user‑visible session UX and risk disclosures.

---

## Appendix — SessionPermit (Example)

```solidity
struct SessionPermit {
  address trader;
  address relayer;
  uint256 expiry;
  uint256 maxNotionalPerTrade;
  uint256 maxNotionalPerSession;
  bytes32 methodsBitmap;
  bytes32 sessionSalt;
  bytes32[] allowedMarkets;
  uint256 nonce; // equals metaNonce[trader] at creation time
}
```

`sessionId = keccak256(abi.encode(trader, relayer, sessionSalt))`

Session allowlist bits (example):
- bit 0: placeLimit
- bit 1: placeMarginLimit
- bit 2: placeMarket
- bit 3: placeMarginMarket
- bit 4: modifyOrder
- bit 5: cancelOrder


