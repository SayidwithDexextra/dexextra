import { ethers } from "hardhat";
import { performance } from "perf_hooks";
import { Logger } from "../src/services/Logger";
import { OrderLogger } from "../src/services/OrderLogger";
import { PNLLogger } from "../src/services/PNLLogger";
import { 
  deployContractsForOffchainTesting, 
  initializeOffchainServices,
  OFFCHAIN_CONFIG 
} from "./test-offchain-integration";
import { Order, OrderSide, OrderType } from "../src/types/Order";

interface BenchmarkResults {
  scenario: string;
  approach: 'on-chain' | 'off-chain' | 'hybrid';
  orderCount: number;
  totalTime: number;
  averageLatency: number;
  throughput: number;
  gasUsed?: string;
  costEstimate?: string;
  successRate: number;
  errors: number;
}

interface BenchmarkConfig {
  orderCounts: number[];
  priceRange: { min: number; max: number };
  quantityRange: { min: number; max: number };
  iterations: number;
}

const BENCHMARK_CONFIG: BenchmarkConfig = {
  orderCounts: [10, 50, 100, 500],
  priceRange: { min: 44000, max: 46000 },
  quantityRange: { min: 0.1, max: 5.0 },
  iterations: 3
};

async function benchmarkMatchingPerformance() {
  console.log("🏁 BENCHMARK: MATCHING PERFORMANCE ANALYSIS");
  console.log("=".repeat(90));
  console.log("Comparing On-Chain vs Off-Chain vs Hybrid Order Matching Performance");
  console.log("=".repeat(90));
  
  const logger = new Logger();
  const orderLogger = new OrderLogger();
  const pnlLogger = new PNLLogger();
  
  try {
    // Initialize system
    console.log("\n🚀 Initializing Benchmark Environment...");
    const deployResult = await deployContractsForOffchainTesting();
    const services = await initializeOffchainServices(deployResult);
    
    const allResults: BenchmarkResults[] = [];
    
    // Run benchmarks for different order counts
    for (const orderCount of BENCHMARK_CONFIG.orderCounts) {
      console.log(`\n📊 Benchmarking with ${orderCount} orders`);
      console.log("-".repeat(60));
      
      // Benchmark 1: On-Chain Direct
      console.log(`\n🔗 Benchmark: ${orderCount} orders - ON-CHAIN DIRECT`);
      const onChainResults = await benchmarkOnChainDirect(deployResult, orderCount);
      allResults.push(onChainResults);
      
      // Benchmark 2: Off-Chain Only
      console.log(`\n⚡ Benchmark: ${orderCount} orders - OFF-CHAIN ONLY`);
      const offChainResults = await benchmarkOffChainOnly(services, deployResult, orderCount);
      allResults.push(offChainResults);
      
      // Benchmark 3: Hybrid (Off-Chain + Settlement)
      console.log(`\n🌉 Benchmark: ${orderCount} orders - HYBRID SYSTEM`);
      const hybridResults = await benchmarkHybridSystem(services, deployResult, orderCount);
      allResults.push(hybridResults);
      
      // Performance comparison for this order count
      console.log(`\n📈 Performance Comparison (${orderCount} orders):`);
      printPerformanceComparison([onChainResults, offChainResults, hybridResults]);
    }
    
    // Overall analysis
    console.log("\n🎯 COMPREHENSIVE PERFORMANCE ANALYSIS");
    console.log("=".repeat(90));
    await performComprehensiveAnalysis(allResults);
    
    // Scalability analysis
    console.log("\n📈 SCALABILITY ANALYSIS");
    console.log("=".repeat(90));
    await performScalabilityAnalysis(allResults);
    
    // Cost analysis
    console.log("\n💰 COST ANALYSIS");
    console.log("=".repeat(90));
    await performCostAnalysis(allResults);
    
    // Recommendations
    console.log("\n💡 PERFORMANCE RECOMMENDATIONS");
    console.log("=".repeat(90));
    generatePerformanceRecommendations(allResults);
    
    console.log("\n✅ BENCHMARK ANALYSIS COMPLETED!");
    
  } catch (error) {
    console.error("\n❌ BENCHMARK FAILED:", error);
    throw error;
  }
}

