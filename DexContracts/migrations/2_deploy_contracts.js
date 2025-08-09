const MockUSDC = artifacts.require("MockUSDC");
const MockPriceOracle = artifacts.require("MockPriceOracle");
const vAMMFactory = artifacts.require("vAMMFactory");

module.exports = async function (deployer, network, accounts) {
  console.log("Deploying vAMM system to network:", network);
  console.log("Deployer account:", accounts[0]);

  // Deploy Mock USDC with 1M initial supply
  console.log("Deploying Mock USDC...");
  await deployer.deploy(MockUSDC, 1000000); // 1M USDC
  const usdc = await MockUSDC.deployed();
  console.log("Mock USDC deployed at:", usdc.address);

  // Deploy Mock Price Oracle with $50,000 initial price (18 decimals)
  // const initialPrice = web3.utils.toWei("50000", "ether");
  //  console.log("Deploying Mock Price Oracle...");
  // await deployer.deploy(MockPriceOracle, initialPrice);
  // const oracle = await MockPriceOracle.deployed();
  //  console.log("Mock Price Oracle deployed at:", oracle.address);

  // // Deploy vAMM Factory
  //  console.log("Deploying vAMM Factory...");
  // await deployer.deploy(vAMMFactory);
  // const factory = await vAMMFactory.deployed();
  //  console.log("vAMM Factory deployed at:", factory.address);

  // // Create a test market (BTC/USDC)
  //  console.log("Creating test BTC/USDC market...");
  // const deploymentFee = web3.utils.toWei("0.1", "ether");
  // const result = await factory.createMarket(
  //   "BTC/USDC",
  //   oracle.address,
  //   usdc.address,
  //   initialPrice,
  //   { value: deploymentFee, from: accounts[0] }
  // );

  // // Extract market information from events
  // const marketCreatedEvent = result.logs.find(log => log.event === 'MarketCreated');
  // if (marketCreatedEvent) {
  //    console.log("Market created successfully!");
  //    console.log("Market ID:", marketCreatedEvent.args.marketId);
  //    console.log("vAMM address:", marketCreatedEvent.args.vamm);
  //    console.log("Vault address:", marketCreatedEvent.args.vault);
  // }

  //  console.log("\n=== Deployment Summary ===");
  //  console.log("Mock USDC:", usdc.address);
  //  console.log("Mock Oracle:", oracle.address);
  //  console.log("vAMM Factory:", factory.address);
  //  console.log("========================\n");

  // // Mint some USDC to test accounts for testing
  //  console.log("Minting test USDC to accounts...");
  // for (let i = 1; i < Math.min(5, accounts.length); i++) {
  //   const testAmount = web3.utils.toWei("10000", "mwei"); // 10,000 USDC (6 decimals)
  //   await usdc.mint(accounts[i], testAmount);
  //    console.log(`Minted 10,000 USDC to ${accounts[i]}`);
  // }

  console.log("Deployment completed successfully!");
};
