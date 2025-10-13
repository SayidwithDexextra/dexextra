import { ethers } from "hardhat";

async function main() {
  console.log("🧪 Setting up test environment for Hyperliquid OrderBook Protocol...\n");

  const [deployer, user1, user2, user3] = await ethers.getSigners();
  
  // Contract addresses (update these after deployment)
  const MOCK_USDC_ADDRESS = process.env.MOCK_USDC_ADDRESS || "";
  const VAULT_ROUTER_ADDRESS = process.env.VAULT_ROUTER_ADDRESS || "";
  const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS || "";

  if (!MOCK_USDC_ADDRESS || !VAULT_ROUTER_ADDRESS || !FACTORY_ADDRESS) {
    console.log("❌ Please set contract addresses in environment variables:");
    console.log("MOCK_USDC_ADDRESS, VAULT_ROUTER_ADDRESS, FACTORY_ADDRESS");
    process.exit(1);
  }

  // Get contract instances
  const mockUSDC = await ethers.getContractAt("MockUSDC", MOCK_USDC_ADDRESS);
  const vaultRouter = await ethers.getContractAt("VaultRouter", VAULT_ROUTER_ADDRESS);
  const factory = await ethers.getContractAt("OrderBookFactory", FACTORY_ADDRESS);

  console.log("📈 Setting up test users with USDC...");
  
  // Mint USDC for test users
  const mintAmount = ethers.parseUnits("10000", 6); // 10k USDC each
  const users = [user1, user2, user3];
  
  for (let i = 0; i < users.length; i++) {
    await mockUSDC.mint(users[i].address, mintAmount);
    console.log(`✅ Minted 10,000 mUSDC to ${users[i].address}`);
  }

  console.log("\n💰 Setting up user collateral deposits...");
  
  // Each user deposits collateral
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const depositAmount = ethers.parseUnits("5000", 6); // 5k USDC deposit
    
    // Approve and deposit
    await mockUSDC.connect(user).approve(VAULT_ROUTER_ADDRESS, depositAmount);
    await vaultRouter.connect(user).depositCollateral(depositAmount);
    
    console.log(`✅ ${user.address} deposited 5,000 mUSDC collateral`);
  }

  console.log("\n📊 Setting up initial market prices...");
  
  // Get market IDs
  const ethMarketId = await factory.getMarketBySymbol("ETH/USD");
  const btcMarketId = await factory.getMarketBySymbol("BTC/USD");
  const worldPopMarketId = await factory.getMarketByMetric("world_population");
  const spotifyMarketId = await factory.getMarketByMetric("spotify_listeners_TaylorSwift");

  // Update mark prices
  await vaultRouter.updateMarkPrice(ethMarketId, ethers.parseUnits("2000", 0)); // $2000
  await vaultRouter.updateMarkPrice(btcMarketId, ethers.parseUnits("40000", 0)); // $40000
  await vaultRouter.updateMarkPrice(worldPopMarketId, ethers.parseUnits("8000000000", 0)); // 8B
  await vaultRouter.updateMarkPrice(spotifyMarketId, ethers.parseUnits("90000000", 0)); // 90M

  console.log("✅ Set ETH/USD mark price to $2,000");
  console.log("✅ Set BTC/USD mark price to $40,000");
  console.log("✅ Set World Population to 8 billion");
  console.log("✅ Set Taylor Swift Spotify listeners to 90M");

  console.log("\n📋 Placing initial test orders...");
  
  // Get OrderBook contracts
  const ethOrderBook = await ethers.getContractAt("OrderBook", 
    (await factory.getMarket(ethMarketId)).orderBookAddress
  );
  const btcOrderBook = await ethers.getContractAt("OrderBook", 
    (await factory.getMarket(btcMarketId)).orderBookAddress
  );
  const worldPopOrderBook = await ethers.getContractAt("OrderBook", 
    (await factory.getMarket(worldPopMarketId)).orderBookAddress
  );

  // Place some limit orders to create order book depth
  console.log("Placing ETH/USD orders...");
  
  // User1: Buy ETH at $1950, Sell ETH at $2050
  await ethOrderBook.connect(user1).placeLimitOrder(0, ethers.parseUnits("1", 0), ethers.parseUnits("1950", 0)); // BUY
  await ethOrderBook.connect(user1).placeLimitOrder(1, ethers.parseUnits("1", 0), ethers.parseUnits("2050", 0)); // SELL
  
  // User2: Buy ETH at $1980, Sell ETH at $2020
  await ethOrderBook.connect(user2).placeLimitOrder(0, ethers.parseUnits("0.5", 0), ethers.parseUnits("1980", 0)); // BUY
  await ethOrderBook.connect(user2).placeLimitOrder(1, ethers.parseUnits("0.5", 0), ethers.parseUnits("2020", 0)); // SELL

  console.log("✅ Placed ETH/USD limit orders");

  console.log("Placing BTC/USD orders...");
  
  // User2: Buy BTC at $39500, Sell BTC at $40500
  await btcOrderBook.connect(user2).placeLimitOrder(0, ethers.parseUnits("0.1", 0), ethers.parseUnits("39500", 0)); // BUY
  await btcOrderBook.connect(user2).placeLimitOrder(1, ethers.parseUnits("0.1", 0), ethers.parseUnits("40500", 0)); // SELL

  console.log("✅ Placed BTC/USD limit orders");

  console.log("Placing World Population orders...");
  
  // User3: Bet on population growth vs decline
  await worldPopOrderBook.connect(user3).placeLimitOrder(0, ethers.parseUnits("100", 0), ethers.parseUnits("8100000000", 0)); // BUY (bet on growth)
  await worldPopOrderBook.connect(user3).placeLimitOrder(1, ethers.parseUnits("100", 0), ethers.parseUnits("7900000000", 0)); // SELL (bet on decline)

  console.log("✅ Placed World Population orders");

  console.log("\n📊 Executing some market orders for activity...");
  
  // Execute market orders to create trading activity
  await ethOrderBook.connect(user3).placeMarketOrder(0, ethers.parseUnits("0.2", 0)); // Market buy 0.2 ETH
  console.log("✅ User3 market bought 0.2 ETH");

  await btcOrderBook.connect(user1).placeMarketOrder(1, ethers.parseUnits("0.05", 0)); // Market sell 0.05 BTC
  console.log("✅ User1 market sold 0.05 BTC");

  console.log("\n📈 Displaying portfolio summaries...");
  
  // Display portfolio summaries for all users
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const summary = await vaultRouter.getMarginSummary(user.address);
    
    console.log(`\n👤 User ${i + 1} (${user.address}):`);
    console.log(`   Total Collateral: ${ethers.formatUnits(summary.totalCollateral, 6)} mUSDC`);
    console.log(`   Available Collateral: ${ethers.formatUnits(summary.availableCollateral, 6)} mUSDC`);
    console.log(`   Margin Used: ${ethers.formatUnits(summary.marginUsed, 6)} mUSDC`);
    console.log(`   Margin Reserved: ${ethers.formatUnits(summary.marginReserved, 6)} mUSDC`);
    console.log(`   Realized PnL: ${ethers.formatUnits(summary.realizedPnL, 6)} mUSDC`);
    console.log(`   Unrealized PnL: ${ethers.formatUnits(summary.unrealizedPnL, 6)} mUSDC`);
    console.log(`   Portfolio Value: ${ethers.formatUnits(summary.portfolioValue, 6)} mUSDC`);
    
    // Get user positions
    const positions = await vaultRouter.getUserPositions(user.address);
    if (positions.length > 0) {
      console.log(`   Positions:`);
      for (const position of positions) {
        const marketInfo = await factory.getMarket(position.marketId);
        console.log(`     - ${marketInfo.symbol}: ${position.size} @ ${position.entryPrice}`);
      }
    }
  }

  console.log("\n📊 Market statistics:");
  
  // Display market order book depth
  const markets = [
    { name: "ETH/USD", orderBook: ethOrderBook },
    { name: "BTC/USD", orderBook: btcOrderBook },
    { name: "World Population", orderBook: worldPopOrderBook }
  ];

  for (const market of markets) {
    const [bestBid, bestAsk] = await market.orderBook.getBestPrices();
    const marketInfo = await market.orderBook.getMarketInfo();
    
    console.log(`\n📈 ${market.name}:`);
    console.log(`   Best Bid: ${bestBid}`);
    console.log(`   Best Ask: ${bestAsk}`);
    console.log(`   Last Price: ${marketInfo.lastPrice}`);
    console.log(`   Open Interest: ${marketInfo.openInterest}`);
    console.log(`   24h Volume: ${marketInfo.volume24h}`);
  }

  console.log("\n🎉 Test environment setup completed successfully!");
  console.log("\n💡 You can now:");
  console.log("1. Place more orders using the OrderBook contracts");
  console.log("2. Check portfolio values using VaultRouter.getMarginSummary()");
  console.log("3. Update metric values for custom markets");
  console.log("4. Settle markets periodically");
  console.log("5. Test funding calculations");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Test environment setup failed:", error);
    process.exit(1);
  });