async function benchmarkOnChainDirect(deployResult: any, orderCount: number): Promise<BenchmarkResults> {
  const logger = new Logger();
  const { trader1, trader2 } = deployResult.traders;
  const { orderRouter } = deployResult.contracts;
  
  logger.log(`Starting on-chain direct benchmark with ${orderCount} orders`);
  
  const orders = generateTestOrders(orderCount, deployResult.metricId, [trader1.address, trader2.address]);
  const results = {
    scenario: `${orderCount} orders`,
    approach: 'on-chain' as const,
    orderCount,
    totalTime: 0,
    averageLatency: 0,
    throughput: 0,
    gasUsed: "0",
    costEstimate: "0",
    successRate: 0,
    errors: 0
  };
  
  let totalGasUsed = BigInt(0);
  let successfulOrders = 0;
  let totalLatency = 0;
  
  const startTime = performance.now();
  
  for (const [index, orderData] of orders.entries()) {
    const orderStartTime = performance.now();
    
    try {
      // Convert to on-chain order format
      const onChainOrder = {
        trader: orderData.trader,
        metricId: orderData.metricId,
        side: orderData.side,
        orderType: orderData.orderType,
        quantity: orderData.quantity,
        price: orderData.price,
        stopPrice: orderData.stopPrice,
        timeInForce: orderData.timeInForce,
        timestamp: orderData.timestamp,
        nonce: orderData.nonce,
        signature: orderData.signature,
        icebergQty: orderData.icebergQty,
        postOnly: orderData.postOnly,
        metadataHash: orderData.metadataHash
      };
      
      // Submit directly to smart contract
      const trader = orderData.trader === trader1.address ? trader1 : trader2;
      const tx = await orderRouter.connect(trader).placeOrder(onChainOrder);
      const receipt = await tx.wait();
      
      totalGasUsed += receipt.gasUsed;
      successfulOrders++;
      
      const orderLatency = performance.now() - orderStartTime;
      totalLatency += orderLatency;
      
      if ((index + 1) % 10 === 0) {
        console.log(`  📋 Processed ${index + 1}/${orderCount} on-chain orders`);
      }
      
    } catch (error) {
      results.errors++;
      console.log(`  ❌ On-chain order ${index + 1} failed:`, (error as Error).message);
    }
  }
  
  const endTime = performance.now();
  results.totalTime = endTime - startTime;
  results.averageLatency = successfulOrders > 0 ? totalLatency / successfulOrders : 0;
  results.throughput = successfulOrders > 0 ? (successfulOrders / results.totalTime) * 1000 : 0;
  results.gasUsed = totalGasUsed.toString();
  results.costEstimate = estimateGasCost(totalGasUsed);
  results.successRate = (successfulOrders / orderCount) * 100;
  
  logger.log("On-chain direct benchmark completed", {
    totalTime: `${results.totalTime.toFixed(2)}ms`,
    averageLatency: `${results.averageLatency.toFixed(2)}ms`,
    throughput: `${results.throughput.toFixed(2)} orders/sec`,
    successRate: `${results.successRate.toFixed(1)}%`,
    gasUsed: results.gasUsed,
    costEstimate: results.costEstimate
  });
  
  return results;
}

