# Dexetera Contract Migration Guide

> Step-by-step instructions for migrating smart contracts. Designed for both humans and AI agents.

**Network:** HyperLiquid Mainnet (Chain ID: 999)  
**Admin/Deployer:** `0x428d7cBd7feccf01a80dACE3d70b8eCf06451500`

---

## Quick Reference: Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  ┌──────────────┐     creates      ┌──────────────────┐                 │
│  │   Factory    │ ───────────────► │  DiamondRegistry │ (Market)        │
│  │     V2       │                  │   (OrderBook)    │                 │
│  └──────┬───────┘                  └────────┬─────────┘                 │
│         │                                   │                            │
│         │ uses                              │ delegates to               │
│         ▼                                   ▼                            │
│  ┌──────────────┐                  ┌──────────────────┐                 │
│  │    Facet     │ ◄─────────────── │     Facets       │                 │
│  │   Registry   │   looks up       │ (Admin, Trade,   │                 │
│  └──────────────┘                  │  View, etc.)     │                 │
│                                    └──────────────────┘                 │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐            │
│  │  CoreVault   │ ◄── │ BondManager  │     │  FeeRegistry │            │
│  └──────────────┘     └──────────────┘     └──────────────┘            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Table of Contents

1. [CoreVault](#1-corevault)
2. [FuturesMarketFactoryV2](#2-futuresmarketfactoryv2)
3. [FacetRegistry](#3-facetregistry)
4. [MarketBondManager](#4-marketbondmanager)
5. [FeeRegistry](#5-feeregistry)
6. [GlobalSessionRegistry](#6-globalsessionregistry)
7. [Diamond Facets](#7-diamond-facets)
8. [AI Agent Protocol](#ai-agent-protocol)

---

## 1. CoreVault

### Current Address

```
0x8DF1752FbBC364fD4aF7cBA8a1F8B1B345F767f1
```

### Environment Variables

```env
CORE_VAULT_ADDRESS=0x8DF1752FbBC364fD4aF7cBA8a1F8B1B345F767f1
NEXT_PUBLIC_CORE_VAULT_ADDRESS=0x8DF1752FbBC364fD4aF7cBA8a1F8B1B345F767f1
```

### Source File

```
Dexetrav5/src/CoreVault.sol
```

### Constructor

```solidity
constructor(address _collateralToken)
```

- `_collateralToken`: USDC address (`0xec7dEb757C6F77e3F5a4E1906548131752B632b4`)

### Post-Deploy Initialization

```solidity
function initialize(address _admin) external initializer
```

### Roles Defined (this contract defines these roles)


| Role              | Hash                                                                 | Granted To            |
| ----------------- | -------------------------------------------------------------------- | --------------------- |
| `FACTORY_ROLE`    | `0xdfbefbf47cfe66b701d8cfdbce1de81c821590819cb07e71cb01b6602fb0ee27` | Factory, BondManager  |
| `SETTLEMENT_ROLE` | `0x300f9ae985dc711960f7a4d1dd013f9c19ecf40bff149522ab7523b2187a3846` | Factory               |
| `ORDERBOOK_ROLE`  | `0xe7d7e4bf430fa940e5a18beda68ad1833bb0bb84161df1150cd5a705786bf6e7` | Each OrderBook market |


### Dependencies

- **Depends on:** CollateralToken (USDC)
- **Depended on by:** Factory, BondManager, all OrderBooks

### Migration Steps

```bash
# 1. Compile
cd Dexetrav5 && npx hardhat compile
```

```javascript
// 2. Deploy
const CoreVault = await ethers.getContractFactory("CoreVault");
const newVault = await CoreVault.deploy(USDC_ADDRESS);
await newVault.waitForDeployment();
const newVaultAddress = await newVault.getAddress();

// 3. Initialize
await newVault.initialize(adminAddress);

// 4. Grant roles to Factory
const FACTORY_ROLE = await newVault.FACTORY_ROLE();
const SETTLEMENT_ROLE = await newVault.SETTLEMENT_ROLE();
await newVault.grantRole(FACTORY_ROLE, FACTORY_ADDRESS);
await newVault.grantRole(SETTLEMENT_ROLE, FACTORY_ADDRESS);

// 5. Grant role to BondManager
await newVault.grantRole(FACTORY_ROLE, BOND_MANAGER_ADDRESS);

// 6. Grant ORDERBOOK_ROLE to each existing market
const ORDERBOOK_ROLE = await newVault.ORDERBOOK_ROLE();
for (const orderBook of existingOrderBooks) {
    await newVault.grantRole(ORDERBOOK_ROLE, orderBook);
}

// 7. Update dependent contracts
await factory.setVault(newVaultAddress);
// Note: BondManager has immutable vault - must redeploy BondManager
```

### Post-Migration Verification

```javascript
// Verify roles
console.log("Factory FACTORY_ROLE:", await vault.hasRole(FACTORY_ROLE, FACTORY_ADDRESS));
console.log("Factory SETTLEMENT_ROLE:", await vault.hasRole(SETTLEMENT_ROLE, FACTORY_ADDRESS));
console.log("BondManager FACTORY_ROLE:", await vault.hasRole(FACTORY_ROLE, BOND_MANAGER_ADDRESS));
```

### Environment Variables to Update

```env
CORE_VAULT_ADDRESS=<new_address>
NEXT_PUBLIC_CORE_VAULT_ADDRESS=<new_address>
```

---

## 2. FuturesMarketFactoryV2

### Current Address

```
0xFdca656410a8552d58d0437486A19d8cf273f1E8
```

### Environment Variables

```env
FUTURES_MARKET_FACTORY_ADDRESS=0xFdca656410a8552d58d0437486A19d8cf273f1E8
NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS=0xFdca656410a8552d58d0437486A19d8cf273f1E8
```

### Source File

```
Dexetrav5/src/FuturesMarketFactoryV2.sol
```

### Constructor

```solidity
constructor(address _vault, address _admin, address _feeRecipient)
```

- `_vault`: CoreVault address
- `_admin`: Admin address (can create markets, update config)
- `_feeRecipient`: Address receiving market creation fees

### Roles Required (on CoreVault)


| Role              | Why Needed                                       |
| ----------------- | ------------------------------------------------ |
| `FACTORY_ROLE`    | Register orderbooks, assign markets, deduct fees |
| `SETTLEMENT_ROLE` | Set initial mark price via `updateMarkPrice()`   |


### Dependencies

- **Depends on:** CoreVault, FacetRegistry, InitFacet, BondManager
- **Depended on by:** BondManager (stores factory address - **MUST be updated after factory migration**)

> ⚠️ **CRITICAL:** When you redeploy the Factory, you MUST call `bondManager.setFactory(newFactoryAddress)`. The BondManager validates that only the factory can call `onMarketCreate()`. If you forget this step, all market creation will fail with error `OnlyFactory()` (selector `0x0c6d42ae`).

### Configuration Functions

```solidity
function setFacetRegistry(address _facetRegistry) external onlyAdmin
function setInitFacet(address _initFacet) external onlyAdmin
function setBondManager(address newBondManager) external onlyAdmin
function updateMarketCreationFee(uint256 newFee) external onlyAdmin
function updateFeeRecipient(address newFeeRecipient) external onlyAdmin
```

### Migration Steps

```bash
# 1. Compile (IMPORTANT: embeds DiamondRegistry bytecode)
cd Dexetrav5 && npx hardhat compile
```

```javascript
// 2. Deploy
const Factory = await ethers.getContractFactory("FuturesMarketFactoryV2");
const newFactory = await Factory.deploy(
    CORE_VAULT_ADDRESS,
    adminAddress,
    feeRecipientAddress
);
await newFactory.waitForDeployment();
const newFactoryAddress = await newFactory.getAddress();

// 3. Configure
await newFactory.setFacetRegistry(FACET_REGISTRY_ADDRESS);
await newFactory.setInitFacet(ORDER_BOOK_INIT_FACET);
await newFactory.setBondManager(MARKET_BOND_MANAGER_ADDRESS);

// 4. Grant roles on CoreVault
const vault = await ethers.getContractAt("CoreVault", CORE_VAULT_ADDRESS);
const FACTORY_ROLE = await vault.FACTORY_ROLE();
const SETTLEMENT_ROLE = await vault.SETTLEMENT_ROLE();
await vault.grantRole(FACTORY_ROLE, newFactoryAddress);
await vault.grantRole(SETTLEMENT_ROLE, newFactoryAddress);

// 5. ⚠️ CRITICAL: Update BondManager to point to new factory
// The BondManager checks msg.sender == factory in onMarketCreate()
// If you skip this step, market creation will fail with OnlyFactory() error (0x0c6d42ae)
const bondManager = await ethers.getContractAt(
    ["function setFactory(address)", "function factory() view returns (address)"],
    MARKET_BOND_MANAGER_ADDRESS
);
console.log("BondManager current factory:", await bondManager.factory());
await bondManager.setFactory(newFactoryAddress);
console.log("BondManager updated to:", await bondManager.factory());
```

### Post-Migration Verification

```javascript
// Check factory configuration
console.log("vault:", await factory.vault());
console.log("facetRegistry:", await factory.facetRegistry());
console.log("initFacetAddress:", await factory.initFacetAddress());
console.log("bondManager:", await factory.bondManager());
console.log("feeRecipient:", await factory.feeRecipient());

// Check roles on CoreVault
console.log("FACTORY_ROLE:", await vault.hasRole(FACTORY_ROLE, newFactoryAddress));
console.log("SETTLEMENT_ROLE:", await vault.hasRole(SETTLEMENT_ROLE, newFactoryAddress));

// ⚠️ CRITICAL: Verify BondManager points to new factory
const bondManagerFactory = await bondManager.factory();
console.log("BondManager.factory():", bondManagerFactory);
console.log("Matches new factory:", bondManagerFactory.toLowerCase() === newFactoryAddress.toLowerCase());
// Must be TRUE or market creation will fail!
```

### Environment Variables to Update

```env
FUTURES_MARKET_FACTORY_ADDRESS=<new_address>
NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS=<new_address>
```

---

## 3. FacetRegistry

### Current Address

```
0xdcbbD419f642c9b0481384f46E52f660AE8acEc9
```

### Environment Variables

```env
FACET_REGISTRY_ADDRESS=0xdcbbD419f642c9b0481384f46E52f660AE8acEc9
NEXT_PUBLIC_FACET_REGISTRY_ADDRESS=0xdcbbD419f642c9b0481384f46E52f660AE8acEc9
```

### Source File

```
Dexetrav5/src/FacetRegistry.sol
```

### Constructor

```solidity
constructor(address _admin)
```

- `_admin`: Admin who can register/update facets

### Roles Required

None (uses simple admin pattern, not AccessControl)

### Dependencies

- **Depends on:** Nothing
- **Depended on by:** Factory, all DiamondRegistry markets

### Key Functions

```solidity
function registerFacet(address _facet, bytes4[] calldata _selectors) external onlyAdmin
function updateFacets(bytes4[] calldata _selectors, address[] calldata _facets) external onlyAdmin
function removeSelectors(bytes4[] calldata _selectors) external onlyAdmin
```

### Current Registered Facets


| Facet                 | Address                                      |
| --------------------- | -------------------------------------------- |
| OrderBookInitFacet    | `0x6117F19a4e7Fe0a25D0697BC5a47c2FaDb028755` |
| OBAdminFacet          | `0xE10d5EA09f6d9A3E222eD0290cED9Aa7Fa8f2217` |
| OBPricingFacet        | `0x5463C7eE12565dB5840BD97AF77CEB26e0cA6421` |
| OBOrderPlacementFacet | `0x571F319Ebc94b287eF3CE165281405f3fA6ee02f` |
| OBTradeExecutionFacet | `0xF6538aDFd32a37CA36EE9E464F554416150300e0` |
| OBViewFacet           | `0x6d4c893859084b84BAf4094A59470d0DF562B475` |
| OBSettlementFacet     | `0xEFeE5fC9a935f7d1011D95E8d33a763f253bC33d` |
| OBLiquidationFacet    | `0xA82D87f1fbEe7f1BaC4a4Abd96FffA6bE5D18d89` |
| OrderBookVaultFacet   | `0xd9f4a57B2A6faa6cc17E21B93Df5486E98AB7bb9` |
| MetaTradeFacet        | `0x09Cc0b148b971746B0fe6311b503f361d3AD8F11` |
| MarketLifecycleFacet  | `0x84282214a489Fdc65Fb440Ff08d2154A57b85fdb` |


### Migration Steps

```bash
# 1. Compile
cd Dexetrav5 && npx hardhat compile
```

```javascript
// 2. Deploy
const FacetRegistry = await ethers.getContractFactory("FacetRegistry");
const newRegistry = await FacetRegistry.deploy(adminAddress);
await newRegistry.waitForDeployment();
const newRegistryAddress = await newRegistry.getAddress();

// 3. Register all facets (helper function)
async function registerFacet(registry, facetAddress, abi) {
    const iface = new ethers.Interface(abi);
    const selectors = iface.fragments
        .filter(f => f.type === 'function')
        .map(f => iface.getFunction(f.name).selector);
    await registry.registerFacet(facetAddress, selectors);
}

// Register each facet
await registerFacet(newRegistry, OB_ADMIN_FACET, OBAdminFacetABI);
await registerFacet(newRegistry, OB_PRICING_FACET, OBPricingFacetABI);
await registerFacet(newRegistry, OB_ORDER_PLACEMENT_FACET, OBOrderPlacementFacetABI);
await registerFacet(newRegistry, OB_TRADE_EXECUTION_FACET, OBTradeExecutionFacetABI);
await registerFacet(newRegistry, OB_VIEW_FACET, OBViewFacetABI);
await registerFacet(newRegistry, OB_SETTLEMENT_FACET, OBSettlementFacetABI);
await registerFacet(newRegistry, OB_LIQUIDATION_FACET, OBLiquidationFacetABI);
await registerFacet(newRegistry, ORDERBOOK_VAULT_FACET, OrderBookVaultFacetABI);
await registerFacet(newRegistry, META_TRADE_FACET, MetaTradeFacetABI);
await registerFacet(newRegistry, MARKET_LIFECYCLE_FACET, MarketLifecycleFacetABI);

// 4. Update Factory
await factory.setFacetRegistry(newRegistryAddress);
```

### Post-Migration Verification

```javascript
// Check a selector is registered
const selector = "0x..." // any function selector
console.log("Facet for selector:", await registry.getFacet(selector));
console.log("Total selectors:", await registry.selectorCount());
```

### Environment Variables to Update

```env
FACET_REGISTRY_ADDRESS=<new_address>
NEXT_PUBLIC_FACET_REGISTRY_ADDRESS=<new_address>
```

**Note:** Existing V2 markets will continue using the OLD registry. Only new markets use the new one.

---

## 4. MarketBondManager

### Current Address

```
0x1B9Ba95d67a59dE2457565b49bc4917887346Eb9
```

### Environment Variables

```env
MARKET_BOND_MANAGER_ADDRESS=0x1B9Ba95d67a59dE2457565b49bc4917887346Eb9
NEXT_PUBLIC_MARKET_BOND_MANAGER_ADDRESS=0x1B9Ba95d67a59dE2457565b49bc4917887346Eb9
```

### Source File

```
Dexetrav5/src/MarketBondManager.sol
```

### Constructor

```solidity
constructor(
    address _vault,
    address _factory,
    address _owner,
    uint256 _defaultBondAmount,
    uint256 _minBondAmount,
    uint256 _maxBondAmount
)
```

- `_vault`: CoreVault address (immutable)
- `_factory`: Factory address (mutable via `setFactory`)
- `_owner`: Admin address
- `_defaultBondAmount`: Default bond in 6 decimals (e.g., `100000000` = 100 USDC)
- `_minBondAmount`: Minimum bond
- `_maxBondAmount`: Maximum bond (0 = no max)

### Roles Required (on CoreVault)


| Role           | Why Needed                           |
| -------------- | ------------------------------------ |
| `FACTORY_ROLE` | Call `deductFees()` to collect bonds |


### Dependencies

- **Depends on:** CoreVault (immutable), Factory (mutable)
- **Depended on by:** Factory

### Configuration Functions

```solidity
function setFactory(address newFactory) external onlyOwner
function setBondConfig(uint256 _default, uint256 _min, uint256 _max) external onlyOwner
function setPenaltyConfig(uint256 penaltyBps, address recipient) external onlyOwner
```

### Migration Steps

```javascript
// 1. Read existing config
const oldManager = await ethers.getContractAt("MarketBondManager", OLD_ADDRESS);
const defaultBond = await oldManager.defaultBondAmount();
const minBond = await oldManager.minBondAmount();
const maxBond = await oldManager.maxBondAmount();

// 2. Deploy new BondManager
const BondManager = await ethers.getContractFactory("MarketBondManager");
const newManager = await BondManager.deploy(
    CORE_VAULT_ADDRESS,
    FUTURES_MARKET_FACTORY_ADDRESS,
    adminAddress,
    defaultBond,
    minBond,
    maxBond
);
await newManager.waitForDeployment();
const newManagerAddress = await newManager.getAddress();

// 3. Grant FACTORY_ROLE on CoreVault
const vault = await ethers.getContractAt("CoreVault", CORE_VAULT_ADDRESS);
const FACTORY_ROLE = await vault.FACTORY_ROLE();
await vault.grantRole(FACTORY_ROLE, newManagerAddress);

// 4. Update Factory to point to new BondManager
await factory.setBondManager(newManagerAddress);
```

### Post-Migration Verification

```javascript
// Check config
console.log("factory:", await newManager.factory());
console.log("vault:", await newManager.vault());
console.log("defaultBondAmount:", await newManager.defaultBondAmount());

// Check role
console.log("FACTORY_ROLE:", await vault.hasRole(FACTORY_ROLE, newManagerAddress));

// Check factory points to new manager
console.log("factory.bondManager:", await factory.bondManager());
```

### Environment Variables to Update

```env
MARKET_BOND_MANAGER_ADDRESS=<new_address>
NEXT_PUBLIC_MARKET_BOND_MANAGER_ADDRESS=<new_address>
```

---

## 5. FeeRegistry

### Current Address

```
0xC4c59c4f5892Bf88F0D3A0374562770d191F78bF
```

### Environment Variables

```env
FEE_REGISTRY_ADDRESS=0xC4c59c4f5892Bf88F0D3A0374562770d191F78bF
NEXT_PUBLIC_FEE_REGISTRY_ADDRESS=0xC4c59c4f5892Bf88F0D3A0374562770d191F78bF
```

### Source File

```
Dexetrav5/src/FeeRegistry.sol
```

### Constructor

```solidity
constructor(
    address _admin,
    uint256 _takerFeeBps,
    uint256 _makerFeeBps,
    address _protocolFeeRecipient,
    uint256 _protocolFeeShareBps
)
```

- `_admin`: Admin address
- `_takerFeeBps`: Taker fee in basis points (e.g., 7 = 0.07%)
- `_makerFeeBps`: Maker fee in basis points (e.g., 3 = 0.03%)
- `_protocolFeeRecipient`: Address receiving protocol fees
- `_protocolFeeShareBps`: Protocol share (e.g., 8000 = 80%)

### Roles Required

None (uses simple admin pattern)

### Dependencies

- **Depends on:** Nothing
- **Depended on by:** Configure API route (reads fees for new markets)

### Configuration Functions

```solidity
function setFees(uint256 _takerFeeBps, uint256 _makerFeeBps) external onlyAdmin
function setProtocolFeeRecipient(address _recipient) external onlyAdmin
function setProtocolFeeShareBps(uint256 _shareBps) external onlyAdmin
```

### Migration Steps

```javascript
// 1. Deploy new FeeRegistry
const FeeRegistry = await ethers.getContractFactory("FeeRegistry");
const newRegistry = await FeeRegistry.deploy(
    adminAddress,
    7,      // takerFeeBps (0.07%)
    3,      // makerFeeBps (0.03%)
    protocolFeeRecipient,
    8000    // protocolFeeShareBps (80%)
);
await newRegistry.waitForDeployment();
const newRegistryAddress = await newRegistry.getAddress();
```

### Post-Migration Verification

```javascript
console.log("takerFeeBps:", await registry.takerFeeBps());
console.log("makerFeeBps:", await registry.makerFeeBps());
console.log("protocolFeeRecipient:", await registry.protocolFeeRecipient());
console.log("protocolFeeShareBps:", await registry.protocolFeeShareBps());
```

### Environment Variables to Update

```env
FEE_REGISTRY_ADDRESS=<new_address>
NEXT_PUBLIC_FEE_REGISTRY_ADDRESS=<new_address>
```

---

## 6. GlobalSessionRegistry

### Current Address

```
0xFad7D190180fd4c7910602D2A7bCCC715bf8454D
```

### Environment Variables

```env
SESSION_REGISTRY_ADDRESS=0xFad7D190180fd4c7910602D2A7bCCC715bf8454D
NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS=0xFad7D190180fd4c7910602D2A7bCCC715bf8454D
```

### Source File

```
Dexetrav5/src/diamond/GlobalSessionRegistry.sol
```

### Constructor

```solidity
constructor(address initialOwner)
```

- `initialOwner`: Owner address (Ownable pattern)

### Roles Required

None (uses Ownable pattern)

### Dependencies

- **Depends on:** Nothing
- **Depended on by:** Markets (MetaTradeFacet uses this for session validation)

### Key Functions

```solidity
function setAllowedOrderbook(address orderbook, bool allowed) external onlyOwner
```

### Migration Steps

```javascript
// 1. Deploy new SessionRegistry
const Registry = await ethers.getContractFactory("GlobalSessionRegistry");
const newRegistry = await Registry.deploy(adminAddress);
await newRegistry.waitForDeployment();
const newRegistryAddress = await newRegistry.getAddress();

// 2. Allow all existing orderbooks
for (const orderBook of existingOrderBooks) {
    await newRegistry.setAllowedOrderbook(orderBook, true);
}
```

### Post-Migration Verification

```javascript
// Check an orderbook is allowed
console.log("Orderbook allowed:", await registry.allowedOrderbook(orderBookAddress));
```

### Environment Variables to Update

```env
SESSION_REGISTRY_ADDRESS=<new_address>
NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS=<new_address>
```

---

## 7. Diamond Facets

### Facet Upgrade (Single Transaction for ALL V2 Markets!)

The FacetRegistry pattern allows upgrading all V2 markets with a single transaction.

### Current Facet Addresses


| Facet                 | Address                                      | Env Variable               |
| --------------------- | -------------------------------------------- | -------------------------- |
| OrderBookInitFacet    | `0x6117F19a4e7Fe0a25D0697BC5a47c2FaDb028755` | `ORDER_BOOK_INIT_FACET`    |
| OBAdminFacet          | `0xE10d5EA09f6d9A3E222eD0290cED9Aa7Fa8f2217` | `OB_ADMIN_FACET`           |
| OBPricingFacet        | `0x5463C7eE12565dB5840BD97AF77CEB26e0cA6421` | `OB_PRICING_FACET`         |
| OBOrderPlacementFacet | `0x571F319Ebc94b287eF3CE165281405f3fA6ee02f` | `OB_ORDER_PLACEMENT_FACET` |
| OBTradeExecutionFacet | `0xF6538aDFd32a37CA36EE9E464F554416150300e0` | `OB_TRADE_EXECUTION_FACET` |
| OBViewFacet           | `0x6d4c893859084b84BAf4094A59470d0DF562B475` | `OB_VIEW_FACET`            |
| OBSettlementFacet     | `0xEFeE5fC9a935f7d1011D95E8d33a763f253bC33d` | `OB_SETTLEMENT_FACET`      |
| OBLiquidationFacet    | `0xA82D87f1fbEe7f1BaC4a4Abd96FffA6bE5D18d89` | `OB_LIQUIDATION_FACET`     |
| OrderBookVaultFacet   | `0xd9f4a57B2A6faa6cc17E21B93Df5486E98AB7bb9` | `ORDERBOOK_VAULT_FACET`    |
| MetaTradeFacet        | `0x09Cc0b148b971746B0fe6311b503f361d3AD8F11` | `META_TRADE_FACET`         |
| MarketLifecycleFacet  | `0x84282214a489Fdc65Fb440Ff08d2154A57b85fdb` | `MARKET_LIFECYCLE_FACET`   |


### Facet Source Files

```
Dexetrav5/src/diamond/facets/
├── OrderBookInit.sol
├── OBAdminFacet.sol
├── OBPricingFacet.sol
├── OBOrderPlacementFacet.sol
├── OBTradeExecutionFacet.sol
├── OBViewFacet.sol
├── OBSettlementFacet.sol
├── OBLiquidationFacet.sol
├── OrderBookVaultAdminFacet.sol
├── MetaTradeFacet.sol
└── MarketLifecycleFacet.sol
```

### Facet Upgrade Steps

```bash
# 1. Compile
cd Dexetrav5 && npx hardhat compile
```

```javascript
// 2. Deploy new facet
const NewFacet = await ethers.getContractFactory("OBAdminFacet"); // example
const newFacet = await NewFacet.deploy();
await newFacet.waitForDeployment();
const newFacetAddress = await newFacet.getAddress();

// 3. Extract selectors from ABI
const iface = new ethers.Interface(NewFacetABI);
const selectors = iface.fragments
    .filter(f => f.type === 'function')
    .map(f => iface.getFunction(f.name).selector);

// 4. Update FacetRegistry (ONE TRANSACTION - upgrades ALL V2 markets!)
const registry = await ethers.getContractAt("FacetRegistry", FACET_REGISTRY_ADDRESS);
await registry.registerFacet(newFacetAddress, selectors);
```

### Post-Upgrade Verification

```javascript
// Check a selector points to new facet
const selector = selectors[0];
console.log("Facet for selector:", await registry.getFacet(selector));
// Should show new facet address
```

### Environment Variables to Update

```env
OB_<FACET_NAME>_FACET=<new_address>
NEXT_PUBLIC_OB_<FACET_NAME>_FACET=<new_address>
```

---

## AI Agent Protocol

### When asked to migrate a contract, follow this checklist:

```
□ STEP 1: Identify the contract from sections 1-7 above
□ STEP 2: Check "Dependencies" - what needs to be updated after?
□ STEP 3: Check "Roles Required" - what roles need granting?
□ STEP 4: Run "Migration Steps" in order
□ STEP 5: Run "Post-Migration Verification"
□ STEP 6: Update environment variables
□ STEP 7: Remind user to restart dev server and update Vercel
```

### Factory Migration Special Steps

When migrating `FuturesMarketFactoryV2`, you MUST complete these additional steps:

```
□ Grant FACTORY_ROLE on CoreVault to new factory
□ Grant SETTLEMENT_ROLE on CoreVault to new factory  
□ ⚠️ Call bondManager.setFactory(newFactoryAddress) — CRITICAL!
□ Verify bondManager.factory() returns new factory address
```

**If you skip the BondManager update, ALL market creation will fail with `OnlyFactory()` error.**

### Common Errors


| Error                              | Selector     | Cause                                               | Fix                                                  |
| ---------------------------------- | ------------ | --------------------------------------------------- | ---------------------------------------------------- |
| `OnlyFactory()`                    | `0x0c6d42ae` | BondManager.factory ≠ calling factory               | `bondManager.setFactory(newFactoryAddress)`          |
| `AccessControlUnauthorizedAccount` | `0xe2517d3f` | Missing role on CoreVault                           | `vault.grantRole(role, account)`                     |
| `NotContractOwner`                 | LibDiamond   | DiamondRegistry owner not set in LibDiamond storage | Redeploy factory (fixes DiamondRegistry constructor) |
| `FunctionDoesNotExist`             | `0xa9ad62f8` | Selector not in FacetRegistry                       | `registry.registerFacet(addr, selectors)`            |
| `BadNonce`                         | `0x4bd574ec` | Wrong nonce in meta-transaction                     | Check `factory.metaCreateNonce(creator)`             |
| `BadSignature`                     | `0x5cd5d233` | EIP-712 signature mismatch                          | Verify domain, types, and message match              |


#### Debugging `OnlyFactory()` (0x0c6d42ae)

This error occurs when the Factory calls `bondManager.onMarketCreate()` but the BondManager's stored `factory` address doesn't match. **This is the #1 error after redeploying the Factory.**

```javascript
// Check what factory the BondManager expects
const bondManager = await ethers.getContractAt(
    ["function factory() view returns (address)"],
    BOND_MANAGER_ADDRESS
);
console.log("BondManager expects factory:", await bondManager.factory());
console.log("Actual factory calling:", FUTURES_MARKET_FACTORY_ADDRESS);

// Fix: Update BondManager to point to new factory
await bondManager.setFactory(NEW_FACTORY_ADDRESS);
```

### Quick Role Grant Reference

```javascript
const vault = await ethers.getContractAt("CoreVault", CORE_VAULT_ADDRESS);

// Get role hashes
const FACTORY_ROLE = await vault.FACTORY_ROLE();
const SETTLEMENT_ROLE = await vault.SETTLEMENT_ROLE();
const ORDERBOOK_ROLE = await vault.ORDERBOOK_ROLE();

// Factory needs both
await vault.grantRole(FACTORY_ROLE, factoryAddress);
await vault.grantRole(SETTLEMENT_ROLE, factoryAddress);

// BondManager needs FACTORY_ROLE
await vault.grantRole(FACTORY_ROLE, bondManagerAddress);

// Each OrderBook needs ORDERBOOK_ROLE (done automatically on market creation)
await vault.grantRole(ORDERBOOK_ROLE, orderBookAddress);
```

---

## Version History


| Date       | Version | Changes               |
| ---------- | ------- | --------------------- |
| 2026-04-17 | 1.0.0   | Initial documentation |


---

*Last updated: April 17, 2026*