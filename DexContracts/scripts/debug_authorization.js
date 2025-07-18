const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🔐 Authorization Debug");

  try {
    // Quick setup
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy(1000000);
    await mockUSDC.waitForDeployment();

    const MockPriceOracle = await hre.ethers.getContractFactory(
      "MockPriceOracle"
    );
    const mockPriceOracle = await MockPriceOracle.deploy(
      hre.ethers.parseEther("2000")
    );
    await mockPriceOracle.waitForDeployment();

    const Vault = await hre.ethers.getContractFactory("Vault");
    const vault = await Vault.deploy(await mockUSDC.getAddress());
    await vault.waitForDeployment();

    const VAMM = await hre.ethers.getContractFactory("vAMM");
    const vamm = await VAMM.deploy(
      await vault.getAddress(),
      await mockPriceOracle.getAddress(),
      hre.ethers.parseEther("1")
    );
    await vamm.waitForDeployment();

    console.log("Contracts deployed");
    console.log("Vault:", await vault.getAddress());
    console.log("vAMM:", await vamm.getAddress());

    // Check authorization status BEFORE setVamm
    console.log("\n🔍 Authorization status BEFORE setVamm:");
    const vammAddress = await vamm.getAddress();
    const isAuthorizedBefore = await vault.authorized(vammAddress);
    console.log("vAMM authorized in vault:", isAuthorizedBefore);

    // Check vault's vamm setting
    const currentVamm = await vault.vamm();
    console.log("Vault's vamm setting:", currentVamm);
    console.log(
      "Is vamm address zero:",
      currentVamm === "0x0000000000000000000000000000000000000000"
    );

    // Call setVamm and check again
    console.log("\n🔧 Calling vault.setVamm()...");
    const setVammTx = await vault.setVamm(vammAddress);
    await setVammTx.wait();
    console.log("setVamm transaction completed");

    // Check authorization status AFTER setVamm
    console.log("\n🔍 Authorization status AFTER setVamm:");
    const isAuthorizedAfter = await vault.authorized(vammAddress);
    console.log("vAMM authorized in vault:", isAuthorizedAfter);

    const newCurrentVamm = await vault.vamm();
    console.log("Vault's vamm setting:", newCurrentVamm);
    console.log(
      "Matches vAMM address:",
      newCurrentVamm.toLowerCase() === vammAddress.toLowerCase()
    );

    // Test vault functions that require authorization
    const mintTx = await mockUSDC.mint(
      deployer.address,
      hre.ethers.parseUnits("1000", 6)
    );
    await mintTx.wait();
    const approveTx = await mockUSDC.approve(
      await vault.getAddress(),
      hre.ethers.parseUnits("1000", 6)
    );
    await approveTx.wait();
    const depositTx = await vault.depositCollateral(
      deployer.address,
      hre.ethers.parseUnits("100", 6)
    );
    await depositTx.wait();

    console.log("\n🧪 Testing vault authorization calls:");

    // Test 1: reserveMargin from vAMM
    console.log("\n📋 Test 1: reserveMargin from vAMM");
    try {
      // This should work if vAMM is properly authorized
      const testAmount = hre.ethers.parseUnits("1", 6); // $1 USDC
      await vault
        .connect(deployer)
        .reserveMargin.staticCall(deployer.address, testAmount);
      console.log(
        "❌ reserveMargin call succeeded from deployer (shouldn't work - only authorized should call this)"
      );
    } catch (e) {
      console.log(
        "✅ reserveMargin properly rejected call from deployer:",
        e.message
      );
    }

    // Test 2: Check if vAMM can call vault functions
    console.log("\n📋 Test 2: Vault modifier checks");

    // Since we can't easily impersonate the vAMM contract, let's check the vault's logic
    const owner = await vault.owner();
    console.log("Vault owner:", owner);
    console.log(
      "Deployer is owner:",
      owner.toLowerCase() === deployer.address.toLowerCase()
    );

    // Test 3: Check if the issue is in the modifier logic
    console.log("\n📋 Test 3: Manual authorization check");

    // Let's read the vault contract's authorization logic
    console.log("Testing vault.authorized() mapping directly:");
    console.log(
      "- deployer authorized:",
      await vault.authorized(deployer.address)
    );
    console.log("- vAMM authorized:", await vault.authorized(vammAddress));
    console.log(
      "- zero address authorized:",
      await vault.authorized("0x0000000000000000000000000000000000000000")
    );

    // Test 4: Try to manually authorize the vAMM
    console.log("\n📋 Test 4: Manual authorization");
    try {
      const authTx = await vault.addAuthorized(vammAddress);
      await authTx.wait();
      console.log("✅ Manually authorized vAMM");

      const isAuthorizedManual = await vault.authorized(vammAddress);
      console.log(
        "vAMM authorized after manual authorization:",
        isAuthorizedManual
      );
    } catch (e) {
      console.log("❌ Failed to manually authorize vAMM:", e.message);
    }

    // Test 5: Try the position opening again
    console.log("\n📋 Test 5: Try position opening after manual authorization");
    try {
      const collateralAmount = hre.ethers.parseEther("1");
      const tx = await vamm.openPosition(
        collateralAmount,
        true,
        2,
        0,
        hre.ethers.MaxUint256
      );
      await tx.wait();
      console.log("🎉 SUCCESS! Position opened after manual authorization");
    } catch (e) {
      console.log("❌ Position opening still fails:", e.message);
      console.log("Error data:", e.data);
    }
  } catch (error) {
    console.error("💥 Script failed:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