async function benchmarkOffChainOnly(services: any, deployResult: any, orderCount: number): Promise<BenchmarkResults> {
  const logger = new Logger();
  
  logger.log(`Starting off-chain only benchmark with ${orderCount} orders`);
  
  const orders = generateTestOrders(orderCount, deployResult.metricId, [
    deployResult.traders.trader1.address, 
    deployResult.traders.trader2.address
  ]);
  
  const results = {
    scenario: `${orderCount} orders`,
    approach: 'off-chain' as const,
    orderCount,
    totalTime: 0,
    averageLatency: 0,
    throughput: 0,
    successRate: 0,
    errors: 0
  };
  
  let successfulOrders = 0;
  let totalLatency = 0;
  
  const startTime = performance.now();
  
  for (const [index, order] of orders.entries()) {
    const orderStartTime = performance.now();
    
    try {
      const result = await services.matchingEngine.submitOrder(order);
      
      if (result.success) {
        successfulOrders++;
      } else {
        results.errors++;
      }
      
      const orderLatency = performance.now() - orderStartTime;
      totalLatency += orderLatency;
      
      if ((index + 1) % 50 === 0) {
        console.log(`  ⚡ Processed ${index + 1}/${orderCount} off-chain orders`);
      }
      
    } catch (error) {
      results.errors++;
      console.log(`  ❌ Off-chain order ${index + 1} failed:`, (error as Error).message);
    }
  }
  
  const endTime = performance.now();
  results.totalTime = endTime - startTime;
  results.averageLatency = successfulOrders > 0 ? totalLatency / successfulOrders : 0;
  results.throughput = successfulOrders > 0 ? (successfulOrders / results.totalTime) * 1000 : 0;
  results.successRate = (successfulOrders / orderCount) * 100;
  
  logger.log("Off-chain only benchmark completed", {
    totalTime: `${results.totalTime.toFixed(2)}ms`,
    averageLatency: `${results.averageLatency.toFixed(2)}ms`,
    throughput: `${results.throughput.toFixed(2)} orders/sec`,
    successRate: `${results.successRate.toFixed(1)}%`
  });
  
  return results;
}

async function benchmarkHybridSystem(services: any, deployResult: any, orderCount: number): Promise<BenchmarkResults> {
  const logger = new Logger();
  
  logger.log(`Starting hybrid system benchmark with ${orderCount} orders`);
  
  const orders = generateTestOrders(orderCount, deployResult.metricId, [
    deployResult.traders.trader1.address, 
    deployResult.traders.trader2.address
  ]);
  
  const results = {
    scenario: `${orderCount} orders`,
    approach: 'hybrid' as const,
    orderCount,
    totalTime: 0,
    averageLatency: 0,
    throughput: 0,
    gasUsed: "0",
    costEstimate: "0",
    successRate: 0,
    errors: 0
  };
  
  let successfulOrders = 0;
  let totalLatency = 0;
  let totalGasUsed = BigInt(0);
  
  const startTime = performance.now();
  
  // Phase 1: Off-chain matching
  const matchingStartTime = performance.now();
  for (const [index, order] of orders.entries()) {
    const orderStartTime = performance.now();
    
    try {
      const result = await services.matchingEngine.submitOrder(order);
      
      if (result.success) {
        successfulOrders++;
      } else {
        results.errors++;
      }
      
      const orderLatency = performance.now() - orderStartTime;
      totalLatency += orderLatency;
      
      if ((index + 1) % 50 === 0) {
        console.log(`  🌉 Processed ${index + 1}/${orderCount} hybrid orders (matching)`);
      }
      
    } catch (error) {
      results.errors++;
      console.log(`  ❌ Hybrid order ${index + 1} failed:`, (error as Error).message);
    }
  }
  
  const matchingTime = performance.now() - matchingStartTime;
  console.log(`  ⚡ Off-chain matching completed in ${matchingTime.toFixed(2)}ms`);
  
  // Phase 2: Settlement processing
  const settlementStartTime = performance.now();
  try {
    const pendingTrades = await services.settlementQueue.getPendingTrades();
    console.log(`  📦 Processing ${pendingTrades.length} settlements...`);
    
    if (pendingTrades.length > 0) {
      const settlementResult = await services.settlementQueue.processPendingSettlements();
      
      // Estimate gas usage for settlements (simplified)
      const estimatedGasPerSettlement = 150000; // Estimated gas per settlement
      totalGasUsed = BigInt(pendingTrades.length * estimatedGasPerSettlement);
    }
  } catch (error) {
    console.log("  ⚠️  Settlement processing encountered issues:", (error as Error).message);
  }
  
  const settlementTime = performance.now() - settlementStartTime;
  console.log(`  🔗 Settlement processing completed in ${settlementTime.toFixed(2)}ms`);
  
  const endTime = performance.now();
  results.totalTime = endTime - startTime;
  results.averageLatency = successfulOrders > 0 ? totalLatency / successfulOrders : 0;
  results.throughput = successfulOrders > 0 ? (successfulOrders / results.totalTime) * 1000 : 0;
  results.gasUsed = totalGasUsed.toString();
  results.costEstimate = estimateGasCost(totalGasUsed);
  results.successRate = (successfulOrders / orderCount) * 100;
  
  logger.log("Hybrid system benchmark completed", {
    totalTime: `${results.totalTime.toFixed(2)}ms`,
    matchingTime: `${matchingTime.toFixed(2)}ms`,
    settlementTime: `${settlementTime.toFixed(2)}ms`,
    averageLatency: `${results.averageLatency.toFixed(2)}ms`,
    throughput: `${results.throughput.toFixed(2)} orders/sec`,
    successRate: `${results.successRate.toFixed(1)}%`,
    gasUsed: results.gasUsed,
    costEstimate: results.costEstimate
  });
  
  return results;
}

