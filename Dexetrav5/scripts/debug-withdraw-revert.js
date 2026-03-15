const { ethers } = require("ethers");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });

const RPC = process.env.HUB_RPC_URL || process.env.RPC_URL || "";
const CORE_VAULT = process.env.CORE_VAULT_ADDRESS;
const COLLATERAL_HUB = process.env.COLLATERAL_HUB_ADDRESS;
const USER = "0xdda468df398ddeecc7d589ef3195c828df4812b4";

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);

  const vault = new ethers.Contract(CORE_VAULT, [
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function userCrossChainCredit(address) view returns (uint256)",
    "function getAvailableCollateral(address) view returns (uint256)",
    "function getWithdrawableCollateral(address) view returns (uint256)",
  ], provider);

  const hub = new ethers.Contract(COLLATERAL_HUB, [
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function coreVault() view returns (address)",
  ], provider);

  const EXTERNAL_CREDITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EXTERNAL_CREDITOR_ROLE"));
  const WITHDRAW_REQUESTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("WITHDRAW_REQUESTER_ROLE"));

  console.log("=== Diagnostics ===\n");
  console.log("CoreVault:", CORE_VAULT);
  console.log("CollateralHub:", COLLATERAL_HUB);
  console.log("User:", USER);

  const hubCoreVault = await hub.coreVault();
  console.log("\nHub's configured coreVault:", hubCoreVault);
  console.log("Matches env CoreVault?", hubCoreVault.toLowerCase() === CORE_VAULT.toLowerCase());

  const hubHasCreditorRole = await vault.hasRole(EXTERNAL_CREDITOR_ROLE, COLLATERAL_HUB);
  console.log("\nCollateralHub has EXTERNAL_CREDITOR_ROLE on CoreVault?", hubHasCreditorRole);

  const crossChainCredit = await vault.userCrossChainCredit(USER);
  console.log("User crossChainCredit:", ethers.formatUnits(crossChainCredit, 6), "USDC");

  const available = await vault.getAvailableCollateral(USER);
  console.log("User availableCollateral:", ethers.formatUnits(available, 6), "USDC");

  const withdrawable = await vault.getWithdrawableCollateral(USER);
  console.log("User withdrawableCollateral:", ethers.formatUnits(withdrawable, 6), "USDC");

  // Check relayer roles
  const relayerKeys = JSON.parse(process.env.RELAYER_PRIVATE_KEYS_JSON);
  const firstRelayer = new ethers.Wallet(relayerKeys[0].trim()).address;
  const relayerHasRole = await hub.hasRole(WITHDRAW_REQUESTER_ROLE, firstRelayer);
  console.log(`\nFirst relayer (${firstRelayer}) has WITHDRAW_REQUESTER_ROLE?`, relayerHasRole);

  if (!hubHasCreditorRole) {
    console.log("\n*** ROOT CAUSE: CollateralHub does NOT have EXTERNAL_CREDITOR_ROLE on CoreVault.");
    console.log("    debitExternal() will revert with AccessControlUnauthorizedAccount.");
    console.log("    Fix: grant EXTERNAL_CREDITOR_ROLE to", COLLATERAL_HUB, "on CoreVault.");
  }

  if (crossChainCredit < 1000000000n) {
    console.log("\n*** User crossChainCredit is less than 1000 USDC (requested amount).");
    console.log("    debitExternal() will revert with InsufficientBalance.");
  }
}

main().catch(console.error);
