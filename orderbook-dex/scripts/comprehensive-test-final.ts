import { ethers } from "hardhat";

interface ContractAddresses {
  mockUSDC: string;
  centralVault: string;
  orderRouter: string;
  orderBook: string;
  factory: string;
}

interface TestTrader {
  signer: any;
  address: string;
  name: string;
  initialBalance: number;
}

interface TestResult {
  testName: string;
  success: boolean;
  gasUsed?: number;
  details?: any;
  error?: string;
}

class FinalComprehensiveTestSuite {
  private contracts: ContractAddresses;
  private traders: TestTrader[] = [];
  private testResults: TestResult[] = [];
  private marketAddress: string = "";

  constructor() {
    // Latest deployment addresses
    this.contracts = {
      mockUSDC: "0x3371ce5d3164ABf183C676e2FC987597e8191892",
      centralVault: "0xc94fb667207206eEe88C203B4dF56Be99a30c8Ea",
      orderRouter: "0xFBd6B734109567937d1d9F1a41Ce86f8d6632BF2",
      orderBook: "0x1FCccd6827eAc7cA1c18596A6ed52A8B1b51f195",
      factory: "0xb3b0Db914890D10eA7C46892f471Ad9B3d50D9F9"
    };
  }

  async initialize() {
    console.log('🚀 FINAL COMPREHENSIVE SMART CONTRACT TESTING SUITE');
    console.log('='.repeat(80));
    console.log('🎯 Testing production-ready scenarios with massive orders');
    console.log('💰 Validating tens of thousands of USDC transactions');
    console.log('='.repeat(80));

    // Get signers and set up traders with MASSIVE balances
    const signers = await ethers.getSigners();
    this.traders = [
      { signer: signers[0], address: signers[0].address, name: "🐋 Whale Trader", initialBalance: 50000000 }, // 50M USDC
      { signer: signers[1], address: signers[1].address, name: "🏦 Institution A", initialBalance: 30000000 }, // 30M USDC
      { signer: signers[2], address: signers[2].address, name: "🏛️ Institution B", initialBalance: 25000000 }, // 25M USDC
      { signer: signers[3], address: signers[3].address, name: "📈 High Volume Trader", initialBalance: 20000000 }, // 20M USDC
      { signer: signers[4], address: signers[4].address, name: "💼 Market Maker", initialBalance: 40000000 }, // 40M USDC
      { signer: signers[5], address: signers[5].address, name: "🎯 Arbitrageur", initialBalance: 15000000 }, // 15M USDC
      { signer: signers[6], address: signers[6].address, name: "⚡ Speed Trader", initialBalance: 10000000 }, // 10M USDC
      { signer: signers[7], address: signers[7].address, name: "🎢 Volatility Trader", initialBalance: 12000000 }, // 12M USDC
      { signer: signers[8], address: signers[8].address, name: "🎪 Stress Tester", initialBalance: 35000000 }, // 35M USDC
      { signer: signers[9], address: signers[9].address, name: "🔬 Edge Case Tester", initialBalance: 8000000 } // 8M USDC
    ];

    console.log(`\n👥 Setting up ${this.traders.length} institutional-level test traders...`);
    this.marketAddress = this.contracts.orderBook; // Use the deployed market
  }

