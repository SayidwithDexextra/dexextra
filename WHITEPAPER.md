# Dexetera White Paper

**Create, and Trade, Community Made Futures Tokens**

---

## Abstract

Dexetera is a decentralized protocol enabling permissionless creation and trading of futures markets for any measurable metric. By combining on-chain orderbook infrastructure with UMA's Optimistic Oracle for trustless settlement, Dexetera removes traditional barriers to derivatives trading—allowing anyone to create a market, anyone to trade, and no one to control the outcome.

---

## 1. Introduction

Traditional derivatives markets are defined by exclusion. Creating a new futures contract requires regulatory approval, exchange partnerships, and significant capital. Trading is often restricted by geography, wealth thresholds, or institutional gatekeeping. Settlement depends on trusted intermediaries who can be slow, opaque, or compromised.

Dexetera inverts this model entirely.

If a metric can be measured, it can be traded. A user in Lagos can create a market on Nigerian inflation data. A trader in São Paulo can take a position on the price of lithium. A developer in Berlin can build a market around their protocol's TVL. No permission required. No intermediary needed.

---

## 2. Core Architecture

### 2.1 On-Chain Orderbook

Unlike automated market makers (AMMs) that rely on liquidity pools and bonding curves, Dexetera uses a true orderbook model deployed on-chain. This provides:

- **Price discovery** — Bid/ask spreads reflect genuine market sentiment
- **Capital efficiency** — No idle liquidity sitting in pools
- **Familiar mechanics** — Limit orders, market orders, and order matching that traders understand
- **Transparency** — Every order, fill, and cancellation is recorded on-chain

The orderbook is implemented using the Diamond pattern (EIP-2535), enabling modular upgrades to individual facets (trading, settlement, admin) without disrupting the entire system.

### 2.2 Market Creation

Any user can deploy a new market through the Market Creation Wizard. The process requires:

1. **Metric Definition** — What is being measured (e.g., "Price of Gold in USD")
2. **Data Source** — Where the settlement value will come from
3. **Settlement Date** — When the market resolves
4. **Initial Parameters** — Trading fees, margin requirements, collateral type

Markets are deployed as individual Diamond contracts, each with their own orderbook and settlement logic. This isolation ensures that issues in one market cannot affect others.

### 2.3 UMA Oracle Integration

Settlement is the critical moment when a futures market converts positions into profit or loss. Dexetera delegates this trust problem to UMA's Optimistic Oracle V3.

**How it works:**

1. At settlement time, a proposer submits the final metric value along with supporting evidence
2. A challenge window opens during which anyone can dispute the proposed value
3. If disputed, the resolution escalates to UMA's Data Verification Mechanism (DVM) where tokenholders vote on the correct answer
4. If undisputed, the proposed value is accepted and settlement proceeds

This mechanism is "optimistic" because it assumes proposals are correct unless challenged. In practice, the economic cost of challenging incorrect proposals (and the reward for successful challenges) creates strong incentives for accurate settlement without requiring constant oracle intervention.

---

## 3. Trading Mechanics

### 3.1 Positions

Traders can take two types of positions:

- **Long** — Profit when the metric value increases
- **Short** — Profit when the metric value decreases

Positions are collateralized with USDC. The margin requirement determines the maximum leverage available.

### 3.2 Order Types

- **Market Orders** — Execute immediately at best available price
- **Limit Orders** — Rest on the orderbook until filled or cancelled

### 3.3 Mark Price

The mark price is calculated from orderbook activity and used for:

- Displaying current market value
- Calculating unrealized P&L
- Determining liquidation thresholds

At settlement, positions are closed at the oracle-verified settlement price, not the mark price.

---

## 4. Settlement & Dispute Resolution

### 4.1 Settlement Flow

```
Market Expiry
     ↓
Proposer submits settlement value + evidence URL
     ↓
Challenge window opens (configurable duration)
     ↓
[No challenge] → Settlement executes at proposed value
     ↓
[Challenge submitted] → Escalates to UMA DVM
     ↓
DVM vote determines final value
     ↓
Settlement executes at DVM-determined value
```

### 4.2 Evidence Requirements

Proposers must provide verifiable evidence supporting their settlement value. This typically includes:

- Screenshot of the data source at settlement time
- Wayback Machine archive URL
- Hash of evidence stored on-chain for immutability

This evidence chain ensures that even months later, anyone can verify that settlement was conducted correctly.

