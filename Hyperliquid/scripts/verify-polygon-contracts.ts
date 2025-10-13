import { run } from "hardhat";
import { createClient } from '@supabase/supabase-js';

/**
 * Comprehensive contract verification script for Polygon deployment
 * Verifies all deployed contracts on Polygonscan automatically
 */

interface VerificationConfig {
  network: string;
  deploymentFile?: string;
  retryAttempts: number;
  delayBetweenRetries: number;
  skipAlreadyVerified: boolean;
}

interface ContractToVerify {
  name: string;
  address: string;
  constructorArguments: any[];
  skipVerification?: boolean;
  reason?: string;
}

class PolygonContractVerifier {
  private config: VerificationConfig;
  private deploymentData: any;
  private contractsToVerify: ContractToVerify[] = [];

  constructor(config: VerificationConfig) {
    this.config = config;
  }

  /**
   * Load deployment data and prepare verification list
   */
  async loadDeploymentData(): Promise<void> {
    console.log("📂 Loading deployment data...");
    
    if (this.config.deploymentFile) {
      const fs = require('fs');
      if (fs.existsSync(this.config.deploymentFile)) {
        this.deploymentData = JSON.parse(fs.readFileSync(this.config.deploymentFile, 'utf8'));
        console.log("   ✅ Loaded deployment data from:", this.config.deploymentFile);
      } else {
        throw new Error(`Deployment file not found: ${this.config.deploymentFile}`);
      }
    } else {
      // Find latest deployment file
      const fs = require('fs');
      const files = fs.readdirSync('.')
        .filter((file: string) => file.startsWith('deployments-polygon-updated-'))
        .sort()
        .reverse();
      
      if (files.length === 0) {
        throw new Error("No deployment files found. Please run deployment first.");
      }
      
      this.config.deploymentFile = files[0];
      this.deploymentData = JSON.parse(fs.readFileSync(this.config.deploymentFile, 'utf8'));
      console.log("   ✅ Auto-loaded latest deployment file:", this.config.deploymentFile);
    }

    console.log("   📋 Deployment summary:");
    console.log("     Network:", this.deploymentData.network);
    console.log("     Timestamp:", this.deploymentData.timestamp);
    console.log("     Deployer:", this.deploymentData.deployer);
  }

  /**
   * Prepare list of contracts to verify
   */
  prepareVerificationList(): void {
    console.log("\n📝 Preparing contract verification list...");
    
    const addresses = this.deploymentData.addresses;
    const deployer = this.deploymentData.deployer;

    // MockUSDC - Skip verification (existing contract)
    this.contractsToVerify.push({
      name: "MockUSDC",
      address: addresses.mockUSDC,
      constructorArguments: [],
      skipVerification: true,
      reason: "Existing deployment, not redeployed"
    });

    // VaultRouter
    this.contractsToVerify.push({
      name: "VaultRouter",
      address: addresses.vaultRouter,
      constructorArguments: [
        addresses.mockUSDC,  // collateralToken
        deployer             // admin
      ]
    });

    // OrderBookFactoryMinimal
    this.contractsToVerify.push({
      name: "OrderBookFactoryMinimal",
      address: addresses.orderBookFactory,
      constructorArguments: [
        addresses.vaultRouter, // vaultRouter
        deployer               // owner
      ]
    });

    // TradingRouter
    this.contractsToVerify.push({
      name: "TradingRouter",
      address: addresses.tradingRouter,
      constructorArguments: [
        addresses.vaultRouter,      // vaultRouter
        addresses.orderBookFactory, // factory
        deployer                    // admin
      ]
    });

    // UpgradeManager
    this.contractsToVerify.push({
      name: "UpgradeManager",
      address: addresses.upgradeManager,
      constructorArguments: [
        addresses.vaultRouter,      // vaultRouter
        addresses.orderBookFactory, // factory
        addresses.tradingRouter,    // tradingRouter
        addresses.mockUSDC,         // collateralToken
        deployer                    // admin
      ]
    });

    // OrderBook contracts
    Object.entries(addresses.orderBooks).forEach(([marketName, orderBookAddress]) => {
      this.contractsToVerify.push({
        name: "OrderBook",
        address: orderBookAddress as string,
        constructorArguments: [
          addresses.vaultRouter,                    // vaultRouter
          `${marketName}_MARKET`,                   // marketId (simplified)
          marketName,                               // symbol
          "",                                       // metricId (empty for traditional markets)
          deployer                                  // admin
        ]
      });
    });

    console.log(`   📊 Found ${this.contractsToVerify.length} contracts to process`);
    console.log(`   ✅ Will verify ${this.contractsToVerify.filter(c => !c.skipVerification).length} contracts`);
    console.log(`   ⏭️  Will skip ${this.contractsToVerify.filter(c => c.skipVerification).length} contracts`);
  }

  /**
   * Verify all contracts on Polygonscan
   */
  async verifyAllContracts(): Promise<void> {
    console.log("\n🔍 Starting contract verification...");
    
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    for (const contract of this.contractsToVerify) {
      console.log(`\n📄 Processing ${contract.name} at ${contract.address}...`);
      
      if (contract.skipVerification) {
        console.log(`   ⏭️  Skipped: ${contract.reason}`);
        skipCount++;
        continue;
      }

      const success = await this.verifyContract(contract);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
    }

    console.log("\n📊 Verification Summary:");
    console.log("=" .repeat(50));
    console.log(`✅ Successfully verified: ${successCount} contracts`);
    console.log(`⏭️  Skipped: ${skipCount} contracts`);
    console.log(`❌ Failed: ${failCount} contracts`);
    console.log("=" .repeat(50));

    if (failCount > 0) {
      console.log("\n⚠️  Some contracts failed verification. Check the logs above for details.");
      console.log("   You can retry verification later using the verify-contracts script.");
    }
  }