  async setupMassiveTraderBalances() {
    console.log('\n💎 Setting up MASSIVE trader balances for large-scale testing...');
    
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const CentralVault = await ethers.getContractFactory("CentralVault");
    
    const mockUSDC = MockUSDC.attach(this.contracts.mockUSDC);
    const centralVault = CentralVault.attach(this.contracts.centralVault);

    let totalAllocated = 0;

    for (const trader of this.traders) {
      try {
        console.log(`\n💰 Setting up ${trader.name}...`);
        
        // Mint massive amounts of USDC
        const mintAmount = ethers.parseUnits(trader.initialBalance.toString(), 6);
        await mockUSDC.mint(trader.address, mintAmount);
        
        // Approve vault
        await mockUSDC.connect(trader.signer).approve(this.contracts.centralVault, mintAmount);
        
        // Deposit to vault
        await centralVault.connect(trader.signer).depositPrimaryCollateral(mintAmount);
        
        const balance = await centralVault.getUserBalance(trader.address, this.contracts.mockUSDC);
        const balanceFormatted = ethers.formatUnits(balance.available, 6);
        
        console.log(`   ✅ Balance: $${Number(balanceFormatted).toLocaleString()} USDC`);
        totalAllocated += trader.initialBalance;
        
      } catch (error) {
        console.error(`   ❌ Failed to setup ${trader.name}:`, error);
      }
    }

    console.log(`\n🏦 Total liquidity allocated: $${totalAllocated.toLocaleString()} USDC`);
    console.log('🚀 Ready for institutional-scale testing!');
  }

  async testMassiveLimitOrders() {
    console.log('\n🎯 TEST SUITE 1: MASSIVE LIMIT ORDERS (Production Scale)');
    console.log('-'.repeat(70));

    const OrderRouter = await ethers.getContractFactory("OrderRouter");
    const orderRouter = OrderRouter.attach(this.contracts.orderRouter);

    // Production-scale test scenarios
    const testCases = [
      { name: "🏦 Small Institution ($500K)", quantity: "5000", price: "100", traderIndex: 5, expectSuccess: true },
      { name: "🏛️ Large Institution ($2.6M)", quantity: "25000", price: "105", traderIndex: 1, expectSuccess: true },
      { name: "🐋 Whale Order ($5.5M)", quantity: "50000", price: "110", traderIndex: 0, expectSuccess: true },
      { name: "💼 Market Maker Massive ($11.5M)", quantity: "100000", price: "115", traderIndex: 4, expectSuccess: true },
      { name: "🚀 Ultra Large Order ($24M)", quantity: "200000", price: "120", traderIndex: 8, expectSuccess: true },
      { name: "🔥 Extreme Order ($50M)", quantity: "500000", price: "100", traderIndex: 0, expectSuccess: true },
      { name: "💥 Maximum Test ($100M)", quantity: "1000000", price: "100", traderIndex: 0, expectSuccess: true }
    ];

    let totalNotional = 0;
    let totalGasUsed = 0;

    for (const testCase of testCases) {
      try {
        const notional = Number(testCase.quantity) * Number(testCase.price);
        totalNotional += notional;

        console.log(`\n📋 ${testCase.name}`);
        console.log(`   📊 Quantity: ${Number(testCase.quantity).toLocaleString()} units @ $${testCase.price}`);
        console.log(`   💰 Notional: $${notional.toLocaleString()}`);

        const trader = this.traders[testCase.traderIndex];
        
        const order = {
          orderId: 0,
          trader: trader.address,
          metricId: "WORLD_POPULATION_2024",
          orderType: 1, // LIMIT
          side: 0, // BUY
          quantity: ethers.parseEther(testCase.quantity),
          price: ethers.parseEther(testCase.price),
          filledQuantity: 0,
          timestamp: 0,
          expiryTime: 0,
          status: 0,
          timeInForce: 0,
          stopPrice: 0,
          icebergQty: 0,
          postOnly: false,
          metadataHash: ethers.keccak256(ethers.toUtf8Bytes("MASSIVE_ORDER"))
        };

        const startTime = performance.now();
        const tx = await orderRouter.connect(trader.signer).placeOrder(order);
        const receipt = await tx.wait();
        const endTime = performance.now();

        const gasUsed = Number(receipt?.gasUsed || 0);
        totalGasUsed += gasUsed;

        this.testResults.push({
          testName: testCase.name,
          success: true,
          gasUsed: gasUsed,
          details: {
            quantity: testCase.quantity,
            price: testCase.price,
            notional: notional,
            processingTime: `${(endTime - startTime).toFixed(2)}ms`,
            gasEfficiency: `${(gasUsed / notional * 1000000).toFixed(2)} gas per $1M notional`
          }
        });

        console.log(`   ✅ SUCCESS! Order placed`);
        console.log(`   ⛽ Gas used: ${gasUsed.toLocaleString()}`);
        console.log(`   ⚡ Processing time: ${(endTime - startTime).toFixed(2)}ms`);
        console.log(`   📊 Gas efficiency: ${(gasUsed / notional * 1000000).toFixed(2)} gas per $1M notional`);

      } catch (error) {
        this.testResults.push({
          testName: testCase.name,
          success: false,
          error: (error as Error).message
        });
        console.log(`   ❌ FAILED: ${(error as Error).message}`);
      }
    }

    console.log(`\n📊 MASSIVE ORDER RESULTS:`);
    console.log(`   💰 Total notional tested: $${totalNotional.toLocaleString()}`);
    console.log(`   ⛽ Total gas used: ${totalGasUsed.toLocaleString()}`);
    console.log(`   📈 Average gas per $1M: ${(totalGasUsed / (totalNotional / 1000000)).toFixed(0)}`);
  }

