import { run } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * Batch verification script for existing deployments
 * Reads deployment addresses from JSON files and verifies all contracts
 */

interface BatchVerificationConfig {
  deploymentFile: string;
  network: string;
  delayBetweenVerifications: number; // milliseconds
  retryAttempts: number;
  skipAlreadyVerified: boolean;
}

interface DeploymentData {
  network: string;
  timestamp: string;
  deployer: string;
  addresses: {
    mockUSDC: string;
    vaultRouter: string;
    orderBookFactory: string;
    tradingRouter: string;
    upgradeManager: string;
    orderBooks: { [symbol: string]: string };
  };
  config?: any;
}

class BatchVerifier {
  private config: BatchVerificationConfig;
  private deploymentData: DeploymentData;
  private verificationResults: { [address: string]: { success: boolean; error?: string } } = {};

  constructor(config: BatchVerificationConfig) {
    this.config = config;
    this.loadDeploymentData();
  }

  /**
   * Load deployment data from file
   */
  private loadDeploymentData(): void {
    try {
      const filePath = path.resolve(this.config.deploymentFile);
      const fileContent = fs.readFileSync(filePath, 'utf8');
      this.deploymentData = JSON.parse(fileContent);
      
      console.log("📂 Loaded deployment data:");
      console.log(`   Network: ${this.deploymentData.network}`);
      console.log(`   Deployer: ${this.deploymentData.deployer}`);
      console.log(`   Timestamp: ${this.deploymentData.timestamp}`);
    } catch (error) {
      console.error("❌ Failed to load deployment file:", error);
      throw new Error(`Cannot load deployment file: ${this.config.deploymentFile}`);
    }
  }

  /**
   * Verify all contracts from deployment
   */
  async verifyAllFromDeployment(): Promise<void> {
    console.log("🚀 Starting batch verification...");
    console.log(`   Network: ${this.config.network}`);
    console.log(`   Delay between verifications: ${this.config.delayBetweenVerifications}ms`);
    console.log(`   Retry attempts: ${this.config.retryAttempts}`);

    const contracts = [
      {
        name: "MockUSDC",
        address: this.deploymentData.addresses.mockUSDC,
        contract: "contracts/MockUSDC.sol:MockUSDC",
        args: [this.deploymentData.deployer]
      },
      {
        name: "VaultRouter",
        address: this.deploymentData.addresses.vaultRouter,
        contract: "contracts/VaultRouter.sol:VaultRouter",
        args: [this.deploymentData.addresses.mockUSDC, this.deploymentData.deployer]
      },
      {
        name: "OrderBookFactory",
        address: this.deploymentData.addresses.orderBookFactory,
        contract: "contracts/OrderBookFactory.sol:OrderBookFactory",
        args: [this.deploymentData.addresses.vaultRouter, this.deploymentData.deployer]
      },
      {
        name: "TradingRouter",
        address: this.deploymentData.addresses.tradingRouter,
        contract: "contracts/TradingRouter.sol:TradingRouter",
        args: [
          this.deploymentData.addresses.vaultRouter,
          this.deploymentData.addresses.orderBookFactory,
          this.deploymentData.deployer
        ]
      },
      {
        name: "UpgradeManager",
        address: this.deploymentData.addresses.upgradeManager,
        contract: "contracts/UpgradeManager.sol:UpgradeManager",
        args: [this.deploymentData.deployer]
      }
    ];

    // Add OrderBook contracts
    for (const [symbol, address] of Object.entries(this.deploymentData.addresses.orderBooks)) {
      const { ethers } = require("hardhat");
      const marketId = ethers.id(`${symbol}_MARKET`);
      
      contracts.push({
        name: `OrderBook_${symbol.replace('/', '_')}`,
        address: address,
        contract: "contracts/OrderBook.sol:OrderBook",
        args: [
          marketId,
          symbol,
          "", // metricId
          false, // isCustomMetric
          this.deploymentData.addresses.vaultRouter,
          this.deploymentData.deployer
        ]
      });
    }

    console.log(`\n📋 Found ${contracts.length} contracts to verify:`);
    contracts.forEach((contract, index) => {
      console.log(`   ${index + 1}. ${contract.name} - ${contract.address}`);
    });

    // Verify each contract
    for (let i = 0; i < contracts.length; i++) {
      const contract = contracts[i];
      
      console.log(`\n📝 Verifying ${contract.name} (${i + 1}/${contracts.length})`);
      console.log(`   Contract: ${contract.contract}`);
      console.log(`   Address: ${contract.address}`);
      
      if (this.config.skipAlreadyVerified && await this.isAlreadyVerified(contract.address)) {
        console.log("   ✅ Already verified, skipping");
        this.verificationResults[contract.address] = { success: true };
        continue;
      }

      const success = await this.verifyContractWithRetry(
        contract.address,
        contract.contract,
        contract.args
      );

      if (success) {
        console.log("   ✅ Verification successful");
        this.verificationResults[contract.address] = { success: true };
      } else {
        console.log("   ❌ Verification failed after all retries");
      }

      // Wait between verifications to avoid rate limiting
      if (i < contracts.length - 1) {
        console.log(`   ⏳ Waiting ${this.config.delayBetweenVerifications}ms...`);
        await this.sleep(this.config.delayBetweenVerifications);
      }
    }

    // Generate verification report
    await this.generateBatchReport();
  }

