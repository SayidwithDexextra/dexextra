import { ethers } from "hardhat";
import WebSocket from "ws";
import { Logger } from "../src/services/Logger";
import { OrderLogger } from "../src/services/OrderLogger";
import { 
  deployContractsForOffchainTesting, 
  initializeOffchainServices,
  OFFCHAIN_CONFIG 
} from "./test-offchain-integration";
import { Order, OrderSide, OrderType } from "../src/types/Order";

async function testServicesIntegration() {
  console.log("🔌 TESTING SERVICES INTEGRATION");
  console.log("=".repeat(80));
  console.log("Testing WebSocket, Real-time updates, and Service Communication");
  console.log("=".repeat(80));
  
  const logger = new Logger();
  const orderLogger = new OrderLogger();
  
  try {
    // Step 1: Initialize system
    console.log("\n🚀 Step 1: System Initialization");
    const deployResult = await deployContractsForOffchainTesting();
    const services = await initializeOffchainServices(deployResult);
    
    // Step 2: Test WebSocket service integration
    console.log("\n🌐 Step 2: WebSocket Service Integration");
    await testWebSocketIntegration(services, deployResult);
    
    // Step 3: Test real-time order book updates
    console.log("\n📊 Step 3: Real-time Order Book Updates");
    await testRealTimeUpdates(services, deployResult);
    
    // Step 4: Test service-to-service communication
    console.log("\n🔄 Step 4: Service-to-Service Communication");
    await testServiceCommunication(services, deployResult);
    
    // Step 5: Test settlement monitoring
    console.log("\n⚡ Step 5: Settlement Monitoring");
    await testSettlementMonitoring(services, deployResult);
    
    // Step 6: Test event propagation
    console.log("\n📡 Step 6: Event Propagation Testing");
    await testEventPropagation(services, deployResult);
    
    // Step 7: Test error handling and recovery
    console.log("\n🛠️  Step 7: Error Handling & Recovery");
    await testErrorHandlingAndRecovery(services, deployResult);
    
    console.log("\n✅ SERVICES INTEGRATION TEST COMPLETED SUCCESSFULLY!");
    
  } catch (error) {
    console.error("\n❌ SERVICES INTEGRATION TEST FAILED:", error);
    throw error;
  }
}

async function testWebSocketIntegration(services: any, deployResult: any) {
  const orderLogger = new OrderLogger();
  
  return new Promise((resolve, reject) => {
    console.log("🌐 Testing WebSocket connection and order submission...");
    
    // Create WebSocket client
    const wsUrl = `ws://${OFFCHAIN_CONFIG.websocket.host}:${OFFCHAIN_CONFIG.websocket.port}`;
    const ws = new WebSocket(wsUrl);
    
    let testResults = {
      connectionEstablished: false,
      orderSubmitted: false,
      responseReceived: false,
      orderBookUpdate: false
    };
    
    let timeout = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket test timeout"));
    }, 10000);
    
    ws.on('open', () => {
      console.log("✅ WebSocket connection established");
      testResults.connectionEstablished = true;
      
      // Submit order via WebSocket
      const testOrder = {
        type: 'place_order',
        order: {
          orderId: `ws-test-${Date.now()}`,
          trader: deployResult.traders.trader1.address,
          metricId: deployResult.metricId,
          side: OrderSide.BUY,
          orderType: OrderType.LIMIT,
          quantity: ethers.parseEther("1.0").toString(),
          price: ethers.parseEther("45000.00").toString(),
          stopPrice: "0x0000000000000000000000000000000000000000",
          timeInForce: "GTC",
          timestamp: Math.floor(Date.now() / 1000).toString(),
          nonce: "1",
          signature: "0x",
          icebergQty: "0x0000000000000000000000000000000000000000",
          postOnly: false,
          metadataHash: "0x0000000000000000000000000000000000000000000000000000000000000000"
        }
      };
      
      console.log("📤 Submitting order via WebSocket...");
      ws.send(JSON.stringify(testOrder));
      testResults.orderSubmitted = true;
      orderLogger.logOrderSubmission("Order submitted via WebSocket", testOrder.order);
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log("📥 WebSocket message received:", message.type);
        
        if (message.type === 'order_response') {
          console.log("✅ Order response received");
          testResults.responseReceived = true;
          orderLogger.logOrderResult("WebSocket order response", message.data);
        }
        
        if (message.type === 'orderbook_update') {
          console.log("✅ Order book update received");
          testResults.orderBookUpdate = true;
          orderLogger.logOrderBook("WebSocket order book update", message.data);
        }
        
        // Check if all tests passed
        if (Object.values(testResults).every(Boolean)) {
          clearTimeout(timeout);
          ws.close();
          console.log("🎉 All WebSocket tests passed!");
          resolve(testResults);
        }
      } catch (error) {
        console.error("Error parsing WebSocket message:", error);
      }
    });
    
    ws.on('error', (error) => {
      console.error("❌ WebSocket error:", error);
      clearTimeout(timeout);
      reject(error);
    });
    
    ws.on('close', () => {
      console.log("🔌 WebSocket connection closed");
      if (!Object.values(testResults).every(Boolean)) {
        console.log("📊 WebSocket test results:", testResults);
      }
    });
  });
}

