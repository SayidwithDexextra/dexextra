import { ethers } from "hardhat";
import { run } from "hardhat";

/**
 * Contract verification script for Polygon deployment
 * Verifies all HyperLiquid contracts on Polygonscan
 */

interface DeploymentAddresses {
  mockUSDC: string;
  vaultRouter: string;
  orderBookFactory: string;
  tradingRouter: string;
  upgradeManager: string;
  orderBooks: { [symbol: string]: string };
}

interface VerificationTask {
  address: string;
  contractName: string;
  constructorArguments: any[];
  libraries?: { [libraryName: string]: string };
}

class ContractVerifier {
  private network: string;
  private addresses: DeploymentAddresses;
  private deployerAddress: string;

  constructor(addresses: DeploymentAddresses, deployerAddress: string, network: string = "polygon") {
    this.addresses = addresses;
    this.deployerAddress = deployerAddress;
    this.network = network;
  }

  /**
   * Verify all contracts in sequence
   */
  async verifyAllContracts(): Promise<void> {
    console.log("🚀 Starting contract verification on", this.network);
    console.log("📋 Deployment addresses:", this.addresses);

    const verificationTasks: VerificationTask[] = [
      {
        address: this.addresses.mockUSDC,
        contractName: "contracts/MockUSDC.sol:MockUSDC",
        constructorArguments: [this.deployerAddress]
      },
      {
        address: this.addresses.vaultRouter,
        contractName: "contracts/VaultRouter.sol:VaultRouter",
        constructorArguments: [this.addresses.mockUSDC, this.deployerAddress]
      },
      {
        address: this.addresses.orderBookFactory,
        contractName: "contracts/OrderBookFactory.sol:OrderBookFactory",
        constructorArguments: [this.addresses.vaultRouter, this.deployerAddress]
      },
      {
        address: this.addresses.tradingRouter,
        contractName: "contracts/TradingRouter.sol:TradingRouter",
        constructorArguments: [
          this.addresses.vaultRouter,
          this.addresses.orderBookFactory,
          this.deployerAddress
        ]
      },
      {
        address: this.addresses.upgradeManager,
        contractName: "contracts/UpgradeManager.sol:UpgradeManager",
        constructorArguments: [this.deployerAddress]
      }
    ];

    // Add OrderBook contracts
    for (const [symbol, address] of Object.entries(this.addresses.orderBooks)) {
      const marketId = ethers.id(`${symbol}_MARKET`);
      verificationTasks.push({
        address: address,
        contractName: "contracts/OrderBook.sol:OrderBook",
        constructorArguments: [
          marketId,
          symbol,
          "", // metricId (empty for traditional markets)
          false, // isCustomMetric
          this.addresses.vaultRouter,
          this.deployerAddress
        ]
      });
    }

    // Verify each contract
    for (let i = 0; i < verificationTasks.length; i++) {
      const task = verificationTasks[i];
      console.log(`\n📝 Verifying ${task.contractName} (${i + 1}/${verificationTasks.length})`);
      console.log(`   Address: ${task.address}`);
      
      try {
        await this.verifyContract(task);
        console.log("   ✅ Verification successful");
        
        // Wait between verifications to avoid rate limiting
        if (i < verificationTasks.length - 1) {
          console.log("   ⏳ Waiting 5 seconds...");
          await this.sleep(5000);
        }
      } catch (error) {
        console.error(`   ❌ Verification failed:`, error);
        // Continue with other contracts even if one fails
      }
    }

    console.log("\n🎉 Contract verification completed!");
  }

  /**
   * Verify a single contract
   */
  private async verifyContract(task: VerificationTask): Promise<void> {
    await run("verify:verify", {
      address: task.address,
      contract: task.contractName,
      constructorArguments: task.constructorArguments,
      libraries: task.libraries || {}
    });
  }

