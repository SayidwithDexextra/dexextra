const { ethers } = require("hardhat");

async function main() {
  // Get signers
  const [owner, user1, user2] = await ethers.getSigners();

  // Contract address from deployment
  const MOCKUSDC_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

  // Get contract instance
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = MockUSDC.attach(MOCKUSDC_ADDRESS);

  console.log("=== MockUSDC Contract Interaction ===");
  console.log("Contract address:", MOCKUSDC_ADDRESS);
  console.log("Owner:", owner.address);
  console.log("User1:", user1.address);
  console.log("User2:", user2.address);

  // Check initial state
  console.log("\n--- Initial State ---");
  const totalSupply = await mockUSDC.totalSupply();
  const ownerBalance = await mockUSDC.balanceOf(owner.address);
  console.log("Total Supply:", ethers.formatUnits(totalSupply, 6), "USDC");
  console.log("Owner Balance:", ethers.formatUnits(ownerBalance, 6), "USDC");

  // Test faucet function (anyone can call)
  console.log("\n--- Testing Faucet ---");
  const faucetAmount = ethers.parseUnits("5000", 6); // 5000 USDC
  await mockUSDC.connect(user1).faucet(faucetAmount);
  console.log("User1 called faucet for 5000 USDC");

  const user1Balance = await mockUSDC.balanceOf(user1.address);
  console.log("User1 Balance:", ethers.formatUnits(user1Balance, 6), "USDC");

  // Test transfer function
  console.log("\n--- Testing Transfer ---");
  const transferAmount = ethers.parseUnits("1000", 6); // 1000 USDC
  await mockUSDC.connect(user1).transfer(user2.address, transferAmount);
  console.log("User1 transferred 1000 USDC to User2");

  const user1BalanceAfter = await mockUSDC.balanceOf(user1.address);
  const user2Balance = await mockUSDC.balanceOf(user2.address);
  console.log(
    "User1 Balance:",
    ethers.formatUnits(user1BalanceAfter, 6),
    "USDC"
  );
  console.log("User2 Balance:", ethers.formatUnits(user2Balance, 6), "USDC");

  // Test mint function (owner only)
  console.log("\n--- Testing Mint (Owner Only) ---");
  const mintAmount = ethers.parseUnits("10000", 6); // 10000 USDC
  await mockUSDC.connect(owner).mint(user2.address, mintAmount);
  console.log("Owner minted 10000 USDC to User2");

  const user2BalanceAfterMint = await mockUSDC.balanceOf(user2.address);
  console.log(
    "User2 Balance:",
    ethers.formatUnits(user2BalanceAfterMint, 6),
    "USDC"
  );

  // Test approve and transferFrom
  console.log("\n--- Testing Approve & TransferFrom ---");
  const approveAmount = ethers.parseUnits("2000", 6); // 2000 USDC
  await mockUSDC.connect(user2).approve(user1.address, approveAmount);
  console.log("User2 approved User1 to spend 2000 USDC");

  const allowance = await mockUSDC.allowance(user2.address, user1.address);
  console.log("Allowance:", ethers.formatUnits(allowance, 6), "USDC");

  const transferFromAmount = ethers.parseUnits("500", 6); // 500 USDC
  await mockUSDC
    .connect(user1)
    .transferFrom(user2.address, owner.address, transferFromAmount);
  console.log("User1 transferred 500 USDC from User2 to Owner");

  // Final balances
  console.log("\n--- Final Balances ---");
  const finalOwnerBalance = await mockUSDC.balanceOf(owner.address);
  const finalUser1Balance = await mockUSDC.balanceOf(user1.address);
  const finalUser2Balance = await mockUSDC.balanceOf(user2.address);
  const finalTotalSupply = await mockUSDC.totalSupply();

  console.log(
    "Owner Balance:",
    ethers.formatUnits(finalOwnerBalance, 6),
    "USDC"
  );
  console.log(
    "User1 Balance:",
    ethers.formatUnits(finalUser1Balance, 6),
    "USDC"
  );
  console.log(
    "User2 Balance:",
    ethers.formatUnits(finalUser2Balance, 6),
    "USDC"
  );
  console.log("Total Supply:", ethers.formatUnits(finalTotalSupply, 6), "USDC");

  console.log("\n✅ All functions tested successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
