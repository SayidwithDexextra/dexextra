import { ethers, run } from "hardhat";

/**
 * Deploy only OrderRouter (no other contracts).
 * Reads existing addresses from env to avoid redeploying CentralVault/UMA/Mock tokens.
 *
 * Required env:
 * - CENTRAL_VAULT_ADDRESS
 * - UMA_ORACLE_MANAGER_ADDRESS
 * - ROUTER_ADMIN_ADDRESS (defaults to deployer)
 * - TRADING_FEE_BPS (defaults 20)
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("🚀 Deploying OrderRouter only with deployer:", deployer.address);

  const centralVault = process.env.CENTRAL_VAULT_ADDRESS;
  const umaOracleManager = process.env.UMA_ORACLE_MANAGER_ADDRESS;
  const admin = process.env.ROUTER_ADMIN_ADDRESS || deployer.address;
  const tradingFeeBps = Number(process.env.TRADING_FEE_BPS || 20);

  if (!centralVault || !umaOracleManager) {
    throw new Error("CENTRAL_VAULT_ADDRESS and UMA_ORACLE_MANAGER_ADDRESS are required");
  }

  console.log("\nInputs:", { centralVault, umaOracleManager, admin, tradingFeeBps });

  const OrderRouter = await ethers.getContractFactory("OrderRouter");
  const orderRouter = await OrderRouter.deploy(
    centralVault,
    umaOracleManager,
    admin,
    tradingFeeBps
  );
  await orderRouter.waitForDeployment();
  const routerAddress = await orderRouter.getAddress();
  console.log("\n✅ OrderRouter deployed:", routerAddress);

  // Verify (best-effort)
  try {
    console.log("\n🔎 Verifying on explorer...");
    await run("verify:verify", {
      address: routerAddress,
      constructorArguments: [centralVault, umaOracleManager, admin, tradingFeeBps],
    });
    console.log("✅ Verification submitted");
  } catch (err: any) {
    console.warn("⚠️ Verification skipped/failed:", err?.message || err);
  }

  console.log("\n➡️ Update your frontend config and DB with the new OrderRouter address.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});







