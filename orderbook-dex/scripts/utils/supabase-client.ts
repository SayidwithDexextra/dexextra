import { createClient } from '@supabase/supabase-js';

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('⚠️  Supabase configuration missing. Market data will not be saved to database.');
}

// Create Supabase client with service role key for admin operations
export const supabase = supabaseUrl && supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

/**
 * Interface for contract deployment data
 */
export interface ContractDeploymentData {
  // Core contract addresses
  umaOracleManager: string;
  centralVault: string;
  orderRouter: string;
  orderBookImplementation: string;
  factory: string;
  mockUMAFinder?: string;
  mockUSDC?: string;
  
  // Network information
  chainId: bigint;
  deployer: string;
  
  // Transaction information
  deploymentTxHash?: string;
  deploymentBlockNumber?: bigint;
  deploymentGasUsed?: bigint;
  
  // Configuration
  defaultCreationFee: string; // In ETH/MATIC
  tradingFeeRate: number; // Basis points
  emergencyPauseDuration: number; // Seconds
}

/**
 * Saves contract deployment data to Supabase
 */
export async function saveContractDeployment(data: ContractDeploymentData): Promise<boolean> {
  if (!supabaseUrl || !supabaseServiceKey || !supabase) {
    console.log('📝 Skipping database save - Supabase not configured');
    return false;
  }

  try {
    console.log('💾 Saving contract deployment data to Supabase...');

    // Check if deployment already exists for this chain
    const { data: existingDeployment, error: checkError } = await supabase
      .from('contract_deployments')
      .select('id')
      .eq('chain_id', Number(data.chainId))
      .eq('deployer_address', data.deployer)
      .single();

    if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows returned
      throw checkError;
    }

    const deploymentData = {
      chain_id: Number(data.chainId),
      deployer_address: data.deployer,
      uma_oracle_manager_address: data.umaOracleManager,
      central_vault_address: data.centralVault,
      order_router_address: data.orderRouter,
      orderbook_implementation_address: data.orderBookImplementation,
      factory_address: data.factory,
      mock_uma_finder_address: data.mockUMAFinder || null,
      mock_usdc_address: data.mockUSDC || null,
      default_creation_fee: data.defaultCreationFee,
      trading_fee_rate: data.tradingFeeRate,
      emergency_pause_duration: data.emergencyPauseDuration,
      deployment_transaction_hash: data.deploymentTxHash || null,
      deployment_block_number: data.deploymentBlockNumber ? Number(data.deploymentBlockNumber) : null,
      deployment_gas_used: data.deploymentGasUsed ? Number(data.deploymentGasUsed) : null,
      deployed_at: new Date().toISOString(),
      is_active: true
    };

    let result;
    if (existingDeployment) {
      // Update existing deployment
      result = await supabase
        .from('contract_deployments')
        .update(deploymentData)
        .eq('id', existingDeployment.id);
    } else {
      // Insert new deployment
      result = await supabase
        .from('contract_deployments')
        .insert([deploymentData]);
    }

    if (result.error) {
      throw result.error;
    }

    console.log('✅ Contract deployment data saved to Supabase successfully');
    return true;

  } catch (error) {
    console.error('❌ Failed to save contract deployment data to Supabase:', error);
    return false;
  }
}

/**
 * Interface for market creation data
 */
export interface MarketCreationData {
  // Market identification
  metricId: string;
  description: string;
  category: string;
  
  // Trading configuration
  decimals: number;
  minimumOrderSize: string;
  requiresKyc: boolean;
  
  // Settlement configuration
  settlementDate: Date;
  tradingEndDate: Date;
  dataRequestWindowSeconds: number;
  autoSettle: boolean;
  oracleProvider: string;
  
  // Initial order (if any)
  initialOrder?: any;
  
  // Market images
  bannerImageUrl?: string;
  iconImageUrl?: string;
  supportingPhotoUrls?: string[];
  
  // Fees and settings
  creationFee: string;
  
  // Smart contract addresses
  marketAddress: string;
  factoryAddress: string;
  centralVaultAddress: string;
  orderRouterAddress: string;
  umaOracleManagerAddress: string;
  
  // Blockchain information
  chainId: number;
  deploymentTransactionHash: string;
  deploymentBlockNumber: number;
  deploymentGasUsed?: number;
  
  // Creator information
  creatorWalletAddress: string;
}

/**
 * Saves market creation data to Supabase
 */
export async function saveMarketCreation(data: MarketCreationData): Promise<string | null> {
  if (!supabaseUrl || !supabaseServiceKey || !supabase) {
    console.log('📝 Skipping market database save - Supabase not configured');
    return null;
  }

  try {
    console.log('💾 Saving market creation data to Supabase...');

    const marketData = {
      metric_id: data.metricId,
      description: data.description,
      category: data.category,
      decimals: data.decimals,
      minimum_order_size: data.minimumOrderSize,
      tick_size: '0.01', // Fixed tick size
      requires_kyc: data.requiresKyc,
      settlement_date: data.settlementDate.toISOString(),
      trading_end_date: data.tradingEndDate.toISOString(),
      data_request_window_seconds: data.dataRequestWindowSeconds,
      auto_settle: data.autoSettle,
      oracle_provider: data.oracleProvider,
      initial_order: data.initialOrder || null,
      banner_image_url: data.bannerImageUrl || null,
      icon_image_url: data.iconImageUrl || null,
      supporting_photo_urls: data.supportingPhotoUrls || [],
      creation_fee: data.creationFee,
      is_active: true,
      market_address: data.marketAddress,
      factory_address: data.factoryAddress,
      central_vault_address: data.centralVaultAddress,
      order_router_address: data.orderRouterAddress,
      uma_oracle_manager_address: data.umaOracleManagerAddress,
      chain_id: data.chainId,
      deployment_transaction_hash: data.deploymentTransactionHash,
      deployment_block_number: data.deploymentBlockNumber,
      deployment_gas_used: data.deploymentGasUsed || null,
      market_status: 'ACTIVE',
      total_volume: '0',
      total_trades: 0,
      open_interest_long: '0',
      open_interest_short: '0',
      creator_wallet_address: data.creatorWalletAddress,
      deployed_at: new Date().toISOString()
    };

    const { data: result, error } = await supabase
      .from('orderbook_markets')
      .insert([marketData])
      .select('id')
      .single();

    if (error) {
      throw error;
    }

    console.log('✅ Market creation data saved to Supabase successfully');
    console.log('📋 Market ID in database:', result.id);
    
    return result.id;

  } catch (error) {
    console.error('❌ Failed to save market creation data to Supabase:', error);
    return null;
  }
}

/**
 * Updates market with deployment information
 */
export async function updateMarketDeployment(
  marketId: string,
  deploymentData: {
    marketAddress: string;
    transactionHash: string;
    blockNumber: number;
    gasUsed?: number;
  }
): Promise<boolean> {
  if (!supabaseUrl || !supabaseServiceKey || !supabase) {
    return false;
  }

  try {
    const { error } = await supabase
      .from('orderbook_markets')
      .update({
        market_address: deploymentData.marketAddress,
        deployment_transaction_hash: deploymentData.transactionHash,
        deployment_block_number: deploymentData.blockNumber,
        deployment_gas_used: deploymentData.gasUsed || null,
        deployed_at: new Date().toISOString(),
        market_status: 'ACTIVE'
      })
      .eq('id', marketId);

    if (error) {
      throw error;
    }

    console.log('✅ Market deployment data updated in Supabase');
    return true;

  } catch (error) {
    console.error('❌ Failed to update market deployment in Supabase:', error);
    return false;
  }
}
