import { ethers } from "hardhat";
import { MatchingEngine } from "../src/services/MatchingEngine";
import { WebSocketService } from "../src/services/WebSocketService";
import { SettlementQueueService } from "../src/services/SettlementQueueService";
import { EventIndexerService } from "../src/services/EventIndexerService";
import { ServiceManager } from "../src/services/ServiceManager";
import { Logger } from "../src/services/Logger";
import { OrderLogger } from "../src/services/OrderLogger";
import { PNLLogger } from "../src/services/PNLLogger";
import { Order, OrderSide, OrderType, OrderStatus, TradeMatch } from "../src/types/Order";

// Configuration for off-chain services
const OFFCHAIN_CONFIG = {
  redis: {
    url: 'https://sharing-yak-45640.upstash.io',
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    useRestApi: true
  },
  websocket: {
    port: 3001,
    host: 'localhost'
  },
  settlement: {
    batchSize: 10,
    batchTimeoutMs: 5000,
    maxRetries: 3
  },
  matching: {
    priceTickSize: ethers.parseEther("0.01"),
    quantityTickSize: ethers.parseEther("0.1"),
    maxOrdersPerSide: 1000
  }
};

async function testOffchainIntegration() {
  console.log("🚀 TESTING OFF-CHAIN INTEGRATION");
  console.log("=".repeat(80));
  
  const logger = new Logger();
  const orderLogger = new OrderLogger();
  const pnlLogger = new PNLLogger();
  
  try {
    // Step 1: Deploy contracts (for settlement integration)
    console.log("\n📋 Step 1: Deploying Smart Contracts...");
    const deployResult = await deployContractsForOffchainTesting();
    
    // Step 2: Initialize off-chain services
    console.log("\n🔧 Step 2: Initializing Off-Chain Services...");
    const services = await initializeOffchainServices(deployResult);
    
    // Step 3: Test off-chain order submission
    console.log("\n📤 Step 3: Testing Off-Chain Order Submission...");
    await testOffchainOrderSubmission(services, deployResult);
    
    // Step 4: Test order matching
    console.log("\n🎯 Step 4: Testing Off-Chain Order Matching...");
    await testOffchainOrderMatching(services, deployResult);
    
    // Step 5: Test settlement queue
    console.log("\n⚡ Step 5: Testing Settlement Queue...");
    await testSettlementQueue(services, deployResult);
    
    // Step 6: Test event indexing
    console.log("\n📊 Step 6: Testing Event Indexing...");
    await testEventIndexing(services, deployResult);
    
    // Step 7: Performance metrics
    console.log("\n📈 Step 7: Gathering Performance Metrics...");
    await gatherPerformanceMetrics(services);
    
    console.log("\n✅ OFF-CHAIN INTEGRATION TEST COMPLETED SUCCESSFULLY!");
    
  } catch (error) {
    console.error("\n❌ OFF-CHAIN INTEGRATION TEST FAILED:", error);
    throw error;
  }
}

async function deployContractsForOffchainTesting() {
  const logger = new Logger();
  
  // Get signers
  const [deployer, trader1, trader2, trader3] = await ethers.getSigners();
  
  logger.log("Deploying contracts for off-chain testing...", {
    deployer: deployer.address,
    trader1: trader1.address,
    trader2: trader2.address,
    trader3: trader3.address
  });
  
  // Deploy Mock USDC
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy("Mock USD Coin", "USDC", 6);
  await mockUSDC.waitForDeployment();
  
  // Deploy CentralVault
  const CentralVault = await ethers.getContractFactory("CentralVault");
  const centralVault = await CentralVault.deploy();
  await centralVault.waitForDeployment();
  
  // Deploy OrderRouter
  const OrderRouter = await ethers.getContractFactory("OrderRouter");
  const orderRouter = await OrderRouter.deploy();
  await orderRouter.waitForDeployment();
  
  // Deploy MetricsMarketFactory
  const MetricsMarketFactory = await ethers.getContractFactory("MetricsMarketFactory");
  const marketFactory = await MetricsMarketFactory.deploy(
    await orderRouter.getAddress(),
    await centralVault.getAddress()
  );
  await marketFactory.waitForDeployment();
  
  // Setup roles and permissions
  const ROUTER_ADMIN_ROLE = await orderRouter.ROUTER_ADMIN_ROLE();
  await orderRouter.grantRole(ROUTER_ADMIN_ROLE, await marketFactory.getAddress());
  
  // Create a test market
  const metricId = "BTC-USD-SPOT";
  const createMarketTx = await marketFactory.createMarket(
    metricId,
    "Bitcoin USD Spot Price",
    await mockUSDC.getAddress(),
    ethers.parseEther("0.01"), // priceTickSize
    ethers.parseEther("0.1"),  // quantityTickSize
    ethers.parseEther("1000"), // minOrderSize
    ethers.parseEther("100000"), // maxOrderSize
    3600 // settlementWindow
  );
  await createMarketTx.wait();
  
  // Get the created OrderBook address
  const marketAddress = await orderRouter.getMarket(metricId);
  const OrderBook = await ethers.getContractFactory("OrderBook");
  const orderBook = OrderBook.attach(marketAddress);
  
  // Authorize the OrderBook with CentralVault
  await centralVault.setMarketAuthorization(marketAddress, true);
  
  // Setup test accounts with collateral
  const initialCollateral = ethers.parseUnits("10000", 6); // 10,000 USDC
  
  for (const trader of [trader1, trader2, trader3]) {
    // Mint USDC to trader
    await mockUSDC.mint(trader.address, initialCollateral);
    
    // Approve CentralVault to spend USDC
    await mockUSDC.connect(trader).approve(await centralVault.getAddress(), initialCollateral);
    
    // Deposit into CentralVault
    await centralVault.connect(trader).deposit(await mockUSDC.getAddress(), initialCollateral);
  }
  
  logger.log("Contract deployment completed", {
    mockUSDC: await mockUSDC.getAddress(),
    centralVault: await centralVault.getAddress(),
    orderRouter: await orderRouter.getAddress(),
    marketFactory: await marketFactory.getAddress(),
    orderBook: marketAddress,
    metricId
  });
  
  return {
    contracts: {
      mockUSDC,
      centralVault,
      orderRouter,
      marketFactory,
      orderBook
    },
    addresses: {
      mockUSDC: await mockUSDC.getAddress(),
      centralVault: await centralVault.getAddress(),
      orderRouter: await orderRouter.getAddress(),
      marketFactory: await marketFactory.getAddress(),
      orderBook: marketAddress
    },
    metricId,
    traders: { deployer, trader1, trader2, trader3 }
  };
}

