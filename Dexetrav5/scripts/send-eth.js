#!/usr/bin/env node

const { ethers } = require("hardhat");

async function feeOverridesForNetwork(networkName) {
  let fee;
  try {
    fee = await Promise.race([
      ethers.provider.getFeeData(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("feeDataTimeout")), 8000)),
    ]);
  } catch (e) {
    fee = {};
    console.log(`  ℹ️ feeData unavailable (${e?.message || e}), using default overrides`);
  }
  const isPolygon = String(networkName || "").toLowerCase().includes("polygon");
  const defaultTip = ethers.parseUnits(isPolygon ? "35" : "3", "gwei");
  const maxPriorityFeePerGas = fee?.maxPriorityFeePerGas || defaultTip;
  const base = fee?.maxFeePerGas || fee?.gasPrice || defaultTip * 2n;
  const maxFeePerGas = base + maxPriorityFeePerGas * 2n;
  return { maxFeePerGas, maxPriorityFeePerGas };
}

async function main() {
  const [sender] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const networkName = process.env.HARDHAT_NETWORK || String(network.chainId);

  const to =
    process.env.TARGET ||
    process.env.DEPOSIT_SENDER_ADDRESS ||
    process.env.RELAYER_ADDRESS ||
    process.env.RELAYER_PUBLIC_ADDRESS ||
    "";
  const amountEth = process.env.AMOUNT_ETH || "0.03";
  if (!to || !ethers.isAddress(to)) {
    throw new Error("TARGET (recipient address) is required");
  }

  console.log("\n💸 Send ETH");
  console.log("─".repeat(60));
  console.log(`Network: ${networkName} (chainId ${network.chainId})`);
  console.log(`From:    ${sender.address}`);
  console.log(`To:      ${to}`);
  console.log(`Amount:  ${amountEth} ETH`);

  const bal = await ethers.provider.getBalance(sender.address);
  console.log(`Sender balance: ${ethers.formatEther(bal)} ETH`);

  const feeOv = await feeOverridesForNetwork(networkName);
  console.log(
    `  ↳ fee overrides: maxPriorityFeePerGas=${feeOv.maxPriorityFeePerGas?.toString?.()} maxFeePerGas=${feeOv.maxFeePerGas?.toString?.()}`
  );

  const tx = await sender.sendTransaction({
    to,
    value: ethers.parseEther(amountEth),
    ...feeOv,
  });
  console.log(`  ⛽ tx: ${tx.hash}`);
  await tx.wait();
  console.log("  ✅ transfer confirmed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});





