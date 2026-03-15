const { ethers } = require("ethers");
const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });

const RPC = process.env.ARBITRUM_RPC_URL || process.env.ALCHEMY_ARBITRUM_HTTP;
if (!RPC) throw new Error("No Arbitrum RPC URL found in env");

const FUNDER_PK = process.env.RELAYER_PRIVATE_KEY;
if (!FUNDER_PK) throw new Error("RELAYER_PRIVATE_KEY not set");

const RELAYER_KEYS_JSON = process.env.RELAYER_PRIVATE_KEYS_JSON;
if (!RELAYER_KEYS_JSON) throw new Error("RELAYER_PRIVATE_KEYS_JSON not set");

const MIN_BALANCE = ethers.parseEther("0.0003");
const TOP_UP_AMOUNT = ethers.parseEther("0.00035");

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const funder = new ethers.Wallet(FUNDER_PK, provider);

  const funderBal = await provider.getBalance(funder.address);
  console.log(`Funder: ${funder.address}`);
  console.log(`Funder balance: ${ethers.formatEther(funderBal)} ETH\n`);

  const allKeys = JSON.parse(RELAYER_KEYS_JSON);
  const relayerAddresses = allKeys.map(
    (pk) => new ethers.Wallet(pk.trim()).address
  );

  const uniqueAddresses = [...new Set(relayerAddresses)];
  const needsFunding = [];

  console.log(`--- Checking ${uniqueAddresses.length} relayer wallets ---\n`);

  for (const addr of uniqueAddresses) {
    if (addr.toLowerCase() === funder.address.toLowerCase()) {
      const bal = await provider.getBalance(addr);
      console.log(
        `  ${addr}  ${ethers.formatEther(bal)} ETH  (funder, skip)`
      );
      continue;
    }

    const bal = await provider.getBalance(addr);
    const status = bal < MIN_BALANCE ? "LOW" : "OK";
    console.log(`  ${addr}  ${ethers.formatEther(bal)} ETH  [${status}]`);

    if (bal < MIN_BALANCE) {
      needsFunding.push(addr);
    }
  }

  if (needsFunding.length === 0) {
    console.log("\nAll relayer wallets have sufficient ETH. Nothing to do.");
    return;
  }

  const totalNeeded = TOP_UP_AMOUNT * BigInt(needsFunding.length);
  console.log(
    `\n${needsFunding.length} wallets need funding.`
  );
  console.log(
    `Top-up amount per wallet: ${ethers.formatEther(TOP_UP_AMOUNT)} ETH`
  );
  console.log(`Total needed: ${ethers.formatEther(totalNeeded)} ETH`);

  if (funderBal < totalNeeded + ethers.parseEther("0.0005")) {
    console.error(
      `\nFunder has insufficient balance. Need ~${ethers.formatEther(totalNeeded)} but have ${ethers.formatEther(funderBal)}`
    );
    process.exit(1);
  }

  console.log("\n--- Sending transactions ---\n");

  for (const addr of needsFunding) {
    const tx = await funder.sendTransaction({
      to: addr,
      value: TOP_UP_AMOUNT,
    });
    console.log(`  → ${addr}  tx: ${tx.hash}`);
    await tx.wait();
    console.log(`    confirmed`);
  }

  console.log("\n--- Done. Final balances ---\n");
  for (const addr of uniqueAddresses) {
    const bal = await provider.getBalance(addr);
    console.log(`  ${addr}  ${ethers.formatEther(bal)} ETH`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
