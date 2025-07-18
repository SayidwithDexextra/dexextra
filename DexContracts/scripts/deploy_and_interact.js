const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  console.log(
    "Account balance:",
    (await hre.ethers.provider.getBalance(deployer.address)).toString()
  );

  // --- Step 1: Deploy Core Infrastructure ---
  console.log("\n--- Deploying Core Infrastructure ---");

  // Deploy MockUSDC
  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
  const initialSupply = hre.ethers.parseUnits("1000000", 6);
  const mockUSDC = await MockUSDC.deploy(initialSupply);
  await mockUSDC.waitForDeployment();
  console.log("MockUSDC deployed to:", mockUSDC.address);

  // Deploy MockPriceOracle
  const MockPriceOracle = await hre.ethers.getContractFactory(
    "MockPriceOracle"
  );
  const mockPriceOracle = await MockPriceOracle.deploy();
  await mockPriceOracle.waitForDeployment();
  console.log("MockPriceOracle deployed to:", mockPriceOracle.address);
  const priceTx = await mockPriceOracle.setPrice(
    hre.ethers.parseUnits("1500", 18)
  );
  await priceTx.wait();
  console.log("MockPriceOracle price set to 1500.");

  // Deploy vAMMFactory
  const VAMMFactory = await hre.ethers.getContractFactory("vAMMFactory");
  const vammFactory = await VAMMFactory.deploy();
  await vammFactory.waitForDeployment();
  console.log("vAMMFactory deployed to:", vammFactory.address);

  // --- Step 2: Create a New Market via the Factory ---
  console.log("\n--- Creating a New Market ---");
  const startingPrice = hre.ethers.parseUnits("1", 18); // $1 starting price
  const deploymentFee = await vammFactory.deploymentFee();

  const createMarketTx = await vammFactory.createMarket(
    "TEST/USD",
    mockPriceOracle.address,
    mockUSDC.address,
    startingPrice,
    { value: deploymentFee }
  );

  const receipt = await createMarketTx.wait();
  const marketCreatedEvent = receipt.events?.find(
    (e) => e.event === "MarketCreated"
  );

  if (!marketCreatedEvent) {
    throw new Error(
      "Market creation failed: could not find MarketCreated event."
    );
  }

  const { vamm: vammAddress, vault: vaultAddress } = marketCreatedEvent.args;
  console.log("vAMM deployed to:", vammAddress);
  console.log("Vault deployed to:", vaultAddress);

  // --- Step 3: Interact with the New Market ---
  console.log("\n--- Interacting with the New Market ---");

  // Get contract instances for the newly created market
  const vamm = await hre.ethers.getContractAt("vAMM", vammAddress);
  const vault = await hre.ethers.getContractAt("Vault", vaultAddress);

  // Approve Vault to spend MockUSDC
  const approveAmount = hre.ethers.parseUnits("5000", 6);
  const approveTx = await mockUSDC.approve(vaultAddress, approveAmount);
  await approveTx.wait();
  console.log("Vault approved to spend MockUSDC.");

  // Deposit collateral into the new Vault
  const depositAmount = hre.ethers.parseUnits("1000", 6);
  const depositTx = await vault.depositCollateral(
    deployer.address,
    depositAmount
  );
  await depositTx.wait();
  console.log("Deposited 1000 MockUSDC into the Vault.");

  // Open a position
  console.log("\n--- Opening a Position ---");
  const initialMarkPrice = await vamm.getMarkPrice();
  console.log(
    "Initial Mark Price:",
    hre.ethers.formatUnits(initialMarkPrice, 18)
  );

  const collateralAmount = hre.ethers.parseUnits("100", 18);
  const leverage = 5;
  const isLong = true;

  const openPositionTx = await vamm.openPosition(
    collateralAmount,
    isLong,
    leverage,
    0, // minPrice - setting to 0 for simplicity in this script
    hre.ethers.constants.MaxUint256 // maxPrice - setting to max for simplicity
  );

  const openPositionReceipt = await openPositionTx.wait();
  const positionOpenedEvent = openPositionReceipt.events?.find(
    (e) => e.event === "PositionOpened"
  );

  if (positionOpenedEvent) {
    const { price } = positionOpenedEvent.args;
    console.log(
      "Position opened successfully at price:",
      hre.ethers.formatUnits(price, 18)
    );
  } else {
    console.log("Position opened, but could not parse the event details.");
  }

  const finalMarkPrice = await vamm.getMarkPrice();
  console.log("Final Mark Price:", hre.ethers.formatUnits(finalMarkPrice, 18));
  console.log(
    "Price scaled by:",
    hre.ethers.formatUnits(finalMarkPrice.sub(initialMarkPrice), 18)
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
