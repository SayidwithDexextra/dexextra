/**
 * DexV2 Event Database Service
 * 
 * Extends the existing EventDatabase with DexV2-specific functionality:
 * - Metric Registry Events
 * - Specialized VAMM Events
 * - Limit Order Events
 * - Portfolio Updates
 * - System Health Monitoring
 */

import { EventDatabase } from './eventDatabase'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export interface DexV2MetricRegistration {
  metricId: string
  name: string
  description: string
  category: number
  dataSource: string
  updateFrequency: string
  settlementPeriod: number
  requiresOracle: boolean
  registeredBy: string
  registeredAt: Date
  iconUrl?: string
  websiteUrl?: string
  documentationUrl?: string
}

export interface DexV2VAMMDeployment {
  vammAddress: string
  metricId: string
  category: number
  maxLeverage: bigint
  tradingFee: bigint
  fundingRate: bigint
  minCollateral: bigint
  isActive: boolean
  deployer: string
  deployedAt: Date
  deploymentTx?: string
  deploymentBlock?: number
  factoryAddress: string
}

export interface DexV2LimitOrder {
  orderId: bigint
  userAddress: string
  metricId: string
  vammAddress?: string
  collateralAmount: bigint
  isLong: boolean
  leverage: bigint
  targetValue: bigint
  positionType: number
  triggerPrice: bigint
  orderType: number
  expiry: Date
  maxSlippage: bigint
  keeperFee: bigint
  status: number
  createdAt: Date
  executedAt?: Date
  cancelledAt?: Date
  executionTx?: string
  executionBlock?: number
  executionPrice?: bigint
  executedBy?: string
  positionId?: bigint
  automationFeePaid?: bigint
  keeperFeePaid?: bigint
}

export interface DexV2Position {
  positionId: bigint
  userAddress: string
  vammAddress: string
  metricId: string
  size: bigint
  isLong: boolean
  entryPrice: bigint
  leverage: bigint
  collateralAmount: bigint
  positionType: number
  targetValue?: bigint
  currentPrice?: bigint
  unrealizedPnl: bigint
  fundingPaid: bigint
  feesPaid: bigint
  isActive: boolean
  openedAt: Date
  closedAt?: Date
  openingTx: string
  closingTx?: string
  settlementPrice?: bigint
  settledAt?: Date
  settlementTx?: string
}

export interface DexV2Portfolio {
  userAddress: string
  totalCollateral: bigint
  totalReservedMargin: bigint
  totalUnrealizedPnl: bigint
  availableCollateral: bigint
  totalPositions: number
  activePositions: number
  profitablePositions: number
  totalVolume: bigint
  totalFeesPaid: bigint
  realizedPnl: bigint
  winRate: number
  activeMarkets: number
  limitOrdersCount: number
  healthFactor: number
  marginRatio: number
  liquidationThreshold: bigint
  lastActivity: Date
}

export class DexV2EventDatabase extends EventDatabase {
  
  // =============================================
  // METRIC REGISTRY OPERATIONS
  // =============================================

  async storeMetricRegistration(metric: DexV2MetricRegistration): Promise<void> {
    try {
      const { error } = await supabase
        .from('dexv2_metrics')
        .insert({
          metric_id: metric.metricId,
          name: metric.name,
          description: metric.description,
          category: metric.category,
          data_source: metric.dataSource,
          update_frequency: metric.updateFrequency,
          settlement_period: metric.settlementPeriod,
          requires_oracle: metric.requiresOracle,
          registered_by: metric.registeredBy,
          registered_at: metric.registeredAt,
          icon_url: metric.iconUrl,
          website_url: metric.websiteUrl,
          documentation_url: metric.documentationUrl
        })

      if (error) {
        console.error('Failed to store metric registration:', error)
        throw error
      }

      console.log('✅ Metric registered successfully:', metric.metricId)
    } catch (error) {
      console.error('Error storing metric registration:', error)
      throw error
    }
  }