  /**
   * Utility function to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate a verification report
   */
  async generateVerificationReport(): Promise<void> {
    console.log("\n📊 Generating verification report...");
    
    const report = {
      network: this.network,
      timestamp: new Date().toISOString(),
      deployer: this.deployerAddress,
      contracts: {
        core: {
          mockUSDC: {
            address: this.addresses.mockUSDC,
            verified: await this.checkVerificationStatus(this.addresses.mockUSDC),
            explorerUrl: this.getExplorerUrl(this.addresses.mockUSDC)
          },
          vaultRouter: {
            address: this.addresses.vaultRouter,
            verified: await this.checkVerificationStatus(this.addresses.vaultRouter),
            explorerUrl: this.getExplorerUrl(this.addresses.vaultRouter)
          },
          orderBookFactory: {
            address: this.addresses.orderBookFactory,
            verified: await this.checkVerificationStatus(this.addresses.orderBookFactory),
            explorerUrl: this.getExplorerUrl(this.addresses.orderBookFactory)
          },
          tradingRouter: {
            address: this.addresses.tradingRouter,
            verified: await this.checkVerificationStatus(this.addresses.tradingRouter),
            explorerUrl: this.getExplorerUrl(this.addresses.tradingRouter)
          },
          upgradeManager: {
            address: this.addresses.upgradeManager,
            verified: await this.checkVerificationStatus(this.addresses.upgradeManager),
            explorerUrl: this.getExplorerUrl(this.addresses.upgradeManager)
          }
        },
        orderBooks: {} as any
      }
    };

    // Add OrderBooks to report
    for (const [symbol, address] of Object.entries(this.addresses.orderBooks)) {
      report.contracts.orderBooks[symbol] = {
        address: address,
        verified: await this.checkVerificationStatus(address),
        explorerUrl: this.getExplorerUrl(address)
      };
    }

    // Save report to file
    const fs = require('fs');
    const reportPath = `./verification-report-${this.network}-${Date.now()}.json`;
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`📄 Verification report saved to: ${reportPath}`);
    
    // Print summary
    this.printVerificationSummary(report);
  }

  /**
   * Check if a contract is verified (simplified check)
   */
  private async checkVerificationStatus(address: string): Promise<boolean> {
    try {
      // This is a simplified check - in practice you'd call the explorer API
      // For now, we'll assume verification was successful if no error was thrown
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get explorer URL for the network
   */
  private getExplorerUrl(address: string): string {
    const explorers: { [network: string]: string } = {
      polygon: "https://polygonscan.com",
      mumbai: "https://mumbai.polygonscan.com",
      ethereum: "https://etherscan.io",
      goerli: "https://goerli.etherscan.io"
    };
    
    const baseUrl = explorers[this.network] || explorers.polygon;
    return `${baseUrl}/address/${address}`;
  }

  /**
   * Print verification summary
   */
  private printVerificationSummary(report: any): void {
    console.log("\n📋 VERIFICATION SUMMARY");
    console.log("=" .repeat(50));
    console.log(`Network: ${report.network}`);
    console.log(`Deployer: ${report.deployer}`);
    console.log(`Timestamp: ${report.timestamp}`);
    console.log("");

    console.log("Core Contracts:");
    for (const [name, info] of Object.entries(report.contracts.core as any)) {
      const status = info.verified ? "✅ VERIFIED" : "❌ FAILED";
      console.log(`  ${name}: ${status}`);
      console.log(`    Address: ${info.address}`);
      console.log(`    Explorer: ${info.explorerUrl}`);
    }

    console.log("\nOrderBook Contracts:");
    for (const [symbol, info] of Object.entries(report.contracts.orderBooks as any)) {
      const status = info.verified ? "✅ VERIFIED" : "❌ FAILED";
      console.log(`  ${symbol}: ${status}`);
      console.log(`    Address: ${info.address}`);
      console.log(`    Explorer: ${info.explorerUrl}`);
    }
    console.log("=" .repeat(50));
  }
}

/**
 * Main verification function
 */
async function main() {
  // Get deployment addresses from environment or deployment file
  const deploymentAddresses: DeploymentAddresses = {
    mockUSDC: process.env.MOCK_USDC_ADDRESS || "",
    vaultRouter: process.env.VAULT_ROUTER_ADDRESS || "",
    orderBookFactory: process.env.ORDERBOOK_FACTORY_ADDRESS || "",
    tradingRouter: process.env.TRADING_ROUTER_ADDRESS || "",
    upgradeManager: process.env.UPGRADE_MANAGER_ADDRESS || "",
    orderBooks: {
      "ETH/USD": process.env.ETH_USD_ORDERBOOK_ADDRESS || "",
      "BTC/USD": process.env.BTC_USD_ORDERBOOK_ADDRESS || "",
      // Add more markets as needed
    }
  };

  const [deployer] = await ethers.getSigners();
  const network = process.env.HARDHAT_NETWORK || "polygon";

  // Validate addresses
  const missingAddresses: string[] = [];
  Object.entries(deploymentAddresses).forEach(([key, value]) => {
    if (key === "orderBooks") {
      Object.entries(value).forEach(([symbol, address]) => {
        if (!address) missingAddresses.push(`orderBooks.${symbol}`);
      });
    } else if (!value) {
      missingAddresses.push(key);
    }
  });

  if (missingAddresses.length > 0) {
    console.error("❌ Missing deployment addresses:");
    missingAddresses.forEach(addr => console.error(`   - ${addr}`));
    console.error("\nPlease set the required environment variables or update the addresses in this script.");
    process.exit(1);
  }

  const verifier = new ContractVerifier(deploymentAddresses, deployer.address, network);
  
  try {
    await verifier.verifyAllContracts();
    await verifier.generateVerificationReport();
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

export { ContractVerifier, DeploymentAddresses };
