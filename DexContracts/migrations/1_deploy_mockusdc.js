const MockUSDC = artifacts.require("MockUSDC");

module.exports = async function (deployer, network, accounts) {
  console.log("Deploying MockUSDC contract to network:", network);
  console.log("Deployer account:", accounts[0]);

  try {
    // Deploy Mock USDC with 1M initial supply
    console.log("Deploying Mock USDC...");
    const initialSupply = 1000000; // 1 Million USDC (will be multiplied by 10^6 in constructor)

    await deployer.deploy(MockUSDC, initialSupply);
    const usdc = await MockUSDC.deployed();

    console.log("Mock USDC deployed successfully!");
    console.log("Contract address:", usdc.address);
    console.log("Network:", network);

    // Get contract details
    const name = await usdc.name();
    const symbol = await usdc.symbol();
    const decimals = await usdc.decimals();
    const totalSupply = await usdc.totalSupply();
    const deployerBalance = await usdc.balanceOf(accounts[0]);

    console.log("\n=== Contract Details ===");
    console.log("Name:", name);
    console.log("Symbol:", symbol);
    console.log("Decimals:", decimals.toString());
    console.log("Total Supply:", totalSupply.toString());
    console.log("Deployer Balance:", deployerBalance.toString());
    console.log("========================");

    console.log("\nDeployment completed successfully!");
  } catch (error) {
    console.error("Deployment failed:", error.message);
    throw error;
  }
};
