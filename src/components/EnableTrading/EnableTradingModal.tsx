'use client'

import { useEffect, useMemo, useRef, useState, useCallback, useId, type ReactNode } from 'react'
import useWallet from '@/hooks/useWallet'
import { useSession } from '@/contexts/SessionContext'
import { ensureGaslessChain } from '@/lib/gasless'
import { type ActivationPhase } from './EnableTradingActivation'
import styles from './EnableTradingModal.module.css'

type EnablePhase = 'idle' | ActivationPhase
type StepState = 'complete' | 'pending' | 'active'

const EXIT_MS = 150
const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export interface EnableTradingModalProps {
  isOpen: boolean
  onClose: () => void
  // Optional: open an external wallet selector (e.g., your WalletModal)
  onOpenWallets?: () => void
  // Optional success callback when trading gets enabled
  onSuccess?: (sessionId: string) => void
  /**
   * Debug/demo: run a simulated activation sequence (awaiting → finalizing →
   * success) instead of calling the real wallet flow. Lets the modal be
   * exercised on the debug page without a connected wallet.
   */
  simulate?: boolean
  /**
   * Debug/demo: force a specific activation phase. When set (non-null), the
   * modal renders that phase directly so each visual state can be inspected.
   */
  forcePhase?: EnablePhase | null
  /** Timings (ms) for the simulated sequence. */
  simulateTimings?: { awaitingMs?: number; finalizingMs?: number }
  /** How long the success state lingers before onSuccess fires (ms). */
  successHoldMs?: number
}

function StepCard({
  state,
  step,
  title,
  meta,
  current,
}: {
  state: StepState
  step: number
  title: string
  meta: ReactNode
  current?: boolean
}) {
  const cardState =
    state === 'complete' ? styles.cardComplete : state === 'active' ? styles.cardActive : styles.cardPending
  const statusText = state === 'complete' ? 'completed' : state === 'active' ? 'in progress' : 'not started'

  return (
    <li className={`${styles.card} ${cardState}`} aria-current={current ? 'step' : undefined}>
      <div className={styles.cardTop}>
        <div className={styles.indicator}>
          {state === 'complete' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="#0F0F0F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12.5l5 5L19 7" />
            </svg>
          ) : state === 'active' ? (
            <span className={styles.spinner} aria-hidden="true" />
          ) : (
            <span className={styles.digit}>{step}</span>
          )}
        </div>
        <span className={styles.stepLabel}>STEP {step}</span>
      </div>
      <div>
        <div className={styles.cardTitle}>{title}</div>
        <div className={styles.cardMeta}>{meta}</div>
        <span className={styles.srOnly}>{statusText}</span>
      </div>
    </li>
  )
}

