# DexContractsV2 Fullstack Integration Guide for Dexetra

## Overview
This guide provides a step-by-step, in-depth roadmap for integrating the new DexContractsV2 smart contract system into the existing Dexetra platform. It covers all required changes to both frontend and backend, migration strategies, and best practices for a seamless transition.

---

## Table of Contents
1. [Architecture Recap](#architecture-recap)
2. [Backend Integration](#backend-integration)
    - [Environment Variables & Deployment](#environment-variables--deployment)
    - [Contract Bindings & ABIs](#contract-bindings--abis)
    - [Service Layer Refactoring](#service-layer-refactoring)
    - [Event Listeners & Indexers](#event-listeners--indexers)
    - [Database Schema Updates](#database-schema-updates)
    - [API Layer Changes](#api-layer-changes)
3. [Frontend Integration](#frontend-integration)
    - [Config & Provider Setup](#config--provider-setup)
    - [Hooks & SDK Updates](#hooks--sdk-updates)
    - [TradingPanel Refactor](#tradingpanel-refactor)
    - [Portfolio & Analytics](#portfolio--analytics)
    - [Limit Order UI](#limit-order-ui)
    - [Market Creation & Management](#market-creation--management)
    - [Error Handling & UX](#error-handling--ux)
4. [Migration & Data Consistency](#migration--data-consistency)
5. [Testing & QA](#testing--qa)
6. [Deployment & Monitoring](#deployment--monitoring)
7. [Best Practices & Gotchas](#best-practices--gotchas)

---

## Architecture Recap
- **Factory-based VAMM deployment**: All markets are now deployed via `MetricVAMMFactory`.
- **CentralizedVault**: All collateral and margin is managed in a single vault contract.
- **MetricVAMMRouter**: Unified interface for all trading, portfolio, and limit order operations.
- **Limit Order System**: Advanced order types and Chainlink Automation for execution.
- **MetricRegistry**: All metrics must be registered and validated here.

---

## Backend Integration

### 1. Environment Variables & Deployment
- Update `.env` and deployment scripts to include all new contract addresses:
  - `FACTORY_ADDRESS`, `VAULT_ADDRESS`, `ROUTER_ADDRESS`, `LIMIT_ORDER_MANAGER`, `AUTOMATION_FUNDING`, `LIMIT_ORDER_KEEPER`, `USDC_ADDRESS`, etc.
- Use the output from `deployFactorySystem.js` and `deployLimitOrderSystem.js`.
- Ensure all scripts and services reference these variables, not hardcoded addresses.

### 2. Contract Bindings & ABIs
- Regenerate TypeScript/JavaScript contract bindings using `typechain` or `ethers` for all new contracts:
  - `MetricVAMMFactory`, `CentralizedVault`, `MetricVAMMRouter`, `SpecializedMetricVAMM`, `MetricLimitOrderManager`, `AutomationFundingManager`, `MetricLimitOrderKeeper`, `MetricRegistry`.
- Place ABIs in a central location (e.g., `src/abis/`).
- Update all backend services to use the new ABIs and contract addresses.

### 3. Service Layer Refactoring
- Refactor all blockchain interaction services to use the new router and vault contracts:
  - **Collateral**: All deposits/withdrawals go through `CentralizedVault` (or via router for unified UX).
  - **Trading**: All position opens/closes/adds go through `MetricVAMMRouter`.
  - **Market Creation**: Use `MetricVAMMFactory` for new markets.
  - **Limit Orders**: Integrate `MetricLimitOrderManager` for order creation, cancellation, and querying.
- Remove or refactor any legacy direct VAMM or Vault contract calls.

### 4. Event Listeners & Indexers
- Update event listeners to subscribe to new contract events:
  - `CollateralDeposited`, `CollateralWithdrawn`, `MetricPositionOpened`, `MetricPositionClosed`, `LimitOrderCreated`, `LimitOrderExecuted`, etc.
- Update backend indexers to parse and store new event data structures.
- Ensure all analytics and notification systems are updated to use new event sources.

### 5. Database Schema Updates
- Update DB schemas to reflect new position, order, and market structures:
  - Add support for new position types, order types, and metric categories.
  - Store limit order data, including status, expiry, and execution details.
  - Track cross-VAMM portfolio data for unified analytics.


### 6. API Layer Changes
- Update all API endpoints to use new contract methods and data models:
  - `/api/portfolio` → Use `MetricVAMMRouter.getPortfolioDashboard()`
  - `/api/positions` → Aggregate via router, not individual VAMMs
  - `/api/limit-orders` → Integrate with `MetricLimitOrderManager`
  - `/api/markets` → Use factory and registry for market discovery
- Ensure all endpoints return new data structures and handle new error cases.

---

## Frontend Integration

### 1. Config & Provider Setup
- Update frontend config to use new contract addresses from `.env.local`.
- Ensure ethers/web3 providers are initialized with the correct ABIs and addresses.
- Remove legacy contract references from config files.

### 2. Hooks & SDK Updates
- Refactor all custom hooks to use new contract APIs:
  - `useVAMMTrading` → Route all trading through `MetricVAMMRouter`
  - `usePortfolio` → Use `getPortfolioDashboard` for unified view
  - `useLimitOrders` → Integrate with `MetricLimitOrderManager` for all order actions
  - `useMarkets` → Use factory and registry for market discovery
- Update all hook return types and error handling to match new contract responses.

### 3. TradingPanel Refactor
- Update `TradingPanel.tsx` to:
  - Use router for all trading actions (open, close, add to position)
  - Support both market and limit orders (with new UI for order type selection)
  - Display unified margin, collateral, and PnL using vault and router data
  - Integrate approval and deposit flows with new vault logic
- Remove any direct VAMM or legacy vault calls.

### 4. Portfolio & Analytics
- Refactor portfolio pages to use `getPortfolioDashboard` for cross-market analytics.
- Update all charts, tables, and summaries to reflect new position and order structures.
- Add support for new metrics, categories, and position types.

### 5. Limit Order UI
- Add/Update limit order management UI:
  - Create/Cancel limit orders via `MetricLimitOrderManager`
  - Display active, executed, and cancelled orders
  - Show order status, expiry, and execution details
  - Integrate with Chainlink Automation status (show if automation is funded/active)
- Add a dedicated `/limit-orders` page for advanced management.

### 6. Market Creation & Management
- Update market creation flows to use `MetricVAMMFactory` and `MetricRegistry`.
- Allow users/admins to deploy new VAMMs and register new metrics.
- Display available templates and categories for new markets.

### 7. Error Handling & UX
- Update all error messages to reflect new contract error strings.
- Add user guidance for new flows (e.g., why a metric might not be tradeable, why a limit order failed, etc.)
- Ensure all transaction states (pending, success, error) are handled for new contract calls.

---

## Migration & Data Consistency
- Migrate all user positions and orders to new contract structures:
  - Provide migration scripts for closing old positions and opening equivalent new ones
  - Migrate collateral balances to `CentralizedVault`
- Archive legacy data for reference, but ensure all new activity uses DexContractsV2
- Communicate migration plan and downtime (if any) to users

---

## Testing & QA
- Write comprehensive unit and integration tests for all new contract interactions
- Test all new event listeners and indexers
- Perform end-to-end tests for trading, order management, and portfolio analytics
- Test edge cases: liquidation, order expiry, automation failures, etc.
- Use testnets for full dry runs before mainnet deployment

---

## Deployment & Monitoring
- Deploy all contracts using provided scripts
- Update all environment variables and config files
- Monitor contract events, Chainlink Automation status, and system health
- Set up alerting for low LINK balance, failed upkeeps, and contract errors
- Regularly review analytics and user feedback for issues

---

## Best Practices & Gotchas
- **Always use the router and vault for all user-facing actions**; never interact directly with VAMMs or legacy contracts
- **Keep ABIs and addresses in sync** between backend and frontend
- **Handle all new error messages** and edge cases in the UI
- **Test automation flows** (limit order execution) thoroughly before enabling for users
- **Document all new flows** for support and future development
- **Monitor Chainlink Automation funding** to avoid order execution failures

---

## Reference
- [FACTORY_SYSTEM_GUIDE.md](../FACTORY_SYSTEM_GUIDE.md)
- [LIMIT_ORDER_SYSTEM.md](../LIMIT_ORDER_SYSTEM.md)
- [doc.md](../doc.md)

---

**This guide should be used as the master reference for all Dexetra fullstack integration work with DexContractsV2.** 