'use client'

import { useEffect, useState } from 'react'
import { ethers } from 'ethers'
import { useWalletAddress } from '@/hooks/useWalletAddress'
import { env } from '@/lib/env'

const ARBITRUM_CHAIN_ID = 42161
const ARBITRUM_CHAIN_HEX = `0x${ARBITRUM_CHAIN_ID.toString(16)}`
const DEFAULT_ARBITRUM_RPC = 'https://arb1.arbitrum.io/rpc'

const SPOKE_TOKEN_ABI = [
  'function faucet(uint256 amount) external',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function balanceOf(address owner) view returns (uint256)',
]

interface ArbitrumFaucetProps {
  className?: string
}

export function ArbitrumFaucet({ className = '' }: ArbitrumFaucetProps) {
  const { walletAddress, isConnected, connectWallet, isConnecting } = useWalletAddress()
  const tokenAddress = env.SPOKE_ARBITRUM_USDC_ADDRESS
  const rpcUrl = env.ARBITRUM_RPC_URL || DEFAULT_ARBITRUM_RPC

  const [amount, setAmount] = useState('100')
  const [isArbitrumNetwork, setIsArbitrumNetwork] = useState(false)
  const [isClaiming, setIsClaiming] = useState(false)
  const [status, setStatus] = useState<{ error: string | null; success: string | null }>({
    error: null,
    success: null,
  })
  const [balance, setBalance] = useState<string | null>(null)
  const [tokenSymbol, setTokenSymbol] = useState('USDC')
  const [decimals, setDecimals] = useState(6)

  const validateAmount = (value: string) => {
    if (!value) return false
    const numeric = Number(value)
    return Number.isFinite(numeric) && numeric > 0
  }

  const formatFriendlyError = (error: any): string => {
    const rawMessage =
      error?.shortMessage ||
      error?.message ||
      error?.error?.message ||
      error?.cause?.message ||
      ''
    const msg = String(rawMessage).toLowerCase()

    if (error?.code === 4001 || msg.includes('user rejected') || msg.includes('user denied')) {
      return 'Transaction cancelled in wallet.'
    }
    if (msg.includes('insufficient funds')) {
      return 'Not enough ETH to pay gas on Arbitrum.'
    }
    if (!tokenAddress) {
      return 'Spoke token address is not configured. Set SPOKE_ARBITRUM_USDC_ADDRESS.'
    }

    return error?.message || 'Unable to claim tokens. Please try again.'
  }

  const checkNetwork = async () => {
    if (typeof window === 'undefined' || !(window as any).ethereum) {
      setIsArbitrumNetwork(false)
      return
    }
    try {
      const chainId = await (window as any).ethereum.request({ method: 'eth_chainId' })
      setIsArbitrumNetwork(parseInt(chainId, 16) === ARBITRUM_CHAIN_ID)
    } catch {
      setIsArbitrumNetwork(false)
    }
  }

  const loadTokenMetadata = async () => {
    if (!tokenAddress) return
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl, ARBITRUM_CHAIN_ID)
      const contract = new ethers.Contract(tokenAddress, SPOKE_TOKEN_ABI, provider)
      const [dec, sym] = await Promise.all([contract.decimals(), contract.symbol()])
      setDecimals(Number(dec))
      setTokenSymbol(sym || 'USDC')
    } catch {
      // Silent fallback keeps defaults
    }
  }

  const loadBalance = async () => {
    if (!tokenAddress || !walletAddress) return
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl, ARBITRUM_CHAIN_ID)
      const contract = new ethers.Contract(tokenAddress, SPOKE_TOKEN_ABI, provider)
      const [rawBalance, tokenDecimals] = await Promise.all([
        contract.balanceOf(walletAddress),
        contract.decimals(),
      ])
      setDecimals(Number(tokenDecimals))
      setBalance(ethers.formatUnits(rawBalance, tokenDecimals))
    } catch {
      setBalance(null)
    }
  }

  const ensureArbitrumSigner = async (): Promise<ethers.Signer> => {
    if (typeof window === 'undefined' || !(window as any).ethereum) {
      throw new Error('No wallet provider available')
    }

    const ethereum = (window as any).ethereum

    const getSignerOnCurrentNetwork = async () => {
      const provider = new ethers.BrowserProvider(ethereum)
      const network = await provider.getNetwork()
      if (Number(network.chainId) === ARBITRUM_CHAIN_ID) {
        setIsArbitrumNetwork(true)
        return provider.getSigner()
      }
      throw new Error('wrong-network')
    }

    try {
      return await getSignerOnCurrentNetwork()
    } catch (error: any) {
      if (error?.message !== 'wrong-network') {
        throw error
      }
    }

    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: ARBITRUM_CHAIN_HEX }],
      })
    } catch (switchError: any) {
      if (switchError?.code === 4902) {
        await ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: ARBITRUM_CHAIN_HEX,
              chainName: 'Arbitrum One',
              nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
              rpcUrls: [rpcUrl || DEFAULT_ARBITRUM_RPC],
              blockExplorerUrls: ['https://arbiscan.io/'],
            },
          ],
        })
      } else if (switchError?.code === 4001) {
        throw new Error('Please approve switching to Arbitrum in your wallet.')
      } else {
        throw new Error('Unable to switch to Arbitrum. Check your wallet settings.')
      }
    }

    const provider = new ethers.BrowserProvider(ethereum)
    const network = await provider.getNetwork()
    setIsArbitrumNetwork(Number(network.chainId) === ARBITRUM_CHAIN_ID)
    return provider.getSigner()
  }

  const handleAmountChange = (value: string) => {
    const cleaned = value.replace(/[^0-9.]/g, '')
    const parts = cleaned.split('.')
    if (parts.length > 2) return
    if (parts[1] && parts[1].length > decimals) return
    setAmount(cleaned)
    setStatus(prev => ({ ...prev, error: null, success: null }))
  }

  const handleSwitchNetwork = async () => {
    setStatus(prev => ({ ...prev, error: null }))
    try {
      await ensureArbitrumSigner()
    } catch (error) {
      setStatus(prev => ({ ...prev, error: formatFriendlyError(error) }))
    }
  }

  const handleClaim = async () => {
    if (isClaiming || !tokenAddress) return

    if (!validateAmount(amount)) {
      setStatus({ error: 'Enter an amount greater than 0.', success: null })
      return
    }

    setIsClaiming(true)
    setStatus({ error: null, success: null })

    try {
      const signer = await ensureArbitrumSigner()
      const contract = new ethers.Contract(tokenAddress, SPOKE_TOKEN_ABI, signer)
      const tokenDecimals = await contract.decimals()
      const parsedAmount = ethers.parseUnits(amount, tokenDecimals)

      const tx = await contract.faucet(parsedAmount)
      await tx.wait()

      setStatus({
        error: null,
        success: `Claimed ${amount} ${tokenSymbol} on Arbitrum.`,
      })

      await loadBalance()
    } catch (error: any) {
      setStatus({ error: formatFriendlyError(error), success: null })
    } finally {
      setIsClaiming(false)
    }
  }

  useEffect(() => {
    checkNetwork()
    const handler = () => checkNetwork()
    ;(window as any)?.ethereum?.on?.('chainChanged', handler)
    return () => {
      ;(window as any)?.ethereum?.removeListener?.('chainChanged', handler)
    }
  }, [])

  useEffect(() => {
    if (tokenAddress) {
      loadTokenMetadata()
    }
  }, [tokenAddress, rpcUrl])

  useEffect(() => {
    if (isConnected && walletAddress && isArbitrumNetwork && tokenAddress) {
      loadBalance()
    }
  }, [isConnected, walletAddress, isArbitrumNetwork, tokenAddress, rpcUrl])

  const canClaim =
    isConnected && isArbitrumNetwork && !!tokenAddress && validateAmount(amount) && !isClaiming

  return (
    <div
      className={`group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 ${className}`}
    >
      <div className="flex items-center justify-between p-2.5 border-b border-[#1A1A1A]">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
          <span className="text-[11px] font-medium text-white">Arbitrum Token Claim</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[#808080]">
          <span>{isArbitrumNetwork ? 'Arbitrum One' : 'Switch to Arbitrum'}</span>
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              isArbitrumNetwork ? 'bg-green-400' : 'bg-amber-400'
            }`}
          />
        </div>
      </div>

      <div className="p-2.5 space-y-3">
        <div className="text-[10px] text-[#808080] leading-relaxed">
          Claim any amount of {tokenSymbol} directly on Arbitrum using the spoke faucet contract.
        </div>

        {tokenAddress ? (
          <div className="text-[10px] text-[#606060] flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded bg-[#1A1A1A] text-[#9CA3AF]">Token</span>
            <span className="text-[#9CA3AF]">
              {`${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`}
            </span>
          </div>
        ) : (
          <div className="text-[10px] text-[#ff9f1c]">
            Set `SPOKE_ARBITRUM_USDC_ADDRESS` to enable claiming on Arbitrum.
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] text-[#9CA3AF]">
            <div className="w-1 h-1 rounded-full bg-green-400 flex-shrink-0" />
            <span>Amount to claim</span>
          </div>
          <input
            type="text"
            value={amount}
            onChange={(e) => handleAmountChange(e.target.value)}
            placeholder="e.g. 2500"
            className="w-full bg-[#0A0A0A] border border-[#222222] rounded px-3 py-2 text-[12px] text-white outline-none focus:border-[#3B82F6] transition-colors"
          />
          <div className="text-[9px] text-[#606060]">
            Enter any positive amount. Tokens mint instantly to your wallet.
          </div>
        </div>

        {balance !== null && (
          <div className="flex items-center gap-2 text-[10px] text-[#9CA3AF]">
            <div className="w-1 h-1 rounded-full bg-green-400 flex-shrink-0" />
            <span>Balance on Arbitrum: {Number(balance).toLocaleString()} {tokenSymbol}</span>
          </div>
        )}

        {status.error && (
          <div className="text-[10px] text-[#f87171] bg-[#1A0F0F] border border-[#3b1a1a] rounded px-3 py-2">
            {status.error}
          </div>
        )}
        {status.success && (
          <div className="text-[10px] text-[#34d399] bg-[#0f1714] border border-[#1f2f29] rounded px-3 py-2">
            {status.success}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {!isConnected ? (
            <button
              onClick={connectWallet}
              disabled={isConnecting}
              className="px-3 py-2 text-[11px] rounded border border-[#222222] text-white bg-[#111111] hover:bg-[#1d1d1d] disabled:opacity-50"
            >
              {isConnecting ? 'Connecting...' : 'Connect wallet'}
            </button>
          ) : !isArbitrumNetwork ? (
            <button
              onClick={handleSwitchNetwork}
              className="px-3 py-2 text-[11px] rounded border border-[#3B82F6] text-white bg-[#0F172A] hover:bg-[#111827]"
            >
              Switch to Arbitrum
            </button>
          ) : (
            <button
              onClick={handleClaim}
              disabled={!canClaim}
              className="px-3 py-2 text-[11px] rounded border border-[#22c55e] text-white bg-[#0f1f16] hover:bg-[#13291d] disabled:opacity-50 flex items-center gap-2"
            >
              {isClaiming ? (
                <>
                  <div className="w-3 h-3 border-2 border-[#22c55e] border-t-transparent rounded-full animate-spin" />
                  <span>Claiming...</span>
                </>
              ) : (
                `Claim ${validateAmount(amount) ? amount : ''} ${tokenSymbol}`
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default ArbitrumFaucet
