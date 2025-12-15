/* eslint-disable no-console */
// Sets marketCreationFee to zero on the deployed FuturesMarketFactory.
// Usage:
//   FUTURES_MARKET_FACTORY_ADDRESS=0x... npx hardhat run scripts/disable-market-fee.js --network hyperliquid
// Requires LEGACY_ADMIN (or the first configured account) to be the factory admin.

const { ethers } = require("hardhat");

async function main() {
  const factoryAddress = process.env.FUTURES_MARKET_FACTORY_ADDRESS;
  if (!factoryAddress) {
    throw new Error("FUTURES_MARKET_FACTORY_ADDRESS env var is required");
  }
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);
  console.log("Factory:", factoryAddress);

  const factory = await ethers.getContractAt(
    "FuturesMarketFactory",
    factoryAddress,
    signer
  );
  const tx = await factory.updateMarketCreationFee(0);
  console.log("tx:", tx.hash);
  const rc = await tx.wait();
  console.log("✅ fee set to 0, mined in block:", rc.blockNumber);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});



