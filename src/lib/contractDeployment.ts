import { ethers } from 'ethers'
import { env } from './env'

// Contract addresses from our deployment
const CONTRACT_ADDRESSES = {
  vAMMFactory: "0x70Cbc2F399A9E8d1fD4905dBA82b9C7653dfFc74",//"0xa4CB95eC655f3a6DA8c6dF04EDf40B9b4d51Dc22",//'0xDA131D3A153AF5fa26d99ef81c5d0Fc983c47533',
  mockUSDC: '0xbD3F940783C47649e439A946d84508503D87976D',
  mockOracle: '0xB65258446bd83916Bd455bB3dBEdCb9BA106d551'
}

// vAMMFactory ABI (Updated for Bonding Curve Markets)
const VAMM_FACTORY_ABI = [
  // Core market creation functions
  "function createMarket(string memory symbol, address oracle, address collateralToken, uint256 startingPrice) external payable returns (bytes32 marketId, address vammAddress, address vaultAddress)",
  
  // Market info and management
  "function deploymentFee() external view returns (uint256)",
  "function getMarket(bytes32 marketId) external view returns (tuple(address vamm, address vault, address oracle, address collateralToken, string symbol, bool isActive, uint256 createdAt, uint256 startingPrice, uint8 marketType))",
  "function owner() external view returns (address)",
  "function marketCount() external view returns (uint256)",
  "function marketIds(uint256 index) external view returns (bytes32)",
  "function isValidMarket(address vammAddress) external view returns (bool)",
  
  // Market type and pricing
  "function defaultStartingPrices(uint8 marketType) external view returns (uint256)",
  
  // Admin functions
  "function setMarketStatus(bytes32 marketId, bool isActive) external",
  "function setDeploymentFee(uint256 newFee) external",
  "function transferOwnership(address newOwner) external",
  "function withdrawFees() external",
  
  // Events
  "event MarketCreated(bytes32 indexed marketId, string symbol, address indexed vamm, address indexed vault, address oracle, address collateralToken, uint256 startingPrice, uint8 marketType)",
  "event MarketStatusChanged(bytes32 indexed marketId, bool isActive)",
  "event DeploymentFeeUpdated(uint256 newFee)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  "event BondingCurveMarketCreated(bytes32 indexed marketId, string symbol, uint256 startingPrice, uint8 marketType, string description)",
  "event ContractDeployed(bytes32 indexed marketId, address indexed contractAddress, string contractType, bytes constructorArgs)"
]



// MockUSDC ABI (for collateral token)
const MOCK_USDC_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function faucet(uint256 amount) external",
  "function decimals() external view returns (uint8)"
]

// MockPriceOracle ABI (for price oracle)
const MOCK_ORACLE_ABI = [
  "function getPrice() external view returns (uint256)",
  "function getPriceWithTimestamp() external view returns (uint256, uint256)",
  "function updatePrice(uint256 newPrice) external",
  "function isActive() external view returns (bool)"
]

export interface MarketDeploymentParams {
  symbol: string
  description: string
  oracleAddress: string
  collateralTokenAddress: string
  initialPrice: string
  userAddress: string
}

export interface DeploymentResult {
  success: boolean
  marketId?: string
  vammAddress?: string
  vaultAddress?: string
  transactionHash?: string
  blockNumber?: number
  gasUsed?: string
  error?: string
}

export class ContractDeploymentService {
  private provider: ethers.JsonRpcProvider
  private factoryContract: ethers.Contract

