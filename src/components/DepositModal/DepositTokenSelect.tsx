'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Token } from './types'
import { env } from '@/lib/env'

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

  if (!isOpen) return null

  const handleSelect = (t: Token) => {
    setLocalSelected(t.symbol)
    onSelectToken(t)
  }

  // Chain logo mapping for header icons
  const CHAIN_LOGOS: Record<string, string> = {
    Polygon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/polygon-matic-logo.png',
    Arbitrum: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/arbitrum-arb-logo.png',
    Ethereum: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/ethereum-eth-logo.png',
    Hyperliquid: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/HyperlIquid.png',
  }

  // Group tokens by chain
  const chainToTokens = availableTokens.reduce<Record<string, Token[]>>((acc, t) => {
    const chain = t.chain || 'Other'
    if (!acc[chain]) acc[chain] = []
    acc[chain].push(t)
    return acc
  }, {})

  // Ensure Hyperliquid appears only if tokens exist; no forced empty section

  const chainNames = Object.keys(chainToTokens)
  const [openChain, setOpenChain] = useState<string | null>(null)

  const toggleChain = (chain: string) => {
    setOpenChain((prev) => (prev === chain ? null : chain))
  }

  // Determine if a chain is enabled based on presence of its Spoke Vault address
  const chainHasVault = (chain: string) => {
    const c = (chain || '').toLowerCase()
    if (c === 'polygon') return !!env.SPOKE_POLYGON_VAULT_ADDRESS
    if (c === 'arbitrum') return !!env.SPOKE_ARBITRUM_VAULT_ADDRESS
    if (c === 'ethereum') return !!env.SPOKE_ETHEREUM_VAULT_ADDRESS
    if (c === 'hyperliquid') return !!env.SPOKE_HYPERLIQUID_VAULT_ADDRESS
    return true
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Sophisticated Backdrop with Subtle Gradient */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-all duration-300"
        onClick={onClose}
      />
      
      {/* Main Modal Container - Sophisticated Minimal Design */}
      <div className="relative z-10 w-full max-w-md bg-[#0F0F0F] rounded-xl border border-[#222222] shadow-2xl transform transition-all duration-300 hover:shadow-3xl">
        
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

