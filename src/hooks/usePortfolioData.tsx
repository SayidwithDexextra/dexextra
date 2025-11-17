'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useWallet } from './useWallet'
import { usePositions } from './usePositions'
import { getUserActiveOrdersAllMarkets } from './useOrderBook'
import { populateMarketInfoClient } from '@/lib/contractConfig'

export interface PortfolioOrdersBucket {
	symbol: string
	token: string
	orders: any[]
}

export interface PortfolioData {
	positions: ReturnType<typeof usePositions>['positions']
	ordersBuckets: PortfolioOrdersBucket[]
	activeOrdersCount: number
	isLoadingPositions: boolean
	isLoadingOrders: boolean
	isLoading: boolean
	hasLoadedOnce: boolean // True after initial fetch completes (success or failure)
	error: string | null
	lastUpdated: number | null
	refreshOrders: () => Promise<void>
}

const DEBUG_PORTFOLIO_LOGS = process.env.NEXT_PUBLIC_DEBUG_PORTFOLIO === 'true' || process.env.NODE_ENV !== 'production'
const pfLog = (...args: any[]) => { if (DEBUG_PORTFOLIO_LOGS) console.log('[ALTKN][PortfolioData]', ...args); }
const pfWarn = (...args: any[]) => { if (DEBUG_PORTFOLIO_LOGS) console.warn('[ALTKN][PortfolioData]', ...args); }
const pfError = (...args: any[]) => { if (DEBUG_PORTFOLIO_LOGS) console.error('[ALTKN][PortfolioData]', ...args); }

// Global state to coordinate fetching across all hook instances
const globalState = {
	marketInfoPopulated: false,
	marketInfoPopulating: null as Promise<void> | null,
	ordersCache: new Map<string, { data: PortfolioOrdersBucket[]; ts: number }>(),
	ordersFetching: new Map<string, Promise<PortfolioOrdersBucket[]>>(),
	lastOrdersFetch: new Map<string, number>(),
}

const ORDERS_CACHE_TTL = 10000 // 10 seconds cache
const ORDERS_POLL_INTERVAL = 15000 // 15 seconds polling
const MAX_RETRIES = 3
const RETRY_DELAY_BASE = 1000 // 1 second base delay

/**
 * Centralized hook for portfolio data (positions + orders)
 * Ensures consistent loading, retry logic, and prevents race conditions
 */
