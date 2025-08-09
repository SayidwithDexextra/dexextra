export interface FaucetProps {
  className?: string
}

export interface FaucetState {
  isLoading: boolean
  isClaiming: boolean
  customAmount: string
  error: string | null
  success: string | null
}

export interface ClaimResult {
  success: boolean
  txHash?: string
  error?: string
  amount?: string
} 