const { ethers } = require("hardhat");

async function main() {
  const COLLATERAL_HUB = "0xB4d81a5093dB98de9088a061fb1b3982Fe09D3b5";
  const CORE_VAULT = "0x13C0EE284eF74E10A6442077718D57e2C50Ee88F";
  const ARBITRUM_CHAIN_ID = 42161;

  console.log("=== CollateralHub Configuration (Hyperliquid) ===");
  console.log("CollateralHub address:", COLLATERAL_HUB);
  console.log("CoreVault address:", CORE_VAULT);
  console.log("");

  const hub = await ethers.getContractAt("CollateralHub", COLLATERAL_HUB);
  const vault = await ethers.getContractAt("CoreVault", CORE_VAULT);

  // Check if Arbitrum spoke is registered
  console.log("=== Arbitrum Spoke Registration ===");
  try {
    const spokeInfo = await hub.spokesByChainId(ARBITRUM_CHAIN_ID);
    console.log("Arbitrum (42161) spoke info:");
    console.log("  - spokeVault:", spokeInfo.spokeVault);
    console.log("  - usdc:", spokeInfo.usdc);
    console.log("  - enabled:", spokeInfo.enabled);
  } catch (e) {
    console.log("Error reading spoke info:", e.message);
  }
  console.log("");

  // Check CoreVault operator
  console.log("=== CoreVault Configuration ===");
  try {
    const operator = await vault.operator();
    console.log("CoreVault operator:", operator);
    console.log("CollateralHub should be operator:", COLLATERAL_HUB);
    console.log("Operator matches Hub:", operator.toLowerCase() === COLLATERAL_HUB.toLowerCase());
  } catch (e) {
    console.log("Error reading operator:", e.message);
  }

  // Check CollateralHub's vault reference
  console.log("");
  console.log("=== CollateralHub Vault Reference ===");
  try {
    const hubVault = await hub.coreVault();
    console.log("Hub's coreVault:", hubVault);
    console.log("Expected CoreVault:", CORE_VAULT);
    console.log("Match:", hubVault.toLowerCase() === CORE_VAULT.toLowerCase());
  } catch (e) {
    console.log("Error reading hub vault:", e.message);
  }

  // Check roles on CollateralHub
  console.log("");
  console.log("=== CollateralHub Roles ===");
  try {
    const HUB_ADMIN_ROLE = await hub.HUB_ADMIN_ROLE();
    const RELAYER_ROLE = await hub.RELAYER_ROLE();
    console.log("HUB_ADMIN_ROLE:", HUB_ADMIN_ROLE);
    console.log("RELAYER_ROLE:", RELAYER_ROLE);
    
    // Check if any known addresses have the relayer role
    const RELAYER_ADDRESS = process.env.RELAYER_ADDRESS || "0x428d7cBd7feccf01a80dACE3d70b8eCf06451500";
    const hasRelayerRole = await hub.hasRole(RELAYER_ROLE, RELAYER_ADDRESS);
    console.log("Relayer has role:", hasRelayerRole, "(", RELAYER_ADDRESS, ")");
  } catch (e) {
    console.log("Error reading roles:", e.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
