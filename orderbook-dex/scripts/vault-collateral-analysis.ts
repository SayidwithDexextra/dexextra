import { ethers } from "hardhat";

interface CollateralSummary {
  totalCollateral: string;
  totalAvailable: string;
  totalAllocated: string;
  totalLocked: string;
  utilizationRate: string;
  traderCount: number;
  largestHolder: { address: string; amount: string };
}

interface TraderBalance {
  address: string;
  name: string;
  available: string;
  allocated: string;
  locked: string;
  total: string;
  utilizationRate: string;
}

async function analyzeCentralVaultCollateral() {
  console.log('🏦 CENTRAL VAULT COLLATERAL ANALYSIS');
  console.log('='.repeat(80));
  console.log('📊 Analyzing total collateral, allocations, and vault health');
  console.log('='.repeat(80));

  // Contract addresses from latest deployment
  const contracts = {
    mockUSDC: "0x3371ce5d3164ABf183C676e2FC987597e8191892",
    centralVault: "0xc94fb667207206eEe88C203B4dF56Be99a30c8Ea",
    orderRouter: "0xFBd6B734109567937d1d9F1a41Ce86f8d6632BF2",
    orderBook: "0x1FCccd6827eAc7cA1c18596A6ed52A8B1b51f195"
  };

  // Get signers (representing our test traders)
  const signers = await ethers.getSigners();

  // Get contract instances
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const CentralVault = await ethers.getContractFactory("CentralVault");

  const mockUSDC = MockUSDC.attach(contracts.mockUSDC);
  const centralVault = CentralVault.attach(contracts.centralVault);

  console.log('\n🔍 VAULT CONFIGURATION ANALYSIS:');
  console.log('-'.repeat(50));

  try {
    // Get primary collateral token info
    const primaryCollateralInfo = await centralVault.getPrimaryCollateralToken();
    const [primaryToken, isERC20, tokenName, tokenSymbol] = primaryCollateralInfo;
    
    console.log(`📋 Primary Collateral Token:`);
    console.log(`   Address: ${primaryToken}`);
    console.log(`   Name: ${tokenName}`);
    console.log(`   Symbol: ${tokenSymbol}`);
    console.log(`   Is ERC20: ${isERC20}`);

    // Get token decimals
    const decimals = await mockUSDC.decimals();
    console.log(`   Decimals: ${decimals}`);

    // Get total asset reserves
    const totalReserves = await centralVault.getTotalAssets(contracts.mockUSDC);
    console.log(`\n💰 TOTAL VAULT RESERVES:`);
    console.log(`   Total USDC in vault: $${ethers.formatUnits(totalReserves, decimals)}`);

  } catch (error) {
    console.log(`❌ Failed to get vault configuration: ${(error as Error).message}`);
    return;
  }

  console.log('\n👥 INDIVIDUAL TRADER ANALYSIS:');
  console.log('-'.repeat(50));

  const traderNames = [
    "🐋 Whale Trader",
    "🏦 Institution A", 
    "🏛️ Institution B",
    "📈 High Volume Trader",
    "💼 Market Maker",
    "🎯 Arbitrageur",
    "⚡ Speed Trader",
    "🎢 Volatility Trader", 
    "🎪 Stress Tester",
    "🔬 Edge Case Tester"
  ];

  const traderBalances: TraderBalance[] = [];
  let totalSystemAvailable = BigInt(0);
  let totalSystemAllocated = BigInt(0);
  let totalSystemLocked = BigInt(0);
  let largestBalance = { address: "", amount: BigInt(0) };

  for (let i = 0; i < Math.min(signers.length, traderNames.length); i++) {
    const signer = signers[i];
    const traderName = traderNames[i] || `Trader ${i + 1}`;

    try {
      // Get comprehensive balance information
      const balance = await centralVault.getUserBalance(signer.address, contracts.mockUSDC);
      const primaryBalance = await centralVault.getPrimaryCollateralBalance(signer.address);

      const available = balance.available;
      const allocated = balance.allocated;
      const locked = balance.locked;
      const total = available + allocated + locked;

      // Update system totals
      totalSystemAvailable += available;
      totalSystemAllocated += allocated;
      totalSystemLocked += locked;

      // Track largest holder
      if (total > largestBalance.amount) {
        largestBalance = { address: signer.address, amount: total };
      }

      // Calculate utilization rate
      const utilizationRate = total > 0 ? ((allocated + locked) * BigInt(10000) / total) : BigInt(0);

      const traderBalance: TraderBalance = {
        address: signer.address,
        name: traderName,
        available: ethers.formatUnits(available, 6),
        allocated: ethers.formatUnits(allocated, 6),
        locked: ethers.formatUnits(locked, 6),
        total: ethers.formatUnits(total, 6),
        utilizationRate: `${Number(utilizationRate) / 100}%`
      };

      traderBalances.push(traderBalance);

      // Display individual trader info
      if (total > 0) {
        console.log(`\n💰 ${traderName}:`);
        console.log(`   Address: ${signer.address}`);
        console.log(`   Available: $${Number(traderBalance.available).toLocaleString()}`);
        console.log(`   Allocated: $${Number(traderBalance.allocated).toLocaleString()}`);
        console.log(`   Locked: $${Number(traderBalance.locked).toLocaleString()}`);
        console.log(`   Total: $${Number(traderBalance.total).toLocaleString()}`);
        console.log(`   Utilization: ${traderBalance.utilizationRate}`);
      }

    } catch (error) {
      console.log(`❌ Failed to get balance for ${traderName}: ${(error as Error).message}`);
    }
  }

  console.log('\n📊 SYSTEM-WIDE COLLATERAL SUMMARY:');
  console.log('='.repeat(80));

  const totalSystemCollateral = totalSystemAvailable + totalSystemAllocated + totalSystemLocked;
  const systemUtilization = totalSystemCollateral > 0 ? 
    ((totalSystemAllocated + totalSystemLocked) * BigInt(10000) / totalSystemCollateral) : BigInt(0);

  const collateralSummary: CollateralSummary = {
    totalCollateral: ethers.formatUnits(totalSystemCollateral, 6),
    totalAvailable: ethers.formatUnits(totalSystemAvailable, 6),
    totalAllocated: ethers.formatUnits(totalSystemAllocated, 6),
    totalLocked: ethers.formatUnits(totalSystemLocked, 6),
    utilizationRate: `${Number(systemUtilization) / 100}%`,
    traderCount: traderBalances.filter(t => Number(t.total) > 0).length,
    largestHolder: {
      address: largestBalance.address,
      amount: ethers.formatUnits(largestBalance.amount, 6)
    }
  };

  console.log(`💎 Total Collateral in Vault: $${Number(collateralSummary.totalCollateral).toLocaleString()}`);
  console.log(`✅ Available for Trading: $${Number(collateralSummary.totalAvailable).toLocaleString()}`);
  console.log(`🔒 Currently Allocated: $${Number(collateralSummary.totalAllocated).toLocaleString()}`);
  console.log(`🔐 Locked (Pending): $${Number(collateralSummary.totalLocked).toLocaleString()}`);
  console.log(`📊 System Utilization Rate: ${collateralSummary.utilizationRate}`);
  console.log(`👥 Active Traders: ${collateralSummary.traderCount}`);
  console.log(`🐋 Largest Holder: ${collateralSummary.largestHolder.address.slice(0, 8)}... ($${Number(collateralSummary.largestHolder.amount).toLocaleString()})`);

  console.log('\n🏥 VAULT HEALTH ANALYSIS:');
  console.log('-'.repeat(50));

  // Calculate health metrics
  const availabilityRatio = Number(collateralSummary.totalAvailable) / Number(collateralSummary.totalCollateral) * 100;
  const allocationRatio = Number(collateralSummary.totalAllocated) / Number(collateralSummary.totalCollateral) * 100;

  console.log(`🟢 Liquidity Health: ${availabilityRatio.toFixed(1)}% available`);
  console.log(`🟡 Allocation Health: ${allocationRatio.toFixed(1)}% allocated`);

  if (availabilityRatio > 80) {
    console.log(`✅ EXCELLENT: High liquidity available for new orders`);
  } else if (availabilityRatio > 50) {
    console.log(`⚠️  MODERATE: Adequate liquidity, monitor closely`);
  } else {
    console.log(`🚨 LOW: Limited liquidity available for large orders`);
  }

  console.log('\n🎯 TRADING CAPACITY ANALYSIS:');
  console.log('-'.repeat(50));

  // Calculate theoretical max order sizes at different price levels
  const maxOrderAt100 = Number(collateralSummary.totalAvailable) / 100;
  const maxOrderAt200 = Number(collateralSummary.totalAvailable) / 200;
  const maxOrderAt500 = Number(collateralSummary.totalAvailable) / 500;

  console.log(`📈 Maximum Order Capacity:`);
  console.log(`   At $100/unit: ${maxOrderAt100.toLocaleString()} units ($${Number(collateralSummary.totalAvailable).toLocaleString()} notional)`);
  console.log(`   At $200/unit: ${maxOrderAt200.toLocaleString()} units ($${Number(collateralSummary.totalAvailable).toLocaleString()} notional)`);
  console.log(`   At $500/unit: ${maxOrderAt500.toLocaleString()} units ($${Number(collateralSummary.totalAvailable).toLocaleString()} notional)`);

  // Check vault authorization status
  console.log('\n🔐 VAULT AUTHORIZATION STATUS:');
  console.log('-'.repeat(50));

  try {
    const isOrderRouterAuthorized = await centralVault.isAuthorizedMarket(contracts.orderRouter);
    const isOrderBookAuthorized = await centralVault.isAuthorizedMarket(contracts.orderBook);

    console.log(`📋 OrderRouter authorized: ${isOrderRouterAuthorized ? '✅ YES' : '❌ NO'}`);
    console.log(`📋 OrderBook authorized: ${isOrderBookAuthorized ? '✅ YES' : '❌ NO'}`);

    if (isOrderRouterAuthorized && !isOrderBookAuthorized) {
      console.log(`✅ CORRECT: OrderRouter has authorization, OrderBook routes through it`);
    } else if (!isOrderRouterAuthorized) {
      console.log(`⚠️  WARNING: OrderRouter not authorized - trading may fail`);
    }

  } catch (error) {
    console.log(`❌ Failed to check authorization: ${(error as Error).message}`);
  }

  console.log('\n🎊 VAULT ANALYSIS COMPLETE!');
  console.log('='.repeat(80));

  return collateralSummary;
}

async function main() {
  const summary = await analyzeCentralVaultCollateral();
  
  if (summary) {
    console.log('\n📋 QUICK SUMMARY:');
    console.log(`💰 Total Collateral: $${Number(summary.totalCollateral).toLocaleString()}`);
    console.log(`📊 Utilization: ${summary.utilizationRate}`);
    console.log(`👥 Active Traders: ${summary.traderCount}`);
  }
}

main()
  .then(() => {
    console.log('\n🏁 Vault collateral analysis completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Analysis failed:', error);
    process.exit(1);
  });







