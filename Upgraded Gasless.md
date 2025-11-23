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

## Contract Changes (Global)

Move session state and signature domain to a single Global Session Registry so one session propagates to all markets (diamonds) created by your factory. The facets no longer store sessions locally; they reference the registry to enforce budgets and permissions.

### New Contract: GlobalSessionRegistry
- Storage (centralized across markets):
  - `mapping(bytes32 => Session) public sessions;`
  - `struct Session { address trader; address relayer; uint256 expiry; uint256 maxNotionalPerTrade; uint256 maxNotionalPerSession; uint256 sessionNotionalUsed; bytes32 methodsBitmap; bool revoked; }`
- Events:
  - `event SessionCreated(bytes32 indexed sessionId, address indexed trader, address relayer, uint256 expiry);`
  - `event SessionRevoked(bytes32 indexed sessionId, address indexed trader);`
  - `event SessionCharged(bytes32 indexed sessionId, uint256 notionalUsed, uint256 newSessionTotalUsed, uint8 methodBit);`
- Admin/Policy:
  - `setAllowedOrderbook(address orderbook, bool allowed)` or `setFactory(address factory)` to trust all diamonds from your factory
  - Optional `setRelayerAllowlist(address relayer, bool)` if you want to pin relayers globally
- Core methods:
  - `createSession(SessionPermit p, bytes signature) returns (bytes32 sessionId)`
  - `revokeSession(bytes32 sessionId)`
  - `chargeSession(bytes32 sessionId, address trader, uint8 methodBit, uint256 notional)` onlyCallableBy(allowed orderbooks)
    - Validates not revoked, not expired, relayer allowlist (if configured), method bitmap, per-trade/per-session budgets; increments usage; emits `SessionCharged`

Notes:
- `sessionId = keccak256(abi.encode(trader, relayer, sessionSalt))`
- `methodsBitmap` is an efficient allowlist (e.g., bit 0 = placeLimit, bit 1 = placeMarket, …)

### EIP‑712 Types (Global)
Add a SessionPermit type and bind the EIP‑712 domain to the GlobalSessionRegistry (verifyingContract = registry).

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

### Facet Updates (per-market diamonds)
- Add a single pointer to the registry and a setter gated by owner:
  - `address public sessionRegistry;`
  - `function setSessionRegistry(address registry) external onlyOwner`
- Keep the existing session dispatchers in `MetaTradeFacet` (no per‑action signatures):
  - `sessionPlaceLimit/Market/.../Modify/Cancel(...)`
- Enforcement flow inside each session method:
  1) Compute trade notional (using price or best bid/ask for market orders)
  2) Call `IGlobalSessionRegistry(sessionRegistry).chargeSession(sessionId, trader, methodBit, notional)`
  3) On success, self‑call the existing “…By” functions in `OBOrderPlacementFacet`
- Remove per-market session storage; events move to the registry (the facet can still emit trade events as before).

### ABI Additions
- GlobalSessionRegistry ABI (new) for the client/relayer
- Facet adds `setSessionRegistry(address)` (admin-only) and keeps existing `session*` methods
- Existing `meta*` functions remain for backward compatibility

---

## Relayer Changes

The relayer currently forwards per‑action EIP‑712 messages (`message + signature`) to `meta*` methods. For one‑time signing across all markets, create sessions on the GlobalSessionRegistry and route trades to per-market `session*` facet methods.

### Endpoints
- `POST /api/gasless/session/init`
  - Body: `{ permit, signature }` (no per-market `orderBook` needed)
  - Steps:
    1) Verify the EIP‑712 signature off‑chain (domain matches, signer = `permit.trader`).
    2) Optional: enforce policy caps off‑chain (min/max expiry, notional limits).
    3) Submit on‑chain tx: `GlobalSessionRegistry.createSession(permit, signature)`.
    4) Return `{ sessionId, txHash }`.

