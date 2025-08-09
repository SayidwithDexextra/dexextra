import { 
  createPublicClient, 
  createWalletClient, 
  http, 
  parseEther, 
  formatEther, 
  parseUnits, 
  formatUnits, 
  isAddress,
  getContract,
  decodeEventLog,
  parseAbi,
  Hex,
  Chain,
  PublicClient,
  WalletClient,
  Hash,
  Log
} from 'viem'
import { polygon } from 'viem/chains'
import { env } from './env'

// Import centralized contract configuration
import {
  getContractAddresses,
  getContractAddress,
  METRIC_VAMM_FACTORY_ABI,
  METRIC_REGISTRY_ABI,
  MOCK_USDC_ABI,
  PRICE_ORACLE_ABI as MOCK_ORACLE_ABI
} from '@/lib/contracts';

export interface MarketDeploymentParams {
  symbol: string
  description: string
  category: string // Unique category for VAMM deployment
  oracleAddress: string
  collateralTokenAddress: string
  initialPrice: string
  userAddress: string
  templateName?: string // Optional template name, defaults to 'standard'
  metricName?: string // Optional metric name for registration
  metricDataSource?: string // Optional metric data source
  settlementPeriod?: number // Optional settlement period in days
  // Custom template parameters (if provided, a custom template will be created)
  customTemplate?: {
    maxLeverage?: string
    tradingFeeRate?: string
    liquidationFeeRate?: string
    maintenanceMarginRatio?: string
    initialReserves?: string
    volumeScaleFactor?: string
    startPrice?: string
  }
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
  private publicClient: PublicClient
  private factoryAddress: `0x${string}`

