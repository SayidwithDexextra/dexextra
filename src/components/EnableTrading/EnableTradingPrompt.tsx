'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import useWallet from '@/hooks/useWallet'
import { useSession } from '@/contexts/SessionContext'
import EnableTradingModal from './EnableTradingModal'

/**
 * Global listener that opens EnableTradingModal when:
 * - A wallet just connected (transition false -> true)
 * - On first load if a wallet is already connected but session is not active
 */
export default function EnableTradingPrompt() {
  const { walletData } = useWallet()
  const { sessionActive } = useSession()

  const isConnected = Boolean(walletData?.isConnected && walletData?.address)
  const isSessionKnown = sessionActive !== null

  // Track previous connection state to detect "just connected"
  const prevConnectedRef = useRef<boolean>(false)
  // Track previous session to detect active -> inactive transitions (expiry)
  const prevSessionActiveRef = useRef<boolean | null>(null)
  const [open, setOpen] = useState(false)

  // Address-specific storage key to avoid double-prompt on every render
  const storageKey = useMemo(() => {
    const addr = walletData?.address || ''
    return addr ? `enabletrading_prompt:${addr}` : ''
  }, [walletData?.address])

  // On mount or when states change, decide whether to show the modal
  useEffect(() => {
    // Avoid opening until we definitively know session status to prevent flicker
    if (!isSessionKnown) return

    const prev = prevConnectedRef.current
    prevConnectedRef.current = isConnected

    // If not connected, never open
    if (!isConnected) return

    // Already has active session, no need to prompt
    if (sessionActive) return

    // Show on fresh connect: false -> true
    if (!prev && isConnected) {
      setOpen(true)
      return
    }

    // Also show on page load if connected without session, unless user dismissed very recently
    if (typeof window !== 'undefined' && storageKey) {
      const dismissedAt = window.localStorage.getItem(storageKey)
      const recentlyDismissed = dismissedAt ? (Date.now() - parseInt(dismissedAt, 10) < 1000 * 60 * 5) : false // 5 minutes grace
      if (!recentlyDismissed) {
        setOpen(true)
      }
    } else {
      setOpen(true)
    }
  }, [isConnected, sessionActive, storageKey, open, isSessionKnown])

  // Explicitly open when a previously-active session becomes inactive (likely expired)
  useEffect(() => {
    if (!isSessionKnown) return
    if (!isConnected) return
    const prev = prevSessionActiveRef.current
    prevSessionActiveRef.current = sessionActive
    if (prev === true && sessionActive === false) {
      setOpen(true)
    }
  }, [sessionActive, isConnected, isSessionKnown])

  // Auto-close if session becomes active while modal is open
  useEffect(() => {
    if (sessionActive && open) {
      setOpen(false)
    }
  }, [sessionActive, open])

  const handleClose = () => {
    setOpen(false)
    if (typeof window !== 'undefined' && storageKey) {
      window.localStorage.setItem(storageKey, `${Date.now()}`)
    }
  }

  if (sessionActive || !open) return null

  return (
    <EnableTradingModal
      isOpen={open}
      onClose={handleClose}
      onSuccess={() => setOpen(false)}
    />
  )
}


