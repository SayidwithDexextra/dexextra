# DexContractsMaybe: Traditional Futures Market System 📊

A simplified, high-sensitivity traditional futures market built for testing and development. Unlike bonding curve systems, this implements **true futures market behavior** where both longs and shorts affect price equally.

## 🎯 Key Features

### ✅ **Traditional Futures Behavior**
- **Both longs and shorts affect price equally** 
- **Net position determines price direction** (net long = price up, net short = price down)
- **Balanced bilateral trading** like real futures markets

### ⚡ **High Price Sensitivity**
- **100x smaller base reserves** (100 vs 10,000 in legacy)
- **20x more sensitive volume scaling** (50 vs 1000 scale factor)
- **10x impact divisor** for immediate price response
- **Easy to achieve 25%+ price movements** with moderate position sizes

### 🧹 **Simplified for Testing**
- **No allowance checks** on token transfers
- **Minimal authorization** requirements
- **No funding rate complexity**
- **No liquidation mechanisms**
- **Streamlined error handling**

## 📁 Architecture

```
DexContractsMaybe/
├── contracts/
│   ├── ISimplePriceOracle.sol     # Price oracle interface
│   ├── ISimpleVault.sol           # Vault interface
│   ├── ISimpleVAMM.sol            # VAMM interface
│   ├── SimplePriceOracle.sol      # Simple price oracle
│   ├── SimpleUSDC.sol             # Testing USDC token
│   ├── SimpleVault.sol            # Margin management
│   └── SimpleVAMM.sol             # Core futures trading
├── scripts/
│   └── deploy_simple_system.js    # Full deployment + demo
└── README.md                      # This file
```

## 🚀 Quick Start

### 1. Deploy the System
```bash
# From project root
npx hardhat run DexContractsMaybe/scripts/deploy_simple_system.js --network localhost
```

### 2. What the Script Does
- ✅ Deploys all contracts (USDC, Oracle, Vault, VAMM)
- ✅ Sets up the system configuration
- ✅ Demonstrates **25% price movement** through long positions
- ✅ Shows **price decrease** through short positions
- ✅ Proves traditional futures behavior (both directions affect price)

## 💡 How Price Sensitivity Works

### **Traditional AMM Formula**
```
Price = QuoteReserves / BaseReserves
```

### **Net Position Impact**
```
If NetPosition > 0 (More Longs):
  BaseReserves -= NetPosition / 10  → Price ↑

If NetPosition < 0 (More Shorts):  
  BaseReserves += NetPosition / 10  → Price ↓
```

### **Example Price Movement**
```
Starting: $100, Small reserves (100 ETH)
$2,500 Long Position (5x leverage) → Price moves to ~$125 (25% increase)
$3,000 Short Position (10x leverage) → Price drops back down

This creates REAL futures market dynamics!
```

## 📊 Contract Details

### **SimpleVAMM.sol** (Core Trading)
- **Base Reserves**: 100 ETH (100x smaller than legacy)
- **Volume Scale Factor**: 50 (20x more sensitive)
- **Max Leverage**: 50x
- **Trading Fee**: 0.3%
- **Price Impact**: Both longs and shorts affect price

### **SimpleVault.sol** (Margin Management)
- **Collateral Token**: SimpleUSDC (6 decimals)
- **Margin Tracking**: Real-time PnL updates
- **No liquidations**: Simplified for testing

### **SimpleUSDC.sol** (Testing Token)
- **Decimals**: 6 (standard USDC)
- **Faucet**: Up to 100,000 USDC per call
- **No allowance checks**: Simplified transfers

## 🎮 Example Trading Scenario

```javascript
// 1. Deploy system (starting price: $100)
await deployScript();

// 2. Open long position
await vamm.openPosition(
    ethers.parseUnits("1000", 6), // 1,000 USDC collateral
    true,                         // Long position
    10,                          // 10x leverage
    0,                           // Min price (no limit)
    ethers.parseEther("200")     // Max price ($200)
);
// Result: Price moves to ~$120 (20% increase)

// 3. Open short position
await vamm.openPosition(
    ethers.parseUnits("800", 6),  // 800 USDC collateral
    false,                        // Short position
    15,                          // 15x leverage
    0,                           // Min price
    ethers.parseEther("200")     // Max price
);
// Result: Price drops to ~$105 (net position rebalanced)
```

## 🔧 Customization

### **Adjust Price Sensitivity**
```solidity
// In SimpleVAMM.sol constructor or admin function
volumeScaleFactor = 25;  // Even more sensitive (was 50)
// Lower number = more price movement per trade
```

### **Change Base Reserves**
```solidity
baseVirtualBaseReserves = 50 * PRICE_PRECISION;  // Even smaller (was 100)
// Smaller reserves = more volatile pricing
```

### **Modify Impact Factor**
```solidity
// In getEffectiveReserves()
uint256 impact = uint256(netPosition) / 5;  // More impact (was /10)
// Lower divisor = bigger price moves
```

## 🆚 Comparison: Traditional vs Bonding Curve

| Feature | Traditional (This System) | Bonding Curve (Main DexContracts) |
|---------|---------------------------|-----------------------------------|
| **Long Impact** | ✅ Pushes price up | ✅ Pushes price up |
| **Short Impact** | ✅ Pushes price down | ❌ No effect on price |
| **Price Discovery** | Bilateral AMM reserves | Unidirectional formula |
| **Market Behavior** | True futures market | Pump.fun style |
| **Use Case** | Balanced derivatives | Token launches |

## 🧪 Testing Features

### **Built-in Price Movement Demo**
The deployment script automatically demonstrates:
- 📈 **Long positions**: Push price up (target: 25% increase)
- 📉 **Short positions**: Push price down
- ⚖️ **Balance**: Shows how opposing forces affect price

### **High Sensitivity Settings**
- Small reserves ensure visible price movements
- Low volume scaling for immediate impact
- Reduced impact divisors for dramatic effects

### **No Security Friction**
- No allowance requirements
- Minimal access controls
- Simple error messages
- Fast testing iteration

## 📋 Running Tests

```bash
# 1. Start Hardhat network
npx hardhat node

# 2. Deploy and test (in another terminal)
npx hardhat run DexContractsMaybe/scripts/deploy_simple_system.js --network localhost

# 3. Expected output:
# ✅ Contracts deployed
# ✅ 25% price increase demonstrated
# ✅ Short selling price decrease shown
# ✅ Traditional futures behavior confirmed
```

## 🎯 Perfect For

- **Learning futures mechanics**: See how real futures markets work
- **Testing trading strategies**: High sensitivity shows immediate results  
- **Prototyping**: Simplified contracts for rapid development
- **Understanding AMM pricing**: Clear examples of reserve manipulation
- **Building trading UIs**: Real price movements for visual feedback

This system gives you **traditional futures market behavior** with **enhanced price sensitivity** for easy testing and development! 🚀 