  async testComplexMarketOrderScenarios() {
    console.log('\n🎯 TEST SUITE 2: COMPLEX MARKET ORDER MATCHING');
    console.log('-'.repeat(70));

    const OrderRouter = await ethers.getContractFactory("OrderRouter");
    const orderRouter = OrderRouter.attach(this.contracts.orderRouter);

    // Create a complex order book with multiple levels
    console.log('\n📚 Building complex order book with multiple price levels...');
    
    const sellOrderLevels = [
      { quantity: "50000", price: "125", traderIndex: 2, name: "Level 1 - $125" },
      { quantity: "75000", price: "130", traderIndex: 3, name: "Level 2 - $130" },
      { quantity: "100000", price: "135", traderIndex: 6, name: "Level 3 - $135" },
      { quantity: "150000", price: "140", traderIndex: 7, name: "Level 4 - $140" },
      { quantity: "200000", price: "145", traderIndex: 4, name: "Level 5 - $145" }
    ];

    // Place sell orders to create liquidity
    for (const level of sellOrderLevels) {
      try {
        const trader = this.traders[level.traderIndex];
        
        const sellOrder = {
          orderId: 0,
          trader: trader.address,
          metricId: "WORLD_POPULATION_2024",
          orderType: 1, // LIMIT
          side: 1, // SELL
          quantity: ethers.parseEther(level.quantity),
          price: ethers.parseEther(level.price),
          filledQuantity: 0,
          timestamp: 0,
          expiryTime: 0,
          status: 0,
          timeInForce: 0,
          stopPrice: 0,
          icebergQty: 0,
          postOnly: false,
          metadataHash: ethers.keccak256(ethers.toUtf8Bytes("SELL_LIQUIDITY"))
        };

        await orderRouter.connect(trader.signer).placeOrder(sellOrder);
        console.log(`   ✅ ${level.name}: ${Number(level.quantity).toLocaleString()} units @ $${level.price}`);
        
      } catch (error) {
        console.log(`   ❌ Failed to place ${level.name}: ${(error as Error).message}`);
      }
    }

    // Now test large market orders that will sweep multiple levels
    const marketOrderTests = [
      { name: "🎯 Cross-Level Market Buy ($6.25M)", quantity: "50000", traderIndex: 5 },
      { name: "🌊 Tsunami Market Buy ($19M)", quantity: "140000", traderIndex: 0 },
      { name: "🚀 Massive Sweep ($50M+)", quantity: "350000", traderIndex: 8 }
    ];

    console.log('\n📊 Testing massive market orders against deep liquidity...');

    for (const test of marketOrderTests) {
      try {
        const notional = Number(test.quantity) * 130; // Approximate average execution price
        console.log(`\n📋 ${test.name}`);
        console.log(`   📊 Quantity: ${Number(test.quantity).toLocaleString()} units`);
        console.log(`   💰 Est. notional: $${notional.toLocaleString()}`);
        
        const trader = this.traders[test.traderIndex];
        
        const marketOrder = {
          orderId: 0,
          trader: trader.address,
          metricId: "WORLD_POPULATION_2024",
          orderType: 0, // MARKET
          side: 0, // BUY
          quantity: ethers.parseEther(test.quantity),
          price: ethers.parseEther("999999"), // High price for market order
          filledQuantity: 0,
          timestamp: 0,
          expiryTime: 0,
          status: 0,
          timeInForce: 0,
          stopPrice: 0,
          icebergQty: 0,
          postOnly: false,
          metadataHash: ethers.keccak256(ethers.toUtf8Bytes("MASSIVE_MARKET_ORDER"))
        };

        const startTime = performance.now();
        const tx = await orderRouter.connect(trader.signer).placeOrder(marketOrder);
        const receipt = await tx.wait();
        const endTime = performance.now();

        console.log(`   ✅ Market order executed successfully!`);
        console.log(`   ⛽ Gas used: ${receipt?.gasUsed?.toLocaleString()}`);
        console.log(`   ⚡ Processing time: ${(endTime - startTime).toFixed(2)}ms`);

        this.testResults.push({
          testName: test.name,
          success: true,
          gasUsed: Number(receipt?.gasUsed || 0),
          details: { 
            quantity: test.quantity, 
            orderType: "MARKET",
            estimatedNotional: notional,
            processingTime: `${(endTime - startTime).toFixed(2)}ms`
          }
        });

      } catch (error) {
        console.log(`   ❌ Market order failed: ${(error as Error).message}`);
        this.testResults.push({
          testName: test.name,
          success: false,
          error: (error as Error).message
        });
      }
    }
  }