async function initializeOffchainServices(deployResult: any) {
  const logger = new Logger();
  
  logger.log("Initializing off-chain services...");
  
  // Create service configuration
  const serviceConfig = {
    ...OFFCHAIN_CONFIG,
    contracts: deployResult.addresses,
    provider: ethers.provider,
    metricId: deployResult.metricId
  };
  
  // Initialize ServiceManager
  const serviceManager = new ServiceManager(serviceConfig);
  
  // Start all services
  await serviceManager.start();
  
  // Get individual service instances
  const matchingEngine = serviceManager.getService('matching') as MatchingEngine;
  const webSocketService = serviceManager.getService('websocket') as WebSocketService;
  const settlementQueue = serviceManager.getService('settlement') as SettlementQueueService;
  const eventIndexer = serviceManager.getService('indexer') as EventIndexerService;
  
  logger.log("All off-chain services started successfully", {
    matchingEngine: !!matchingEngine,
    webSocketService: !!webSocketService,
    settlementQueue: !!settlementQueue,
    eventIndexer: !!eventIndexer
  });
  
  return {
    serviceManager,
    matchingEngine,
    webSocketService,
    settlementQueue,
    eventIndexer
  };
}

async function testOffchainOrderSubmission(services: any, deployResult: any) {
  const orderLogger = new OrderLogger();
  const { trader1, trader2 } = deployResult.traders;
  
  orderLogger.logOrderSubmission("Testing off-chain order submission...");
  
  // Create test orders
  const buyOrder: Order = {
    orderId: `offchain-buy-${Date.now()}`,
    trader: trader1.address,
    metricId: deployResult.metricId,
    side: OrderSide.BUY,
    orderType: OrderType.LIMIT,
    quantity: ethers.parseEther("2.0"),
    price: ethers.parseEther("45000.00"),
    stopPrice: ethers.ZeroHash,
    timeInForce: "GTC",
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    nonce: BigInt(1),
    signature: "0x",
    icebergQty: ethers.ZeroHash,
    postOnly: false,
    metadataHash: ethers.ZeroHash
  };
  
  const sellOrder: Order = {
    orderId: `offchain-sell-${Date.now()}`,
    trader: trader2.address,
    metricId: deployResult.metricId,
    side: OrderSide.SELL,
    orderType: OrderType.LIMIT,
    quantity: ethers.parseEther("1.5"),
    price: ethers.parseEther("45050.00"),
    stopPrice: ethers.ZeroHash,
    timeInForce: "GTC",
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    nonce: BigInt(1),
    signature: "0x",
    icebergQty: ethers.ZeroHash,
    postOnly: false,
    metadataHash: ethers.ZeroHash
  };
  
  // Submit orders to off-chain matching engine
  const buyResult = await services.matchingEngine.submitOrder(buyOrder);
  orderLogger.logOrderResult("Buy order submitted to off-chain engine", buyResult);
  
  const sellResult = await services.matchingEngine.submitOrder(sellOrder);
  orderLogger.logOrderResult("Sell order submitted to off-chain engine", sellResult);
  
  // Verify order book state
  const orderBookState = await services.matchingEngine.getOrderBookState(deployResult.metricId);
  orderLogger.logOrderBook("Off-chain order book state", orderBookState);
  
  return { buyResult, sellResult, orderBookState };
}

