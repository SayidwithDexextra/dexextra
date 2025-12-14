// Set marketCreationFee on the deployed FuturesMarketFactory.
// Reads envs (CORE_VAULT_ADDRESS optional for sanity), uses FACTORY_ADMIN_ADDRESS as the admin key holder.
// Usage: npx hardhat run scripts/set-market-creation-fee.js --network <network>

const path = require("path");
try {
  require("dotenv").config({
    path: path.resolve(__dirname, "../../.env.local"),
  });
} catch (_) {}
try {
  require("dotenv").config();
} catch (_) {}

const { ethers } = require("hardhat");

function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env ${name}`);
  return v.trim();
}

async function main() {
  console.log("--- Set marketCreationFee ---");
  const factoryAddress = required("FUTURES_MARKET_FACTORY_ADDRESS");
  const newFee = required("MARKET_CREATION_FEE"); // 6-decimals (e.g., "0" to disable fee)

  const [signer] = await ethers.getSigners();
  console.log("Admin signer:", signer.address);
  console.log("Factory:", factoryAddress);
  console.log("New fee (6 decimals):", newFee);

  const Factory = await ethers.getContractAt(
    "FuturesMarketFactory",
    factoryAddress,
    signer
  );
  const tx = await Factory.updateMarketCreationFee(newFee);
  console.log("tx sent:", tx.hash);
  await tx.wait();
  console.log("tx mined");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


