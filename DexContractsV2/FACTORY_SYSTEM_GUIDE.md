# DexContractsV2 Factory-Based System Guide

## 🏗️ Architecture Overview

The DexContractsV2 factory-based system provides a scalable, modular architecture for creating specialized metric trading environments while maintaining unified collateral management.

### Key Components

```
┌─────────────────────────────────────────────────────────────┐
│                    MetricVAMMRouter                         │
│                 (Unified Interface)                         │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                CentralizedVault                             │
│              (Unified Collateral)                          │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│               MetricVAMMFactory                             │
│             (VAMM Deployment)                               │
└─────┬─────────────┬─────────────┬─────────────┬─────────────┘
      │             │             │             │
┌─────▼──────┐ ┌────▼──────┐ ┌────▼──────┐ ┌────▼──────┐
│Population  │ │ Weather   │ │ Economic  │ │  Sports   │
│   VAMM     │ │   VAMM    │ │   VAMM    │ │   VAMM    │
└────────────┘ └───────────┘ └───────────┘ └───────────┘
```

### Benefits

1. **📊 Specialized Trading**: Different VAMMs optimized for metric categories
2. **💰 Unified Collateral**: Single deposit works across all VAMMs
3. **🔧 Configurable Templates**: Easy deployment with preset parameters
4. **🛡️ Risk Isolation**: Category-specific risk management
5. **📈 Scalable**: Add new categories without affecting existing ones

---

## 🚀 Quick Start

### 1. Deployment

```bash
# Deploy the complete system
npx hardhat run scripts/deployFactorySystem.js --network localhost
```

### 2. Basic Usage

```javascript
// Get contract instances
const router = await ethers.getContractAt("MetricVAMMRouter", ROUTER_ADDRESS);
const vault = await ethers.getContractAt("CentralizedVault", VAULT_ADDRESS);

// Deposit collateral (works across all VAMMs)
await vault.depositCollateral(ethers.utils.parseUnits("1000", 6)); // $1000 USDC

// Open position on any metric via router
await router.openPosition(
    metricId,           // bytes32: metric to trade
    100e6,              // uint256: $100 collateral
    true,               // bool: long position
    10,                 // uint256: 10x leverage
    0,                  // uint256: target value (for predictions)
    0,                  // PositionType: CONTINUOUS
    0,                  // uint256: min price
    MAX_UINT256         // uint256: max price
);
```

---

## 🏭 Factory System Deep Dive

### MetricVAMMFactory

The factory manages deployment and configuration of specialized VAMMs.

#### VAMM Templates

**Pre-configured templates for different risk profiles:**

```solidity
// Conservative (Economic metrics, population data)
Template {
    maxLeverage: 20,
    tradingFeeRate: 50,      // 0.5%
    liquidationFeeRate: 500, // 5%
    maintenanceMarginRatio: 500, // 5%
    initialReserves: 10000e18,
    volumeScaleFactor: 1000
}

// Standard (General metrics)
Template {
    maxLeverage: 50,
    tradingFeeRate: 30,      // 0.3%
    liquidationFeeRate: 500, // 5%
    maintenanceMarginRatio: 500, // 5%
    initialReserves: 10000e18,
    volumeScaleFactor: 1000
}

// Aggressive (Weather, sports, volatile metrics)
Template {
    maxLeverage: 100,
    tradingFeeRate: 20,      // 0.2%
    liquidationFeeRate: 500, // 5%
    maintenanceMarginRatio: 800, // 8%
    initialReserves: 50000e18,
    volumeScaleFactor: 500
}
```

#### Deploying New VAMMs

```javascript
// Deploy using preset template
const deployTx = await factory.deploySpecializedVAMM(
    "Weather Metrics",                    // category
    [temperatureMetricId, rainfallMetricId], // allowed metrics
    "aggressive",                         // template name
    { value: ethers.utils.parseEther("0.1") } // deployment fee
);

// Deploy with custom template
const customTemplate = {
    maxLeverage: 25,
    tradingFeeRate: 40,
    liquidationFeeRate: 600,
    maintenanceMarginRatio: 600,
    initialReserves: ethers.utils.parseEther("20000"),
    volumeScaleFactor: 800,
    isActive: true,
    description: "Custom template for crypto metrics"
};

const customTx = await factory.deployCustomVAMM(
    "Crypto Metrics",
    [btcPriceMetricId, ethPriceMetricId],
    customTemplate,
    { value: ethers.utils.parseEther("0.15") } // deployment + custom fee
);
```