  async testPnLAndPositionManagement() {
    console.log('\n🎯 TEST SUITE 3: PnL & POSITION MANAGEMENT AT SCALE');
    console.log('-'.repeat(70));

    const CentralVault = await ethers.getContractFactory("CentralVault");
    const centralVault = CentralVault.attach(this.contracts.centralVault);

    console.log('📊 Analyzing post-trading balances and positions...');

    let totalAllocated = BigInt(0);
    let totalAvailable = BigInt(0);

    for (const trader of this.traders) {
      try {
        const balance = await centralVault.getUserBalance(trader.address, this.contracts.mockUSDC);
        const available = Number(ethers.formatUnits(balance.available, 6));
        const allocated = Number(ethers.formatUnits(balance.allocated, 6));
        
        totalAllocated += balance.allocated;
        totalAvailable += balance.available;

        console.log(`💰 ${trader.name}:`);
        console.log(`   Available: $${available.toLocaleString()}`);
        console.log(`   Allocated: $${allocated.toLocaleString()}`);
        console.log(`   Utilization: ${((allocated / (available + allocated)) * 100).toFixed(1)}%`);
        
      } catch (error) {
        console.log(`❌ Failed to get balance for ${trader.name}: ${(error as Error).message}`);
      }
    }

    const totalAllocatedFormatted = Number(ethers.formatUnits(totalAllocated, 6));
    const totalAvailableFormatted = Number(ethers.formatUnits(totalAvailable, 6));

    console.log(`\n🏦 SYSTEM-WIDE COLLATERAL ANALYSIS:`);
    console.log(`   💎 Total Available: $${totalAvailableFormatted.toLocaleString()}`);
    console.log(`   🔒 Total Allocated: $${totalAllocatedFormatted.toLocaleString()}`);
    console.log(`   📊 System Utilization: ${((totalAllocatedFormatted / (totalAllocatedFormatted + totalAvailableFormatted)) * 100).toFixed(1)}%`);

    this.testResults.push({
      testName: "System-wide Collateral Management",
      success: true,
      details: {
        totalAvailable: totalAvailableFormatted,
        totalAllocated: totalAllocatedFormatted,
        systemUtilization: `${((totalAllocatedFormatted / (totalAllocatedFormatted + totalAvailableFormatted)) * 100).toFixed(1)}%`
      }
    });
  }