function generateTestOrders(count: number, metricId: string, traderAddresses: string[]): Order[] {
  const orders: Order[] = [];
  const { priceRange, quantityRange } = BENCHMARK_CONFIG;
  
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? OrderSide.BUY : OrderSide.SELL;
    const trader = traderAddresses[i % traderAddresses.length];
    
    // Generate random price and quantity within ranges
    const price = priceRange.min + Math.random() * (priceRange.max - priceRange.min);
    const quantity = quantityRange.min + Math.random() * (quantityRange.max - quantityRange.min);
    
    orders.push({
      orderId: `bench-${i}-${Date.now()}`,
      trader,
      metricId,
      side,
      orderType: OrderType.LIMIT,
      quantity: ethers.parseEther(quantity.toFixed(3)),
      price: ethers.parseEther(price.toFixed(2)),
      stopPrice: ethers.ZeroHash,
      timeInForce: "GTC",
      timestamp: BigInt(Math.floor(Date.now() / 1000) + i),
      nonce: BigInt(i + 1),
      signature: "0x",
      icebergQty: ethers.ZeroHash,
      postOnly: false,
      metadataHash: ethers.ZeroHash
    });
  }
  
  return orders;
}

function estimateGasCost(gasUsed: bigint): string {
  const gasPriceGwei = 20; // 20 Gwei
  const ethPrice = 2000; // $2000 per ETH
  
  const costEth = Number(gasUsed) * gasPriceGwei * 1e-9;
  const costUsd = costEth * ethPrice;
  
  return `$${costUsd.toFixed(2)} (${costEth.toFixed(6)} ETH)`;
}

function printPerformanceComparison(results: BenchmarkResults[]) {
  console.log("\n📊 Performance Metrics:");
  console.log("-".repeat(40));
  
  for (const result of results) {
    console.log(`\n${result.approach.toUpperCase()}:`);
    console.log(`  Total Time: ${result.totalTime.toFixed(2)}ms`);
    console.log(`  Avg Latency: ${result.averageLatency.toFixed(2)}ms`);
    console.log(`  Throughput: ${result.throughput.toFixed(2)} orders/sec`);
    console.log(`  Success Rate: ${result.successRate.toFixed(1)}%`);
    if (result.gasUsed && result.gasUsed !== "0") {
      console.log(`  Gas Used: ${result.gasUsed}`);
      console.log(`  Cost Estimate: ${result.costEstimate}`);
    }
  }
  
  // Performance ratios
  const onChain = results.find(r => r.approach === 'on-chain');
  const offChain = results.find(r => r.approach === 'off-chain');
  const hybrid = results.find(r => r.approach === 'hybrid');
  
  if (onChain && offChain) {
    const speedup = onChain.totalTime / offChain.totalTime;
    console.log(`\n🚀 Off-chain is ${speedup.toFixed(1)}x faster than on-chain`);
  }
  
  if (onChain && hybrid) {
    const speedup = onChain.totalTime / hybrid.totalTime;
    console.log(`🌉 Hybrid is ${speedup.toFixed(1)}x faster than pure on-chain`);
  }
}