- `POST /api/gasless/trade` (extended)
  - Accept both legacy and session forms:
    - Legacy: `{ orderBook, method, message, signature }` → calls `meta*`.
    - Session: `{ orderBook, method: "sessionPlaceLimit" | ..., sessionId, params }`.
  - For session requests:
    1) Optionally read `GlobalSessionRegistry.sessions(sessionId)` via JSON‑RPC; verify not `revoked`, not expired; relayer allowlist if enforced.
    2) Validate `method` against `methodsBitmap`.
    3) Enforce off‑chain rate limits and per‑address safety caps.
    4) Submit on‑chain tx invoking market `session*` method with provided `params` (facet will `chargeSession` on registry).
    5) Return `{ txHash, blockNumber }`.

- `POST /api/gasless/session/revoke`
  - Body: `{ sessionId }`
  - Action: Relayer submits `GlobalSessionRegistry.revokeSession(sessionId)`; alternatively allow user to call directly (wallet).

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

### Environment & Configuration (additions)
Use environment variables; do not hardcode:
- `RPC_URL_HYPEREVM` (or `RPC_URL`)
- `RELAYER_PRIVATE_KEY`
- `NEXT_PUBLIC_CHAIN_ID` (client), `CHAIN_ID` (server)
- `SESSION_REGISTRY_ADDRESS` (server) and `NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS` (client)
- `EIP712_DOMAIN_NAME`, `EIP712_DOMAIN_VERSION` (the verifying contract is the registry)
- Optional: `RELAYER_ADDRESS` (must match permit.relayer if enforced)

Production tips:
- Cache ABI once per process.
- Add per‑user and global QPS/rate limits.
- Log structured payloads, tx hashes, and reverts for supportability.

---

## Frontend Notes (FYI)
- Add a “Create Session” button that signs `SessionPermit` once against the GlobalSessionRegistry domain and calls `/api/gasless/session/init`.
- During a session, send `{ sessionId, method, params, orderBook }` to `/api/gasless/trade` (no user signature). The per-market facet will enforce via the registry.
- Display session status (active/expired/revoked) and a “Revoke” option.
- Fallback to legacy “per‑action sign” if session creation fails or is disabled.
- For Factory meta‑create specifically: no UI design changes required. Reuse the existing “Create Market” user action and route; the backend/relayer decides whether to use meta‑create or legacy based on a feature flag. Any signature prompts reuse the existing wallet signing flow (no new UI components).

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
1) Deploy `GlobalSessionRegistry` and grant it admin roles as needed.
2) Allow your markets: `setAllowedOrderbook(orderBook, true)` or set the factory once.
3) Diamond cut: update `MetaTradeFacet` to include `setSessionRegistry(address)` and wire the address on each market.
4) Regenerate and publish ABIs for registry and facets; update relayer imports.
5) Update API: `/api/gasless/session/init` to call the registry; verify `/api/gasless/trade` is unchanged.
6) Set env in `.env.local` and server env: `SESSION_REGISTRY_ADDRESS`, `NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS`, `RELAYER_ADDRESS`.
7) Ship behind a feature flag; monitor usage and errors; add dashboards for registry `SessionCreated/Charged/Revoked`.

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



## Alternative — Single Redeploy: EIP‑712 Meta‑Create (Factory Only)

This path enables a gasless “create market” flow without ERC‑2771 or ERC‑4337 by adding a signature‑verified entrypoint to the Factory and redeploying ONLY the Factory. Vault and existing OrderBooks remain unchanged. New markets created via the meta path are wired identically.

### Goals
- Add a new EIP‑712 meta‑create method on the Factory that treats a signed `creator` as the logical caller.
- Keep the legacy `createFuturesMarketDiamond(...)` intact for backward compatibility.
- Avoid forwarders and smart‑account infra; keep deploy scope to the Factory and env/role updates only.

---

### On‑Chain Changes (Factory)

1) Inherit EIP‑712 and add state for replay protection
- Add `import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";`
- Add `import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";`
- Inherit `EIP712("DexetraFactory","1")`.
- Add per‑user nonce:
  - `mapping(address => uint256) public metaCreateNonce;`

