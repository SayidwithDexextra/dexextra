
import { createClient } from '@supabase/supabase-js'
import { 
  SmartContractEvent, 
  EventFilter, 
  EventSubscription,
  BaseEvent,
  ContractConfig 
} from '@/types/events'

// Initialize Supabase client for server-side operations
const supabaseUrl = process.env.SUPABASE_URL || 'https://khhknmobkkkvvogznxdj.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoaGtubW9ia2trdnZvZ3pueGRqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTM4NjI2NywiZXhwIjoyMDY2OTYyMjY3fQ.yuktTca5ztD7YYQhncN_A_phY67gaI5eEDNyILtsW6A'

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

export class EventDatabase {
  /**
   * Get deployed VAMM contracts for event monitoring
   */
  async getDeployedVAMMContracts(): Promise<ContractConfig[]> {
    try {
      const contracts: ContractConfig[] = []

      // First, get contracts from the vamm_markets table
      console.log('EventDatabase', "Hello")
      try {
        const { data: markets, error } = await supabase
          .from('vamm_markets')
          .select('symbol, vamm_address, vault_address, oracle_address, deployment_status')
          .eq('deployment_status', 'deployed')
          .not('vamm_address', 'is', null)
          .not('vault_address', 'is', null)

        if (error) {
          console.error('Error fetching VAMM markets:', error)
        } else {
          for (const market of markets || []) {
            // Add vAMM contract
            if (market.vamm_address) {
              contracts.push({
                address: market.vamm_address.toLowerCase(),
                abi: [], // Will be populated by the event listener service
                name: `${market.symbol} vAMM`,
                type: 'vAMM',
                startBlock: 0, // Start from current block - 1000 for recent events
              })
            }

            // Add Vault contract
            if (market.vault_address) {
              contracts.push({
                address: market.vault_address.toLowerCase(),
                abi: [], // Will be populated by the event listener service
                name: `${market.symbol} Vault`,
                type: 'Vault',
                startBlock: 0,
              })
            }

            // Add Oracle contract (optional)
            if (market.oracle_address) {
              contracts.push({
                address: market.oracle_address.toLowerCase(),
                abi: [], // Will be populated by the event listener service
                name: `${market.symbol} Oracle`,
                type: 'Oracle',
                startBlock: 0,
              })
            }
          }
        }
      } catch (error) {
        console.log('vamm_markets table might not exist, checking monitored_contracts')
      }

      // Also get contracts from the monitored_contracts table
      try {
        const { data: monitoredContracts, error } = await supabase
          .from('monitored_contracts')
          .select('name, address, type')
          .eq('is_active', true)

        if (error) {
          console.error('Error fetching monitored contracts:', error)
        } else {
          for (const contract of monitoredContracts || []) {
            // Check if contract is already in the list (avoid duplicates)
            const exists = contracts.some(c => c.address === contract.address.toLowerCase())
            if (!exists) {
              contracts.push({
                address: contract.address.toLowerCase(),
                abi: [], // Will be populated by the event listener service
                name: contract.name,
                type: contract.type,
                startBlock: 0,
              })
            }
          }
        }
      } catch (error) {
        console.log('monitored_contracts table might not exist')
      }

      console.log('📋 Found deployed contracts for monitoring:', contracts.length)
      contracts.forEach(c => console.log(`  - ${c.name} (${c.type}): ${c.address}`))
      return contracts
    } catch (error) {
      console.error('Failed to fetch VAMM contracts:', error)
      return []
    }
  }

  /**
   * Add a contract to the database for monitoring
   */
  async addContract(contract: {
    name: string
    address: string
    type: string
    network?: string
    isActive?: boolean
    description?: string
  }): Promise<void> {
    try {
      const { error } = await supabase
        .from('monitored_contracts')
        .insert({
          name: contract.name,
          address: contract.address.toLowerCase(),
          type: contract.type,
          network: contract.network || 'base',
          is_active: contract.isActive ?? true,
          description: contract.description || '',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })

      if (error) {
        // If it's a duplicate key error, that's okay
        if (error.code === '23505') { // PostgreSQL unique violation
          console.log(`Contract ${contract.address} already registered for monitoring`)
          return
        }
        console.error('Error adding contract:', error)
        throw error
      }

      console.log(`✅ Added contract ${contract.name} (${contract.address}) for monitoring`)
    } catch (error) {
      console.error('Failed to add contract:', error)
      throw error
    }
  }

