'use client'

import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { DepositModalProps, Token } from './types'
import DepositModalInput from './DepositModalInput'
import DepositModalReview from './DepositModalReview'
import DepositModalStatus from './DepositModalStatus'
import DepositTokenSelect from './DepositTokenSelect'
import DepositExternalInput from './DepositExternalInput'
import SpokeDepositModal from '@/components/DepositModal/SpokeDepositModal'
import { useWalletAddress } from '@/hooks/useWalletAddress'
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig'
import { useCoreVault } from '@/hooks/useCoreVault'
import { env } from '@/lib/env'
import SpokeVaultAbi from '@/lib/abis/SpokeVault.json'

// Close Icon Component
const CloseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

export default function DepositModal({
  isOpen,
  onClose
}: DepositModalProps) {
  const [step, setStep] = useState<'select' | 'input' | 'external' | 'spoke' | 'review' | 'processing' | 'success' | 'error'>('select')
  const [depositAmount, setDepositAmount] = useState('')
  const [paymentStatus, setPaymentStatus] = useState<'pending' | 'success' | 'error'>('pending')
  const [error, setError] = useState<string | null>(null)
  const { walletAddress } = useWalletAddress()
  const coreVault = useCoreVault()
  const [isFunctionDepositLoading, setIsFunctionDepositLoading] = useState(false)
  const [showSpokeDepositModal, setShowSpokeDepositModal] = useState(false)
  const [spokeDepositAmount, setSpokeDepositAmount] = useState('')
  const [spokeDepositError, setSpokeDepositError] = useState<string | null>(null)
  const [networkWarning, setNetworkWarning] = useState<string | null>(null)
  
  // Stablecoins by chain
  const polygonUSDC: Token = {
    symbol: 'USDC',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/usd-coin-usdc-logo.png',
    name: 'USD Coin',
    decimals: 6,
    chain: 'Polygon',
    contractAddress: CONTRACT_ADDRESSES.MOCK_USDC
  }
  const polygonUSDT: Token = {
    symbol: 'USDT',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/tether-usdt-logo.png',
    name: 'Tether USD',
    decimals: 6,
    chain: 'Polygon'
  }
  const polygonDAI: Token = {
    symbol: 'DAI',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/multi-collateral-dai-dai-logo.svg',
    name: 'Dai Stablecoin',
    decimals: 18,
    chain: 'Polygon'
  }
  const arbitrumUSDC: Token = {
    symbol: 'USDC',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/usd-coin-usdc-logo.png',
    name: 'USD Coin',
    decimals: 6,
    chain: 'Arbitrum'
  }
  const arbitrumUSDT: Token = {
    symbol: 'USDT',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/tether-usdt-logo.png',
    name: 'Tether USD',
    decimals: 6,
    chain: 'Arbitrum'
  }
  const arbitrumDAI: Token = {
    symbol: 'DAI',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/multi-collateral-dai-dai-logo.svg',
    name: 'Dai Stablecoin',
    decimals: 18,
    chain: 'Arbitrum'
  }

  // Ethereum Mainnet
  const ethereumUSDC: Token = {
    symbol: 'USDC',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/usd-coin-usdc-logo.png',
    name: 'USD Coin',
    decimals: 6,
    chain: 'Ethereum'
  }
  const ethereumUSDT: Token = {
    symbol: 'USDT',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/tether-usdt-logo.png',
    name: 'Tether USD',
    decimals: 6,
    chain: 'Ethereum'
  }
  const ethereumDAI: Token = {
    symbol: 'DAI',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/multi-collateral-dai-dai-logo.svg',
    name: 'Dai Stablecoin',
    decimals: 18,
    chain: 'Ethereum'
  }

  // Hyperliquid
  const hyperliquidUSDC: Token = {
    symbol: 'USDC',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/usd-coin-usdc-logo.png',
    name: 'USD Coin',
    decimals: 6,
    chain: 'Hyperliquid'
  }
  const hyperliquidUSDT: Token = {
    symbol: 'USDT',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/tether-usdt-logo.png',
    name: 'Tether USD',
    decimals: 6,
    chain: 'Hyperliquid'
  }
  const hyperliquidDAI: Token = {
    symbol: 'DAI',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/multi-collateral-dai-dai-logo.svg',
    name: 'Dai Stablecoin',
    decimals: 18,
    chain: 'Hyperliquid'
  }

  const availableTokens: Token[] = [
    polygonUSDC, polygonUSDT, polygonDAI,
    arbitrumUSDC, arbitrumUSDT, arbitrumDAI,
    ethereumUSDC, ethereumUSDT, ethereumDAI,
    hyperliquidUSDC, hyperliquidUSDT, hyperliquidDAI
  ]

  const [sourceToken, setSourceToken] = useState<Token>(polygonUSDC)
  const isArbitrumFlow = (sourceToken?.chain || '').toLowerCase() === 'arbitrum'
  
  const vaultToken: Token = {
    symbol: 'VAULT',
    icon: '🏦',
    name: 'Dexetera CoreVault'
  }
  const spokeVaultToken: Token = {
    symbol: 'SPOKE',
    icon: '🏦',
    name: 'Arbitrum SpokeVault'
  }

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep('select');
      setDepositAmount('');
      setPaymentStatus('pending');
      setError(null);
      setIsFunctionDepositLoading(false);
      setShowSpokeDepositModal(false);
      setSpokeDepositAmount('');
      setSpokeDepositError(null);
      setNetworkWarning(null);
    }
  }, [isOpen])

  // Walkthrough hooks: allow a tour to drive the deposit UI without user clicks.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onSetStep = (e: any) => {
      const next = String(e?.detail?.step || '').trim() as any;
      if (!next) return;
      setStep(next);
    };
    const onSetToken = (e: any) => {
      const chain = String(e?.detail?.chain || '').trim();
      const symbol = String(e?.detail?.symbol || '').trim();
      if (!chain || !symbol) return;
      const match = availableTokens.find((t) => t.chain === chain && t.symbol === symbol);
      if (match) setSourceToken(match);
    };
    const onOpenSpoke = (e: any) => {
      const amt = String(e?.detail?.amount || '').trim();
      if (amt) setSpokeDepositAmount(amt);
      setSpokeDepositError(null);
      setNetworkWarning(null);
      setShowSpokeDepositModal(true);
      setStep('spoke');
    };

    window.addEventListener('walkthrough:deposit:setStep', onSetStep as any);
    window.addEventListener('walkthrough:deposit:setToken', onSetToken as any);
    window.addEventListener('walkthrough:deposit:openSpoke', onOpenSpoke as any);
    return () => {
      window.removeEventListener('walkthrough:deposit:setStep', onSetStep as any);
      window.removeEventListener('walkthrough:deposit:setToken', onSetToken as any);
      window.removeEventListener('walkthrough:deposit:openSpoke', onOpenSpoke as any);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Disable scrolling on body when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  // Preconnect + preload QR for the selected chain's deposit address.
  // This makes the QR on the deposit-address step appear instantly.
  useEffect(() => {
    if (typeof window === 'undefined') return

    const chain = (sourceToken?.chain || '').toLowerCase()
    const addr =
      chain === 'polygon' ? env.SPOKE_POLYGON_VAULT_ADDRESS :
      chain === 'arbitrum' ? env.SPOKE_ARBITRUM_VAULT_ADDRESS :
      chain === 'ethereum' ? env.SPOKE_ETHEREUM_VAULT_ADDRESS :
      chain === 'hyperliquid' ? env.SPOKE_HYPERLIQUID_VAULT_ADDRESS :
      ''

    if (!addr) return

    const qrHost = 'https://api.qrserver.com'
    const existingPreconnect = document.head.querySelector(
      `link[rel="preconnect"][href="${qrHost}"]`
    )
    if (!existingPreconnect) {
      const link = document.createElement('link')
      link.rel = 'preconnect'
      link.href = qrHost
      link.crossOrigin = ''
      document.head.appendChild(link)
    }

    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(addr)}`
    const img = new Image()
    img.decoding = 'async'
    img.src = qrUrl
  }, [sourceToken?.chain])


  // Function to handle deposit
  const handleDeposit = async () => {
    if (!depositAmount) return
    
    setStep('processing')
    setPaymentStatus('pending')
    
    try {
      if (!coreVault) {
        throw new Error('Vault contract not initialized')
      }
      
      // Call CoreVault deposit with proper amount formatting
      await coreVault.depositCollateral(depositAmount)
      
      setPaymentStatus('success')
      setStep('success')
      
    } catch (err: any) {
      console.error('Deposit error:', err)
      setPaymentStatus('error')
      setStep('error')
      setError(err.message || 'Failed to process deposit')
    }
  }

  // Initiate function-based deposit via Arbitrum SpokeVault (amount modal)
  const handleExternalFunctionDeposit = async () => {
    const chain = (sourceToken?.chain || '').toLowerCase()
    if (chain !== 'arbitrum') {
      setError('Function deposit is only available on Arbitrum.')
      setPaymentStatus('error')
      setStep('error')
      return
    }

    setSpokeDepositAmount(depositAmount || '1')
    setSpokeDepositError(null)
    setShowSpokeDepositModal(true)
    setStep('spoke')
    return
  }

  // Execute the actual spoke deposit
  const performSpokeDeposit = async (rawAmount: string) => {
    const vaultAddress = env.SPOKE_ARBITRUM_VAULT_ADDRESS
    const tokenAddress =
      sourceToken.contractAddress ||
      env.SPOKE_ARBITRUM_USDC_ADDRESS ||
      (process.env.NEXT_PUBLIC_SPOKE_ARBITRUM_USDC_ADDRESS as string) ||
      (process.env.SPOKE_ARBITRUM_USDC_ADDRESS as string) ||
      ''

    if (!vaultAddress) {
      throw new Error('Arbitrum spoke vault address is not configured.')
    }
    if (!tokenAddress) {
      throw new Error('Arbitrum USDC address is not configured.')
    }
    if (typeof window === 'undefined' || !(window as any).ethereum) {
      throw new Error('Wallet not detected. Please connect your wallet.')
    }

    const provider = new ethers.BrowserProvider((window as any).ethereum)
    const targetChainId = 42161n
    const targetChainIdHex = '0xa4b1'

    const ensureArbitrumNetwork = async () => {
      const friendlyHelp =
        'Open your wallet and switch to Arbitrum One (chainId 42161). If you do not see a prompt, manually select Arbitrum in your wallet and retry.'

      const getWalletChainId = async (): Promise<bigint | null> => {
        try {
          const raw = await (window as any).ethereum.request({ method: 'eth_chainId' })
          if (typeof raw === 'bigint') return raw
          if (typeof raw === 'number') return BigInt(raw)
          if (typeof raw === 'string') return BigInt(raw) // supports hex ("0xa4b1") and decimal ("42161")
          return null
        } catch {
          return null
        }
      }

      let currentChainId = await getWalletChainId()
      if (currentChainId === targetChainId) {
        setNetworkWarning(null)
        return
      }

      const requestSwitch = async () => {
        await (window as any).ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: targetChainIdHex }]
        })
        currentChainId = await getWalletChainId()
        return currentChainId === targetChainId
      }

      try {
        const switched = await requestSwitch()
        if (switched) {
          setNetworkWarning(null)
          return
        }
      } catch (switchError: any) {
        const userRejected = switchError?.code === 4001
        const chainMissing = switchError?.code === 4902 // Unrecognized chain

        if (!chainMissing) {
          const detected =
            typeof currentChainId === 'bigint' ? ` Detected chainId: ${currentChainId.toString()}.` : ''
          const message = userRejected
            ? `You rejected the network switch request. Please approve the Arbitrum One prompt in your wallet.${detected}`
            : `Check your wallet for a network switch prompt. If you do not see one, open your wallet and manually select Arbitrum One (chainId 42161), then retry.${detected}`
          setNetworkWarning(message)
          const tagged = new Error(message)
          ;(tagged as any).isNetworkSwitchIssue = true
          throw tagged
        }
      }

      // If the chain is missing, attempt to add then switch again.
      try {
        if (env.ARBITRUM_RPC_URL) {
          await (window as any).ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: targetChainIdHex,
              chainName: 'Arbitrum One',
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
              rpcUrls: [env.ARBITRUM_RPC_URL],
              blockExplorerUrls: ['https://arbiscan.io']
            }]
          })

          const switchedAfterAdd = await requestSwitch().catch(() => false)
          if (switchedAfterAdd) return
        }
      } catch (addError: any) {
        console.warn('Failed to add Arbitrum chain', addError)
        const userRejected = addError?.code === 4001
        const message = userRejected
          ? 'Please approve adding Arbitrum in your wallet, then accept the switch request.'
          : `We couldn't add Arbitrum automatically. Add Arbitrum One (chainId 42161) in your wallet using your preferred RPC, then switch and retry.`
        setNetworkWarning(message)
        const tagged = new Error(message)
        ;(tagged as any).isNetworkSwitchIssue = true
        throw tagged
      }

      setNetworkWarning(friendlyHelp)
      const tagged = new Error(friendlyHelp)
      ;(tagged as any).isNetworkSwitchIssue = true
      throw tagged
    }

    await ensureArbitrumNetwork()
    const signer = await provider.getSigner()
    const feeData = await provider.getFeeData()
    const bump = (v?: bigint | null, fallbackGwei = 2n) => {
      if (v && v > 0) return (v * 13n) / 10n + 1n // ~+30%
      const fallback = fallbackGwei * 1_000_000_000n
      return (fallback * 13n) / 10n + 1n
    }
    const maxPriorityFeePerGas = bump(feeData.maxPriorityFeePerGas ?? feeData.gasPrice)
    const maxFeePerGas = bump(feeData.maxFeePerGas ?? feeData.gasPrice)
    const txOpts = { maxFeePerGas, maxPriorityFeePerGas }

    const erc20Abi = [
      'function allowance(address owner, address spender) view returns (uint256)',
      'function approve(address spender, uint256 value) returns (bool)',
      'function balanceOf(address owner) view returns (uint256)',
      'function decimals() view returns (uint8)',
    ]

    const token = new ethers.Contract(tokenAddress, erc20Abi, signer)
    const vault = new ethers.Contract(vaultAddress, SpokeVaultAbi, signer)

    const userAddress = await signer.getAddress()
    const decimals: number = Number(await token.decimals().catch(() => 6))
    const amountWei = ethers.parseUnits(rawAmount, decimals)

    const balance: bigint = await token.balanceOf(userAddress)
    if (balance < amountWei) {
      throw new Error(`Insufficient balance. Need ${rawAmount} ${sourceToken.symbol}.`)
    }

    const currentAllowance: bigint = await token.allowance(userAddress, vaultAddress)
    if (currentAllowance < amountWei) {
      const approveTx = await token.approve(vaultAddress, amountWei, txOpts)
      await approveTx.wait()
    }

    const depositTx = await vault.deposit(tokenAddress, amountWei, txOpts)
    await depositTx.wait()
  }

  const handleSpokeDepositSubmit = async (amount: string) => {
    const parsed = Number(amount)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setSpokeDepositError('Enter an amount greater than zero.')
      return
    }

    setDepositAmount(amount)
    setSpokeDepositError(null)
    setNetworkWarning(null)
    setIsFunctionDepositLoading(true)
    setStep('processing')
    setPaymentStatus('pending')

    try {
      await performSpokeDeposit(amount)
      setShowSpokeDepositModal(false)
      setPaymentStatus('success')
      setStep('success')
    } catch (err: any) {
      console.error('Function deposit error:', err)
      const message = err?.message || 'Failed to process deposit'
      const isBalanceIssue =
        typeof message === 'string' && message.toLowerCase().includes('insufficient balance')

      if (err?.isNetworkSwitchIssue || isBalanceIssue) {
        // Keep user in spoke modal with a warning/error banner and allow retry.
        setPaymentStatus('pending')
        setStep('spoke')
        setShowSpokeDepositModal(true)
        setSpokeDepositError(isBalanceIssue ? message : null)
      } else {
        setPaymentStatus('error')
        setStep('error')
        setError(message)
        setSpokeDepositError(message)
      }
    } finally {
      setIsFunctionDepositLoading(false)
    }
  }

  // Close modal
  const handleClose = () => {
    onClose()
  }

  // Delegate rendering to sub-modals which already implement the Sophisticated Minimal Design System
  if (step === 'select') {
    return (
      <DepositTokenSelect
        isOpen={isOpen}
        onClose={handleClose}
        availableTokens={availableTokens}
        selectedToken={sourceToken}
        onSelectToken={(t) => setSourceToken(t)}
        onContinue={() => {
          const chain = (sourceToken?.chain || '').toLowerCase()
          if (chain === 'hyperliquid') {
            setStep('input')
          } else {
            setStep('external')
          }
        }}
      />
    )
  }

  if (step === 'spoke') {
    return (
      <SpokeDepositModal
        isOpen={isOpen && showSpokeDepositModal}
        onClose={() => {
          setShowSpokeDepositModal(false)
          setSpokeDepositError(null)
          setNetworkWarning(null)
          setStep('select')
        }}
        onBack={() => {
          setShowSpokeDepositModal(false)
          setSpokeDepositError(null)
          setNetworkWarning(null)
          setStep('external')
        }}
        onSubmit={handleSpokeDepositSubmit}
        selectedToken={sourceToken}
        defaultAmount={spokeDepositAmount || '1'}
        isSubmitting={isFunctionDepositLoading}
        errorMessage={spokeDepositError}
        warningMessage={networkWarning}
      />
    )
  }

  if (step === 'external') {
    return (
      <>
        <DepositExternalInput
          isOpen={isOpen}
          onClose={handleClose}
          onBack={() => setStep('select')}
          selectedToken={sourceToken}
          onFunctionDeposit={handleExternalFunctionDeposit}
          isFunctionDepositLoading={isFunctionDepositLoading}
          functionDepositLabel={`Deposit ${sourceToken.symbol}`}
        />
        <SpokeDepositModal
          isOpen={showSpokeDepositModal}
          onClose={() => {
            setShowSpokeDepositModal(false)
            setSpokeDepositError(null)
          }}
          onBack={() => {
            setShowSpokeDepositModal(false)
            setSpokeDepositError(null)
          }}
          onSubmit={handleSpokeDepositSubmit}
          selectedToken={sourceToken}
          defaultAmount={spokeDepositAmount || '1'}
          isSubmitting={isFunctionDepositLoading}
          errorMessage={spokeDepositError}
        />
      </>
    )
  }

  if (step === 'input') {
    return (
      <DepositModalInput
        isOpen={isOpen}
        onClose={handleClose}
        onBack={() => setStep('select')}
        onContinue={(amount) => {
          setDepositAmount(amount);
          setStep('review');
        }}
        maxBalance={1000}
        selectedToken={sourceToken}
        targetToken={vaultToken}
        isDirectDeposit={true}
        isVaultConnected={true}
        availableTokens={availableTokens}
        onSelectToken={(t: Token) => setSourceToken(t)}
      />
    )
  }

  if (step === 'review') {
    return (
      <DepositModalReview
        isOpen={isOpen}
        onClose={handleClose}
        onBack={() => setStep('input')}
        onConfirm={handleDeposit}
        amount={depositAmount}
        sourceToken={sourceToken}
        targetToken={vaultToken}
        isDirectDeposit={true}
      />
    )
  }

  return (
    <DepositModalStatus
      isOpen={isOpen}
      onClose={handleClose}
      onNewDeposit={() => {
        const chain = (sourceToken?.chain || '').toLowerCase()
        const isExternalFlow = chain !== 'hyperliquid'
        setStep(isExternalFlow ? 'external' : 'input')
        setDepositAmount('')
        setPaymentStatus('pending')
        setError(null)
        setShowSpokeDepositModal(false)
        setSpokeDepositError(null)
        setNetworkWarning(null)
      }}
      status={paymentStatus}
      amount={depositAmount}
      sourceToken={sourceToken}
      targetToken={isArbitrumFlow ? spokeVaultToken : vaultToken}
      isDirectDeposit={true}
    />
  )
} 