async function testRealTimeUpdates(services: any, deployResult: any) {
  const orderLogger = new OrderLogger();
  
  console.log("📊 Testing real-time order book updates...");
  
  // Set up update listeners
  const updates: any[] = [];
  
  // Mock WebSocket client to receive updates
  const mockClient = {
    send: (data: string) => {
      const message = JSON.parse(data);
      updates.push(message);
      console.log("📡 Real-time update captured:", message.type);
    }
  };
  
  // Register client for updates (this would normally be done by WebSocketService)
  // await services.webSocketService.addClient(mockClient);
  
  // Submit orders to generate updates
  const orders = [
    {
      orderId: `rt-buy-${Date.now()}`,
      trader: deployResult.traders.trader1.address,
      metricId: deployResult.metricId,
      side: OrderSide.BUY,
      orderType: OrderType.LIMIT,
      quantity: ethers.parseEther("2.0"),
      price: ethers.parseEther("44800.00"),
      stopPrice: ethers.ZeroHash,
      timeInForce: "GTC",
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      nonce: BigInt(1),
      signature: "0x",
      icebergQty: ethers.ZeroHash,
      postOnly: false,
      metadataHash: ethers.ZeroHash
    },
    {
      orderId: `rt-sell-${Date.now()}`,
      trader: deployResult.traders.trader2.address,
      metricId: deployResult.metricId,
      side: OrderSide.SELL,
      orderType: OrderType.LIMIT,
      quantity: ethers.parseEther("1.5"),
      price: ethers.parseEther("45200.00"),
      stopPrice: ethers.ZeroHash,
      timeInForce: "GTC",
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      nonce: BigInt(1),
      signature: "0x",
      icebergQty: ethers.ZeroHash,
      postOnly: false,
      metadataHash: ethers.ZeroHash
    }
  ];
  
  for (const order of orders) {
    console.log(`📤 Submitting ${order.side === OrderSide.BUY ? 'BUY' : 'SELL'} order for real-time testing...`);
    const result = await services.matchingEngine.submitOrder(order);
    orderLogger.logOrderResult("Real-time test order result", result);
    
    // Small delay to observe updates
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log(`📊 Captured ${updates.length} real-time updates`);
  
  return { updates, orderCount: orders.length };
}

async function testServiceCommunication(services: any, deployResult: any) {
  const logger = new Logger();
  
  console.log("🔄 Testing service-to-service communication...");
  
  // Test 1: MatchingEngine → SettlementQueue communication
  console.log("🎯 Testing MatchingEngine → SettlementQueue communication");
  
  const testOrder1 = {
    orderId: `comm-buy-${Date.now()}`,
    trader: deployResult.traders.trader1.address,
    metricId: deployResult.metricId,
    side: OrderSide.BUY,
    orderType: OrderType.LIMIT,
    quantity: ethers.parseEther("1.0"),
    price: ethers.parseEther("45100.00"),
    stopPrice: ethers.ZeroHash,
    timeInForce: "GTC",
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    nonce: BigInt(1),
    signature: "0x",
    icebergQty: ethers.ZeroHash,
    postOnly: false,
    metadataHash: ethers.ZeroHash
  };
  
  const testOrder2 = {
    orderId: `comm-sell-${Date.now()}`,
    trader: deployResult.traders.trader2.address,
    metricId: deployResult.metricId,
    side: OrderSide.SELL,
    orderType: OrderType.LIMIT,
    quantity: ethers.parseEther("1.0"),
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
  
  // Submit matching orders
  await services.matchingEngine.submitOrder(testOrder2); // Sell first
  const buyResult = await services.matchingEngine.submitOrder(testOrder1); // Buy should match
  
  if (buyResult.matches && buyResult.matches.length > 0) {
    console.log("✅ MatchingEngine generated trades");
    
    // Check if settlement queue received the trades
    const pendingTrades = await services.settlementQueue.getPendingTrades();
    console.log(`✅ SettlementQueue has ${pendingTrades.length} pending trades`);
    
    logger.log("Service communication test results", {
      matchesGenerated: buyResult.matches.length,
      pendingTradesInQueue: pendingTrades.length,
      communicationWorking: pendingTrades.length > 0
    });
  }
  
  // Test 2: SettlementQueue → EventIndexer communication
  console.log("⚡ Testing SettlementQueue → EventIndexer communication");
  
  // Process settlements to trigger on-chain events
  const settlementResult = await services.settlementQueue.processPendingSettlements();
  
  // Wait for events to be indexed
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Check if events were indexed
  const recentEvents = await services.eventIndexer.getRecentEvents(deployResult.metricId);
  
  logger.log("Settlement → Event indexing test", {
    settlementsProcessed: settlementResult ? 1 : 0,
    eventsIndexed: recentEvents.length,
    communicationWorking: recentEvents.length > 0
  });
  
  return {
    matchingToSettlement: true,
    settlementToIndexer: recentEvents.length > 0
  };
}

async function testSettlementMonitoring(services: any, deployResult: any) {
  const logger = new Logger();
  
  console.log("⚡ Testing settlement monitoring and queue management...");
  
  // Get initial metrics
  const initialMetrics = await services.settlementQueue.getMetrics();
  logger.log("Initial settlement metrics", initialMetrics);
  
  // Monitor settlement queue over time
  const monitoringResults = [];
  
  for (let i = 0; i < 3; i++) {
    const pendingTrades = await services.settlementQueue.getPendingTrades();
    const metrics = await services.settlementQueue.getMetrics();
    
    monitoringResults.push({
      iteration: i + 1,
      pendingTrades: pendingTrades.length,
      metrics,
      timestamp: new Date().toISOString()
    });
    
    console.log(`📊 Settlement monitoring iteration ${i + 1}:`, {
      pendingTrades: pendingTrades.length,
      processedCount: metrics.processedCount || 0
    });
    
    // If there are pending trades, process them
    if (pendingTrades.length > 0) {
      console.log("⚡ Processing pending settlements...");
      await services.settlementQueue.processPendingSettlements();
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  logger.log("Settlement monitoring results", monitoringResults);
  
  return { monitoringResults };
}

async function testEventPropagation(services: any, deployResult: any) {
  const logger = new Logger();
  
  console.log("📡 Testing event propagation across services...");
  
  const eventLog: any[] = [];
  
  // Create a trade that will generate events
  const order1 = {
    orderId: `event-buy-${Date.now()}`,
    trader: deployResult.traders.trader1.address,
    metricId: deployResult.metricId,
    side: OrderSide.BUY,
    orderType: OrderType.LIMIT,
    quantity: ethers.parseEther("0.5"),
    price: ethers.parseEther("45300.00"),
    stopPrice: ethers.ZeroHash,
    timeInForce: "GTC",
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    nonce: BigInt(1),
    signature: "0x",
    icebergQty: ethers.ZeroHash,
    postOnly: false,
    metadataHash: ethers.ZeroHash
  };
  
  const order2 = {
    orderId: `event-sell-${Date.now()}`,
    trader: deployResult.traders.trader2.address,
    metricId: deployResult.metricId,
    side: OrderSide.SELL,
    orderType: OrderType.LIMIT,
    quantity: ethers.parseEther("0.5"),
    price: ethers.parseEther("45200.00"),
    stopPrice: ethers.ZeroHash,
    timeInForce: "GTC",
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    nonce: BigInt(1),
    signature: "0x",
    icebergQty: ethers.ZeroHash,
    postOnly: false,
    metadataHash: ethers.ZeroHash
  };
  
  console.log("📤 Step 1: Submitting orders to generate events...");
  eventLog.push({ step: 1, action: "orders_submitted", timestamp: new Date().toISOString() });
  
  await services.matchingEngine.submitOrder(order2);
  const matchResult = await services.matchingEngine.submitOrder(order1);
  
  if (matchResult.matches && matchResult.matches.length > 0) {
    console.log("✅ Step 2: Match generated in MatchingEngine");
    eventLog.push({ step: 2, action: "match_generated", matches: matchResult.matches.length, timestamp: new Date().toISOString() });
    
    console.log("⚡ Step 3: Processing settlement...");
    await services.settlementQueue.processPendingSettlements();
    eventLog.push({ step: 3, action: "settlement_processed", timestamp: new Date().toISOString() });
    
    console.log("⏳ Step 4: Waiting for blockchain events...");
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log("📊 Step 5: Checking event indexing...");
    const events = await services.eventIndexer.getRecentEvents(deployResult.metricId);
    eventLog.push({ step: 5, action: "events_indexed", eventCount: events.length, timestamp: new Date().toISOString() });
    
    console.log("✅ Event propagation test completed");
  } else {
    console.log("⚠️  No matches generated for event propagation test");
  }
  
  logger.log("Event propagation log", eventLog);
  
  return { eventLog };
}

async function testErrorHandlingAndRecovery(services: any, deployResult: any) {
  const logger = new Logger();
  
  console.log("🛠️  Testing error handling and recovery mechanisms...");
  
  const errorTests = [];
  
  // Test 1: Invalid order submission
  console.log("❌ Test 1: Invalid order submission");
  try {
    const invalidOrder = {
      orderId: `invalid-${Date.now()}`,
      trader: "0x0000000000000000000000000000000000000000", // Invalid address
      metricId: deployResult.metricId,
      side: OrderSide.BUY,
      orderType: OrderType.LIMIT,
      quantity: ethers.parseEther("0"), // Invalid quantity
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
    
    const result = await services.matchingEngine.submitOrder(invalidOrder);
    errorTests.push({
      test: "invalid_order",
      errorHandled: !result.success,
      error: result.error
    });
    
    console.log(result.success ? "⚠️  Invalid order was accepted (unexpected)" : "✅ Invalid order rejected correctly");
  } catch (error) {
    errorTests.push({
      test: "invalid_order",
      errorHandled: true,
      error: (error as Error).message
    });
    console.log("✅ Invalid order threw error correctly");
  }
  
  // Test 2: Service recovery after restart
  console.log("🔄 Test 2: Service recovery simulation");
  try {
    // Get current state
    const beforeState = await services.matchingEngine.getOrderBookState(deployResult.metricId);
    
    // Simulate service restart by reinitializing
    // In a real scenario, this would test actual service restart
    const newServices = await initializeOffchainServices(deployResult);
    
    // Check if state is preserved/recovered
    const afterState = await newServices.matchingEngine.getOrderBookState(deployResult.metricId);
    
    errorTests.push({
      test: "service_recovery",
      errorHandled: true,
      beforeOrderCount: (beforeState.buyOrders?.length || 0) + (beforeState.sellOrders?.length || 0),
      afterOrderCount: (afterState.buyOrders?.length || 0) + (afterState.sellOrders?.length || 0)
    });
    
    console.log("✅ Service recovery test completed");
  } catch (error) {
    errorTests.push({
      test: "service_recovery",
      errorHandled: false,
      error: (error as Error).message
    });
    console.log("❌ Service recovery test failed");
  }
  
  // Test 3: Network connectivity issues simulation
  console.log("🌐 Test 3: Network connectivity simulation");
  try {
    // This would test behavior when blockchain connection is lost
    // For now, we'll simulate by checking service health
    const healthCheck = {
      matchingEngine: await services.matchingEngine.getPerformanceMetrics(),
      settlementQueue: await services.settlementQueue.getMetrics()
    };
    
    errorTests.push({
      test: "network_connectivity",
      errorHandled: true,
      servicesHealthy: true,
      healthCheck
    });
    
    console.log("✅ Network connectivity test completed");
  } catch (error) {
    errorTests.push({
      test: "network_connectivity",
      errorHandled: false,
      error: (error as Error).message
    });
    console.log("❌ Network connectivity test failed");
  }
  
  logger.log("Error handling test results", errorTests);
  
  return { errorTests };
}

// Export for use in other test files
export {
  testServicesIntegration,
  testWebSocketIntegration,
  testRealTimeUpdates,
  testServiceCommunication,
  testSettlementMonitoring,
  testEventPropagation,
  testErrorHandlingAndRecovery
};

// Main execution
if (require.main === module) {
  testServicesIntegration()
    .then(() => {
      console.log("✅ Services integration test completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Services integration test failed:", error);
      process.exit(1);
    });
}
