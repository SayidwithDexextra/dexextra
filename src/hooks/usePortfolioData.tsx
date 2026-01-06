'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useWallet } from './useWallet'
import { usePositions } from './usePositions'
import { CHAIN_CONFIG, CONTRACT_ADDRESSES, populateMarketInfoClient } from '@/lib/contractConfig'

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
const goddLog = (step: number, message: string, data?: any) => {
	console.log(`[GODD][STEP${step}] ${message}`, data ?? '')
}

// Global state to coordinate fetching across all hook instances
const globalState = {
	marketInfoPopulated: false,
	marketInfoPopulating: null as Promise<void> | null,
	ordersCache: new Map<string, { data: PortfolioOrdersBucket[]; ts: number }>(),
	ordersFetching: new Map<string, Promise<PortfolioOrdersBucket[]>>(),
	lastOrdersFetch: new Map<string, number>(),
}

const ORDERS_CACHE_TTL = 10000 // 10 seconds cache
const MAX_RETRIES = 3
const RETRY_DELAY_BASE = 1000 // 1 second base delay

function isActiveStatus(status: any): boolean {
	const s = String(status || '').trim().toUpperCase()
	if (!s) return true
	return !['FILLED', 'CANCELLED', 'CANCELED', 'EXPIRED', 'REJECTED'].includes(s)
}

type OrdersSessionCachePayload = {
	version: 1
	chainId: string | number
	walletAddress: string
	ts: number
	buckets: PortfolioOrdersBucket[]
}

/**
 * Centralized hook for portfolio data (positions + orders)
 * Ensures consistent loading, retry logic, and prevents race conditions
 */
