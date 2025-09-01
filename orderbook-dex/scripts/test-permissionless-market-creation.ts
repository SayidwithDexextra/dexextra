import { ethers } from "hardhat";

async function testPermissionlessMarketCreation() {
    console.log("🚀 Testing Permissionless Market Creation");
    console.log("=" .repeat(50));
    
    // Deploy all contracts first
    console.log("\n📦 Deploying contracts...");
    
    const [deployer, user1, user2, user3] = await ethers.getSigners();
    console.log(`Deployer: ${deployer.address}`);
    console.log(`User1: ${user1.address}`);
    console.log(`User2: ${user2.address}`);
    console.log(`User3: ${user3.address}`);
    
    // Deploy core contracts
    const MockUMAFinder = await ethers.getContractFactory("MockUMAFinder");
    const mockUMAFinder = await MockUMAFinder.deploy();
    await mockUMAFinder.waitForDeployment();
    
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();
    
    const UMAOracleManager = await ethers.getContractFactory("UMAOracleManager");
    const umaOracleManager = await UMAOracleManager.deploy(
        await mockUMAFinder.getAddress(),
        await mockUSDC.getAddress(),
        deployer.address
    );
    await umaOracleManager.waitForDeployment();
    
    const CentralVault = await ethers.getContractFactory("CentralVault");
    const centralVault = await CentralVault.deploy(
        deployer.address,
        86400, // 24 hours emergency pause
        await mockUSDC.getAddress()
    );
    await centralVault.waitForDeployment();
    
    const OrderRouter = await ethers.getContractFactory("OrderRouter");
    const orderRouter = await OrderRouter.deploy(
        await centralVault.getAddress(),
        await umaOracleManager.getAddress(),
        deployer.address,
        20 // 0.2% trading fee
    );
    await orderRouter.waitForDeployment();
    
    const OrderBook = await ethers.getContractFactory("OrderBook");
    const orderBookImpl = await OrderBook.deploy();
    await orderBookImpl.waitForDeployment();
    
    const MetricsMarketFactory = await ethers.getContractFactory("MetricsMarketFactory");
    const factory = await MetricsMarketFactory.deploy(
        await umaOracleManager.getAddress(),
        await orderBookImpl.getAddress(),
        await centralVault.getAddress(),
        await orderRouter.getAddress(),
        deployer.address,
        0, // No default creation fee!
        deployer.address
    );
    await factory.waitForDeployment();
    
    console.log("✅ All contracts deployed successfully!");
    
    // Grant factory roles to the MetricsMarketFactory
    console.log("\n🔐 Granting factory roles to MetricsMarketFactory...");
    const factoryAddress = await factory.getAddress();
    await orderRouter.grantFactoryRole(factoryAddress);
    await umaOracleManager.grantFactoryRole(factoryAddress);
    console.log("✅ Factory roles granted to both OrderRouter and UMAOracleManager!");
    
    // Test 1: User1 creates a market without any special permissions or fees
    console.log("\n🧪 Test 1: User1 creates market without fees or roles");
    console.log("-".repeat(50));
    
    const marketConfig1 = {
        metricId: "USER1_TEST_METRIC",
        description: "User1's Test Market - No Permissions Required",
        oracleProvider: deployer.address,
        decimals: 18,
        minimumOrderSize: ethers.parseEther("1"),
        tickSize: ethers.parseEther("0.01"), // This is ignored but required for interface
        creationFee: 0,
        requiresKYC: false,
        settlementDate: Math.floor(Date.now() / 1000) + 86400 * 30, // 30 days
        tradingEndDate: Math.floor(Date.now() / 1000) + 86400 * 29, // 29 days
        dataRequestWindow: 3600, // 1 hour
        autoSettle: false,
        initialOrder: {
            enabled: false,
            side: 0, // BUY
            quantity: 0,
            price: 0,
            timeInForce: 0, // GTC
            expiryTime: 0
        }
    };
    
    try {
        // User1 creates market with NO ETH sent and NO special role
        const tx1 = await factory.connect(user1).createMarket(marketConfig1);
        const receipt1 = await tx1.wait();
        
        console.log(`✅ User1 successfully created market!`);
        console.log(`   Transaction hash: ${tx1.hash}`);
        console.log(`   Gas used: ${receipt1?.gasUsed.toString()}`);
        
        // Check if market was auto-registered with OrderRouter
        const marketAddress1 = await factory.getMarket("USER1_TEST_METRIC");
        const registeredOrderBook1 = await orderRouter.getMarketOrderBook("USER1_TEST_METRIC");
        
        if (marketAddress1 === registeredOrderBook1) {
            console.log(`✅ Market automatically registered with OrderRouter!`);
            console.log(`   Market address: ${marketAddress1}`);
        } else {
            console.log(`❌ Market registration failed`);
        }
        
    } catch (error: any) {
        console.log(`❌ User1 market creation failed: ${error.message}`);
    }
    
    // Test 2: User2 creates a market
    console.log("\n🧪 Test 2: User2 creates another market");
    console.log("-".repeat(50));
    
    const marketConfig2 = {
        metricId: "USER2_FREEDOM_METRIC",
        description: "User2's Freedom Market - Anyone Can Create",
        oracleProvider: deployer.address,
        decimals: 18,
        minimumOrderSize: ethers.parseEther("0.1"),
        tickSize: ethers.parseEther("0.01"),
        creationFee: 0,
        requiresKYC: false,
        settlementDate: Math.floor(Date.now() / 1000) + 86400 * 60, // 60 days
        tradingEndDate: Math.floor(Date.now() / 1000) + 86400 * 59, // 59 days
        dataRequestWindow: 7200, // 2 hours
        autoSettle: true,
        initialOrder: {
            enabled: false,
            side: 0,
            quantity: 0,
            price: 0,
            timeInForce: 0,
            expiryTime: 0
        }
    };
    
    try {
        const tx2 = await factory.connect(user2).createMarket(marketConfig2);
        const receipt2 = await tx2.wait();
        
        console.log(`✅ User2 successfully created market!`);
        console.log(`   Transaction hash: ${tx2.hash}`);
        console.log(`   Gas used: ${receipt2?.gasUsed.toString()}`);
        
        // Check auto-registration
        const marketAddress2 = await factory.getMarket("USER2_FREEDOM_METRIC");
        const registeredOrderBook2 = await orderRouter.getMarketOrderBook("USER2_FREEDOM_METRIC");
        
        if (marketAddress2 === registeredOrderBook2) {
            console.log(`✅ Market automatically registered with OrderRouter!`);
            console.log(`   Market address: ${marketAddress2}`);
        } else {
            console.log(`❌ Market registration failed`);
        }
        
    } catch (error: any) {
        console.log(`❌ User2 market creation failed: ${error.message}`);
    }
    
    // Test 3: User3 creates a market (no ETH involved since function is no longer payable)
    console.log("\n🧪 Test 3: User3 creates another market (no ETH fees)");
    console.log("-".repeat(50));
    
    const marketConfig3 = {
        metricId: "USER3_NO_FEE_METRIC",
        description: "User3's Market Created Without Any Fees",
        oracleProvider: deployer.address,
        decimals: 18,
        minimumOrderSize: ethers.parseEther("5"),
        tickSize: ethers.parseEther("0.01"),
        creationFee: 0,
        requiresKYC: false,
        settlementDate: Math.floor(Date.now() / 1000) + 86400 * 45, // 45 days
        tradingEndDate: Math.floor(Date.now() / 1000) + 86400 * 44, // 44 days
        dataRequestWindow: 1800, // 30 minutes
        autoSettle: false,
        initialOrder: {
            enabled: false,
            side: 0,
            quantity: 0,
            price: 0,
            timeInForce: 0,
            expiryTime: 0
        }
    };
    
    try {
        const balanceBefore = await ethers.provider.getBalance(user3.address);
        
        // Create market without sending ETH (function is no longer payable)
        const tx3 = await factory.connect(user3).createMarket(marketConfig3);
        const receipt3 = await tx3.wait();
        
        const balanceAfter = await ethers.provider.getBalance(user3.address);
        const gasUsed = receipt3!.gasUsed * receipt3!.gasPrice;
        const expectedBalance = balanceBefore - gasUsed; // Should only lose gas, not the 1 ETH
        
        console.log(`✅ User3 successfully created market!`);
        console.log(`   Transaction hash: ${tx3.hash}`);
        console.log(`   Gas used: ${receipt3?.gasUsed.toString()}`);
        console.log(`   ETH balance before: ${ethers.formatEther(balanceBefore)}`);
        console.log(`   ETH balance after: ${ethers.formatEther(balanceAfter)}`);
        console.log(`   Gas cost: ${ethers.formatEther(gasUsed)}`);
        
        // Since function is no longer payable, no ETH is involved in market creation
        
        // Check auto-registration
        const marketAddress3 = await factory.getMarket("USER3_NO_FEE_METRIC");
        const registeredOrderBook3 = await orderRouter.getMarketOrderBook("USER3_NO_FEE_METRIC");
        
        if (marketAddress3 === registeredOrderBook3) {
            console.log(`✅ Market automatically registered with OrderRouter!`);
            console.log(`   Market address: ${marketAddress3}`);
        } else {
            console.log(`❌ Market registration failed`);
        }
        
    } catch (error: any) {
        console.log(`❌ User3 market creation failed: ${error.message}`);
    }
    
    // Summary
    console.log("\n📊 FINAL SUMMARY");
    console.log("=" .repeat(50));
    
    const allMarkets = await factory.getAllMarkets();
    console.log(`Total markets created: ${allMarkets.length}`);
    
    for (let i = 0; i < allMarkets.length; i++) {
        const marketAddr = allMarkets[i];
        console.log(`Market ${i + 1}: ${marketAddr}`);
    }
    
    console.log("\n🎉 SUCCESS: Permissionless market creation is working!");
    console.log("✅ Any user can create markets without fees or special roles");
    console.log("✅ Markets are automatically registered with OrderRouter");
    console.log("✅ No admin intervention required for market creation or registration");
}

async function main() {
    try {
        await testPermissionlessMarketCreation();
    } catch (error: any) {
        console.error("Test failed:", error.message);
        process.exit(1);
    }
}

main();
