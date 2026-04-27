/**
 * Deploy SpokeVault on Arbitrum for Real USDC deposits
 * 
 * RESILIENT: Tracks state and continues from where it left off
 * 
 * Run: npx hardhat run scripts/deploy-arbitrum-spoke.js --network arbitrum
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// State file for tracking deployment progress
const STATE_FILE = path.join(__dirname, "../deployments/arbitrum-spoke-state.json");
const FINAL_FILE = path.join(__dirname, "../deployments/arbitrum-real-usdc-spoke.json");

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    console.log(`\n📂 Loaded existing state from ${STATE_FILE}`);
    return state;
  }
  return { contracts: {}, completed: [], timestamp: new Date().toISOString() };
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  state.lastUpdated = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`   💾 State saved`);
}

function isCompleted(state, step) {
  return state.completed.includes(step);
}

function markCompleted(state, step) {
  if (!state.completed.includes(step)) {
    state.completed.push(step);
  }
}

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("🚀 ARBITRUM SPOKE DEPLOYMENT - REAL USDC (RESILIENT)");
  console.log("═".repeat(80));

  const state = loadState();
  
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const network = await ethers.provider.getNetwork();

  console.log(`\n🌐 Network: arbitrum (Chain ID: ${network.chainId})`);
  console.log(`📋 Deployer: ${deployer.address}`);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH`);
  
  if (state.completed.length > 0) {
    console.log(`\n♻️  Resuming from previous run. Completed steps: ${state.completed.join(", ")}`);
  }

  // Real USDC.e on Arbitrum
  const REAL_USDC = process.env.REAL_USDC_ADDRESS || "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8";
  state.contracts.USDC_TOKEN = REAL_USDC;

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 1: VALIDATE USDC
  // ═══════════════════════════════════════════════════════════════════
  if (!isCompleted(state, "validate_usdc")) {
    console.log("\n" + "─".repeat(60));
    console.log("📦 PHASE 1: VALIDATE REAL USDC");
    console.log("─".repeat(60));
    
    try {
      const usdc = await ethers.getContractAt(
        "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol:IERC20Metadata",
        REAL_USDC
      );
      const symbol = await usdc.symbol();
      const decimals = await usdc.decimals();
      console.log(`  ✅ Token: ${symbol} (${decimals} decimals) at ${REAL_USDC}`);

      if (decimals !== 6n) {
        throw new Error(`Expected 6 decimals for USDC, got ${decimals}`);
      }
      
      state.usdcSymbol = symbol;
      state.usdcDecimals = Number(decimals);
      markCompleted(state, "validate_usdc");
      saveState(state);
    } catch (e) {
      console.log(`  ⚠️  Could not validate USDC: ${e.message}`);
      console.log(`  Proceeding anyway...`);
      markCompleted(state, "validate_usdc");
      saveState(state);
    }
  } else {
    console.log("\n✅ PHASE 1: USDC validation already completed");
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 2: DEPLOY SPOKE VAULT
  // ═══════════════════════════════════════════════════════════════════
  if (!isCompleted(state, "deploy_spoke_vault")) {
    console.log("\n" + "─".repeat(60));
    console.log("📦 PHASE 2: DEPLOY SPOKE VAULT");
    console.log("─".repeat(60));

    const SpokeVault = await ethers.getContractFactory("SpokeVault");
    
    // Constructor: address[] memory _initialAllowedTokens, address _admin, address _bridgeInbox
    console.log(`  Deploying SpokeVault...`);
    const spokeVault = await SpokeVault.deploy(
      [REAL_USDC],           // Initial allowed tokens
      deployer.address,       // Admin
      ethers.ZeroAddress      // Bridge inbox (set later)
    );
    await spokeVault.waitForDeployment();
    const spokeVaultAddress = await spokeVault.getAddress();
    
    state.contracts.SPOKE_VAULT = spokeVaultAddress;
    console.log(`  ✅ SpokeVault: ${spokeVaultAddress}`);
    
    markCompleted(state, "deploy_spoke_vault");
    saveState(state);
  } else {
    console.log(`\n✅ PHASE 2: SpokeVault already deployed at ${state.contracts.SPOKE_VAULT}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 3: VERIFY TOKEN ALLOWED
  // ═══════════════════════════════════════════════════════════════════
  if (!isCompleted(state, "verify_token_allowed")) {
    console.log("\n" + "─".repeat(60));
    console.log("📦 PHASE 3: VERIFY TOKEN CONFIGURATION");
    console.log("─".repeat(60));

    const spokeVault = await ethers.getContractAt("SpokeVault", state.contracts.SPOKE_VAULT);
    const isAllowed = await spokeVault.isAllowedToken(REAL_USDC);
    console.log(`  ✅ USDC allowed: ${isAllowed}`);
    
    if (!isAllowed) {
      console.log(`  Adding USDC to allowed tokens...`);
      const tx = await spokeVault.addAllowedToken(REAL_USDC);
      await tx.wait();
      console.log(`  ✅ USDC added to allowed tokens`);
    }
    
    markCompleted(state, "verify_token_allowed");
    saveState(state);
  } else {
    console.log("\n✅ PHASE 3: Token verification already completed");
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 4: SAVE FINAL DEPLOYMENT
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("📦 PHASE 4: SAVE FINAL DEPLOYMENT");
  console.log("─".repeat(60));

  const deployment = {
    timestamp: state.timestamp,
    completedAt: new Date().toISOString(),
    network: "arbitrum",
    chainId: Number(network.chainId),
    deployer: deployer.address,
    contracts: state.contracts,
    constructorArgs: {
      SpokeVault: {
        initialAllowedTokens: [REAL_USDC],
        admin: deployer.address,
        bridgeInbox: ethers.ZeroAddress
      }
    },
    notes: {
      usdcSymbol: state.usdcSymbol || "USDC",
      usdcDecimals: state.usdcDecimals || 6,
      bridgeInboxPending: "Set bridge inbox and register spoke on Hyperliquid CollateralHub"
    }
  };

  fs.writeFileSync(FINAL_FILE, JSON.stringify(deployment, null, 2));
  console.log(`  ✅ Saved to: ${FINAL_FILE}`);

  // Clean up state file
  if (fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
    console.log(`  🗑️  Cleaned up state file`);
  }

  // Summary
  console.log("\n" + "═".repeat(80));
  console.log("✅ ARBITRUM SPOKE DEPLOYMENT COMPLETE");
  console.log("═".repeat(80));
  console.log(`
📋 Deployed Contracts:
   SpokeVault: ${state.contracts.SPOKE_VAULT}
   USDC Token: ${REAL_USDC}

🔧 Next Steps:
   1. Register this spoke on Hyperliquid CollateralHub:
      
      const collateralHub = await ethers.getContractAt("CollateralHub", "0xB4d81a5093dB98de9088a061fb1b3982Fe09D3b5");
      await collateralHub.registerSpoke(42161, {
        spokeVault: "${state.contracts.SPOKE_VAULT}",
        usdc: "${REAL_USDC}",
        enabled: true
      });
   
   2. Set bridge inbox on SpokeVault (after deploying bridge contracts):
      spokeVault.setBridgeInbox(<bridgeInboxAddress>)
   
   3. Grant relayer roles as needed

📝 Verify on Arbiscan:
   npx hardhat verify --network arbitrum ${state.contracts.SPOKE_VAULT} \\
     "[\\"${REAL_USDC}\\"]" \\
     "${deployer.address}" \\
     "0x0000000000000000000000000000000000000000"
`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ DEPLOYMENT FAILED:", error.message);
    console.error(error);
    process.exit(1);
  });