async function testOffchainOrderMatching(services: any, deployResult: any) {
  const orderLogger = new OrderLogger();
  const { trader1, trader2 } = deployResult.traders;
  
  orderLogger.logOrderSubmission("Testing off-chain order matching...");
  
  // Create matching orders
  const buyOrder: Order = {
    orderId: `match-buy-${Date.now()}`,
    trader: trader1.address,
    metricId: deployResult.metricId,
    side: OrderSide.BUY,
    orderType: OrderType.LIMIT,
    quantity: ethers.parseEther("1.0"),
    price: ethers.parseEther("45100.00"), // Higher than sell price to ensure match
    stopPrice: ethers.ZeroHash,
    timeInForce: "GTC",
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    nonce: BigInt(2),
    signature: "0x",
    icebergQty: ethers.ZeroHash,
    postOnly: false,
    metadataHash: ethers.ZeroHash
  };
  
  const sellOrder: Order = {
    orderId: `match-sell-${Date.now()}`,
    trader: trader2.address,
    metricId: deployResult.metricId,
    side: OrderSide.SELL,
    orderType: OrderType.LIMIT,
    quantity: ethers.parseEther("1.0"),
    price: ethers.parseEther("45000.00"), // Lower than buy price to ensure match
    stopPrice: ethers.ZeroHash,
    timeInForce: "GTC",
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    nonce: BigInt(2),
    signature: "0x",
    icebergQty: ethers.ZeroHash,
    postOnly: false,
    metadataHash: ethers.ZeroHash
  };
  
  // Submit sell order first (it will sit in order book)
  const sellResult = await services.matchingEngine.submitOrder(sellOrder);
  orderLogger.logOrderResult("Sell order placed in order book", sellResult);
  
  // Submit buy order (should match with sell order)
  const buyResult = await services.matchingEngine.submitOrder(buyOrder);
  orderLogger.logOrderResult("Buy order submitted - should match!", buyResult);
  
  // Check if match occurred
  if (buyResult.matches && buyResult.matches.length > 0) {
    orderLogger.logMatches("🎯 OFF-CHAIN MATCH DETECTED!", buyResult.matches);
  } else {
    console.log("⚠️  No matches detected in off-chain engine");
  }
  
  return { buyResult, sellResult };
}

async function testSettlementQueue(services: any, deployResult: any) {
  const orderLogger = new OrderLogger();
  
  orderLogger.logOrderSubmission("Testing settlement queue processing...");
  
  // Check pending settlements
  const pendingTrades = await services.settlementQueue.getPendingTrades();
  orderLogger.log("Pending trades in settlement queue", { count: pendingTrades.length });
  
  if (pendingTrades.length > 0) {
    console.log("⚡ Processing settlement queue...");
    
    // Process pending settlements
    const settlementResult = await services.settlementQueue.processPendingSettlements();
    orderLogger.logOrderResult("Settlement processing result", settlementResult);
    
    // Wait for blockchain confirmations
    console.log("⏳ Waiting for blockchain confirmations...");
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check settlement status
    const remainingPending = await services.settlementQueue.getPendingTrades();
    orderLogger.log("Remaining pending trades", { count: remainingPending.length });
  } else {
    console.log("📝 No pending trades to settle");
  }
  
  return { pendingTrades };
}

async function testEventIndexing(services: any, deployResult: any) {
  const logger = new Logger();
  
  logger.log("Testing event indexing and synchronization...");
  
  // Trigger manual sync with blockchain
  await services.eventIndexer.syncWithBlockchain();
  
  // Get indexed events
  const events = await services.eventIndexer.getRecentEvents(deployResult.metricId);
  logger.log("Recent indexed events", { count: events.length, events });
  
  return { events };
}

async function gatherPerformanceMetrics(services: any) {
  const logger = new Logger();
  
  logger.log("Gathering performance metrics...");
  
  // Get matching engine metrics
  const matchingMetrics = await services.matchingEngine.getPerformanceMetrics();
  logger.log("Matching Engine Performance", matchingMetrics);
  
  // Get settlement queue metrics
  const settlementMetrics = await services.settlementQueue.getMetrics();
  logger.log("Settlement Queue Performance", settlementMetrics);
  
  // Get WebSocket metrics
  const wsMetrics = await services.webSocketService.getMetrics();
  logger.log("WebSocket Service Performance", wsMetrics);
  
  return { matchingMetrics, settlementMetrics, wsMetrics };
}

// Export for use in other test files
export {
  testOffchainIntegration,
  deployContractsForOffchainTesting,
  initializeOffchainServices,
  OFFCHAIN_CONFIG
};

// Main execution
if (require.main === module) {
  testOffchainIntegration()
    .then(() => {
      console.log("✅ Off-chain integration test completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Off-chain integration test failed:", error);
      process.exit(1);
    });
}
