import { run, network } from "hardhat";
import { Contract } from "ethers";

/**
 * Verification configuration for different networks
 */
const VERIFICATION_CONFIG = {
  // Networks that support verification
  supportedNetworks: [
    "mainnet", "goerli", "sepolia",           // Ethereum
    "polygon", "polygonMumbai",               // Polygon  
    "arbitrumOne", "arbitrumGoerli",          // Arbitrum
    "optimisticEthereum", "optimisticGoerli", // Optimism
    "bsc", "bscTestnet",                      // BSC
    "avalanche", "avalancheFujiTestnet"       // Avalanche
  ],
  
  // Networks that require delays before verification
  delayNetworks: {
    "polygon": 30000,      // 30 seconds
    "polygonMumbai": 15000, // 15 seconds
    "bsc": 30000,          // 30 seconds
    "bscTestnet": 15000,   // 15 seconds
    "avalanche": 30000,    // 30 seconds
  },
  
  // Maximum retries for verification
  maxRetries: 5,
  retryDelay: 10000, // 10 seconds
};

/**
 * Delays execution for specified milliseconds
 */
async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Checks if the current network supports verification
 */
export function isVerificationSupported(): boolean {
  return VERIFICATION_CONFIG.supportedNetworks.includes(network.name);
}

/**
 * Gets the required delay for the current network
 */
function getNetworkDelay(): number {
  return VERIFICATION_CONFIG.delayNetworks[network.name as keyof typeof VERIFICATION_CONFIG.delayNetworks] || 0;
}

/**
 * Verifies a single contract on the block explorer
 */
async function verifySingleContract(
  contractAddress: string,
  constructorArguments: any[],
  contractPath?: string,
  retryCount = 0
): Promise<boolean> {
  try {
    console.log(`📋 Verifying contract at ${contractAddress}...`);
    
    const verifyParams: any = {
      address: contractAddress,
      constructorArguments: constructorArguments,
    };

    // Add contract path if specified
    if (contractPath) {
      verifyParams.contract = contractPath;
    }

    await run("verify:verify", verifyParams);
    
    console.log(`✅ Contract verified successfully at ${contractAddress}`);
    return true;
    
  } catch (error: any) {
    const errorMessage = error.message || error.toString();
    
    // Contract already verified
    if (errorMessage.includes("Already Verified") || 
        errorMessage.includes("already verified") ||
        errorMessage.includes("Contract source code already verified")) {
      console.log(`ℹ️  Contract at ${contractAddress} is already verified`);
      return true;
    }
    
    // Retry on certain errors
    if (retryCount < VERIFICATION_CONFIG.maxRetries && 
        (errorMessage.includes("timeout") || 
         errorMessage.includes("network") ||
         errorMessage.includes("ECONNRESET") ||
         errorMessage.includes("502") ||
         errorMessage.includes("503"))) {
      
      console.log(`⚠️  Verification failed for ${contractAddress}, retrying in ${VERIFICATION_CONFIG.retryDelay/1000}s... (attempt ${retryCount + 1}/${VERIFICATION_CONFIG.maxRetries})`);
      await delay(VERIFICATION_CONFIG.retryDelay);
      return verifySingleContract(contractAddress, constructorArguments, contractPath, retryCount + 1);
    }
    
    console.error(`❌ Failed to verify contract at ${contractAddress}:`, errorMessage);
    return false;
  }
}

/**
 * Verifies a contract with automatic retry and delay handling
 */
export async function verifyContract(
  contract: Contract,
  constructorArguments: any[],
  contractName?: string,
  contractPath?: string
): Promise<boolean> {
  if (!isVerificationSupported()) {
    console.log(`ℹ️  Verification not supported on network: ${network.name}`);
    return false;
  }

  const contractAddress = await contract.getAddress();
  const displayName = contractName || "Contract";
  
  console.log(`\n🔍 Starting verification for ${displayName} at ${contractAddress}`);
  
  // Wait for network-specific delay
  const networkDelay = getNetworkDelay();
  if (networkDelay > 0) {
    console.log(`⏳ Waiting ${networkDelay/1000}s for network confirmation...`);
    await delay(networkDelay);
  }
  
  return await verifySingleContract(contractAddress, constructorArguments, contractPath);
}

/**
 * Verifies multiple contracts in sequence
 */
export async function verifyContracts(contracts: Array<{
  contract: Contract;
  constructorArguments: any[];
  name?: string;
  contractPath?: string;
}>): Promise<{ verified: number; failed: number }> {
  if (!isVerificationSupported()) {
    console.log(`ℹ️  Verification not supported on network: ${network.name}`);
    return { verified: 0, failed: 0 };
  }

  console.log(`\n🔍 Starting batch verification of ${contracts.length} contracts on ${network.name}...`);
  
  let verified = 0;
  let failed = 0;
  
  for (const { contract, constructorArguments, name, contractPath } of contracts) {
    const success = await verifyContract(contract, constructorArguments, name, contractPath);
    if (success) {
      verified++;
    } else {
      failed++;
    }
    
    // Small delay between verifications to avoid rate limiting
    await delay(2000);
  }
  
  console.log(`\n📊 Verification Summary:`);
  console.log(`   ✅ Verified: ${verified}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📈 Success Rate: ${((verified / contracts.length) * 100).toFixed(1)}%`);
  
  return { verified, failed };
}

/**
 * Creates verification instructions for manual verification
 */
export function generateVerificationInstructions(contracts: Array<{
  address: string;
  constructorArguments: any[];
  name: string;
  contractPath?: string;
}>): string {
  let instructions = `\n📝 Manual Verification Instructions for ${network.name}:\n`;
  instructions += `${"=".repeat(60)}\n\n`;
  
  contracts.forEach(({ address, constructorArguments, name, contractPath }, index) => {
    instructions += `${index + 1}. ${name}:\n`;
    instructions += `   Address: ${address}\n`;
    
    if (contractPath) {
      instructions += `   Contract Path: ${contractPath}\n`;
    }
    
    if (constructorArguments.length > 0) {
      instructions += `   Constructor Args: ${JSON.stringify(constructorArguments, null, 2)}\n`;
      
      // Generate hardhat verify command
      const argsString = constructorArguments.map(arg => 
        typeof arg === 'string' ? `"${arg}"` : arg.toString()
      ).join(' ');
      
      instructions += `   Command: npx hardhat verify --network ${network.name} ${address}`;
      if (argsString) {
        instructions += ` ${argsString}`;
      }
      instructions += `\n`;
    } else {
      instructions += `   Command: npx hardhat verify --network ${network.name} ${address}\n`;
    }
    
    instructions += `\n`;
  });
  
  return instructions;
}

/**
 * Gets the block explorer URL for the current network
 */
export function getBlockExplorerUrl(address: string): string {
  const explorerUrls: { [key: string]: string } = {
    mainnet: `https://etherscan.io/address/${address}`,
    goerli: `https://goerli.etherscan.io/address/${address}`,
    sepolia: `https://sepolia.etherscan.io/address/${address}`,
    polygon: `https://polygonscan.com/address/${address}`,
    polygonMumbai: `https://mumbai.polygonscan.com/address/${address}`,
    arbitrumOne: `https://arbiscan.io/address/${address}`,
    optimisticEthereum: `https://optimistic.etherscan.io/address/${address}`,
    bsc: `https://bscscan.com/address/${address}`,
    bscTestnet: `https://testnet.bscscan.com/address/${address}`,
    avalanche: `https://snowtrace.io/address/${address}`,
  };
  
  return explorerUrls[network.name] || `Contract: ${address}`;
}
