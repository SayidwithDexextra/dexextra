/**
 * Scalable Event Monitor Service
 * 
 * Processes blockchain events by EVENT SIGNATURES rather than contract addresses.
 * This approach scales to thousands/millions of dynamically created contracts.
 * 
 * Key Benefits:
 * - Single webhook monitors ALL contracts
 * - No address limits (Alchemy limit ~1000 addresses per webhook)
 * - Automatic monitoring of new deployments
 * - Event processing and contract registration
 */

import { decodeEventLog } from 'viem'
import { EventDatabase } from '@/lib/eventDatabase'
import { env } from '@/lib/env'
import { EVENT_SIGNATURES, getContractAddress, getPreferredSystem, isDexV2Enabled } from '@/lib/contracts';

// Contract type detection patterns (first 4 bytes of contract code)
export const CONTRACT_PATTERNS = {
  VAMM_BYTECODE_PREFIX: '0x608060405234',
  VAULT_BYTECODE_PREFIX: '0x608060405235',
  FACTORY_BYTECODE_PREFIX: '0x608060405236'
}

export interface ScalableMonitorConfig {
  factoryAddress: string
  network: string
  monitoredEvents: string[]
}

export class ScalableEventMonitor {
  private database: EventDatabase
  private config: ScalableMonitorConfig
  private isInitialized = false

  constructor(config: Partial<ScalableMonitorConfig> = {}) {
    const network = config.network || 'polygon'
    const preferredSystem = getPreferredSystem(network)
    const isDexV2 = preferredSystem === 'v2'
    
    // Get appropriate factory address based on system version
    const factoryAddress = isDexV2 
      ? getContractAddress(network, 'DEXV2_FACTORY')
      : getContractAddress(network, 'SIMPLE_VAMM')
    
    // Configure monitored events based on system version
    const defaultEvents = isDexV2 ? [
      'MetricPositionOpened',
      'MetricPositionClosed', 
      'LimitOrderCreated',
      'LimitOrderExecuted',
      'CollateralDeposited',
      'CollateralWithdrawn',
      'MetricVAMMDeployed'
    ] : [
      'PositionOpened',
      'PositionClosed',
      'PriceUpdated',
      'CollateralDeposited',
      'CollateralWithdrawn'
    ]

    this.config = {
      factoryAddress: config.factoryAddress || factoryAddress,
      network,
      monitoredEvents: config.monitoredEvents || defaultEvents
    }
    
    this.database = new EventDatabase()
    this.isInitialized = true
    
     console.log('🚀 Scalable Event Monitor initialized for event processing')
     console.log(`📊 Monitoring ${this.config.monitoredEvents.length} event types:`)
    this.config.monitoredEvents.forEach(eventName => {
       console.log(`   • ${eventName}`)
    })
  }

  /**
   * Process incoming webhook events
   * Automatically handles events from ANY contract that emits monitored signatures
   */
  async processWebhookEvent(webhookData: any): Promise<{
    processed: number
    newContracts: number
    events: any[]
  }> {
    try {
       console.log('📨 Processing scalable webhook event...')
      
      const logs = webhookData.event?.data?.block?.logs || []
       console.log(`📊 Received ${logs.length} event logs`)
      
      let processedEvents = 0
      let newContractsDetected = 0
      const processedEventsList = []
      
      for (const log of logs) {
        try {
          // Identify event type by signature
          const eventSignature = log.topics[0]
          const eventType = this.getEventTypeFromSignature(eventSignature)
          
          if (!eventType) {
             console.log(`⚠️ Unknown event signature: ${eventSignature}`)
            continue
          }
          
          // Only process events that are in our monitored list
          if (!this.config.monitoredEvents.includes(eventType)) {
             console.log(`⏭️ Skipping non-monitored event type: ${eventType}`)
            continue
          }
          
           console.log(`🎯 Processing ${eventType} event from ${log.account.address}`)
          
          // Check if this is a new contract we haven't seen before
          const isNewContract = await this.checkAndRegisterNewContract(log.account.address)
          if (isNewContract) {
            newContractsDetected++
          }
          
          // Parse and store the event
          const parsedEvent = await this.parseEventBySignature(log, eventType)
          if (parsedEvent) {
            await this.database.storeEvent(parsedEvent)
            processedEventsList.push(parsedEvent)
            processedEvents++
          }
          
        } catch (error) {
          console.error('❌ Error processing log:', error)
        }
      }
      
       console.log(`✅ Processed ${processedEvents} events, detected ${newContractsDetected} new contracts`)
      
      return {
        processed: processedEvents,
        newContracts: newContractsDetected,
        events: processedEventsList
      }
      
    } catch (error) {
      console.error('❌ Failed to process webhook event:', error)
      throw error
    }
  }

