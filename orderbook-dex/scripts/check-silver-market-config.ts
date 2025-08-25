import { ethers } from "hardhat";

async function main() {
  console.log("🔍 Checking Silver V1 Market Configuration");
  console.log("==========================================");

  const [signer] = await ethers.getSigners();
  console.log("📋 Using account:", signer.address);

  // Load factory contract
  const factory = await ethers.getContractAt(
    "MetricsMarketFactory", 
    "0x354f188944eF514eEEf05d8a31E63B33f87f16E0",
    signer
  );

  // Get market configuration
  const config = await factory.getMarketConfig("SILVER_V1");
  
  console.log("\n📊 Silver V1 Market Configuration:");
  console.log("==================================");
  console.log(`Metric ID: ${config.metricId}`);
  console.log(`Description: ${config.description}`);
  console.log(`Decimals: ${config.decimals}`);
  console.log(`Minimum Order Size (raw): ${config.minimumOrderSize.toString()}`);
  console.log(`Minimum Order Size (USDC): ${ethers.formatUnits(config.minimumOrderSize, 6)} USDC`);
  console.log(`Minimum Order Size (18 decimals): ${ethers.formatEther(config.minimumOrderSize)} units`);
  console.log(`Oracle Provider: ${config.oracleProvider}`);
  console.log(`Settlement Date: ${new Date(Number(config.settlementDate) * 1000).toISOString()}`);
  console.log(`Trading End Date: ${new Date(Number(config.tradingEndDate) * 1000).toISOString()}`);
  
  // Get market address
  const marketAddress = await factory.getMarket("SILVER_V1");
  console.log(`Market Address: ${marketAddress}`);
  
  // Load OrderBook contract to check current configuration
  if (marketAddress !== ethers.ZeroAddress) {
    const orderBook = await ethers.getContractAt("OrderBook", marketAddress, signer);
    
    const [tickSize, minOrderSize, maxOrderSize] = await orderBook.getConfiguration();
    console.log("\n📋 OrderBook Configuration:");
    console.log("===========================");
    console.log(`Tick Size: ${ethers.formatEther(tickSize)} ETH`);
    console.log(`Min Order Size (raw): ${minOrderSize.toString()}`);
    console.log(`Min Order Size (USDC): ${ethers.formatUnits(minOrderSize, 6)} USDC`);
    console.log(`Min Order Size (18 decimals): ${ethers.formatEther(minOrderSize)} units`);
    console.log(`Max Order Size: ${maxOrderSize.toString()}`);
    
    console.log("\n🧮 Analysis:");
    console.log("============");
    console.log(`The minimum order size is ${ethers.formatUnits(minOrderSize, 6)} USDC units`);
    console.log(`This is ${ethers.formatEther(minOrderSize)} when interpreted as 18-decimal units`);
    
    // Calculate what we need for a $10 order
    const targetOrderValue = ethers.parseUnits("10", 6); // $10 in USDC decimals
    console.log(`\n💰 For a $10 order:`);
    console.log(`Target: ${ethers.formatUnits(targetOrderValue, 6)} USDC`);
    console.log(`Minimum required: ${ethers.formatUnits(minOrderSize, 6)} USDC`);
    console.log(`Is $10 >= minimum? ${targetOrderValue >= minOrderSize ? "✅ YES" : "❌ NO"}`);
    
    if (targetOrderValue < minOrderSize) {
      console.log(`\n⚠️  Problem: $10 order is below minimum of ${ethers.formatUnits(minOrderSize, 6)} USDC`);
      console.log(`Need to use at least: ${ethers.formatUnits(minOrderSize, 6)} USDC`);
    }
  }
}

main()
  .then(() => {
    console.log("\n✅ Configuration check completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Configuration check failed:", error);
    process.exit(1);
  });
