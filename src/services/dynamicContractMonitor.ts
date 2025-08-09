/**
 * Dynamic Contract Monitor Service
 * 
 * Monitors vAMM Factory contracts for new deployments and automatically
 * adds newly created contracts to webhook monitoring in real-time.
 */

import { AlchemyNotifyService, getAlchemyNotifyService } from './alchemyNotifyService'
import { EventDatabase } from '../lib/eventDatabase'
import { env } from '../lib/env'
import { getContractAddress, FACTORY_ABI } from '@/lib/contracts'

// Factory contract addresses are now managed centrally

export interface NewContractDeployment {
  marketId: string
  symbol: string
  vammAddress: string
  vaultAddress: string
  oracleAddress: string
  collateralAddress: string
  startingPrice: string
  marketType: number
  transactionHash: string
  blockNumber: number
  timestamp: Date
}

export class DynamicContractMonitor {
  private alchemyNotify!: AlchemyNotifyService
  private database!: EventDatabase
  private factoryAddress: string
  private isMonitoring = false
  private monitoredContracts = new Set<string>()

  constructor(network: string = 'polygon') {
    this.factoryAddress = getContractAddress(network, 'VAMM_FACTORY')
  }

  /**
   * Initialize the dynamic contract monitor
   */
  async initialize(): Promise<void> {
    try {
       console.log('🔧 Initializing Dynamic Contract Monitor...')
      
      this.alchemyNotify = await getAlchemyNotifyService()
      this.database = new EventDatabase()
      
      // Ensure factory contract is being monitored
      await this.ensureFactoryMonitoring()
      
      // Load existing contracts to avoid re-adding them
      await this.loadExistingContracts()
      
       console.log('✅ Dynamic Contract Monitor initialized')
    } catch (error) {
      console.error('❌ Failed to initialize Dynamic Contract Monitor:', error)
      throw error
    }
  }

  /**
   * Ensure the factory contract is included in webhook monitoring
   */
  async ensureFactoryMonitoring(): Promise<void> {
    try {
       console.log('🏭 Ensuring factory contract is monitored...')
      
      // Get current webhook configuration
      const webhookConfig = await this.database.getWebhookConfig()
      const currentContracts = webhookConfig?.contracts || []
      
      // Check if factory is already being monitored
      const factoryExists = currentContracts.some(
        (contract: any) => contract.address.toLowerCase() === this.factoryAddress.toLowerCase()
      )
      
      if (!factoryExists) {
         console.log('➕ Adding factory contract to webhook monitoring...')
        
        // Add factory to contracts list
        const updatedContracts = [
          ...currentContracts,
          {
            name: 'vAMM Factory',
            type: 'Factory',
            address: this.factoryAddress.toLowerCase()
          }
        ]
        
        // Update database configuration with factory included
        await this.updateDatabaseConfiguration(updatedContracts)
        
         console.log('✅ Factory contract added to webhook monitoring')
      } else {
         console.log('✅ Factory contract already being monitored')
      }
    } catch (error) {
      console.error('❌ Failed to ensure factory monitoring:', error)
      throw error
    }
  }

  /**
   * Load existing contracts to avoid duplicates
   */
  async loadExistingContracts(): Promise<void> {
    try {
      const contracts = await this.database.getDeployedVAMMContracts()
      for (const contract of contracts) {
        this.monitoredContracts.add(contract.address.toLowerCase())
      }
       console.log(`📋 Loaded ${this.monitoredContracts.size} existing monitored contracts`)
    } catch (error) {
      console.error('❌ Failed to load existing contracts:', error)
    }
  }

