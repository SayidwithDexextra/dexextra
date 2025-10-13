import { ethers, network, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Batch verification helper:
 * - Verifies OrderBook implementation (once)
 * - Iterates known markets from factory (by metric IDs) or via on-chain getAllMarkets
 * - Prints links for each clone; explorers will show proxy => impl
 */
async function main() {
  const deploymentsPath = path.resolve(__dirname, "../deployments/polygon-deployment-current.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  const factoryAddr = deployments.contracts.factory as string;
  const impl = deployments.contracts.orderBookImplementation as string;
  if (!factoryAddr || !impl) {
    throw new Error("Missing factory or orderBookImplementation in deployments file");
  }

  console.log(`Network: ${network.name}`);
  console.log(`Factory: ${factoryAddr}`);
  console.log(`Impl:    ${impl}`);

  // Verify implementation first
  try {
    await run("verify:verify", {
      address: impl,
      constructorArguments: [],
      contract: "contracts/core/OrderBook.sol:OrderBook",
    });
    console.log("✅ Implementation verified or already verified");
  } catch (e) {
    const msg = (e as any)?.message || String(e);
    if (/already verified/i.test(msg)) {
      console.log("ℹ️  Implementation already verified");
    } else {
      console.warn("⚠️  Implementation verification error:", msg);
    }
  }

  // Read markets from factory
  const Factory = await ethers.getContractFactory("MetricsMarketFactory");
  const factory = Factory.attach(factoryAddr);

  let markets: string[] = [];
  try {
    markets = await factory.getAllMarkets();
  } catch (e) {
    console.warn("⚠️  Could not read getAllMarkets. Falling back to deployments file if present.");
  }

  console.log(`\nFound ${markets.length} markets:`);
  for (const m of markets) {
    console.log(` - ${m} -> https://polygonscan.com/address/${m}`);
  }

  console.log("\n➡️  No direct clone verification needed. Ensure implementation is verified; clones will display as proxies.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});