export default function EnableTradingModal({
  isOpen,
  onClose,
  onOpenWallets,
  onSuccess,
  simulate = false,
  forcePhase = null,
  simulateTimings,
  successHoldMs = 1600,
}: EnableTradingModalProps) {
  const { walletData, providers, connect, formatAddress } = useWallet()
  const { sessionActive, loading, enableTrading } = useSession()
  const [isWorking, setIsWorking] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [internalPhase, setInternalPhase] = useState<EnablePhase>('idle')
  const timersRef = useRef<number[]>([])
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const [visible, setVisible] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [rendered, setRendered] = useState(false)

  // forcePhase (debug) takes precedence over the internal state machine.
  const phase: EnablePhase = forcePhase ?? internalPhase
  const isActivating = phase === 'awaiting' || phase === 'finalizing'

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id))
    timersRef.current = []
  }, [])

  // Reset transient state whenever the modal closes.
  useEffect(() => {
    if (!isOpen) {
      clearTimers()
      setInternalPhase('idle')
      setErrorMessage(null)
      setIsWorking(false)
    }
  }, [isOpen, clearTimers])

  useEffect(() => () => clearTimers(), [clearTimers])

  const isConnected = Boolean(walletData?.isConnected && walletData?.address)
  const addressShort = walletData?.address ? formatAddress(walletData.address) : null
  const gaslessEnabled = useMemo(
    () => (process.env.NEXT_PUBLIC_GASLESS_ENABLED === 'true'),
    []
  )

  useEffect(() => {
    if (isOpen) {
      setRendered(true)
      setExiting(false)
      const id = window.requestAnimationFrame(() => setVisible(true))
      return () => window.cancelAnimationFrame(id)
    }

    if (!rendered) return
    setVisible(false)
    setExiting(true)
    const timeout = window.setTimeout(() => {
      setRendered(false)
      setExiting(false)
    }, EXIT_MS)
    return () => window.clearTimeout(timeout)
  }, [isOpen, rendered])

  const runSimulatedFlow = useCallback(() => {
    clearTimers()
    setErrorMessage(null)
    setInternalPhase('awaiting')
    const awaitingMs = simulateTimings?.awaitingMs ?? 1400
    const finalizingMs = simulateTimings?.finalizingMs ?? 1600
    timersRef.current.push(
      window.setTimeout(() => setInternalPhase('finalizing'), awaitingMs)
    )
    timersRef.current.push(
      window.setTimeout(() => setInternalPhase('success'), awaitingMs + finalizingMs)
    )
    timersRef.current.push(
      window.setTimeout(() => {
        onSuccess?.('0xsimulated-session-id')
      }, awaitingMs + finalizingMs + successHoldMs)
    )
  }, [clearTimers, simulateTimings, successHoldMs, onSuccess])

  const handlePrimary = useCallback(async () => {
    setErrorMessage(null)
    console.log('[EnableTradingModal] handlePrimary called', { isConnected, gaslessEnabled, sessionActive, retryCount, simulate });

    if (simulate) {
      runSimulatedFlow()
      return
    }

    // If not connected, try to connect automatically to first installed provider
    if (!isConnected) {
      console.log('[EnableTradingModal] Attempting wallet connection...');
      try {
        const installed = providers.find(p => p.isInstalled)
        if (installed) {
          setIsWorking(true)
          await connect(installed.id)
          console.log('[EnableTradingModal] Wallet connected successfully');
        } else if (onOpenWallets) {
          onOpenWallets()
        } else {
          const error = 'No wallet detected. Please install a wallet extension (e.g., MetaMask, Rabby) or open your wallet app.';
          console.error('[EnableTradingModal] No wallet found');
          setErrorMessage(error)
        }
      } catch (e: any) {
        const error = e?.message || 'Failed to connect wallet. Please try again.';
        console.error('[EnableTradingModal] Wallet connection failed:', e);
        setErrorMessage(error)
      } finally {
        setIsWorking(false)
      }
      return
    }

    if (!gaslessEnabled) {
      console.log('[EnableTradingModal] Gasless not enabled');
      return
    }
    if (sessionActive) {
      console.log('[EnableTradingModal] Session already active');
      return
    }

    // Enable trading (gasless session)
    console.log('[EnableTradingModal] Starting enableTrading...');
    try {
      setIsWorking(true)

      // Prompt chain switch BEFORE any signing request.
      const chainRes = await ensureGaslessChain()
      if (!chainRes.ok) {
        setErrorMessage(chainRes.error)
        return
      }

      // Enter the fluid activation flow: 'awaiting' the wallet signature, then
      // 'finalizing' once the signature is captured and the session registers.
      setInternalPhase('awaiting')
      const res = await enableTrading((p) => {
        if (p === 'finalizing') setInternalPhase('finalizing')
      })
      console.log('[EnableTradingModal] enableTrading result:', res);
      
      if (res.success) {
        console.log('[EnableTradingModal] Trading enabled successfully:', res.sessionId);
        setInternalPhase('success')
        clearTimers()
        timersRef.current.push(
          window.setTimeout(() => {
            if (res.sessionId && onSuccess) onSuccess(res.sessionId)
          }, successHoldMs)
        )
      } else {
        const error = res.error || 'Failed to enable trading. Please try again.';
        console.error('[EnableTradingModal] enableTrading failed:', error);
        setInternalPhase('idle')
        setErrorMessage(error)
      }
    } catch (e: any) {
      const error = e?.message || 'An unexpected error occurred. Please try again.';
      console.error('[EnableTradingModal] enableTrading exception:', e);
      setInternalPhase('idle')
      setErrorMessage(error)
    } finally {
      setIsWorking(false)
    }
  }, [isConnected, gaslessEnabled, sessionActive, providers, connect, onOpenWallets, enableTrading, onSuccess, retryCount, simulate, runSimulatedFlow, clearTimers, successHoldMs])

  const handleRetry = useCallback(() => {
    console.log('[EnableTradingModal] Retry clicked, attempt:', retryCount + 1);
    setRetryCount(prev => prev + 1);
    setErrorMessage(null);
    handlePrimary();
  }, [handlePrimary, retryCount])

  const primaryDisabled = useMemo(() => {
    if (simulate) return false
    if (!isConnected) return false
    if (!gaslessEnabled) return true
    return loading || isWorking || sessionActive
  }, [isConnected, loading, isWorking, sessionActive, gaslessEnabled, simulate])

  const signaturePending = isActivating || loading || isWorking
  const sessionComplete = Boolean(sessionActive || phase === 'success')
  const step1State: StepState = isConnected ? 'complete' : 'pending'
  const step2State: StepState = sessionComplete ? 'complete' : isActivating ? 'active' : 'pending'
  const connectorDone = step1State === 'complete' && step2State === 'complete'
  const currentStep = step1State !== 'complete' ? 1 : step2State !== 'complete' ? 2 : undefined

  // Block interruption while the signature is being registered on-chain.
  const showCloseButton = phase !== 'finalizing'

  const handleDismiss = useCallback(() => {
    if (phase === 'finalizing') return
    onClose()
  }, [phase, onClose])

  useEffect(() => {
    if (!visible || exiting) return
    const root = dialogRef.current
    if (!root) return
    const previous = document.activeElement as HTMLElement | null
    primaryRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        handleDismiss()
        return
      }
      if (event.key !== 'Tab') return
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus?.()
    }
  }, [visible, exiting, handleDismiss])

  if (!rendered) {
    return null
  }

  const overlayClass = [
    styles.overlay,
    visible && !exiting ? styles.visible : '',
    exiting ? styles.exiting : '',
  ]
    .filter(Boolean)
    .join(' ')

  const buttonDisabled = primaryDisabled || isActivating

  return (
    <div className={overlayClass}>
      <div className={styles.backdrop} onClick={handleDismiss} />
      <div
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={styles.glow} aria-hidden="true" />

        <div className={styles.header}>
          {isConnected ? (
            <div className={styles.pill}>
              <span className={styles.pillDot} />
              Wallet Connected
            </div>
          ) : (
            <span />
          )}
          {showCloseButton ? (
            <button
              type="button"
              className={styles.close}
              onClick={handleDismiss}
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          ) : (
            <span />
          )}
        </div>

        <h2 id={titleId} className={styles.title}>
          Activate Gasless Mode
        </h2>

        <ol className={styles.steps}>
          <StepCard
            state={step1State}
            step={1}
            title="Wallet Connected"
            current={currentStep === 1}
            meta={addressShort ? <span className={styles.address}>{addressShort}</span> : null}
          />
          <li
            className={`${styles.connector} ${connectorDone ? styles.connectorDone : ''}`}
            aria-hidden="true"
          >
            <span className={styles.connectorLine} />
          </li>
          <StepCard
            state={step2State}
            step={2}
            title="Trading Session"
            current={currentStep === 2}
            meta={
              <span className={`${styles.badge} ${sessionComplete ? styles.badgeActive : styles.badgeInactive}`}>
                {sessionComplete ? 'Active' : 'Inactive'}
              </span>
            }
          />
        </ol>

        {errorMessage && (
          <div className={`${styles.notice} ${styles.noticeError}`}>
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={handleRetry}
              disabled={isWorking}
              className={styles.retry}
            >
              {isWorking ? 'Retrying...' : 'Try again'}
            </button>
          </div>
        )}
        {!gaslessEnabled && (
          <div className={styles.notice}>
            Gasless trading is disabled. Set <span className={styles.mono}>NEXT_PUBLIC_GASLESS_ENABLED=true</span> to enable.
          </div>
        )}

        <div className={styles.spacer} />

        <div className={styles.footer}>
          <p className={styles.legal}>
            By signing, you agree to our{' '}
            <a href="/terms">Terms</a>
            {' '}and{' '}
            <a href="/privacy">Privacy Policy</a>.
          </p>
          <button
            ref={primaryRef}
            type="button"
            className={styles.primary}
            onClick={handlePrimary}
            disabled={buttonDisabled}
          >
            {signaturePending ? (
              'Waiting for signature…'
            ) : (
              <>
                Sign to Activate
                <span className={styles.arrow} aria-hidden="true">→</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
