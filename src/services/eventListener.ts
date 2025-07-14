import { ethers } from 'ethers'
import { env } from '@/lib/env'
import { EventDatabase } from '@/lib/eventDatabase'
import { 
  SmartContractEvent, 
  ContractConfig, 
  EventListenerConfig,
  RealtimeEventData 
} from '@/types/events'
import WebSocket from 'ws'

// ABIs for the smart contracts
const VAMM_ABI = [
  "event PositionOpened(address indexed user, bool isLong, uint256 size, uint256 price, uint256 leverage, uint256 fee)",
  "event PositionClosed(address indexed user, uint256 size, uint256 price, int256 pnl, uint256 fee)",
  "event FundingUpdated(int256 fundingRate, uint256 fundingIndex, int256 premiumFraction)",
  "event FundingPaid(address indexed user, int256 amount, uint256 fundingIndex)",
  "event PositionLiquidated(address indexed user, address indexed liquidator, uint256 size, uint256 price, uint256 fee)",
  "event TradingFeeCollected(address indexed user, uint256 amount)",
  "event ParametersUpdated(string parameter, uint256 newValue)",
  "event AuthorizedAdded(address indexed account)",
  "event AuthorizedRemoved(address indexed account)",
  "event Paused()",
  "event Unpaused()"
]

const VAULT_ABI = [
  "event CollateralDeposited(address indexed user, uint256 amount)",
  "event CollateralWithdrawn(address indexed user, uint256 amount)",
  "event MarginReserved(address indexed user, uint256 amount)",
  "event MarginReleased(address indexed user, uint256 amount)",
  "event PnLUpdated(address indexed user, int256 pnlDelta)",
  "event FundingApplied(address indexed user, int256 fundingPayment, uint256 fundingIndex)",
  "event UserLiquidated(address indexed user, uint256 penalty)",
  "event AuthorizedAdded(address indexed account)",
  "event AuthorizedRemoved(address indexed account)",
  "event VammUpdated(address indexed newVamm)",
  "event Paused()",
  "event Unpaused()"
]

const FACTORY_ABI = [
  "event MarketCreated(bytes32 indexed marketId, string symbol, address indexed vamm, address indexed vault, address oracle, address collateralToken)",
  "event MarketStatusChanged(bytes32 indexed marketId, bool isActive)",
  "event DeploymentFeeUpdated(uint256 newFee)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)"
]

const ORACLE_ABI = [
  "event PriceUpdated(uint256 newPrice, uint256 timestamp)",
  "event OracleStatusChanged(bool active)",
  "event MaxPriceAgeUpdated(uint256 newAge)"
]

const TOKEN_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "event Mint(address indexed to, uint256 value)"
]

export class SmartContractEventListener {
  private provider: ethers.JsonRpcProvider
  private wsProvider?: ethers.WebSocketProvider
  private database: EventDatabase
  private contracts: Map<string, ethers.Contract> = new Map()
  private wsContracts: Map<string, ethers.Contract> = new Map()
  private config: EventListenerConfig
  private isRunning = false
  private reconnectTimeout?: NodeJS.Timeout
  private healthCheckInterval?: NodeJS.Timeout
  private webSocketClients: Set<WebSocket> = new Set()

  constructor(config: EventListenerConfig) {
    this.config = config
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl)
    this.database = new EventDatabase()

