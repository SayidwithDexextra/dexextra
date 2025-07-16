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

import { ethers } from 'ethers'
import { EventDatabase } from '@/lib/eventDatabase'
import { env } from '@/lib/env'

// Event signatures for monitoring (keccak256 hash of event signatures)
export const EVENT_SIGNATURES = {
  PositionOpened: '0x345a1e15bff227bfd5051975d95c864c45cf9fe79def6f9ce1c1525b0e831226',
  PositionClosed: '0x035509dd26c2d331b2eeaf713e533967ac9e8a0c5e37372abc7dedd026e81675',
  PositionIncreased: '0x2337e687da16f7f70de054ec6c6f96c9faaeac16ca3fe6b873cf017380f578a8',
  PositionLiquidated: '0xeb125fc2316e55999aaacc483aa145655b8032d8bce094f8a17174ed9994d9d7',
  FundingUpdated: '0xd0794ac40e87e336e6e652e1eef2cdb3793d91f30dcc09a45d18db669a686b94',
  FundingPaid: '0xc86c3274d0eb50daaa9786e84b032f4ee9f7c878dfc21d805b52cadc5ff4a1b0',
  CollateralDeposited: '0xd7243f6f8212d5188fd054141cf6ea89cfc0d91facb8c3afe2f88a1358480142',
  CollateralWithdrawn: '0xc30fcfbcaac9e0deffa719714eaa82396ff506a0d0d0eebe170830177288715d',
  MarginReserved: '0x7a9b1b90f35f094ffc6d04d86069c79e82c6a16eb600f79672428a409635deca',
  MarginReleased: '0x5e63d54af10545f0b2bd229512f244caefe863ad94dbbb7ad827432c84d762f5',
  PnLUpdated: '0x22d38deb33ee15dd233167fc440609397a226eb4e1b61e1773bdd09ef99424aa',
  FundingApplied: '0x4519c0de74b8f9f16fda0005326875e3fd4dd0d38446a1135a1ffa1739e4591e',
  UserLiquidated: '0xe538b9438650b40b382a773f4b71a35129a6b330599b42ed9b50492847972fa6',
  MarketCreated: '0x47ab7633006b3b6d4ecfa77b1c64dac99d985e2ec70de8fe50aeeded29c95742',
  TradingFeeCollected: '0x4b85f139405492fb78333512610ba07ed1e0c3fb2417f208a9aae27dc3843e6a',
  BondingCurveUpdated: '0x1551b5180ce27b1b0d183046bbf7f4ed792368fa907dcaa0e08d22c5e8b14512',
  VirtualReservesUpdated: '0x02c3a836ec725fabcd5f42c400284d12e718aa5c5ea6404daf37abce91cfb097',
  ParametersUpdated: '0x952177133a28eea5034c93c6c70c1a8d223da94faaa45da8412c3c791111137f',
  AuthorizedAdded: '0xdd10d14f6ac19e913d4edbb11fd30661531e2ccd0d23f571e9b224f001f0dd06',
  AuthorizedRemoved: '0x0fafd0343e6c6f6985727574866da48938c918559eb9521cf9cc0d317ea0f7b4',
  Paused: '0x9e87fac88ff661f02d44f95383c817fece4bce600a3dab7a54406878b965e752',
  Unpaused: '0xa45f47fdea8a1efdd9029a5691c7f759c32b7c698632b563573e155625d16933'
}

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
    this.config = {
      factoryAddress: config.factoryAddress || "0x70Cbc2F399A9E8d1fD4905dBA82b9C7653dfFc74",
      network: config.network || 'polygon',
      monitoredEvents: config.monitoredEvents || [
        'PositionOpened',
        'PositionClosed', 
        'PositionIncreased',
        'PositionLiquidated'
      ]
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
      
      const data = await response.json()
      const bytecode = data.result
      
      // Simple pattern matching (could be enhanced with more sophisticated detection)
      if (bytecode.startsWith(CONTRACT_PATTERNS.VAMM_BYTECODE_PREFIX)) {
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
   * Parse PositionOpened event
   */
  private parsePositionOpenedEvent(log: any, baseEvent: any): any {
    try {
      const iface = new ethers.Interface([
        'event PositionOpened(address indexed user, uint256 indexed positionId, bool isLong, uint256 size, uint256 price, uint256 leverage, uint256 fee)'
      ])
      
      const parsed = iface.parseLog({
        topics: log.topics,
        data: log.data
      })
      
      if (!parsed) {
        throw new Error('Failed to parse log')
      }
      
      return {
        ...baseEvent,
        user: parsed.args.user,
        positionId: parsed.args.positionId?.toString(),
        isLong: parsed.args.isLong,
        size: parsed.args.size?.toString(),
        price: parsed.args.price?.toString(),
        leverage: parsed.args.leverage?.toString(),
        fee: parsed.args.fee?.toString()
      }
    } catch (error) {
      console.error('Failed to parse PositionOpened event:', error)
      return baseEvent
    }
  }

  /**
   * Parse PositionClosed event
   */
  private parsePositionClosedEvent(log: any, baseEvent: any): any {
    try {
      const iface = new ethers.Interface([
        'event PositionClosed(address indexed user, uint256 indexed positionId, uint256 size, uint256 price, int256 pnl, uint256 fee)'
      ])
      
      const parsed = iface.parseLog({
        topics: log.topics,
        data: log.data
      })
      
      if (!parsed) {
        throw new Error('Failed to parse log')
      }
      
      return {
        ...baseEvent,
        user: parsed.args.user,
        positionId: parsed.args.positionId?.toString(),
        size: parsed.args.size?.toString(),
        price: parsed.args.price?.toString(),
        pnl: parsed.args.pnl?.toString(),
        fee: parsed.args.fee?.toString()
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
      const iface = new ethers.Interface([
        'event PositionIncreased(address indexed user, uint256 indexed positionId, uint256 sizeAdded, uint256 newSize, uint256 newEntryPrice, uint256 fee)'
      ])
      
      const parsed = iface.parseLog({
        topics: log.topics,
        data: log.data
      })
      
      if (!parsed) {
        throw new Error('Failed to parse log')
      }
      
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
      const iface = new ethers.Interface([
        'event PositionLiquidated(address indexed user, uint256 indexed positionId, address indexed liquidator, uint256 size, uint256 price, uint256 fee)'
      ])
      
      const parsed = iface.parseLog({
        topics: log.topics,
        data: log.data
      })
      
      if (!parsed) {
        throw new Error('Failed to parse log')
      }
      
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
   * Parse MarketCreated event
   */
  private parseMarketCreatedEvent(log: any, baseEvent: any): any {
    try {
      const iface = new ethers.Interface([
        'event MarketCreated(bytes32 indexed marketId, string symbol, address indexed vamm, address indexed vault, address oracle, address collateralToken, uint256 startingPrice, uint8 marketType)'
      ])
      
      const parsed = iface.parseLog({
        topics: log.topics,
        data: log.data
      })
      
      if (!parsed) {
        throw new Error('Failed to parse log')
      }
      
      return {
        ...baseEvent,
        marketId: parsed.args.marketId,
        symbol: parsed.args.symbol,
        vamm: parsed.args.vamm,
        vault: parsed.args.vault,
        oracle: parsed.args.oracle,
        collateralToken: parsed.args.collateralToken,
        startingPrice: parsed.args.startingPrice?.toString(),
        marketType: parsed.args.marketType?.toString()
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