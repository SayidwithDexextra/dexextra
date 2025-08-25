import { ethers } from "hardhat";

// Live Polygon contract addresses
const FACTORY = "0x354f188944eF514eEEf05d8a31E63B33f87f16E0";
const METRIC_ID = "SILVER_V1";

// Target: set minimumOrderSize so that quantity = 1e9 allows ~$10 at price 0.01
// requiredCollateral = (1e9 * 1e16) / 1e18 = 1e7 (10 USDC base units)
// So NEW_MIN_ORDER_SIZE = 1e9 ensures $10 passes with tick size 0.01.
const NEW_MIN_ORDER_SIZE = ethers.toBigInt("1000000000"); // 1e9

async function main() {
  console.log("\n⚙️ Updating minimumOrderSize for SILVER_V1 via factory...");

  const [signer] = await ethers.getSigners();
  console.log("Admin/Caller:", signer.address);

  const factory = await ethers.getContractAt("MetricsMarketFactory", FACTORY, signer);

  // Show current config
  const before = await factory.getMarketConfig(METRIC_ID);
  console.log("Before:", {
    metricId: before.metricId,
    decimals: before.decimals,
    minimumOrderSize: before.minimumOrderSize.toString(),
  });

  const tx = await factory.updateMarketParameters(METRIC_ID, NEW_MIN_ORDER_SIZE, 1n * 10n ** 16n);
  console.log("Sent tx:", tx.hash);
  const rcpt = await tx.wait();
  console.log("Mined in block:", rcpt?.blockNumber);

  const after = await factory.getMarketConfig(METRIC_ID);
  console.log("After:", {
    metricId: after.metricId,
    decimals: after.decimals,
    minimumOrderSize: after.minimumOrderSize.toString(),
  });

  console.log("✅ minimumOrderSize updated.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});


