const { ethers } = require("hardhat");

async function main() {
  console.log("🚀 Deploying vAMM Factory to Polygon Mainnet...");

  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log("📝 Deploying with account:", deployer.address);

  // Check balance
  const balance = await deployer.getBalance();
  console.log(
    "💰 Account balance:",
    ethers.utils.formatEther(balance),
    "MATIC"
  );

  if (balance.lt(ethers.utils.parseEther("0.1"))) {
    console.warn("⚠️  Low balance! You may need more MATIC for deployment");
  }

  // Deploy vAMM Factory
  console.log("\n📦 Deploying vAMMFactory...");
  const VammFactory = await ethers.getContractFactory("vAMMFactory");

  // Estimate gas
  const deploymentData = VammFactory.getDeployTransaction();
  const gasEstimate = await deployer.estimateGas(deploymentData);
  const gasPrice = await deployer.getGasPrice();
  const estimatedCost = gasEstimate.mul(gasPrice);

  console.log("⛽ Estimated gas:", gasEstimate.toString());
  console.log(
    "💸 Estimated cost:",
    ethers.utils.formatEther(estimatedCost),
    "MATIC"
  );

  // Deploy
  const factory = await VammFactory.deploy();
  await factory.deployed();

  console.log("✅ vAMMFactory deployed to:", factory.address);
  console.log("🔗 Transaction hash:", factory.deployTransaction.hash);

  // Wait for confirmations
  console.log("⏳ Waiting for 5 confirmations...");
  await factory.deployTransaction.wait(5);

  console.log("\n📋 Contract Details:");
  console.log("Contract Address:", factory.address);
  console.log("Deployer:", deployer.address);
  console.log("Network: Polygon Mainnet (137)");
  console.log("Block:", await ethers.provider.getBlockNumber());

  // Get initial state
  const owner = await factory.owner();
  const marketCount = await factory.marketCount();
  const deploymentFee = await factory.deploymentFee();

  console.log("\n⚙️  Initial State:");
  console.log("Owner:", owner);
  console.log("Market Count:", marketCount.toString());
  console.log(
    "Deployment Fee:",
    ethers.utils.formatEther(deploymentFee),
    "MATIC"
  );

  console.log("\n🎉 Deployment Complete!");
  console.log("📄 Verify on PolygonScan:");
  console.log(`https://polygonscan.com/address/${factory.address}`);

  // Save deployment info
  const deployment = {
    network: "polygon",
    chainId: 137,
    contractAddress: factory.address,
    deploymentHash: factory.deployTransaction.hash,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    blockNumber: await ethers.provider.getBlockNumber(),
  };

  console.log("\n💾 Deployment Info:", JSON.stringify(deployment, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
