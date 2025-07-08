export interface WalletData {
  address: string | null
  balance: string | null
  isConnected: boolean
  isConnecting: boolean
  chainId: number | null
  ensName?: string | null
  avatar?: string | null
}

export interface WalletProvider {
  name: string
  icon: string
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
  connect: (providerName?: string) => Promise<void>
  disconnect: () => Promise<void>
  refreshBalance: () => Promise<void>
  refreshPortfolio: () => Promise<void>
  formatAddress: (address: string) => string
  formatBalance: (balance: string) => string
}

export type WalletError = {
  code: string
  message: string
  details?: Record<string, unknown>
} 