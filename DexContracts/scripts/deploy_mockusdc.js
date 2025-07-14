const { ethers } = require("hardhat");

async function main() {
  console.log("Deploying MockUSDC contract...");

  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log(
    "Account balance:",
    (await ethers.provider.getBalance(deployer.address)).toString()
  );

  // Deploy MockUSDC
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const initialSupply = 1000000; // 1M USDC

  console.log("Deploying MockUSDC with initial supply:", initialSupply);
  const mockUSDC = await MockUSDC.deploy(initialSupply);

  await mockUSDC.waitForDeployment();

  const contractAddress = await mockUSDC.getAddress();
  console.log("MockUSDC deployed to:", contractAddress);

  // Get contract details
  const name = await mockUSDC.name();
  const symbol = await mockUSDC.symbol();
  const decimals = await mockUSDC.decimals();
  const totalSupply = await mockUSDC.totalSupply();
  const deployerBalance = await mockUSDC.balanceOf(deployer.address);

  console.log("\n=== Contract Details ===");
  console.log("Name:", name);
  console.log("Symbol:", symbol);
  console.log("Decimals:", decimals);
  console.log("Total Supply:", totalSupply.toString());
  console.log("Deployer Balance:", deployerBalance.toString());
  console.log("========================");

  console.log("\n✅ MockUSDC deployed successfully!");
  console.log("Contract address:", contractAddress);

  return mockUSDC;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