  async getMetric(metricId: string): Promise<DexV2MetricRegistration | null> {
    try {
      const { data, error } = await supabase
        .from('dexv2_metrics')
        .select('*')
        .eq('metric_id', metricId)
        .single()

      if (error) {
        if (error.code === 'PGRST116') { // No rows returned
          return null
        }
        throw error
      }

      return {
        metricId: data.metric_id,
        name: data.name,
        description: data.description,
        category: data.category,
        dataSource: data.data_source,
        updateFrequency: data.update_frequency,
        settlementPeriod: data.settlement_period,
        requiresOracle: data.requires_oracle,
        registeredBy: data.registered_by,
        registeredAt: new Date(data.registered_at),
        iconUrl: data.icon_url,
        websiteUrl: data.website_url,
        documentationUrl: data.documentation_url
      }
    } catch (error) {
      console.error('Error fetching metric:', error)
      throw error
    }
  }

  async getAllActiveMetrics(): Promise<DexV2MetricRegistration[]> {
    try {
      const { data, error } = await supabase
        .from('dexv2_metrics')
        .select('*')
        .eq('is_active', true)
        .order('registered_at', { ascending: false })

      if (error) throw error

      return data.map(item => ({
        metricId: item.metric_id,
        name: item.name,
        description: item.description,
        category: item.category,
        dataSource: item.data_source,
        updateFrequency: item.update_frequency,
        settlementPeriod: item.settlement_period,
        requiresOracle: item.requires_oracle,
        registeredBy: item.registered_by,
        registeredAt: new Date(item.registered_at),
        iconUrl: item.icon_url,
        websiteUrl: item.website_url,
        documentationUrl: item.documentation_url
      }))
    } catch (error) {
      console.error('Error fetching active metrics:', error)
      throw error
    }
  }

  // =============================================
  // SPECIALIZED VAMM OPERATIONS
  // =============================================

  async storeVAMMDeployment(vamm: DexV2VAMMDeployment): Promise<void> {
    try {
      const { error } = await supabase
        .from('dexv2_specialized_vamms')
        .insert({
          vamm_address: vamm.vammAddress,
          metric_id: vamm.metricId,
          category: vamm.category,
          max_leverage: vamm.maxLeverage.toString(),
          trading_fee: vamm.tradingFee.toString(),
          funding_rate: vamm.fundingRate.toString(),
          min_collateral: vamm.minCollateral.toString(),
          is_active: vamm.isActive,
          deployer: vamm.deployer,
          deployed_at: vamm.deployedAt,
          deployment_tx: vamm.deploymentTx,
          deployment_block: vamm.deploymentBlock,
          factory_address: vamm.factoryAddress
        })

      if (error) {
        console.error('Failed to store VAMM deployment:', error)
        throw error
      }

      console.log('✅ VAMM deployment stored successfully:', vamm.vammAddress)
    } catch (error) {
      console.error('Error storing VAMM deployment:', error)
      throw error
    }
  }

  async getVAMMsByMetric(metricId: string): Promise<DexV2VAMMDeployment[]> {
    try {
      const { data, error } = await supabase
        .from('dexv2_specialized_vamms')
        .select('*')
        .eq('metric_id', metricId)
        .eq('is_active', true)
        .order('deployed_at', { ascending: false })

      if (error) throw error

      return data.map(item => ({
        vammAddress: item.vamm_address,
        metricId: item.metric_id,
        category: item.category,
        maxLeverage: BigInt(item.max_leverage),
        tradingFee: BigInt(item.trading_fee),
        fundingRate: BigInt(item.funding_rate),
        minCollateral: BigInt(item.min_collateral),
        isActive: item.is_active,
        deployer: item.deployer,
        deployedAt: new Date(item.deployed_at),
        deploymentTx: item.deployment_tx,
        deploymentBlock: item.deployment_block,
        factoryAddress: item.factory_address
      }))
    } catch (error) {
      console.error('Error fetching VAMMs by metric:', error)
      throw error
    }
  }