export function usePortfolioData(options?: { enabled?: boolean; refreshInterval?: number }): PortfolioData {
	const { walletData } = useWallet() as any
	const walletAddress = walletData?.address
	const enabled = options?.enabled !== false

	// Use the existing usePositions hook for positions
	const positionsState = usePositions(undefined, { enabled, pollIntervalMs: options?.refreshInterval })

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
	const retryCountRef = useRef(0)
	const eventRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const lastEventRefreshAtRef = useRef<number>(0)
	const didHydrateSessionRef = useRef<string>('') // key to avoid rehydrating repeatedly

	const getSessionKey = useCallback((addr: string) => {
		const chainId = String((CHAIN_CONFIG as any)?.chainId ?? 'unknown')
		// Keep key stable per tab (sessionStorage is tab-scoped anyway)
		return `portfolio:orders:v1:${chainId}:${String(addr).toLowerCase()}`
	}, [])

	const tryHydrateFromSession = useCallback((addr: string) => {
		if (typeof window === 'undefined') return false
		const key = getSessionKey(addr)
		if (didHydrateSessionRef.current === key) return false
		didHydrateSessionRef.current = key
		try {
			const raw = window.sessionStorage.getItem(key)
			if (!raw) return false
			const payload = JSON.parse(raw) as OrdersSessionCachePayload
			if (!payload || payload.version !== 1) return false
			if (String(payload.walletAddress || '').toLowerCase() !== String(addr).toLowerCase()) return false
			if (!Array.isArray(payload.buckets)) return false
			// Apply immediately (UI tweak: avoid showing "Loading open orders")
			setOrdersBuckets(payload.buckets)
			setHasLoadedOrdersOnce(true)
			setIsLoadingOrders(false)
			setOrdersError(null)
			setLastUpdated(payload.ts || Date.now())
			// eslint-disable-next-line no-console
			console.log('[RealTimeToken] cache:orders:rehydrate', {
				walletAddress: addr,
				bucketCount: payload.buckets.length,
				totalOrders: payload.buckets.reduce((sum, b) => sum + (b?.orders?.length || 0), 0),
				ageMs: Date.now() - Number(payload.ts || 0),
			})
			return true
		} catch {
			return false
		}
	}, [getSessionKey])

	const persistToSession = useCallback((addr: string, buckets: PortfolioOrdersBucket[]) => {
		if (typeof window === 'undefined') return
		try {
			const key = getSessionKey(addr)
			const payload: OrdersSessionCachePayload = {
				version: 1,
				chainId: String((CHAIN_CONFIG as any)?.chainId ?? 'unknown'),
				walletAddress: addr,
				ts: Date.now(),
				buckets,
			}
			window.sessionStorage.setItem(key, JSON.stringify(payload))
			// eslint-disable-next-line no-console
			console.log('[RealTimeToken] cache:orders:persist', {
				walletAddress: addr,
				bucketCount: buckets.length,
				totalOrders: buckets.reduce((sum, b) => sum + (b?.orders?.length || 0), 0),
			})
		} catch {}
	}, [getSessionKey])

	// Ensure market info is populated before fetching orders.
	// Even though orders come from Supabase, MARKET_INFO is still required for
	// resolving per-market OrderBook addresses used by gasless/session flows.
	const ensureMarketInfoPopulated = useCallback(async (): Promise<void> => {
		// Fast path: already populated in this runtime
		if (globalState.marketInfoPopulated) return

		// If another call is already in-flight, wait for it
		if (globalState.marketInfoPopulating) {
			try {
				await globalState.marketInfoPopulating
			} catch {
				// ignore populate errors here; MARKET_INFO will simply remain empty
			}
			return
		}

		// If CONTRACT_ADDRESSES already has markets, mark as populated
		try {
			const initial = Object.values((CONTRACT_ADDRESSES as any).MARKET_INFO || {}) as any[]
			if (initial.length > 0) {
				globalState.marketInfoPopulated = true
				return
			}
		} catch {
			// fall through to client-side population attempt
		}

		// One-time best-effort client-side population from Supabase
		const populatePromise = (async () => {
			try {
				const added = await populateMarketInfoClient()
				if (DEBUG_PORTFOLIO_LOGS) {
					console.log('[ALTKN][PortfolioData] populateMarketInfoClient completed', { marketsAdded: added })
				}
			} catch (e: any) {
				if (DEBUG_PORTFOLIO_LOGS) {
					console.warn('[ALTKN][PortfolioData] populateMarketInfoClient failed', e?.message || e)
				}
			} finally {
				globalState.marketInfoPopulated = true
				globalState.marketInfoPopulating = null
			}
		})()

		globalState.marketInfoPopulating = populatePromise
		try {
			await populatePromise
		} catch {
			// errors already logged above; callers can proceed with empty MARKET_INFO
		}
	}, [])

	// Fetch orders with retry logic
	const fetchOrders = useCallback(async (address: string, retryAttempt = 0): Promise<PortfolioOrdersBucket[]> => {
		goddLog(1, 'fetchOrders invoked', { address, retryAttempt })
		const cacheKey = `${address.toLowerCase()}::${Date.now() - (Date.now() % ORDERS_CACHE_TTL)}`
		const cached = globalState.ordersCache.get(address.toLowerCase())
		
		// Check cache first
		if (cached && (Date.now() - cached.ts) < ORDERS_CACHE_TTL) {
			goddLog(2, 'Returning cached orders snapshot', { bucketCount: cached.data.length, ageMs: Date.now() - cached.ts })
			pfLog('Using cached orders', { ageMs: Date.now() - cached.ts, bucketCount: cached.data.length })
			return cached.data
		}

		// Check if already fetching for this address
		const inFlight = globalState.ordersFetching.get(address.toLowerCase())
		if (inFlight) {
			goddLog(3, 'Awaiting in-flight orders fetch', { address })
			pfLog('Orders fetch already in progress, waiting...')
			return await inFlight
		}

		// Ensure market info is populated before fetching
		try {
			goddLog(4, 'Ensuring market info populated before fetch')
			await ensureMarketInfoPopulated()
		} catch (error: any) {
			pfWarn('Market info population failed, proceeding anyway:', error)
		}

		const fetchPromise = (async (): Promise<PortfolioOrdersBucket[]> => {
			try {
				goddLog(5, 'Dispatching getUserActiveOrdersAllMarkets call', { address, attempt: retryAttempt + 1 })
				pfLog('Fetching orders', { address: address.slice(0, 6) + '...', attempt: retryAttempt + 1 })
				const startTime = Date.now()
				
				const resp = await fetch(`/api/orders/active-buckets?trader=${encodeURIComponent(address)}&limit=800&perMarket=50`, { method: 'GET' })
				if (!resp.ok) throw new Error(`orders active-buckets non-200: ${resp.status}`)
				const json = await resp.json()
				const buckets = (json as any)?.buckets || []
				const duration = Date.now() - startTime
				
				goddLog(6, 'Received buckets from all markets', {
					bucketCount: buckets.length,
					totalOrders: buckets.reduce((sum, b) => sum + (b?.orders?.length || 0), 0),
					durationMs: duration
				})
				pfLog('Orders fetched successfully', { 
					bucketCount: buckets.length, 
					totalOrders: buckets.reduce((sum, b) => sum + (b?.orders?.length || 0), 0),
					durationMs: duration 
				})

				// Cache the result
				goddLog(7, 'Caching fresh orders snapshot', { address, bucketCount: buckets.length })
				globalState.ordersCache.set(address.toLowerCase(), { data: buckets, ts: Date.now() })
				globalState.lastOrdersFetch.set(address.toLowerCase(), Date.now())
				retryCountRef.current = 0 // Reset retry count on success

				return buckets
			} catch (error: any) {
				goddLog(8, 'Orders fetch failure', { address, error: error?.message })
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

	// Refresh function (supports silent refresh to avoid UI spinners during SWR / realtime events)
	const refreshOrders = useCallback(async (opts?: { silent?: boolean }) => {
		if (!walletAddress || !enabled) return
		const silent = Boolean(opts?.silent)
		// eslint-disable-next-line no-console
		console.log('[RealTimeToken] portfolio:refreshOrders:start', { walletAddress })
		goddLog(9, 'refreshOrders invoked', { address: walletAddress })
		
		// Clear cache to force fresh fetch
		globalState.ordersCache.delete(walletAddress.toLowerCase())
		globalState.ordersFetching.delete(walletAddress.toLowerCase())
		
		try {
			// Only show spinner on the very first load; all subsequent refreshes should be silent to avoid flicker.
			if (!silent && !hasLoadedOrdersOnce) setIsLoadingOrders(true)
			setOrdersError(null)
			
			const buckets = await fetchOrders(walletAddress)
			
			if (!mountedRef.current) return
			
			setOrdersBuckets(buckets)
			persistToSession(walletAddress, buckets)
			// eslint-disable-next-line no-console
			console.log('[RealTimeToken] portfolio:ordersBuckets:applied', {
				walletAddress,
				bucketCount: buckets.length,
				totalOrders: buckets.reduce((sum, b) => sum + (b?.orders?.length || 0), 0),
			})
			goddLog(10, 'refreshOrders applied new buckets', { bucketCount: buckets.length })
			setLastUpdated(Date.now())
			setIsLoadingOrders(false)
			setHasLoadedOrdersOnce(true)
		} catch (error: any) {
			if (!mountedRef.current) return
			
			pfError('Manual refresh failed:', error)
			goddLog(11, 'refreshOrders failed', { error: error?.message })
			setOrdersError(error?.message || 'Failed to refresh orders')
			setIsLoadingOrders(false)
			setHasLoadedOrdersOnce(true)
		}
	}, [walletAddress, enabled, fetchOrders, hasLoadedOrdersOnce, persistToSession])

	// Session-cache hydration + SWR revalidation: hydrate immediately, then silently refresh live data.
	useEffect(() => {
		if (!enabled || !walletAddress) return
		const didHydrate = tryHydrateFromSession(walletAddress)
		if (didHydrate) {
			// eslint-disable-next-line no-console
			console.log('[RealTimeToken] cache:orders:revalidate:start', { walletAddress })
			void refreshOrders({ silent: true })
		}
	}, [enabled, walletAddress, tryHydrateFromSession, refreshOrders])

	// Event-driven refresh (no polling): when realtime pipeline dispatches 'ordersUpdated',
	// refresh portfolio orders. Debounced to avoid storms from bursty event logs.
	useEffect(() => {
		if (typeof window === 'undefined') return
		if (!enabled || !walletAddress) return

		const onOrdersUpdated = (e: any) => {
			const detail = (e as CustomEvent)?.detail as any
			// eslint-disable-next-line no-console
			console.log('[RealTimeToken] portfolio:ordersUpdated:received', {
				traceId: detail?.traceId,
				symbol: detail?.symbol,
				source: detail?.source,
				txHash: detail?.txHash,
				blockNumber: detail?.blockNumber,
				timestamp: detail?.timestamp,
			})
			const now = Date.now()
			// Basic rate limit (events can arrive in bursts)
			if (now - lastEventRefreshAtRef.current < 250) return
			lastEventRefreshAtRef.current = now

			// Instant state patch for user-initiated cancels (prevents "ghost order" until backend catches up)
			try {
				const eventType = String(detail?.eventType || detail?.reason || '').trim()
				const symbolHint = String(detail?.symbol || '').trim()
				const orderId = detail?.orderId !== undefined ? String(detail.orderId) : ''
				if ((eventType === 'OrderCancelled' || eventType === 'cancel') && symbolHint && orderId) {
					setOrdersBuckets((prev) => {
						const next = Array.isArray(prev) ? [...prev] : []
						const symUpper = symbolHint.toUpperCase()
						for (let i = next.length - 1; i >= 0; i--) {
							const b: any = next[i]
							if (String(b?.symbol || '').toUpperCase() !== symUpper) continue
							const orders = Array.isArray(b?.orders) ? b.orders : []
							const filtered = orders.filter((o: any) => String(o?.id || o?.orderId || o?.order_id || '') !== orderId)
							if (filtered.length === 0) {
								next.splice(i, 1)
							} else if (filtered.length !== orders.length) {
								next[i] = { ...b, orders: filtered }
							}
						}
						persistToSession(walletAddress, next as any)
						// eslint-disable-next-line no-console
						console.log('[RealTimeToken] portfolio:ordersBuckets:patched:cancel', { orderId, symbol: symUpper, bucketCount: next.length })
						return next
					})
				}
			} catch {}

			if (eventRefreshTimerRef.current) clearTimeout(eventRefreshTimerRef.current)
			eventRefreshTimerRef.current = setTimeout(() => {
				eventRefreshTimerRef.current = null
				const symbolHint = String(detail?.symbol || '').trim()
				if (symbolHint) {
					// eslint-disable-next-line no-console
					console.log('[RealTimeToken] portfolio:ordersUpdated:refreshMarket:run', { traceId: detail?.traceId, symbol: symbolHint })
					;(async () => {
						try {
							// Per-market refresh via Supabase-backed API (no on-chain reads)
							const params = new URLSearchParams({ metricId: symbolHint, trader: walletAddress, limit: '200' })
							const res = await fetch(`/api/orders/query?${params.toString()}`, { method: 'GET' })
							if (!res.ok) throw new Error(`orders query non-200: ${res.status}`)
							const data = await res.json()
							const raw = (data as any)?.orders || []
							const active = (raw || []).filter((o: any) => isActiveStatus(o?.order_status))
							const bucket = {
								symbol: String((data as any)?.resolvedMarketId || symbolHint).toUpperCase(),
								token: String((data as any)?.resolvedMarketId || symbolHint),
								orders: active,
							}
							if (!mountedRef.current) return
							setOrdersBuckets((prev) => {
								const next = Array.isArray(prev) ? [...prev] : []
								const key = String(bucket.symbol || '').toUpperCase()
								const idx = next.findIndex((b: any) => String(b?.symbol || '').toUpperCase() === key)
								const hasOrders = Array.isArray(bucket.orders) && bucket.orders.length > 0
								if (idx >= 0) {
									if (hasOrders) next[idx] = bucket as any
									else next.splice(idx, 1)
								} else {
									if (hasOrders) next.push(bucket as any)
								}
								// eslint-disable-next-line no-console
								console.log('[RealTimeToken] portfolio:ordersBuckets:patched', {
									traceId: detail?.traceId,
									symbol: key,
									bucketCount: next.length,
									totalOrders: next.reduce((sum: number, b: any) => sum + (b?.orders?.length || 0), 0),
								})
								persistToSession(walletAddress, next as any)
								return next
							})
							setLastUpdated(Date.now())
						} catch {
							// fallback to full refresh
							// eslint-disable-next-line no-console
							console.log('[RealTimeToken] portfolio:ordersUpdated:refreshMarket:fallbackFull', { traceId: detail?.traceId })
							void refreshOrders({ silent: true })
						}
					})()
				} else {
					// eslint-disable-next-line no-console
					console.log('[RealTimeToken] portfolio:ordersUpdated:refreshOrders:run', { traceId: detail?.traceId })
					void refreshOrders({ silent: true })
				}
			}, 50)
		}

		window.addEventListener('ordersUpdated', onOrdersUpdated as EventListener)
		return () => {
			window.removeEventListener('ordersUpdated', onOrdersUpdated as EventListener)
			if (eventRefreshTimerRef.current) {
				clearTimeout(eventRefreshTimerRef.current)
				eventRefreshTimerRef.current = null
			}
		}
	}, [enabled, walletAddress, refreshOrders])

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

		return () => {
			cancelled = true
		}
	}, [walletAddress, enabled, fetchOrders, hasLoadedOrdersOnce])

	// Track mount/unmount (strict-mode safe)
	useEffect(() => {
		mountedRef.current = true
		return () => {
			mountedRef.current = false
			if (fetchTimeoutRef.current) {
				clearTimeout(fetchTimeoutRef.current)
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