### 4.3 Bonds & Incentives

Both proposers and challengers must post bonds:

- **Proposer bond** — Forfeited if the proposal is successfully challenged
- **Challenger bond** — Forfeited if the challenge fails

These bonds create skin-in-the-game for all participants, discouraging frivolous proposals and baseless challenges alike.

---

## 5. Market Categories

Dexetera supports markets across virtually any measurable domain:

| Category | Examples |
|----------|----------|
| Cryptocurrency | BTC price, ETH gas fees, protocol TVL, token supplies |
| Commodities | Gold, silver, oil, agricultural products |
| Indices | S&P 500, NASDAQ, custom baskets |
| Economics | Inflation rates, GDP growth, unemployment figures |
| Weather | Temperature derivatives, rainfall indices |
| Sports | Player statistics, game outcomes |
| Social | Follower counts, engagement metrics |

The only requirement is that the metric must be objectively measurable at settlement time from a publicly accessible source.

---

## 6. Technical Infrastructure

### 6.1 Smart Contracts

| Component | Function |
|-----------|----------|
| MetricsMarketFactory | Deploys new market contracts |
| DiamondRegistry | Manages facet upgrades across markets |
| CoreVault | Holds collateral and processes settlements |
| OrderRouter | Routes orders and tracks P&L |
| UMAOracleManager | Interfaces with UMA Optimistic Oracle V3 |

### 6.2 Blockchain

Dexetera is deployed on HyperLiquid, chosen for:

- High throughput required for orderbook operations
- Low transaction costs enabling frequent order updates
- EVM compatibility for familiar tooling

### 6.3 Frontend

The trading interface is built with Next.js and React, featuring:

- TradingView charting integration
- Real-time orderbook visualization
- Portfolio management dashboard
- Mobile-responsive design

---

## 7. Economic Model

### 7.1 Fee Structure

- **Trading fees** — Small percentage of notional value, split between protocol and market creator
- **Settlement fees** — Nominal fee to cover oracle costs

### 7.2 Market Creator Incentives

Users who create markets receive a share of trading fees generated by that market. This aligns incentives: creators are rewarded for building markets that attract volume.

---

## 8. Security Considerations

### 8.1 Non-Custodial Design

User funds remain in their wallets until actively used for trading. Collateral is held in the CoreVault contract, not by any centralized party.

### 8.2 Oracle Security

UMA's Optimistic Oracle has secured billions in value across DeFi. The economic security model—where the cost of corrupting the oracle exceeds the potential profit—has proven robust in practice.

### 8.3 Contract Upgradability

The Diamond pattern allows targeted upgrades to specific functionality without requiring migration of funds or positions. Critical functions can be locked to prevent malicious upgrades.

---

## 9. Comparison to Alternatives

| Feature | Dexetera | Traditional Futures | Prediction Markets | Perp DEXs |
|---------|----------|--------------------|--------------------|-----------|
| Permissionless creation | Yes | No | Limited | No |
| Custom metrics | Any measurable | Standardized only | Events only | Crypto only |
| Settlement model | UMA Oracle | Centralized | Centralized | Mark price |
| Trading model | Orderbook | Orderbook | AMM/Orderbook | AMM |
| Non-custodial | Yes | No | Varies | Yes |

---

## 10. Roadmap

**Current State**
- Live on HyperLiquid Mainnet
- UMA Oracle integration complete
- Multiple active markets

**Near Term**
- Expanded market categories
- Automated market making tools
- Enhanced analytics dashboard

**Future**
- Cross-chain deployment
- API for programmatic trading
- Mobile applications

---

## 11. Conclusion

Dexetera represents a fundamental shift in how derivative markets can operate. By removing gatekeepers from market creation, replacing trusted settlement with cryptographic verification, and providing professional-grade trading infrastructure, the protocol enables a new class of financial instruments that simply couldn't exist before.

The question is no longer "who will let me trade this?" but "what do I want to trade?"

---

## Links

- **Website:** [dexetera.org](https://dexetera.org)
- **Application:** [app.dexetera.org](https://app.dexetera.org)
- **Documentation:** [doc.dexetera.org](https://doc.dexetera.org)
- **Twitter:** [@dexeteralabs](https://x.com/dexeteralabs)

---

*This document is for informational purposes only and does not constitute financial advice. Trading derivatives involves significant risk of loss.*