  // =============================================
  // LIMIT ORDER OPERATIONS
  // =============================================

  async storeLimitOrder(order: DexV2LimitOrder): Promise<void> {
    try {
      const { error } = await supabase
        .from('dexv2_limit_orders')
        .insert({
          order_id: order.orderId.toString(),
          user_address: order.userAddress,
          metric_id: order.metricId,
          vamm_address: order.vammAddress,
          collateral_amount: order.collateralAmount.toString(),
          is_long: order.isLong,
          leverage: order.leverage.toString(),
          target_value: order.targetValue.toString(),
          position_type: order.positionType,
          trigger_price: order.triggerPrice.toString(),
          order_type: order.orderType,
          expiry: order.expiry,
          max_slippage: order.maxSlippage.toString(),
          keeper_fee: order.keeperFee.toString(),
          status: order.status,
          created_at: order.createdAt,
          executed_at: order.executedAt,
          cancelled_at: order.cancelledAt,
          execution_tx: order.executionTx,
          execution_block: order.executionBlock,
          execution_price: order.executionPrice?.toString(),
          executed_by: order.executedBy,
          position_id: order.positionId?.toString(),
          automation_fee_paid: order.automationFeePaid?.toString(),
          keeper_fee_paid: order.keeperFeePaid?.toString()
        })

      if (error) {
        console.error('Failed to store limit order:', error)
        throw error
      }

      console.log('✅ Limit order stored successfully:', order.orderId.toString())
    } catch (error) {
      console.error('Error storing limit order:', error)
      throw error
    }
  }

  async updateLimitOrderStatus(
    orderId: bigint, 
    status: number, 
    executionData?: {
      executedAt: Date
      executionTx: string
      executionBlock: number
      executionPrice: bigint
      executedBy: string
      positionId?: bigint
    }
  ): Promise<void> {
    try {
      const updateData: any = { status }
      
      if (executionData) {
        updateData.executed_at = executionData.executedAt
        updateData.execution_tx = executionData.executionTx
        updateData.execution_block = executionData.executionBlock
        updateData.execution_price = executionData.executionPrice.toString()
        updateData.executed_by = executionData.executedBy
        if (executionData.positionId) {
          updateData.position_id = executionData.positionId.toString()
        }
      }

      const { error } = await supabase
        .from('dexv2_limit_orders')
        .update(updateData)
        .eq('order_id', orderId.toString())

      if (error) {
        console.error('Failed to update limit order status:', error)
        throw error
      }

      console.log('✅ Limit order status updated:', orderId.toString(), 'status:', status)
    } catch (error) {
      console.error('Error updating limit order status:', error)
      throw error
    }
  }

  async getUserLimitOrders(userAddress: string, status?: number): Promise<DexV2LimitOrder[]> {
    try {
      let query = supabase
        .from('dexv2_limit_orders')
        .select('*')
        .eq('user_address', userAddress)
        .order('created_at', { ascending: false })

      if (status !== undefined) {
        query = query.eq('status', status)
      }

      const { data, error } = await query

      if (error) throw error

      return data.map(item => ({
        orderId: BigInt(item.order_id),
        userAddress: item.user_address,
        metricId: item.metric_id,
        vammAddress: item.vamm_address,
        collateralAmount: BigInt(item.collateral_amount),
        isLong: item.is_long,
        leverage: BigInt(item.leverage),
        targetValue: BigInt(item.target_value || 0),
        positionType: item.position_type,
        triggerPrice: BigInt(item.trigger_price),
        orderType: item.order_type,
        expiry: new Date(item.expiry),
        maxSlippage: BigInt(item.max_slippage),
        keeperFee: BigInt(item.keeper_fee),
        status: item.status,
        createdAt: new Date(item.created_at),
        executedAt: item.executed_at ? new Date(item.executed_at) : undefined,
        cancelledAt: item.cancelled_at ? new Date(item.cancelled_at) : undefined,
        executionTx: item.execution_tx,
        executionBlock: item.execution_block,
        executionPrice: item.execution_price ? BigInt(item.execution_price) : undefined,
        executedBy: item.executed_by,
        positionId: item.position_id ? BigInt(item.position_id) : undefined,
        automationFeePaid: item.automation_fee_paid ? BigInt(item.automation_fee_paid) : undefined,
        keeperFeePaid: item.keeper_fee_paid ? BigInt(item.keeper_fee_paid) : undefined
      }))
    } catch (error) {
      console.error('Error fetching user limit orders:', error)
      throw error
    }
  }

