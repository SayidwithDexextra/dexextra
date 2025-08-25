import { ethers } from "hardhat";

const POLYGON_CONTRACTS = {
  centralVault: "0x9E5996Cb44AC7F60a9A46cACF175E87ab677fC1C",
  orderRouter: "0x516a1790a04250FC6A5966A528D02eF20E1c1891",
  mockUSDC: "0xff541e2AEc7716725f8EDD02945A1Fe15664588b"
};

const SILVER_MARKET = {
  metricId: "SILVER_V1"
};

const USDC_DECIMALS = 6;

async function main() {
  console.log("🚀 Testing with Much More Collateral");
  console.log("====================================");
  
  const [signer] = await ethers.getSigners();
  console.log("Account:", signer.address);
  
  const mockUSDC = await ethers.getContractAt("MockUSDC", POLYGON_CONTRACTS.mockUSDC, signer);
  const centralVault = await ethers.getContractAt("CentralVault", POLYGON_CONTRACTS.centralVault, signer);
  const orderRouter = await ethers.getContractAt("OrderRouter", POLYGON_CONTRACTS.orderRouter, signer);
  
  // Mint and deposit much more USDC
  console.log("\n💰 Adding substantial collateral...");
  
  // Mint 100,000 USDC
  const largeAmount = ethers.parseUnits("100000", USDC_DECIMALS);
  await mockUSDC.mint(signer.address, largeAmount);
  console.log("✅ Minted 100,000 USDC");
  
  // Approve and deposit all of it
  await mockUSDC.approve(POLYGON_CONTRACTS.centralVault, largeAmount);
  await centralVault.deposit(POLYGON_CONTRACTS.mockUSDC, largeAmount);
  console.log("✅ Deposited 100,000 USDC to vault");
  
  // Check new balance
  const vaultBalance = await centralVault.getUserBalance(signer.address, POLYGON_CONTRACTS.mockUSDC);
  console.log(`New vault balance: ${ethers.formatUnits(vaultBalance.available, USDC_DECIMALS)} USDC`);
  
  // Now try the order
  console.log("\n🎯 Attempting minimal order with large collateral...");
  
  const orderQuantity = ethers.parseEther("0.1"); // 0.1 units (minimum)
  const orderPrice = ethers.parseEther("0.01"); // 0.01 ETH per unit (minimum tick)
  
  const order = {
    orderId: 0,
    trader: signer.address,
    metricId: SILVER_MARKET.metricId,
    orderType: 1, // LIMIT
    side: 0, // BUY
    quantity: orderQuantity,
    price: orderPrice,
    filledQuantity: 0,
    timestamp: 0,
    expiryTime: 0,
    status: 0, // PENDING
    timeInForce: 0, // GTC
    stopPrice: 0,
    icebergQty: 0,
    postOnly: true,
    metadataHash: ethers.keccak256(ethers.toUtf8Bytes("LARGE_COLLATERAL_TEST"))
  };
  
  console.log(`Order: ${ethers.formatEther(orderQuantity)} units at ${ethers.formatEther(orderPrice)} ETH/unit`);
  console.log(`Total value: ${ethers.formatEther((orderQuantity * orderPrice) / ethers.parseEther("1"))} ETH`);
  
  try {
    const gasEstimate = await orderRouter.placeOrder.estimateGas(order);
    console.log("✅ Order would succeed! Gas estimate:", gasEstimate.toString());
    
    // Actually place the order
    const tx = await orderRouter.placeOrder(order);
    console.log("Transaction submitted:", tx.hash);
    
    const receipt = await tx.wait();
    console.log("🎉 ORDER PLACED SUCCESSFULLY!");
    console.log("Gas used:", receipt!.gasUsed.toString());
    
    // Find the order ID
    for (const log of receipt!.logs) {
      try {
        const parsed = orderRouter.interface.parseLog(log);
        if (parsed?.name === "OrderPlaced") {
          console.log(`📋 Order ID: ${parsed.args[0].toString()}`);
        }
      } catch (error) {
        // Ignore parsing errors
      }
    }
    
    console.log(`\n🔗 View transaction: https://polygonscan.com/tx/${tx.hash}`);
    
  } catch (error: any) {
    console.error("❌ Still failed even with large collateral:");
    console.error(error.message);
    
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    
    // Let's see what the actual collateral requirement might be
    console.log("\n🔍 The order might require specific margin/leverage ratios");
    console.log("💡 The contracts might expect a different collateral calculation model");
  }
}

main().catch(console.error);
