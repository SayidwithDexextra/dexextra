export interface WalletData {
  address: string | null
  balance: string | null
  isConnected: boolean
  isConnecting: boolean
  chainId: number | null
  ensName?: string | null
  avatar?: string | null
  userProfile?: UserProfile | null
}

// Use the full UserProfile for the connected wallet (includes private fields like email).
import type { UserProfile as FullUserProfile } from './userProfile'
export type UserProfile = FullUserProfile

export interface WalletProvider {
  // Stable unique identifier (do not display to users).
  // Examples: "eip6963:<uuid>", "walletconnect", "static:metamask"
  id: string
  name: string
  icon: string
  // Optional icon URL (often a data: URI from EIP-6963)
  iconUrl?: string
  // Optional wallet origin identifier from EIP-6963 (reverse-DNS)
  rdns?: string
  // Optional classification (useful for UI ordering / debugging)
  kind?: 'injected' | 'walletconnect' | 'static'
  isInstalled: boolean
  connect: () => Promise<void | WalletData>
  disconnect: () => Promise<void>
}

export interface TokenBalance {
  symbol: string
  balance: string
  decimals: number
  address: string
  price?: number
  value?: number
  changePercent24h?: number
  name: string
  icon?: string
  balanceFormatted: string
  valueFormatted: string
}

export interface NFTItem {
  id: string
  name: string
  collection: string
  image: string
  value?: number
  valueFormatted?: string
}

export interface WalletPortfolio {
  totalValue: string
  totalValueFormatted: string
  ethBalance: string
  ethBalanceFormatted: string
  ethValue: string
  ethValueFormatted: string
  tokens: TokenBalance[]
  nfts: NFTItem[]
  isLoading: boolean
  lastUpdated: Date | null
}

export interface WalletContextType {
  walletData: WalletData
  portfolio: WalletPortfolio
  providers: WalletProvider[]
  connect: (providerId?: string) => Promise<void>
  disconnect: () => Promise<void>
  refreshBalance: () => Promise<void>
  refreshPortfolio: () => Promise<void>
  refreshProfile: () => Promise<void>
  formatAddress: (address: string) => string
  formatBalance: (balance: string) => string
}

export type WalletError = {
  code: string
  message: string
  details?: Record<string, unknown>
} 