2) Define typed‑data schema for meta‑create
- Users sign a compact message where dynamic arrays are pre‑hashed.
- Suggested struct (string/data arrays hashed for wallet UX):

```solidity
// EIP-712 type hash for meta create
bytes32 private constant TYPEHASH_META_CREATE =
  keccak256(
    "MetaCreate(string marketSymbol,string metricUrl,uint256 settlementDate,uint256 startPrice,string dataSource,bytes32 tagsHash,address diamondOwner,bytes32 cutHash,address initFacet,address creator,uint256 nonce,uint256 deadline)"
  );
```

3) Pre-hash dynamic inputs deterministically
- `tagsHash = keccak256(abi.encodePacked(tags))`
- `cutHash` is the hash of an ordered list of facet cuts:

```solidity
// Pseudocode
// perCutHash = keccak256(abi.encode(f.facetAddress, f.action, keccak256(abi.encodePacked(f.functionSelectors))));
// cutHash    = keccak256(abi.encodePacked(perCutHash_0, perCutHash_1, ...))
```

4) New function: meta create
- Signature variant A (flat params):

```solidity
function metaCreateFuturesMarketDiamond(
  string memory marketSymbol,
  string memory metricUrl,
  uint256 settlementDate,
  uint256 startPrice,
  string memory dataSource,
  string[] memory tags,
  address diamondOwner,
  IDiamondCut.FacetCut[] memory cut,
  address initFacet,
  address creator,
  uint256 nonce,
  uint256 deadline,
  bytes calldata signature
) external returns (address orderBook, bytes32 marketId);
```

- Internal flow (high level):
  - Compute `tagsHash` and `cutHash`.
  - Build `structHash = keccak256(abi.encode(TYPEHASH_META_CREATE, ...))`.
  - `bytes32 digest = _hashTypedDataV4(structHash);`
  - `address signer = ECDSA.recover(digest, signature); require(signer == creator, "bad sig");`
  - `require(block.timestamp <= deadline, "expired");`
  - `require(nonce == metaCreateNonce[creator], "bad nonce"); metaCreateNonce[creator] = nonce + 1;`
  - Enforce gating against the logical creator:
    - `require(publicMarketCreation || creator == admin, "restricted");`
  - Fee deduction against the logical creator (not relayer):
    - `if (marketCreationFee > 0 && creator != admin) vault.deductFees(creator, marketCreationFee, feeRecipient);`
  - Compute `marketId = keccak256(abi.encodePacked(marketSymbol, metricUrl, creator, block.timestamp, block.number));`
  - Deploy Diamond, register, assign, and emit with `creator`.

5) Keep legacy method intact
- Do not modify `createFuturesMarketDiamond(...)`; both paths should coexist.

6) Events and mappings use `creator`
- `marketCreators[marketId] = creator;`
- `emit FuturesMarketCreated(orderBook, marketId, marketSymbol, creator, ...)`.

Security notes:
- Always bind EIP‑712 domain to the Factory (verifyingContract = Factory address).
- Include `chainId` via OZ EIP712 base; rotating Factory address/domain naturally invalidates old signatures.
- Use strict hashing for arrays; never accept raw arrays into the signature without hashing.

---

### Client/Relayer: Signing & Call Pattern

1) Build typed data (client)

```ts
const domain = {
  name: 'DexetraFactory',
  version: '1',
  chainId, // number
  verifyingContract: factoryAddress,
} as const;

const types = {
  MetaCreate: [
    { name: 'marketSymbol', type: 'string' },
    { name: 'metricUrl', type: 'string' },
    { name: 'settlementDate', type: 'uint256' },
    { name: 'startPrice', type: 'uint256' },
    { name: 'dataSource', type: 'string' },
    { name: 'tagsHash', type: 'bytes32' },
    { name: 'diamondOwner', type: 'address' },
    { name: 'cutHash', type: 'bytes32' },
    { name: 'initFacet', type: 'address' },
    { name: 'creator', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

// Client must pre-hash arrays identically to the contract
const tagsHash = keccak256(encodePacked(['string[]'], [tags]));
const cutHash  = hashFacetCuts(cut); // same algorithm as the contract

const message = {
  marketSymbol, metricUrl, settlementDate, startPrice, dataSource,
  tagsHash, diamondOwner, cutHash, initFacet, creator, nonce, deadline,
};

const signature = await walletClient.signTypedData({ domain, types, primaryType: 'MetaCreate', message });
```