async function performComprehensiveAnalysis(allResults: BenchmarkResults[]) {
  const logger = new Logger();
  
  // Group results by approach
  const byApproach = allResults.reduce((acc, result) => {
    if (!acc[result.approach]) acc[result.approach] = [];
    acc[result.approach].push(result);
    return acc;
  }, {} as Record<string, BenchmarkResults[]>);
  
  console.log("\n📈 COMPREHENSIVE ANALYSIS:");
  
  for (const [approach, results] of Object.entries(byApproach)) {
    console.log(`\n${approach.toUpperCase()} Analysis:`);
    
    const avgThroughput = results.reduce((sum, r) => sum + r.throughput, 0) / results.length;
    const avgLatency = results.reduce((sum, r) => sum + r.averageLatency, 0) / results.length;
    const avgSuccessRate = results.reduce((sum, r) => sum + r.successRate, 0) / results.length;
    
    console.log(`  Average Throughput: ${avgThroughput.toFixed(2)} orders/sec`);
    console.log(`  Average Latency: ${avgLatency.toFixed(2)}ms`);
    console.log(`  Average Success Rate: ${avgSuccessRate.toFixed(1)}%`);
    
    // Find best and worst performance
    const bestThroughput = Math.max(...results.map(r => r.throughput));
    const worstThroughput = Math.min(...results.map(r => r.throughput));
    
    console.log(`  Best Throughput: ${bestThroughput.toFixed(2)} orders/sec`);
    console.log(`  Worst Throughput: ${worstThroughput.toFixed(2)} orders/sec`);
  }
  
  logger.log("Comprehensive analysis completed", { 
    totalBenchmarks: allResults.length,
    approaches: Object.keys(byApproach)
  });
}

async function performScalabilityAnalysis(allResults: BenchmarkResults[]) {
  console.log("\n📈 SCALABILITY ANALYSIS:");
  
  const orderCounts = [...new Set(allResults.map(r => r.orderCount))].sort((a, b) => a - b);
  
  for (const approach of ['on-chain', 'off-chain', 'hybrid']) {
    console.log(`\n${approach.toUpperCase()} Scalability:`);
    
    const results = allResults.filter(r => r.approach === approach);
    
    for (const count of orderCounts) {
      const result = results.find(r => r.orderCount === count);
      if (result) {
        console.log(`  ${count} orders: ${result.throughput.toFixed(2)} orders/sec, ${result.averageLatency.toFixed(2)}ms latency`);
      }
    }
    
    // Calculate scalability factor
    const small = results.find(r => r.orderCount === orderCounts[0]);
    const large = results.find(r => r.orderCount === orderCounts[orderCounts.length - 1]);
    
    if (small && large) {
      const throughputRatio = large.throughput / small.throughput;
      const latencyRatio = large.averageLatency / small.averageLatency;
      
      console.log(`  Scalability: ${throughputRatio.toFixed(2)}x throughput, ${latencyRatio.toFixed(2)}x latency increase`);
    }
  }
}