  constructor(rpcUrl?: string) {
    this.publicClient = createPublicClient({
      chain: polygon,
      transport: http(rpcUrl || env.RPC_URL)
    })
    
    try {
      // Get factory address for polygon network
      this.factoryAddress = getContractAddress('polygon', 'DEXV2_FACTORY') as `0x${string}`;
      
      if (!this.factoryAddress || this.factoryAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error('Factory address is not configured');
      }
      
      console.log(`🏭 Using factory address: ${this.factoryAddress}`);
    } catch (error) {
      console.error('❌ Factory address configuration error:', error);
      throw new Error(`Failed to initialize ContractDeploymentService: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate that a contract is deployed at the given address
   */
  private async validateContractDeployed(address: string, contractName: string): Promise<boolean> {
    try {
      const code = await this.publicClient.getCode({ address: address as `0x${string}` });
      const isDeployed = code !== undefined && code !== '0x';
      
      if (!isDeployed) {
        console.warn(`⚠️ ${contractName} contract not found at address ${address}`);
      }
      
      return isDeployed;
    } catch (error) {
      console.error(`❌ Error validating ${contractName} contract:`, error);
      return false;
    }
  }

  /**
   * Check system health by validating all core contracts
   */
  async validateSystemHealth(): Promise<{ isHealthy: boolean; issues: string[] }> {
    const issues: string[] = [];
    
    try {
      // Validate factory contract
      const factoryDeployed = await this.validateContractDeployed(this.factoryAddress, 'Factory');
      if (!factoryDeployed) {
        issues.push(`Factory contract not deployed at ${this.factoryAddress}`);
      }
      
      // Validate vault contract
      const vaultAddress = getContractAddress('polygon', 'DEXV2_VAULT');
      const vaultDeployed = await this.validateContractDeployed(vaultAddress, 'CentralizedVault');
      if (!vaultDeployed) {
        issues.push(`CentralizedVault contract not deployed at ${vaultAddress}`);
      }
      
      // Validate USDC contract
      const usdcAddress = getContractAddress('polygon', 'DEXV2_USDC');
      const usdcDeployed = await this.validateContractDeployed(usdcAddress, 'USDC');
      if (!usdcDeployed) {
        issues.push(`USDC contract not deployed at ${usdcAddress}`);
      }
      
      return {
        isHealthy: issues.length === 0,
        issues
      };
    } catch (error) {
      issues.push(`System health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { isHealthy: false, issues };
    }
  }

  /**
   * Register a metric in the MetricRegistry
   */
  async registerMetric(
    params: {
      name: string
      description: string
      dataSource: string
      settlementPeriod: number
      userAddress: string
    },
    walletClient: WalletClient
  ): Promise<{ success: boolean; metricId?: string; error?: string }> {
    try {
      console.log('📝 Registering metric:', params.name);

      // Get account from wallet client
      const [account] = await walletClient.getAddresses();
      if (!account) {
        throw new Error('No account found in wallet client');
      }

      // Get factory and metric registry addresses
      const factoryContract = getContract({
        address: this.factoryAddress,
        abi: METRIC_VAMM_FACTORY_ABI,
        client: { public: this.publicClient, wallet: walletClient }
      });

      // Validate factory contract
      if (!factoryContract) {
        throw new Error('Failed to initialize factory contract');
      }

      // Get metric registry address from centralized configuration
      const metricRegistryAddress = getContractAddress('polygon', 'DEXV2_METRIC_REGISTRY');
      
      // Validate metric registry address
      if (!metricRegistryAddress || metricRegistryAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error('Invalid metric registry address in configuration');
      }

      console.log('📋 Using metric registry at:', metricRegistryAddress);
      
      // Create a contract wrapper using direct client methods (more robust for viem v2)
      const metricRegistryContract = {
        address: metricRegistryAddress as `0x${string}`,
        abi: METRIC_REGISTRY_ABI,
        read: {
          getMetricByName: async (args: [string]) => {
            return await this.publicClient.readContract({
              address: metricRegistryAddress as `0x${string}`,
              abi: METRIC_REGISTRY_ABI,
              functionName: 'getMetricByName',
              args
            });
          },
          isMetricActive: async (args: [`0x${string}`]) => {
            return await this.publicClient.readContract({
              address: metricRegistryAddress as `0x${string}`,
              abi: METRIC_REGISTRY_ABI,
              functionName: 'isMetricActive',
              args
            });
          },
          registrationFee: async () => {
            return await this.publicClient.readContract({
              address: metricRegistryAddress as `0x${string}`,
              abi: METRIC_REGISTRY_ABI,
              functionName: 'registrationFee'
            });
          }
        },
        write: {
          registerMetric: async (args: [string, string, string, string, bigint, bigint], options: { value: bigint; account: `0x${string}` }) => {
            return await walletClient.writeContract({
              address: metricRegistryAddress as `0x${string}`,
              abi: METRIC_REGISTRY_ABI,
              functionName: 'registerMetric',
              args,
              ...options
            });
          }
        }
      };

      // Validate contract wrapper (this should always pass now)
      if (!metricRegistryContract || !metricRegistryContract.read) {
        throw new Error('Failed to initialize metric registry contract or read interface');
      }

      // Check if metric with this name already exists (enhanced approach)
      let existingMetric = null;
      let isAlreadyActive = false;
      
      console.log('🔍 Checking for existing metric with name:', params.name);
      try {
        // First try to get metric by name to check for conflicts
        existingMetric = await metricRegistryContract.read.getMetricByName([params.name]);
        if (existingMetric && existingMetric.metricId && existingMetric.metricId !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
          isAlreadyActive = await metricRegistryContract.read.isMetricActive([existingMetric.metricId]);
          if (isAlreadyActive) {
            console.log('✅ Metric already registered and active');
            return { success: true, metricId: existingMetric.metricId };
          } else {
            // Metric exists but is inactive - this name is still taken
            throw new Error(`Metric name "${params.name}" already exists but is inactive. Please choose a different name.`);
          }
        }
      } catch (error) {
        // Enhanced error handling for duplicate name check
        if (error instanceof Error && error.message.includes('already exists')) {
          throw error; // Re-throw our custom duplicate name error
        }
        // If getMetricByName fails with other error, the metric likely doesn't exist yet
        console.log('📝 Metric name appears to be available, proceeding with registration');
      }

      // Generate metric ID for new metric (CLIENT-SIDE PREVIEW - CONTRACT WILL GENERATE DIFFERENT ID)
      const metricId = `0x${Buffer.from(params.name).toString('hex').padEnd(64, '0')}` as `0x${string}`;
      console.log('🔍 METRIC ID DEBUG - Client preview ID (WILL BE REPLACED):', metricId);
      console.log('🔍 Note: Contract will generate real ID as keccak256(name + sender + timestamp)');

      // Double-check with generated ID (fallback)
      if (!isAlreadyActive) {
        try {
          isAlreadyActive = await metricRegistryContract.read.isMetricActive([metricId]);
          if (isAlreadyActive) {
            console.log('✅ Metric already registered and active (by ID)');
            return { success: true, metricId };
          }
        } catch (error) {
          console.warn('Warning: Could not check metric status by ID, proceeding with registration:', error);
        }
      }

      // Get registration fee
      let registrationFee;
      try {
        registrationFee = await metricRegistryContract.read.registrationFee();
      } catch (error) {
        console.error('Error reading registration fee:', error);
        throw new Error('Failed to get metric registration fee');
      }
      console.log('💰 Registration fee:', formatEther(registrationFee), 'MATIC');

      // Get the correct minimum stake multiplier from contract
      let minimumStakeMultiplier;
      try {
        minimumStakeMultiplier = await this.publicClient.readContract({
          address: metricRegistryAddress as `0x${string}`,
          abi: METRIC_REGISTRY_ABI,
          functionName: 'minimumStakeMultiplier'
        });
      } catch (error) {
        console.warn('Could not read minimum stake multiplier, using default of 10');
        minimumStakeMultiplier = BigInt(10);
      }

      // Calculate minimum stake using contract's multiplier
      const minimumStake = registrationFee * minimumStakeMultiplier;
      console.log('📊 Calculated minimum stake:', formatEther(minimumStake), 'MATIC');

      // Validate user has sufficient balance
      try {
        const userBalance = await this.publicClient.getBalance({ address: account });
        const totalRequired = registrationFee + parseEther('0.02'); // Fee + estimated gas
        
        if (userBalance < totalRequired) {
          throw new Error(`Insufficient MATIC balance. Required: ${formatEther(totalRequired)} MATIC, Available: ${formatEther(userBalance)} MATIC`);
        }
        console.log('💰 User balance check passed:', formatEther(userBalance), 'MATIC');
      } catch (error) {
        console.warn('Could not check user balance:', error);
      }

      // Register the metric with improved error handling
      console.log('📝 Registering new metric...');
      let registerTx;
      try {
        if (!metricRegistryContract.write) {
          throw new Error('Metric registry contract write interface not available');
        }

        // Estimate gas first
        let gasEstimate;
        try {
          gasEstimate = await this.publicClient.estimateContractGas({
            address: metricRegistryAddress as `0x${string}`,
            abi: METRIC_REGISTRY_ABI,
            functionName: 'registerMetric',
            args: [
              params.name,
              params.description,
              params.dataSource,
              'Real-time data feed',
              BigInt(params.settlementPeriod),
              minimumStake
            ],
            account,
            value: registrationFee
          });
          console.log('⛽ Gas estimate:', gasEstimate.toString());
        } catch (gasError) {
          console.warn('Gas estimation failed:', gasError);
          gasEstimate = BigInt(500000); // Default gas limit
        }
        
        registerTx = await metricRegistryContract.write.registerMetric([
          params.name,
          params.description,
          params.dataSource,
          'Real-time data feed', // calculationMethod
          BigInt(params.settlementPeriod),
          minimumStake
        ], {
          value: registrationFee,
          account,
          gas: gasEstimate * BigInt(120) / BigInt(100) // Add 20% buffer
        });
      } catch (error) {
        console.error('Error submitting metric registration transaction:', error);
        
        // Enhanced error reporting
        let errorMessage = 'Failed to submit metric registration';
        if (error instanceof Error) {
          if (error.message.includes('insufficient funds')) {
            errorMessage = `Insufficient MATIC balance. Need ${formatEther(registrationFee)} MATIC for registration fee plus gas costs.`;
          } else if (error.message.includes('execution reverted')) {
            errorMessage = 'Transaction would revert. Check that metric name is unique and all parameters are valid.';
          } else if (error.message.includes('gas')) {
            errorMessage = 'Transaction failed due to gas issues. The operation may be too complex or gas limit too low.';
          } else {
            errorMessage = `Transaction submission failed: ${error.message}`;
          }
        }
        
        throw new Error(errorMessage);
      }

      console.log('⏳ Metric registration submitted:', registerTx);
      
      // Wait for confirmation
      let receipt;
      try {
        receipt = await this.publicClient.waitForTransactionReceipt({
          hash: registerTx,
          timeout: 60000 // 60 second timeout
        });
      } catch (error) {
        console.error('Error waiting for metric registration confirmation:', error);
        throw new Error('Metric registration transaction timeout or failed');
      }

      if (receipt.status === 'success') {
        console.log('✅ Metric registered successfully');
        console.log('📊 Gas used:', receipt.gasUsed.toString());
        
        // CRITICAL FIX: Extract the REAL metric ID from the MetricRegistered event
        let realMetricId = metricId; // Fallback to client-generated ID
        
        try {
          // Find the MetricRegistered event in the transaction logs
          const metricRegisteredEvent = receipt.logs.find((log: any) => {
            try {
              const decoded = decodeEventLog({
                abi: METRIC_REGISTRY_ABI,
                data: log.data,
                topics: log.topics
              });
              return decoded.eventName === 'MetricRegistered';
            } catch {
              return false;
            }
          });
          
          if (metricRegisteredEvent) {
            const decoded = decodeEventLog({
              abi: METRIC_REGISTRY_ABI,
              data: metricRegisteredEvent.data,
              topics: metricRegisteredEvent.topics
            });
            
            realMetricId = (decoded.args as any).metricId;
            console.log('🔍 METRIC ID EXTRACTED - Real metric ID from contract:', realMetricId);
            console.log('🔍 Client-generated ID (was wrong):', metricId);
          } else {
            console.warn('⚠️ Could not find MetricRegistered event, using client-generated ID (might be wrong)');
          }
        } catch (eventParseError) {
          console.warn('⚠️ Error parsing MetricRegistered event:', eventParseError);
        }
        
        return { success: true, metricId: realMetricId, transactionHash: registerTx };
      } else {
        // Enhanced error reporting for failed transactions
        console.error('❌ Transaction failed with status:', receipt.status);
        console.error('📊 Gas used:', receipt.gasUsed.toString());
        
        let failureReason = 'Unknown transaction failure';
        
        // Try to get revert reason from logs
        if (receipt.logs && receipt.logs.length > 0) {
          console.log('📋 Transaction logs available - transaction may have partial success');
        }
        
        // Common failure reasons
        if (receipt.gasUsed && receipt.gasUsed === receipt.gasLimit) {
          failureReason = 'Transaction ran out of gas. Try increasing the gas limit.';
        } else {
          failureReason = 'Transaction reverted. This could be due to: duplicate metric name, invalid parameters, insufficient balance, or contract requirements not met.';
        }
        
        throw new Error(`Metric registration transaction failed: ${failureReason}`);
      }

    } catch (error) {
      console.error('❌ Metric registration failed:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown metric registration error' 
      };
    }
  }

  /**
   * Create a custom template with specified parameters
   */
  async createCustomTemplate(
    params: {
      templateName: string
      maxLeverage: number
      tradingFeeRate: number
      liquidationFeeRate: number
      maintenanceMarginRatio: number
      initialReserves: string
      volumeScaleFactor: number
      startPrice: string
      description: string
    },
    walletClient: WalletClient
  ): Promise<{ success: boolean; templateName?: string; error?: string }> {
    try {
      console.log('🛠️ Creating custom template:', params.templateName);

      // Get account from wallet client
      const [account] = await walletClient.getAddresses();
      if (!account) {
        throw new Error('No account found in wallet client');
      }

      // Get factory contract instance
      const factoryContract = getContract({
        address: this.factoryAddress,
        abi: METRIC_VAMM_FACTORY_ABI,
        client: { public: this.publicClient, wallet: walletClient }
      });

      // Validate factory contract
      if (!factoryContract) {
        throw new Error('Failed to initialize factory contract');
      }

      // Parse parameters
      const initialReservesWei = parseEther(params.initialReserves);
      const startPriceWei = parseEther(params.startPrice);

      console.log('📋 Template Configuration:');
      console.log('   Name:', params.templateName);
      console.log('   Max Leverage:', params.maxLeverage + 'x');
      console.log('   Trading Fee:', (params.tradingFeeRate / 100).toFixed(2) + '%');
      console.log('   Initial Reserves:', params.initialReserves, 'ETH');
      console.log('   Start Price: $' + params.startPrice);

      // Create the template
      console.log('🚀 Submitting template creation transaction...');
      let templateTx;
      try {
        templateTx = await factoryContract.write.createTemplate([
          params.templateName,
          BigInt(params.maxLeverage),
          BigInt(params.tradingFeeRate),
          BigInt(params.liquidationFeeRate),
          BigInt(params.maintenanceMarginRatio),
          initialReservesWei,
          BigInt(params.volumeScaleFactor),
          startPriceWei,
          params.description
        ], {
          account
        });
      } catch (error) {
        console.error('Error submitting template creation transaction:', error);
        throw new Error(`Failed to submit template creation: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      console.log('⏳ Template creation submitted:', templateTx);

      // Wait for confirmation
      let receipt;
      try {
        receipt = await this.publicClient.waitForTransactionReceipt({
          hash: templateTx,
          timeout: 60000 // 60 second timeout
        });
      } catch (error) {
        console.error('Error waiting for template creation confirmation:', error);
        throw new Error('Template creation transaction timeout or failed');
      }

      if (receipt.status === 'success') {
        // Verify template creation
        const template = await factoryContract.read.getTemplate([params.templateName]);
        if (template && template.isActive) {
          console.log('✅ Custom template created successfully');
          console.log('   Template Active:', template.isActive);
          console.log('   Start Price: $' + formatEther(template.startPrice));
          console.log('   Initial Reserves:', formatEther(template.initialReserves), 'ETH');
          return { success: true, templateName: params.templateName };
        } else {
          throw new Error('Template creation verification failed');
        }
      } else {
        throw new Error('Template creation transaction failed');
      }

    } catch (error) {
      console.error('❌ Template creation failed:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown template creation error' 
      };
    }
  }

  /**
   * Deploy a new specialized vAMM using the V2 factory contract
   */
  async deployMarket(
    params: MarketDeploymentParams,
    walletClient: WalletClient
  ): Promise<DeploymentResult> {
    try {
      console.log('🚀 Starting V2 specialized vAMM deployment...', params)

      // Get account from wallet client
      const [account] = await walletClient.getAddresses();
      if (!account) {
        throw new Error('No account found in wallet client');
      }

      // Get factory contract instance
      const factoryContract = getContract({
        address: this.factoryAddress,
        abi: METRIC_VAMM_FACTORY_ABI,
        client: { public: this.publicClient, wallet: walletClient }
      });

      // Get deployment fee
      const deploymentFee = await factoryContract.read.deploymentFee();
      console.log('💰 Deployment fee:', formatEther(deploymentFee), 'MATIC');

      // Step 1: Register metric if it doesn't exist
      console.log('📝 Handling metric registration...');
      const metricName = params.metricName || params.symbol;
      const metricDescription = params.description || `${params.symbol} metric for trading`;
      const metricDataSource = params.metricDataSource || 'https://example.com/api';
      const settlementPeriod = params.settlementPeriod || 7; // Default 7 days

      const metricRegistrationResult = await this.registerMetric({
        name: metricName,
        description: metricDescription,
        dataSource: metricDataSource,
        settlementPeriod,
        userAddress: params.userAddress
      }, walletClient);

      if (!metricRegistrationResult.success) {
        throw new Error(`Metric registration failed: ${metricRegistrationResult.error}`);
      }

      const metricId = metricRegistrationResult.metricId as `0x${string}`;
      console.log('✅ Using metric ID for deployment:', metricId);
      console.log('🔍 METRIC ID VERIFICATION - This should be the contract-generated keccak256 hash, not hex(name)');
      
      // Step 2: Create custom template if custom parameters provided
      let templateName = params.templateName || "standard";
      
      if (params.customTemplate) {
        console.log('🛠️ Custom template parameters provided, creating custom template...');
        
        // Generate unique template name
        const timestamp = Date.now();
        const customTemplateName = `custom-${params.symbol.toLowerCase()}-${timestamp}`;
        
        // Set default values for missing custom template parameters
        const customTemplateParams = {
          templateName: customTemplateName,
          maxLeverage: parseInt(params.customTemplate.maxLeverage || '50'),
          tradingFeeRate: parseInt(params.customTemplate.tradingFeeRate || '30'), // 0.3%
          liquidationFeeRate: parseInt(params.customTemplate.liquidationFeeRate || '500'), // 5%
          maintenanceMarginRatio: parseInt(params.customTemplate.maintenanceMarginRatio || '500'), // 5%
          initialReserves: params.customTemplate.initialReserves || '10000',
          volumeScaleFactor: parseInt(params.customTemplate.volumeScaleFactor || '1000'),
          startPrice: params.customTemplate.startPrice || params.initialPrice || '1',
          description: `Custom template for ${params.symbol} with $${params.customTemplate.startPrice || params.initialPrice} start price`
        };

        console.log('📋 Creating custom template with parameters:', customTemplateParams);

        const templateResult = await this.createCustomTemplate(customTemplateParams, walletClient);
        
        if (!templateResult.success) {
          throw new Error(`Custom template creation failed: ${templateResult.error}`);
        }
        
        templateName = customTemplateName;
        console.log('✅ Using custom template:', templateName);
      } else {
        console.log('✅ Using existing template:', templateName);
      }
      
      // V2 uses categories instead of individual parameters - use the unique category from params
      const category = params.category || `Unique-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      
      // Prepare allowed metrics array
      const allowedMetrics = [metricId];

      // Estimate gas
      console.log('⛽ Estimating gas...')
      console.log('🔍 ACCOUNT DEBUG - Gas estimation using account:', account);
      const gasEstimate = await this.publicClient.estimateContractGas({
        address: this.factoryAddress,
        abi: METRIC_VAMM_FACTORY_ABI,
        functionName: 'deploySpecializedVAMM',
        args: [
          category,
          allowedMetrics,
          templateName
        ],
        account: account,
        value: deploymentFee
      });

      console.log('📊 Gas estimate:', gasEstimate.toString())

      // Check if user is authorized to deploy
      console.log('🔐 Checking deployment authorization...')
      try {
        const isAuthorized = await factoryContract.read.authorizedDeployers([account]);
        const owner = await factoryContract.read.owner();
        
        if (!isAuthorized && account.toLowerCase() !== owner.toLowerCase()) {
          throw new Error(`AUTHORIZATION_REQUIRED: Your wallet address (${account}) is not authorized to deploy VAMMs. Please contact the system administrator to get authorized, or use an authorized wallet address. Factory owner: ${owner}`);
        }
        console.log('✅ User is authorized to deploy');
      } catch (authError: any) {
        if (authError.message?.includes('AUTHORIZATION_REQUIRED')) {
          throw authError;
        }
        console.warn('⚠️ Could not verify authorization (contract might not support this method), proceeding...');
      }

      // Verify template exists before deployment
      console.log('🔍 TEMPLATE DEBUG - Checking if template exists:', templateName);
      try {
        const templateInfo = await factoryContract.read.templates([templateName]);
        console.log('📋 Template info:', templateInfo);
        if (!templateInfo || !templateInfo.isActive) {
          console.warn('⚠️ Template might not be active:', templateInfo);
        }
      } catch (templateError) {
        console.warn('⚠️ Could not verify template existence:', templateError);
      }

      // Check if category already exists (might cause authorization error)
      console.log('🔍 CATEGORY DEBUG - Checking if category already exists:', category);
      try {
        const categoryVAMM = await factoryContract.read.vammsByCategory([category]);
        if (categoryVAMM && categoryVAMM !== '0x0000000000000000000000000000000000000000') {
          console.warn('⚠️ Category already exists with VAMM:', categoryVAMM);
          console.warn('   This might be causing the authorization error!');
        } else {
          console.log('✅ Category is available');
        }
      } catch (categoryError) {
        console.warn('⚠️ Could not check category existence:', categoryError);
      }

      // Execute the transaction
      console.log('📝 Creating specialized VAMM transaction...')
      console.log('🔍 FINAL TRANSACTION DEBUG:');
      console.log('   - Account:', account);
      console.log('   - Category:', category);
      console.log('   - Allowed Metrics:', allowedMetrics);
      console.log('   - Template Name:', templateName);
      console.log('   - Deployment Fee:', formatEther(deploymentFee), 'MATIC');
      
      const txHash = await factoryContract.write.deploySpecializedVAMM(
        [
          category,
          allowedMetrics,
          templateName
        ],
        { 
          value: deploymentFee,
          gas: gasEstimate * BigInt(250) / BigInt(100), // Add 150% buffer
          account
        }
      )

      console.log('⏳ Transaction submitted:', txHash)

      // Wait for confirmation
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash
      })
      
      if (!receipt) {
        throw new Error('Transaction receipt not found')
      }

      console.log('✅ Transaction confirmed in block:', receipt.blockNumber)

      // Parse the VAMMDeployed event
      const vammDeployedEvent = receipt.logs.find((log: Log) => {
        try {
          const decoded = decodeEventLog({
            abi: METRIC_VAMM_FACTORY_ABI,
            data: log.data,
            topics: log.topics
          });
          return decoded.eventName === 'VAMMDeployed'
        } catch {
          return false
        }
      });

      if (!vammDeployedEvent) {
        throw new Error('VAMMDeployed event not found in transaction receipt')
      }

      const decoded = decodeEventLog({
        abi: METRIC_VAMM_FACTORY_ABI,
        data: vammDeployedEvent.data,
        topics: vammDeployedEvent.topics
      });
      
      const result: DeploymentResult = {
        success: true,
        marketId: metricId,
        vammAddress: (decoded.args as any).vammAddress,
        vaultAddress: getContractAddress('polygon', 'DEXV2_VAULT'), // V2 uses centralized vault
        transactionHash: txHash,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString()
      }

      console.log('🎉 Specialized VAMM deployed successfully:', result)
      return result

    } catch (error) {
      console.error('❌ VAMM deployment failed:', error)
      
      let errorMessage = 'Unknown deployment error'
      if (error instanceof Error) {
        errorMessage = error.message
        
        // Handle specific authorization errors
        if (errorMessage.includes('AUTHORIZATION_REQUIRED')) {
          errorMessage = errorMessage.replace('AUTHORIZATION_REQUIRED: ', '');
        } else if (errorMessage.includes('not authorized') || errorMessage.includes('MetricVAMMFactory: not authorized')) {
          errorMessage = `❌ Authorization Error: Your wallet is not authorized to deploy VAMMs. Please contact the system administrator to authorize your wallet address, or use an authorized wallet.`;
        } else if (errorMessage.includes('only owner')) {
          errorMessage = `❌ Permission Error: This operation requires owner privileges. Please use the contract owner's wallet address.`;
        }
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
   * Check if a wallet address is authorized to deploy VAMMs
   */
  async checkDeploymentAuthorization(walletAddress: string): Promise<{
    isAuthorized: boolean;
    isOwner: boolean;
    ownerAddress?: string;
    errorMessage?: string;
  }> {
    try {
      const factoryContract = getContract({
        address: this.factoryAddress,
        abi: METRIC_VAMM_FACTORY_ABI,
        client: { public: this.publicClient }
      });

      const [isAuthorized, owner] = await Promise.all([
        factoryContract.read.authorizedDeployers([walletAddress as `0x${string}`]),
        factoryContract.read.owner()
      ]);

      const isOwner = walletAddress.toLowerCase() === owner.toLowerCase();
      
      return {
        isAuthorized: isAuthorized || isOwner,
        isOwner,
        ownerAddress: owner,
        errorMessage: !isAuthorized && !isOwner 
          ? `Wallet ${walletAddress} is not authorized. Contact the owner (${owner}) for authorization.`
          : undefined
      };
    } catch (error) {
      console.error('Error checking authorization:', error);
      return {
        isAuthorized: false,
        isOwner: false,
        errorMessage: `Failed to check authorization: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Get deployment fee from factory contract
   */
  async getDeploymentFee(): Promise<string> {
    try {
      // First validate that the factory contract is deployed
      const factoryDeployed = await this.validateContractDeployed(this.factoryAddress, 'Factory');
      if (!factoryDeployed) {
        console.warn('⚠️ Factory contract not deployed, returning default fee');
        return '0.1'; // Default fallback
      }

      // Use readContract directly - this is the recommended Viem approach
      const fee = await this.publicClient.readContract({
        address: this.factoryAddress,
        abi: METRIC_VAMM_FACTORY_ABI,
        functionName: 'deploymentFee',
      });

      console.log(`💰 Factory deployment fee: ${formatEther(fee)} MATIC`);
      return formatEther(fee)
    } catch (error) {
      console.error('❌ Error getting deployment fee:', error)
      console.log('🔄 Using default deployment fee as fallback');
      return '0.1' // Default fallback
    }
  }

  /**
   * Get VAMM info by metric ID (V2 compatible)
   */
  async getMarketInfo(metricId: string) {
    try {
      const factoryContract = getContract({
        address: this.factoryAddress,
        abi: METRIC_VAMM_FACTORY_ABI,
        client: this.publicClient
      });

      // V2 uses getVAMMByMetric to find VAMM address by metric ID
      const vammAddress = await factoryContract.read.getVAMMByMetric([metricId as `0x${string}`])
      
      if (vammAddress === '0x0000000000000000000000000000000000000000') {
        return null; // No VAMM found for this metric
      }

      // Get detailed VAMM info
      const vammInfo = await factoryContract.read.getVAMMInfo([vammAddress])
      
      return {
        vamm: vammAddress,
        vault: getContractAddress('polygon', 'DEXV2_VAULT'), // V2 uses centralized vault
        category: (vammInfo as any).category,
        allowedMetrics: (vammInfo as any).allowedMetrics,
        templateUsed: (vammInfo as any).templateUsed,
        creator: (vammInfo as any).creator,
        isActive: (vammInfo as any).isActive,
        createdAt: Number((vammInfo as any).deployedAt)
      }
    } catch (error) {
      console.error('Error getting VAMM info:', error)
      return null
    }
  }
}

// Singleton instance - wrapped with error handling
let contractDeploymentServiceInstance: ContractDeploymentService | null = null;

export const contractDeploymentService = (() => {
  try {
    if (!contractDeploymentServiceInstance) {
      contractDeploymentServiceInstance = new ContractDeploymentService();
    }
    return contractDeploymentServiceInstance;
  } catch (error) {
    console.error('❌ Failed to initialize ContractDeploymentService:', error);
    throw error;
  }
})();

// Default contract addresses for easy access (V2 compatible)
export const DEFAULT_ADDRESSES = {
  get mockUSDC() {
    // Use V2 USDC address
    return getContractAddress('polygon', 'DEXV2_USDC');
  },
  get mockOracle() {
    // Use V2 price oracle address
    return getContractAddress('polygon', 'DEXV2_PRICE_ORACLE');
  },
  get vAMMFactory() {
    // Use V2 factory address
    return getContractAddress('polygon', 'DEXV2_FACTORY');
  },
  get centralVault() {
    // V2 centralized vault
    return getContractAddress('polygon', 'DEXV2_VAULT');
  },
  get metricRegistry() {
    // V2 metric registry
    return getContractAddress('polygon', 'DEXV2_METRIC_REGISTRY');
  }
}