  // =============================================
  // POSITION OPERATIONS
  // =============================================

  async storePosition(position: DexV2Position): Promise<void> {
    try {
      const { error } = await supabase
        .from('dexv2_positions')
        .insert({
          position_id: position.positionId.toString(),
          user_address: position.userAddress,
          vamm_address: position.vammAddress,
          metric_id: position.metricId,
          size: position.size.toString(),
          is_long: position.isLong,
          entry_price: position.entryPrice.toString(),
          leverage: position.leverage.toString(),
          collateral_amount: position.collateralAmount.toString(),
          position_type: position.positionType,
          target_value: position.targetValue?.toString(),
          current_price: position.currentPrice?.toString(),
          unrealized_pnl: position.unrealizedPnl.toString(),
          funding_paid: position.fundingPaid.toString(),
          fees_paid: position.feesPaid.toString(),
          is_active: position.isActive,
          opened_at: position.openedAt,
          closed_at: position.closedAt,
          opening_tx: position.openingTx,
          closing_tx: position.closingTx,
          settlement_price: position.settlementPrice?.toString(),
          settled_at: position.settledAt,
          settlement_tx: position.settlementTx
        })

      if (error) {
        console.error('Failed to store position:', error)
        throw error
      }

      console.log('✅ Position stored successfully:', position.positionId.toString())
    } catch (error) {
      console.error('Error storing position:', error)
      throw error
    }
  }

  async getUserPositions(userAddress: string, activeOnly: boolean = false): Promise<DexV2Position[]> {
    try {
      let query = supabase
        .from('dexv2_positions')
        .select('*')
        .eq('user_address', userAddress)
        .order('opened_at', { ascending: false })

      if (activeOnly) {
        query = query.eq('is_active', true)
      }

      const { data, error } = await query

      if (error) throw error

      return data.map(item => ({
        positionId: BigInt(item.position_id),
        userAddress: item.user_address,
        vammAddress: item.vamm_address,
        metricId: item.metric_id,
        size: BigInt(item.size),
        isLong: item.is_long,
        entryPrice: BigInt(item.entry_price),
        leverage: BigInt(item.leverage),
        collateralAmount: BigInt(item.collateral_amount),
        positionType: item.position_type,
        targetValue: item.target_value ? BigInt(item.target_value) : undefined,
        currentPrice: item.current_price ? BigInt(item.current_price) : undefined,
        unrealizedPnl: BigInt(item.unrealized_pnl || 0),
        fundingPaid: BigInt(item.funding_paid || 0),
        feesPaid: BigInt(item.fees_paid || 0),
        isActive: item.is_active,
        openedAt: new Date(item.opened_at),
        closedAt: item.closed_at ? new Date(item.closed_at) : undefined,
        openingTx: item.opening_tx,
        closingTx: item.closing_tx,
        settlementPrice: item.settlement_price ? BigInt(item.settlement_price) : undefined,
        settledAt: item.settled_at ? new Date(item.settled_at) : undefined,
        settlementTx: item.settlement_tx
      }))
    } catch (error) {
      console.error('Error fetching user positions:', error)
      throw error
    }
  }

