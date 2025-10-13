import { ethers } from "hardhat";

async function main() {
  console.log("📊 Querying Portfolio Information...\n");

  // Contract addresses (update these after deployment)
  const VAULT_ROUTER_ADDRESS = process.env.VAULT_ROUTER_ADDRESS || "";
  const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS || "";
  const USER_ADDRESS = process.env.USER_ADDRESS || "";

  if (!VAULT_ROUTER_ADDRESS || !FACTORY_ADDRESS) {
    console.log("❌ Please set contract addresses in environment variables:");
    console.log("VAULT_ROUTER_ADDRESS, FACTORY_ADDRESS");
    process.exit(1);
  }

  // Get contract instances
  const vaultRouter = await ethers.getContractAt("VaultRouter", VAULT_ROUTER_ADDRESS);
  const factory = await ethers.getContractAt("OrderBookFactory", FACTORY_ADDRESS);

  let userAddress = USER_ADDRESS;
  if (!userAddress) {
    const [deployer] = await ethers.getSigners();
    userAddress = deployer.address;
    console.log("🔍 No USER_ADDRESS specified, using deployer:", userAddress);
  }

  console.log(`📋 Portfolio Information for: ${userAddress}\n`);

  try {
    // Get comprehensive margin summary
    const summary = await vaultRouter.getMarginSummary(userAddress);
    
    console.log("💰 Financial Summary:");
    console.log("=====================================");
    console.log(`Total Collateral:      ${ethers.formatUnits(summary.totalCollateral, 6)} mUSDC`);
    console.log(`Available Collateral:  ${ethers.formatUnits(summary.availableCollateral, 6)} mUSDC`);
    console.log(`Margin Used:          ${ethers.formatUnits(summary.marginUsed, 6)} mUSDC`);
    console.log(`Margin Reserved:      ${ethers.formatUnits(summary.marginReserved, 6)} mUSDC`);
    console.log(`Realized PnL:         ${ethers.formatUnits(summary.realizedPnL, 6)} mUSDC`);
    console.log(`Unrealized PnL:       ${ethers.formatUnits(summary.unrealizedPnL, 6)} mUSDC`);
    console.log(`Portfolio Value:      ${ethers.formatUnits(summary.portfolioValue, 6)} mUSDC`);
    
    // Calculate utilization ratio
    const utilizationRatio = summary.totalCollateral > 0 ? 
      Number(summary.marginUsed + summary.marginReserved) / Number(summary.totalCollateral) * 100 : 0;
    console.log(`Margin Utilization:   ${utilizationRatio.toFixed(2)}%`);

    // Get user positions
    console.log("\n📈 Open Positions:");
    console.log("=====================================");
    const positions = await vaultRouter.getUserPositions(userAddress);
    
    if (positions.length === 0) {
      console.log("No open positions");
    } else {
      for (let i = 0; i < positions.length; i++) {
        const position = positions[i];
        try {
          const marketInfo = await factory.getMarket(position.marketId);
          const currentPrice = await vaultRouter.marketMarkPrices(position.marketId);
          
          // Calculate PnL for this position
          const isLong = position.size > 0;
          const positionSize = isLong ? position.size : -position.size;
          const priceDiff = currentPrice - position.entryPrice;
          const positionPnL = isLong ? 
            (priceDiff * positionSize) / position.entryPrice :
            -(priceDiff * positionSize) / position.entryPrice;
          
          console.log(`\n📊 Position ${i + 1}: ${marketInfo.symbol}`);
          console.log(`   Side:           ${isLong ? 'LONG' : 'SHORT'}`);
          console.log(`   Size:           ${ethers.formatUnits(positionSize, 0)}`);
          console.log(`   Entry Price:    ${ethers.formatUnits(position.entryPrice, 0)}`);
          console.log(`   Current Price:  ${ethers.formatUnits(currentPrice, 0)}`);
          console.log(`   Margin Locked:  ${ethers.formatUnits(position.marginLocked, 6)} mUSDC`);
          console.log(`   Position PnL:   ${ethers.formatUnits(positionPnL, 6)} mUSDC`);
          console.log(`   Opened:         ${new Date(Number(position.timestamp) * 1000).toISOString()}`);
          
          if (marketInfo.isCustomMetric) {
            console.log(`   Metric ID:      ${marketInfo.metricId}`);
          }
        } catch (error) {
          console.log(`❌ Error fetching market info for position ${i + 1}:`, error);
        }
      }
    }

    // Get pending orders
    console.log("\n📋 Pending Orders:");
    console.log("=====================================");
    const pendingOrders = await vaultRouter.getUserPendingOrders(userAddress);
    
    if (pendingOrders.length === 0) {
      console.log("No pending orders");
    } else {
      for (let i = 0; i < pendingOrders.length; i++) {
        const order = pendingOrders[i];
        try {
          const marketInfo = await factory.getMarket(order.marketId);
          
          console.log(`\n📝 Order ${i + 1}: ${marketInfo.symbol}`);
          console.log(`   Order ID:       ${order.orderId}`);
          console.log(`   Margin Reserved: ${ethers.formatUnits(order.marginReserved, 6)} mUSDC`);
          console.log(`   Timestamp:      ${new Date(Number(order.timestamp) * 1000).toISOString()}`);
        } catch (error) {
          console.log(`❌ Error fetching market info for order ${i + 1}:`, error);
        }
      }
    }

    // Get all markets and their current prices
    console.log("\n🌍 Market Overview:");
    console.log("=====================================");
    const allMarkets = await factory.getAllMarkets();
    
    for (let i = 0; i < allMarkets.length; i++) {
      const marketId = allMarkets[i];
      try {
        const marketInfo = await factory.getMarket(marketId);
        const currentPrice = await vaultRouter.marketMarkPrices(marketId);
        const orderBookAddress = marketInfo.orderBookAddress;
        
        // Get order book info
        const orderBook = await ethers.getContractAt("OrderBook", orderBookAddress);
        const [bestBid, bestAsk] = await orderBook.getBestPrices();
        const marketData = await orderBook.getMarketInfo();
        
        console.log(`\n📊 ${marketInfo.symbol}${marketInfo.isCustomMetric ? ' (Custom Metric)' : ''}:`);
        console.log(`   Market ID:      ${marketId}`);
        console.log(`   Current Price:  ${ethers.formatUnits(currentPrice, 0)}`);
        console.log(`   Best Bid:       ${bestBid > 0 ? ethers.formatUnits(bestBid, 0) : 'N/A'}`);
        console.log(`   Best Ask:       ${bestAsk > 0 ? ethers.formatUnits(bestAsk, 0) : 'N/A'}`);
        console.log(`   Last Price:     ${ethers.formatUnits(marketData.lastPrice, 0)}`);
        console.log(`   Open Interest:  ${ethers.formatUnits(marketData.openInterest, 0)}`);
        console.log(`   24h Volume:     ${ethers.formatUnits(marketData.volume24h, 0)}`);
        console.log(`   Status:         ${marketInfo.isActive ? 'Active' : 'Inactive'}`);
        
        if (marketInfo.isCustomMetric) {
          console.log(`   Metric ID:      ${marketInfo.metricId}`);
        }
      } catch (error) {
        console.log(`❌ Error fetching info for market ${i + 1}:`, error);
      }
    }

    // Trading statistics
    console.log("\n📈 Platform Statistics:");
    console.log("=====================================");
    console.log(`Total Markets:      ${allMarkets.length}`);
    
    const traditionalMarkets = await factory.getTraditionalMarkets();
    const customMetricMarkets = await factory.getCustomMetricMarkets();
    const activeMarkets = await factory.getActiveMarkets();
    
    console.log(`Traditional:        ${traditionalMarkets.length}`);
    console.log(`Custom Metrics:     ${customMetricMarkets.length}`);
    console.log(`Active Markets:     ${activeMarkets.length}`);
    
    // Factory configuration
    const marketCreationFee = await factory.marketCreationFee();
    const creatorFeeRate = await factory.creatorFeeRate();
    
    console.log(`\n⚙️ Configuration:`);
    console.log(`Creation Fee:       ${ethers.formatEther(marketCreationFee)} ETH`);
    console.log(`Creator Fee Rate:   ${creatorFeeRate} basis points (${Number(creatorFeeRate)/100}%)`);

  } catch (error) {
    console.error("❌ Error querying portfolio:", error);
  }

  console.log("\n✅ Portfolio query completed!");
}

// Allow running with custom user address
// Usage: npx hardhat run scripts/query-portfolio.ts --network localhost
// Or with custom user: USER_ADDRESS=0x... npx hardhat run scripts/query-portfolio.ts
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Portfolio query failed:", error);
    process.exit(1);
  });