  /**
   * Verify a single contract with retry logic
   */
  private async verifyContractWithRetry(
    address: string,
    contractPath: string,
    args: any[]
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        console.log(`     Attempt ${attempt}/${this.config.retryAttempts}`);
        
        await run("verify:verify", {
          address: address,
          contract: contractPath,
          constructorArguments: args
        });
        
        return true;
      } catch (error: any) {
        const errorMessage = error.message || error.toString();
        
        // Check if it's already verified
        if (errorMessage.includes("Already Verified") || 
            errorMessage.includes("already verified")) {
          console.log("     ✅ Contract already verified");
          return true;
        }
        
        // Check if it's a rate limit error
        if (errorMessage.includes("rate limit") || 
            errorMessage.includes("too many requests")) {
          console.log("     ⏳ Rate limited, waiting longer...");
          await this.sleep(this.config.delayBetweenVerifications * 2);
        }
        
        console.log(`     ❌ Attempt ${attempt} failed:`, errorMessage);
        this.verificationResults[address] = { 
          success: false, 
          error: errorMessage 
        };
        
        if (attempt < this.config.retryAttempts) {
          await this.sleep(1000 * attempt); // Exponential backoff
        }
      }
    }
    
    return false;
  }

  /**
   * Check if contract is already verified (simplified)
   */
  private async isAlreadyVerified(address: string): Promise<boolean> {
    try {
      // This would need to call the explorer API in a real implementation
      // For now, we'll just return false to attempt verification
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate batch verification report
   */
  private async generateBatchReport(): Promise<void> {
    console.log("\n📊 Generating batch verification report...");
    
    const successCount = Object.values(this.verificationResults).filter(r => r.success).length;
    const totalCount = Object.keys(this.verificationResults).length;
    
    const report = {
      batchVerification: true,
      network: this.config.network,
      deploymentFile: this.config.deploymentFile,
      timestamp: new Date().toISOString(),
      summary: {
        total: totalCount,
        successful: successCount,
        failed: totalCount - successCount,
        successRate: totalCount > 0 ? (successCount / totalCount * 100).toFixed(2) + '%' : '0%'
      },
      results: this.verificationResults,
      originalDeployment: this.deploymentData
    };

    // Save report
    const reportPath = `batch-verification-report-${this.config.network}-${Date.now()}.json`;
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`📄 Batch verification report saved to: ${reportPath}`);
    
    // Print summary
    this.printBatchSummary(report);
  }

  /**
   * Print batch verification summary
   */
  private printBatchSummary(report: any): void {
    console.log("\n📋 BATCH VERIFICATION SUMMARY");
    console.log("=" .repeat(50));
    console.log(`Network: ${report.network}`);
    console.log(`Total Contracts: ${report.summary.total}`);
    console.log(`Successful: ${report.summary.successful}`);
    console.log(`Failed: ${report.summary.failed}`);
    console.log(`Success Rate: ${report.summary.successRate}`);
    console.log(`Timestamp: ${report.timestamp}`);
    console.log("");

    if (report.summary.failed > 0) {
      console.log("Failed Verifications:");
      for (const [address, result] of Object.entries(report.results as any)) {
        if (!result.success) {
          console.log(`  ${address}: ${result.error || 'Unknown error'}`);
        }
      }
    }
    console.log("=" .repeat(50));
  }

  /**
   * Utility function to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Find latest deployment file
 */
function findLatestDeploymentFile(network: string): string {
  const files = fs.readdirSync('.')
    .filter(file => file.startsWith(`deployments-${network}-`) && file.endsWith('.json'))
    .sort()
    .reverse();
  
  if (files.length === 0) {
    throw new Error(`No deployment files found for network: ${network}`);
  }
  
  return files[0];
}

/**
 * Main batch verification function
 */
async function main() {
  const network = process.env.HARDHAT_NETWORK || "polygon";
  const deploymentFile = process.env.DEPLOYMENT_FILE || findLatestDeploymentFile(network);
  
  const config: BatchVerificationConfig = {
    deploymentFile: deploymentFile,
    network: network,
    delayBetweenVerifications: parseInt(process.env.VERIFICATION_DELAY || "5000"),
    retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || "3"),
    skipAlreadyVerified: process.env.SKIP_VERIFIED === "true"
  };

  console.log("🌟 Batch Verification Configuration:");
  console.log(`   Network: ${config.network}`);
  console.log(`   Deployment File: ${config.deploymentFile}`);
  console.log(`   Delay: ${config.delayBetweenVerifications}ms`);
  console.log(`   Retry Attempts: ${config.retryAttempts}`);
  console.log(`   Skip Already Verified: ${config.skipAlreadyVerified}`);

  const verifier = new BatchVerifier(config);
  
  try {
    await verifier.verifyAllFromDeployment();
    console.log("\n🎉 Batch verification completed!");
  } catch (error) {
    console.error("❌ Batch verification failed:", error);
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

export { BatchVerifier, BatchVerificationConfig };
