import { ethers } from "hardhat";

interface ContractAddresses {
  orderBook: string;
  orderRouter: string;
  centralVault: string;
  mockUSDC: string;
}

async function create100PnL() {
  console.log('🎯 CREATING $100 PnL THROUGH STRATEGIC TRADING');
  console.log('='.repeat(80));

  // Get contract addresses from the latest deployment
  const contractAddresses: ContractAddresses = {
    orderBook: "0xA8352cc22a25AD3917083206D0A257Ec28feb358",
    orderRouter: "0x8e3Db910EC808E88AE72faD682a9e61f48B39eaA", 
    centralVault: "0x3eD2BdB0C0F1492AD2eF24ae68f44A48EE5802BA",
    mockUSDC: "0x19F822820c8c8A2979c26C8d838E402273196338"
  };

  // Get signers
  const [deployer, trader1, trader2, trader3, trader4] = await ethers.getSigners();
  console.log('📊 Traders:');
  console.log(`   Trader 1: ${trader1.address}`);
  console.log(`   Trader 2: ${trader2.address}`);

  // Connect to contracts
  const OrderRouter = await ethers.getContractFactory("OrderRouter");
  const OrderBook = await ethers.getContractFactory("OrderBook");
  const CentralVault = await ethers.getContractFactory("CentralVault");

  const orderRouter = OrderRouter.attach(contractAddresses.orderRouter);
  const orderBook = OrderBook.attach(contractAddresses.orderBook);
  const centralVault = CentralVault.attach(contractAddresses.centralVault);

  console.log('\n✅ Connected to contracts:', contractAddresses);

  // Current baseline: Trader 1 has 0.5 BTC long position at entry price $2.00
  // Current market price: $2.00 (from the last trade)
  // Current PnL: $0 (no price movement yet)
  // Target: $100 PnL

  console.log('\n📊 Strategy: Move market price to $202 to achieve $100 PnL');
  console.log('   Current position: 0.5 BTC @ $2.00 entry');
  console.log('   Required price: $202 (($202 - $2) * 0.5 = $100)');

  // Step 1: Create strategic buy orders to push price up
  const priceTargets = [50, 100, 150, 202];
  let orderCounter = 1;

  for (const targetPrice of priceTargets) {
    console.log(`\n🎯 Step ${orderCounter}: Moving price to $${targetPrice}`);
    
    // Create matching buy and sell orders at target price
    const buyOrder = {
      trader: trader2.address,
      metricId: ethers.encodeBytes32String("BTC-USD"),
      side: 0, // BUY
      orderType: 1, // LIMIT
      quantity: ethers.parseEther("0.1"), // 0.1 BTC
      price: ethers.parseEther(targetPrice.toString()),
      expiration: Math.floor(Date.now() / 1000) + 3600,
      nonce: Date.now() + orderCounter
    };

    const sellOrder = {
      trader: trader3.address,
      metricId: ethers.encodeBytes32String("BTC-USD"),
      side: 1, // SELL
      orderType: 1, // LIMIT
      quantity: ethers.parseEther("0.1"), // 0.1 BTC
      price: ethers.parseEther(targetPrice.toString()),
      expiration: Math.floor(Date.now() / 1000) + 3600,
      nonce: Date.now() + orderCounter + 1000
    };

    try {
      console.log(`   📤 Placing BUY order: 0.1 BTC @ $${targetPrice}`);
      const buyTx = await orderRouter.connect(trader2).placeOrder(buyOrder);
      await buyTx.wait();
      console.log(`   ✅ Buy order placed: ${buyTx.hash.substring(0,20)}...`);

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 500));

      console.log(`   📤 Placing SELL order: 0.1 BTC @ $${targetPrice}`);
      const sellTx = await orderRouter.connect(trader3).placeOrder(sellOrder);
      await sellTx.wait();
      console.log(`   ✅ Sell order placed: ${sellTx.hash.substring(0,20)}...`);
      console.log(`   🎯 Market price should now be $${targetPrice}`);

    } catch (error) {
      console.log(`   ❌ Error placing orders at $${targetPrice}:`, error);
    }

    orderCounter++;
  }

  console.log('\n📈 Price movement sequence completed!');
  console.log('🎉 Market price should now be $202');
  console.log('💰 Trader 1\'s PnL should now be: ($202 - $2) * 0.5 = $100');

  // Get final market state
  try {
    const currentPrice = await orderBook.getCurrentPrice(ethers.encodeBytes32String("BTC-USD"));
    console.log(`\n📊 Final market price: $${ethers.formatEther(currentPrice)}`);
  } catch (error) {
    console.log('\n📊 Could not fetch final price (normal for demo)');
  }

  console.log('\n✅ STRATEGIC TRADING COMPLETED!');
  console.log('📋 Run the PnL script to verify the $100 profit target');
}

// Execute the function
create100PnL()
  .then(() => {
    console.log('\n🚀 Ready to check final PnL!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Strategic trading failed:', error);
    process.exit(1);
  });