    if (config.wsRpcUrl) {
      this.wsProvider = new ethers.WebSocketProvider(config.wsRpcUrl)
      this.setupWebSocketReconnection()
    }
  }

  /**
   * Start listening for events with comprehensive debugging
   */
  async start(): Promise<void> {
    const startTime = Date.now()
    this.startTime = startTime
    
    // Check if already running
    if (this.isRunning) {
      console.log('⚠️  Event listener is already running')
      return
    }

    console.log('🚀 Starting Smart Contract Event Listener...')
    console.log(`📋 Configuration:
      - RPC URL: ${this.config.rpcUrl}
      - WebSocket URL: ${this.config.wsRpcUrl || 'Not configured'}
      - Contracts to monitor: ${this.config.contracts.length}
      - Batch size: ${this.config.batchSize}
      - Retry attempts: ${this.config.retryAttempts}
      - Retry delay: ${this.config.retryDelay}ms`)

    this.isRunning = true
    this.startupErrors = [] // Clear previous errors
    const errors: Array<{ step: string; error: Error }> = []

    try {
      // Step 1: Test provider connectivity
      console.log('\n🔍 Step 1: Testing provider connectivity...')
      try {
        const network = await this.provider.getNetwork()
        const blockNumber = await this.provider.getBlockNumber()
        console.log(`✅ HTTP Provider connected successfully:
          - Chain ID: ${network.chainId}
          - Network Name: ${network.name}
          - Current Block: ${blockNumber}`)
      } catch (error) {
        const connectionError = error as Error
        console.error('❌ HTTP Provider connection failed:', {
          message: connectionError.message,
          code: (connectionError as any).code,
          url: this.config.rpcUrl
        })
        errors.push({ step: 'HTTP Provider Connection', error: connectionError })
        throw new Error(`HTTP Provider connection failed: ${connectionError.message}`)
      }

      // Step 2: Test WebSocket provider if configured
      if (this.config.wsRpcUrl) {
        console.log('\n🔍 Step 2: Testing WebSocket provider connectivity...')
        try {
          if (!this.wsProvider) {
            this.wsProvider = new ethers.WebSocketProvider(this.config.wsRpcUrl)
            this.setupWebSocketReconnection()
          }
          
          const wsNetwork = await this.wsProvider.getNetwork()
          const wsBlockNumber = await this.wsProvider.getBlockNumber()
          console.log(`✅ WebSocket Provider connected successfully:
            - Chain ID: ${wsNetwork.chainId}
            - Network Name: ${wsNetwork.name}
            - Current Block: ${wsBlockNumber}`)
        } catch (error) {
          const wsError = error as Error
          console.error('❌ WebSocket Provider connection failed:', {
            message: wsError.message,
            code: (wsError as any).code,
            url: this.config.wsRpcUrl
          })
          console.log('⚠️  Continuing without WebSocket support (will use HTTP polling)')
          this.wsProvider = undefined
          errors.push({ step: 'WebSocket Provider Connection', error: wsError })
        }
      } else {
        console.log('\n⚠️  Step 2: WebSocket URL not configured - will use HTTP polling only')
      }

      // Step 3: Test database connectivity
      console.log('\n🔍 Step 3: Testing database connectivity...')
      try {
        // Test database connection by trying to get latest block number
        const latestBlock = await this.database.getLatestBlockNumber()
        console.log(`✅ Database connection successful (latest event block: ${latestBlock || 'none'})`)
      } catch (error) {
        const dbError = error as Error
        console.error('❌ Database connection failed:', {
          message: dbError.message,
          stack: dbError.stack
        })
        errors.push({ step: 'Database Connection', error: dbError })
        throw new Error(`Database connection failed: ${dbError.message}`)
      }

      // Step 4: Validate contracts configuration
      console.log('\n🔍 Step 4: Validating contracts configuration...')
      if (this.config.contracts.length === 0) {
        console.log('⚠️  No contracts configured for monitoring')
        console.log('💡 This may be expected if contracts haven\'t been deployed yet')
        console.log('💡 Event listener will start but won\'t monitor any events until contracts are added')
      } else {
        console.log(`✅ Found ${this.config.contracts.length} contracts to monitor:`)
        for (const contract of this.config.contracts) {
          console.log(`  - ${contract.name} (${contract.type}): ${contract.address}`)
          
          // Validate contract address format
          if (!ethers.isAddress(contract.address)) {
            const addressError = new Error(`Invalid contract address: ${contract.address}`)
            errors.push({ step: 'Contract Address Validation', error: addressError })
            throw addressError
          }
        }
      }

      // Step 5: Initialize contracts
      console.log('\n🔍 Step 5: Initializing contracts...')
      try {
        await this.initializeContracts()
        console.log('✅ Contracts initialized successfully')
      } catch (error) {
        const initError = error as Error
        console.error('❌ Contract initialization failed:', {
          message: initError.message,
          stack: initError.stack
        })
        errors.push({ step: 'Contract Initialization', error: initError })
        throw new Error(`Contract initialization failed: ${initError.message}`)
      }

      // Step 6: Sync historical events
      console.log('\n🔍 Step 6: Syncing historical events...')
      try {
        await this.syncHistoricalEvents()
        console.log('✅ Historical events synced successfully')
      } catch (error) {
        const syncError = error as Error
        console.error('❌ Historical event sync failed:', {
          message: syncError.message,
          stack: syncError.stack
        })
        errors.push({ step: 'Historical Event Sync', error: syncError })
        // Don't throw here - we can continue without historical sync
        console.log('⚠️  Continuing without historical sync (real-time events will still work)')
      }

      // Step 7: Start real-time event listening
      console.log('\n🔍 Step 7: Starting real-time event listening...')
      try {
        await this.startRealtimeListening()
        console.log('✅ Real-time event listening started successfully')
      } catch (error) {
        const realtimeError = error as Error
        console.error('❌ Real-time event listening failed:', {
          message: realtimeError.message,
          stack: realtimeError.stack
        })
        errors.push({ step: 'Real-time Event Listening', error: realtimeError })
        throw new Error(`Real-time event listening failed: ${realtimeError.message}`)
      }

      // Step 8: Start health check
      console.log('\n🔍 Step 8: Starting health check...')
      try {
        this.startHealthCheck()
        console.log('✅ Health check started successfully')
      } catch (error) {
        const healthError = error as Error
        console.error('❌ Health check startup failed:', {
          message: healthError.message,
          stack: healthError.stack
        })
        errors.push({ step: 'Health Check', error: healthError })
        // Don't throw here - health check is not critical for basic functionality
        console.log('⚠️  Continuing without health check')
      }

      // Success summary
      const endTime = Date.now()
      const duration = endTime - startTime
      
      console.log(`\n✅ Event listener started successfully!
        📊 Summary:
        - Total startup time: ${duration}ms
        - Contracts monitoring: ${this.config.contracts.length}
        - WebSocket support: ${this.wsProvider ? 'Enabled' : 'Disabled'}
        - Database connection: Active
        - Health check: ${this.healthCheckInterval ? 'Active' : 'Disabled'}`)
      
      if (errors.length > 0) {
        console.log(`\n⚠️  ${errors.length} non-critical errors occurred during startup:`)
        errors.forEach((error, index) => {
          console.log(`  ${index + 1}. ${error.step}: ${error.error.message}`)
        })
      }

    } catch (error) {
      // Comprehensive error logging
      const startupError = error as Error
      const endTime = Date.now()
      const duration = endTime - startTime
      
      console.error(`\n❌ Event listener failed to start after ${duration}ms`)
      console.error(`💥 Fatal Error: ${startupError.message}`)
      console.error(`🔍 Error Stack: ${startupError.stack}`)
      
              // Log all accumulated errors and add to startup errors
        if (errors.length > 0) {
          console.error(`\n📋 Error Summary (${errors.length} errors):`)
          errors.forEach((error, index) => {
            console.error(`  ${index + 1}. ${error.step}:`)
            console.error(`     Message: ${error.error.message}`)
            console.error(`     Code: ${(error.error as any).code || 'N/A'}`)
            
            // Add to startup errors for status tracking
            this.startupErrors.push({
              timestamp: new Date(),
              error: `${error.step}: ${error.error.message}`
            })
          })
        }

      // Provide specific troubleshooting suggestions
      console.error(`\n💡 Troubleshooting suggestions:`)
      
      if (errors.some(e => e.step.includes('Provider Connection'))) {
        console.error(`  🔗 Connection Issues:
          - Check if your RPC endpoint is accessible: ${this.config.rpcUrl}
          - Verify your internet connection
          - Check if the blockchain node is running (for local development)
          - Verify firewall settings`)
      }
      
      if (errors.some(e => e.step.includes('Database'))) {
        console.error(`  🗄️  Database Issues:
          - Check Supabase connection settings
          - Verify database migrations have been run
          - Check database permissions
          - Verify service role key is correct`)
      }
      
      if (errors.some(e => e.step.includes('Contract'))) {
        console.error(`  📄 Contract Issues:
          - Verify contract addresses are correct
          - Check if contracts are deployed on the target network
          - Verify contract ABIs match deployed contracts`)
      }

      // Reset running state
      this.isRunning = false
      
      // Log comprehensive debug information
      await this.logStartupFailure(startupError)
      
      // Re-throw with enhanced error information
      const enhancedError = new Error(
        `Event listener startup failed: ${startupError.message}. ` +
        `${errors.length} errors encountered. Check logs for details.`
      )
      ;(enhancedError as any).originalError = startupError
      ;(enhancedError as any).startupErrors = errors
      ;(enhancedError as any).duration = duration
      
      throw enhancedError
    }
  }

  /**
   * Stop the event listener
   */
  async stop(): Promise<void> {
    console.log('Stopping event listener...')
    this.isRunning = false

    // Clear reconnection timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }

    // Clear health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
    }

    // Remove all event listeners
    for (const contract of this.contracts.values()) {
      contract.removeAllListeners()
    }

    for (const contract of this.wsContracts.values()) {
      contract.removeAllListeners()
    }

    // Close WebSocket provider
    if (this.wsProvider) {
      await this.wsProvider.destroy()
    }

    // Close WebSocket clients
    for (const ws of this.webSocketClients) {
      ws.close()
    }

    console.log('✅ Event listener stopped')
  }

  /**
   * Initialize contract instances
   */
  private async initializeContracts(): Promise<void> {
    console.log('Initializing contracts...')

    for (const contractConfig of this.config.contracts) {
      // Create contract instance for HTTP provider
      const contract = new ethers.Contract(
        contractConfig.address,
        this.getAbiForType(contractConfig.type),
        this.provider
      )
      this.contracts.set(contractConfig.address, contract)

      // Create contract instance for WebSocket provider if available
      if (this.wsProvider) {
        const wsContract = new ethers.Contract(
          contractConfig.address,
          this.getAbiForType(contractConfig.type),
          this.wsProvider
        )
        this.wsContracts.set(contractConfig.address, wsContract)
      }

      console.log(`✅ Initialized ${contractConfig.name} at ${contractConfig.address}`)
    }
  }

  /**
   * Get ABI for contract type
   */
  private getAbiForType(type: string): string[] {
    switch (type) {
      case 'vAMM':
        return VAMM_ABI
      case 'Vault':
        return VAULT_ABI
      case 'Factory':
        return FACTORY_ABI
      case 'Oracle':
        return ORACLE_ABI
      case 'Token':
        return TOKEN_ABI
      default:
        throw new Error(`Unknown contract type: ${type}`)
    }
  }

  /**
   * Sync historical events
   */
  private async syncHistoricalEvents(): Promise<void> {
    console.log('Syncing historical events...')

    const currentBlock = await this.provider.getBlockNumber()
    console.log(`Current block: ${currentBlock}`)

    for (const contractConfig of this.config.contracts) {
      try {
        const lastProcessedBlock = await this.database.getLastProcessedBlock(contractConfig.address)
        const startBlock = Math.max(
          lastProcessedBlock + 1,
          contractConfig.startBlock || currentBlock - 10000 // Default to last 10k blocks
        )

        if (startBlock > currentBlock) {
          console.log(`✅ ${contractConfig.name} is up to date`)
          continue
        }

        console.log(`📡 Syncing ${contractConfig.name} from block ${startBlock} to ${currentBlock}`)

        const contract = this.contracts.get(contractConfig.address)!
        await this.syncContractEvents(contract, contractConfig, startBlock, currentBlock)

        await this.database.updateLastProcessedBlock(contractConfig.address, currentBlock)
        console.log(`✅ ${contractConfig.name} synced successfully`)
      } catch (error) {
        console.error(`❌ Failed to sync ${contractConfig.name}:`, error)
      }
    }
  }

  /**
   * Sync events for a specific contract
   */
  private async syncContractEvents(
    contract: ethers.Contract,
    config: ContractConfig,
    fromBlock: number,
    toBlock: number
  ): Promise<void> {
    const batchSize = this.config.batchSize
    const abi = this.getAbiForType(config.type)

    for (let start = fromBlock; start <= toBlock; start += batchSize) {
      const end = Math.min(start + batchSize - 1, toBlock)

      try {
        // Get all events for this batch
        const filter = {
          address: config.address,
          fromBlock: start,
          toBlock: end
        }

        const logs = await this.provider.getLogs(filter)
        
        for (const log of logs) {
          try {
            const parsedLog = contract.interface.parseLog({
              topics: log.topics,
              data: log.data
            })

            if (parsedLog) {
              const event = await this.formatEvent(parsedLog, log, config)
              if (event) {
                await this.database.storeEvent(event)
              }
            }
          } catch (parseError) {
            console.error('Failed to parse log:', parseError)
          }
        }

        console.log(`  Processed blocks ${start}-${end} (${logs.length} events)`)
      } catch (error) {
        console.error(`Failed to process blocks ${start}-${end}:`, error)
        // Continue with next batch
      }
    }
  }

  /**
   * Start real-time event listening
   */
  private async startRealtimeListening(): Promise<void> {
    console.log('Setting up real-time event listeners...')

    // Use WebSocket provider if available, otherwise use HTTP with polling
    const contractsToUse = this.wsProvider ? this.wsContracts : this.contracts

    for (const [address, contract] of contractsToUse) {
      const contractConfig = this.config.contracts.find(c => c.address === address)!
      
      // Set up listeners for all events
      const abi = this.getAbiForType(contractConfig.type)
      
      console.log(`📡 Setting up ${abi.length} event listeners for ${contractConfig.name}...`)
      
      for (const eventSig of abi) {
        try {
          const eventFragment = ethers.Fragment.from(eventSig)
          if (eventFragment.type === 'event') {
            const eventName = (eventFragment as ethers.EventFragment).name
            contract.on(eventName, async (...args) => {
              try {
                // Check if we have any arguments
                if (!args || !Array.isArray(args) || args.length === 0) {
                  console.warn('No arguments received in event callback')
                  return
                }

                // In ethers v6, the event callback receives a ContractEventPayload
                // The structure is: (...eventArgs, eventPayload)
                const eventPayload = args[args.length - 1]
                
                // Validate event payload structure
                if (!eventPayload || typeof eventPayload !== 'object') {
                  console.warn('Invalid event payload structure:', eventPayload)
                  return
                }

                // Extract the actual log from the payload
                const eventLog = eventPayload.log || eventPayload
                
                // Validate event log structure before parsing
                if (!eventLog || typeof eventLog !== 'object') {
                  console.warn('Invalid event log structure:', eventLog)
                  return
                }
                
                if (!eventLog.topics || !Array.isArray(eventLog.topics) || eventLog.topics.length === 0) {
                  console.warn('Invalid or missing topics in event log. Payload structure:', {
                    hasLog: !!eventPayload.log,
                    logType: typeof eventLog,
                    hasTopics: !!eventLog.topics,
                    topicsType: typeof eventLog.topics,
                    topicsIsArray: Array.isArray(eventLog.topics),
                    eventName: eventPayload.fragment?.name || 'unknown',
                    contractAddress: eventLog.address || eventPayload.emitter?.target
                  })
                  return
                }
                
                if (!eventLog.data || typeof eventLog.data !== 'string') {
                  console.warn('Invalid or missing data in event log:', eventLog)
                  return
                }
                
                // Additional validation for required fields
                if (!eventLog.transactionHash || !eventLog.blockNumber) {
                  console.warn('Missing required fields in event log:', {
                    hasTransactionHash: !!eventLog.transactionHash,
                    hasBlockNumber: !!eventLog.blockNumber,
                    logIndex: eventLog.logIndex
                  })
                  return
                }

                // Ensure logIndex is properly extracted (ethers v6 uses .index property)
                if (eventLog.logIndex === null || eventLog.logIndex === undefined) {
                  // Try to get from .index property (ethers v6)
                  if (eventLog.index !== undefined && eventLog.index !== null) {
                    eventLog.logIndex = eventLog.index;
                    console.log('Fixed logIndex from .index property:', eventLog.logIndex);
                  } else {
                    console.error('❌ Critical: Log index is missing from event log! This will cause storage conflicts.');
                    console.error('Event log structure:', {
                      hasLogIndex: eventLog.logIndex !== undefined,
                      hasIndex: eventLog.index !== undefined,
                      transactionHash: eventLog.transactionHash,
                      blockNumber: eventLog.blockNumber,
                      address: eventLog.address
                    });
                    return; // Skip this event instead of using 0
                  }
                }

                // For ethers v6 ContractEventPayload, we can use the pre-parsed event data
                if (eventPayload.fragment && eventPayload.args) {
                  console.log(`📡 Processing ${eventPayload.fragment.name} event from ${eventLog.address}`)
                  
                  // Create event directly from the ContractEventPayload
                  const event = await this.formatEventFromPayload(eventPayload, eventLog, contractConfig)
                  if (event) {
                    await this.database.storeEvent(event)
                    await this.broadcastEvent(event)
                    console.log(`📡 New ${event.eventType} event: ${event.transactionHash}`)
                  } else {
                    console.log(`📡 Event ${eventPayload.fragment.name} was not handled by formatEventFromPayload, trying fallback parser`)
                    
                    // Try fallback parsing if formatEventFromPayload returned null
                    const parsedLog = contract.interface.parseLog({
                      topics: eventLog.topics,
                      data: eventLog.data
                    })

                    if (parsedLog) {
                      const fallbackEvent = await this.formatEvent(parsedLog, eventLog, contractConfig)
                      if (fallbackEvent) {
                        await this.database.storeEvent(fallbackEvent)
                        await this.broadcastEvent(fallbackEvent)
                        console.log(`📡 New ${fallbackEvent.eventType} event (fallback): ${fallbackEvent.transactionHash}`)
                      }
                    } else {
                      console.warn('Failed to parse event log in fallback:', eventLog)
                    }
                  }
                } else {
                  // Fallback to manual parsing if payload structure is unexpected
                  console.log(`📡 Event payload missing fragment or args, using fallback parser`)
                  
                  const parsedLog = contract.interface.parseLog({
                    topics: eventLog.topics,
                    data: eventLog.data
                  })

                  if (parsedLog) {
                    const event = await this.formatEvent(parsedLog, eventLog, contractConfig)
                    if (event) {
                      await this.database.storeEvent(event)
                      await this.broadcastEvent(event)
                      console.log(`📡 New ${event.eventType} event: ${event.transactionHash}`)
                    }
                  } else {
                    console.warn('Failed to parse event log:', eventLog)
                  }
                }
              } catch (error) {
                console.error('Error processing real-time event:', error)
                console.error('Event args length:', args?.length || 0)
                
                // Log more details for debugging
                if (args && Array.isArray(args) && args.length > 0) {
                  const eventPayload = args[args.length - 1]
                  console.error('Event payload details:', {
                    type: typeof eventPayload,
                    hasLog: eventPayload?.log !== undefined,
                    hasFragment: eventPayload?.fragment !== undefined,
                    hasArgs: eventPayload?.args !== undefined,
                    fragmentName: eventPayload?.fragment?.name,
                    contractAddress: eventPayload?.log?.address || eventPayload?.emitter?.target,
                    logIndex: eventPayload?.log?.logIndex,
                    transactionHash: eventPayload?.log?.transactionHash
                  })
                  
                  // Also log the raw args structure
                  console.error('Raw args structure:', JSON.stringify(args, (_,_v)=> (typeof _v === 'bigint' ? _v.toString() : _v), 2))
                } else {
                  console.error('Args is not an array or is empty:', args)
                }
              }
            })
            
            console.log(`✅ Listening for ${eventName} events on ${contractConfig.name}`)
          }
        } catch (error) {
          console.error(`Failed to set up listener for ${eventSig}:`, error)
        }
      }

      console.log(`✅ Real-time listeners set up for ${contractConfig.name}`)
    }

    // Start periodic block monitoring for backup event detection
    this.startBlockMonitoring()
  }

  /**
   * Start periodic block monitoring as backup for event detection
   */
  private startBlockMonitoring(): void {
    console.log('🔄 Starting periodic block monitoring...')
    
    setInterval(async () => {
      if (!this.isRunning) return
      
      try {
        const currentBlock = await this.provider.getBlockNumber()
        console.log(`⏰ Current block: ${currentBlock}`)
        
        // Check for new events in the last few blocks
        for (const contractConfig of this.config.contracts) {
          const lastProcessedBlock = await this.database.getLastProcessedBlock(contractConfig.address)
          const fromBlock = Math.max(lastProcessedBlock + 1, currentBlock - 5) // Check last 5 blocks
          
          if (fromBlock <= currentBlock) {
            const contract = this.contracts.get(contractConfig.address)!
            await this.syncContractEvents(contract, contractConfig, fromBlock, currentBlock)
            await this.database.updateLastProcessedBlock(contractConfig.address, currentBlock)
          }
        }
      } catch (error) {
        console.error('Block monitoring error:', error)
      }
    }, 30000) // Check every 30 seconds
  }

  /**
   * Format event for storage
   */
  private async formatEvent(
    parsedLog: ethers.LogDescription,
    log: any,
    config: ContractConfig
  ): Promise<SmartContractEvent | null> {
    try {
      const block = await this.provider.getBlock(log.blockNumber)
      if (!block) return null

      const network = await this.provider.getNetwork()
      const chainId = Number(network.chainId) // Convert bigint to number

      // Properly extract logIndex for ethers v6 compatibility
      let logIndex = log.logIndex;
      if (logIndex === null || logIndex === undefined) {
        logIndex = log.index; // ethers v6 uses .index instead of .logIndex
      }
      
      if (logIndex === null || logIndex === undefined) {
        console.error('❌ Critical: No valid logIndex found for event in formatEvent:', {
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
          hasLogIndex: log.logIndex !== undefined,
          hasIndex: log.index !== undefined,
          parsedLogName: parsedLog.name,
          logStructure: Object.keys(log)
        });
        return null; // Skip this event instead of using 0
      }

      const baseEvent = {
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        logIndex: logIndex,
        contractAddress: config.address,
        timestamp: new Date(block.timestamp * 1000),
        chainId
      }

      // ========================================
      // TEMPORARY FILTER: Only process position-related events
      // TODO: Remove this filter once race condition issues are resolved
      // WARNING: This limits event processing to only critical position events
      // ========================================
      
      // Format event based on type - ONLY allow specific event types
      switch (parsedLog.name) {
        case 'PositionOpened':
          return {
            ...baseEvent,
            eventType: 'PositionOpened',
            user: parsedLog.args.user,
            isLong: parsedLog.args.isLong,
            size: parsedLog.args.size?.toString(),
            price: parsedLog.args.price?.toString(),
            leverage: parsedLog.args.leverage?.toString(),
            fee: parsedLog.args.fee?.toString()
          }

        case 'PositionClosed':
          return {
            ...baseEvent,
            eventType: 'PositionClosed',
            user: parsedLog.args.user,
            size: parsedLog.args.size?.toString(),
            price: parsedLog.args.price?.toString(),
            pnl: parsedLog.args.pnl?.toString(),
            fee: parsedLog.args.fee?.toString()
          }

        case 'PositionLiquidated':
          return {
            ...baseEvent,
            eventType: 'PositionLiquidated',
            user: parsedLog.args.user,
            liquidator: parsedLog.args.liquidator,
            size: parsedLog.args.size?.toString(),
            price: parsedLog.args.price?.toString(),
            fee: parsedLog.args.fee?.toString()
          }

        // ========================================
        // FILTERED OUT: All other event types are ignored
        // ========================================
        case 'CollateralDeposited':
        case 'MarketCreated':
        case 'MarginReserved':
        case 'TradingFeeCollected':
        case 'CollateralWithdrawn':
        case 'MarginReleased':
        case 'PnLUpdated':
        case 'FundingApplied':
        case 'UserLiquidated':
        case 'FundingUpdated':
        case 'FundingPaid':
        case 'AuthorizedAdded':
        case 'AuthorizedRemoved':
        case 'Paused':
        case 'Unpaused':
        case 'Transfer':
        case 'Approval':
        case 'Mint':
        case 'PriceUpdated':
        case 'OracleStatusChanged':
        case 'MaxPriceAgeUpdated':
        case 'MarketStatusChanged':
        case 'DeploymentFeeUpdated':
        case 'OwnershipTransferred':
        case 'VammUpdated':
        case 'ParametersUpdated':
          console.log(`⏭️  Filtering out event type: ${parsedLog.name} (not in allowed list: PositionOpened, PositionClosed, PositionLiquidated)`)
          return null
        
        default:
          console.log(`❓ Unknown event type: ${parsedLog.name} (filtered out)`)
          return null
      }
    } catch (error) {
      console.error('Error formatting event:', error)
      return null
    }
  }

  /**
   * Format event for storage from a ContractEventPayload
   */
  private async formatEventFromPayload(
    eventPayload: any, // ContractEventPayload type may not be available
    log: any,
    config: ContractConfig
  ): Promise<SmartContractEvent | null> {
    try {
      const block = await this.provider.getBlock(log.blockNumber)
      if (!block) return null

      const network = await this.provider.getNetwork()
      const chainId = Number(network.chainId) // Convert bigint to number

      // Properly extract logIndex for ethers v6 compatibility
      let logIndex = log.logIndex;
      if (logIndex === null || logIndex === undefined) {
        logIndex = log.index; // ethers v6 uses .index instead of .logIndex
      }
      
      if (logIndex === null || logIndex === undefined) {
        console.error('❌ Critical: No valid logIndex found for event in formatEventFromPayload:', {
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
          hasLogIndex: log.logIndex !== undefined,
          hasIndex: log.index !== undefined,
          payloadFragment: eventPayload?.fragment?.name,
          logStructure: Object.keys(log)
        });
        return null; // Skip this event instead of using 0
      }

      const baseEvent = {
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        logIndex: logIndex,
        contractAddress: config.address,
        timestamp: new Date(block.timestamp * 1000),
        chainId
      }

      // ========================================
      // TEMPORARY FILTER: Only process position-related events
      // TODO: Remove this filter once race condition issues are resolved
      // WARNING: This limits event processing to only critical position events
      // ========================================
      
      // Format event based on type - ONLY allow specific event types
      switch (eventPayload.fragment.name) {
        case 'PositionOpened':
          return {
            ...baseEvent,
            eventType: 'PositionOpened',
            user: eventPayload.args.user,
            isLong: eventPayload.args.isLong,
            size: eventPayload.args.size?.toString(),
            price: eventPayload.args.price?.toString(),
            leverage: eventPayload.args.leverage?.toString(),
            fee: eventPayload.args.fee?.toString()
          }

        case 'PositionClosed':
          return {
            ...baseEvent,
            eventType: 'PositionClosed',
            user: eventPayload.args.user,
            size: eventPayload.args.size?.toString(),
            price: eventPayload.args.price?.toString(),
            pnl: eventPayload.args.pnl?.toString(),
            fee: eventPayload.args.fee?.toString()
          }

        case 'PositionLiquidated':
          return {
            ...baseEvent,
            eventType: 'PositionLiquidated',
            user: eventPayload.args.user,
            liquidator: eventPayload.args.liquidator,
            size: eventPayload.args.size?.toString(),
            price: eventPayload.args.price?.toString(),
            fee: eventPayload.args.fee?.toString()
          }

        // ========================================
        // FILTERED OUT: All other event types are ignored
        // ========================================
        case 'CollateralDeposited':
        case 'MarketCreated':
        case 'MarginReserved':
        case 'TradingFeeCollected':
        case 'CollateralWithdrawn':
        case 'MarginReleased':
        case 'PnLUpdated':
        case 'FundingApplied':
        case 'UserLiquidated':
        case 'FundingUpdated':
        case 'FundingPaid':
        case 'AuthorizedAdded':
        case 'AuthorizedRemoved':
        case 'Paused':
        case 'Unpaused':
        case 'Transfer':
        case 'Approval':
        case 'Mint':
        case 'PriceUpdated':
        case 'OracleStatusChanged':
        case 'MaxPriceAgeUpdated':
        case 'MarketStatusChanged':
        case 'DeploymentFeeUpdated':
        case 'OwnershipTransferred':
        case 'VammUpdated':
        case 'ParametersUpdated':
          console.log(`⏭️  Filtering out event type: ${eventPayload.fragment.name} (not in allowed list: PositionOpened, PositionClosed, PositionLiquidated)`)
          return null
        
        default:
          console.log(`❓ Unknown event type: ${eventPayload.fragment.name} (filtered out)`)
          return null
      }
    } catch (error) {
      console.error('Error formatting event from payload:', error)
      return null
    }
  }

  /**
   * Broadcast event to WebSocket clients
   */
  private async broadcastEvent(event: SmartContractEvent): Promise<void> {
    const eventData: RealtimeEventData = { event }
    const message = JSON.stringify(eventData)

    for (const ws of this.webSocketClients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(message)
        } catch (error) {
          console.error('Error sending WebSocket message:', error)
          this.webSocketClients.delete(ws)
        }
      } else {
        this.webSocketClients.delete(ws)
      }
    }
  }

  /**
   * Add WebSocket client for real-time updates
   */
  addWebSocketClient(ws: WebSocket): void {
    this.webSocketClients.add(ws)
    
    ws.on('close', () => {
      this.webSocketClients.delete(ws)
    })

    ws.on('error', (error) => {
      console.error('WebSocket error:', error)
      this.webSocketClients.delete(ws)
    })
  }

  /**
   * Setup WebSocket reconnection logic
   */
  private setupWebSocketReconnection(): void {
    if (!this.wsProvider) return

    // Handle provider errors
    this.wsProvider.on('error', (error) => {
      console.error('WebSocket provider error:', error)
      this.scheduleReconnection()
    })

    // In ethers.js v6, we need to handle WebSocket disconnection differently
    // We'll use the provider's internal WebSocket connection events
    try {
      // Try to access the underlying WebSocket connection
      const provider = this.wsProvider as any
      
      // Check if we can access the internal WebSocket connection
      if (provider._websocket) {
        provider._websocket.on('close', () => {
          console.log('WebSocket connection closed')
          this.scheduleReconnection()
        })
      } else if (provider.websocket) {
        provider.websocket.on('close', () => {
          console.log('WebSocket connection closed')
          this.scheduleReconnection()
        })
      }
    } catch (error) {
      console.warn('Could not setup WebSocket close handler:', error)
      
      // Fallback: Monitor for network errors which may indicate disconnection
      this.wsProvider.on('network', (network, oldNetwork) => {
        if (oldNetwork && !network) {
          console.log('Network disconnected, scheduling reconnection')
          this.scheduleReconnection()
        }
      })
    }

    // Additional health check mechanism
    this.startHealthCheck()
  }

  /**
   * Start periodic health checks to detect disconnections
   */
  private startHealthCheck(): void {
    console.log('🏥 Starting health check...')
    
    // Clear existing health check if any
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
    }

    this.healthCheckInterval = setInterval(async () => {
      if (!this.isRunning) {
        if (this.healthCheckInterval) {
          clearInterval(this.healthCheckInterval)
          this.healthCheckInterval = undefined
        }
        return
      }

      try {
        // Test HTTP provider health
        const blockNumber = await this.provider.getBlockNumber()
        console.log(`🏥 Health check - HTTP provider OK (block: ${blockNumber})`)
        
        // Test WebSocket provider health if available
        if (this.wsProvider) {
          const wsBlockNumber = await this.wsProvider.getBlockNumber()
          console.log(`🏥 Health check - WebSocket provider OK (block: ${wsBlockNumber})`)
        }
        
        // Test database connection
        const latestBlock = await this.database.getLatestBlockNumber()
        console.log(`🏥 Health check - Database OK (latest event block: ${latestBlock})`)
        
        // Update last health check time
        this.lastHealthCheck = new Date()
        
      } catch (error) {
        console.error('🏥 Health check failed:', error)
        
        // Add to startup errors for tracking
        this.startupErrors.push({
          timestamp: new Date(),
          error: `Health check failed: ${(error as Error).message}`
        })
        
        // Attempt to restart if health check fails
        if (error instanceof Error && error.message.includes('WebSocket')) {
          console.log('🔄 Attempting WebSocket reconnection...')
          this.scheduleReconnection()
        }
      }
    }, 60000) // Check every minute
  }

  /**
   * Schedule WebSocket reconnection
   */
  private scheduleReconnection(): void {
    if (!this.isRunning) return

    console.log(`Scheduling WebSocket reconnection in ${this.config.retryDelay}ms`)
    
    this.reconnectTimeout = setTimeout(async () => {
      try {
        console.log('Attempting WebSocket reconnection...')
        
        if (this.wsProvider) {
          await this.wsProvider.destroy()
        }

        this.wsProvider = new ethers.WebSocketProvider(this.config.wsRpcUrl!)
        this.setupWebSocketReconnection()

        // Reinitialize WebSocket contracts
        this.wsContracts.clear()
        for (const contractConfig of this.config.contracts) {
          const wsContract = new ethers.Contract(
            contractConfig.address,
            this.getAbiForType(contractConfig.type),
            this.wsProvider
          )
          this.wsContracts.set(contractConfig.address, wsContract)
        }

        // Restart real-time listening
        await this.startRealtimeListening()
        
        console.log('✅ WebSocket reconnected successfully')
      } catch (error) {
        console.error('❌ WebSocket reconnection failed:', error)
        this.scheduleReconnection()
      }
    }, this.config.retryDelay)
  }

  /**
   * Get the current status of the event listener
   */
  getStatus(): {
    isRunning: boolean
    contractsCount: number
    hasWebSocket: boolean
    hasHealthCheck: boolean
    uptime: number
    lastHealthCheck?: Date
    errors: Array<{ timestamp: Date; error: string }>
  } {
    return {
      isRunning: this.isRunning,
      contractsCount: this.config.contracts.length,
      hasWebSocket: !!this.wsProvider,
      hasHealthCheck: !!this.healthCheckInterval,
      uptime: this.isRunning ? Date.now() - (this.startTime || Date.now()) : 0,
      lastHealthCheck: this.lastHealthCheck,
      errors: this.startupErrors
    }
  }

  /**
   * Test if the event listener can connect to all required services
   */
  async testConnectivity(): Promise<{
    http: { success: boolean; error?: string; blockNumber?: number }
    websocket: { success: boolean; error?: string; blockNumber?: number }
    database: { success: boolean; error?: string; latestBlock?: number }
    contracts: { success: boolean; error?: string; validContracts?: number }
  }> {
    const results: {
      http: { success: boolean; error?: string; blockNumber?: number }
      websocket: { success: boolean; error?: string; blockNumber?: number }
      database: { success: boolean; error?: string; latestBlock?: number }
      contracts: { success: boolean; error?: string; validContracts?: number }
    } = {
      http: { success: false },
      websocket: { success: false },
      database: { success: false },
      contracts: { success: false }
    }

    // Test HTTP provider
    try {
      const blockNumber = await this.provider.getBlockNumber()
      results.http = { success: true, blockNumber }
    } catch (error) {
      results.http = { success: false, error: (error as Error).message }
    }

    // Test WebSocket provider
    if (this.wsProvider) {
      try {
        const blockNumber = await this.wsProvider.getBlockNumber()
        results.websocket = { success: true, blockNumber }
      } catch (error) {
        results.websocket = { success: false, error: (error as Error).message }
      }
    } else {
      results.websocket = { success: false, error: 'WebSocket not configured' }
    }

    // Test database
    try {
      const latestBlock = await this.database.getLatestBlockNumber()
      results.database = { success: true, latestBlock }
    } catch (error) {
      results.database = { success: false, error: (error as Error).message }
    }

    // Test contracts
    try {
      let validContracts = 0
      for (const contract of this.config.contracts) {
        if (ethers.isAddress(contract.address)) {
          validContracts++
        }
      }
      results.contracts = { success: true, validContracts }
    } catch (error) {
      results.contracts = { success: false, error: (error as Error).message }
    }

    return results
  }

  /**
   * Get diagnostic information for troubleshooting
   */
  getDiagnostics(): {
    config: any
    status: any
    networkInfo?: any
    errors: Array<{ timestamp: Date; error: string }>
  } {
    const diagnostics = {
      config: {
        rpcUrl: this.config.rpcUrl,
        wsRpcUrl: this.config.wsRpcUrl,
        contractsCount: this.config.contracts.length,
        batchSize: this.config.batchSize,
        retryAttempts: this.config.retryAttempts,
        retryDelay: this.config.retryDelay
      },
      status: this.getStatus(),
      errors: this.startupErrors
    }

    return diagnostics
  }

  /**
   * Generate a comprehensive debug report
   */
  async generateDebugReport(): Promise<string> {
    const status = this.getStatus()
    const connectivity = await this.testConnectivity()
    const diagnostics = this.getDiagnostics()
    
    const report = `
=== Smart Contract Event Listener Debug Report ===
Generated: ${new Date().toISOString()}

📊 Current Status:
- Running: ${status.isRunning}
- Uptime: ${status.uptime}ms
- Contracts: ${status.contractsCount}
- WebSocket: ${status.hasWebSocket}
- Health Check: ${status.hasHealthCheck}
- Last Health Check: ${status.lastHealthCheck?.toISOString() || 'Never'}

🔗 Connectivity Tests:
- HTTP Provider: ${connectivity.http.success ? '✅' : '❌'} ${connectivity.http.error || `(Block: ${connectivity.http.blockNumber})`}
- WebSocket Provider: ${connectivity.websocket.success ? '✅' : '❌'} ${connectivity.websocket.error || `(Block: ${connectivity.websocket.blockNumber})`}
- Database: ${connectivity.database.success ? '✅' : '❌'} ${connectivity.database.error || `(Latest Block: ${connectivity.database.latestBlock})`}
- Contracts: ${connectivity.contracts.success ? '✅' : '❌'} ${connectivity.contracts.error || `(Valid: ${connectivity.contracts.validContracts})`}

⚙️ Configuration:
- RPC URL: ${diagnostics.config.rpcUrl}
- WebSocket URL: ${diagnostics.config.wsRpcUrl || 'Not configured'}
- Batch Size: ${diagnostics.config.batchSize}
- Retry Attempts: ${diagnostics.config.retryAttempts}
- Retry Delay: ${diagnostics.config.retryDelay}ms

❌ Recent Errors (${status.errors.length}):
${status.errors.slice(-5).map(e => `- ${e.timestamp.toISOString()}: ${e.error}`).join('\n')}

🔧 Contracts Configuration:
${this.config.contracts.length === 0 ? 'No contracts configured' : 
  this.config.contracts.map(c => `- ${c.name} (${c.type}): ${c.address}`).join('\n')}

💡 Troubleshooting Tips:
${!connectivity.http.success ? '- Check your RPC endpoint connectivity\n' : ''}${!connectivity.websocket.success ? '- Verify WebSocket RPC endpoint or disable WebSocket\n' : ''}${!connectivity.database.success ? '- Check Supabase connection and database migrations\n' : ''}${!connectivity.contracts.success ? '- Verify contract addresses and deployment status\n' : ''}
=== End Debug Report ===
`
    return report
  }

  /**
   * Log debug information if event listener fails to start
   */
  async logStartupFailure(error: Error): Promise<void> {
    console.error('\n🚨 EVENT LISTENER STARTUP FAILURE 🚨')
    console.error('❌ The event listener failed to start. Here\'s the debug information:')
    console.error(await this.generateDebugReport())
    console.error('💡 To manually test connectivity, call: eventListener.testConnectivity()')
    console.error('💡 To get status info, call: eventListener.getStatus()')
  }

  // Add private properties to track state
  private startTime?: number
  private lastHealthCheck?: Date
  private startupErrors: Array<{ timestamp: Date; error: string }> = []
}
console.log('env.RPC_URL', env.RPC_URL)
console.log('env.WS_RPC_URL', env.WS_RPC_URL)
// Configuration for the event listener
const DEFAULT_CONFIG: EventListenerConfig = {
  rpcUrl: env.RPC_URL,
  wsRpcUrl: env.WS_RPC_URL,
  contracts: [], // Will be populated dynamically from database
      batchSize: 400,
  confirmations: 1,
  retryAttempts: 3,
  retryDelay: 5000
}

