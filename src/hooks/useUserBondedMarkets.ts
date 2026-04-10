'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useWallet } from '@/hooks/useWallet'
import { ethers } from 'ethers'
import { getRpcUrl, getChainId } from '@/lib/network'

export interface BondedMarket {
  id: string
  marketIdentifier: string
  symbol: string
  marketAddress: string | null
  marketStatus: string
  settlementDate: Date | null
  proposedSettlementValue: number | null
  alternativeSettlementValue: number | null
  settlementDisputed: boolean
  bondRole: 'proposer' | 'challenger' | 'both'
  bondAmount: number
  createdAt: Date
  isActive: boolean
  timeToSettlement: number | null // milliseconds, null if settled or no date
}

export interface BondSummary {
  totalBonded: number
  activeMarkets: number
  settledMarkets: number
  proposerCount: number
  challengerCount: number
  wonCount: number
  lostCount: number
}

export interface UseUserBondedMarketsResult {
  markets: BondedMarket[]
  summary: BondSummary
  isLoading: boolean
  error: string | null
  refetch: () => void
}

const SETTLEMENT_ABI = [
  {
    type: 'function',
    name: 'getProposedSettlementPrice',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { type: 'uint256', name: 'price' },
      { type: 'address', name: 'proposer' },
      { type: 'bool', name: 'proposed' },
    ],
  },
  {
    type: 'function',
    name: 'getActiveChallengeInfo',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { type: 'bool', name: 'active' },
      { type: 'address', name: 'challengerAddr' },
      { type: 'uint256', name: 'challengedPriceVal' },
      { type: 'uint256', name: 'bondEscrowed' },
      { type: 'bool', name: 'resolved' },
      { type: 'bool', name: 'won' },
    ],
  },
  {
    type: 'function',
    name: 'proposerBond',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'challengerBond',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
]

export function useUserBondedMarkets(): UseUserBondedMarketsResult {
  const { walletData } = useWallet() as any
  const walletAddress = walletData?.address?.toLowerCase() || null
  const isConnected = Boolean(walletData?.isConnected && walletAddress)

  const [markets, setMarkets] = useState<BondedMarket[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick(t => t + 1), [])

  const fetchBondedMarkets = useCallback(async () => {
    if (!walletAddress || !isConnected) {
      setMarkets([])
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // Fetch markets where user is proposer or challenger
      // Check proposed_settlement_by and alternative_settlement_by fields
      const { data: proposerMarkets, error: proposerError } = await supabase
        .from('markets')
        .select(`
          id,
          market_identifier,
          symbol,
          market_address,
          market_status,
          settlement_date,
          proposed_settlement_value,
          proposed_settlement_by,
          alternative_settlement_value,
          alternative_settlement_by,
          settlement_disputed,
          settlement_value,
          created_at,
          is_active,
          market_config
        `)
        .or(`proposed_settlement_by.ilike.${walletAddress},alternative_settlement_by.ilike.${walletAddress}`)
        .order('settlement_date', { ascending: true })

      if (proposerError) {
        console.error('[useUserBondedMarkets] Error fetching markets:', proposerError)
      }

      const provider = new ethers.JsonRpcProvider(getRpcUrl(), getChainId())
      const bondedMarkets: BondedMarket[] = []
      const now = Date.now()

      for (const market of proposerMarkets || []) {
        const isProposer = market.proposed_settlement_by?.toLowerCase() === walletAddress
        const isChallenger = market.alternative_settlement_by?.toLowerCase() === walletAddress
        
        if (!isProposer && !isChallenger) continue

        let bondAmount = 0
        
        // Try to get bond amount from on-chain if market has address
        if (market.market_address) {
          try {
            const contract = new ethers.Contract(market.market_address, SETTLEMENT_ABI, provider)
            
            if (isProposer) {
              try {
                const proposerBond = await contract.proposerBond()
                bondAmount += Number(ethers.formatUnits(proposerBond, 6))
              } catch {}
            }
            
            if (isChallenger) {
              try {
                const [, , , bondEscrowed] = await contract.getActiveChallengeInfo()
                bondAmount += Number(ethers.formatUnits(bondEscrowed, 6))
              } catch {
                // Try fallback to challengerBond
                try {
                  const challengerBond = await contract.challengerBond()
                  bondAmount += Number(ethers.formatUnits(challengerBond, 6))
                } catch {}
              }
            }
          } catch (e) {
            // Fallback: estimate from market config or default
            const cfg = market.market_config as Record<string, any> || {}
            bondAmount = Number(cfg.bond_amount || cfg.proposer_bond || cfg.challenger_bond || 100)
          }
        }

        const settlementDate = market.settlement_date ? new Date(market.settlement_date) : null
        const timeToSettlement = settlementDate ? settlementDate.getTime() - now : null

        bondedMarkets.push({
          id: market.id,
          marketIdentifier: market.market_identifier,
          symbol: market.symbol || market.market_identifier?.slice(0, 12) || 'Unknown',
          marketAddress: market.market_address,
          marketStatus: market.market_status,
          settlementDate,
          proposedSettlementValue: market.proposed_settlement_value,
          alternativeSettlementValue: market.alternative_settlement_value,
          settlementDisputed: market.settlement_disputed || false,
          bondRole: isProposer && isChallenger ? 'both' : isProposer ? 'proposer' : 'challenger',
          bondAmount,
          createdAt: new Date(market.created_at),
          isActive: market.is_active || false,
          timeToSettlement: timeToSettlement && timeToSettlement > 0 ? timeToSettlement : null,
        })
      }

      // Sort by settlement date (upcoming first, then settled)
      bondedMarkets.sort((a, b) => {
        if (a.timeToSettlement && !b.timeToSettlement) return -1
        if (!a.timeToSettlement && b.timeToSettlement) return 1
        if (a.timeToSettlement && b.timeToSettlement) return a.timeToSettlement - b.timeToSettlement
        return b.createdAt.getTime() - a.createdAt.getTime()
      })

      setMarkets(bondedMarkets)
    } catch (e: any) {
      console.error('[useUserBondedMarkets] Error:', e)
      setError(e?.message || 'Failed to fetch bonded markets')
    } finally {
      setIsLoading(false)
    }
  }, [walletAddress, isConnected])

  useEffect(() => {
    fetchBondedMarkets()
  }, [fetchBondedMarkets, tick])

  const summary = useMemo<BondSummary>(() => {
    if (markets.length === 0) {
      return {
        totalBonded: 0,
        activeMarkets: 0,
        settledMarkets: 0,
        proposerCount: 0,
        challengerCount: 0,
        wonCount: 0,
        lostCount: 0,
      }
    }

    const settled = markets.filter(m => m.marketStatus === 'SETTLED')
    const active = markets.filter(m => m.marketStatus !== 'SETTLED')
    const proposer = markets.filter(m => m.bondRole === 'proposer' || m.bondRole === 'both')
    const challenger = markets.filter(m => m.bondRole === 'challenger' || m.bondRole === 'both')

    return {
      totalBonded: markets.reduce((sum, m) => sum + m.bondAmount, 0),
      activeMarkets: active.length,
      settledMarkets: settled.length,
      proposerCount: proposer.length,
      challengerCount: challenger.length,
      wonCount: 0, // TODO: Calculate based on settlement outcome
      lostCount: 0,
    }
  }, [markets])

  return {
    markets,
    summary,
    isLoading,
    error,
    refetch,
  }
}
