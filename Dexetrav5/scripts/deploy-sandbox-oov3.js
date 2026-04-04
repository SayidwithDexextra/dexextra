#!/usr/bin/env node

/**
 * deploy-sandbox-oov3.js
 *
 * Deploys a SandboxOOv3 + DisputeRelay pair for test environments.
 * The SandboxOOv3 allows admin-driven instant dispute resolution
 * instead of waiting 48-96h for the real UMA DVM vote.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-sandbox-oov3.js --network sepolia
 *
 * Environment variables:
 *   UMA_BOND_TOKEN            - ERC-20 bond token (defaults to Sepolia WETH)
 *   DISPUTE_RELAY_POOL_FUND   - Amount to deposit into pool (raw units, e.g. "4000000000000000" = 0.004 WETH)
 */

const path = require("path");
const fs = require("fs");
const { ethers } = require("hardhat");

const SEPOLIA_WETH = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";

async function main() {
  console.log("\n>>> Deploy SandboxOOv3 + DisputeRelay (Test Environment)");
  console.log("=".repeat(80));

  const network = await ethers.provider.getNetwork();
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  const [deployer] = await ethers.getSigners();

  console.log(`Network:  ${networkName} (Chain ID: ${network.chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH`);
  if (balance === 0n) {
    console.error("Deployer has 0 ETH. Fund the account first.");
    process.exit(1);
  }

  const bondTokenAddr = process.env.UMA_BOND_TOKEN || SEPOLIA_WETH;
  const isWeth = bondTokenAddr.toLowerCase() === SEPOLIA_WETH.toLowerCase();
  const decimals = isWeth ? 18 : 6;
  const symbol = isWeth ? "WETH" : "USDC";

  console.log(`Bond token: ${bondTokenAddr} (${symbol})`);

  // --- Deploy SandboxOOv3 ---
  console.log("\n[1/3] Deploying SandboxOOv3...");
  const SandboxOOv3 = await ethers.getContractFactory("SandboxOOv3");
  const sandbox = await SandboxOOv3.deploy(deployer.address);
  await sandbox.waitForDeployment();
  const sandboxAddr = await sandbox.getAddress();
  console.log(`  SandboxOOv3 deployed at: ${sandboxAddr}`);

  // Verify defaultIdentifier
  const defId = await sandbox.defaultIdentifier();
  console.log(`  defaultIdentifier: ${defId}`);

  // --- Deploy DisputeRelay pointing at SandboxOOv3 ---
  console.log("\n[2/3] Deploying DisputeRelay (pointing at SandboxOOv3)...");
  const DisputeRelay = await ethers.getContractFactory("DisputeRelay");
  const relay = await DisputeRelay.deploy(sandboxAddr, bondTokenAddr, deployer.address);
  await relay.waitForDeployment();
  const relayAddr = await relay.getAddress();
  console.log(`  DisputeRelay deployed at: ${relayAddr}`);

  // --- Fund the DisputeRelay pool ---
  console.log("\n[3/3] Funding DisputeRelay pool...");

  const defaultFund = isWeth
    ? ethers.parseEther("0.01")
    : ethers.parseUnits("100", 6);
  const fundAmount = process.env.DISPUTE_RELAY_POOL_FUND
    ? BigInt(process.env.DISPUTE_RELAY_POOL_FUND)
    : defaultFund;

  if (isWeth) {
    console.log(`  Wrapping ${ethers.formatEther(fundAmount)} ETH -> WETH...`);
    const wrapTx = await deployer.sendTransaction({
      to: bondTokenAddr,
      value: fundAmount,
    });
    await wrapTx.wait();
    console.log(`  Wrapped.`);
  }

  const token = await ethers.getContractAt(
    ["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"],
    bondTokenAddr,
    deployer
  );

  const tokenBal = await token.balanceOf(deployer.address);
  console.log(`  Deployer ${symbol} balance: ${ethers.formatUnits(tokenBal, decimals)}`);

  if (tokenBal < fundAmount) {
    console.error(`  Insufficient ${symbol}. Have ${ethers.formatUnits(tokenBal, decimals)}, need ${ethers.formatUnits(fundAmount, decimals)}`);
    console.log("  Skipping pool funding. Fund manually later with deposit().");
  } else {
    const approveTx = await token.approve(relayAddr, fundAmount);
    await approveTx.wait();
    const depositTx = await relay.deposit(fundAmount);
    await depositTx.wait();
    const poolBal = await relay.poolBalance();
    console.log(`  Pool funded: ${ethers.formatUnits(poolBal, decimals)} ${symbol}`);
  }

  // --- Save deployment ---
  const deploymentPath = path.join(
    __dirname,
    `../deployments/${networkName}-sandbox-deployment.json`
  );
  const deployment = {
    network: networkName,
    chainId: Number(network.chainId),
    timestamp: new Date().toISOString(),
    mode: "sandbox",
    contracts: {
      SANDBOX_OOV3: sandboxAddr,
      DISPUTE_RELAY: relayAddr,
      BOND_TOKEN: bondTokenAddr,
    },
    bondTokenInfo: { symbol, decimals },
    deployer: deployer.address,
  };

  fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log(`\nSaved: deployments/${networkName}-sandbox-deployment.json`);

  // --- Summary ---
  console.log("\n" + "=".repeat(80));
  console.log("DEPLOYMENT SUMMARY");
  console.log("=".repeat(80));
  console.log(`  SandboxOOv3:    ${sandboxAddr}`);
  console.log(`  DisputeRelay:   ${relayAddr}`);
  console.log(`  Bond Token:     ${bondTokenAddr} (${symbol})`);
  console.log(`  Owner:          ${deployer.address}`);

  console.log("\nENV UPDATES:");
  console.log(`  DISPUTE_RELAY_ADDRESS=${relayAddr}`);
  console.log(`  SANDBOX_OOV3_ADDRESS=${sandboxAddr}`);

  console.log("\nRESOLVE DISPUTES:");
  console.log(`  ASSERTION_ID=0x... CHALLENGER_WINS=true npx hardhat run scripts/resolve-dispute.js --network ${networkName}`);

  console.log("\nDone.\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nDeploy failed:", e.message || e);
    process.exit(1);
  });