### CentralizedVault

Single vault manages collateral across all VAMMs with cross-platform risk management.

```javascript
// Check global portfolio health
const portfolio = await vault.getPortfolioSummary(userAddress);
console.log({
    totalCollateral: portfolio.totalCollateral,
    availableMargin: portfolio.availableMargin,
    unrealizedPnL: portfolio.unrealizedPnL,
    marginRatio: portfolio.marginRatio,
    activeVAMMs: portfolio.activeVAMMs
});

// Global liquidation check
const [atRisk, totalExposure, marginRatio, riskiestVAMMs] = 
    await vault.checkLiquidationRisk(userAddress);

if (atRisk) {
    console.log("User at liquidation risk!");
    console.log("Riskiest VAMMs:", riskiestVAMMs);
}
```

### MetricVAMMRouter

Unified interface for interacting with all VAMMs.

```javascript
// Single interface for all operations
const router = await ethers.getContractAt("MetricVAMMRouter", routerAddress);

// Router automatically finds correct VAMM for metric
const positionId = await router.openPosition(
    worldPopulationMetricId, // Router finds Population VAMM
    100e6,                   // $100 collateral
    true,                    // long
    10,                      // 10x leverage
    0, 0, 0, MAX_UINT256    // other params
);

// Portfolio dashboard across all VAMMs
const dashboard = await router.getPortfolioDashboard(userAddress);
console.log("Positions across all VAMMs:", dashboard.positions.length);
console.log("Total unrealized PnL:", dashboard.totalUnrealizedPnL);

// Batch operations
await router.batchClosePositions(
    [vamm1, vamm2, vamm3],           // VAMM addresses
    [pos1, pos2, pos3],              // position IDs
    [100e6, 200e6, 150e6],           // sizes to close
    [0, 0, 0],                       // min prices
    [MAX_UINT256, MAX_UINT256, MAX_UINT256] // max prices
);
```

---

## 💡 Use Cases & Examples

### 1. Multi-Category Trading

```javascript
// User deposits once, trades everywhere
await vault.depositCollateral(ethers.utils.parseUnits("5000", 6)); // $5000

// Trade population growth (conservative VAMM)
await router.openPosition(worldPopMetricId, 1000e6, true, 5, 0, 0, 0, MAX_UINT256);

// Trade temperature volatility (aggressive VAMM)
await router.openPosition(tempMetricId, 500e6, false, 20, 0, 0, 0, MAX_UINT256);

// Trade GDP growth (standard VAMM)
await router.openPosition(gdpMetricId, 800e6, true, 10, 0, 0, 0, MAX_UINT256);

// All positions share the same $5000 collateral pool
```

### 2. Risk-Adjusted Portfolio

```javascript
// Conservative allocation: 60% economic, 30% population, 10% weather
const availableMargin = await vault.getAvailableMargin(userAddress);

// Economic metrics (conservative)
await router.openPosition(
    gdpMetricId, 
    availableMargin * 0.6, 
    true, 5, 0, 0, 0, MAX_UINT256
);

// Population metrics (moderate)
await router.openPosition(
    populationMetricId, 
    availableMargin * 0.3, 
    true, 10, 0, 0, 0, MAX_UINT256
);

// Weather metrics (aggressive)
await router.openPosition(
    temperatureMetricId, 
    availableMargin * 0.1, 
    false, 25, 0, 0, 0, MAX_UINT256
);
```

### 3. Cross-VAMM Analytics

```javascript
// Compare opportunities across categories
const populations = await router.getMetricPriceComparison(worldPopMetricId);
const weather = await router.getMetricPriceComparison(tempMetricId);
const economic = await router.getMetricPriceComparison(gdpMetricId);

console.log("Price comparison:");
console.log("Population:", populations.currentPrice, "Funding:", populations.fundingRate);
console.log("Weather:", weather.currentPrice, "Funding:", weather.fundingRate);
console.log("Economic:", economic.currentPrice, "Funding:", economic.fundingRate);

// Get optimal position sizing
const [collateral, size, risk] = await router.getOptimalPositionSize(
    userAddress,
    temperatureMetricId,
    500,  // 5% portfolio risk
    20    // 20x leverage
);
console.log(`Recommended: $${collateral/1e6} collateral for $${size/1e6} position (${risk/100}% risk)`);
```

