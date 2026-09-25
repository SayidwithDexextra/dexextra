'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { useViewAs } from '@/contexts/ViewAsContext'
import { DEFAULT_PROFILE_IMAGE } from '@/types/userProfile'
import styles from './DemoViewModal.module.css'

const EXIT_MS = 180
const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

function truncateMiddle(address: string): string {
  if (address.length <= 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function isUsableAvatar(url: string | null | undefined): url is string {
  if (!url) return false
  if (url === DEFAULT_PROFILE_IMAGE) return false
  return true
}

function PersonSilhouette() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
    </svg>
  )
}

export type DemoViewModalContentProps = {
  username: string
  address: string
  avatarUrl?: string | null
  visible: boolean
  exiting?: boolean
  onEnter: () => void
  onDismiss: () => void
}

export function DemoViewModalContent({
  username,
  address,
  avatarUrl,
  visible,
  exiting = false,
  onEnter,
  onDismiss,
}: DemoViewModalContentProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const [imageFailed, setImageFailed] = useState(false)
  const showPhoto = isUsableAvatar(avatarUrl) && !imageFailed

  useEffect(() => {
    setImageFailed(false)
  }, [avatarUrl])

  useEffect(() => {
    if (!visible || exiting) return
    const root = dialogRef.current
    if (!root) return
    const previous = document.activeElement as HTMLElement | null
    primaryRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onDismiss()
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
  }, [visible, exiting, onDismiss])

  const overlayClass = [
    styles.overlay,
    visible && !exiting ? styles.visible : '',
    exiting ? styles.exiting : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={overlayClass}>
      <div className={styles.backdrop} onClick={onDismiss} />
      <div
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className={styles.portrait}>
          {showPhoto ? (
            <Image
              src={avatarUrl}
              alt={`${username}'s profile photo`}
              fill
              sizes="200px"
              className={styles.photo}
              priority
              unoptimized
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className={styles.silhouette}>
              <PersonSilhouette />
            </div>
          )}
          <div className={styles.scrim} aria-hidden="true" />
          <div className={styles.identity} aria-hidden="true">
            <div className={styles.lensRow}>
              <span className={styles.liveDot} />
              <span className={styles.lensLabel}>LENS</span>
            </div>
            <div className={styles.identityName}>{username}</div>
            <div className={styles.identityAddress}>{address}</div>
          </div>
        </div>

        <div className={styles.content}>
          <div className={styles.header}>
            <div className={styles.pill}>
              <span className={styles.pillDot} />
              DEMO VIEW
            </div>
            <button
              type="button"
              className={styles.close}
              onClick={onDismiss}
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <h2 id={titleId} className={styles.title}>
            Explore the platform as {username}
          </h2>
          <p id={descriptionId} className={styles.body}>
            See their live positions, open orders, balances, and book. This is visual only — you cannot trade or withdraw as them.
          </p>

          <div className={styles.spacer} />

          <div className={styles.actions}>
            <button
              ref={primaryRef}
              type="button"
              className={styles.primary}
              onClick={onEnter}
            >
              View as {username}
              <span className={styles.arrow} aria-hidden="true">→</span>
            </button>
            <button type="button" className={styles.secondary} onClick={onDismiss}>
              Not now
            </button>
          </div>

          <p className={styles.footnote}>
            Viewing as {username} stays available from the header if you change your mind.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function DemoViewModal() {
  const { demoAddress, demoName, demoAvatarUrl, modalState, isHydrated, enterDemoView, dismissModal } = useViewAs()
  const [mounted, setMounted] = useState(false)
  const [rendered, setRendered] = useState(false)
  const [visible, setVisible] = useState(false)
  const [exiting, setExiting] = useState(false)

  const isOpen = Boolean(isHydrated && demoAddress && modalState === 'open')

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (isOpen) {
      setRendered(true)
      setExiting(false)
      let inner = 0
      const outer = window.requestAnimationFrame(() => {
        inner = window.requestAnimationFrame(() => setVisible(true))
      })
      return () => {
        window.cancelAnimationFrame(outer)
        window.cancelAnimationFrame(inner)
      }
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

  const handleEnter = useCallback(() => {
    enterDemoView()
  }, [enterDemoView])

  const handleDismiss = useCallback(() => {
    dismissModal()
  }, [dismissModal])

  if (!mounted || !rendered || !demoAddress) return null

  const address = truncateMiddle(demoAddress)
  const username = demoName || address

  return createPortal(
    <DemoViewModalContent
      username={username}
      address={address}
      avatarUrl={demoAvatarUrl}
      visible={visible}
      exiting={exiting}
      onEnter={handleEnter}
      onDismiss={handleDismiss}
    />,
    document.body
  )
}
