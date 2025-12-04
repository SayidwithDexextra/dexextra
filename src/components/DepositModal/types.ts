export interface DepositModalProps {
  isOpen: boolean
  onClose: () => void
}

export interface DepositModalInputProps {
  isOpen: boolean
  onClose: () => void
  onBack: () => void
  onContinue?: (amount: string) => void
  maxBalance?: number
  selectedToken?: Token
  targetToken?: Token
  isAnimating?: boolean
  animationDirection?: 'forward' | 'backward'
  isDirectDeposit?: boolean
  onDirectDeposit?: (amount: string) => Promise<void>
  isVaultConnected?: boolean
  availableTokens?: Token[]
  onSelectToken?: (token: Token) => void
}

export interface DepositModalReviewProps {
  isOpen: boolean
  onClose: () => void
  onBack: () => void
  onConfirm: () => void
  amount: string
  sourceToken: { symbol: string; icon: string }
  targetToken: { symbol: string; icon: string; name?: string }
  estimatedGas?: string
  exchangeRate?: string
  isAnimating?: boolean
  animationDirection?: 'forward' | 'backward'
  isDirectDeposit?: boolean
  isVaultConnected?: boolean
}

export interface DepositModalStatusProps {
  isOpen: boolean
  onClose: () => void
  onNewDeposit: () => void
  status?: 'pending' | 'success' | 'error'
  amount?: string
  sourceToken?: { symbol: string; icon: string }
  targetToken?: { symbol: string; icon: string; name?: string }
  transactionHash?: string
  estimatedTime?: string
  actualTime?: string
  isDirectDeposit?: boolean
  walletAddress?: string
  isAnimating?: boolean
  animationDirection?: 'forward' | 'backward'
}

export interface PaymentMethod {
  id: string
  name: string
  description: string
  balance: string
  icon: string
}

export interface Token {
  symbol: string
  icon: string
  name?: string
  amount?: string
  value?: string
  contractAddress?: string
  decimals?: number
  chain?: string
} 