  /**
   * Verify a single contract
   */
  private async verifyContract(contract: ContractToVerify): Promise<boolean> {
    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        console.log(`   🔄 Verification attempt ${attempt}/${this.config.retryAttempts}...`);
        
        await run("verify:verify", {
          address: contract.address,
          constructorArguments: contract.constructorArguments,
          contract: contract.name === "OrderBook" ? "contracts/OrderBook.sol:OrderBook" : undefined
        });
        
        console.log(`   ✅ ${contract.name} verified successfully!`);
        console.log(`   🔗 View on Polygonscan: https://polygonscan.com/address/${contract.address}#code`);
        return true;
        
      } catch (error: any) {
        if (error.message.includes("Already Verified")) {
          console.log(`   ✅ ${contract.name} already verified!`);
          console.log(`   🔗 View on Polygonscan: https://polygonscan.com/address/${contract.address}#code`);
          return true;
        }
        
        if (attempt === this.config.retryAttempts) {
          console.log(`   ❌ ${contract.name} verification failed after ${this.config.retryAttempts} attempts:`);
          console.log(`      Error: ${error.message}`);
          console.log(`   🔗 Contract address: https://polygonscan.com/address/${contract.address}`);
          return false;
        }
        
        console.log(`   ⚠️  Attempt ${attempt} failed: ${error.message}`);
        console.log(`   ⏰ Waiting ${this.config.delayBetweenRetries}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, this.config.delayBetweenRetries));
      }
    }
    
    return false;
  }

  /**
   * Save verification results
   */
  async saveVerificationResults(): Promise<void> {
    console.log("\n💾 Saving verification results...");
    
    const fs = require('fs');
    const verificationData = {
      network: this.config.network,
      timestamp: new Date().toISOString(),
      deploymentFile: this.config.deploymentFile,
      contracts: this.contractsToVerify.map(contract => ({
        name: contract.name,
        address: contract.address,
        verified: !contract.skipVerification,
        polygonscanUrl: `https://polygonscan.com/address/${contract.address}${contract.skipVerification ? '' : '#code'}`,
        skipReason: contract.reason || null
      }))
    };
    
    const filename = `verification-results-${Date.now()}.json`;
    fs.writeFileSync(filename, JSON.stringify(verificationData, null, 2));
    
    console.log(`   ✅ Verification results saved to: ${filename}`);
    
    // Update deployment file with verification status
    this.deploymentData.verification = verificationData;
    fs.writeFileSync(this.config.deploymentFile!, JSON.stringify(this.deploymentData, null, 2));
    console.log(`   ✅ Updated deployment file with verification status`);
  }

  /**
   * Print verification summary with links
   */
  printVerificationSummary(): void {
    console.log("\n🎉 VERIFICATION COMPLETE");
    console.log("=" .repeat(70));
    console.log(`Network: ${this.config.network} (Polygon)`);
    console.log(`Deployment File: ${this.config.deploymentFile}`);
    console.log("");
    
    console.log("Verified Contracts:");
    this.contractsToVerify.forEach(contract => {
      const status = contract.skipVerification ? "⏭️  SKIPPED" : "✅ VERIFIED";
      const url = `https://polygonscan.com/address/${contract.address}${contract.skipVerification ? '' : '#code'}`;
      console.log(`  ${status} ${contract.name.padEnd(25)} ${url}`);
      if (contract.reason) {
        console.log(`${''.padEnd(28)}(${contract.reason})`);
      }
    });
    
    console.log("");
    console.log("🔗 Polygonscan Links:");
    console.log("  Main Explorer: https://polygonscan.com/");
    console.log("  API Docs: https://docs.polygonscan.com/");
    console.log("=" .repeat(70));
  }
}

/**
 * Main verification function
 */
async function main() {
  const config: VerificationConfig = {
    network: process.env.HARDHAT_NETWORK || "polygon",
    deploymentFile: process.argv[2], // Optional: specify deployment file as argument
    retryAttempts: 3,
    delayBetweenRetries: 5000, // 5 seconds
    skipAlreadyVerified: true
  };

  console.log("🔍 HyperLiquid Contract Verification");
  console.log("===================================");
  console.log(`Network: ${config.network}`);
  console.log(`Retry Attempts: ${config.retryAttempts}`);
  console.log(`Delay Between Retries: ${config.delayBetweenRetries}ms`);

  const verifier = new PolygonContractVerifier(config);
  
  try {
    // Load deployment data
    await verifier.loadDeploymentData();
    
    // Prepare verification list
    verifier.prepareVerificationList();
    
    // Verify all contracts
    await verifier.verifyAllContracts();
    
    // Save results
    await verifier.saveVerificationResults();
    
    // Print summary
    verifier.printVerificationSummary();
    
    console.log("\n🚀 Contract verification process completed!");
    
  } catch (error) {
    console.error("❌ Verification process failed:", error);
    process.exit(1);
  }
}

// Handle script execution
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { PolygonContractVerifier };
