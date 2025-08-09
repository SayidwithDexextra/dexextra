# Bonding Curve vAMM Smart Contracts 🚀

A revolutionary virtual Automated Market Maker (vAMM) system with **bonding curve price discovery** for pump.fund-style trading with custom starting prices and progressive difficulty scaling.

## 🆕 What's New: Bonding Curve System

**This repository now contains TWO systems:**
- **NEW**: Bonding Curve vAMM (main contracts) - Custom starting prices with pump.fund behavior
- **LEGACY**: Traditional vAMM (legacy/ folder) - Deep liquidity AMM style

## 🎯 Key Features of Bonding Curve System

### 🚀 Pump.Fund Style Behavior
- **Custom Starting Prices**: Set any starting price ($0.001, $8, $100, etc.)
- **Early Easy Pumps**: First buyers can easily pump prices with small amounts
- **Progressive Difficulty**: Later buyers face exponentially higher costs
- **Maximum Pump Potential**: Up to 10,000x price increases possible

### 💎 Three Market Types
1. **PUMP Markets** - Ultra-low starting prices ($0.001) for maximum pump potential
2. **STANDARD Markets** - Balanced starting prices ($1-10) for moderate pumping
3. **BLUE CHIP Markets** - High starting prices ($100+) for stability

### 🧮 Bonding Curve Formula
```
Price = StartingPrice × (1 + TotalSupply/Steepness)^Exponent
```
- **StartingPrice**: Custom starting price (e.g., $0.001)
- **TotalSupply**: Total long positions (drives price up)
- **Steepness**: Controls pump difficulty (lower = easier pumps)
- **Exponent**: Controls price curve shape (1.5 = progressive difficulty)

## 📁 Contract Architecture

```
contracts/
├── vAMM.sol                 # NEW: Bonding curve vAMM
├── vAMMFactory.sol          # NEW: Factory with market types
├── Vault.sol               # Same: Modular margin vault
├── IPriceOracle.sol        # Same: Price oracle interface
├── IVault.sol              # Same: Vault interface  
├── IvAMM.sol               # Same: vAMM interface
├── MockPriceOracle.sol     # Same: Mock oracle for testing
├── MockUSDC.sol            # Same: Mock USDC token
└── legacy/                 # LEGACY: Original AMM-style contracts
    ├── vAMM.sol           # Traditional deep liquidity vAMM
    ├── vAMMFactory.sol    # Traditional factory
    └── ... (all original contracts)
```

## 🚀 Quick Start: Bonding Curve Trading

### 1. Deploy the Bonding Curve System
```bash
cd DexContracts
npx hardhat run scripts/deploy_bonding_curve_system.js --network localhost
```

### 2. Create Different Market Types

#### Ultra-Pump Market ($0.001 starting price)
```javascript
const pumpMarket = await factory.createPumpMarket(
  "ROCKET",      // symbol
  oracleAddress, // price oracle
  usdcAddress   // collateral token
);
```

#### Balanced Market ($8 starting price) 
```javascript
const standardMarket = await factory.createStandardMarket(
  "BALANCED",
  oracleAddress,
  usdcAddress,
  ethers.parseEther("8") // $8.00 starting price
);
```

#### Premium Market ($500 starting price)
```javascript
const blueChipMarket = await factory.createBlueChipMarket(
  "PREMIUM",
  oracleAddress,
  usdcAddress,
  ethers.parseEther("500") // $500 starting price
);
```

### 3. Experience Pump.Fund Behavior

Early buyers with small amounts can create massive price pumps:

```javascript
// Small $100 buy might pump price from $0.001 to $0.10 (100x!)
await vamm.openPosition(
  ethers.parseUnits("100", 6), // $100 USDC
  true,  // long position
  10,    // 10x leverage  
  0,     // min price
  ethers.MaxUint256 // max price
);
```

Later buyers face exponentially higher costs:
```javascript
// Same $100 buy might only pump from $10 to $10.50 (5% increase)
```

## 🔥 Bonding Curve Examples

### Market Creation Examples
```javascript
// Micro-cap meme coin: Extreme pump potential
await factory.createMarket("PEPE", oracle, usdc, ethers.parseUnits("1", 15)); // $0.001

// Moderate project: Balanced growth
await factory.createMarket("DOGE", oracle, usdc, ethers.parseEther("1")); // $1.00

// Premium token: Stable with limited pumps  
await factory.createMarket("BTC", oracle, usdc, ethers.parseEther("1000")); // $1000
```

### Price Impact Demonstration
For a PUMP market starting at $0.001:
- **First $1,000 trade**: Price might go $0.001 → $0.50 (500x)
- **Second $1,000 trade**: Price might go $0.50 → $2.00 (4x)  
- **Third $1,000 trade**: Price might go $2.00 → $4.50 (2.25x)