  /**
   * Process a MarketCreated event and add new contracts to monitoring
   */
  async processMarketCreatedEvent(event: any): Promise<void> {
    try {
       console.log('🎯 Processing MarketCreated event:', event)
      
      const deployment = await this.parseMarketCreatedEvent(event)
      
      // Check if contracts are already being monitored
      const newContracts = []
      
      if (!this.monitoredContracts.has(deployment.vammAddress.toLowerCase())) {
        newContracts.push({
          name: `${deployment.symbol} vAMM`,
          type: 'vAMM',
          address: deployment.vammAddress.toLowerCase()
        })
        this.monitoredContracts.add(deployment.vammAddress.toLowerCase())
      }
      
      if (!this.monitoredContracts.has(deployment.vaultAddress.toLowerCase())) {
        newContracts.push({
          name: `${deployment.symbol} Vault`,
          type: 'Vault',
          address: deployment.vaultAddress.toLowerCase()
        })
        this.monitoredContracts.add(deployment.vaultAddress.toLowerCase())
      }
      
      if (!this.monitoredContracts.has(deployment.oracleAddress.toLowerCase())) {
        newContracts.push({
          name: `${deployment.symbol} Oracle`,
          type: 'Oracle',
          address: deployment.oracleAddress.toLowerCase()
        })
        this.monitoredContracts.add(deployment.oracleAddress.toLowerCase())
      }
      
      if (newContracts.length > 0) {
         console.log(`➕ Adding ${newContracts.length} new contracts to webhook monitoring...`)
        
        // Get current webhook config and add new contracts
        const webhookConfig = await this.database.getWebhookConfig()
        const updatedContracts = [
          ...(webhookConfig?.contracts || []),
          ...newContracts
        ]
        
        // Update database configuration and store deployment
        await Promise.all([
          this.updateDatabaseConfiguration(updatedContracts),
          this.storeNewDeployment(deployment)
        ])
        
         console.log('✅ New contracts added to monitoring:', newContracts.map(c => c.name))
      } else {
         console.log('ℹ️ All contracts from this deployment are already being monitored')
      }
      
    } catch (error) {
      console.error('❌ Failed to process MarketCreated event:', error)
    }
  }

  /**
   * Update database configuration with new contracts
   * Note: Alchemy webhooks cannot be updated via API, so we only update our database
   */
  async updateDatabaseConfiguration(contracts: any[]): Promise<void> {
    try {
      // Update database configuration
      await this.database.updateWebhookConfig({
        contracts,
        updatedAt: new Date()
      })
      
       console.log('✅ Database configuration updated with new contracts')
       console.log('ℹ️ Note: Alchemy webhook itself unchanged (API limitation)')
    } catch (error) {
      console.error('❌ Failed to update database configuration:', error)
      throw error
    }
  }

  /**
   * Parse MarketCreated event into deployment object
   */
  async parseMarketCreatedEvent(event: any): Promise<NewContractDeployment> {
    const args = event.args || event
    
    return {
      marketId: args.marketId,
      symbol: args.symbol,
      vammAddress: args.vamm,
      vaultAddress: args.vault,
      oracleAddress: args.oracle,
      collateralAddress: args.collateralToken,
      startingPrice: args.startingPrice?.toString() || '0',
      marketType: args.marketType || 0,
      transactionHash: event.transactionHash || '',
      blockNumber: event.blockNumber || 0,
      timestamp: new Date()
    }
  }

  /**
   * Store new deployment in database
   */
  async storeNewDeployment(deployment: NewContractDeployment): Promise<void> {
    try {
      // Store in vamm_markets table
      await this.database.storeVAMMMarket({
        symbol: deployment.symbol,
        vammAddress: deployment.vammAddress,
        vaultAddress: deployment.vaultAddress,
        oracleAddress: deployment.oracleAddress,
        collateralAddress: deployment.collateralAddress,
        startingPrice: deployment.startingPrice,
        marketType: deployment.marketType,
        deploymentStatus: 'deployed',
        transactionHash: deployment.transactionHash,
        blockNumber: deployment.blockNumber
      })
      
       console.log('💾 New deployment stored in database:', deployment.symbol)
    } catch (error) {
      console.error('❌ Failed to store deployment:', error)
    }
  }

  /**
   * Get monitoring status
   */
  getStatus() {
    return {
      isMonitoring: this.isMonitoring,
      factoryAddress: this.factoryAddress,
      monitoredContractsCount: this.monitoredContracts.size,
      monitoredContracts: Array.from(this.monitoredContracts)
    }
  }
}

// Singleton instance
let dynamicMonitor: DynamicContractMonitor | null = null

export async function getDynamicContractMonitor(): Promise<DynamicContractMonitor> {
  if (!dynamicMonitor) {
    const network = env.DEFAULT_NETWORK || 'polygon'
    dynamicMonitor = new DynamicContractMonitor(network)
    await dynamicMonitor.initialize()
  }
  return dynamicMonitor
} 