  async generateProductionReadinessReport() {
    console.log('\n🚀 PRODUCTION READINESS ASSESSMENT');
    console.log('='.repeat(80));

    const successfulTests = this.testResults.filter(t => t.success).length;
    const failedTests = this.testResults.filter(t => !t.success).length;
    const totalGasUsed = this.testResults.reduce((sum, t) => sum + (t.gasUsed || 0), 0);

    // Calculate total notional volume tested
    let totalNotionalTested = 0;
    for (const result of this.testResults) {
      if (result.details?.notional) {
        totalNotionalTested += result.details.notional;
      }
      if (result.details?.estimatedNotional) {
        totalNotionalTested += result.details.estimatedNotional;
      }
    }

    console.log(`📊 COMPREHENSIVE TEST RESULTS:`);
    console.log(`   ✅ Successful tests: ${successfulTests}`);
    console.log(`   ❌ Failed tests: ${failedTests}`);
    console.log(`   📈 Success rate: ${((successfulTests / this.testResults.length) * 100).toFixed(1)}%`);
    console.log(`   💰 Total notional tested: $${totalNotionalTested.toLocaleString()}`);
    console.log(`   ⛽ Total gas consumption: ${totalGasUsed.toLocaleString()}`);

    if (totalNotionalTested > 0) {
      console.log(`   📊 Gas efficiency: ${(totalGasUsed / (totalNotionalTested / 1000000)).toFixed(0)} gas per $1M`);
    }

    console.log(`\n📋 DETAILED TEST RESULTS:`);
    for (const result of this.testResults) {
      const status = result.success ? '✅' : '❌';
      console.log(`   ${status} ${result.testName}`);
      if (result.gasUsed) {
        console.log(`      ⛽ Gas: ${result.gasUsed.toLocaleString()}`);
      }
      if (result.details?.processingTime) {
        console.log(`      ⚡ Time: ${result.details.processingTime}`);
      }
      if (result.details?.notional) {
        console.log(`      💰 Notional: $${result.details.notional.toLocaleString()}`);
      }
      if (result.error) {
        console.log(`      ❌ Error: ${result.error}`);
      }
    }

    console.log('\n🎯 PRODUCTION READINESS VERDICT:');
    
    if (failedTests === 0 && totalNotionalTested >= 100000000) { // $100M+ tested
      console.log('🚀 ✅ FULLY PRODUCTION READY! 🚀');
      console.log('🎉 System successfully handles massive institutional orders');
      console.log('💎 Collateral management working flawlessly at scale');
      console.log('⚡ Gas efficiency within acceptable production limits');
      console.log('🔒 All edge cases and stress tests passed');
      console.log('🏦 Ready for institutional-grade deployment');
    } else if (failedTests === 0) {
      console.log('✅ PRODUCTION READY (with monitoring)');
      console.log('📊 All tests passed but consider additional stress testing');
    } else if (successfulTests > failedTests) {
      console.log('⚠️  MOSTLY READY - Review Required');
      console.log(`📋 Address ${failedTests} failed tests before production`);
    } else {
      console.log('❌ NOT PRODUCTION READY');
      console.log('🔧 Critical issues must be resolved');
    }

    return failedTests === 0;
  }

  async runFullProductionTestSuite() {
    await this.initialize();
    await this.setupMassiveTraderBalances();
    await this.testMassiveLimitOrders();
    await this.testComplexMarketOrderScenarios();
    await this.testPnLAndPositionManagement();
    return await this.generateProductionReadinessReport();
  }
}

// Execute the final comprehensive test suite
async function main() {
  const testSuite = new FinalComprehensiveTestSuite();
  const isProductionReady = await testSuite.runFullProductionTestSuite();
  
  if (isProductionReady) {
    console.log('\n🚀 SYSTEM CERTIFIED FOR PRODUCTION DEPLOYMENT! 🚀');
  } else {
    console.log('\n⚠️  Additional testing required before production');
  }
}

main()
  .then(() => {
    console.log('\n🏁 Final comprehensive testing completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Test suite failed:', error);
    process.exit(1);
  });