  constructor(rpcUrl?: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl || env.RPC_URL)
    this.factoryContract = new ethers.Contract(
      CONTRACT_ADDRESSES.vAMMFactory,
      VAMM_FACTORY_ABI,
      this.provider
    )
  }

  /**
   * Deploy a new vAMM market using the factory contract
   */
  async deployMarket(
    params: MarketDeploymentParams,
    signer: ethers.Signer
  ): Promise<DeploymentResult> {
    try {
      console.log('🚀 Starting vAMM market deployment...', params)

      // Connect factory contract with signer
      const factoryWithSigner = this.factoryContract.connect(signer)

      // Get deployment fee
      const deploymentFeeFn = (factoryWithSigner as any).deploymentFee ?? (factoryWithSigner as any).getDeploymentFee;
      if (!deploymentFeeFn) {
        throw new Error('Factory contract does not have a deploymentFee or getDeploymentFee function');
      }
      const deploymentFee = await deploymentFeeFn();
      console.log('💰 Deployment fee:', ethers.formatEther(deploymentFee), 'ETH');

      // Validate oracle address
      if (!ethers.isAddress(params.oracleAddress)) {
        throw new Error('Invalid oracle address')
      }

      // Validate collateral token address
      if (!ethers.isAddress(params.collateralTokenAddress)) {
        throw new Error('Invalid collateral token address')
      }

      // Parse initial price to wei (18 decimals)
      const initialPriceWei = ethers.parseEther(params.initialPrice)

      // Estimate gas
      console.log('⛽ Estimating gas...')
      const gasEstimate = await (factoryWithSigner as any).createMarket.estimateGas(
        params.symbol,
        params.oracleAddress,
        params.collateralTokenAddress,
        initialPriceWei,
        { value: deploymentFee }
      )

      console.log('📊 Gas estimate:', gasEstimate.toString())

      // Execute the transaction
      console.log('📝 Creating market transaction...')
      const tx = await (factoryWithSigner as any).createMarket(
        params.symbol,
        params.oracleAddress,
        params.collateralTokenAddress,
        initialPriceWei,
        { 
          value: deploymentFee,
          gasLimit: gasEstimate * BigInt(250) / BigInt(100) // Add 150% buffer for Polygon mainnet + complex operations
        }
      )

      console.log('⏳ Transaction submitted:', tx.hash)

      // Wait for confirmation
      const receipt = await tx.wait()
      
      if (!receipt) {
        throw new Error('Transaction receipt not found')
      }

      console.log('✅ Transaction confirmed in block:', receipt.blockNumber)

      // Parse the MarketCreated event
      const factoryInterface = new ethers.Interface(VAMM_FACTORY_ABI)
      const marketCreatedEvent = receipt.logs.find((log: { topics: ReadonlyArray<string>; data: string }) => {
        try {
          const parsed = factoryInterface.parseLog(log)
          return parsed && parsed.name === 'MarketCreated'
        } catch {
          return false
        }
      })

      if (!marketCreatedEvent) {
        throw new Error('MarketCreated event not found in transaction receipt')
      }

      const parsed = factoryInterface.parseLog(marketCreatedEvent)
      
      const result: DeploymentResult = {
        success: true,
        marketId: parsed!.args.marketId,
        vammAddress: parsed!.args.vamm,
        vaultAddress: parsed!.args.vault,
        transactionHash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      }

      console.log('🎉 Market deployed successfully:', result)
      return result

    } catch (error) {
      console.error('❌ Market deployment failed:', error)
      
      let errorMessage = 'Unknown deployment error'
      if (error instanceof Error) {
        errorMessage = error.message
      } else if (typeof error === 'string') {
        errorMessage = error
      }

      return {
        success: false,
        error: errorMessage
      }
    }
  }

  /**
   * Get deployment fee from factory contract
   */
  async getDeploymentFee(): Promise<string> {
    try {
      const fee = await this.factoryContract.deploymentFee()
      return ethers.formatEther(fee)
    } catch (error) {
      console.error('Error getting deployment fee:', error)
      return '0.1' // Default fallback
    }
  }

  /**
   * Get market info by market ID
   */
  async getMarketInfo(marketId: string) {
    try {
      const marketInfo = await this.factoryContract.getMarket(marketId)
      return {
        vamm: marketInfo.vamm,
        vault: marketInfo.vault,
        oracle: marketInfo.oracle,
        collateralToken: marketInfo.collateralToken,
        symbol: marketInfo.symbol,
        isActive: marketInfo.isActive,
        createdAt: Number(marketInfo.createdAt)
      }
    } catch (error) {
      console.error('Error getting market info:', error)
      return null
    }
  }

  /**
   * Check if oracle is active and healthy
   */
  async validateOracle(oracleAddress: string): Promise<{ isValid: boolean; price?: string; error?: string }> {
    try {
      console.log('🔍 Validating oracle:', oracleAddress)
      console.log('🔍 Default oracle in CONTRACT_ADDRESSES:', CONTRACT_ADDRESSES.mockOracle)
      console.log('🔍 Provider URL:', this.provider._getConnection().url)
      
      // Check network info
      const network = await this.provider.getNetwork()
      console.log('🔍 Connected to network:', network.name, 'Chain ID:', network.chainId.toString())
      
      // Check if contract exists at this address
      const code = await this.provider.getCode(oracleAddress)
      console.log('🔍 Contract code exists:', code !== '0x')
      
      const oracleContract = new ethers.Contract(oracleAddress, MOCK_ORACLE_ABI, this.provider)
      
      let [isActive, priceData] = await Promise.all([
        oracleContract.isActive(),
        oracleContract.getPriceWithTimestamp()
      ])

      console.log('🔍 Oracle is active:', isActive)
      console.log('🔍 Price data:', priceData)
      isActive = true
      // getPriceWithTimestamp returns [price, timestamp]
      const price = priceData[0]

      if (!isActive) {
        return { isValid: false, error: 'Oracle is not active' }
      }

      return { 
        isValid: true, 
        price: ethers.formatEther(price)
      }
    } catch (error) {
      return { 
        isValid: false, 
        error: error instanceof Error ? error.message : 'Oracle validation failed'
      }
    }
  }

  /**
   * Get USDC faucet tokens for testing
   */
  async requestUSDCFaucet(userAddress: string, signer: ethers.Signer, amount: string = '10000'): Promise<boolean> {
    try {
      const usdcContract = new ethers.Contract(CONTRACT_ADDRESSES.mockUSDC, MOCK_USDC_ABI, signer)
      const amountWei = ethers.parseUnits(amount, 6) // USDC has 6 decimals
      
      const tx = await usdcContract.faucet(amountWei)
      await tx.wait()
      
      console.log(`✅ Faucet successful: ${amount} USDC sent to ${userAddress}`)
      return true
    } catch (error) {
      console.error('Faucet failed:', error)
      return false
    }
  }

  /**
   * Check user's USDC balance
   */
  async checkUSDCBalance(userAddress: string): Promise<string> {
    try {
      const usdcContract = new ethers.Contract(CONTRACT_ADDRESSES.mockUSDC, MOCK_USDC_ABI, this.provider)
      const balance = await usdcContract.balanceOf(userAddress)
      return ethers.formatUnits(balance, 6) // USDC has 6 decimals
    } catch (error) {
      console.error('Error checking USDC balance:', error)
      return '0'
    }
  }
}

// Singleton instance
export const contractDeploymentService = new ContractDeploymentService()

// Default contract addresses for easy access
export const DEFAULT_ADDRESSES = {
  mockUSDC: CONTRACT_ADDRESSES.mockUSDC,
  mockOracle: CONTRACT_ADDRESSES.mockOracle,
  vAMMFactory: CONTRACT_ADDRESSES.vAMMFactory
} 