export function usePortfolioData(options?: { enabled?: boolean; refreshInterval?: number }): PortfolioData {
	const { walletData } = useWallet() as any
	const walletAddress = walletData?.address
	const enabled = options?.enabled !== false
	const refreshInterval = options?.refreshInterval ?? ORDERS_POLL_INTERVAL

	// Use the existing usePositions hook for positions
	const positionsState = usePositions(undefined, { enabled })

	// Local state for orders
	const [ordersBuckets, setOrdersBuckets] = useState<PortfolioOrdersBucket[]>([])
	const [isLoadingOrders, setIsLoadingOrders] = useState(false)
	const [ordersError, setOrdersError] = useState<string | null>(null)
	const [lastUpdated, setLastUpdated] = useState<number | null>(null)
	const [hasLoadedOrdersOnce, setHasLoadedOrdersOnce] = useState(false)
	const [hasLoadedPositionsOnce, setHasLoadedPositionsOnce] = useState(false)

	// Refs to prevent race conditions
	const mountedRef = useRef(true)
	const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
	const retryCountRef = useRef(0)

	// Ensure market info is populated before fetching orders
	const ensureMarketInfoPopulated = useCallback(async (): Promise<void> => {
		if (globalState.marketInfoPopulated) {
			pfLog('Market info already populated')
			return
		}

		if (globalState.marketInfoPopulating) {
			pfLog('Market info population in progress, waiting...')
			await globalState.marketInfoPopulating
			return
		}

		const populatePromise = (async () => {
			try {
				pfLog('Populating market info...')
				await populateMarketInfoClient()
				globalState.marketInfoPopulated = true
				pfLog('Market info populated successfully')
			} catch (error: any) {
				pfError('Failed to populate market info:', error)
				globalState.marketInfoPopulated = false
				throw error
			} finally {
				globalState.marketInfoPopulating = null
			}
		})()

		globalState.marketInfoPopulating = populatePromise
		await populatePromise
	}, [])

	// Fetch orders with retry logic
	const fetchOrders = useCallback(async (address: string, retryAttempt = 0): Promise<PortfolioOrdersBucket[]> => {
		const cacheKey = `${address.toLowerCase()}::${Date.now() - (Date.now() % ORDERS_CACHE_TTL)}`
		const cached = globalState.ordersCache.get(address.toLowerCase())
		
		// Check cache first
		if (cached && (Date.now() - cached.ts) < ORDERS_CACHE_TTL) {
			pfLog('Using cached orders', { ageMs: Date.now() - cached.ts, bucketCount: cached.data.length })
			return cached.data
		}

		// Check if already fetching for this address
		const inFlight = globalState.ordersFetching.get(address.toLowerCase())
		if (inFlight) {
			pfLog('Orders fetch already in progress, waiting...')
			return await inFlight
		}

		// Ensure market info is populated before fetching
		try {
			await ensureMarketInfoPopulated()
		} catch (error: any) {
			pfWarn('Market info population failed, proceeding anyway:', error)
		}

		const fetchPromise = (async (): Promise<PortfolioOrdersBucket[]> => {
			try {
				pfLog('Fetching orders', { address: address.slice(0, 6) + '...', attempt: retryAttempt + 1 })
				const startTime = Date.now()
				
				const buckets = await getUserActiveOrdersAllMarkets(address)
				const duration = Date.now() - startTime
				
				pfLog('Orders fetched successfully', { 
					bucketCount: buckets.length, 
					totalOrders: buckets.reduce((sum, b) => sum + (b?.orders?.length || 0), 0),
					durationMs: duration 
				})

				// Cache the result
				globalState.ordersCache.set(address.toLowerCase(), { data: buckets, ts: Date.now() })
				globalState.lastOrdersFetch.set(address.toLowerCase(), Date.now())
				retryCountRef.current = 0 // Reset retry count on success

				return buckets
			} catch (error: any) {
				pfError('Failed to fetch orders', { error, attempt: retryAttempt + 1 })
				
				// Retry logic
				if (retryAttempt < MAX_RETRIES) {
					const delay = RETRY_DELAY_BASE * Math.pow(2, retryAttempt) // Exponential backoff
					pfLog(`Retrying orders fetch in ${delay}ms...`, { attempt: retryAttempt + 1 })
					await new Promise(resolve => setTimeout(resolve, delay))
					return fetchOrders(address, retryAttempt + 1)
				}

				throw error
			} finally {
				globalState.ordersFetching.delete(address.toLowerCase())
			}
		})()

		globalState.ordersFetching.set(address.toLowerCase(), fetchPromise)
		return await fetchPromise
	}, [ensureMarketInfoPopulated])

	// Refresh function exposed to components
	const refreshOrders = useCallback(async () => {
		if (!walletAddress || !enabled) return
		
		// Clear cache to force fresh fetch
		globalState.ordersCache.delete(walletAddress.toLowerCase())
		globalState.ordersFetching.delete(walletAddress.toLowerCase())
		
		try {
			setIsLoadingOrders(true)
			setOrdersError(null)
			
			const buckets = await fetchOrders(walletAddress)
			
			if (!mountedRef.current) return
			
			setOrdersBuckets(buckets)
			setLastUpdated(Date.now())
			setIsLoadingOrders(false)
			setHasLoadedOrdersOnce(true)
		} catch (error: any) {
			if (!mountedRef.current) return
			
			pfError('Manual refresh failed:', error)
			setOrdersError(error?.message || 'Failed to refresh orders')
			setIsLoadingOrders(false)
			setHasLoadedOrdersOnce(true)
		}
	}, [walletAddress, enabled, fetchOrders])

	// Main effect to fetch orders
	useEffect(() => {
		if (!mountedRef.current) return

		if (!enabled || !walletAddress) {
			setOrdersBuckets([])
			setIsLoadingOrders(false)
			setOrdersError(null)
			setHasLoadedOrdersOnce(false)
			setHasLoadedPositionsOnce(false)
			return
		}

		let cancelled = false

		const doFetch = async (isInitialLoad = false) => {
			if (cancelled || !mountedRef.current) return

			try {
				// Only set loading state during initial load to prevent flicker during polling
				if (isInitialLoad || !hasLoadedOrdersOnce) {
					setIsLoadingOrders(true)
				}
				setOrdersError(null)

				const buckets = await fetchOrders(walletAddress)
				
				if (cancelled || !mountedRef.current) return

				setOrdersBuckets(buckets)
				setLastUpdated(Date.now())
				setIsLoadingOrders(false)
				
				// Only set hasLoadedOrdersOnce once, on initial load
				if (!hasLoadedOrdersOnce) {
					setHasLoadedOrdersOnce(true)
					pfLog('Orders initial load complete', { bucketCount: buckets.length })
				}
			} catch (error: any) {
				if (cancelled || !mountedRef.current) return

				pfError('Orders fetch failed after retries:', error)
				setOrdersError(error?.message || 'Failed to fetch orders')
				setIsLoadingOrders(false)
				
				// Only set hasLoadedOrdersOnce once, even on error
				if (!hasLoadedOrdersOnce) {
					setHasLoadedOrdersOnce(true)
				}
				
				// Keep previous data on error to avoid flicker
			}
		}

		// Initial fetch
		doFetch(true)

		// Set up polling (only refresh data, don't change loading states)
		if (refreshInterval > 0) {
			pollIntervalRef.current = setInterval(() => {
				if (!cancelled && mountedRef.current && walletAddress && hasLoadedOrdersOnce) {
					doFetch(false) // Polling refresh, not initial load
				}
			}, refreshInterval)
		}

		return () => {
			cancelled = true
			if (pollIntervalRef.current) {
				clearInterval(pollIntervalRef.current)
				pollIntervalRef.current = null
			}
		}
	}, [walletAddress, enabled, refreshInterval, fetchOrders, hasLoadedOrdersOnce])

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			mountedRef.current = false
			if (fetchTimeoutRef.current) {
				clearTimeout(fetchTimeoutRef.current)
			}
			if (pollIntervalRef.current) {
				clearInterval(pollIntervalRef.current)
			}
		}
	}, [])

	// Track when positions have loaded for the first time (one-time flag)
	useEffect(() => {
		if (!hasLoadedPositionsOnce && !positionsState.isLoading && positionsState.positions !== undefined) {
			setHasLoadedPositionsOnce(true)
			pfLog('Positions initial load complete', { count: positionsState.positions?.length || 0 })
		}
	}, [hasLoadedPositionsOnce, positionsState.isLoading, positionsState.positions])

	// Compute active orders count
	const activeOrdersCount = ordersBuckets.reduce((sum, bucket) => sum + (bucket?.orders?.length || 0), 0)
	
	// Combined loading state - keep loading until both positions and orders have loaded at least once
	// But don't show loading during polling refreshes after initial load
	const isLoading = (!hasLoadedPositionsOnce && positionsState.isLoading) || (!hasLoadedOrdersOnce && isLoadingOrders)

	// Combined error state
	const error = positionsState.error || ordersError
	
	// Combined hasLoadedOnce - both must have completed initial fetch (one-time flag)
	const hasLoadedOnce = hasLoadedPositionsOnce && hasLoadedOrdersOnce
	
	pfLog('Portfolio data state', {
		hasLoadedPositionsOnce,
		hasLoadedOrdersOnce,
		hasLoadedOnce,
		positionsCount: positionsState.positions?.length || 0,
		ordersBucketCount: ordersBuckets.length,
		isLoadingPositions: positionsState.isLoading,
		isLoadingOrders: isLoadingOrders,
		isLoading
	})

	return {
		positions: positionsState.positions,
		ordersBuckets,
		activeOrdersCount,
		isLoadingPositions: positionsState.isLoading,
		isLoadingOrders: isLoadingOrders || !hasLoadedOrdersOnce,
		isLoading,
		hasLoadedOnce,
		error,
		lastUpdated,
		refreshOrders,
	}
}

