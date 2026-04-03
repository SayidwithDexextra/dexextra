#!/usr/bin/env node

/**
 * deploy-dispute-relay.js
 *
 * Deploys the DisputeRelay contract to Sepolia (or any UMA-supported chain).
 * Points it at the UMA OOv3 and a bond token, then optionally funds the pool.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-dispute-relay.js --network sepolia
 *
 * Environment variables:
 *   UMA_OOV3_ADDRESS          - OOv3 contract (defaults to Sepolia deployment)
 *   UMA_BOND_TOKEN            - ERC-20 bond token (if unset, deploys a MockUSDC)
 *   DISPUTE_RELAY_POOL_FUND   - Amount to deposit into pool after deploy (6 decimals, e.g. "500000000" = 500 USDC)
 */

const path = require("path");
const fs = require("fs");
const { ethers } = require("hardhat");

// UMA OOv3 on Sepolia (from https://github.com/UMAprotocol/protocol/blob/master/packages/core/networks/11155111.json)
const UMA_OOV3_SEPOLIA = "0xFd9e2642a170aDD10F53Ee14a93FcF2F31924944";

async function main() {
  console.log("\n🚀 Deploy DisputeRelay for UMA Integration");
  console.log("═".repeat(80));

  const network = await ethers.provider.getNetwork();
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  const [deployer] = await ethers.getSigners();

  console.log(`🌐 Network: ${networkName} (Chain ID: ${network.chainId})`);
  console.log(`👤 Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH`);
  if (balance === 0n) {
    console.error("❌ Deployer has 0 ETH. Get Sepolia ETH from a faucet first.");
    process.exit(1);
  }

  // Resolve OOv3 address
  const oov3Addr = process.env.UMA_OOV3_ADDRESS || UMA_OOV3_SEPOLIA;
  console.log(`\n🔮 UMA OOv3: ${oov3Addr}`);

  // Resolve or deploy bond token
  let bondTokenAddr = process.env.UMA_BOND_TOKEN || "";
  if (!bondTokenAddr) {
    console.log("\n💎 No UMA_BOND_TOKEN set — deploying MockUSDC as bond token...");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUsdc = await MockUSDC.deploy(deployer.address);
    await mockUsdc.waitForDeployment();
    bondTokenAddr = await mockUsdc.getAddress();
    console.log(`   ✅ MockUSDC deployed at: ${bondTokenAddr}`);

    // Mint initial supply for testing
    const mintAmount = ethers.parseUnits("10000", 6); // 10,000 USDC
    await mockUsdc.mint(deployer.address, mintAmount);
    console.log(`   ✅ Minted 10,000 test USDC to deployer`);
  } else {
    console.log(`💎 Bond token: ${bondTokenAddr}`);
  }

  // Deploy DisputeRelay
  console.log("\n⛏️  Deploying DisputeRelay...");
  const DisputeRelay = await ethers.getContractFactory("DisputeRelay");
  const relay = await DisputeRelay.deploy(oov3Addr, bondTokenAddr, deployer.address);
  await relay.waitForDeployment();
  const relayAddr = await relay.getAddress();
  console.log(`✅ DisputeRelay deployed at: ${relayAddr}`);

  // Optionally fund the pool
  const poolFundRaw = process.env.DISPUTE_RELAY_POOL_FUND || "";
  if (poolFundRaw) {
    const fundAmount = BigInt(poolFundRaw);
    console.log(`\n💰 Funding dispute pool with ${ethers.formatUnits(fundAmount, 6)} USDC...`);
    const token = await ethers.getContractAt("MockUSDC", bondTokenAddr);
    await token.approve(relayAddr, fundAmount);
    await relay.deposit(fundAmount);
    const poolBal = await relay.poolBalance();
    console.log(`   ✅ Pool balance: ${ethers.formatUnits(poolBal, 6)} USDC`);
  } else {
    console.log("\n💡 Pool not funded. Set DISPUTE_RELAY_POOL_FUND to auto-fund on deploy.");
    console.log("   You can fund later by calling deposit() on the contract.");
  }

  // Verify OOv3 is reachable
  console.log("\n🔍 Verifying UMA OOv3 connection...");
  try {
    const oov3Contract = await ethers.getContractAt(
      ["function defaultIdentifier() view returns (bytes32)"],
      oov3Addr
    );
    const defaultId = await oov3Contract.defaultIdentifier();
    console.log(`   ✅ OOv3 defaultIdentifier: ${defaultId}`);
  } catch (e) {
    console.log(`   ⚠️  Could not read OOv3 (may not be deployed on this chain): ${e.message}`);
  }

  // Save deployment
  const deploymentPath = path.join(
    __dirname,
    `../deployments/${networkName}-dispute-relay-deployment.json`
  );
  const deployment = {
    network: networkName,
    chainId: Number(network.chainId),
    timestamp: new Date().toISOString(),
    contracts: {
      DISPUTE_RELAY: relayAddr,
      UMA_OOV3: oov3Addr,
      BOND_TOKEN: bondTokenAddr,
    },
    deployer: deployer.address,
    umaNetworkAddresses: {
      OptimisticOracleV3: oov3Addr,
      MockOracleAncillary: "0x5FE28AEa36420414692b1C907F7d0114d304eb0C",
      AddressWhitelist: "0xE8DE4bcE27f6214dcE18D8a7629f233C66A97B84",
      IdentifierWhitelist: "0xfcb6f77112951e1995d37542b519Fe0a85a1AA77",
      Store: "0x39e7FFA77A4ac4D34021C6BbE4C8778d47F684F2",
    },
  };

  fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log(`\n📝 Saved: deployments/${networkName}-dispute-relay-deployment.json`);

  // Summary
  console.log("\n" + "═".repeat(80));
  console.log("📋 DEPLOYMENT SUMMARY");
  console.log("═".repeat(80));
  console.log(`  DisputeRelay:     ${relayAddr}`);
  console.log(`  UMA OOv3:         ${oov3Addr}`);
  console.log(`  Bond Token:       ${bondTokenAddr}`);
  console.log(`  Owner:            ${deployer.address}`);

  console.log("\n➡️  NEXT STEPS:");
  console.log("  1. Fund the pool:");
  console.log(`     DISPUTE_RELAY_POOL_FUND=500000000 npx hardhat run scripts/deploy-dispute-relay.js --network ${networkName}`);
  console.log("     Or call deposit() directly on the contract.");
  console.log("  2. Run the test script:");
  console.log(`     npx hardhat run scripts/test-dispute-relay.js --network ${networkName}`);
  console.log("  3. Set env vars for the relayer service:");
  console.log(`     DISPUTE_RELAY_ADDRESS=${relayAddr}`);
  console.log(`     SEPOLIA_RPC_URL=<your sepolia rpc>`);
  console.log("\n✅ Done.\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Deploy failed:", e.message || e);
    process.exit(1);
  });
