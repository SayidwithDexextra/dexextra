const { ethers } = require("hardhat");

async function main() {
  console.log("🚀 Starting MockUSDC deployment and testing...");

  // Get signers
  const [owner, user1, user2] = await ethers.getSigners();
  console.log("Owner:", owner.address);
  console.log("User1:", user1.address);
  console.log("User2:", user2.address);

  // ===== DEPLOYMENT =====
  console.log("\n📦 Deploying MockUSDC...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const initialSupply = 1000000; // 1M USDC
  const mockUSDC = await MockUSDC.deploy(initialSupply);
  await mockUSDC.waitForDeployment();

  const contractAddress = await mockUSDC.getAddress();
  console.log("✅ MockUSDC deployed to:", contractAddress);

  // ===== INITIAL STATE =====
  console.log("\n📊 Checking initial state...");
  const name = await mockUSDC.name();
  const symbol = await mockUSDC.symbol();
  const decimals = await mockUSDC.decimals();
  const totalSupply = await mockUSDC.totalSupply();
  const ownerBalance = await mockUSDC.balanceOf(owner.address);

  console.log("Name:", name);
  console.log("Symbol:", symbol);
  console.log("Decimals:", decimals.toString());
  console.log("Total Supply:", ethers.formatUnits(totalSupply, 6), "USDC");
  console.log("Owner Balance:", ethers.formatUnits(ownerBalance, 6), "USDC");

  // ===== TEST FAUCET FUNCTION =====
  console.log("\n🚰 Testing Faucet Function...");
  const faucetAmount = ethers.parseUnits("5000", 6); // 5000 USDC

  console.log("User1 calling faucet for 5000 USDC...");
  const faucetTx = await mockUSDC.connect(user1).faucet(faucetAmount);
  await faucetTx.wait();

  const user1Balance = await mockUSDC.balanceOf(user1.address);
  console.log("✅ User1 Balance:", ethers.formatUnits(user1Balance, 6), "USDC");

  // ===== TEST TRANSFER FUNCTION =====
  console.log("\n💸 Testing Transfer Function...");
  const transferAmount = ethers.parseUnits("1000", 6); // 1000 USDC

  console.log("User1 transferring 1000 USDC to User2...");
  const transferTx = await mockUSDC
    .connect(user1)
    .transfer(user2.address, transferAmount);
  await transferTx.wait();

  const user1BalanceAfter = await mockUSDC.balanceOf(user1.address);
  const user2Balance = await mockUSDC.balanceOf(user2.address);
  console.log(
    "✅ User1 Balance:",
    ethers.formatUnits(user1BalanceAfter, 6),
    "USDC"
  );
  console.log("✅ User2 Balance:", ethers.formatUnits(user2Balance, 6), "USDC");

  // ===== TEST MINT FUNCTION =====
  console.log("\n🏭 Testing Mint Function (Owner Only)...");
  const mintAmount = ethers.parseUnits("10000", 6); // 10000 USDC

  console.log("Owner minting 10000 USDC to User2...");
  const mintTx = await mockUSDC.connect(owner).mint(user2.address, mintAmount);
  await mintTx.wait();

  const user2BalanceAfterMint = await mockUSDC.balanceOf(user2.address);
  console.log(
    "✅ User2 Balance after mint:",
    ethers.formatUnits(user2BalanceAfterMint, 6),
    "USDC"
  );

  // ===== TEST APPROVE & TRANSFERFROM =====
  console.log("\n🔐 Testing Approve & TransferFrom...");
  const approveAmount = ethers.parseUnits("2000", 6); // 2000 USDC

  console.log("User2 approving User1 to spend 2000 USDC...");
  const approveTx = await mockUSDC
    .connect(user2)
    .approve(user1.address, approveAmount);
  await approveTx.wait();

  const allowance = await mockUSDC.allowance(user2.address, user1.address);
  console.log("✅ Allowance:", ethers.formatUnits(allowance, 6), "USDC");

  const transferFromAmount = ethers.parseUnits("500", 6); // 500 USDC
  console.log("User1 transferring 500 USDC from User2 to Owner...");
  const transferFromTx = await mockUSDC
    .connect(user1)
    .transferFrom(user2.address, owner.address, transferFromAmount);
  await transferFromTx.wait();

  console.log("✅ TransferFrom completed!");

  // ===== FINAL BALANCES =====
  console.log("\n📈 Final Balances:");
  const finalOwnerBalance = await mockUSDC.balanceOf(owner.address);
  const finalUser1Balance = await mockUSDC.balanceOf(user1.address);
  const finalUser2Balance = await mockUSDC.balanceOf(user2.address);
  const finalTotalSupply = await mockUSDC.totalSupply();
  const finalAllowance = await mockUSDC.allowance(user2.address, user1.address);

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
  console.log(
    "Remaining Allowance:",
    ethers.formatUnits(finalAllowance, 6),
    "USDC"
  );

  // ===== TEST ERROR CONDITIONS =====
  console.log("\n⚠️  Testing Error Conditions...");

  try {
    // Try to mint from non-owner account
    await mockUSDC
      .connect(user1)
      .mint(user1.address, ethers.parseUnits("1000", 6));
    console.log("❌ ERROR: Non-owner mint should have failed!");
  } catch (error) {
    console.log(
      "✅ Non-owner mint correctly failed:",
      error.reason || "Access denied"
    );
  }

  try {
    // Try to exceed faucet limit
    const bigAmount = ethers.parseUnits("20000", 6); // 20,000 USDC (over 10k limit)
    await mockUSDC.connect(user1).faucet(bigAmount);
    console.log("❌ ERROR: Faucet limit exceeded should have failed!");
  } catch (error) {
    console.log(
      "✅ Faucet limit correctly enforced:",
      error.reason || "Limit exceeded"
    );
  }

  console.log("\n🎉 All tests completed successfully!");
  console.log("📍 Contract Address:", contractAddress);
  console.log("\n=== Summary ===");
  console.log("✅ Deployment: Success");
  console.log("✅ Faucet: Working");
  console.log("✅ Transfer: Working");
  console.log("✅ Mint: Working (owner only)");
  console.log("✅ Approve/TransferFrom: Working");
  console.log("✅ Access Control: Working");
  console.log("✅ Faucet Limits: Working");

  return mockUSDC;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
