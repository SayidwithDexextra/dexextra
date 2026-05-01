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
import { useCoreVault } from '@/hooks/useCoreVault'
import { useDepositGasEstimate } from '@/hooks/useDepositGasEstimate'
import { env } from '@/lib/env'
import SpokeVaultAbi from '@/lib/abis/SpokeVault.json'
import { getActiveEthereumProvider, type EthereumProvider } from '@/lib/wallet'
import { getMagicProvider, magicRequestWithRetry, switchMagicChainWithRetry } from '@/lib/magic'

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
  const { gasFeeUsd, gasFeeEth, isLoading: isGasLoading } = useDepositGasEstimate(42161) // Arbitrum
  const [isFunctionDepositLoading, setIsFunctionDepositLoading] = useState(false)
  const [showSpokeDepositModal, setShowSpokeDepositModal] = useState(false)
  const [spokeDepositAmount, setSpokeDepositAmount] = useState('')
  const [spokeDepositError, setSpokeDepositError] = useState<string | null>(null)
  const [networkWarning, setNetworkWarning] = useState<string | null>(null)
  
  // Arbitrum tokens - Native USDC is the only enabled token for deposits
  const arbitrumUSDC: Token = {
    symbol: 'USDC',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/usd-coin-usdc-logo.png',
    name: 'USD Coin (Native)',
    decimals: 6,
    chain: 'Arbitrum',
    contractAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
  }
  const arbitrumUSDCe: Token = {
    symbol: 'USDC.e',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/usd-coin-usdc-logo.png',
    name: 'Bridged USDC (USDC.e)',
    decimals: 6,
    chain: 'Arbitrum',
    contractAddress: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'
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

  // Only Native USDC on Arbitrum is supported for deposits (withdrawal API uses Native USDC)
  // Bridged USDC.e and other tokens show as disabled in UI
  const availableTokens: Token[] = [
    arbitrumUSDC, arbitrumUSDCe, arbitrumUSDT, arbitrumDAI
  ]

  // Default to Arbitrum USDC (the only enabled token)
  const [sourceToken, setSourceToken] = useState<Token>(arbitrumUSDC)
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
    const addr = chain === 'arbitrum' ? env.SPOKE_ARBITRUM_VAULT_ADDRESS : ''

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
    const preferred = typeof window !== 'undefined' ? window.localStorage.getItem('walletProvider') : null
    const isMagic = preferred === 'magic'
    const eip1193: EthereumProvider | undefined =
      (isMagic ? (getMagicProvider() as any as EthereumProvider) : null) ??
      (getActiveEthereumProvider() ?? (typeof window !== 'undefined' ? ((window as any).ethereum as EthereumProvider | undefined) : undefined)) ??
      undefined

    if (!eip1193) {
      throw new Error('Wallet not detected. Please connect your wallet.')
    }

    // Ensure correct chain before building a signer.
    if (isMagic) {
      await switchMagicChainWithRetry(42161, { retries: 2 })
    }

    const provider = new ethers.BrowserProvider(eip1193 as any)
    const targetChainId = 42161n
    const targetChainIdHex = '0xa4b1'

    const ensureArbitrumNetwork = async () => {
      const friendlyHelp =
        'Open your wallet and switch to Arbitrum One (chainId 42161). If you do not see a prompt, manually select Arbitrum in your wallet and retry.'

      const getWalletChainId = async (): Promise<bigint | null> => {
        try {
          const raw = isMagic
            ? await magicRequestWithRetry({ method: 'eth_chainId' }, { retries: 2 })
            : await eip1193.request({ method: 'eth_chainId' })
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
        if (isMagic) {
          await switchMagicChainWithRetry(42161, { retries: 2 })
        } else {
          await eip1193.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: targetChainIdHex }]
          })
        }
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
          if (!isMagic) {
            await eip1193.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: targetChainIdHex,
                chainName: 'Arbitrum One',
                nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                rpcUrls: [env.ARBITRUM_RPC_URL],
                blockExplorerUrls: ['https://arbiscan.io']
              }]
            })
          }

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
      // Helper to poll for approval receipt
      const pollForApprovalReceipt = async (txHash: string): Promise<ethers.TransactionReceipt | null> => {
        console.warn('[SpokeDeposit] Polling for approval receipt:', txHash)
        const maxAttempts = 30
        const pollInterval = 2000
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise(resolve => setTimeout(resolve, pollInterval))
          try {
            const receipt = await provider.getTransactionReceipt(txHash)
            if (receipt) {
              console.log('[SpokeDeposit] Approval receipt found via polling')
              return receipt
            }
          } catch (pollError) {
            console.warn('[SpokeDeposit] Approval receipt poll error:', pollError)
          }
        }
        return null
      }
      
      let approveReceipt: ethers.TransactionReceipt | null = null
      let approveTxHash: string | null = null
      
      try {
        const approveTx = await token.approve(vaultAddress, amountWei)
        approveTxHash = approveTx.hash
        
        try {
          approveReceipt = await approveTx.wait()
        } catch (waitError: any) {
          const isNonceParsingError = 
            typeof waitError?.message === 'string' && 
            waitError.message.includes('invalid value for value.nonce')
          
          if (isNonceParsingError && approveTxHash) {
            approveReceipt = await pollForApprovalReceipt(approveTxHash)
          } else {
            throw waitError
          }
        }
      } catch (txError: any) {
        // Check if nonce parsing error happened during approve() call itself
        const isNonceParsingError = 
          typeof txError?.message === 'string' && 
          txError.message.includes('invalid value for value.nonce')
        
        if (isNonceParsingError) {
          // Try to extract hash from error
          const hashMatch = txError.message.match(/"hash":\s*"(0x[a-fA-F0-9]{64})"/)
          approveTxHash = hashMatch?.[1] || null
          
          if (approveTxHash) {
            console.log('[SpokeDeposit] Approval submitted but response parsing failed. Hash:', approveTxHash)
            approveReceipt = await pollForApprovalReceipt(approveTxHash)
          } else {
            throw new Error(
              'Network error during approval. Please check your wallet activity ' +
              'and try again if the approval did not go through.'
            )
          }
        } else {
          throw txError
        }
      }
      
      if (!approveReceipt) {
        throw new Error(
          'Approval transaction submitted but confirmation timed out. ' +
          'Please check your wallet and try again.'
        )
      }
      
      if (approveReceipt.status === 0) {
        throw new Error('Token approval failed. Please try again.')
      }
    }

    // Helper to poll for transaction receipt when ethers.js fails to parse RPC response
    const pollForReceipt = async (txHash: string, maxAttempts: number = 60): Promise<ethers.TransactionReceipt | null> => {
      console.warn('[SpokeDeposit] RPC returned malformed transaction data, falling back to receipt polling for:', txHash)
      const pollInterval = 2000
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, pollInterval))
        
        try {
          const receipt = await provider.getTransactionReceipt(txHash)
          if (receipt) {
            console.log('[SpokeDeposit] Transaction receipt found via polling')
            return receipt
          }
        } catch (pollError) {
          console.warn('[SpokeDeposit] Receipt poll error:', pollError)
        }
      }
      return null
    }
    
    // Extract transaction hash from error message if present
    const extractTxHashFromError = (error: any): string | null => {
      const msg = error?.message || ''
      // Look for hash in the error value object
      const hashMatch = msg.match(/"hash":\s*"(0x[a-fA-F0-9]{64})"/)
      return hashMatch?.[1] || null
    }
    
    let depositReceipt: ethers.TransactionReceipt | null = null
    let depositTxHash: string | null = null
    
    try {
      // Attempt normal deposit flow
      const depositTx = await vault.deposit(tokenAddress, amountWei)
      depositTxHash = depositTx.hash
      
      try {
        depositReceipt = await depositTx.wait()
      } catch (waitError: any) {
        const isNonceParsingError = 
          typeof waitError?.message === 'string' && 
          waitError.message.includes('invalid value for value.nonce')
        
        if (isNonceParsingError && depositTxHash) {
          depositReceipt = await pollForReceipt(depositTxHash)
        } else {
          throw waitError
        }
      }
    } catch (txError: any) {
      // Check if this is a nonce parsing error during transaction submission
      // The transaction may have been submitted successfully but ethers.js failed to parse the response
      const isNonceParsingError = 
        typeof txError?.message === 'string' && 
        txError.message.includes('invalid value for value.nonce')
      
      if (isNonceParsingError) {
        // Try to extract the transaction hash from the error
        depositTxHash = extractTxHashFromError(txError)
        
        if (depositTxHash) {
          console.log('[SpokeDeposit] Transaction submitted but response parsing failed. Hash:', depositTxHash)
          depositReceipt = await pollForReceipt(depositTxHash)
        } else {
          // No hash available - the transaction may or may not have been submitted
          throw new Error(
            'Network communication error during deposit. ' +
            'The transaction may have been submitted. Please check your wallet activity ' +
            'and refresh your balance before trying again.'
          )
        }
      } else {
        throw txError
      }
    }
    
    if (!depositReceipt) {
      throw new Error(
        'Transaction submitted but confirmation timed out. ' +
        'Your deposit may still be processing. Please check your wallet activity ' +
        (depositTxHash ? `and look for transaction ${depositTxHash.slice(0, 10)}...` : 'and try again if needed.')
      )
    }
    
    // Verify the transaction was successful
    if (depositReceipt.status === 0) {
      throw new Error('Deposit transaction failed on-chain. Please try again.')
    }
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
      const rawMessage = err?.message || 'Failed to process deposit'
      
      // Categorize errors for better user experience
      const isBalanceIssue =
        typeof rawMessage === 'string' && rawMessage.toLowerCase().includes('insufficient balance')
      const isUserRejection =
        typeof rawMessage === 'string' && (
          rawMessage.toLowerCase().includes('user rejected') ||
          rawMessage.toLowerCase().includes('user denied') ||
          err?.code === 4001 ||
          err?.code === 'ACTION_REJECTED'
        )
      const isRpcParsingError =
        typeof rawMessage === 'string' && (
          rawMessage.includes('invalid value for value.nonce') ||
          rawMessage.includes('INVALID_ARGUMENT')
        )
      const isInsufficientGas =
        typeof rawMessage === 'string' && (
          rawMessage.toLowerCase().includes('insufficient funds for gas') ||
          rawMessage.toLowerCase().includes('gas required exceeds')
        )
      const isConfirmationTimeout =
        typeof rawMessage === 'string' && (
          rawMessage.includes('confirmation timed out') ||
          rawMessage.includes('may still be processing')
        )

      // Map errors to user-friendly messages
      let userMessage: string
      if (isUserRejection) {
        userMessage = 'Transaction was cancelled. Please try again when ready.'
      } else if (isInsufficientGas) {
        userMessage = 'Insufficient ETH for gas fees. Please add ETH to your wallet and try again.'
      } else if (isConfirmationTimeout) {
        // Transaction was submitted but we couldn't confirm it in time
        userMessage = rawMessage
      } else if (isRpcParsingError) {
        userMessage = 'Network communication error. Your deposit may still be processing. Please check your balance in a moment and try again if needed.'
      } else if (isBalanceIssue) {
        userMessage = rawMessage
      } else {
        userMessage = rawMessage
      }

      if (err?.isNetworkSwitchIssue || isBalanceIssue) {
        // Keep user in spoke modal with a warning/error banner and allow retry.
        setPaymentStatus('pending')
        setStep('spoke')
        setShowSpokeDepositModal(true)
        setSpokeDepositError(isBalanceIssue ? userMessage : null)
      } else if (isUserRejection) {
        // User cancelled - return to spoke modal without showing error step
        setPaymentStatus('pending')
        setStep('spoke')
        setShowSpokeDepositModal(true)
        setSpokeDepositError(userMessage)
      } else if (isConfirmationTimeout) {
        // Transaction was submitted but confirmation timed out - show as warning, not failure
        // The transaction may still succeed, so we show the spoke modal with a warning
        setPaymentStatus('pending')
        setStep('spoke')
        setShowSpokeDepositModal(true)
        setSpokeDepositError(userMessage)
      } else {
        setPaymentStatus('error')
        setStep('error')
        setError(userMessage)
        setSpokeDepositError(userMessage)
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
          // Arbitrum uses the external deposit flow (spoke vault)
          setStep('external')
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
        gasFeeUsd={gasFeeUsd}
        gasFeeEth={gasFeeEth}
        isGasLoading={isGasLoading}
      />
    )
  }

  return (
    <DepositModalStatus
      isOpen={isOpen}
      onClose={handleClose}
      onNewDeposit={() => {
        // Arbitrum uses the external deposit flow (spoke vault)
        setStep('external')
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
      gasFeeUsd={gasFeeUsd}
      gasFeeEth={gasFeeEth}
    />
  )
} 