---

## 🔧 Advanced Configuration

### Creating Custom Templates

```javascript
// Create specialized template for your metric category
await factory.createTemplate(
    "DeFi Metrics",                // template name
    75,                           // max leverage
    25,                           // 0.25% trading fee
    500,                          // 5% liquidation fee
    700,                          // 7% maintenance margin
    ethers.utils.parseEther("30000"), // initial reserves
    600,                          // volume scale factor
    "Optimized for DeFi protocol metrics"
);
```

### Permission Management

```javascript
// Factory owner functions
await factory.setAuthorizedDeployer(deployerAddress, true);
await factory.setDeploymentFee(ethers.utils.parseEther("0.2"));
await factory.pause(); // Emergency stop

// Vault owner functions
await vault.pause(); // Emergency stop
await vault.setFactory(newFactoryAddress); // Upgrade factory
```

---

## 📊 Monitoring & Analytics

### Global System Health

```javascript
// Factory stats
const totalVAMMs = await factory.getTotalVAMMs();
const activeVAMMs = await factory.getActiveVAMMs();
const categories = await factory.getAllCategories();

// Vault metrics
const globalMetrics = await vault.getGlobalRiskMetrics();
console.log({
    totalTVL: globalMetrics.totalCollateral,
    utilization: globalMetrics.utilizationRatio,
    activeUsers: globalMetrics.activeUsers,
    totalPnL: globalMetrics.totalUnrealizedPnL
});

// Router analytics
const routerStats = await router.getRouterStats();
console.log({
    totalVolume: routerStats.totalVolume,
    totalFees: routerStats.totalFees,
    activeVAMMs: routerStats.totalVAMMs
});
```

### User Analytics

```javascript
// Individual user metrics
const userStats = await router.getUserRouterStats(userAddress);
const portfolio = await router.getPortfolioDashboard(userAddress);

console.log("User Trading Profile:");
console.log("Total Volume:", userStats.userVolume);
console.log("Active Positions:", userStats.totalPositions);
console.log("VAMMs Used:", userStats.activeVAMMs);
console.log("Portfolio Value:", portfolio.totalCollateral);
console.log("Available Margin:", portfolio.availableMargin);
```

---

## ⚠️ Important Considerations

### Risk Management

1. **Cross-VAMM Exposure**: Positions across multiple VAMMs share collateral
2. **Category Risk**: Volatile categories (weather) may require higher margin
3. **Liquidity Risk**: New VAMMs may have lower liquidity initially
4. **Settlement Risk**: Different metrics have different settlement mechanisms

### Best Practices

1. **Diversification**: Spread risk across multiple categories
2. **Position Sizing**: Use router's optimal sizing recommendations
3. **Monitoring**: Regularly check global portfolio health
4. **Liquidation**: Monitor cross-VAMM liquidation risk

### Integration Tips

1. **Frontend**: Use router as single integration point
2. **Risk Management**: Implement client-side portfolio monitoring
3. **Gas Optimization**: Use batch operations for multiple actions
4. **Error Handling**: Handle VAMM-specific errors gracefully

---

## 🔄 Migration from V1

If migrating from the original MetricVAMM:

```javascript
// 1. Deploy new factory system
// 2. Migrate user positions (manual process)
// 3. Update frontend to use router
// 4. Deprecate old contracts

// Example migration helper
async function migrateUserPositions(oldVAMM, user) {
    const positions = await oldVAMM.getUserPositions(user);
    
    for (const position of positions) {
        // Close old position
        await oldVAMM.closePosition(position.id, position.size, 0, MAX_UINT256);
        
        // Open equivalent position in new system
        await router.openPosition(
            position.metricId,
            position.collateral,
            position.isLong,
            position.leverage,
            position.targetValue,
            position.positionType,
            0, MAX_UINT256
        );
    }
}
```

---

## 🚀 Next Steps

1. **Production Deployment**: Use deployment script for mainnet
2. **Frontend Integration**: Build UI using router interface
3. **Monitoring Setup**: Implement analytics dashboard
4. **Community**: Allow community to deploy custom VAMMs
5. **Governance**: Implement DAO for factory parameters

The factory-based system provides the foundation for a scalable, modular derivatives platform that can grow with your ecosystem while maintaining unified user experience and risk management. 