2) Relayer call (server)
- Optional: Off‑chain verify the signature and simulate.
- Submit on‑chain:
  - `factory.metaCreateFuturesMarketDiamond(..., creator, nonce, deadline, signature)`

---

### Deployment & Rollout (Factory‑only Redeploy)

1) Redeploy Factory
- Deploy new Factory with the same constructor args (`vault`, `admin`, `feeRecipient`).
- The contract now extends `EIP712` and includes `metaCreateFuturesMarketDiamond`.

2) Re‑grant roles on `CoreVault`
- Grant `FACTORY_ROLE` to the NEW factory.
- Grant `SETTLEMENT_ROLE` to the NEW factory (it seeds start price via `updateMarkPrice`).

3) Update environment variables
- Update `NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS` (client) and server envs.
- Do not redeploy Vault or existing OrderBooks.

4) Frontend/Relayer updates (no UI changes)
- Do not modify the UI. Keep the existing “Create Market” action and API shape.
- In the backend route (e.g., `/api/markets/create`), toggle to meta‑create when `GASLESS_CREATE_ENABLED=true`; otherwise use legacy direct create.
- The backend/relayer builds typed data (`tagsHash`, `cutHash`) and coordinates an EIP‑712 signature using the existing wallet/signing utilities; no new UI elements are introduced.
- On failure or staticcall mismatch, automatically fall back to legacy direct create to preserve UX continuity.

5) Monitoring
- Index `FuturesMarketCreated` and confirm `creator` reflects the signed EOA, not the relayer.
- Alert on `bad sig`, `bad nonce`, and `expired` reverts to support users.

---

### Testing Checklist

- Nonce
  - First call with `nonce = 0` succeeds; replay with same signature reverts (`bad nonce`).
- Deadline
  - Calls after `deadline` revert (`expired`).
- Creator semantics
  - Market fee deducted from `creator` ledger in Vault; balances match expectations.
  - `marketId` uses `creator` in its seed; `marketCreators[marketId] == creator`.
  - Event shows `creator` (not relayer).
- Cut/tags hashing
  - Mismatched client/server hashing yields `bad sig` (expected).
  - Reorder a cut element or selector and ensure signature verification fails.
- Role wiring
  - New Factory can call `registerOrderBook`, `assignMarketToOrderBook`, and `updateMarkPrice` (roles granted).
- Staticcall
  - `staticCall(metaCreate...)` returns successfully when inputs are valid (good preflight).

---

### Gotchas & Recommendations

- Hash dynamic data consistently; pin the hashing method and add unit tests exercising permutations.
- Consider surfacing `metaCreateNonce[creator]` via a view for client UX.
- If you later rotate Factory (redeploy), all prior signatures become invalid automatically via `verifyingContract`.
- Use a feature flag in frontend to toggle gasless create during rollout; default to legacy create if static call fails.

---

### Environment & Configuration (meta‑create)
- Use environment variables; do not hardcode:
  - `GASLESS_CREATE_ENABLED=true` (server) to switch the backend route to meta‑create.
  - `NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS` (client) to point at the new Factory.
  - `EIP712_FACTORY_DOMAIN_NAME`, `EIP712_FACTORY_DOMAIN_VERSION` (optional; defaults can be “DexetraFactory” / “1”).
  - Existing RPC/relayer keys as already used by `/api/markets/create`.
- Follow the existing convention of `.env.local` and project envs; avoid redeploying or altering core contract addresses beyond the Factory replacement.