'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Token } from './types'
import { env } from '@/lib/env'

// Chain logo mapping for header icons
const CHAIN_LOGOS: Record<string, string> = {
  Polygon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/polygon-matic-logo.png',
  Arbitrum: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/arbitrum-arb-logo.png',
  Ethereum: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/ethereum-eth-logo.png',
  Hyperliquid: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/HyperlIquid.png',
}

interface DepositTokenSelectProps {
  isOpen: boolean
  onClose: () => void
  availableTokens: Token[]
  selectedToken: Token
  onSelectToken: (t: Token) => void
  onContinue: () => void
}

export default function DepositTokenSelect({
  isOpen,
  onClose,
  availableTokens,
  selectedToken,
  onSelectToken,
  onContinue
}: DepositTokenSelectProps) {
  const [localSelected, setLocalSelected] = useState<string>(selectedToken?.symbol || '')
  const [openChain, setOpenChain] = useState<string | null>(null)
  const [isAnimating, setIsAnimating] = useState(false)

  const handleSelect = (t: Token) => {
    setLocalSelected(t.symbol)
    onSelectToken(t)
  }

  // Group tokens by chain
  const chainToTokens = useMemo(() => {
    return availableTokens.reduce<Record<string, Token[]>>((acc, t) => {
      const chain = t.chain || 'Other'
      if (!acc[chain]) acc[chain] = []
      acc[chain].push(t)
      return acc
    }, {})
  }, [availableTokens])

  // Ensure Hyperliquid appears only if tokens exist; no forced empty section

  const chainNames = useMemo(() => Object.keys(chainToTokens), [chainToTokens])

  const toggleChain = (chain: string) => {
    setOpenChain((prev) => (prev === chain ? null : chain))
  }

  // Walkthrough hook: open a specific chain section (e.g. Arbitrum) on demand.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: any) => {
      const chain = String(e?.detail?.chain || '').trim();
      if (!chain) return;
      setOpenChain(chain);
    };
    window.addEventListener('walkthrough:deposit:openChain', handler as any);
    return () => window.removeEventListener('walkthrough:deposit:openChain', handler as any);
  }, []);

  // Keep local selection in sync (component stays mounted even when closed)
  useEffect(() => {
    setLocalSelected(selectedToken?.symbol || '')
  }, [selectedToken?.symbol])

  // Reset expanded section each time modal opens (avoids surprising stale UI)
  useEffect(() => {
    if (!isOpen) {
      setOpenChain(null)
    }
  }, [isOpen])

  // Match SearchModal animation behavior (fade/scale in)
  useEffect(() => {
    if (isOpen) {
      setIsAnimating(true)
    } else {
      setIsAnimating(false)
    }
  }, [isOpen])

  // Preconnect + preload token/chain logos so they're cached before the modal is shown.
  // This runs even when `isOpen` is false (because the component remains mounted).
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Preconnect once to the Supabase storage host used for logos
    const supabaseHost = 'https://khhknmobkkkvvogznxdj.supabase.co'
    const existingPreconnect = document.head.querySelector(
      `link[rel="preconnect"][href="${supabaseHost}"]`
    )
    if (!existingPreconnect) {
      const link = document.createElement('link')
      link.rel = 'preconnect'
      link.href = supabaseHost
      link.crossOrigin = ''
      document.head.appendChild(link)
    }

    const urls = new Set<string>()
    for (const url of Object.values(CHAIN_LOGOS)) {
      if (typeof url === 'string' && url) urls.add(url)
    }
    for (const t of availableTokens) {
      const url = (t as any)?.icon
      if (typeof url === 'string' && url.startsWith('http')) urls.add(url)
    }

    // Kick off downloads; browser will cache them for the modal.
    // Keep it simple (small # of assets).
    for (const url of urls) {
      const img = new Image()
      img.decoding = 'async'
      img.src = url
    }
  }, [availableTokens])

  // Determine if a chain is enabled based on presence of its Spoke Vault address
  const chainHasVault = (chain: string) => {
    const c = (chain || '').toLowerCase()
    if (c === 'polygon') return false
    if (c === 'arbitrum') return !!env.SPOKE_ARBITRUM_VAULT_ADDRESS
    if (c === 'ethereum') return !!env.SPOKE_ETHEREUM_VAULT_ADDRESS
    if (c === 'hyperliquid') return !!env.SPOKE_HYPERLIQUID_VAULT_ADDRESS
    return true
  }

  if (!isOpen) return null

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-500 ${isAnimating ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* Sophisticated Backdrop with Subtle Gradient */}
      <div 
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ${isAnimating ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      
      {/* Main Modal Container - Sophisticated Minimal Design */}
      <div
        className={`group relative z-10 w-full max-w-md bg-[#0F0F0F] rounded-xl border border-[#222222] shadow-2xl transform transition-all duration-200 hover:shadow-3xl ${isAnimating ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
      >
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#1A1A1A]">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-[#1A1A1A] rounded-md flex items-center justify-center flex-shrink-0">
              <img 
                src="/Dexicon/LOGO-Dexetera-05.svg" 
                alt="Dexetera" 
                className="w-5 h-5 opacity-90"
              />
            </div>
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
            <h2 className="text-sm font-medium text-white tracking-wide">
              Select Asset to Deposit
            </h2>
            <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-2 py-1 rounded">
              {availableTokens.length}
            </div>
          </div>
          
          {/* Close Button with Sophisticated Hover */}
          <button
            onClick={onClose}
            className="group flex items-center justify-center w-8 h-8 bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded-md transition-all duration-200"
          >
            <svg className="w-4 h-4 text-[#808080] group-hover:text-white transition-colors duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Chains */}
        <div className="p-6">
          {chainNames.map((chain) => {
            const tokens = chainToTokens[chain]
            const opened = openChain === chain
            return (
              <div key={chain} className="mb-4">
                {/* Chain header row */}
                <button
                  data-walkthrough={chain === 'Arbitrum' ? 'deposit-chain-arbitrum' : undefined}
                  className="w-full flex items-center justify-between p-3 rounded-md border bg-[#0F0F0F] hover:bg-[#1A1A1A] border-[#222222] hover:border-[#333333] transition-all duration-200"
                  onClick={() => toggleChain(chain)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                    {!!CHAIN_LOGOS[chain] && (
                      <div className="w-5 h-5 bg-[#1A1A1A] rounded-md flex items-center justify-center overflow-hidden">
                        <img
                          src={CHAIN_LOGOS[chain]}
                          alt={`${chain} logo`}
                          className="w-4 h-4"
                          width={16}
                          height={16}
                          decoding="async"
                          loading="eager"
                          fetchPriority="high"
                        />
                      </div>
                    )}
                    <h4 className="text-xs font-medium text-white uppercase tracking-wide">{chain}</h4>
                    <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                      {tokens.length}
                    </div>
                  </div>
                  <svg
                    className={`w-3 h-3 text-[#606060] transition-transform duration-200 ${opened ? 'rotate-180' : 'rotate-0'}`}
                    viewBox="0 0 24 24" fill="none"
                  >
                    <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>

                {/* Chain token grid */}
                <div className={`overflow-hidden transition-all duration-300 ${opened ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0'}`}>
                  {/* Coming soon banner when vault not configured for this chain */}
                  {!chainHasVault(chain) && (
                    <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200 mt-3 mb-3">
                      <div className="flex items-center justify-between p-2.5">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-yellow-400" />
                          <span className="text-[11px] font-medium text-[#808080]">
                            {chain} support is coming soon
                          </span>
                        </div>
                        <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                          Preview
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 mt-3">
                    {tokens.map((t) => {
                      const isActive = localSelected === t.symbol && selectedToken?.chain === t.chain
                      return (
                        <div
                          key={`${t.chain}-${t.symbol}`}
                          data-walkthrough={
                            t.chain === 'Arbitrum' && t.symbol === 'USDC'
                              ? 'deposit-token-arbitrum-usdc'
                              : undefined
                          }
                          className={[
                            'group rounded-md border transition-all duration-200',
                            'bg-[#0F0F0F] hover:bg-[#1A1A1A]',
                            isActive ? 'border-[#333333]' : 'border-[#222222] hover:border-[#333333]'
                          ].join(' ')}
                        >
                          <button 
                            className="w-full flex items-center justify-between p-3"
                            onClick={() => handleSelect(t)}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? 'bg-green-400' : 'bg-[#404040]'}`} />
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <div className="w-6 h-6 bg-[#1A1A1A] rounded-full flex items-center justify-center overflow-hidden">
                                  <img 
                                    src={t.icon} 
                                    alt={t.symbol} 
                                    className="w-6 h-6 rounded-full"
                                    width={24}
                                    height={24}
                                    decoding="async"
                                    loading="eager"
                                    fetchPriority="high"
                                  />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <span className="text-[11px] font-medium text-white block truncate">
                                    {t.symbol}
                                  </span>
                                  <span className="text-[10px] text-[#606060] block truncate">
                                    {t.name || 'Stablecoin'}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <svg className="w-3 h-3 text-[#404040] group-hover:text-[#606060] transition-colors duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                          
                          {/* Expandable Details on Hover */}
                          <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-16 overflow-hidden transition-all duration-200">
                            <div className="px-3 pb-3 border-t border-[#1A1A1A]">
                              <div className="text-[9px] pt-2">
                                <span className="text-[#606060]">
                                  {isActive ? 'Selected for deposit' : `Click to select ${t.symbol} on ${t.chain}`}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}

          {/* Continue */}
          <div className="px-0">
            <button
              data-walkthrough="deposit-continue"
              onClick={onContinue}
              className="group relative w-full flex items-center justify-center gap-2 p-3 rounded-lg border bg-green-500 hover:bg-green-600 border-green-500 hover:border-green-600 transition-all duration-200"
            >
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
              <span className="text-[11px] font-medium text-black">Continue</span>
              <svg className="w-3 h-3 text-black group-hover:translate-x-0.5 transition-transform duration-200" viewBox="0 0 24 24" fill="none">
                <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