// Singleton instance
let eventListener: SmartContractEventListener | null = null

export async function getEventListener(): Promise<SmartContractEventListener> {
  if (!eventListener) {
    try {
      // Dynamically load VAMM contracts from database
      const database = new EventDatabase()
      const vammContracts = await database.getDeployedVAMMContracts()
      
      const config = {
        ...DEFAULT_CONFIG,
        contracts: vammContracts
      }
      
      console.log('🔧 Initializing event listener with contracts:', vammContracts.map(c => c.name))
      
      if (vammContracts.length === 0) {
        console.log('⚠️ No VAMM contracts found in database. Event listener will run but not monitor any contracts.')
        console.log('💡 Deploy contracts via the create-market wizard to enable event monitoring.')
      }
      
      eventListener = new SmartContractEventListener(config)
    } catch (error) {
      console.error('❌ Failed to initialize event listener:', error)
      // Fallback to default configuration
      console.log('🔄 Falling back to default configuration')
      eventListener = new SmartContractEventListener(DEFAULT_CONFIG)
    }
  }
  return eventListener
}

export function getEventListenerSync(): SmartContractEventListener {
  if (!eventListener) {
    // Fallback to empty config if called synchronously
    eventListener = new SmartContractEventListener(DEFAULT_CONFIG)
  }
  return eventListener
}

// Start the event listener if this file is run directly
if (require.main === module) {
  (async () => {
    try {
      const listener = await getEventListener()
      
      await listener.start()
      console.log('✅ Event listener started successfully')

      // Graceful shutdown
      process.on('SIGINT', async () => {
        console.log('Received SIGINT, shutting down gracefully...')
        await listener.stop()
        process.exit(0)
      })

      process.on('SIGTERM', async () => {
        console.log('Received SIGTERM, shutting down gracefully...')
        await listener.stop()
        process.exit(0)
      })
    } catch (error) {
      console.error('Failed to start event listener:', error)
      process.exit(1)
    }
  })()
} 