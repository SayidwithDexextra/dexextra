#!/usr/bin/env node

/**
 * Place Order Directly via OrderBook (Workaround)
 *
 * ISSUE: TradingRouter passes wrong user address to VaultRouter
 * WORKAROUND: Call OrderBook directly to preserve correct msg.sender
 *
 * This bypasses the architectural issue in TradingRouter
 */

const hre = require("hardhat");

async function main() {
  console.log("🎯 Placing Order Directly via OrderBook (Workaround)\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("👤 Using account:", deployer.address);

  // Contract addresses
  const ORDERBOOK_ADDRESS = "0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE"; // Aluminum OrderBook
  const VAULT_ROUTER_ADDRESS = "0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7";

  // Order parameters from the failed UI call
  const side = 1; // SELL (1 = SELL, 0 = BUY in OrderBook)
  const size = 20000000; // 20 USDC (6 decimals)
  const price = 5000000; // 5 USDC (6 decimals)

  console.log("📋 Order Parameters:");
  console.log(`   OrderBook: ${ORDERBOOK_ADDRESS}`);
  console.log(`   Side: ${side} (${side === 0 ? "BUY" : "SELL"})`);
  console.log(`   Size: ${hre.ethers.formatUnits(size, 6)} USDC`);
  console.log(`   Price: ${hre.ethers.formatUnits(price, 6)} USDC\n`);

  try {
    // Check collateral before
    const vaultRouter = await hre.ethers.getContractAt(
      "VaultRouter",
      VAULT_ROUTER_ADDRESS
    );
    const availableBefore = await vaultRouter.getAvailableCollateral(
      deployer.address
    );
    console.log(
      `💰 Available Collateral: ${hre.ethers.formatUnits(
        availableBefore,
        6
      )} USDC\n`
    );

    // Get OrderBook contract directly
    const orderBook = await hre.ethers.getContractAt(
      "OrderBook",
      ORDERBOOK_ADDRESS
    );

    console.log("🚀 PLACING ORDER DIRECTLY");
    console.log("=".repeat(50));

    // Call OrderBook directly (this preserves correct msg.sender)
    console.log("⏳ Calling OrderBook.placeLimitOrder directly...");

    const tx = await orderBook.placeLimitOrder(side, size, price);
    console.log("📋 Transaction hash:", tx.hash);

    console.log("⏳ Waiting for confirmation...");
    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed in block:", receipt.blockNumber);

    // Get order ID from the transaction receipt
    const orderPlacedEvent = receipt.logs.find((log) => {
      try {
        const parsed = orderBook.interface.parseLog(log);
        return parsed?.name === "OrderPlaced";
      } catch {
        return false;
      }
    });

    if (orderPlacedEvent) {
      const parsed = orderBook.interface.parseLog(orderPlacedEvent);
      const orderId = parsed.args[0];
      console.log(`📋 Order ID: ${orderId}`);
    }

    console.log("\n🎉 SUCCESS! Order placed directly via OrderBook!");
    console.log("✅ This bypasses the TradingRouter architectural issue");
    console.log("✅ The order was placed with correct user address");

    // Check collateral after
    const availableAfter = await vaultRouter.getAvailableCollateral(
      deployer.address
    );
    const marginReserved = availableBefore - availableAfter;
    console.log(
      `💰 Margin Reserved: ${hre.ethers.formatUnits(marginReserved, 6)} USDC`
    );
    console.log(
      `💰 Remaining Available: ${hre.ethers.formatUnits(
        availableAfter,
        6
      )} USDC`
    );
  } catch (error) {
    console.error("❌ Direct order placement failed:", error.message);

    if (error.message.includes("insufficient collateral")) {
      console.log("\n🔍 STILL GETTING COLLATERAL ERROR:");
      console.log(
        "   This suggests the issue might be deeper than TradingRouter"
      );
      console.log("   The OrderBook contract itself might have an issue");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });


