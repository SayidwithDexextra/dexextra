/**
 * Deploy ONLY the MockOrderBookEvents emitter contract.
 *
 * This intentionally does NOT deploy the diamond / vault / factory.
 *
 * Usage:
 *   cd Dexetrav5
 *   npx hardhat run scripts/deploy-mock-orderbook-events.js --network localhost
 */
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("deployer:", deployer.address);

  const Factory = await hre.ethers.getContractFactory("MockOrderBookEvents");
  const c = await Factory.deploy();
  await c.waitForDeployment();

  const addr = await c.getAddress();
  console.log("MockOrderBookEvents deployed:", addr);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

