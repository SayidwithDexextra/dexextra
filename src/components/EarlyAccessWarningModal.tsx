'use client'

import React, { useEffect, useState, useCallback, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import styles from './EarlyAccessWarningModal.module.css'

const STORAGE_KEY = 'dexetera-mvp-warning-acknowledged'
const EXIT_MS = 150
const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

const POINTS = [
  'There may be visual bugs and interface issues',
  'Data may not always be live and may require page refreshes',
  'Features and functionality may not work as intended',
  'The application is under active development',
] as const

const DISCORD_URL = 'https://discord.gg/dexetera'

interface MVPWarningModalProps {
  forceShow?: boolean
  onClose?: () => void
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  )
}

export default function EarlyAccessWarningModal({ forceShow, onClose }: MVPWarningModalProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const [isChecked, setIsChecked] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const [exiting, setExiting] = useState(false)
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const checkboxRef = useRef<HTMLInputElement>(null)

  const acknowledgmentRequired = !forceShow

  const handleDismiss = useCallback(() => {
    if (!isChecked && !forceShow) return

    setIsAnimating(false)
    setExiting(true)
    setTimeout(() => {
      setIsDismissed(true)
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, 'true')
      }
      onClose?.()
    }, EXIT_MS)
  }, [isChecked, forceShow, onClose])

  useEffect(() => {
    setMounted(true)

    if (forceShow) {
      setIsVisible(true)
      setIsDismissed(false)
      setTimeout(() => setIsAnimating(true), 10)
      return
    }

    const acknowledged = typeof window !== 'undefined'
      ? localStorage.getItem(STORAGE_KEY) === 'true'
      : false

    if (!acknowledged) {
      setIsVisible(true)
      setTimeout(() => setIsAnimating(true), 10)
    }
  }, [forceShow])

  const canDismiss = isChecked || Boolean(forceShow)

  useEffect(() => {
    if (!isAnimating || exiting) return
    const root = dialogRef.current
    if (!root) return
    const previous = document.activeElement as HTMLElement | null
    const focusCheckbox = () => checkboxRef.current?.focus()
    focusCheckbox()
    const focusId = window.requestAnimationFrame(focusCheckbox)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!acknowledgmentRequired) handleDismiss()
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

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.cancelAnimationFrame(focusId)
      document.removeEventListener('keydown', onKeyDown, true)
      previous?.focus?.()
    }
  }, [isAnimating, exiting, acknowledgmentRequired, handleDismiss])

  if (!mounted || !isVisible || isDismissed) return null

  const overlayClass = [
    styles.overlay,
    isAnimating && !exiting ? styles.visible : '',
    exiting ? styles.exiting : '',
  ]
    .filter(Boolean)
    .join(' ')

  const modalContent = (
    <div className={overlayClass}>
      <div
        className={styles.backdrop}
        onClick={acknowledgmentRequired ? undefined : handleDismiss}
      />

      <div
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className={styles.glow} aria-hidden="true" />

        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.pill}>
              <span className={styles.pillDot} />
              MVP NOTICE
            </div>
            <div className={styles.beta}>Beta</div>
          </div>
          {!acknowledgmentRequired ? (
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
          Dexetera is currently in MVP.
        </h2>
        <p id={descriptionId} className={styles.body}>
          This application is actively being developed and may contain bugs or undergo significant changes.{' '}
          Please report bugs in our{' '}
          <a
            className={styles.discord}
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <DiscordIcon />
            Discord
          </a>
        </p>

        <div className={styles.pointsLabel}>
          By proceeding, you acknowledge and accept:
        </div>
        <ul className={styles.points}>
          {POINTS.map((text, i) => (
            <li key={text} className={styles.card}>
              <span className={styles.cardNumber} aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className={styles.cardText}>{text}</span>
            </li>
          ))}
        </ul>

        <div className={styles.spacer} />

        <div className={styles.footer}>
          <label className={styles.agree}>
            <input
              ref={checkboxRef}
              type="checkbox"
              className={styles.agreeInput}
              checked={isChecked}
              onChange={(e) => setIsChecked(e.target.checked)}
            />
            <span className={styles.agreeBox} aria-hidden="true">
              {isChecked ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="#0F0F0F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l5 5L19 7" />
                </svg>
              ) : null}
            </span>
            <span className={styles.agreeText}>
              I understand the risks and agree to continue
            </span>
          </label>
          <button
            type="button"
            onClick={handleDismiss}
            disabled={!canDismiss}
            className={`${styles.primary} ${canDismiss ? styles.primaryEnabled : styles.primaryDisabled}`}
          >
            I Understand, Continue to App
            <span className={styles.arrow} aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