async function performCostAnalysis(allResults: BenchmarkResults[]) {
  console.log("\n💰 COST ANALYSIS:");
  
  const onChainResults = allResults.filter(r => r.approach === 'on-chain' && r.gasUsed !== "0");
  const hybridResults = allResults.filter(r => r.approach === 'hybrid' && r.gasUsed !== "0");
  
  if (onChainResults.length > 0) {
    console.log("\nOn-Chain Costs:");
    for (const result of onChainResults) {
      console.log(`  ${result.orderCount} orders: ${result.costEstimate}`);
    }
  }
  
  if (hybridResults.length > 0) {
    console.log("\nHybrid System Costs:");
    for (const result of hybridResults) {
      console.log(`  ${result.orderCount} orders: ${result.costEstimate}`);
    }
  }
  
  // Cost per order analysis
  if (onChainResults.length > 0 && hybridResults.length > 0) {
    console.log("\nCost Efficiency:");
    
    for (let i = 0; i < Math.min(onChainResults.length, hybridResults.length); i++) {
      const onChain = onChainResults[i];
      const hybrid = hybridResults[i];
      
      const onChainCostPerOrder = parseFloat(onChain.costEstimate.replace(/[$,]/g, '')) / onChain.orderCount;
      const hybridCostPerOrder = parseFloat(hybrid.costEstimate.replace(/[$,]/g, '')) / hybrid.orderCount;
      
      const savings = ((onChainCostPerOrder - hybridCostPerOrder) / onChainCostPerOrder) * 100;
      
      console.log(`  ${onChain.orderCount} orders: ${savings.toFixed(1)}% cost reduction with hybrid`);
    }
  }
}

function generatePerformanceRecommendations(allResults: BenchmarkResults[]) {
  console.log("\n💡 PERFORMANCE RECOMMENDATIONS:");
  console.log("-".repeat(40));
  
  const onChainResults = allResults.filter(r => r.approach === 'on-chain');
  const offChainResults = allResults.filter(r => r.approach === 'off-chain');
  const hybridResults = allResults.filter(r => r.approach === 'hybrid');
  
  // Analysis recommendations
  console.log("\n🎯 Based on benchmark results:");
  
  if (offChainResults.length > 0) {
    const avgOffChainThroughput = offChainResults.reduce((sum, r) => sum + r.throughput, 0) / offChainResults.length;
    console.log(`✅ Off-chain matching provides ${avgOffChainThroughput.toFixed(0)} orders/sec average throughput`);
  }
  
  if (onChainResults.length > 0 && offChainResults.length > 0) {
    const onChainAvg = onChainResults.reduce((sum, r) => sum + r.averageLatency, 0) / onChainResults.length;
    const offChainAvg = offChainResults.reduce((sum, r) => sum + r.averageLatency, 0) / offChainResults.length;
    const improvement = ((onChainAvg - offChainAvg) / onChainAvg) * 100;
    
    console.log(`⚡ Off-chain reduces latency by ${improvement.toFixed(1)}% compared to on-chain`);
  }
  
  console.log("\n📋 Recommendations:");
  console.log("1. Use off-chain matching for high-frequency trading scenarios");
  console.log("2. Implement hybrid system for balance of speed and security");
  console.log("3. Batch settlements to optimize gas costs");
  console.log("4. Consider order book caching for improved performance");
  console.log("5. Monitor settlement queue to prevent bottlenecks");
  
  console.log("\n🎯 Use Cases:");
  console.log("• High-frequency trading: Off-chain matching");
  console.log("• Retail trading: Hybrid system");
  console.log("• Regulatory compliance: Hybrid with full audit trail");
  console.log("• Cost-sensitive: Hybrid with optimized settlement batching");
}

// Export for use in other test files
export {
  benchmarkMatchingPerformance,
  benchmarkOnChainDirect,
  benchmarkOffChainOnly,
  benchmarkHybridSystem,
  BenchmarkResults,
  BenchmarkConfig,
  BENCHMARK_CONFIG
};

// Main execution
if (require.main === module) {
  benchmarkMatchingPerformance()
    .then(() => {
      console.log("✅ Performance benchmark completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Performance benchmark failed:", error);
      process.exit(1);
    });
}
