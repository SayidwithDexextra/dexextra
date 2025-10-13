import { ethers, network, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const deploymentsPath = path.resolve(__dirname, "../deployments/polygon-deployment-current.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  const impl = deployments.contracts.orderBookImplementation as string;
  if (!impl) {
    throw new Error("Missing orderBookImplementation in deployments file");
  }

  console.log(`Verifying OrderBook implementation on ${network.name}: ${impl}`);

  await run("verify:verify", {
    address: impl,
    constructorArguments: [],
    contract: "contracts/core/OrderBook.sol:OrderBook",
  });

  console.log("✅ Implementation verification submitted.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});