  /**
   * Get contract by address
   */
  async getContractByAddress(address: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .from('monitored_contracts')
        .select('*')
        .eq('address', address.toLowerCase())
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows found
          return null
        }
        console.error('Error getting contract by address:', error)
        throw error
      }

      return data
    } catch (error) {
      console.error('Failed to get contract by address:', error)
      return null
    }
  }

  /**
   * Store a smart contract event in the database
   */
  async storeEvent(event: SmartContractEvent): Promise<void> {
    try {
      console.log(`📝 Attempting to store event: ${event.eventType} - ${event.transactionHash}:${event.logIndex}`)
      
      // Validate required fields to prevent null constraint violations
      if (!event.transactionHash) {
        throw new Error('Transaction hash is required but is null/undefined')
      }
      
      // Validate and convert blockNumber
      let blockNumber: number;
      if (typeof event.blockNumber === 'number' && !isNaN(event.blockNumber)) {
        blockNumber = event.blockNumber;
      } else if (typeof event.blockNumber === 'string') {
        blockNumber = parseInt(event.blockNumber, 16);
        if (isNaN(blockNumber)) {
          throw new Error(`Invalid block number: ${event.blockNumber}`)
        }
      } else {
        throw new Error(`Block number is required but is null/undefined or invalid: ${event.blockNumber}`)
      }
      
      // Validate and ensure blockHash
      let blockHash: string;
      if (typeof event.blockHash === 'string' && event.blockHash) {
        blockHash = event.blockHash;
      } else {
        console.warn('⚠️ Block hash is null/undefined, using placeholder');
        blockHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
      }
      
      // Validate and ensure logIndex  
      let logIndex: number;
      if (typeof event.logIndex === 'number' && !isNaN(event.logIndex)) {
        logIndex = event.logIndex;
      } else if (typeof event.logIndex === 'string') {
        logIndex = parseInt(event.logIndex, 16);
        if (isNaN(logIndex)) {
          logIndex = 0; // Default to 0 if invalid
        }
      } else {
        logIndex = 0; // Default to 0 if null/undefined
      }
      
      // Validate contract address
      if (!event.contractAddress) {
        throw new Error('Contract address is required but is null/undefined')
      }
      
      // Validate chain ID
      let chainId: number;
      if (typeof event.chainId === 'number' && !isNaN(event.chainId)) {
        chainId = event.chainId;
      } else if (typeof event.chainId === 'string') {
        chainId = parseInt(event.chainId);
        if (isNaN(chainId)) {
          chainId = 137; // Default to Polygon
        }
      } else {
        chainId = 137; // Default to Polygon
      }
      
      console.log(`📊 Validated event data: block ${blockNumber}, tx ${event.transactionHash}:${logIndex}`);
      
      // Events are already filtered at the listener level
      // This database method should store any event that reaches it
      
      // Insert the new event
      const { error } = await supabase
        .from('contract_events')
        .insert({
          transaction_hash: event.transactionHash,
          block_number: blockNumber,
          block_hash: blockHash,
          log_index: logIndex,
          contract_address: event.contractAddress.toLowerCase(),
          event_type: event.eventType,
          event_data: event,
          timestamp: (event.timestamp instanceof Date ? event.timestamp.toISOString() : event.timestamp as string),
          chain_id: chainId,
          // Extract user address if available for indexing
          user_address: this.extractUserAddress(event),
          // Extract additional indexed fields
          ...this.extractIndexedFields(event)
        })

      if (error) {
        // Handle duplicate key error gracefully
        if (error.code === '23505') { // PostgreSQL unique violation
          console.log(`⚠️  Event already exists (duplicate): ${event.eventType} - ${event.transactionHash}:${event.logIndex}`)
          
          // Check what's actually in the database for this transaction
          const { data: existingEvent } = await supabase
            .from('contract_events')
            .select('event_type, log_index, contract_address')
            .eq('transaction_hash', event.transactionHash)
            .eq('log_index', event.logIndex)
            .single()

          console.log("existingEvent:", existingEvent)
          
          if (existingEvent) {
            console.log(`📋 Existing event in DB: ${existingEvent.event_type} - ${existingEvent.contract_address}`)
          }
          
          return
        }
        
        console.error('❌ Error storing event:', error)
        throw error
      }

      console.log(`✅ Successfully stored event: ${event.eventType} - ${event.transactionHash}:${event.logIndex}`)
    } catch (error) {
      console.error('❌ Failed to store event:', error)
      throw error
    }
  }

  /**
   * Query events with filters
   */
  async queryEvents(filter: EventFilter = {}): Promise<SmartContractEvent[]> {
    try {
      let query = supabase
        .from('contract_events')
        .select('*')
        .order('block_number', { ascending: false })
        .order('log_index', { ascending: false })

      // Apply filters
      if (filter.contractAddress) {
        query = query.eq('contract_address', filter.contractAddress.toLowerCase())
      }

      if (filter.eventType) {
        query = query.eq('event_type', filter.eventType)
      }

      if (filter.eventTypes && filter.eventTypes.length > 0) {
        query = query.in('event_type', filter.eventTypes)
      }

      if (filter.userAddress) {
        query = query.eq('user_address', filter.userAddress.toLowerCase())
      }

      if (filter.fromBlock) {
        query = query.gte('block_number', filter.fromBlock)
      }

      if (filter.toBlock) {
        query = query.lte('block_number', filter.toBlock)
      }

      if (filter.limit) {
        query = query.limit(filter.limit)
      }

      if (filter.offset) {
        query = query.range(filter.offset, filter.offset + (filter.limit || 100) - 1)
      }

      const { data, error } = await query

      if (error) {
        console.error('Error querying events:', error)
        throw error
      }

      return data?.map(row => row.event_data as SmartContractEvent) || []
    } catch (error) {
      console.error('Failed to query events:', error)
      throw error
    }
  }

  /**
   * Get the latest block number processed
   */
  async getLatestBlockNumber(): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('contract_events')
        .select('block_number')
        .order('block_number', { ascending: false })
        .limit(1)
        .single()

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
        console.error('Error getting latest block:', error)
        throw error
      }

      return data?.block_number || 0
    } catch (error) {
      console.error('Failed to get latest block number:', error)
      return 0
    }
  }

  /**
   * Store event subscription
   */
  async storeSubscription(subscription: Omit<EventSubscription, 'id' | 'createdAt'>): Promise<EventSubscription> {
    try {
      const { data, error } = await supabase
        .from('event_subscriptions')
        .insert({
          contract_address: subscription.contractAddress.toLowerCase(),
          event_name: subscription.eventName,
          user_address: subscription.userAddress?.toLowerCase(),
          is_active: subscription.isActive,
          webhook_url: subscription.webhookUrl
        })
        .select()
        .single()

      if (error) {
        console.error('Error storing subscription:', error)
        throw error
      }

      return {
        id: data.id,
        contractAddress: data.contract_address,
        eventName: data.event_name,
        userAddress: data.user_address,
        isActive: data.is_active,
        webhookUrl: data.webhook_url,
        createdAt: new Date(data.created_at)
      }
    } catch (error) {
      console.error('Failed to store subscription:', error)
      throw error
    }
  }

  /**
   * Get active subscriptions
   */
  async getActiveSubscriptions(): Promise<EventSubscription[]> {
    try {
      const { data, error } = await supabase
        .from('event_subscriptions')
        .select('*')
        .eq('is_active', true)

      if (error) {
        console.error('Error getting subscriptions:', error)
        throw error
      }

      return data?.map(row => ({
        id: row.id,
        contractAddress: row.contract_address,
        eventName: row.event_name,
        userAddress: row.user_address,
        isActive: row.is_active,
        webhookUrl: row.webhook_url,
        createdAt: new Date(row.created_at)
      })) || []
    } catch (error) {
      console.error('Failed to get active subscriptions:', error)
      return []
    }
  }

  /**
   * Store last processed block for a contract
   */
  async updateLastProcessedBlock(contractAddress: string, blockNumber: number): Promise<void> {
    try {
      const { error } = await supabase
        .from('contract_sync_status')
        .upsert({
          contract_address: contractAddress.toLowerCase(),
          last_processed_block: blockNumber,
          updated_at: new Date().toISOString()
        })

      if (error) {
        console.error('Error updating last processed block:', error)
        throw error
      }
    } catch (error) {
      console.error('Failed to update last processed block:', error)
      throw error
    }
  }

  /**
   * Get last processed block for a contract
   */
  async getLastProcessedBlock(contractAddress: string): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('contract_sync_status')
        .select('last_processed_block')
        .eq('contract_address', contractAddress.toLowerCase())
        .single()

      if (error && error.code !== 'PGRST116') {
        console.error('Error getting last processed block:', error)
        throw error
      }

      return data?.last_processed_block || 0
    } catch (error) {
      console.error('Failed to get last processed block:', error)
      return 0
    }
  }

  /**
   * Extract user address from event for indexing
   */
  private extractUserAddress(event: SmartContractEvent): string | null {
    // Most events have a 'user' field
    if ('user' in event && (event as any).user) {
      return (event as any).user.toLowerCase()
    }
    
    // Some events have different field names
    if ('account' in event && (event as any).account) {
      return (event as any).account.toLowerCase()
    }
    
    if ('from' in event && 'to' in event && (event as any).from) {
      // For Transfer events, we might want to index both, but for now, index 'from'
      return (event as any).from.toLowerCase()
    }
    
    return null
  }

  /**
   * Extract additional indexed fields for optimization
   */
  private extractIndexedFields(event: SmartContractEvent): Record<string, any> {
    const fields: Record<string, any> = {}
    
    // Extract market ID for factory events
    if (event.eventType === 'MarketCreated' && 'marketId' in event) {
      fields.market_id = event.marketId
    }
    
    // Extract symbol for market events
    if ('symbol' in event) {
      fields.symbol = (event as any).symbol
    }
    
    // Extract amount for financial events
    if ('amount' in event) {
      fields.amount = (event as any).amount
    }
    
    if ('size' in event) {
      fields.size = (event as any).size
    }
    
    if ('value' in event) {
      fields.value = (event as any).value
    }
    
    return fields
  }

  /**
   * Get real-time metrics for dashboard
   */
  async getEventMetrics(timeRange: '1h' | '24h' | '7d' = '24h'): Promise<{
    totalEvents: number
    eventsByType: Record<string, number>
    uniqueUsers: number
    totalVolume: string
  }> {
    try {
      const timeRangeHours = timeRange === '1h' ? 1 : timeRange === '24h' ? 24 : 168
      const fromTime = new Date(Date.now() - timeRangeHours * 60 * 60 * 1000).toISOString()

      // Get total events
      const { count: totalEvents } = await supabase
        .from('contract_events')
        .select('*', { count: 'exact', head: true })
        .gte('timestamp', fromTime)

      // Get events by type
      const { data: eventsByTypeData } = await supabase
        .from('contract_events')
        .select('event_type')
        .gte('timestamp', fromTime)

      const eventsByType = eventsByTypeData?.reduce((acc, event) => {
        acc[event.event_type] = (acc[event.event_type] || 0) + 1
        return acc
      }, {} as Record<string, number>) || {}

      // Get unique users
      const { data: uniqueUsersData } = await supabase
        .from('contract_events')
        .select('user_address')
        .gte('timestamp', fromTime)
        .not('user_address', 'is', null)

      const uniqueUsers = new Set(uniqueUsersData?.map(u => u.user_address)).size

      // Calculate total volume (sum of amounts from position events)
      const { data: volumeData } = await supabase
        .from('contract_events')
        .select('amount, size')
        .in('event_type', ['PositionOpened', 'PositionClosed'])
        .gte('timestamp', fromTime)

      const totalVolume = volumeData?.reduce((sum, event) => {
        const amount = event.amount || event.size || '0'
        return sum + BigInt(amount)
      }, BigInt(0)).toString() || '0'

      return {
        totalEvents: totalEvents || 0,
        eventsByType,
        uniqueUsers,
        totalVolume
      }
    } catch (error) {
      console.error('Failed to get event metrics:', error)
      return {
        totalEvents: 0,
        eventsByType: {},
        uniqueUsers: 0,
        totalVolume: '0'
      }
    }
  }

  /**
   * Store webhook configuration for the new Alchemy Notify system
   */
  async storeWebhookConfig(config: {
    addressActivityWebhookId: string
    minedTransactionWebhookId: string
    contracts: Array<{ address: string; name: string; type: string }>
    createdAt: Date
    network: string
    chainId: string
  }): Promise<void> {
    try {
      const { error } = await supabase
        .from('webhook_configs')
        .upsert({
          id: 'default', // Single configuration per environment
          address_activity_webhook_id: config.addressActivityWebhookId,
          mined_transaction_webhook_id: config.minedTransactionWebhookId,
          contracts: config.contracts,
          network: config.network,
          chain_id: parseInt(config.chainId),
          created_at: config.createdAt.toISOString(),
          updated_at: new Date().toISOString()
        })

      if (error) {
        console.error('Error storing webhook config:', error)
        throw error
      }

      console.log('✅ Webhook configuration stored successfully')
    } catch (error) {
      console.error('Failed to store webhook config:', error)
      throw error
    }
  }

  /**
   * Get stored webhook configuration
   */
  async getWebhookConfig(): Promise<{
    addressActivityWebhookId: string
    minedTransactionWebhookId: string
    contracts: Array<{ address: string; name: string; type: string }>
    network: string
    chainId: number
    createdAt: Date
  } | null> {
    try {
      const { data, error } = await supabase
        .from('webhook_configs')
        .select('*')
        .eq('id', 'default')
        .single()

      if (error && error.code !== 'PGRST116') {
        console.error('Error getting webhook config:', error)
        throw error
      }

      if (!data) {
        return null
      }

      return {
        addressActivityWebhookId: data.address_activity_webhook_id,
        minedTransactionWebhookId: data.mined_transaction_webhook_id,
        contracts: data.contracts,
        network: data.network,
        chainId: data.chain_id,
        createdAt: new Date(data.created_at)
      }
    } catch (error) {
      console.error('Failed to get webhook config:', error)
      return null
    }
  }

  /**
   * Health check for database connection
   */
  async healthCheck(): Promise<void> {
    try {
      const { error } = await supabase
        .from('contract_events')
        .select('id')
        .limit(1)

      if (error) {
        throw new Error(`Database health check failed: ${error.message}`)
      }
    } catch (error) {
      throw new Error(`Database connection failed: ${(error as Error).message}`)
    }
  }

  /**
   * Initialize database tables (for development)
   */
  async initializeTables(): Promise<void> {
    console.log('Database tables should be created via Supabase migrations.')
    console.log('Run the SQL migrations in your Supabase dashboard.')
  }

  /**
   * Store a new VAMM market deployment
   */
  async storeVAMMMarket(deployment: {
    symbol: string
    vammAddress: string
    vaultAddress: string
    oracleAddress: string
    collateralAddress: string
    startingPrice: string
    marketType: number
    deploymentStatus: string
    transactionHash: string
    blockNumber: number
  }): Promise<void> {
    try {
      const { error } = await supabase
        .from('vamm_markets')
        .insert({
          symbol: deployment.symbol,
          vamm_address: deployment.vammAddress,
          vault_address: deployment.vaultAddress,
          oracle_address: deployment.oracleAddress,
          collateral_address: deployment.collateralAddress,
          starting_price: deployment.startingPrice,
          market_type: deployment.marketType,
          deployment_status: deployment.deploymentStatus,
          transaction_hash: deployment.transactionHash,
          block_number: deployment.blockNumber,
          created_at: new Date().toISOString()
        })

      if (error) {
        console.error('Database error storing VAMM market:', error)
        throw error
      }

      console.log('✅ VAMM market stored successfully:', deployment.symbol)
    } catch (error) {
      console.error('Failed to store VAMM market:', error)
      throw error
    }
  }

  /**
   * Update webhook configuration
   */
  async updateWebhookConfig(updates: {
    contracts?: any[]
    updatedAt?: Date
    addressActivityWebhookId?: string
    minedTransactionWebhookId?: string
  }): Promise<void> {
    try {
      const updateData: any = {}
      
      if (updates.contracts) {
        updateData.contracts = updates.contracts
      }
      
      if (updates.addressActivityWebhookId) {
        updateData.address_activity_webhook_id = updates.addressActivityWebhookId
      }
      
      if (updates.minedTransactionWebhookId) {
        updateData.mined_transaction_webhook_id = updates.minedTransactionWebhookId
      }
      
      updateData.updated_at = (updates.updatedAt || new Date()).toISOString()

      const { error } = await supabase
        .from('webhook_configs')
        .update(updateData)
        .eq('id', 'default')

      if (error) {
        console.error('Database error updating webhook config:', error)
        throw error
      }

      console.log('✅ Webhook configuration updated successfully')
    } catch (error) {
      console.error('Failed to update webhook config:', error)
      throw error
    }
  }
} 