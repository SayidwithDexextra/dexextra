const { ethers } = require("hardhat");

async function main() {
  console.log("🔑 Hardhat Test Accounts for MetaMask Import:\n");

  // Get the default accounts from Hardhat
  const accounts = await ethers.getSigners();

  // Display first 5 accounts with their private keys and balances
  for (let i = 0; i < Math.min(5, accounts.length); i++) {
    const account = accounts[i];
    const balance = await ethers.provider.getBalance(account.address);

    console.log(`📋 Account ${i + 1}:`);
    console.log(`   Address: ${account.address}`);
    console.log(
      `   Private Key: 0x${"ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80".slice(
        0,
        -2 * i
      )}${i.toString().padStart(2 * i, "0")}`
    );
    console.log(`   Balance: ${ethers.formatEther(balance)} ETH`);
    console.log("");
  }

  // Show the actual deterministic private keys used by Hardhat
  const hardhatAccounts = [
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    "0x5de4111afa1a4b94908f83103c5c8c6d9ca7de25cb2c8e2f3ac02b3c6b2c3b0b",
    "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  ];

  console.log("🔐 Hardhat Default Private Keys (for MetaMask import):");
  console.log("Copy these to import accounts into MetaMask:\n");

  for (let i = 0; i < hardhatAccounts.length; i++) {
    console.log(`Account ${i + 1}: ${hardhatAccounts[i]}`);
  }

  console.log(
    "\n⚠️  WARNING: These are test accounts only - NEVER use on mainnet!"
  );
  console.log("\n📍 Network Details for MetaMask:");
  console.log("   RPC URL: http://127.0.0.1:8545");
  console.log("   Chain ID: 31337");
  console.log("   Currency: ETH");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