  // =============================================
  // PORTFOLIO OPERATIONS
  // =============================================

  async updateUserPortfolio(portfolio: DexV2Portfolio): Promise<void> {
    try {
      const { error } = await supabase
        .from('dexv2_user_portfolios')
        .upsert({
          user_address: portfolio.userAddress,
          total_collateral: portfolio.totalCollateral.toString(),
          total_reserved_margin: portfolio.totalReservedMargin.toString(),
          total_unrealized_pnl: portfolio.totalUnrealizedPnl.toString(),
          available_collateral: portfolio.availableCollateral.toString(),
          total_positions: portfolio.totalPositions,
          active_positions: portfolio.activePositions,
          profitable_positions: portfolio.profitablePositions,
          total_volume: portfolio.totalVolume.toString(),
          total_fees_paid: portfolio.totalFeesPaid.toString(),
          realized_pnl: portfolio.realizedPnl.toString(),
          win_rate: portfolio.winRate,
          active_markets: portfolio.activeMarkets,
          limit_orders_count: portfolio.limitOrdersCount,
          health_factor: portfolio.healthFactor,
          margin_ratio: portfolio.marginRatio,
          liquidation_threshold: portfolio.liquidationThreshold.toString(),
          last_activity: portfolio.lastActivity
        })

      if (error) {
        console.error('Failed to update user portfolio:', error)
        throw error
      }

      console.log('✅ User portfolio updated successfully:', portfolio.userAddress)
    } catch (error) {
      console.error('Error updating user portfolio:', error)
      throw error
    }
  }

  async getUserPortfolio(userAddress: string): Promise<DexV2Portfolio | null> {
    try {
      const { data, error } = await supabase
        .from('dexv2_portfolio_dashboard')
        .select('*')
        .eq('user_address', userAddress)
        .single()

      if (error) {
        if (error.code === 'PGRST116') { // No rows returned
          return null
        }
        throw error
      }

      return {
        userAddress: data.user_address,
        totalCollateral: BigInt(data.total_collateral || 0),
        totalReservedMargin: BigInt(data.total_reserved_margin || 0),
        totalUnrealizedPnl: BigInt(data.total_unrealized_pnl || 0),
        availableCollateral: BigInt(data.available_collateral || 0),
        totalPositions: data.total_positions || 0,
        activePositions: data.active_positions || 0,
        profitablePositions: 0, // Calculated separately
        totalVolume: BigInt(data.total_volume || 0),
        totalFeesPaid: BigInt(0), // Calculated separately
        realizedPnl: BigInt(data.realized_pnl || 0),
        winRate: data.win_rate || 0,
        activeMarkets: data.active_markets || 0,
        limitOrdersCount: data.active_orders || 0,
        healthFactor: data.health_factor || 0,
        marginRatio: 0, // Calculated separately
        liquidationThreshold: BigInt(0), // Calculated separately
        lastActivity: new Date(data.last_activity)
      }
    } catch (error) {
      console.error('Error fetching user portfolio:', error)
      throw error
    }
  }

  // =============================================
  // SYSTEM HEALTH OPERATIONS
  // =============================================

  async getSystemHealth(network: string = 'polygon') {
    try {
      const { data, error } = await supabase
        .from('dexv2_system_health')
        .select('*')
        .eq('network', network)
        .single()

      if (error) throw error

      return data
    } catch (error) {
      console.error('Error fetching system health:', error)
      throw error
    }
  }

  async getMarketAnalytics(metricId?: string) {
    try {
      let query = supabase
        .from('dexv2_market_analytics')
        .select('*')
        .order('total_volume', { ascending: false })

      if (metricId) {
        query = query.eq('metric_id', metricId)
      }

      const { data, error } = await query

      if (error) throw error

      return data
    } catch (error) {
      console.error('Error fetching market analytics:', error)
      throw error
    }
  }
}

export default DexV2EventDatabase 