## 📊 Market Analysis Functions

### Get Bonding Curve Information
```javascript
const info = await vamm.getBondingCurveInfo();
 console.log("Current Price:", ethers.formatEther(info.currentPrice));
 console.log("Starting Price:", ethers.formatEther(info.startPrice));
 console.log("Total Supply:", info.totalSupply.toString());
 console.log("Max Price:", ethers.formatEther(info.maxPrice));
```

### Calculate Trade Costs
```javascript
// Calculate cost to buy $10,000 worth
const buyCost = await vamm.calculateBuyCost(ethers.parseEther("10000"));
 console.log("Total cost:", ethers.formatEther(buyCost));

// Calculate price impact
const priceImpact = await vamm.getPriceImpact(ethers.parseEther("10000"), true);
 console.log("Price impact:", ethers.formatEther(priceImpact));
```

## 🎮 Trading Examples

### Opening a Pump Position
```javascript
// 1. Deposit collateral
await usdc.approve(vault.address, ethers.parseUnits("1000", 6));
await vault.depositCollateral(user, ethers.parseUnits("1000", 6));

// 2. Open long position for pump
await vamm.openPosition(
  ethers.parseUnits("100", 6), // $100 collateral
  true,  // long (pump the price)
  20,    // 20x leverage = $2000 position
  0,     // no min price
  ethers.MaxUint256 // no max price
);

// 3. Watch the bonding curve pump the price!
const newPrice = await vamm.getMarkPrice();
 console.log("New price after pump:", ethers.formatEther(newPrice));
```

## 🔧 Advanced Configuration

### Update Bonding Curve Parameters (Owner Only)
```javascript
// Note: Current implementation uses constants
// To make these updatable, change constants to state variables
await vamm.updateBondingCurveParams(
  newSteepness, // Lower = easier pumps
  newExponent   // Higher = more progressive difficulty
);
```

### Emergency Reset (Extreme Circumstances)
```javascript
await vamm.pause(); // Must pause first
await vamm.emergencyResetBondingCurve(
  ethers.parseEther("0.001") // New starting price
);
```

## 🚨 Key Differences from Legacy System

| Feature | Legacy vAMM | Bonding Curve vAMM |
|---------|-------------|---------------------|
| Price Discovery | Deep virtual liquidity (AMM) | Bonding curve formula |
| Starting Price | Fixed by initial reserves | Fully customizable |
| Early Trading | Stable, minimal impact | Easy pumps, high impact |
| Late Trading | Stable, minimal impact | Expensive, progressive difficulty |
| Price Sensitivity | Low (deep liquidity) | High (curve-based) |
| Pump Potential | Limited by reserves | Up to 10,000x increases |
| Market Types | One size fits all | PUMP/STANDARD/BLUE_CHIP |

## 📈 Deployment Script Results

The bonding curve deployment script creates four demo markets:

1. **ROCKET** (PUMP) - $0.001 starting price
2. **BALANCED** (STANDARD) - $8.00 starting price  
3. **PREMIUM** (BLUE_CHIP) - $500.00 starting price
4. **MOON** (CUSTOM) - $0.0001 starting price

Each market demonstrates different pump behaviors and difficulty curves.

## 🧪 Testing

Run the bonding curve system:
```bash
npx hardhat run scripts/deploy_bonding_curve_system.js --network localhost
```

This will:
- Deploy all bonding curve contracts
- Create 4 demo markets with different characteristics
- Demonstrate price impact calculations
- Show bonding curve information for each market

## 🛡️ Security Features

- **Access Control**: Owner-only parameter updates
- **Emergency Pause**: Circuit breaker mechanism  
- **Price Caps**: Maximum 10,000x price increases
- **Slippage Protection**: Min/max price bounds
- **Liquidation System**: Risk-based position liquidation
- **Backwards Compatibility**: Legacy systems still supported

## 🎯 Perfect For

- **Meme Coins**: Ultra-low starting prices with massive pump potential
- **New Projects**: Custom starting prices that reflect true value
- **Community Tokens**: Easy early pumps for community engagement
- **Experimental Markets**: Testing different tokenomics models
- **Gaming Tokens**: Achievement-based pricing curves

## 📜 License

MIT License - Build the future of DeFi!

---

## 🔗 Links & Resources

- **Legacy Documentation**: See `legacy/` folder for original AMM documentation
- **Bonding Curve Theory**: [Ethereum.org Bonding Curves](https://ethereum.org/en/developers/docs/scaling/scaling/)
- **Pump.Fund Inspiration**: Revolutionary token launch mechanisms
- **UMA Integration**: Ready for oracle-based settlement (see DexContractsV2/)

**Ready to create the next viral pump? Deploy your bonding curve vAMM today!** 🚀 