  /**
   * Check if contract is new and register it
   */
  private async checkAndRegisterNewContract(contractAddress: string): Promise<boolean> {
    try {
      // Check if we've seen this contract before
      const existingContract = await this.database.getContractByAddress(contractAddress)
      if (existingContract) {
        return false // Not new
      }
      
      // New contract detected - determine its type and register
      const contractType = await this.detectContractType(contractAddress)
      
      await this.database.addContract({
        name: `Auto-detected ${contractType}`,
        address: contractAddress,
        type: contractType,
        network: this.config.network,
        isActive: true,
        description: `Automatically detected via event signature monitoring`
      })
      
       console.log(`🆕 Registered new ${contractType} contract: ${contractAddress}`)
      return true
      
    } catch (error) {
      console.error('❌ Failed to register new contract:', error)
      return false
    }
  }

  /**
   * Detect contract type by analyzing bytecode patterns
   */
  private async detectContractType(contractAddress: string): Promise<string> {
    try {
      // Use RPC to get contract code
      const response = await fetch(`https://polygon-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getCode',
          params: [contractAddress, 'latest'],
          id: 1
        })
      })
      
      const data: any = await response.json();
      const bytecode = typeof data === 'object' && data !== null && 'result' in data ? data.result : '';

      // Simple pattern matching (could be enhanced with more sophisticated detection)
      if (typeof bytecode === 'string' && bytecode.startsWith(CONTRACT_PATTERNS.VAMM_BYTECODE_PREFIX)) {
        return 'vAMM'
      } else if (bytecode.startsWith(CONTRACT_PATTERNS.VAULT_BYTECODE_PREFIX)) {
        return 'Vault'
      } else if (bytecode.startsWith(CONTRACT_PATTERNS.FACTORY_BYTECODE_PREFIX)) {
        return 'Factory'
      }
      
      // Fallback: use factory address to determine type
      if (contractAddress.toLowerCase() === this.config.factoryAddress.toLowerCase()) {
        return 'Factory'
      }
      
      return 'Unknown'
      
    } catch (error) {
      console.error('Failed to detect contract type:', error)
      return 'Unknown'
    }
  }

  /**
   * Get event type from signature hash
   */
  private getEventTypeFromSignature(signature: string): string | null {
    for (const [eventType, sig] of Object.entries(EVENT_SIGNATURES)) {
      if (sig === signature) {
        return eventType
      }
    }
    return null
  }

  /**
   * Parse event by signature and return formatted event
   */
  private async parseEventBySignature(log: any, eventType: string): Promise<any> {
    // Safely extract block number with null checking
    let blockNumber: number;
    if (typeof log.transaction?.blockNumber === 'string') {
      blockNumber = parseInt(log.transaction.blockNumber, 16);
    } else if (typeof log.transaction?.blockNumber === 'number') {
      blockNumber = log.transaction.blockNumber;
    } else {
      console.warn('⚠️ Block number is null/undefined in scalable event, using 0');
      blockNumber = 0;
    }

    // Safely extract block hash
    let blockHash: string;
    if (typeof log.transaction?.blockHash === 'string' && log.transaction.blockHash) {
      blockHash = log.transaction.blockHash;
    } else {
      console.warn('⚠️ Block hash is null/undefined in scalable event, using placeholder');
      blockHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
    }

    // Safely extract log index
    let logIndex: number;
    if (typeof log.index === 'string') {
      logIndex = parseInt(log.index, 16);
    } else if (typeof log.index === 'number') {
      logIndex = log.index;
    } else {
      logIndex = 0;
    }

     console.log(`📊 Scalable event parsed: ${eventType} at block ${blockNumber}, tx: ${log.transaction?.hash}:${logIndex}`);

    const baseEvent = {
      transactionHash: log.transaction?.hash || '',
      blockNumber: blockNumber,
      blockHash: blockHash,
      logIndex: logIndex,
      contractAddress: log.account?.address?.toLowerCase() || '',
      timestamp: new Date(),
      chainId: typeof env.CHAIN_ID === 'number' ? env.CHAIN_ID : parseInt(env.CHAIN_ID || '137'),
      eventType: eventType
    }
    
    // Parse event-specific data based on type
    switch (eventType) {
      case 'PositionOpened':
        return this.parsePositionOpenedEvent(log, baseEvent)
      case 'PositionClosed':
        return this.parsePositionClosedEvent(log, baseEvent)
      case 'PriceUpdated':
        return this.parsePriceUpdatedEvent(log, baseEvent)
      case 'CollateralDeposited':
        return this.parseCollateralDepositedEvent(log, baseEvent)
      case 'CollateralWithdrawn':
        return this.parseCollateralWithdrawnEvent(log, baseEvent)
      case 'MarginReserved':
        return this.parseMarginReservedEvent(log, baseEvent)
      case 'MarginReleased':
        return this.parseMarginReleasedEvent(log, baseEvent)
      case 'PnLUpdated':
        return this.parsePnLUpdatedEvent(log, baseEvent)
      case 'PositionIncreased':
        return this.parsePositionIncreasedEvent(log, baseEvent)
      case 'PositionLiquidated':
        return this.parsePositionLiquidatedEvent(log, baseEvent)
      case 'MarketCreated':
        return this.parseMarketCreatedEvent(log, baseEvent)
      default:
        return baseEvent
    }
  }

  /**
   * Parse PositionOpened event (SimpleVAMM signature)
   */
  private parsePositionOpenedEvent(log: any, baseEvent: any): any {
    try {
      const eventAbi = [
        {
          name: 'PositionOpened',
          type: 'event',
          inputs: [
            { name: 'user', type: 'address', indexed: true },
            { name: 'positionId', type: 'uint256', indexed: true },
            { name: 'isLong', type: 'bool', indexed: false },
            { name: 'size', type: 'uint256', indexed: false },
            { name: 'price', type: 'uint256', indexed: false },
            { name: 'leverage', type: 'uint256', indexed: false }
          ]
        }
      ] as const
      
      const parsed = decodeEventLog({
        abi: eventAbi,
        topics: log.topics,
        data: log.data
      })
      
      return {
        ...baseEvent,
        user: parsed.args.user,
        positionId: parsed.args.positionId?.toString(),
        isLong: parsed.args.isLong,
        size: parsed.args.size?.toString(),
        price: parsed.args.price?.toString(),
        leverage: parsed.args.leverage?.toString()
      }
    } catch (error) {
      console.error('Failed to parse PositionOpened event:', error)
      return baseEvent
    }
  }

  /**
   * Parse PositionClosed event (SimpleVAMM signature)
   */
  private parsePositionClosedEvent(log: any, baseEvent: any): any {
    try {
      const eventAbi = [
        {
          name: 'PositionClosed',
          type: 'event',
          inputs: [
            { name: 'user', type: 'address', indexed: true },
            { name: 'positionId', type: 'uint256', indexed: true },
            { name: 'size', type: 'uint256', indexed: false },
            { name: 'price', type: 'uint256', indexed: false },
            { name: 'pnl', type: 'int256', indexed: false }
          ]
        }
      ] as const
      
      const parsed = decodeEventLog({
        abi: eventAbi,
        topics: log.topics,
        data: log.data
      })
      
      return {
        ...baseEvent,
        user: parsed.args.user,
        positionId: parsed.args.positionId?.toString(),
        size: parsed.args.size?.toString(),
        price: parsed.args.price?.toString(),
        pnl: parsed.args.pnl?.toString()
      }
    } catch (error) {
      console.error('Failed to parse PositionClosed event:', error)
      return baseEvent
    }
  }

  /**
   * Parse PositionIncreased event
   */
  private parsePositionIncreasedEvent(log: any, baseEvent: any): any {
    try {
      const eventAbi = [
        {
          name: 'PositionIncreased',
          type: 'event',
          inputs: [
            { name: 'user', type: 'address', indexed: true },
            { name: 'positionId', type: 'uint256', indexed: true },
            { name: 'sizeAdded', type: 'uint256', indexed: false },
            { name: 'newSize', type: 'uint256', indexed: false },
            { name: 'newEntryPrice', type: 'uint256', indexed: false },
            { name: 'fee', type: 'uint256', indexed: false }
          ]
        }
      ] as const
      
      const parsed = decodeEventLog({
        abi: eventAbi,
        topics: log.topics,
        data: log.data
      })
      
      return {
        ...baseEvent,
        user: parsed.args.user,
        positionId: parsed.args.positionId?.toString(),
        sizeAdded: parsed.args.sizeAdded?.toString(),
        newSize: parsed.args.newSize?.toString(),
        newEntryPrice: parsed.args.newEntryPrice?.toString(),
        fee: parsed.args.fee?.toString()
      }
    } catch (error) {
      console.error('Failed to parse PositionIncreased event:', error)
      return baseEvent
    }
  }

  /**
   * Parse PositionLiquidated event
   */
  private parsePositionLiquidatedEvent(log: any, baseEvent: any): any {
    try {
      const eventAbi = [
        {
          name: 'PositionLiquidated',
          type: 'event',
          inputs: [
            { name: 'user', type: 'address', indexed: true },
            { name: 'positionId', type: 'uint256', indexed: true },
            { name: 'liquidator', type: 'address', indexed: true },
            { name: 'size', type: 'uint256', indexed: false },
            { name: 'price', type: 'uint256', indexed: false },
            { name: 'fee', type: 'uint256', indexed: false }
          ]
        }
      ] as const
      
      const parsed = decodeEventLog({
        abi: eventAbi,
        topics: log.topics,
        data: log.data
      })
      
      return {
        ...baseEvent,
        user: parsed.args.user,
        positionId: parsed.args.positionId?.toString(),
        liquidator: parsed.args.liquidator,
        size: parsed.args.size?.toString(),
        price: parsed.args.price?.toString(),
        fee: parsed.args.fee?.toString()
      }
    } catch (error) {
      console.error('Failed to parse PositionLiquidated event:', error)
      return baseEvent
    }
  }

  /**
   * Parse PriceUpdated event (SimpleVAMM signature)
   */
  private parsePriceUpdatedEvent(log: any, baseEvent: any): any {
    try {
      const eventAbi = [
        {
          name: 'PriceUpdated',
          type: 'event',
          inputs: [
            { name: 'newPrice', type: 'uint256', indexed: false },
            { name: 'netPosition', type: 'int256', indexed: false }
          ]
        }
      ] as const
      
      const parsed = decodeEventLog({
        abi: eventAbi,
        topics: log.topics,
        data: log.data
      })
      
      return {
        ...baseEvent,
        newPrice: parsed.args.newPrice?.toString(),
        netPosition: parsed.args.netPosition?.toString()
      }
    } catch (error) {
      console.error('Failed to parse PriceUpdated event:', error)
      return baseEvent
    }
  }

  /**
   * Parse CollateralDeposited event (SimpleVault signature)
   */
  private parseCollateralDepositedEvent(log: any, baseEvent: any): any {
    try {
      const eventAbi = [
        {
          name: 'CollateralDeposited',
          type: 'event',
          inputs: [
            { name: 'user', type: 'address', indexed: true },
            { name: 'amount', type: 'uint256', indexed: false }
          ]
        }
      ] as const
      
      const parsed = decodeEventLog({
        abi: eventAbi,
        topics: log.topics,
        data: log.data
      })
      
      return {
        ...baseEvent,
        user: parsed.args.user,
        amount: parsed.args.amount?.toString()
      }
    } catch (error) {
      console.error('Failed to parse CollateralDeposited event:', error)
      return baseEvent
    }
  }

  /**
   * Parse CollateralWithdrawn event (SimpleVault signature)
   */
  private parseCollateralWithdrawnEvent(log: any, baseEvent: any): any {
    try {
      const eventAbi = [
        {
          name: 'CollateralWithdrawn',
          type: 'event',
          inputs: [
            { name: 'user', type: 'address', indexed: true },
            { name: 'amount', type: 'uint256', indexed: false }
          ]
        }
      ] as const
      
      const parsed = decodeEventLog({
        abi: eventAbi,
        topics: log.topics,
        data: log.data
      })
      
      return {
        ...baseEvent,
        user: parsed.args.user,
        amount: parsed.args.amount?.toString()
      }
    } catch (error) {
      console.error('Failed to parse CollateralWithdrawn event:', error)
      return baseEvent
    }
  }

  /**
   * Parse MarginReserved event (SimpleVault signature)
   */
  private parseMarginReservedEvent(log: any, baseEvent: any): any {
    try {
      const eventAbi = [
        {
          name: 'MarginReserved',
          type: 'event',
          inputs: [
            { name: 'user', type: 'address', indexed: true },
            { name: 'amount', type: 'uint256', indexed: false }
          ]
        }
      ] as const
      
      const parsed = decodeEventLog({
        abi: eventAbi,
        topics: log.topics,
        data: log.data
      })
      
      return {
        ...baseEvent,
        user: parsed.args.user,
        amount: parsed.args.amount?.toString()
      }
    } catch (error) {
      console.error('Failed to parse MarginReserved event:', error)
      return baseEvent
    }
  }

  /**
   * Parse MarginReleased event (SimpleVault signature)
   */
  private parseMarginReleasedEvent(log: any, baseEvent: any): any {
    try {
      const eventAbi = [
        {
          name: 'MarginReleased',
          type: 'event',
          inputs: [
            { name: 'user', type: 'address', indexed: true },
            { name: 'amount', type: 'uint256', indexed: false }
          ]
        }
      ] as const
      
      const parsed = decodeEventLog({
        abi: eventAbi,
        topics: log.topics,
        data: log.data
      })
      
      return {
        ...baseEvent,
        user: parsed.args.user,
        amount: parsed.args.amount?.toString()
      }
    } catch (error) {
      console.error('Failed to parse MarginReleased event:', error)
      return baseEvent
    }
  }

  /**
   * Parse PnLUpdated event (SimpleVault signature)
   */
  private parsePnLUpdatedEvent(log: any, baseEvent: any): any {
    try {
      const eventAbi = [
        {
          name: 'PnLUpdated',
          type: 'event',
          inputs: [
            { name: 'user', type: 'address', indexed: true },
            { name: 'pnlDelta', type: 'int256', indexed: false }
          ]
        }
      ] as const
      
      const parsed = decodeEventLog({
        abi: eventAbi,
        topics: log.topics,
        data: log.data
      })
      
      return {
        ...baseEvent,
        user: parsed.args.user,
        pnlDelta: parsed.args.pnlDelta?.toString()
      }
    } catch (error) {
      console.error('Failed to parse PnLUpdated event:', error)
      return baseEvent
    }
  }

  /**
   * Parse MarketCreated event (Factory signature)
   */
  private parseMarketCreatedEvent(log: any, baseEvent: any): any {
    try {
      const eventAbi = [
        {
          name: 'MarketCreated',
          type: 'event',
          inputs: [
            { name: 'marketId', type: 'bytes32', indexed: true },
            { name: 'symbol', type: 'string', indexed: false },
            { name: 'vamm', type: 'address', indexed: true },
            { name: 'vault', type: 'address', indexed: true },
            { name: 'oracle', type: 'address', indexed: false },
            { name: 'collateralToken', type: 'address', indexed: false },
            { name: 'startingPrice', type: 'uint256', indexed: false },
            { name: 'marketType', type: 'uint8', indexed: false }
          ]
        }
      ] as const
      
      const parsed = decodeEventLog({
        abi: eventAbi,
        topics: log.topics,
        data: log.data
      })
      
      return {
        ...baseEvent,
        marketId: parsed.args.marketId,
        symbol: parsed.args.symbol,
        vamm: parsed.args.vamm,
        vault: parsed.args.vault,
        oracle: parsed.args.oracle,
        collateralToken: parsed.args.collateralToken,
        startingPrice: parsed.args.startingPrice?.toString(),
        marketType: parsed.args.marketType
      }
    } catch (error) {
      console.error('Failed to parse MarketCreated event:', error)
      return baseEvent
    }
  }

  /**
   * Get monitoring status
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      monitoredEvents: this.config.monitoredEvents,
      factoryAddress: this.config.factoryAddress,
      network: this.config.network,
      scalable: true,
      contractLimit: 'Unlimited',
      webhookManagement: 'External'
    }
  }
}

// Singleton instance
let scalableMonitor: ScalableEventMonitor | null = null

export async function getScalableEventMonitor(): Promise<ScalableEventMonitor> {
  if (!scalableMonitor) {
    scalableMonitor = new ScalableEventMonitor()
  }
  return scalableMonitor
} 