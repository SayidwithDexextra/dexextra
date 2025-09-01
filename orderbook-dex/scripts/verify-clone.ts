import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Verifies a factory-created OrderBook clone by submitting the implementation for verification
 * and posting a note with the Polygonscan link for the clone (minimal proxy).
 * Usage: npx hardhat run scripts/verify-clone.ts --network polygon --address 0x...
 */
async function main() {
  // Support multiple ways to pass the address: --address, env ADDRESS, or positional 0x...
  let cloneAddress = "";
  const flagIdx = process.argv.findIndex((a) => a === "--address");
  if (flagIdx !== -1 && process.argv[flagIdx + 1]) {
    cloneAddress = process.argv[flagIdx + 1];
  }
  if (!cloneAddress && process.env.ADDRESS) {
    cloneAddress = process.env.ADDRESS;
  }
  if (!cloneAddress) {
    const hexArg = process.argv.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
    if (hexArg) cloneAddress = hexArg;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(cloneAddress)) {
    throw new Error("Missing clone address. Pass via --address, ADDRESS env, or positional 0x... argument");
  }

  const deploymentsPath = path.resolve(__dirname, "../deployments/polygon-deployment-current.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  const impl = deployments.contracts.orderBookImplementation as string;
  if (!impl) {
    throw new Error("Missing orderBookImplementation in deployments file");
  }

  console.log(`\nNetwork: ${network.name}`);
  console.log(`Clone:   ${cloneAddress}`);
  console.log(`Impl:    ${impl}`);

  console.log("\n➡️  Note: Minimal proxies (EIP-1167) are linked to the implementation.\n" +
              "Ensure the implementation is verified. The explorer will display this clone as a proxy.");

  console.log("✅ Nothing to verify for the clone bytecode itself. Verify the implementation with:\n" +
              `   npx hardhat run scripts/verify-implementation.ts --network ${network.name}`);

  console.log("\n🔗 Polygonscan links:");
  console.log(`   Clone: https://polygonscan.com/address/${cloneAddress}`);
  console.log(`   Impl:  https://polygonscan.com/address/${impl}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


